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


class TestSectionKeyAudit:
    """audit_textline_section_keys surfaces owner-level keys that look like
    textline-set containers but aren't in the per-game allowlist - so
    silently-dropped textlines can't slip past us when a new game update
    renames or adds a container."""

    def test_audit_empty_when_all_keys_in_allowlist(self):
        from src.extractors.textline_set import audit_textline_section_keys
        from src.extractors.hades1 import HADES1_TEXTLINE_SECTION_KEYS

        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = { L = { { Text = "x" } } },
                GiftTextLineSets = { G = { { Text = "y" } } }
            }
        }'''
        result = audit_textline_section_keys(parse(lua), HADES1_TEXTLINE_SECTION_KEYS)
        assert result == set()

    def test_audit_flags_new_section_shaped_key(self):
        from src.extractors.textline_set import audit_textline_section_keys
        from src.extractors.hades1 import HADES1_TEXTLINE_SECTION_KEYS

        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                BrandNewBossBanterTextLineSets = { L = { { Text = "x" } } }
            }
        }'''
        result = audit_textline_section_keys(parse(lua), HADES1_TEXTLINE_SECTION_KEYS)
        assert "BrandNewBossBanterTextLineSets" in result

    def test_audit_does_not_flag_known_requirement_fields(self):
        from src.extractors.textline_set import audit_textline_section_keys
        from src.extractors.hades1 import HADES1_TEXTLINE_SECTION_KEYS

        # RequiredMinAnyTextLines matches the section-key regex but is a
        # requirement field - must be excluded from the section audit.
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    L = {
                        RequiredMinAnyTextLines = {
                            TextLines = { "A" },
                            Count = 1
                        }
                    }
                }
            }
        }'''
        result = audit_textline_section_keys(parse(lua), HADES1_TEXTLINE_SECTION_KEYS)
        assert "RequiredMinAnyTextLines" not in result

    def test_audit_skips_keys_without_named_table_values(self):
        """A `TextLines` key whose value is a flat list of strings (i.e. the
        inner field of a count-based requirement) must not be flagged as a
        container."""
        from src.extractors.textline_set import audit_textline_section_keys
        from src.extractors.hades1 import HADES1_TEXTLINE_SECTION_KEYS

        lua = '''X = { Y = { TextLines = { "A", "B" } } }'''
        result = audit_textline_section_keys(parse(lua), HADES1_TEXTLINE_SECTION_KEYS)
        assert "TextLines" not in result


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
