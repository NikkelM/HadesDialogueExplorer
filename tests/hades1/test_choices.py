"""Tests for synthetic choice-variant textlines.

When a textline contains a cue with a `Choices = {...}` array, the engine
records a flag of the form `<ParentTextline><ChoiceText>` if the player
picks that choice. Those concatenated names appear in other textlines'
requirements. The extractor surfaces each choice as a synthetic sibling
textline so the dependency graph resolves cleanly.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data
from src.graph import build_graph_data, resolve_duplicate


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


def make_parent_with_choices(extra_choice_fields="", extra_inner_cues=""):
    """A parent textline with two choices ("Go", "Back")."""
    return f'''UnitSetData.NPCs = {{
        NPC_X_01 = {{
            InteractTextLineSets = {{
                ParentLine = {{
                    PlayOnce = true,
                    {{ Speaker = "CharProtag", Text = "Pick one." }},
                    {{ Text = "ChoicePromptKey",
                       Choices = {{
                           {{ ChoiceText = "Go",
                             {extra_choice_fields}
                             {{ Cue = "/VO/Go1", Text = "Going" }},
                             {{ Cue = "/VO/Go2", Text = "Onward" }},
                             {extra_inner_cues}
                           }},
                           {{ ChoiceText = "Back",
                             {{ Cue = "/VO/Back1", Text = "Backing off" }},
                           }},
                       }},
                    }},
                }}
            }}
        }}
    }}'''


class TestChoiceVariantExtraction:
    def test_synthetic_textlines_have_concatenated_names(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        section = result["NPC_X_01"]["InteractTextLineSets"]
        assert "ParentLineGo" in section
        assert "ParentLineBack" in section

    def test_synthetic_textline_carries_metadata(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        assert go["parentTextline"] == "ParentLine"
        assert go["choiceText"] == "Go"
        assert go["isSynthetic"] is True

    def test_synthetic_textline_has_implicit_parent_dependency(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        assert go["requirements"]["RequiredTextLines"] == ["ParentLine"]

    def test_synthetic_textline_includes_inner_cues_as_dialogue(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        texts = [d["text"] for d in go["dialogueLines"]]
        assert texts == ["Going", "Onward"]

    def test_choice_level_requirements_are_preserved(self):
        """If a Choice item carries its own requirements they must NOT be
        dropped just because we add an implicit parent dep."""
        lua = make_parent_with_choices(
            extra_choice_fields='RequiredFalseTextLines = { "SomeFlag" },'
        )
        result = extract_npc_data(parse(lua))
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        assert go["requirements"]["RequiredFalseTextLines"] == ["SomeFlag"]
        # And the implicit parent dep is still there.
        assert "ParentLine" in go["requirements"]["RequiredTextLines"]

    def test_parent_dep_not_duplicated_if_already_present(self):
        """If a Choice already lists the parent explicitly, the implicit
        dep must not produce ['Parent', 'Parent']."""
        lua = make_parent_with_choices(
            extra_choice_fields='RequiredTextLines = { "ParentLine" },'
        )
        result = extract_npc_data(parse(lua))
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        assert go["requirements"]["RequiredTextLines"] == ["ParentLine"]

    def test_synthetic_source_line_points_to_choice_item(self):
        result = extract_npc_data(parse(make_parent_with_choices()), source_file="Test.lua")
        go = result["NPC_X_01"]["InteractTextLineSets"]["ParentLineGo"]
        parent = result["NPC_X_01"]["InteractTextLineSets"]["ParentLine"]
        assert go["sourceFile"] == "Test.lua"
        # The synthetic source line must be inside the parent block but
        # distinct from the parent's opening line.
        assert go["sourceLine"] is not None and go["sourceLine"] > parent["sourceLine"]

    def test_choice_with_no_choice_text_is_skipped(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    P = {
                        { Text = "Prompt",
                          Choices = {
                              { { Cue = "/VO/A", Text = "no choice text" } },
                          },
                        },
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        # Only the parent should exist - the choice with no ChoiceText must not
        # produce a synthetic with name == "P" (which would clobber the parent).
        section = result["NPC_X_01"]["InteractTextLineSets"]
        assert list(section.keys()) == ["P"]

    def test_parent_textline_unaffected_by_choice_inner_cues(self):
        """The parent's dialogueLines should only include its own top-level
        cues, not the inner cues of any Choice item."""
        result = extract_npc_data(parse(make_parent_with_choices()))
        parent = result["NPC_X_01"]["InteractTextLineSets"]["ParentLine"]
        texts = [d["text"] for d in parent["dialogueLines"]]
        # The parent's array has: "Pick one." cue, and the Choices-bearing
        # cue with Text="ChoicePromptKey". The choice item's inner cues
        # ("Going", "Onward", "Backing off") must NOT appear.
        assert "Going" not in texts
        assert "Backing off" not in texts
        assert "Pick one." in texts


class TestSyntheticVsRealCollision:
    """A real textline always wins against a synthetic one regardless of
    richness, because a real definition is authoritative."""

    def test_real_beats_synthetic_even_with_less_content(self):
        real = {
            "name": "X",
            "owner": "R",
            "section": "InteractTextLineSets",
            "source": "Hades 1",
            "requirements": {},
            "otherRequirements": {},
            "dialogueLines": [],  # empty - less rich
        }
        synthetic = {
            "name": "X",
            "owner": "S",
            "section": "InteractTextLineSets",
            "source": "Hades 1",
            "requirements": {"RequiredTextLines": ["Parent"]},
            "otherRequirements": {},
            "dialogueLines": [{"speaker": "Z", "text": "a"}, {"speaker": "Z", "text": "b"}],
            "isSynthetic": True,
        }
        kept, dropped = resolve_duplicate(real, synthetic)
        assert kept is real and dropped is synthetic

    def test_real_beats_synthetic_when_synthetic_first(self):
        synthetic = {
            "name": "X", "owner": "S", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {}, "otherRequirements": {}, "dialogueLines": [],
            "isSynthetic": True,
        }
        real = {
            "name": "X", "owner": "R", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {}, "otherRequirements": {}, "dialogueLines": [],
        }
        kept, dropped = resolve_duplicate(synthetic, real)
        assert kept is real and dropped is synthetic

    def test_two_synthetics_use_first_wins(self):
        first = {
            "name": "X", "owner": "A", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {}, "otherRequirements": {},
            "dialogueLines": [{"speaker": "Z", "text": "a"}],
            "isSynthetic": True,
        }
        second = {
            "name": "X", "owner": "B", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {}, "otherRequirements": {},
            "dialogueLines": [
                {"speaker": "Z", "text": "a"}, {"speaker": "Z", "text": "b"},
                {"speaker": "Z", "text": "c"},
            ],
            "isSynthetic": True,
        }
        # Richness still applies between two synthetics; second is richer.
        kept, _ = resolve_duplicate(first, second)
        assert kept is second

    def test_two_reals_use_richness(self):
        a = {
            "name": "X", "owner": "A", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {}, "otherRequirements": {}, "dialogueLines": [],
        }
        b = {
            "name": "X", "owner": "B", "section": "InteractTextLineSets", "source": "Hades 1",
            "requirements": {"RequiredTextLines": ["Y"]}, "otherRequirements": {},
            "dialogueLines": [{"speaker": "Z", "text": "a"}],
        }
        kept, _ = resolve_duplicate(a, b)
        assert kept is b


class TestGraphPreservesChoiceMetadata:
    def test_synthetic_fields_round_trip_through_build_graph_data(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        graph = build_graph_data(result)
        go = graph["textlines"]["ParentLineGo"]
        assert go["parentTextline"] == "ParentLine"
        assert go["choiceText"] == "Go"
        assert go["isSynthetic"] is True

    def test_parent_textline_lacks_synthetic_marker(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        graph = build_graph_data(result)
        parent = graph["textlines"]["ParentLine"]
        assert "isSynthetic" not in parent
        assert "parentTextline" not in parent
