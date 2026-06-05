"""Tests for positional `requirementSources` provenance.

When `RequiredTextLines = { "A", GameData.X, "B" }` is extracted, the
flat `requirements["RequiredTextLines"]` list is `["A", x1, x2, x3, "B"]`
and the parallel `requirementSources["RequiredTextLines"]` list is
`[None, "GameData.X", "GameData.X", "GameData.X", None]` - aligned 1:1
so the viewer can chunk adjacent same-group entries into a labeled box.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data
from src.graph import build_graph_data


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


GAME_DATA = {
    "GameData.X": ["X1", "X2", "X3"],
    "GameData.Y": ["Y1", "Y2"],
    "GameData.Overlap": ["A", "X2"],  # collides with bare "A" and with X2
}


def make_npc(field_lua):
    return f'''UnitSetData.NPCs = {{
        NPC_X_01 = {{
            InteractTextLineSets = {{
                L = {{
                    {field_lua}
                }}
            }}
        }}
    }}'''


def extract_one(field_lua):
    result = extract_npc_data(parse(make_npc(field_lua)), game_data_lists=GAME_DATA)
    return result["NPC_X_01"]["InteractTextLineSets"]["L"]


class TestBareEntriesHaveNoSources:
    def test_all_bare_string_requirements_omit_sources(self):
        tl = extract_one('RequiredTextLines = { "A", "B" },')
        # All-None sources should NOT produce a requirementSources entry
        # (keeps JSON small; viewer treats absence as "all null").
        assert "requirementSources" not in tl

    def test_single_string_omits_sources(self):
        tl = extract_one('RequiredTextLines = "A",')
        assert "requirementSources" not in tl


class TestDirectIdentifierSources:
    def test_direct_expansion_sources_all_match_group(self):
        tl = extract_one('RequiredTextLines = GameData.X,')
        assert tl["requirements"]["RequiredTextLines"] == ["X1", "X2", "X3"]
        assert tl["requirementSources"]["RequiredTextLines"] == [
            "GameData.X", "GameData.X", "GameData.X"
        ]

    def test_unknown_identifier_is_none(self):
        tl = extract_one('RequiredTextLines = GameData.Unknown,')
        # Unknown identifier: kept as bare name, but with no group source
        # (it didn't come from any known expansion). All-None → omitted.
        assert "requirementSources" not in tl


class TestInArrayMixedSources:
    def test_mixed_bare_and_grouped_aligned(self):
        tl = extract_one('RequiredAnyTextLines = { "Before", GameData.X, "After" },')
        assert tl["requirements"]["RequiredAnyTextLines"] == [
            "Before", "X1", "X2", "X3", "After"
        ]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            None, "GameData.X", "GameData.X", "GameData.X", None
        ]

    def test_two_groups_in_one_field(self):
        tl = extract_one(
            'RequiredAnyTextLines = { GameData.X, "Mid", GameData.Y },'
        )
        assert tl["requirements"]["RequiredAnyTextLines"] == [
            "X1", "X2", "X3", "Mid", "Y1", "Y2"
        ]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            "GameData.X", "GameData.X", "GameData.X", None, "GameData.Y", "GameData.Y"
        ]

    def test_same_group_referenced_twice_emits_duplicates(self):
        tl = extract_one('RequiredAnyTextLines = { GameData.X, GameData.X },')
        # Both expansions appear (semantically OK - would be a no-op
        # dedupe in-game, but we represent the source faithfully).
        assert tl["requirements"]["RequiredAnyTextLines"] == [
            "X1", "X2", "X3", "X1", "X2", "X3"
        ]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            "GameData.X", "GameData.X", "GameData.X",
            "GameData.X", "GameData.X", "GameData.X",
        ]


class TestOverlappingNames:
    """Critical correctness case: name appears both bare AND inside a
    GameData list, OR appears in two different lists. Aligned sources
    correctly attribute each *occurrence* to its origin (membership
    lookup would have misattributed)."""

    def test_bare_name_then_same_name_via_group(self):
        # "A" appears bare first, then "A" appears again as the first
        # entry of GameData.Overlap (["A", "X2"]).
        tl = extract_one('RequiredAnyTextLines = { "A", GameData.Overlap },')
        assert tl["requirements"]["RequiredAnyTextLines"] == ["A", "A", "X2"]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            None, "GameData.Overlap", "GameData.Overlap"
        ]

    def test_same_name_via_two_groups(self):
        # "X2" appears both in GameData.X and in GameData.Overlap.
        # Each occurrence is attributed to its OWN group.
        tl = extract_one('RequiredAnyTextLines = { GameData.X, GameData.Overlap },')
        assert tl["requirements"]["RequiredAnyTextLines"] == [
            "X1", "X2", "X3", "A", "X2"
        ]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            "GameData.X", "GameData.X", "GameData.X",
            "GameData.Overlap", "GameData.Overlap",
        ]


class TestCountShapeSources:
    def test_inner_textlines_identifier_expanded_with_sources(self):
        tl = extract_one(
            'MinRunsSinceAnyTextLines = { TextLines = GameData.X, Count = 5 },'
        )
        assert tl["requirements"]["MinRunsSinceAnyTextLines"] == ["X1", "X2", "X3"]
        assert tl["requirementSources"]["MinRunsSinceAnyTextLines"] == [
            "GameData.X", "GameData.X", "GameData.X"
        ]

    def test_inner_textlines_string_array_omits_sources(self):
        tl = extract_one(
            'MinRunsSinceAnyTextLines = { TextLines = { "A", "B" }, Count = 5 },'
        )
        assert "requirementSources" not in tl


class TestChoiceVariantSourcesAlignment:
    """Choice-variant synthesis prepends `parent_name` to the child's
    RequiredTextLines. If the child already had grouped sources, the
    insertion must shift sources by +1 (prepend None) to stay aligned."""

    def test_choice_variant_prepends_none_in_sources(self):
        lua = '''UnitSetData.NPCs = {
            NPC_X_01 = {
                InteractTextLineSets = {
                    Parent = {
                        { Cue = "/x", Choices = {
                            { ChoiceText = "Pick", RequiredTextLines = GameData.X },
                        } },
                    }
                }
            }
        }'''
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        section = result["NPC_X_01"]["InteractTextLineSets"]
        synth_name = "ParentPick"
        assert synth_name in section
        child = section[synth_name]
        # Implicit parent dep prepended:
        assert child["requirements"]["RequiredTextLines"] == [
            "Parent", "X1", "X2", "X3"
        ]
        # Sources must align: parent has None, then group entries:
        assert child["requirementSources"]["RequiredTextLines"] == [
            None, "GameData.X", "GameData.X", "GameData.X"
        ]


class TestGraphPropagation:
    """`build_graph_data` must propagate `requirementSources` to the
    output entries so the viewer can consume them."""

    def test_requirement_sources_propagated_to_graph(self):
        lua = make_npc('RequiredAnyTextLines = { "Pre", GameData.X },')
        owners = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        graph = build_graph_data(owners)
        tl = graph["textlines"]["L"]
        assert tl["requirementSources"]["RequiredAnyTextLines"] == [
            None, "GameData.X", "GameData.X", "GameData.X"
        ]

    def test_no_sources_field_when_no_expansions(self):
        lua = make_npc('RequiredTextLines = { "A", "B" },')
        owners = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        graph = build_graph_data(owners)
        tl = graph["textlines"]["L"]
        assert "requirementSources" not in tl
