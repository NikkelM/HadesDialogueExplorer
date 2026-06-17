"""Tests for the Lua tokenizer."""

import pytest

from src.lua_parser import (
    Tokenizer,
    T_STRING, T_NUMBER, T_BOOL, T_NIL, T_IDENT,
    T_LBRACE, T_RBRACE, T_LBRACKET, T_RBRACKET,
    T_LPAREN, T_RPAREN, T_EQUALS, T_COMMA, T_SEMICOL,
    T_DOT, T_CONCAT, T_EOF,
)


def tokenize(text):
    """Helper: drain a tokenizer into a list (excluding EOF)."""
    t = Tokenizer(text)
    tokens = []
    while True:
        tok = t.next_token()
        if tok.type == T_EOF:
            break
        tokens.append(tok)
    return tokens


def types_values(text):
    """Helper: return list of (type, value) pairs for assertions."""
    return [(t.type, t.value) for t in tokenize(text)]


class TestStrings:
    def test_double_quoted(self):
        assert types_values('"hello"') == [(T_STRING, "hello")]

    def test_single_quoted(self):
        assert types_values("'hello'") == [(T_STRING, "hello")]

    def test_empty_string(self):
        assert types_values('""') == [(T_STRING, "")]

    def test_string_with_newline_escape(self):
        assert types_values(r'"a\nb"') == [(T_STRING, "a\nb")]

    def test_string_with_tab_escape(self):
        assert types_values(r'"a\tb"') == [(T_STRING, "a\tb")]

    def test_string_with_backslash_escape(self):
        assert types_values(r'"a\\b"') == [(T_STRING, "a\\b")]

    def test_string_with_quote_escape(self):
        assert types_values(r'"a\"b"') == [(T_STRING, 'a"b')]

    def test_long_string_basic(self):
        assert types_values("[[hello world]]") == [(T_STRING, "hello world")]

    def test_long_string_with_level(self):
        assert types_values("[==[contains ]] inside]==]") == [(T_STRING, "contains ]] inside")]

    def test_long_string_multiline(self):
        toks = tokenize("[[line1\nline2]]")
        assert toks[0].type == T_STRING
        assert toks[0].value == "line1\nline2"


class TestNumbers:
    def test_integer(self):
        assert types_values("42") == [(T_NUMBER, 42)]

    def test_zero(self):
        assert types_values("0") == [(T_NUMBER, 0)]

    def test_float(self):
        assert types_values("3.14") == [(T_NUMBER, 3.14)]

    def test_float_leading_dot(self):
        assert types_values(".5") == [(T_NUMBER, 0.5)]

    def test_hex(self):
        assert types_values("0xFF") == [(T_NUMBER, 255)]

    def test_hex_lowercase(self):
        assert types_values("0xff") == [(T_NUMBER, 255)]

    def test_scientific_notation(self):
        assert types_values("1e3") == [(T_NUMBER, 1000.0)]

    def test_scientific_with_sign(self):
        assert types_values("1.5e-2") == [(T_NUMBER, 0.015)]

    def test_negative_integer(self):
        assert types_values("-5") == [(T_NUMBER, -5)]

    def test_negative_float(self):
        assert types_values("-2.5") == [(T_NUMBER, -2.5)]

    def test_negative_leading_dot(self):
        assert types_values("-.5") == [(T_NUMBER, -0.5)]

    def test_negative_hex(self):
        assert types_values("-0x10") == [(T_NUMBER, -16)]

    def test_negative_scientific(self):
        assert types_values("-1e3") == [(T_NUMBER, -1000.0)]

    def test_binary_minus_with_spaces_is_not_a_number(self):
        # ``a - b`` is subtraction, not a negative literal; the '-' is
        # skipped as a bare operator so only the two identifiers remain.
        assert types_values("a - b") == [(T_IDENT, "a"), (T_IDENT, "b")]

    def test_double_dash_keeps_comment_precedence(self):
        # The comment check must stay ahead of negative-number handling
        # so ``--5`` is a comment line, not the number -5.
        assert types_values("--5\n42") == [(T_NUMBER, 42)]


class TestLiterals:
    def test_true(self):
        assert types_values("true") == [(T_BOOL, True)]

    def test_false(self):
        assert types_values("false") == [(T_BOOL, False)]

    def test_nil(self):
        assert types_values("nil") == [(T_NIL, None)]


class TestIdentifiers:
    def test_simple_identifier(self):
        assert types_values("foo") == [(T_IDENT, "foo")]

    def test_identifier_with_underscore(self):
        assert types_values("_private") == [(T_IDENT, "_private")]

    def test_identifier_with_digits(self):
        assert types_values("foo123") == [(T_IDENT, "foo123")]

    def test_identifier_with_underscores_and_digits(self):
        assert types_values("NPC_Orpheus_01") == [(T_IDENT, "NPC_Orpheus_01")]

    def test_lua_keywords_emitted_as_idents(self):
        # The tokenizer does not special-case keywords beyond true/false/nil
        # so 'local', 'function' etc. come through as identifiers
        assert types_values("local") == [(T_IDENT, "local")]
        assert types_values("function") == [(T_IDENT, "function")]


class TestComments:
    def test_single_line_comment_stripped(self):
        assert types_values("-- just a comment\n42") == [(T_NUMBER, 42)]

    def test_single_line_comment_at_eof(self):
        assert types_values("42 -- trailing") == [(T_NUMBER, 42)]

    def test_block_comment(self):
        assert types_values("--[[ block ]]42") == [(T_NUMBER, 42)]

    def test_block_comment_multiline(self):
        assert types_values("--[[\nline1\nline2\n]]42") == [(T_NUMBER, 42)]

    def test_block_comment_with_level(self):
        assert types_values("--[==[ has ]] inside ]==]42") == [(T_NUMBER, 42)]


class TestPunctuation:
    def test_braces(self):
        assert types_values("{}") == [(T_LBRACE, "{"), (T_RBRACE, "}")]

    def test_brackets(self):
        assert types_values("[1]") == [(T_LBRACKET, "["), (T_NUMBER, 1), (T_RBRACKET, "]")]

    def test_parens(self):
        assert types_values("()") == [(T_LPAREN, "("), (T_RPAREN, ")")]

    def test_equals(self):
        assert types_values("a = 1") == [(T_IDENT, "a"), (T_EQUALS, "="), (T_NUMBER, 1)]

    def test_comma(self):
        assert types_values("1,2") == [(T_NUMBER, 1), (T_COMMA, ","), (T_NUMBER, 2)]

    def test_semicolon(self):
        assert types_values("1;2") == [(T_NUMBER, 1), (T_SEMICOL, ";"), (T_NUMBER, 2)]

    def test_dot(self):
        assert types_values("a.b") == [(T_IDENT, "a"), (T_DOT, "."), (T_IDENT, "b")]

    def test_concat_operator(self):
        assert types_values('"a" .. "b"') == [
            (T_STRING, "a"), (T_CONCAT, ".."), (T_STRING, "b")
        ]

    def test_equality_operator_skipped(self):
        # == is not assignment; the tokenizer drops it entirely
        assert types_values("a == b") == [(T_IDENT, "a"), (T_IDENT, "b")]


class TestWhitespace:
    def test_empty_input(self):
        assert types_values("") == []

    def test_whitespace_only(self):
        assert types_values("   \n\t  \r\n") == []

    def test_line_tracking(self):
        toks = tokenize("a\nb\nc")
        assert toks[0].line == 1
        assert toks[1].line == 2
        assert toks[2].line == 3
