"""Tests for the Lua parser (table/value parsing and top-level assignments)."""

import pytest

from src.lua_parser import (
    LuaParser, LuaTable, LuaIdentifier, LuaExpression,
)


def parse_file(text):
    """Helper: parse a full Lua file and return the top-level assignments dict."""
    return LuaParser(text).parse_file()


def parse_value(text):
    """Helper: parse a single Lua value (used for testing tables in isolation)."""
    return LuaParser(text).parse_value()


class TestEmptyAndSimple:
    def test_empty_file(self):
        assert parse_file("") == {}

    def test_simple_string_assignment(self):
        assert parse_file('X = "hi"') == {"X": "hi"}

    def test_simple_number_assignment(self):
        assert parse_file("X = 42") == {"X": 42}

    def test_bool_assignment(self):
        assert parse_file("X = true") == {"X": True}

    def test_nil_assignment(self):
        assert parse_file("X = nil") == {"X": None}

    def test_dotted_assignment(self):
        # Foo.Bar = ... -> key is the dotted path "Foo.Bar"
        result = parse_file('Foo.Bar = "x"')
        assert result == {"Foo.Bar": "x"}

    def test_deeply_dotted_assignment(self):
        result = parse_file('A.B.C = 1')
        assert result == {"A.B.C": 1}


class TestTables:
    def test_empty_table(self):
        t = parse_value("{}")
        assert isinstance(t, LuaTable)
        assert t.named == {}
        assert t.array == []

    def test_named_field(self):
        t = parse_value("{ a = 1 }")
        assert t.named == {"a": 1}
        assert t.array == []

    def test_multiple_named_fields(self):
        t = parse_value('{ a = 1, b = "hi", c = true }')
        assert t.named == {"a": 1, "b": "hi", "c": True}

    def test_array_entries(self):
        t = parse_value('{ "a", "b", "c" }')
        assert t.named == {}
        assert t.array == ["a", "b", "c"]

    def test_mixed_named_and_array(self):
        t = parse_value('{ name = "x", "first", "second" }')
        assert t.named == {"name": "x"}
        assert t.array == ["first", "second"]

    def test_semicolon_separator(self):
        t = parse_value('{ a = 1; b = 2 }')
        assert t.named == {"a": 1, "b": 2}

    def test_trailing_comma(self):
        t = parse_value('{ a = 1, }')
        assert t.named == {"a": 1}


class TestNestedTables:
    def test_nested_named(self):
        t = parse_value('{ outer = { inner = "x" } }')
        assert isinstance(t.named["outer"], LuaTable)
        assert t.named["outer"].named == {"inner": "x"}

    def test_nested_array(self):
        t = parse_value('{ { 1 }, { 2 } }')
        assert len(t.array) == 2
        assert t.array[0].array == [1]
        assert t.array[1].array == [2]

    def test_deeply_nested(self):
        t = parse_value('{ a = { b = { c = "deep" } } }')
        assert t.named["a"].named["b"].named["c"] == "deep"


class TestBracketKeys:
    def test_string_bracket_key(self):
        t = parse_value('{ ["my key"] = 1 }')
        assert t.named == {"my key": 1}

    def test_int_bracket_key(self):
        # Integer bracket keys are stored as string keys in named (per parser impl)
        t = parse_value('{ [1] = "first" }')
        assert t.named == {"1": "first"}


class TestIdentifiersAndExpressions:
    def test_unresolved_identifier(self):
        t = parse_value('{ a = SomeConstant }')
        assert isinstance(t.named["a"], LuaIdentifier)
        assert t.named["a"].name == "SomeConstant"

    def test_function_call_as_expression(self):
        t = parse_value('{ a = ComputeValue(1, 2) }')
        assert isinstance(t.named["a"], LuaExpression)
        assert "ComputeValue" in t.named["a"].raw

    def test_dotted_identifier(self):
        t = parse_value('{ a = Module.Constant }')
        assert isinstance(t.named["a"], LuaIdentifier)
        assert t.named["a"].name == "Module.Constant"


class TestStringConcatenation:
    def test_simple_concat(self):
        t = parse_value('{ a = "foo" .. "bar" }')
        assert t.named["a"] == "foobar"

    def test_concat_in_array(self):
        t = parse_value('{ "a" .. "b" }')
        assert t.array == ["ab"]


class TestRealWorldShapes:
    """Tests that mirror the shapes seen in NPCData.lua."""

    def test_textline_set_with_required_textlines(self):
        # This is the shape that broke the old parser:
        # RequiredTextLines = { "..." } at depth 1 looks like a dialogue entry.
        text = '''X = {
            MyTextline = {
                RequiredTextLines = { "OtherLine01", "OtherLine02" },
                PlayOnce = true,
                { Speaker = "CharProtag", Text = "Hello there." },
            }
        }'''
        result = parse_file(text)
        my = result["X"].named["MyTextline"]
        # RequiredTextLines is a named field (not an array entry / dialogue)
        assert isinstance(my.named["RequiredTextLines"], LuaTable)
        assert my.named["RequiredTextLines"].array == ["OtherLine01", "OtherLine02"]
        assert my.named["PlayOnce"] is True
        # The dialogue line is the only anonymous array entry
        assert len(my.array) == 1
        assert my.array[0].named["Text"] == "Hello there."

    def test_unitsetdata_npcs_shape(self):
        text = '''UnitSetData.NPCs = {
            NPC_Test_01 = {
                InteractTextLineSets = {
                    TestLine01 = { { Text = "Hi" } }
                }
            }
        }'''
        result = parse_file(text)
        assert "UnitSetData.NPCs" in result
        npcs = result["UnitSetData.NPCs"]
        assert "NPC_Test_01" in npcs.named


class TestRobustness:
    def test_skips_unknown_statements(self):
        # Function definitions and control flow should be skipped without breaking
        # data extraction from later assignments.
        text = '''
        local function helper() return 1 end
        X = "captured"
        '''
        result = parse_file(text)
        assert result.get("X") == "captured"

    def test_comments_between_fields(self):
        t = parse_value('''{
            a = 1, -- first
            -- skip me
            b = 2,
        }''')
        assert t.named == {"a": 1, "b": 2}


class TestLineTracking:
    """Each parsed LuaTable should record the line of its opening '{'."""

    def test_top_level_table_line_is_recorded(self):
        # Two assignments; the second table opens on line 3.
        text = "A = 1\nB = {\n    x = 2,\n}"
        result = parse_file(text)
        assert isinstance(result["B"], LuaTable)
        assert result["B"].line == 2

    def test_nested_table_line_is_recorded(self):
        # Nested table opens on its own line.
        text = (
            "Root = {\n"
            "    First = { a = 1 },\n"
            "    Second = {\n"
            "        b = 2,\n"
            "    },\n"
            "}\n"
        )
        result = parse_file(text)
        root = result["Root"]
        assert root.line == 1
        assert root.named["First"].line == 2
        assert root.named["Second"].line == 3

    def test_anonymous_array_entry_table_has_line(self):
        # Tables that appear as anonymous array entries (e.g. dialogue lines)
        # should also carry their opening-brace line.
        text = (
            "X = {\n"
            "    { Speaker = \"A\", Text = \"hi\" },\n"
            "    { Speaker = \"B\", Text = \"bye\" },\n"
            "}\n"
        )
        result = parse_file(text)
        x = result["X"]
        assert x.line == 1
        assert x.array[0].line == 2
        assert x.array[1].line == 3
