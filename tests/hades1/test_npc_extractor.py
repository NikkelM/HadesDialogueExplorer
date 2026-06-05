"""Tests for the NPCData extractor."""

import pytest

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data


def extract(lua_text, source="Test", source_file=""):
    """Helper: parse Lua text and extract NPC data."""
    parsed = LuaParser(lua_text).parse_file()
    return extract_npc_data(parsed, source_label=source, source_file=source_file)


class TestBasicExtraction:
    def test_empty_input_returns_empty(self):
        assert extract("") == {}

    def test_input_without_npcs_returns_empty(self):
        assert extract('X = { something = "else" }') == {}

    def test_single_npc_under_unitsetdata(self):
        lua = '''UnitSetData.NPCs = {
            NPC_Test_01 = {
                InteractTextLineSets = {
                    TestLine01 = { { Text = "Hi" } }
                }
            }
        }'''
        result = extract(lua)
        assert "NPC_Test_01" in result
        assert result["NPC_Test_01"]["source"] == "Test"

    def test_source_label_propagated(self):
        lua = 'UnitSetData.NPCs = { NPC_X_01 = { InteractTextLineSets = {} } }'
        result = extract(lua, source="Hades 1")
        assert result["NPC_X_01"]["source"] == "Hades 1"


class TestContainerDiscovery:
    """The NPCs container is normally pinned to the exact key
    ``UnitSetData.NPCs`` (matching the explicit-allowlist style used by
    the Enemy/Loot/DeathLoop extractors). A loose substring scan stays
    in place as a fallback for files using a non-standard container
    name, but the pinned key must always win when both are present so
    an unrelated table with ``NPC`` in its key cannot hijack
    discovery."""

    def test_pinned_key_wins_over_decoy_with_npc_substring(self):
        # Decoy declared first (so a first-match loose scan would pick
        # it up). The pinned key must still win.
        lua = '''SomeNPCAddon = {
            NPC_Decoy_01 = { InteractTextLineSets = { D = { { Text = "decoy" } } } }
        }
        UnitSetData.NPCs = {
            NPC_Real_01 = { InteractTextLineSets = { R = { { Text = "real" } } } }
        }'''
        result = extract(lua)
        assert "NPC_Real_01" in result
        assert "NPC_Decoy_01" not in result

    def test_fallback_scan_still_finds_npcs_under_nonstandard_key(self):
        """If a future file uses a different container name, the loose
        scan should still discover it - guards against the pin being
        too strict."""
        lua = '''SomeOtherNPCContainer = {
            NPC_Fallback_01 = { InteractTextLineSets = { L = { { Text = "fb" } } } }
        }'''
        result = extract(lua)
        assert "NPC_Fallback_01" in result


class TestSourceLocation:
    """Each textline should record the file and line where it is defined."""

    def test_source_file_propagated_to_textline(self):
        lua = (
            "UnitSetData.NPCs = {\n"
            "    NPC_Test_01 = {\n"
            "        InteractTextLineSets = {\n"
            "            Line01 = { { Text = \"Hi\" } }\n"
            "        }\n"
            "    }\n"
            "}\n"
        )
        result = extract(lua, source_file="NPCData.lua")
        tl = result["NPC_Test_01"]["InteractTextLineSets"]["Line01"]
        assert tl["sourceFile"] == "NPCData.lua"

    def test_source_line_matches_opening_brace(self):
        lua = (
            "UnitSetData.NPCs = {\n"          # line 1
            "    NPC_Test_01 = {\n"           # line 2
            "        InteractTextLineSets = {\n"   # line 3
            "            LineA = {\n"          # line 4 - opening brace of textline
            "                { Text = \"a\" },\n"
            "            },\n"
            "            LineB = {\n"          # line 7
            "                { Text = \"b\" },\n"
            "            },\n"
            "        }\n"
            "    }\n"
            "}\n"
        )
        result = extract(lua, source_file="NPCData.lua")
        section = result["NPC_Test_01"]["InteractTextLineSets"]
        assert section["LineA"]["sourceLine"] == 4
        assert section["LineB"]["sourceLine"] == 7

    def test_source_file_defaults_to_empty(self):
        lua = 'UnitSetData.NPCs = { NPC_X_01 = { InteractTextLineSets = { L = { { Text = "x" } } } } }'
        result = extract(lua)
        tl = result["NPC_X_01"]["InteractTextLineSets"]["L"]
        assert tl["sourceFile"] == ""


class TestSpeakerAttribution:
    """Regression tests for the speaker-attribution bug (issue #13)."""

    def test_dialogue_speaker_defaults_to_npc(self):
        lua = '''UnitSetData.NPCs = {
            NPC_Orpheus_01 = {
                InteractTextLineSets = {
                    OrpheusLine01 = {
                        { Text = "Greetings, my lord." }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["NPC_Orpheus_01"]["InteractTextLineSets"]["OrpheusLine01"]
        assert line["dialogueLines"] == [
            {"speaker": "NPC_Orpheus_01", "text": "Greetings, my lord."}
        ]

    def test_explicit_speaker_honored(self):
        lua = '''UnitSetData.NPCs = {
            NPC_Orpheus_01 = {
                InteractTextLineSets = {
                    OrpheusLine01 = {
                        { Speaker = "CharProtag", Text = "Hey Orpheus." }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["NPC_Orpheus_01"]["InteractTextLineSets"]["OrpheusLine01"]
        assert line["dialogueLines"] == [
            {"speaker": "CharProtag", "text": "Hey Orpheus."}
        ]

    def test_mixed_speakers_in_sequence(self):
        lua = '''UnitSetData.NPCs = {
            NPC_Orpheus_01 = {
                InteractTextLineSets = {
                    OrpheusLine01 = {
                        { Speaker = "CharProtag", Text = "Hi." },
                        { Text = "Hello to you too." }
                    }
                }
            }
        }'''
        result = extract(lua)
        lines = result["NPC_Orpheus_01"]["InteractTextLineSets"]["OrpheusLine01"]["dialogueLines"]
        assert lines == [
            {"speaker": "CharProtag", "text": "Hi."},
            {"speaker": "NPC_Orpheus_01", "text": "Hello to you too."},
        ]


class TestRequirementClassification:
    """Regression tests for the RequiredTextLines-as-dialogue bug."""

    def test_required_textlines_classified_as_requirement(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Line01 = {
                        RequiredTextLines = { "PrereqA", "PrereqB" },
                        { Text = "Hi." }
                    }
                }
            }
        }'''
        result = extract(lua)
        line = result["NPC_X_01"]["InteractTextLineSets"]["Line01"]
        assert line["requirements"]["RequiredTextLines"] == ["PrereqA", "PrereqB"]
        assert len(line["dialogueLines"]) == 1
        assert line["dialogueLines"][0]["text"] == "Hi."

    def test_all_textline_req_fields_recognized(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Line01 = {
                        RequiredTextLines = { "A" },
                        RequiredAnyTextLines = { "B" },
                        RequiredFalseTextLines = { "C" },
                        RequiredTextLinesLastRun = { "D" },
                        RequiredFalseTextLinesThisRun = { "E" },
                    }
                }
            }
        }'''
        result = extract(lua)
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["Line01"]["requirements"]
        assert reqs["RequiredTextLines"] == ["A"]
        assert reqs["RequiredAnyTextLines"] == ["B"]
        assert reqs["RequiredFalseTextLines"] == ["C"]
        assert reqs["RequiredTextLinesLastRun"] == ["D"]
        assert reqs["RequiredFalseTextLinesThisRun"] == ["E"]

    def test_other_requirements_captured(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Line01 = {
                        RequiredMinCompletedRuns = 3,
                        RequiredCue = "SomeCue",
                        { Text = "Hi." }
                    }
                }
            }
        }'''
        result = extract(lua)
        other = result["NPC_X_01"]["InteractTextLineSets"]["Line01"]["otherRequirements"]
        assert other["RequiredMinCompletedRuns"] == 3
        assert other["RequiredCue"] == "SomeCue"


class TestSectionDiscovery:
    """All *TextLineSets sections should be discovered dynamically."""

    def test_gift_textline_sets_discovered(self):
        lua = '''UnitSetData.NPCs = {
            NPC_Orpheus_01 = {
                GiftTextLineSets = {
                    OrpheusGift01 = { { Text = "Thanks!" } }
                }
            }
        }'''
        result = extract(lua)
        npc = result["NPC_Orpheus_01"]
        assert "GiftTextLineSets" in npc
        assert "OrpheusGift01" in npc["GiftTextLineSets"]

    def test_multiple_section_types_in_one_npc(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = { A = { { Text = "a" } } },
                RepeatableTextLineSets = { B = { { Text = "b" } } },
                GiftTextLineSets = { C = { { Text = "c" } } },
                BossPresentationTextLineSets = { D = { { Text = "d" } } },
            }
        }'''
        result = extract(lua)
        npc = result["NPC_X_01"]
        assert "InteractTextLineSets" in npc
        assert "RepeatableTextLineSets" in npc
        assert "GiftTextLineSets" in npc
        assert "BossPresentationTextLineSets" in npc


class TestTextProcessing:
    def test_formatting_tags_stripped(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Line01 = {
                        { Text = "{#DialogueItalicFormat}A whispered note." }
                    }
                }
            }
        }'''
        result = extract(lua)
        text = result["NPC_X_01"]["InteractTextLineSets"]["Line01"]["dialogueLines"][0]["text"]
        assert text == "A whispered note."

    def test_entry_without_text_ignored(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Line01 = {
                        { Cue = "/SFX/Whatever" },
                        { Text = "Hi." }
                    }
                }
            }
        }'''
        result = extract(lua)
        lines = result["NPC_X_01"]["InteractTextLineSets"]["Line01"]["dialogueLines"]
        assert len(lines) == 1
        assert lines[0]["text"] == "Hi."
