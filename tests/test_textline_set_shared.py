"""Regression tests for the shared textline-set skeleton both games
delegate to (:func:`src.extractors.textline_set.walk_textline_sections`
and :func:`src.extractors.textline_set.build_synthetic_variants`).

The two games differ only in *when* synthetic choice variants are merged
into a section, which determines their position in the section dict and
hence the downstream ``dependents`` edge order. This file pins that
per-game ordering so a future change to the shared skeleton cannot
silently reshuffle either game's shipped output:

* H1 merges each textline's variants inline (``real1, syn1, real2``).
* H2 merges them in a deferred second pass (``real1, real2, syn1``).
"""

from src.lua_parser import LuaParser
from src.extractors.textline_set import (
    extract_textline_sections as h1_extract_textline_sections,
)
from src.extractors.hades2.textline_set import (
    extract_textline_sections as h2_extract_textline_sections,
)
from src.extractors.hades1.cue_speakers import resolve_cue_prefix_speaker


# A choice-bearing textline (``Foo01``, yielding the synthetic
# ``Foo01ChoiceAccept``) followed by a plain textline (``Bar01``). The
# relative position of the synthetic is what differs between the games.
_OWNER_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Text = "Pick one.", Choices = { { ChoiceText = "ChoiceAccept" } } },
        },
        Bar01 = { },
    },
}"""


def _owner():
    return LuaParser(f"O = {_OWNER_LUA}").parse_file()["O"]


def _section_keys(sections):
    return list(sections["InteractTextLineSets"].keys())


def test_hades1_merges_choice_variants_inline():
    sections = h1_extract_textline_sections(
        "NPC_Owner_01", _owner(), "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    assert _section_keys(sections) == ["Foo01", "Foo01ChoiceAccept", "Bar01"]


def test_hades2_defers_choice_variants_after_real_textlines():
    sections = h2_extract_textline_sections(
        "NPC_Owner_01", _owner(), "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    assert _section_keys(sections) == ["Foo01", "Bar01", "Foo01ChoiceAccept"]


def test_both_games_produce_the_same_synthetic_variant():
    """Ordering aside, both walkers must materialise the same synthetic
    child with the implicit parent dependency and synthetic metadata."""
    h1 = h1_extract_textline_sections(
        "NPC_Owner_01", _owner(), "Test.lua",
        section_keys={"InteractTextLineSets"},
    )["InteractTextLineSets"]["Foo01ChoiceAccept"]
    h2 = h2_extract_textline_sections(
        "NPC_Owner_01", _owner(), "Test.lua",
        section_keys={"InteractTextLineSets"},
    )["InteractTextLineSets"]["Foo01ChoiceAccept"]
    for variant in (h1, h2):
        assert variant["isSynthetic"] is True
        assert variant["parentTextline"] == "Foo01"
        assert variant["choiceText"] == "ChoiceAccept"
        assert variant["requirements"]["RequiredTextLines"] == ["Foo01"]


# --- closing voicelines (EndCue / EndVoiceLines) ---------------------------

_H1_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            EndCue = "/VO/ZagreusHome_2389",
            EndVoiceLines = {
                PreLineWait = 0.5,
                { Cue = "/VO/Hades_1055", Text = "A closing remark." },
                { Cue = "/VO/ZagreusHome_3245" },
            },
            { Cue = "/VO/Storyteller_0337", Text = "Main narration." },
        },
    },
}"""

_H2_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            EndVoiceLines = {
                UsePlayerSource = true,
                { Cue = "/VO/Melinoe_0001", Text = "A player closing line." },
                { Cue = "/VO/Hecate_0002" },
            },
            { Cue = "/VO/Hecate_0001", Text = "Main." },
        },
    },
}"""


def test_hades1_extracts_endcue_and_endvoicelines():
    owner = LuaParser(f"O = {_H1_END_LUA}").parse_file()["O"]
    sections = h1_extract_textline_sections(
        "Storyteller", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
        end_cue_speaker_resolver=resolve_cue_prefix_speaker,
    )
    end = sections["InteractTextLineSets"]["Foo01"]["endLines"]
    # EndCue: bare cue, speaker recovered from the cue prefix (Zagreus, not the
    # Storyteller owner), with the /VO/ scope stripped.
    assert end[0] == {"speaker": "CharProtag", "cue": "ZagreusHome_2389"}
    # EndVoiceLines entry with inline Text -> {speaker, text}; cue prefix Hades.
    assert end[1] == {"speaker": "NPC_Hades_01", "text": "A closing remark.", "cue": "Hades_1055"}
    # Bare EndVoiceLines entry (no Text) -> cue-only, prefix-resolved speaker.
    assert end[2] == {"speaker": "CharProtag", "cue": "ZagreusHome_3245"}


def test_hades2_extracts_endvoicelines_with_player_source():
    owner = LuaParser(f"O = {_H2_END_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Hecate_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    end = sections["InteractTextLineSets"]["Foo01"]["endLines"]
    # Table-level UsePlayerSource routes entries through the player (Melinoe).
    assert end[0] == {"speaker": "PlayerUnit", "text": "A player closing line.", "cue": "Melinoe_0001"}
    # Bare entry (no Text) -> cue-only; H2 has no cue-prefix resolver, so the
    # speaker still comes from UsePlayerSource.
    assert end[1] == {"speaker": "PlayerUnit", "cue": "Hecate_0002"}


# A nested EndVoiceLines "voice-line group": the array element is a group with
# timing / ObjectType params and its cue in a nested sub-entry (the common H2
# shape, e.g. ErisAboutSurface02). The group-level ObjectType attributes the cue.
_H2_NESTED_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Cue = "/VO/Hecate_0001", Text = "Main." },
            EndVoiceLines = {
                {
                    PreLineWait = 0.35,
                    ObjectType = "NPC_Eris_01",
                    { Cue = "/VO/Eris_0107", Text = "Sure has!" },
                },
            },
        },
    },
}"""


def test_hades2_extracts_nested_endvoicelines_group():
    owner = LuaParser(f"O = {_H2_NESTED_END_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Hecate_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    end = sections["InteractTextLineSets"]["Foo01"]["endLines"]
    # The nested cue surfaces, attributed to the group-level ObjectType (Eris),
    # not the owner (Hecate).
    assert end == [{"speaker": "NPC_Eris_01", "text": "Sure has!", "cue": "Eris_0107"}]


# EndVoiceLines groups each gated on a dialogue-choice outcome
# (``TextLinesChoiceRecord.<parent> IsAny {ChoiceText}``) - the ErisBecomingCloser01
# shape. Each coda plays only after its choice, so it must land on the matching
# synthetic choice child, NOT the parent.
_H2_CHOICE_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Cue = "/VO/Hecate_0001", Text = "Prompt." },
            EndVoiceLines = {
                {
                    GameStateRequirements = {
                        { Path = { "CurrentRun", "TextLinesChoiceRecord", "Foo01" }, IsAny = { "Choice_Decline" } },
                    },
                    { Cue = "/VO/Mel_1", Text = "Please don't.", UsePlayerSource = true },
                    { Cue = "/VO/Eris_1", Text = "Aw...", ObjectType = "NPC_Eris_01" },
                },
                {
                    GameStateRequirements = {
                        { Path = { "CurrentRun", "TextLinesChoiceRecord", "Foo01" }, IsAny = { "Choice_Accept" } },
                    },
                    { Cue = "/VO/Mel_2", Text = "Whew...", UsePlayerSource = true },
                },
            },
            {
                Text = "Choice_Foo01",
                IsNarration = true,
                Choices = {
                    { ChoiceText = "Choice_Decline",
                        { Cue = "/VO/Mel_3", Text = "Decline body.", UsePlayerSource = true },
                    },
                    { ChoiceText = "Choice_Accept",
                        { Cue = "/VO/Mel_4", Text = "Accept body.", UsePlayerSource = true },
                    },
                },
            },
        },
    },
}"""


def test_hades2_routes_choice_gated_endvoicelines_to_choice_children():
    owner = LuaParser(f"O = {_H2_CHOICE_END_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Eris_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    section = sections["InteractTextLineSets"]
    parent = section["Foo01"]
    # Both codas are pure choice gates -> nothing stays on the parent, and the
    # temporary routing key never leaks into the output.
    assert "endLines" not in parent
    assert "_choiceEndLines" not in parent
    # Decline coda lands on the Decline child, attributed per sub-cue, with the
    # now-implied choice gate dropped (no condGroup / requirements).
    assert section["Foo01Choice_Decline"]["endLines"] == [
        {"speaker": "PlayerUnit", "text": "Please don't.", "cue": "Mel_1"},
        {"speaker": "NPC_Eris_01", "text": "Aw...", "cue": "Eris_1"},
    ]
    assert section["Foo01Choice_Accept"]["endLines"] == [
        {"speaker": "PlayerUnit", "text": "Whew...", "cue": "Mel_2"},
    ]


# EndVoiceLines groups gated on non-choice game state (the Inspect_G_Intro_01
# "Homer" shape: PathTrue / PathFalse on whether another line was seen). These
# stay on the parent but carry a ``condGroup`` id + the extracted requirement so
# the viewer can label each "plays if ...".
_H2_COND_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Cue = "/VO/Storyteller_1", Text = "Main." },
            EndVoiceLines = {
                {
                    GameStateRequirements = {
                        { PathTrue = { "GameState", "TextLinesRecord", "SomeOther01" } },
                    },
                    { Cue = "/VO/Mel_1", Text = "Seen it.", UsePlayerSource = true },
                },
                {
                    GameStateRequirements = {
                        { PathFalse = { "GameState", "TextLinesRecord", "SomeOther01" } },
                    },
                    { Cue = "/VO/Mel_2", Text = "Not seen.", UsePlayerSource = true },
                },
            },
        },
    },
}"""


def test_hades2_labels_non_choice_conditional_endvoicelines():
    owner = LuaParser(f"O = {_H2_COND_END_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Eris_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    parent = sections["InteractTextLineSets"]["Foo01"]
    assert "_choiceEndLines" not in parent
    end = parent["endLines"]
    assert len(end) == 2
    # Each line keeps its subtitle + speaker, gains a per-group condGroup id, and
    # carries the group's extracted requirement (Path record or textline edge).
    assert end[0]["text"] == "Seen it." and end[0]["speaker"] == "PlayerUnit"
    assert end[1]["text"] == "Not seen."
    assert end[0]["condGroup"] == 0 and end[1]["condGroup"] == 1
    assert end[0].get("otherRequirements") or end[0].get("requirements")
    assert end[1].get("otherRequirements") or end[1].get("requirements")


# A single table-level GameStateRequirements gating several flat cues (the
# ChronosReveal01 shape). All cues share the one gate, so they must collapse
# into ONE conditional group (one "only when" note), not one per line.
_H2_TABLE_COND_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Cue = "/VO/Chronos_1", Text = "Main." },
            EndVoiceLines = {
                GameStateRequirements = {
                    { PathFalse = { "CurrentRun", "TextLinesRecord", "FollowUp01" } },
                },
                { Cue = "/VO/Chronos_2", Text = "Line one." },
                { Cue = "/VO/Chronos_3", Text = "Line two." },
            },
        },
    },
}"""


def test_hades2_groups_shared_table_level_conditional_endvoicelines():
    owner = LuaParser(f"O = {_H2_TABLE_COND_END_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Chronos_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    end = sections["InteractTextLineSets"]["Foo01"]["endLines"]
    assert len(end) == 2
    assert end[0]["text"] == "Line one." and end[1]["text"] == "Line two."
    # Same table-level gate -> one shared condGroup, not one per cue.
    assert end[0]["condGroup"] == 0 and end[1]["condGroup"] == 0
    assert end[0].get("otherRequirements") or end[0].get("requirements")



# RandomRemaining + nested cues), the shape of the Bath House / Fishing / Taverna
# repeatable sets that previously extracted with zero dialogue lines.
_H2_INDEXED_MAIN_LUA = """{
    InteractTextLineSets = {
        Rep01 = {
            [1] = {
                RandomRemaining = true,
                { Cue = "/VO/Eris_0294", Text = "Line A." },
                { Cue = "/VO/Eris_0297", Text = "Line B." },
            },
            [2] = {
                { Cue = "/VO/Eris_0300", Text = "Line C." },
            },
        },
    },
}"""


def test_hades2_extracts_indexed_positional_main_groups():
    owner = LuaParser(f"O = {_H2_INDEXED_MAIN_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Eris_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
    )
    lines = sections["InteractTextLineSets"]["Rep01"]["dialogueLines"]
    # [1] carries RandomRemaining -> a random-pick-one segment listing its
    # options; [2] has no RandomRemaining -> its cue is a plain sequential line.
    assert lines[0]["kind"] == "randomGroup"
    assert [o["text"] for o in lines[0]["options"]] == ["Line A.", "Line B."]
    assert lines[1] == {"speaker": "NPC_Eris_01", "text": "Line C.", "cue": "Eris_0300"}


# A repeatable dialogue whose [2] branch splices in a shared
# HeroRepeatableTextLines set by name; the resolver expands it to a random group.
_H2_SHARED_SET_LUA = """{
    InteractTextLineSets = {
        Rep01 = {
            [1] = {
                RandomRemaining = true,
                { Cue = "/VO/Eris_0294", Text = "Eris intro." },
            },
            [2] = HeroRepeatableTextLines.BathHouseIntroTextLines,
        },
    },
}"""

_HERO_DATA_LUA = """{
    BathHouseIntroTextLines = {
        RandomRemaining = true,
        { Cue = "/VO/Melinoe_5307", UsePlayerSource = true, Text = "...This is nice..." },
        { Cue = "/VO/Melinoe_5308", UsePlayerSource = true, Text = "...I needed this..." },
    },
}"""


def test_hades2_resolves_hero_repeatable_shared_set_branch():
    from src.extractors.hades2.textline_set import extract_hero_repeatable_sets
    hero_parsed = {"HeroRepeatableTextLines": LuaParser(f"O = {_HERO_DATA_LUA}").parse_file()["O"]}
    hero_sets = extract_hero_repeatable_sets(hero_parsed)
    assert "BathHouseIntroTextLines" in hero_sets

    owner = LuaParser(f"O = {_H2_SHARED_SET_LUA}").parse_file()["O"]
    sections = h2_extract_textline_sections(
        "NPC_Eris_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
        hero_repeatable_sets=hero_sets,
    )
    lines = sections["InteractTextLineSets"]["Rep01"]["dialogueLines"]
    assert lines[0]["kind"] == "randomGroup"           # [1] Eris
    assert lines[1]["kind"] == "randomGroup"           # [2] resolved shared set
    assert lines[1]["source"] == "BathHouseIntroTextLines"
    assert [o["text"] for o in lines[1]["options"]] == ["...This is nice...", "...I needed this..."]
    assert all(o["speaker"] == "PlayerUnit" for o in lines[1]["options"])


# H1 EndVoiceLines can also use the nested-group shape.
_H1_NESTED_END_LUA = """{
    InteractTextLineSets = {
        Foo01 = {
            { Cue = "/VO/Storyteller_0337", Text = "Main." },
            EndVoiceLines = {
                {
                    PreLineWait = 0.5,
                    { Cue = "/VO/Hades_1055", Text = "A nested closing remark." },
                },
            },
        },
    },
}"""


def test_hades1_extracts_nested_endvoicelines_group():
    owner = LuaParser(f"O = {_H1_NESTED_END_LUA}").parse_file()["O"]
    sections = h1_extract_textline_sections(
        "Storyteller", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
        end_cue_speaker_resolver=resolve_cue_prefix_speaker,
    )
    end = sections["InteractTextLineSets"]["Foo01"]["endLines"]
    # The nested cue surfaces, speaker recovered from the cue prefix (Hades).
    assert end == [{"speaker": "NPC_Hades_01", "text": "A nested closing remark.", "cue": "Hades_1055"}]


def test_no_end_lines_field_when_textline_has_none():
    owner = LuaParser('O = { InteractTextLineSets = { Foo01 = { { Cue = "/VO/X_0001", Text = "hi" } } } }').parse_file()["O"]
    sections = h1_extract_textline_sections(
        "NPC_Owner_01", owner, "Test.lua",
        section_keys={"InteractTextLineSets"},
        end_cue_speaker_resolver=resolve_cue_prefix_speaker,
    )
    assert "endLines" not in sections["InteractTextLineSets"]["Foo01"]


def test_cue_comment_map_recovers_subtitles_from_source_comments():
    from src.extractors.textline_set import build_cue_comment_map, apply_cue_comment_texts
    source = '\n'.join([
        '    Foo01 = {',
        "        -- The job's number one perk... no thanks.",
        '        EndCue = "/VO/ZagreusHome_2389",',
        '        EndVoiceLines = {',
        '            -- No thanks!',
        '            { Cue = "/VO/ZagreusHome_3245" },',
        '            -- Enough. Get out.',
        '            { Cue = "/VO/Hades_0550", PostLineFunctionName = "X" },',
        '            { Cue = "/VO/Hades_0001", Text = "Inline, not from a comment." },',
        '        },',
        '    },',
    ])
    cmap = build_cue_comment_map(source)
    # EndCue and bare / trailing-field cue entries pick up the comment above;
    # the inline-Text entry's line is skipped (its subtitle is the inline text).
    assert cmap["ZagreusHome_2389"] == "The job's number one perk... no thanks."
    assert cmap["ZagreusHome_3245"] == "No thanks!"
    assert cmap["Hades_0550"] == "Enough. Get out."
    assert "Hades_0001" not in cmap
    # Applying the map fills the subtitle of cue-only end lines (keeping the cue
    # id) and leaves already-resolved / unknown entries untouched.
    textlines = {
        "Foo01": {"endLines": [
            {"speaker": "CharProtag", "cue": "ZagreusHome_2389"},
            {"speaker": "NPC_Hades_01", "text": "Already has text.", "cue": "Hades_0001"},
            {"speaker": "NPC_Cerberus_01", "cue": "CerberusWhineSad"},
        ]},
    }
    apply_cue_comment_texts(textlines, cmap)
    el = textlines["Foo01"]["endLines"]
    assert el[0] == {"speaker": "CharProtag", "cue": "ZagreusHome_2389", "text": "The job's number one perk... no thanks."}
    assert el[1]["text"] == "Already has text."  # untouched
    assert "text" not in el[2]  # no comment for a non-/VO/ sound cue


def test_h2_cue_text_map_recovers_inline_text():
    from src.extractors.textline_set import build_h2_cue_text_map
    source = '\n'.join([
        '    { Cue = "/VO/Melinoe_5156", Text = "The Fates... they\'re close..." },',
        '    { Cue = "/VO/Artemis_0304", Text = "That\'s it!", PlayFirst = true },',
        # Other cue fields may sit between Cue and Text.
        '    { Cue = "/VO/Hecate_0070", PlayFirst = true, Text = "There you are." },',
        # Format tags are stripped, like the dialogue-line treatment.
        '    { Cue = "/VO/Skelly_0288", Text = "{#Prev}What news?" },',
        # A cue with no inline Text is not recovered.',
        '    { Cue = "/VO/Zagreus_9999", PlayFirst = true },',
    ])
    m = build_h2_cue_text_map(source)
    assert m["Melinoe_5156"] == "The Fates... they're close..."
    assert m["Artemis_0304"] == "That's it!"
    assert m["Hecate_0070"] == "There you are."
    assert m["Skelly_0288"] == "What news?"
    assert "Zagreus_9999" not in m
