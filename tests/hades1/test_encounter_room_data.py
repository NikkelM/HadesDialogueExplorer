"""Tests for the EncounterData / RoomData* extractor."""

from src.lua_parser import LuaParser
from src.extractors.hades1.encounter_room_data import (
    extract_encounter_room_data,
    _cue_speaker_resolver,
    CUE_PATH_SPEAKERS,
)


def extract(lua_text, source="Test", source_file="EncounterData.lua"):
    parsed = LuaParser(lua_text).parse_file()
    return extract_encounter_room_data(parsed, source_label=source, source_file=source_file)


class TestRootDetection:
    def test_empty_input_returns_empty(self):
        assert extract("") == {}

    def test_unknown_top_level_returns_empty(self):
        assert extract('SomethingElse = { foo = "bar" }') == {}

    def test_encounter_data_root_is_walked(self):
        result = extract('''EncounterData = {
            Story_X_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = { LineA = { { Text = "Hi." } } }
                    } } } }
                }
            }
        }''')
        assert "Story_X_01" in result
        assert "LineA" in result["Story_X_01"]["TextLineSet"]

    def test_room_set_data_root_is_walked(self):
        result = extract('''RoomSetData.Custom = {
            RoomA = {
                ForcedRewards = {
                    { Name = "Boon", ForcedTextLines = {
                        ForcedA = { { Text = "Boom." } }
                    } }
                }
            }
        }''', source_file="RoomDataCustom.lua")
        assert "RoomA" in result
        assert "ForcedA" in result["RoomA"]["ForcedTextLines"]

    def test_multiple_roots_in_same_file_both_walked(self):
        # Defensive: parse_file collects every top-level assignment; if a
        # file declared both an EncounterData and a RoomSetData root, both
        # subtrees should contribute owners.
        result = extract('''EncounterData = {
            EncA = { StartRoomUnthreadedEvents = { { Args = { AddEncounterEvent = { Args = {
                TextLineSet = { LineE = { { Text = "E." } } }
            } } } } } }
        }
        RoomSetData.Combo = {
            RoomR = { ForcedRewards = { { ForcedTextLines = { LineR = { { Text = "R." } } } } } }
        }''')
        assert "EncA" in result and "RoomR" in result


class TestOwnerNaming:
    def test_owner_is_topmost_named_below_root(self):
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = { LineA = { { Text = "A." } } }
                    } } } }
                }
            }
        }''')
        assert list(result.keys()) == ["Story_Sisyphus_01"]

    def test_multiple_containers_under_same_owner_merge(self):
        # Two separate event blocks under the same encounter should
        # accumulate into a single owner entry's section dict.
        result = extract('''EncounterData = {
            Story_X_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = { LineA = { { Text = "A." } } }
                    } } } },
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = { LineB = { { Text = "B." } } }
                    } } } }
                }
            }
        }''')
        assert "LineA" in result["Story_X_01"]["TextLineSet"]
        assert "LineB" in result["Story_X_01"]["TextLineSet"]


class TestAncestorRequirements:
    def test_immediate_sibling_gsr_lifted(self):
        # ForcedTextLines and GameStateRequirements share a parent.
        result = extract('''RoomSetData.X = {
            RoomA = { ForcedRewards = { {
                Name = "Boon",
                GameStateRequirements = {
                    RequiredTextLines = { "PoseidonFirstPickUp" },
                    RequiredMinCompletedRuns = 4,
                },
                ForcedTextLines = { LineA = { { Text = "Boom." } } }
            } } }
        }''', source_file="RoomDataX.lua")
        tl = result["RoomA"]["ForcedTextLines"]["LineA"]
        assert tl["requirements"]["RequiredTextLines"] == ["PoseidonFirstPickUp"]
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4

    def test_ancestor_gsr_lifted_across_generic_levels(self):
        # GameStateRequirements is two levels above the TextLineSet
        # container (typical EncounterData shape).
        result = extract('''EncounterData = {
            E1 = { StartRoomUnthreadedEvents = { {
                GameStateRequirements = {
                    RequiredTextLines = { "PrereqA" }
                },
                Args = { AddEncounterEvent = { Args = {
                    TextLineSet = { LineA = { { Text = "Hi." } } }
                } } }
            } } }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["requirements"]["RequiredTextLines"] == ["PrereqA"]

    def test_closer_ancestor_gsr_replaces_outer_one(self):
        # Each subtree's nearest GSR gates only its own subtree - inner
        # blocks should NOT inherit an outer GSR once they declare their
        # own (the inner one fully replaces).
        result = extract('''EncounterData = {
            E1 = {
                StartRoomUnthreadedEvents = { {
                    GameStateRequirements = { RequiredTextLines = { "OuterReq" } },
                    Args = { AddEncounterEvent = { Args = {
                        GameStateRequirements = { RequiredTextLines = { "InnerReq" } },
                        TextLineSet = { LineA = { { Text = "Hi." } } }
                    } } }
                } }
            }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["requirements"]["RequiredTextLines"] == ["InnerReq"]

    def test_explicit_textline_requirement_wins_over_ancestor(self):
        # The textline itself declaring a key should not be overwritten
        # by an ancestor's value for the same key.
        result = extract('''EncounterData = {
            E1 = { StartRoomUnthreadedEvents = { {
                GameStateRequirements = { RequiredTextLines = { "Ancestor" } },
                Args = { AddEncounterEvent = { Args = {
                    TextLineSet = { LineA = {
                        RequiredTextLines = { "ExplicitOwn" },
                        { Text = "Hi." }
                    } }
                } } }
            } } }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["requirements"]["RequiredTextLines"] == ["ExplicitOwn"]

    def test_count_based_ancestor_requirement_lifted(self):
        result = extract('''RoomSetData.X = {
            R1 = { ForcedRewards = { {
                GameStateRequirements = {
                    RequiredMinAnyTextLines = {
                        TextLines = { "A", "B" },
                        Count = 2
                    }
                },
                ForcedTextLines = { LineA = { { Text = "x." } } }
            } } }
        }''', source_file="RoomDataX.lua")
        tl = result["R1"]["ForcedTextLines"]["LineA"]
        assert tl["requirements"]["RequiredMinAnyTextLines"] == ["A", "B"]
        assert tl["otherRequirements"]["RequiredMinAnyTextLines"]["Count"] == 2

    def test_sibling_level_required_fields_lifted_without_gsr_wrapper(self):
        """Direct-sibling ``Required*`` fields on a textline-set container
        get lifted just like a wrapped ``GameStateRequirements`` block.
        The shipping ``EncounterData`` / ``RoomData`` files use the
        wrapped form, but the shared walker supports both for parity with
        ``DeathLoopData`` and forward-compatibility."""
        result = extract('''RoomSetData.X = {
            RoomA = { ForcedRewards = { {
                Name = "Boon",
                RequiredTextLines = { "PoseidonFirstPickUp" },
                RequiredMinCompletedRuns = 4,
                ForcedTextLines = { LineA = { { Text = "Boom." } } }
            } } }
        }''', source_file="RoomDataX.lua")
        tl = result["RoomA"]["ForcedTextLines"]["LineA"]
        assert tl["requirements"]["RequiredTextLines"] == ["PoseidonFirstPickUp"]
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4



class TestCueSpeakerResolver:
    def test_resolver_extracts_prefix(self):
        from src.lua_parser import LuaTable
        cue = LuaTable(named={"Cue": "/VO/Poseidon_0148"})
        assert _cue_speaker_resolver(cue) == "NPC_Poseidon_01"

    def test_resolver_megaera_variants_both_resolve(self):
        from src.lua_parser import LuaTable
        for prefix in ("MegaeraField", "MegaeraHome"):
            cue = LuaTable(named={"Cue": f"/VO/{prefix}_0001"})
            assert _cue_speaker_resolver(cue) == "NPC_FurySister_01"

    def test_resolver_zagreus_variants_all_resolve(self):
        from src.lua_parser import LuaTable
        for prefix in ("ZagreusField", "ZagreusHome", "ZagreusScratch"):
            cue = LuaTable(named={"Cue": f"/VO/{prefix}_0001"})
            assert _cue_speaker_resolver(cue) == "CharProtag"

    def test_resolver_unknown_prefix_returns_none(self):
        from src.lua_parser import LuaTable
        cue = LuaTable(named={"Cue": "/VO/UnknownSpeaker_0001"})
        assert _cue_speaker_resolver(cue) is None

    def test_resolver_missing_cue_returns_none(self):
        from src.lua_parser import LuaTable
        assert _cue_speaker_resolver(LuaTable(named={})) is None

    def test_resolver_used_when_speaker_not_declared(self):
        result = extract('''EncounterData = {
            E1 = { StartRoomUnthreadedEvents = { { Args = { AddEncounterEvent = { Args = {
                TextLineSet = { LineA = {
                    { Cue = "/VO/Poseidon_0001", Text = "Sea greetings." }
                } }
            } } } } } } }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["dialogueLines"][0]["speaker"] == "NPC_Poseidon_01"

    def test_explicit_speaker_wins_over_resolver(self):
        result = extract('''EncounterData = {
            E1 = { StartRoomUnthreadedEvents = { { Args = { AddEncounterEvent = { Args = {
                TextLineSet = { LineA = {
                    { Cue = "/VO/Poseidon_0001", Speaker = "NPC_Sisyphus_01", Text = "Hi." }
                } }
            } } } } } } }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["dialogueLines"][0]["speaker"] == "NPC_Sisyphus_01"

    def test_resolver_fallback_to_owner_when_no_match(self):
        # Cue path doesn't match any known speaker prefix: line should
        # fall back to the owner name (default extract_textline behavior).
        result = extract('''EncounterData = {
            E1 = { StartRoomUnthreadedEvents = { { Args = { AddEncounterEvent = { Args = {
                TextLineSet = { LineA = {
                    { Cue = "/VO/Foo_0001", Text = "Hi." }
                } }
            } } } } } } }
        }''')
        tl = result["E1"]["TextLineSet"]["LineA"]
        assert tl["dialogueLines"][0]["speaker"] == "E1"


class TestForcedTextLines:
    def test_forced_textlines_extracted_with_room_owner_and_poseidon_speaker(self):
        result = extract('''RoomSetData.Tartarus = {
            RoomOpening = {
                ForcedRewards = {
                    {
                        Name = "Boon",
                        LootName = "PoseidonUpgrade",
                        GameStateRequirements = {
                            RequiredTextLines = { "PoseidonFirstPickUp" },
                            RequiredFalseTextLines = { "PoseidonWrathIntro01" },
                            RequiredMinCompletedRuns = 4,
                        },
                        ForcedTextLines = {
                            PoseidonWrathIntro01 = {
                                { Cue = "/VO/Poseidon_0139",
                                  Text = "I have to tell you something." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert "RoomOpening" in result
        tl = result["RoomOpening"]["ForcedTextLines"]["PoseidonWrathIntro01"]
        assert tl["dialogueLines"][0]["speaker"] == "NPC_Poseidon_01"
        assert tl["requirements"]["RequiredTextLines"] == ["PoseidonFirstPickUp"]
        assert tl["requirements"]["RequiredFalseTextLines"] == ["PoseidonWrathIntro01"]
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4


class TestCuePathSpeakerCoverage:
    def test_all_known_speaker_ids_match_canonical_form(self):
        # Sanity: every mapped speaker id should match the canonical
        # ``NPC_X_01`` / ``CharProtag`` / ``Storyteller`` shape. Catches
        # typos in the prefix map that would otherwise cause every cue
        # for that speaker to render with an unrecognized id.
        for prefix, speaker in CUE_PATH_SPEAKERS.items():
            assert speaker == "CharProtag" or speaker == "Storyteller" or speaker.startswith("NPC_"), (
                f"Cue prefix {prefix!r} maps to suspicious speaker id {speaker!r}"
            )


class TestWithinOwnerCollision:
    """A single encounter / room can declare the same textline name in
    two different containers (the real-world ``CharonFirstInspect`` case
    in ``A_Shop01`` is the canonical example). The engine keys
    ``TextLinesRecord`` globally by name so only one variant ever plays,
    but the extractor must surface every distinct definition as a
    variant rather than silently dropping the loser."""

    def test_same_owner_same_name_two_inspect_points_become_variants(self):
        result = extract('''RoomSetData.Tartarus = {
            A_Shop01 = {
                InspectPoints = {
                    {
                        ObjectId = 390000,
                        InteractTextLineSets = {
                            CharonFirstInspect = {
                                { Cue = "/VO/Storyteller_0100",
                                  Text = "The infernal wares of the boatman." }
                            }
                        }
                    },
                    {
                        ObjectId = 515864,
                        GameStateRequirements = { RequiredMinRunsCleared = 1 },
                        InteractTextLineSets = {
                            CharonFirstInspect = {
                                { Cue = "/VO/Storyteller_0101",
                                  Text = "The River Styx flows through the Underworld." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        tl = result["A_Shop01"]["InteractTextLineSets"]["CharonFirstInspect"]
        assert tl.get("nameCollision") is True
        assert len(tl["variants"]) == 2
        texts = sorted(
            v["dialogueLines"][0]["text"] for v in tl["variants"]
            if v.get("dialogueLines")
        )
        assert texts == [
            "The River Styx flows through the Underworld.",
            "The infernal wares of the boatman.",
        ]

