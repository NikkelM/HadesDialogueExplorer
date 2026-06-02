"""Tests for the TextLineSets.lua loader.

The loader produces a {GameData.X: [textline names]} map used by every
per-source extractor to expand bare-identifier references in requirement
fields.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.text_line_sets import extract_game_data_lists


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestExtractGameDataLists:
    def test_pure_string_array_is_extracted(self):
        lua = '''GameData.MyTextLines = { "A", "B", "C" }'''
        result = extract_game_data_lists(parse(lua))
        assert result == {"GameData.MyTextLines": ["A", "B", "C"]}

    def test_multiple_lists_extracted(self):
        lua = '''
        GameData.FirstList = { "A", "B" }
        GameData.SecondList = { "C" }
        '''
        result = extract_game_data_lists(parse(lua))
        assert result == {
            "GameData.FirstList": ["A", "B"],
            "GameData.SecondList": ["C"],
        }

    def test_table_with_named_fields_is_skipped(self):
        """Shared requirement objects (e.g. PartnerConversationRequirements)
        live in TextLineSets.lua too but are NOT textline lists."""
        lua = '''
        GameData.MyLines = { "A", "B" }
        GameData.SharedReqs = { RequiredFalseFlags = { "Flag1" } }
        '''
        result = extract_game_data_lists(parse(lua))
        assert "GameData.MyLines" in result
        assert "GameData.SharedReqs" not in result

    def test_mixed_array_is_skipped(self):
        """A LuaTable whose array has any non-string entry is not a clean
        textline list and should be skipped to avoid corrupting downstream
        requirement lists."""
        lua = '''GameData.MixedList = { "A", 42, "B" }'''
        result = extract_game_data_lists(parse(lua))
        assert "GameData.MixedList" not in result

    def test_empty_array_is_skipped(self):
        """Empty arrays contribute no edges and would only add noise."""
        lua = '''GameData.EmptyList = { }'''
        result = extract_game_data_lists(parse(lua))
        assert "GameData.EmptyList" not in result

    def test_non_gamedata_prefix_is_skipped(self):
        lua = '''
        GameData.MyList = { "A" }
        OtherData.Something = { "B" }
        Foo = { "C" }
        '''
        result = extract_game_data_lists(parse(lua))
        assert set(result.keys()) == {"GameData.MyList"}

    def test_non_table_value_is_skipped(self):
        lua = '''
        GameData.SomeFlag = true
        GameData.SomeString = "hello"
        GameData.RealList = { "A" }
        '''
        result = extract_game_data_lists(parse(lua))
        assert set(result.keys()) == {"GameData.RealList"}

    def test_empty_parsed_returns_empty_map(self):
        assert extract_game_data_lists({}) == {}
