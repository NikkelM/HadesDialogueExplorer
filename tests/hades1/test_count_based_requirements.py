"""Tests for count-based requirement extraction and the string-value /
ThisRoom variants. These all exercise ``extract_textline`` via the H1
NPC extractor; they cover the specific field shapes that needed extra
handling on top of the simple ``Required* = { ... }`` list pattern."""

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data


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


class TestRequiredFieldShapeVariants:
    """A handful of Required* fields appear with non-list shapes; these
    tests pin the extractor's handling of each variant so a regression
    in ``_to_string_list`` or ``extract_textline`` is caught."""

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


class TestSectionKeysRequired:
    """extract_textline_sections requires the per-game ``section_keys``
    allowlist - calling it without one is a programming error and must
    fail loudly rather than silently extract nothing."""

    def test_extract_textline_sections_requires_section_keys_kwarg(self):
        import pytest
        from src.extractors.textline_set import extract_textline_sections
        from src.lua_parser import LuaTable

        with pytest.raises(TypeError):
            extract_textline_sections("Owner", LuaTable(), "Source.lua")
