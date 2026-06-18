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
