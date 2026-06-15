"""Tests for the H2 textline-set walker.

Covers the per-textline output contract that the graph builder consumes:

* ``GameStateRequirements`` -> ``requirements`` / ``otherRequirements``
  via the shared :func:`.req_extractor.extract_requirements`.
* ``PlayOnce = true`` -> ``playOnce`` flag.
* ``Partner = "..."`` -> ``partner`` field (Hades II still uses the
  ``Partner`` declaration on the canonical side).
* Cue array -> ``dialogueLines`` with format tags stripped.
* Cue speaker resolution precedence: ``UsePlayerSource`` ->
  ``PlayerUnit`` > explicit ``Speaker`` > owner fallback.
* Empty ``orBranches`` / ``flags`` containers are dropped (so the
  output stays clean for the common-case textline that has no OR or
  flags).
* Multiple ``RequirementSet``-bearing fields on a single textline
  merge their dialogue edges (union, de-duplicated) into the same
  ``requirements`` bucket.
* Sections outside the per-game allowlist are silently ignored.
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.textline_set import (
    PLAYER_SPEAKER_ID,
    extract_textline,
    extract_textline_sections,
)


def _parse_textline(lua_text):
    """Parse ``T = { ... }`` and return the LuaTable value of ``T``."""
    parsed = LuaParser(f"T = {lua_text}").parse_file()
    return parsed["T"]


def _parse_owner(lua_text):
    """Parse ``O = { ... }`` and return the LuaTable value of ``O``."""
    parsed = LuaParser(f"O = {lua_text}").parse_file()
    return parsed["O"]


class TestEmptyTextline:
    def test_minimal_textline(self):
        tl = _parse_textline("{ }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["requirements"] == {}
        assert data["otherRequirements"] == {}
        assert data["dialogueLines"] == []
        assert data["sourceFile"] == "Test.lua"
        assert "playOnce" not in data
        assert "partner" not in data
        # Empty orBranches / flags containers stripped.
        assert "orBranches" not in data
        assert "flags" not in data

    def test_source_line_captured(self):
        tl = _parse_textline("{ }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert isinstance(data["sourceLine"], int)


class TestPlayOnce:
    def test_play_once_true_surfaced(self):
        tl = _parse_textline("{ PlayOnce = true }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["playOnce"] is True

    def test_play_once_absent_no_field(self):
        tl = _parse_textline("{ }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert "playOnce" not in data

    def test_play_once_false_no_field(self):
        # Only `true` surfaces - any other value (including false)
        # leaves the field off.
        tl = _parse_textline("{ PlayOnce = false }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert "playOnce" not in data


class TestPartner:
    def test_partner_string_surfaced(self):
        tl = _parse_textline('{ Partner = "NPC_Other_01" }')
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["partner"] == "NPC_Other_01"

    def test_partner_absent_no_field(self):
        tl = _parse_textline("{ }")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert "partner" not in data

    def test_partner_empty_string_no_field(self):
        tl = _parse_textline('{ Partner = "" }')
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert "partner" not in data


class TestDialogueLines:
    def test_cue_with_text_creates_line(self):
        tl = _parse_textline("""{
            { Cue = "/VO/Artemis_0001", Text = "Hello there." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Artemis_01", "Test.lua")
        assert data["dialogueLines"] == [
            {"speaker": "NPC_Artemis_01", "text": "Hello there."},
        ]

    def test_cue_without_text_skipped(self):
        tl = _parse_textline("""{
            { Cue = "/VO/Artemis_0001" },
            { Cue = "/VO/Artemis_0002", Text = "Second line." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Artemis_01", "Test.lua")
        assert len(data["dialogueLines"]) == 1
        assert data["dialogueLines"][0]["text"] == "Second line."

    def test_format_tags_stripped(self):
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "I am {#Emph}very{#Prev} excited." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["text"] == "I am very excited."

    def test_h1_style_format_tags_also_stripped(self):
        # Same regex matches both H1 and H2 tag vocabularies.
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Wait{#DialogueItalicFormat}wait{#PreviousFormat}!" },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["text"] == "Waitwait!"


class TestSpeakerResolution:
    def test_use_player_source_resolves_to_player(self):
        tl = _parse_textline("""{
            { Cue = "/VO/Mel_0001", UsePlayerSource = true, Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Artemis_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == PLAYER_SPEAKER_ID

    def test_explicit_speaker_used(self):
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Speaker = "Hermes", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == "Hermes"

    def test_owner_fallback_used(self):
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Artemis_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == "NPC_Artemis_01"

    def test_player_source_wins_over_explicit_speaker(self):
        # Engine routes through the player subtitle stream regardless
        # of the explicit Speaker field on the same cue.
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", UsePlayerSource = true, Speaker = "Hermes", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == PLAYER_SPEAKER_ID

    def test_source_field_overrides_owner_fallback(self):
        # Engine attaches the cue to the entity named by ``Source``,
        # which the viewer maps to a canonical speaker via
        # ``HADES2_SPEAKERS``. The owner here is Hecate but Chronos
        # voices the line - matches the real H2 case in
        # ``HecateBossKidnapped01`` where Chronos lines sit inside a
        # textline owned by Hecate.
        tl = _parse_textline("""{
            { Cue = "/VO/Chronos_0973", Source = "NPC_Chronos_01", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Hecate_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == "NPC_Chronos_01"

    def test_explicit_speaker_wins_over_source(self):
        # ``Speaker`` is the explicit subtitle-label override and beats
        # the per-cue ``Source`` actor reference - any real cue that
        # sets both intends the Speaker as the displayed name.
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Speaker = "Hermes", Source = "NPC_Chronos_01", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == "Hermes"

    def test_use_player_source_wins_over_source(self):
        # Even with a non-player ``Source`` set explicitly,
        # ``UsePlayerSource = true`` still routes the cue through the
        # player's subtitle stream (matches the documented engine
        # precedence for the boolean shortcut).
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", UsePlayerSource = true, Source = "NPC_Chronos_01", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["dialogueLines"][0]["speaker"] == PLAYER_SPEAKER_ID


class TestRequirementsRouting:
    def test_textline_path_becomes_dialogue_edge(self):
        tl = _parse_textline("""{
            GameStateRequirements = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "Foo01" } },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["requirements"] == {"RequiredTextLines": ["Foo01"]}
        assert data["otherRequirements"] == {}

    def test_non_textline_path_becomes_other_requirement(self):
        tl = _parse_textline("""{
            GameStateRequirements = {
                { PathTrue = { "CurrentRun", "Hero", "IsDead" } },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["requirements"] == {}
        assert data["otherRequirements"]  # at least one entry

    def test_set_level_flags_propagate(self):
        tl = _parse_textline("""{
            GameStateRequirements = {
                Skip = true,
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["flags"] == {"skip": True}

    def test_or_branches_surface(self):
        tl = _parse_textline("""{
            GameStateRequirements = {
                OrRequirements = {
                    { { Path = { "GameState", "TextLinesRecord" }, HasAll = { "Foo01" } } },
                    { { Path = { "GameState", "TextLinesRecord" }, HasAll = { "Bar01" } } },
                },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert "orBranches" in data
        assert len(data["orBranches"]) == 2

    def test_multiple_requirement_set_fields_merge_edges(self):
        # Both fields are RequirementSet-bearing - their dialogue edges
        # should union into a single ``RequiredTextLines`` bucket.
        tl = _parse_textline("""{
            GameStateRequirements = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A" } },
            },
            SetupGameStateRequirements = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "B" } },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert sorted(data["requirements"]["RequiredTextLines"]) == ["A", "B"]

    def test_merge_deduplicates(self):
        # Same name appearing in two RequirementSet fields collapses.
        tl = _parse_textline("""{
            GameStateRequirements = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A" } },
            },
            SetupGameStateRequirements = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A", "B" } },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert data["requirements"]["RequiredTextLines"] == ["A", "B"]


class TestNamedRequirementsExpansion:
    def test_named_requirements_inline_expanded(self):
        # Set up a tiny registry with one named req containing a
        # textline edge.
        registry_lua = """N = {
            FooDone = {
                { Path = { "GameState", "TextLinesRecord" }, HasAll = { "FooLine" } },
            },
        }"""
        registry_table = LuaParser(registry_lua).parse_file()["N"]
        registry = {"FooDone": registry_table.named["FooDone"]}

        tl = _parse_textline("""{
            GameStateRequirements = {
                NamedRequirements = { "FooDone" },
            },
        }""")
        data = extract_textline(
            "Foo", tl, "NPC_Owner_01", "Test.lua",
            named_requirements=registry,
        )
        assert data["requirements"] == {"RequiredTextLines": ["FooLine"]}


class TestSectionExtraction:
    def test_allowlist_filters_unknown_keys(self):
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Line01 = { },
            },
            NotASection = {
                Bogus = { },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert "InteractTextLineSets" in sections
        assert "NotASection" not in sections

    def test_section_textlines_extracted_via_walker(self):
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Line01 = {
                    PlayOnce = true,
                    { Cue = "/VO/X_0001", Text = "Hello." },
                },
                Line02 = { },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert set(sections["InteractTextLineSets"].keys()) == {"Line01", "Line02"}
        assert sections["InteractTextLineSets"]["Line01"]["playOnce"] is True
        assert sections["InteractTextLineSets"]["Line01"]["dialogueLines"][0]["text"] == "Hello."

    def test_default_speaker_overrides_owner_id(self):
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Line01 = {
                    { Cue = "/VO/X_0001", Text = "Hi." },
                },
            },
        }""")
        sections = extract_textline_sections(
            "HermesUpgrade", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
            default_speaker="NPC_Hermes_01",
        )
        line = sections["InteractTextLineSets"]["Line01"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Hermes_01"

    def test_non_table_section_value_skipped(self):
        # A scalar where a section table would go shouldn't crash.
        owner = _parse_owner("""{
            InteractTextLineSets = true,
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert sections == {}

    def test_non_table_textline_value_skipped(self):
        # A scalar where a textline table would go shouldn't crash.
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Line01 = true,
                Line02 = { { Cue = "/VO/X_0001", Text = "Hi." } },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert set(sections["InteractTextLineSets"].keys()) == {"Line02"}


class TestInlineChoices:
    """Inline ``Choices = {...}`` on cues + synthetic-variant
    expansion.

    H2 NPCs encode branching dialogue as an inline Choices block on a
    "prompt" cue: each option carries a ``ChoiceText`` id plus its
    own positional cue array of follow-up dialogue. The extractor must

    1. attach ``kind: "choicePrompt"`` + a ``choices`` list to the
       prompt cue's dialogue-line entry, with each entry shaped
       ``{ internal: "Choice_<X>", targetTextline: "<parent><Choice_<X>>" }``;
    2. synthesise a child textline per choice option (named
       ``<parent_name><ChoiceText>``, matching the
       ``TextLinesChoiceRecord`` engine key) carrying the follow-up
       cues as its dialogue, plus implicit
       ``RequiredTextLines: [<parent>]`` so the variant is reachable
       only through its parent, plus ``parentTextline`` / ``choiceText``
       / ``isSynthetic = True`` metadata.

    Real (hand-defined) textlines that happen to collide with a
    synthetic name take precedence over the synthetic version
    (forward-compat safety; no real H2 collision exists today).
    """

    def test_cue_choices_attaches_kind_and_choices(self):
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Will you accept?",
              Choices = {
                  { ChoiceText = "Choice_Accept",
                    { Cue = "/VO/X_0002", Text = "I accept." },
                  },
                  { ChoiceText = "Choice_Decline",
                    { Cue = "/VO/X_0003", Text = "I decline." },
                  },
              },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        assert len(data["dialogueLines"]) == 1
        line = data["dialogueLines"][0]
        assert line["kind"] == "choicePrompt"
        assert line["choices"] == [
            {"internal": "Choice_Accept",
             "targetTextline": "FooChoice_Accept"},
            {"internal": "Choice_Decline",
             "targetTextline": "FooChoice_Decline"},
        ]

    def test_cue_without_choices_has_no_choice_attachment(self):
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Hi." },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        line = data["dialogueLines"][0]
        assert "kind" not in line
        assert "choices" not in line

    def test_empty_choices_block_still_flagged_as_prompt(self):
        # An empty Choices = {} block is still a prompt cue
        # structurally; the viewer renders the (empty) options list.
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Ask?", Choices = { } },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        line = data["dialogueLines"][0]
        assert line["kind"] == "choicePrompt"
        assert line["choices"] == []

    def test_choices_missing_choice_text_skipped(self):
        # An entry without a string ChoiceText is silently skipped;
        # the rest are still extracted.
        tl = _parse_textline("""{
            { Cue = "/VO/X_0001", Text = "Ask?",
              Choices = {
                  { { Cue = "/VO/X_0002", Text = "no label" } },
                  { ChoiceText = "Choice_Accept",
                    { Cue = "/VO/X_0003", Text = "Yes." } },
              },
            },
        }""")
        data = extract_textline("Foo", tl, "NPC_Owner_01", "Test.lua")
        line = data["dialogueLines"][0]
        assert line["choices"] == [
            {"internal": "Choice_Accept",
             "targetTextline": "FooChoice_Accept"},
        ]

    def test_synthetic_variants_created_per_choice(self):
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask?",
                      Choices = {
                          { ChoiceText = "Choice_Accept",
                            { Cue = "/VO/X_0002", UsePlayerSource = true,
                              Text = "Yes." },
                          },
                          { ChoiceText = "Choice_Decline",
                            { Cue = "/VO/X_0003", UsePlayerSource = true,
                              Text = "No." },
                          },
                      },
                    },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        section = sections["InteractTextLineSets"]
        assert set(section.keys()) == {
            "Prompt01",
            "Prompt01Choice_Accept",
            "Prompt01Choice_Decline",
        }

    def test_synthetic_metadata_and_implicit_parent_dep(self):
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask?",
                      Choices = {
                          { ChoiceText = "Choice_Accept",
                            { Cue = "/VO/X_0002", UsePlayerSource = true,
                              Text = "Yes." },
                          },
                      },
                    },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        syn = sections["InteractTextLineSets"]["Prompt01Choice_Accept"]
        assert syn["parentTextline"] == "Prompt01"
        assert syn["choiceText"] == "Choice_Accept"
        assert syn["isSynthetic"] is True
        # Implicit dep on the parent textline.
        assert syn["requirements"]["RequiredTextLines"] == ["Prompt01"]
        # Follow-up cue's dialogue carried with proper speaker
        # resolution (UsePlayerSource -> PlayerUnit).
        assert syn["dialogueLines"] == [
            {"speaker": PLAYER_SPEAKER_ID, "text": "Yes."},
        ]

    def test_synthetic_preserves_choice_level_requirements(self):
        # A choice option can declare its own GameStateRequirements
        # (e.g. "only show this option if X"). The synthetic textline
        # must surface those alongside the implicit parent dep.
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask?",
                      Choices = {
                          { ChoiceText = "Choice_Special",
                            GameStateRequirements = {
                                { Path = { "GameState", "TextLinesRecord" },
                                  HasAll = { "Prereq01" } },
                            },
                            { Cue = "/VO/X_0002", Text = "Yes." },
                          },
                      },
                    },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        syn = sections["InteractTextLineSets"]["Prompt01Choice_Special"]
        # Parent dep prepended, choice's own dep preserved.
        assert syn["requirements"]["RequiredTextLines"] == [
            "Prompt01", "Prereq01",
        ]

    def test_real_textline_wins_over_synthetic_collision(self):
        # If a hand-written textline happens to share its name with a
        # synthetic the extractor would produce, the hand-written
        # version wins (synthetic is dropped).
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask?",
                      Choices = {
                          { ChoiceText = "Choice_Accept",
                            { Cue = "/VO/X_0002", Text = "synthetic" },
                          },
                      },
                    },
                },
                Prompt01Choice_Accept = {
                    { Cue = "/VO/X_0099", Text = "hand-written" },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        section = sections["InteractTextLineSets"]
        # The collision: hand-written wins.
        kept = section["Prompt01Choice_Accept"]
        assert kept.get("isSynthetic") is not True
        assert kept["dialogueLines"][0]["text"] == "hand-written"

    def test_multiple_choices_blocks_in_same_textline(self):
        # A textline whose cue array carries two separate Choices
        # blocks (rare but possible) should yield variants for both.
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask first?",
                      Choices = {
                          { ChoiceText = "Choice_AcceptOne",
                            { Cue = "/VO/X_0002", Text = "Yes." },
                          },
                      },
                    },
                    { Cue = "/VO/X_0003", Text = "Ask second?",
                      Choices = {
                          { ChoiceText = "Choice_AcceptTwo",
                            { Cue = "/VO/X_0004", Text = "Also yes." },
                          },
                      },
                    },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        section = sections["InteractTextLineSets"]
        assert "Prompt01Choice_AcceptOne" in section
        assert "Prompt01Choice_AcceptTwo" in section

    def test_choices_field_must_be_table(self):
        # A scalar ``Choices = "foo"`` is silently ignored (no
        # attachment, no synthetics).
        owner = _parse_owner("""{
            InteractTextLineSets = {
                Prompt01 = {
                    { Cue = "/VO/X_0001", Text = "Ask?", Choices = "foo" },
                },
            },
        }""")
        sections = extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        section = sections["InteractTextLineSets"]
        assert list(section.keys()) == ["Prompt01"]
        line = section["Prompt01"]["dialogueLines"][0]
        assert "kind" not in line
        assert "choices" not in line
