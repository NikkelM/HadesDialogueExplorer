"""Tests for the DeathLoopData extractor."""

from src.lua_parser import LuaParser
from src.extractors.hades1.deathloop_data import extract_deathloop_data


def extract(lua_text, source="Test", source_file="DeathLoopData.lua"):
    parsed = LuaParser(lua_text).parse_file()
    return extract_deathloop_data(parsed, source_label=source, source_file=source_file)


class TestBasicExtraction:
    def test_empty_input_returns_empty(self):
        assert extract("") == {}

    def test_input_without_deathloopdata_returns_empty(self):
        assert extract('SomethingElse = { foo = "bar" }') == {}

    def test_inspect_point_collapses_to_storyteller_owner(self):
        """Inspect-point entries collapse under the ``Storyteller`` owner
        (the Narrator) instead of producing per-id synthetic owners. See
        issue #71 for rationale: the synthetic ``InspectPoint_<id>``
        owner had no presentation value and polluted the owner count."""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [370001] = {
                        InteractTextLineSets = {
                            InspectStone01 = { { Text = "An old stone." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "Storyteller" in result
        # The synthetic per-id owner forms must NOT be emitted.
        assert "InspectPoint_370001" not in result
        assert "370001" not in result
        # Textline still reachable under the Storyteller owner.
        assert "InspectStone01" in result["Storyteller"]["InteractTextLineSets"]

    def test_inspect_point_default_speaker_is_storyteller(self):
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [123] = {
                        InteractTextLineSets = {
                            Line01 = { { Text = "Ambient narration." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["Storyteller"]["InteractTextLineSets"]["Line01"]
        assert line["dialogueLines"][0]["speaker"] == "Storyteller"

    def test_inspect_point_explicit_speaker_honored(self):
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [123] = {
                        InteractTextLineSets = {
                            Line01 = {
                                { Speaker = "NPC_Hades_01", Text = "What's this?" }
                            }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["Storyteller"]["InteractTextLineSets"]["Line01"]
        assert line["dialogueLines"][0]["speaker"] == "NPC_Hades_01"


class TestNonInspectPointOwners:
    """Numeric-id entries under non-InspectPoints parent maps (e.g.
    ``ObstacleData``) produce a raw synthetic ``<parent>_<id>`` owner
    by default. :data:`SYNTHETIC_OWNER_OVERRIDES` then re-keys known
    ids under their real speakers (see issue #71's per-id attribution
    table). Unmapped synthetic owners keep their raw name."""

    def test_mapped_obstacle_data_collapses_to_storyteller(self):
        """``ObstacleData_310036`` (flashback obstacle) is mapped to
        Storyteller in the override map."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [310036] = {
                        OnUsedTextLineSets = {
                            Flashback_Mother_01 = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "Storyteller" in result
        # The synthetic per-id owner must NOT be emitted; the override
        # map re-keys it under the real owner.
        assert "ObstacleData_310036" not in result
        line = result["Storyteller"]["OnUsedTextLineSets"]["Flashback_Mother_01"]
        assert line["dialogueLines"][0]["speaker"] == "Storyteller"

    def test_mapped_obstacle_data_attributes_to_skelly(self):
        """``ObstacleData_487120`` (trophy plinth) is mapped to Skelly;
        the override must drive both the owner key AND the default
        speaker fallback so Skelly's TrophyQuest_* lines without an
        explicit ``Speaker = ...`` aren't misattributed to Storyteller."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [487120] = {
                        OnUsedTextLineSets = {
                            TrophyQuest_GoldUnlocked_01 = { { Text = "Hey there, kid." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "NPC_Skelly_01" in result
        assert "ObstacleData_487120" not in result
        line = result["NPC_Skelly_01"]["OnUsedTextLineSets"]["TrophyQuest_GoldUnlocked_01"]
        # Implicit-speaker line falls back to the overridden owner, not Storyteller.
        assert line["dialogueLines"][0]["speaker"] == "NPC_Skelly_01"

    def test_mapped_obstacle_data_attributes_to_zagreus(self):
        """``ObstacleData_555853`` (badge seller) is mapped to Zagreus
        via the canonical ``CharProtag`` speaker id."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [555853] = {
                        OnUsedTextLineSets = {
                            BadgeSellerInfo01 = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "CharProtag" in result
        assert "ObstacleData_555853" not in result
        line = result["CharProtag"]["OnUsedTextLineSets"]["BadgeSellerInfo01"]
        assert line["dialogueLines"][0]["speaker"] == "CharProtag"

    def test_unmapped_obstacle_data_keeps_synthetic_owner(self):
        """Unmapped ObstacleData ids fall back to the raw synthetic
        ``<parent>_<id>`` name (we'd rather expose a clearly-synthetic
        name than silently misattribute it to Storyteller)."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [999999] = {
                        OnUsedTextLineSets = {
                            FutureUnknownLine = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        # No real-owner re-keying for unmapped ids.
        assert "ObstacleData_999999" in result
        assert "Storyteller" not in result
        line = result["ObstacleData_999999"]["OnUsedTextLineSets"]["FutureUnknownLine"]
        # Without an override AND without a parametric collapse for
        # this parent, the default speaker is the synthetic owner.
        assert line["dialogueLines"][0]["speaker"] == "ObstacleData_999999"

    def test_multiple_skelly_obstacles_accumulate_under_one_owner(self):
        """Many-into-one collapse via the override map: three distinct
        Skelly ObstacleData ids must accumulate under a single
        ``NPC_Skelly_01`` owner without their textlines overwriting
        each other (relies on the per-section setdefault merge)."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [487120] = { OnUsedTextLineSets = { TrophyQuest_GoldUnlocked_01 = { { Text = "g" } } } },
                    [487421] = { OnUsedTextLineSets = { TrophyQuest_SilverUnlocked_01 = { { Text = "s" } } } },
                    [487422] = { OnUsedTextLineSets = { TrophyQuest_BronzeUnlocked_01 = { { Text = "b" } } } }
                }
            }
        }'''
        result = extract(lua)
        assert set(result.keys()) == {"NPC_Skelly_01"}
        section = result["NPC_Skelly_01"]["OnUsedTextLineSets"]
        assert "TrophyQuest_GoldUnlocked_01" in section
        assert "TrophyQuest_SilverUnlocked_01" in section
        assert "TrophyQuest_BronzeUnlocked_01" in section

    def test_inspect_point_and_mapped_obstacle_data_merge_under_storyteller(self):
        """Mixed-container collapse: an inspect-point (parametric
        Storyteller collapse) and a Storyteller-mapped ObstacleData
        must accumulate under the single Storyteller owner."""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [111] = { InteractTextLineSets = { L_Inspect = { { Text = "a" } } } }
                },
                ObstacleData = {
                    [310036] = { OnUsedTextLineSets = { Flashback_Mother_01 = { { Text = "b" } } } }
                }
            }
        }'''
        result = extract(lua)
        assert set(result.keys()) == {"Storyteller"}
        assert "L_Inspect" in result["Storyteller"]["InteractTextLineSets"]
        assert "Flashback_Mother_01" in result["Storyteller"]["OnUsedTextLineSets"]

    def test_multiple_inspect_points_collapse_and_accumulate_under_storyteller(self):
        """Many-into-one parametric collapse: two distinct inspect-point
        ids must accumulate under the single Storyteller owner without
        their textlines overwriting each other. See issue #71."""
        lua = '''DeathLoopData = {
            AreaA = {
                InspectPoints = {
                    [111] = { InteractTextLineSets = { L1 = { { Text = "a" } } } }
                }
            },
            AreaB = {
                InspectPoints = {
                    [222] = { InteractTextLineSets = { L2 = { { Text = "b" } } } }
                }
            }
        }'''
        result = extract(lua)
        assert set(result.keys()) == {"Storyteller"}
        section = result["Storyteller"]["InteractTextLineSets"]
        assert "L1" in section
        assert "L2" in section
        # Both lines retain their own dialogue payload.
        assert section["L1"]["dialogueLines"][0]["text"] == "a"
        assert section["L2"]["dialogueLines"][0]["text"] == "b"

    def test_inspect_point_collapse_preserves_per_textline_source_pointer(self):
        """Even though the synthetic ``InspectPoint_<id>`` owner is gone,
        per-textline ``sourceFile:sourceLine`` must still pinpoint each
        inspect-point's location in the original Lua file (the traceback
        mechanism that replaces the displayed owner)."""
        lua = (
            'DeathLoopData = {\n'
            '    DeathArea = {\n'
            '        InspectPoints = {\n'
            '            [111] = { InteractTextLineSets = { L1 = { { Text = "a" } } } },\n'
            '            [222] = { InteractTextLineSets = { L2 = { { Text = "b" } } } }\n'
            '        }\n'
            '    }\n'
            '}'
        )
        result = extract(lua, source_file="DeathLoopData.lua")
        section = result["Storyteller"]["InteractTextLineSets"]
        assert section["L1"]["sourceFile"] == "DeathLoopData.lua"
        assert section["L2"]["sourceFile"] == "DeathLoopData.lua"
        # Different source lines for the two distinct inspect-points so
        # the user can trace either one back independently.
        assert section["L1"]["sourceLine"] != section["L2"]["sourceLine"]


class TestPathDerivedOwnerOverrides:
    """Path-derived synthetic owners (e.g.
    ``DeathArea_StartUnthreadedEvents_4`` for textlines inside
    distance-trigger events) also flow through
    :data:`SYNTHETIC_OWNER_OVERRIDES`. Bedroom and ending scenes are
    real-character dialogues hiding behind a synthetic container name
    (issue #71)."""

    def test_path_derived_owner_resolves_to_persephone(self):
        """``DeathArea_StartUnthreadedEvents_4`` is the Ending01 trigger;
        the override map attributes it to Persephone."""
        lua = '''DeathLoopData = {
            DeathArea = {
                StartUnthreadedEvents = {
                    {}, {}, {}, {}, {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = {
                                Ending01 = { { Text = "...goodbye." } }
                            }
                        } } }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "NPC_Persephone_01" in result
        assert "DeathArea_StartUnthreadedEvents_4" not in result
        line = result["NPC_Persephone_01"]["TextLineSet"]["Ending01"]
        # Default speaker reflects the overridden real owner.
        assert line["dialogueLines"][0]["speaker"] == "NPC_Persephone_01"

    def test_path_derived_bedroom_scenes_attribute_to_megaera_house(self):
        """The DeathAreaBedroom_StartUnthreadedEvents_1..5 entries are
        all Megaera house scenes; they collapse under the single house
        Megaera owner ``NPC_FurySister_01``. The leading empty array
        entry pads the indices so the real entries land at array
        positions 1 and 2 (matching the live game's actual layout
        recorded in :data:`SYNTHETIC_OWNER_OVERRIDES`)."""
        lua = '''DeathLoopData = {
            DeathAreaBedroom = {
                StartUnthreadedEvents = {
                    {},
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = { MegaeraBedroom01 = { { Text = "..." } } }
                        } } }
                    },
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = { MegaeraBedroom02 = { { Text = "..." } } }
                        } } }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "NPC_FurySister_01" in result
        assert "DeathAreaBedroom_StartUnthreadedEvents_1" not in result
        assert "DeathAreaBedroom_StartUnthreadedEvents_2" not in result
        section = result["NPC_FurySister_01"]["TextLineSet"]
        assert "MegaeraBedroom01" in section
        assert "MegaeraBedroom02" in section

    def test_mixed_speaker_scene_attaches_partner_field(self):
        """``DeathAreaBedroom_StartUnthreadedEvents_9``
        (MegaeraWithThanatosBedroom01) is a mixed-speaker scene: owner
        is the primary (Megaera House) and the partner field flags the
        secondary speaker (Thanatos), matching the existing
        ``Partner = "..."`` convention for xWithY pairs in NPCData.lua.
        Nine leading empty array entries pad the indices so the real
        entry lands at array position 9."""
        lua = '''DeathLoopData = {
            DeathAreaBedroom = {
                StartUnthreadedEvents = {
                    {}, {}, {}, {}, {}, {}, {}, {}, {},
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = {
                                MegaeraWithThanatosBedroom01 = { { Text = "..." } }
                            }
                        } } }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "NPC_FurySister_01" in result
        line = result["NPC_FurySister_01"]["TextLineSet"]["MegaeraWithThanatosBedroom01"]
        assert line["partner"] == "NPC_Thanatos_01"

    def test_unmapped_path_derived_owner_keeps_synthetic_name(self):
        """Path-derived synthetic owners not in the override map keep
        their raw synthetic name (forward compatibility with new
        scenes that haven't been attributed yet)."""
        lua = '''DeathLoopData = {
            FutureUnknownArea = {
                StartUnthreadedEvents = {
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = { UnknownScene01 = { { Text = "..." } } }
                        } } }
                    }
                }
            }
        }'''
        result = extract(lua)
        assert "FutureUnknownArea_StartUnthreadedEvents_0" in result

    def test_explicit_speaker_wins_over_override_default(self):
        """When a line declares its own ``Speaker = ...``, that wins
        over the override's default-speaker fallback."""
        lua = '''DeathLoopData = {
            DeathArea = {
                ObstacleData = {
                    [487120] = {
                        OnUsedTextLineSets = {
                            TrophyQuest_GoldUnlocked_01 = {
                                { Speaker = "NPC_Hades_01", Text = "Curious." }
                            }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["NPC_Skelly_01"]["OnUsedTextLineSets"]["TrophyQuest_GoldUnlocked_01"]
        assert line["dialogueLines"][0]["speaker"] == "NPC_Hades_01"


class TestSourceLabelAndFile:
    def test_source_label_and_file_propagated(self):
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [42] = { InteractTextLineSets = { L = { { Text = "x" } } } }
                }
            }
        }'''
        result = extract(lua, source="Hades 1", source_file="DeathLoopData.lua")
        assert result["Storyteller"]["source"] == "Hades 1"
        line = result["Storyteller"]["InteractTextLineSets"]["L"]
        assert line["sourceFile"] == "DeathLoopData.lua"


class TestSingularTextLineSet:
    """`TextLineSet` (singular) appears inside DistanceTrigger configs.

    Regression for two bugs that combined to silently drop 8 of 9 such
    textlines: (a) singular form not recognized, (b) all 9 hashed to the
    same generic owner name "Args" so 8 overwrote each other.
    """

    def test_ending01_extracted_from_distance_trigger(self):
        lua = '''DeathLoopData = {
            DeathArea = {
                StartUnthreadedEvents = {
                    {
                        FunctionName = "ActivatePrePlacedUnits",
                        Args = {
                            DistanceTrigger = {
                                Args = {
                                    TextLineSet = {
                                        Ending01 = { { Text = "...goodbye." } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        # Owner should be path-derived and include the DeathArea context so
        # it can't collide with the same array index under DeathAreaBedroom.
        assert "DeathArea_StartUnthreadedEvents_0" in result
        owner = result["DeathArea_StartUnthreadedEvents_0"]
        assert "TextLineSet" in owner
        assert "Ending01" in owner["TextLineSet"]

    def test_multiple_distance_triggers_in_separate_death_areas_dont_collide(self):
        """Same-index entries in different DeathArea tables must produce
        different owner names so neither set silently overwrites the other."""
        lua = '''DeathLoopData = {
            DeathArea = {
                StartUnthreadedEvents = {
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = { LineA = { { Text = "a" } } }
                        } } }
                    }
                }
            },
            DeathAreaBedroom = {
                StartUnthreadedEvents = {
                    {
                        Args = { DistanceTrigger = { Args = {
                            TextLineSet = { LineB = { { Text = "b" } } }
                        } } }
                    }
                }
            }
        }'''
        result = extract(lua)
        owners = set(result.keys())
        assert "DeathArea_StartUnthreadedEvents_0" in owners
        assert "DeathAreaBedroom_StartUnthreadedEvents_0" in owners
        # And the textlines are kept under their respective owners.
        assert "LineA" in result["DeathArea_StartUnthreadedEvents_0"]["TextLineSet"]
        assert "LineB" in result["DeathAreaBedroom_StartUnthreadedEvents_0"]["TextLineSet"]


class TestInspectPointSiblingRequirements:
    """Inspect-point tables in DeathLoopData.lua almost always declare
    ``Required*`` fields as direct siblings of ``InteractTextLineSets``,
    not wrapped inside ``GameStateRequirements``. The walker must lift
    these onto every textline contained in that inspect point.

    Regression for the case where ``InspectCellar01`` showed up in the
    viewer with empty ``requirements`` / ``otherRequirements`` because
    the extractor only looked for the ``GameStateRequirements`` wrapper.
    """

    def test_sibling_required_textlines_lifted_onto_inspect_point_textlines(self):
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [370001] = {
                        PlayOnce = true,
                        UseText = "UseExamineMisc",
                        Hidden = true,
                        RequiredMinCompletedRuns = 4,
                        RequiredFalseFlags = { "InFlashback" },
                        RequiredTextLines = { "InspectLoungeOpen01" },
                        RequiredFalseTextLines = { "OlympianReunionQuestComplete" },
                        InteractTextLineSets = {
                            InspectCellar01 = { { Text = "An old cellar door." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["InspectCellar01"]
        # Textline-typed requirements feed the dependency graph.
        assert tl["requirements"]["RequiredTextLines"] == ["InspectLoungeOpen01"]
        assert tl["requirements"]["RequiredFalseTextLines"] == ["OlympianReunionQuestComplete"]
        # Non-dialogue requirements are informational metadata.
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4
        assert tl["otherRequirements"]["RequiredFalseFlags"] == ["InFlashback"]

    def test_inspect_point_settings_are_not_treated_as_requirements(self):
        """Plain inspect-point settings (``PlayOnce``, ``UseText``,
        ``Hidden``) sit alongside requirement fields on the inspect-point
        table; only ``Required*`` / count-based fields should be lifted."""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [424963] = {
                        PlayOnce = true,
                        UseText = "UseExamineMisc",
                        Hidden = true,
                        RequiredMinCompletedRuns = 4,
                        InteractTextLineSets = {
                            InspectEmployeeOfTheMonth01 = { { Text = "x" } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["InspectEmployeeOfTheMonth01"]
        assert "PlayOnce" not in tl["otherRequirements"]
        assert "UseText" not in tl["otherRequirements"]
        assert "Hidden" not in tl["otherRequirements"]
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4

    def test_sibling_form_combines_with_explicit_gamestate_requirements_block(self):
        """Both patterns can coexist on the same node: union them so both
        gates apply. (Doesn't appear in shipping data, but the helper
        supports it for forward-compatibility.)"""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [555] = {
                        RequiredMinCompletedRuns = 4,
                        GameStateRequirements = {
                            RequiredTextLines = { "PrereqA" }
                        },
                        InteractTextLineSets = {
                            L = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["L"]
        assert tl["requirements"]["RequiredTextLines"] == ["PrereqA"]
        assert tl["otherRequirements"]["RequiredMinCompletedRuns"] == 4

    def test_explicit_textline_requirement_wins_over_ancestor(self):
        """A textline that declares its own value for a requirement key
        should keep it instead of inheriting the ancestor's value."""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [777] = {
                        RequiredTextLines = { "AncestorReq" },
                        InteractTextLineSets = {
                            L = {
                                RequiredTextLines = { "OwnReq" },
                                { Text = "..." }
                            }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["L"]
        assert tl["requirements"]["RequiredTextLines"] == ["OwnReq"]

    def test_inner_inspect_point_reqs_replace_outer_block_reqs(self):
        """Replace-on-encounter: an inner block declaring its own reqs
        fully overrides an outer block's reqs (each level gates only its
        own subtree)."""
        lua = '''DeathLoopData = {
            DeathArea = {
                RequiredTextLines = { "OuterReq" },
                InspectPoints = {
                    [999] = {
                        RequiredTextLines = { "InnerReq" },
                        InteractTextLineSets = {
                            L = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["L"]
        assert tl["requirements"]["RequiredTextLines"] == ["InnerReq"]

    def test_inspect_point_without_requirements_unchanged(self):
        """Inspect points with no requirement fields should produce
        textlines with empty ``requirements`` / ``otherRequirements``."""
        lua = '''DeathLoopData = {
            DeathArea = {
                InspectPoints = {
                    [100] = {
                        PlayOnce = true,
                        InteractTextLineSets = {
                            L = { { Text = "..." } }
                        }
                    }
                }
            }
        }'''
        result = extract(lua)
        tl = result["Storyteller"]["InteractTextLineSets"]["L"]
        assert tl["requirements"] == {}
        assert tl["otherRequirements"] == {}


    def test_multiple_textline_sets_under_same_owner_table_merged(self):
        """Defensive merge: if two TextLineSet sections somehow end up
        flagged under the same owner name, both textlines must survive."""
        lua = '''DeathLoopData = {
            DeathArea = {
                Section = {
                    TextLineSet = { LineA = { { Text = "a" } } }
                },
                OtherSection = {
                    TextLineSet = { LineB = { { Text = "b" } } }
                }
            }
        }'''
        result = extract(lua)
        # Both should be extracted (no collisions because Section/OtherSection
        # are different non-generic names).
        assert "DeathArea_Section" in result
        assert "DeathArea_OtherSection" in result
        assert "LineA" in result["DeathArea_Section"]["TextLineSet"]
        assert "LineB" in result["DeathArea_OtherSection"]["TextLineSet"]
