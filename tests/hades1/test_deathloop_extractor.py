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

    def test_inspect_point_owner_naming(self):
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
        assert "InspectPoint_370001" in result
        # The id-only key form must NOT also be emitted (regression for the
        # double-descent bug where each inspect-point was visited twice).
        assert "370001" not in result

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
        line = result["InspectPoint_123"]["InteractTextLineSets"]["Line01"]
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
        line = result["InspectPoint_123"]["InteractTextLineSets"]["Line01"]
        assert line["dialogueLines"][0]["speaker"] == "NPC_Hades_01"


class TestNonInspectPointOwners:
    """Numeric-id entries in non-InspectPoints maps still get a prefixed name."""

    def test_obstacle_data_numeric_id(self):
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
        assert "ObstacleData_310036" in result
        line = result["ObstacleData_310036"]["OnUsedTextLineSets"]["Flashback_Mother_01"]
        assert line["dialogueLines"][0]["speaker"] == "Storyteller"

    def test_multiple_inspect_point_maps_under_different_death_areas(self):
        """The walker must handle InspectPoints reappearing under multiple
        death areas; each numeric id should be tagged once and only once."""
        lua = '''DeathLoopData = {
            AreaA = {
                InspectPoints = {
                    [111] = { InteractTextLineSets = { L = { { Text = "a" } } } }
                }
            },
            AreaB = {
                InspectPoints = {
                    [222] = { InteractTextLineSets = { L2 = { { Text = "b" } } } }
                }
            }
        }'''
        result = extract(lua)
        assert "InspectPoint_111" in result
        assert "InspectPoint_222" in result


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
        assert result["InspectPoint_42"]["source"] == "Hades 1"
        line = result["InspectPoint_42"]["InteractTextLineSets"]["L"]
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
        tl = result["InspectPoint_370001"]["InteractTextLineSets"]["InspectCellar01"]
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
        tl = result["InspectPoint_424963"]["InteractTextLineSets"]["InspectEmployeeOfTheMonth01"]
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
        tl = result["InspectPoint_555"]["InteractTextLineSets"]["L"]
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
        tl = result["InspectPoint_777"]["InteractTextLineSets"]["L"]
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
        tl = result["InspectPoint_999"]["InteractTextLineSets"]["L"]
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
        tl = result["InspectPoint_100"]["InteractTextLineSets"]["L"]
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
