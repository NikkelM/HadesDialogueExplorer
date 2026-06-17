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
    def test_forced_textlines_extracted_with_poseidon_owner_override(self):
        """``PoseidonWrathIntro01`` is in ``TEXTLINE_OWNER_OVERRIDES``
        so the rerouting moves it onto ``PoseidonUpgrade`` (where all
        his other dialogue lives, from LootData). The ancestor
        requirements must still be lifted onto the rerouted textline.
        The per-cue resolver still attributes the displayed speaker
        as ``NPC_Poseidon_01``."""
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
        assert "RoomOpening" not in result
        assert "PoseidonUpgrade" in result
        tl = result["PoseidonUpgrade"]["ForcedTextLines"]["PoseidonWrathIntro01"]
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


class TestInspectPointCollapseAndExcludedTextlines:
    """RoomData / EncounterData parallel of the DeathLoopData behaviour:
    textlines inside a ``InspectPoints[<id>]`` idmap container collapse
    to ``Storyteller`` (the Narrator) instead of taking the
    room/encounter name as owner. Non-InspectPoint textlines in the
    same room keep the room name. Also covers the
    ``EXCLUDED_TEXTLINE_NAMES`` post-extraction filter used to drop the
    unreachable ``TestNPCs`` dev-test cue."""

    def test_room_inspect_point_textlines_collapse_to_storyteller(self):
        """A first-inspect ambient narration line in a room's
        ``InspectPoints[<id>]`` should land under ``Storyteller``, not
        under the room name (mirrors DeathLoopData behaviour)."""
        result = extract('''RoomSetData.Tartarus = {
            A_Boss01 = {
                InspectPoints = {
                    [510795] = {
                        PlayOnce = true,
                        InteractTextLineSets = {
                            A_Boss_01_Inspect01 = {
                                { Cue = "/VO/Storyteller_0411",
                                  Text = "The Erinyes; trusted sentinels of Lord Hades." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert "Storyteller" in result
        assert "A_Boss01" not in result
        line = result["Storyteller"]["InteractTextLineSets"]["A_Boss_01_Inspect01"]
        assert line["dialogueLines"][0]["speaker"] == "Storyteller"

    def test_room_inspect_point_forced_play_once_without_source_field(self):
        """Room inspect-point narration is one-shot in-game; the extractor
        force-marks it ``playOnce`` even when the source table omits the
        flag."""
        result = extract('''RoomSetData.Tartarus = {
            A_Boss01 = {
                InspectPoints = {
                    [510795] = {
                        InteractTextLineSets = {
                            A_Boss_01_Inspect01 = {
                                { Cue = "/VO/Storyteller_0411", Text = "Sentinels." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        tl = result["Storyteller"]["InteractTextLineSets"]["A_Boss_01_Inspect01"]
        assert tl["playOnce"] is True

    def test_room_inspect_point_implicit_speaker_falls_back_to_storyteller(self):
        """An InspectPoint cue without an explicit ``Speaker`` AND
        without a recognised cue-path prefix should use Storyteller as
        the fallback speaker (the collapsed owner), not the room name."""
        result = extract('''RoomSetData.Tartarus = {
            SomeRoom = {
                InspectPoints = {
                    [100] = {
                        InteractTextLineSets = {
                            L1 = { { Text = "Ambient narration." } }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert "Storyteller" in result
        line = result["Storyteller"]["InteractTextLineSets"]["L1"]
        assert line["dialogueLines"][0]["speaker"] == "Storyteller"

    def test_room_forced_textlines_keep_room_owner_when_no_override(self):
        """``ForcedTextLines`` under ``ForcedRewards`` (not under
        ``InspectPoints``) keep the room name as owner when no
        per-textline override matches. The room name remains as scene
        context for the boon-offering event itself; the per-cue
        speaker resolver still attributes individual lines correctly."""
        result = extract('''RoomSetData.Tartarus = {
            RoomOpening = {
                ForcedRewards = {
                    {
                        Name = "Boon",
                        ForcedTextLines = {
                            GenericForcedLine01 = {
                                { Cue = "/VO/Poseidon_0148", Text = "Nephew!" }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        # Owner stays as the room name (not collapsed to Storyteller).
        assert "RoomOpening" in result
        assert "Storyteller" not in result
        line = result["RoomOpening"]["ForcedTextLines"]["GenericForcedLine01"]
        # Per-cue speaker resolution still gives Poseidon.
        assert line["dialogueLines"][0]["speaker"] == "NPC_Poseidon_01"

    def test_mixed_room_splits_inspect_points_and_forced_textlines(self):
        """Same-room split: ``RoomOpening`` (or similar) hosting both
        inspect-point Storyteller lines AND non-inspect-point speaker
        lines should produce two owners - Storyteller for the inspects
        and the room name for the rest. Uses a non-overridden textline
        name so the rerouting map doesn't move the ForcedRewards line."""
        result = extract('''RoomSetData.Tartarus = {
            RoomOpening = {
                InspectPoints = {
                    [200] = {
                        InteractTextLineSets = {
                            OpeningFirstInspect = {
                                { Cue = "/VO/Storyteller_0001",
                                  Text = "The Underworld." }
                            }
                        }
                    }
                },
                ForcedRewards = {
                    {
                        Name = "Boon",
                        ForcedTextLines = {
                            GenericForcedLine02 = {
                                { Cue = "/VO/Poseidon_0139", Text = "Listen up." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert set(result.keys()) == {"Storyteller", "RoomOpening"}
        assert "OpeningFirstInspect" in result["Storyteller"]["InteractTextLineSets"]
        assert "GenericForcedLine02" in result["RoomOpening"]["ForcedTextLines"]

    def test_multiple_rooms_inspect_points_accumulate_under_storyteller(self):
        """Cross-room collapse: inspect-point textlines from different
        rooms all land under the single Storyteller owner without
        overwriting each other."""
        result = extract('''RoomSetData.Tartarus = {
            A_Boss01 = {
                InspectPoints = {
                    [1] = { InteractTextLineSets = {
                        Inspect_A = { { Cue = "/VO/Storyteller_0001", Text = "a" } } } }
                }
            },
            B_Intro = {
                InspectPoints = {
                    [2] = { InteractTextLineSets = {
                        Inspect_B = { { Cue = "/VO/Storyteller_0002", Text = "b" } } } }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert set(result.keys()) == {"Storyteller"}
        section = result["Storyteller"]["InteractTextLineSets"]
        assert "Inspect_A" in section
        assert "Inspect_B" in section

    def test_array_form_inspect_points_keep_room_owner(self):
        """Backward-compatibility: the array-form ``InspectPoints = { {
        ObjectId = ..., ... } }`` (used in some test fixtures) does NOT
        match the idmap collapse rule because the entries are positional
        array elements, not numeric-key map entries. These keep the
        room name to preserve the existing within-owner-collision
        behaviour."""
        result = extract('''RoomSetData.Tartarus = {
            A_Shop01 = {
                InspectPoints = {
                    { ObjectId = 390000, InteractTextLineSets = {
                        L = { { Cue = "/VO/Storyteller_0100", Text = "x" } } } }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert "A_Shop01" in result
        assert "Storyteller" not in result

    def test_excluded_textline_is_filtered_out(self):
        """``PersephoneVOTest1`` (the only textline in the unreachable
        ``TestNPCs`` dev-test room) is in ``EXCLUDED_TEXTLINE_NAMES``
        and must be dropped post-extraction. The InspectPoint collapse
        rule means it would otherwise land under ``Storyteller``."""
        result = extract('''RoomSetData.Tartarus = {
            TestNPCs = {
                InspectPoints = {
                    [370000] = {
                        InteractTextLineSets = {
                            PersephoneVOTest1 = {
                                { Cue = "/VO/Persephone_0018", Text = "Letter." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomData.lua")
        # Whole owner is dropped because its only textline was filtered.
        assert "TestNPCs" not in result
        assert "Storyteller" not in result
        assert result == {}

    def test_excluded_textline_does_not_remove_sibling_textlines(self):
        """The filter is per-textline-name, not per-owner: a sibling
        line in the same section must survive."""
        result = extract('''RoomSetData.Tartarus = {
            SomeRoom = {
                InspectPoints = {
                    [42] = {
                        InteractTextLineSets = {
                            PersephoneVOTest1 = { { Text = "filter me" } },
                            KeptLine = { { Text = "keep me" } }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        section = result["Storyteller"]["InteractTextLineSets"]
        assert "PersephoneVOTest1" not in section
        assert "KeptLine" in section


class TestTextlineOwnerOverrides:
    """Per-textline-name overrides reroute structurally-synthetic
    encounter textlines onto a real character owner with the
    appropriate partner injected (mirrors the explicit
    ``Partner = "..."`` field NPCData.lua uses on xWithY pairs)."""

    def test_megaera_with_sisyphus_routes_to_sisyphus_with_meg_partner(self):
        """``Story_Sisyphus_01`` is the structural encounter wrapper;
        ``MegaeraWithSisyphus01`` is a Sisyphus-led conversation. The
        override moves the textline under ``NPC_Sisyphus_01`` and
        injects ``NPC_FurySister_01`` (house Meg) as the partner."""
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = {
                            MegaeraWithSisyphus01 = {
                                { Cue = "/VO/Sisyphus_0001", Text = "Hi Meg." },
                                { Cue = "/VO/MegaeraField_0001", Text = "Hey Sis." }
                            }
                        }
                    } } } }
                }
            }
        }''')
        assert "Story_Sisyphus_01" not in result
        assert "NPC_Sisyphus_01" in result
        tl = result["NPC_Sisyphus_01"]["TextLineSet"]["MegaeraWithSisyphus01"]
        assert tl["partner"] == "NPC_FurySister_01"

    def test_thanatos_with_sisyphus_routes_to_sisyphus_with_than_partner(self):
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = {
                            ThanatosWithSisyphus02 = {
                                { Cue = "/VO/Sisyphus_0010", Text = "Hello Than." }
                            }
                        }
                    } } } }
                }
            }
        }''')
        assert "NPC_Sisyphus_01" in result
        tl = result["NPC_Sisyphus_01"]["TextLineSet"]["ThanatosWithSisyphus02"]
        assert tl["partner"] == "NPC_Thanatos_01"

    def test_override_preserves_non_rerouted_siblings_under_original_owner(self):
        """A textline NOT in the override map should stay under the
        original encounter owner even if rerouted siblings exist in the
        same section."""
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = {
                            MegaeraWithSisyphus01 = {
                                { Cue = "/VO/Sisyphus_0001", Text = "Hi." }
                            },
                            UnrelatedSisyphusLine = {
                                { Cue = "/VO/Sisyphus_0099", Text = "Solo line." }
                            }
                        }
                    } } } }
                }
            }
        }''')
        assert "NPC_Sisyphus_01" in result
        assert "MegaeraWithSisyphus01" in result["NPC_Sisyphus_01"]["TextLineSet"]
        # The non-overridden sibling stays under the structural owner.
        assert "Story_Sisyphus_01" in result
        assert "UnrelatedSisyphusLine" in result["Story_Sisyphus_01"]["TextLineSet"]

    def test_override_drops_empty_original_owner(self):
        """When every textline under a structural owner is rerouted,
        no empty entry should leak into the result for that owner."""
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = { Args = {
                        TextLineSet = {
                            MegaeraWithSisyphus01 = { { Text = "A" } },
                            MegaeraWithSisyphus02 = { { Text = "B" } },
                            ThanatosWithSisyphus01 = { { Text = "C" } }
                        }
                    } } } }
                }
            }
        }''')
        assert "Story_Sisyphus_01" not in result
        assert set(result["NPC_Sisyphus_01"]["TextLineSet"].keys()) == {
            "MegaeraWithSisyphus01",
            "MegaeraWithSisyphus02",
            "ThanatosWithSisyphus01",
        }

    def test_override_lifts_ancestor_requirements_onto_rerouted_textline(self):
        """Rerouted textlines must still receive the encounter event's
        ``GameStateRequirements`` (gating they'd otherwise lose when
        moved out of the structural encounter owner)."""
        result = extract('''EncounterData = {
            Story_Sisyphus_01 = {
                StartRoomUnthreadedEvents = {
                    { Args = { AddEncounterEvent = {
                        GameStateRequirements = {
                            RequiredTextLines = { "PrereqLine01" }
                        },
                        Args = {
                            TextLineSet = {
                                MegaeraWithSisyphus03 = { { Text = "Gated." } }
                            }
                        }
                    } } }
                }
            }
        }''')
        tl = result["NPC_Sisyphus_01"]["TextLineSet"]["MegaeraWithSisyphus03"]
        assert tl["requirements"].get("RequiredTextLines") == ["PrereqLine01"]

    def test_poseidon_forced_textlines_route_to_poseidon_owner(self):
        """``PoseidonFishQuest01`` and ``PoseidonWrathIntro01`` live
        under ``RoomOpening``'s ``ForcedRewards`` (not ``InspectPoints``)
        so they bypass the Storyteller collapse. They're solo Poseidon
        lines, so the override routes them onto ``PoseidonUpgrade``
        (where his other dialogue from LootData accumulates)."""
        result = extract('''RoomSetData.Tartarus = {
            RoomOpening = {
                ForcedRewards = {
                    {
                        Name = "Boon",
                        ForcedTextLines = {
                            PoseidonFishQuest01 = {
                                { Cue = "/VO/Poseidon_0148", Text = "Nephew!" }
                            },
                            PoseidonWrathIntro01 = {
                                { Cue = "/VO/Poseidon_0139", Text = "Listen up." }
                            }
                        }
                    }
                }
            }
        }''', source_file="RoomDataTartarus.lua")
        assert "RoomOpening" not in result
        assert "PoseidonUpgrade" in result
        sect = result["PoseidonUpgrade"]["ForcedTextLines"]
        assert "PoseidonFishQuest01" in sect
        assert "PoseidonWrathIntro01" in sect
        assert sect["PoseidonFishQuest01"].get("partner") is None