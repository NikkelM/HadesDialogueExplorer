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


class TestChoicePromptDialogueLine:
    """The cue that declares ``Choices = {...}`` is the runtime branch
    point. It must be surfaced on the parent's dialogueLines list with
    a ``kind: "choicePrompt"`` marker plus a per-option ``{internal,
    targetTextline}`` list, so the viewer can render it as a structured
    choice block (Choice: … / A: … / B: …) instead of a plain dialogue
    line. Regular non-choice cues must NOT carry the marker."""

    def test_prompt_cue_emits_choice_prompt_kind(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        parent = result["NPC_X_01"]["InteractTextLineSets"]["ParentLine"]
        prompts = [d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt"]
        assert len(prompts) == 1
        assert prompts[0]["text"] == "ChoicePromptKey"

    def test_prompt_carries_internal_and_target_per_option(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        parent = result["NPC_X_01"]["InteractTextLineSets"]["ParentLine"]
        prompt = next(d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt")
        assert prompt["choices"] == [
            {"internal": "Go", "targetTextline": "ParentLineGo"},
            {"internal": "Back", "targetTextline": "ParentLineBack"},
        ]

    def test_non_choice_cue_has_no_choice_prompt_marker(self):
        result = extract_npc_data(parse(make_parent_with_choices()))
        parent = result["NPC_X_01"]["InteractTextLineSets"]["ParentLine"]
        # The "Pick one." cue is a normal dialogue line; it must not be
        # marked as a choice prompt.
        pick = next(d for d in parent["dialogueLines"] if d["text"] == "Pick one.")
        assert "kind" not in pick
        assert "choices" not in pick

    def test_choice_with_no_choice_text_is_omitted_from_prompt_choices(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    P = {
                        { Text = "Prompt",
                          Choices = {
                              { ChoiceText = "A", { Text = "a-cue" } },
                              { { Cue = "/VO/B", Text = "no choice text" } },
                          },
                        },
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua))
        parent = result["NPC_X_01"]["InteractTextLineSets"]["P"]
        prompt = next(d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt")
        # Only the well-formed choice surfaces; the malformed sibling is dropped.
        assert prompt["choices"] == [{"internal": "A", "targetTextline": "PA"}]


class TestPresetChoiceReference:
    """Boon-vendor cues use ``Choices = PresetEventArgs.<Name>`` rather
    than inline ``Choices = {...}``. The Lua parser yields a
    ``LuaIdentifier`` for the reference; the extractor must resolve
    those references against the supplied ``preset_choices`` map and
    emit a ``choicePrompt`` line with ``targetTextline = None`` (no
    follow-up dialogue) for each entry."""

    PRESET_LUA = '''UnitSetData.NPCs = {
        NPC_Eurydice_01 = {
            InteractTextLineSets = {
                EurydiceGoodbye = {
                    { Cue = "/VO/Eurydice_0076",
                      Text = "Here, how about a treat?" },
                    { Text = "Eurydice_OfferText02",
                      Choices = PresetEventArgs.EurydiceBenefitChoices,
                      PreLineFunctionName = "ShowUIForDecision" },
                }
            }
        }
    }'''

    PRESETS = {
        "EurydiceBenefitChoices": [
            "ChoiceText_BuffSlottedBoonRarity",
            "ChoiceText_BuffMegaPom",
            "ChoiceText_BuffFutureBoonRarity",
        ],
    }

    def test_preset_reference_emits_choice_prompt(self):
        result = extract_npc_data(parse(self.PRESET_LUA), preset_choices=self.PRESETS)
        parent = result["NPC_Eurydice_01"]["InteractTextLineSets"]["EurydiceGoodbye"]
        prompts = [d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt"]
        assert len(prompts) == 1
        assert prompts[0]["text"] == "Eurydice_OfferText02"

    def test_preset_choices_carry_null_target_textline(self):
        """Boon-vendor choices grant the benefit via a function call -
        they don't branch into a follow-up textline. ``targetTextline``
        must be ``None`` so the viewer renders the option without a
        clickable link."""
        result = extract_npc_data(parse(self.PRESET_LUA), preset_choices=self.PRESETS)
        parent = result["NPC_Eurydice_01"]["InteractTextLineSets"]["EurydiceGoodbye"]
        prompt = next(d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt")
        assert prompt["choices"] == [
            {"internal": "ChoiceText_BuffSlottedBoonRarity",  "targetTextline": None},
            {"internal": "ChoiceText_BuffMegaPom",            "targetTextline": None},
            {"internal": "ChoiceText_BuffFutureBoonRarity",   "targetTextline": None},
        ]

    def test_preset_reference_without_map_falls_through_as_plain_line(self):
        """When ``preset_choices`` is omitted (or doesn't contain the
        referenced preset), the cue renders as a normal dialogue line -
        no ``choicePrompt`` marker, no synthetic targets, but the cue
        text itself is preserved."""
        result = extract_npc_data(parse(self.PRESET_LUA))
        parent = result["NPC_Eurydice_01"]["InteractTextLineSets"]["EurydiceGoodbye"]
        prompts = [d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt"]
        assert prompts == []
        # Cue text is still in the dialogueLines list.
        texts = [d["text"] for d in parent["dialogueLines"]]
        assert "Eurydice_OfferText02" in texts

    def test_preset_reference_does_not_create_synthetic_children(self):
        """Unlike inline ``Choices = {...}`` which materialises one
        synthetic sibling per option, preset-referenced choices must
        not spawn any synthetic textlines - they wouldn't be reachable
        in-game (the engine never records a textline flag for them)."""
        result = extract_npc_data(parse(self.PRESET_LUA), preset_choices=self.PRESETS)
        section = result["NPC_Eurydice_01"]["InteractTextLineSets"]
        # Only the parent textline should exist.
        assert list(section.keys()) == ["EurydiceGoodbye"]

    def test_preset_dict_entry_passes_required_meta_upgrade(self):
        """Preset entries may be ``dict`` records that carry extra
        metadata (e.g. ``requiredMetaUpgrade`` for Patroclus's gated
        choices). The extractor must pass any non-``id`` keys through
        verbatim to the emitted choice dict so the viewer can use them
        for grouping / tooltip annotations."""
        presets = {
            "GatedChoices": [
                {"id": "ChoiceText_A", "requiredMetaUpgrade": "UpgradeOne"},
                {"id": "ChoiceText_B", "requiredMetaUpgrade": "UpgradeTwo"},
                "ChoiceText_C",
            ],
        }
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    P = {
                        { Text = "Prompt",
                          Choices = PresetEventArgs.GatedChoices },
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua), preset_choices=presets)
        parent = result["NPC_X_01"]["InteractTextLineSets"]["P"]
        prompt = next(d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt")
        assert prompt["choices"] == [
            {"internal": "ChoiceText_A", "targetTextline": None,
             "requiredMetaUpgrade": "UpgradeOne"},
            {"internal": "ChoiceText_B", "targetTextline": None,
             "requiredMetaUpgrade": "UpgradeTwo"},
            {"internal": "ChoiceText_C", "targetTextline": None},
        ]

    def test_preset_dict_entry_without_id_is_skipped(self):
        """A malformed dict entry (no ``id`` field, or non-string id) is
        silently dropped rather than producing an option with no
        identifier - mirrors the inline-choice behaviour for missing
        ``ChoiceText``."""
        presets = {
            "MalformedChoices": [
                "ChoiceText_Good",
                {"requiredMetaUpgrade": "X"},          # no id
                {"id": "", "requiredMetaUpgrade": "Y"}, # empty id
                {"id": 42},                             # non-string id
            ],
        }
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    P = {
                        { Text = "Prompt",
                          Choices = PresetEventArgs.MalformedChoices },
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua), preset_choices=presets)
        parent = result["NPC_X_01"]["InteractTextLineSets"]["P"]
        prompt = next(d for d in parent["dialogueLines"] if d.get("kind") == "choicePrompt")
        assert prompt["choices"] == [
            {"internal": "ChoiceText_Good", "targetTextline": None},
        ]


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
