"""Tests for GameData.X identifier expansion in requirement fields.

A bare-identifier reference like `RequiredTextLines = GameData.XxxTextLines`
points to a list of textline names defined in TextLineSets.lua. The
extractor expands those references using the game_data_lists map so the
dependency graph contains concrete edges instead of unresolved identifiers.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.npc_data import extract_npc_data


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


GAME_DATA = {
    "GameData.AphroditeBasic": ["AphroditePickUp01", "AphroditePickUp02", "AphroditePickUp03"],
    "GameData.Empty": [],
}


def make_npc_with_field(field_value_lua):
    return f'''UnitSetData.NPCs = {{
        NPC_X_01 = {{
            InteractTextLineSets = {{
                L = {{
                    {field_value_lua}
                }}
            }}
        }}
    }}'''


class TestDirectIdentifierExpansion:
    """`RequiredTextLines = GameData.X` should expand to the list contents."""

    def test_known_identifier_is_expanded(self):
        lua = make_npc_with_field("RequiredTextLines = GameData.AphroditeBasic,")
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredTextLines"] == ["AphroditePickUp01", "AphroditePickUp02", "AphroditePickUp03"]

    def test_unknown_identifier_keeps_bare_name(self):
        """Unknown identifiers should appear as the bare `.name` string
        (NOT as `LuaIdentifier(name='...')` repr) so the audit can surface
        them cleanly."""
        lua = make_npc_with_field("RequiredTextLines = GameData.UnknownList,")
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredTextLines"] == ["GameData.UnknownList"]

    def test_no_game_data_lists_passed_keeps_bare_name(self):
        """Default behavior (game_data_lists=None) should still produce
        clean names, not repr strings."""
        lua = make_npc_with_field("RequiredTextLines = GameData.Anything,")
        result = extract_npc_data(parse(lua))
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredTextLines"] == ["GameData.Anything"]


class TestInArrayIdentifierExpansion:
    """`RequiredAnyTextLines = { "A", GameData.X, "B" }` should splice the
    list contents in place."""

    def test_identifier_inside_array_is_spliced(self):
        lua = make_npc_with_field(
            'RequiredAnyTextLines = { "Before", GameData.AphroditeBasic, "After" },'
        )
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredAnyTextLines"] == [
            "Before", "AphroditePickUp01", "AphroditePickUp02", "AphroditePickUp03", "After"
        ]

    def test_unknown_identifier_in_array_kept_as_bare_name(self):
        lua = make_npc_with_field(
            'RequiredAnyTextLines = { "X", GameData.Unknown, "Y" },'
        )
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        reqs = result["NPC_X_01"]["InteractTextLineSets"]["L"]["requirements"]
        assert reqs["RequiredAnyTextLines"] == ["X", "GameData.Unknown", "Y"]


class TestCountShapedIdentifierExpansion:
    """`MinRunsSinceAnyTextLines = { TextLines = GameData.X, Count = N }`
    should expand the inner TextLines identifier."""

    def test_count_shaped_identifier_is_expanded(self):
        lua = make_npc_with_field(
            'MinRunsSinceAnyTextLines = { TextLines = GameData.AphroditeBasic, Count = 5 },'
        )
        result = extract_npc_data(parse(lua), game_data_lists=GAME_DATA)
        tl = result["NPC_X_01"]["InteractTextLineSets"]["L"]
        # Dependency edges produced from the expanded list:
        assert tl["requirements"]["MinRunsSinceAnyTextLines"] == [
            "AphroditePickUp01", "AphroditePickUp02", "AphroditePickUp03"
        ]
        # Count metadata is still surfaced (without re-listing TextLines):
        assert tl["otherRequirements"]["MinRunsSinceAnyTextLines"] == {"Count": 5}
