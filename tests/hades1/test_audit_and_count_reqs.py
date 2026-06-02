"""Tests for the requirement-field audit and count-based requirement
extraction added when wiring up LootData / EnemyData / DeathLoopData."""

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data
from src.extractors.textline_set import audit_requirement_fields


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestCountBasedRequirements:
    """Fields shaped { TextLines = {...}, Count = N } must contribute a
    dependency edge for each referenced textline."""

    def test_required_min_any_textlines_extracts_inner_textline_list(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredMinAnyTextLines = {
                            TextLines = { "A", "B", "C" },
                            Count = 2
                        }
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredMinAnyTextLines"] == ["A", "B", "C"]

    def test_count_field_preserved_in_other_requirements(self):
        """The Count metadata should still be visible to the viewer via
        otherRequirements (without re-listing the TextLines field there)."""
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredMinAnyTextLines = {
                            TextLines = { "A" },
                            Count = 2
                        }
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        other = result["NPC_X_01"]["InteractTextLineSets"]["L"]["otherRequirements"]
        assert other["RequiredMinAnyTextLines"] == {"Count": 2}

    def test_min_runs_since_any_textlines_also_extracted(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        MinRunsSinceAnyTextLines = {
                            TextLines = { "X", "Y" },
                            Count = 4
                        }
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["MinRunsSinceAnyTextLines"] == ["X", "Y"]


class TestNewlyRecognizedRequiredFields:
    """The audit surfaced previously-unhandled Required*TextLine* fields."""

    def test_required_queued_textlines_string_value(self):
        """`RequiredQueuedTextLines = "Name"` (a single string, not a list)
        should still produce a dependency edge."""
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredQueuedTextLines = "SomeOtherLine"
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredQueuedTextLines"] == ["SomeOtherLine"]

    def test_required_text_lines_this_room(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredTextLinesThisRoom = { "A", "B" },
                        RequiredFalseTextLinesThisRoom = { "C" }
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredTextLinesThisRoom"] == ["A", "B"]
        assert reqs["RequiredFalseTextLinesThisRoom"] == ["C"]


class TestRequirementAudit:
    """audit_requirement_fields walks the tree and surfaces any
    Required.*TextLine.* field we don't know about - so new data files
    can't silently drop dependency edges."""

    def test_audit_returns_empty_for_known_fields(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredTextLines = { "A" },
                        RequiredAnyTextLines = { "B" },
                        RequiredFalseTextLines = { "C" }
                    }
                }
            }
        }'''
        assert audit_requirement_fields(parse(lua)) == set()

    def test_audit_surfaces_unknown_required_textline_field(self):
        lua = '''X = {
            Y = {
                RequiredCompletelyMadeUpTextLineField = { "z" }
            }
        }'''
        unknown = audit_requirement_fields(parse(lua))
        assert "RequiredCompletelyMadeUpTextLineField" in unknown

    def test_audit_ignores_game_data_typo(self):
        """`RequiredTextLinesThis` is a typo in NPCData.lua (truncated form
        of `RequiredTextLinesThisRun`). It is listed in
        REQ_TEXTLINE_FIELD_IGNORES so the audit must not flag it."""
        lua = '''X = { Y = { RequiredTextLinesThis = { "z" } } }'''
        assert "RequiredTextLinesThis" not in audit_requirement_fields(parse(lua))
