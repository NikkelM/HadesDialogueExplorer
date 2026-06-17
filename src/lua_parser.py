"""
Generic Lua data file parser.

Parses Lua table literals and top-level assignments into Python structures.
Handles the full range of Lua table syntax found in Hades game data files.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class LuaTable:
    """Represents a Lua table with both named fields and anonymous array entries."""
    named: dict = field(default_factory=dict)
    array: list = field(default_factory=list)
    line: int = -1  # Source line of the opening '{', when known

    def get(self, key, default=None):
        return self.named.get(key, default)

    def __contains__(self, key):
        return key in self.named

    def __getitem__(self, key):
        return self.named[key]

    def keys(self):
        return self.named.keys()

    def items(self):
        return self.named.items()

    def values(self):
        return self.named.values()


@dataclass
class LuaIdentifier:
    """An unresolved Lua identifier (variable reference)."""
    name: str


@dataclass
class LuaExpression:
    """An unparseable Lua expression stored as raw text."""
    raw: str


class ParseError(Exception):
    """Error during Lua parsing with location info."""
    def __init__(self, message, line=None, col=None):
        self.line = line
        self.col = col
        loc = f" at line {line}" if line else ""
        if col:
            loc += f":{col}"
        super().__init__(f"{message}{loc}")


# --- Tokenizer ---

class Token:
    __slots__ = ('type', 'value', 'line', 'col')

    def __init__(self, type, value, line, col):
        self.type = type
        self.value = value
        self.line = line
        self.col = col

    def __repr__(self):
        return f"Token({self.type}, {self.value!r}, L{self.line})"


# Token types
T_STRING = 'STRING'
T_NUMBER = 'NUMBER'
T_BOOL = 'BOOL'
T_NIL = 'NIL'
T_IDENT = 'IDENT'
T_LBRACE = '{'
T_RBRACE = '}'
T_LBRACKET = '['
T_RBRACKET = ']'
T_LPAREN = '('
T_RPAREN = ')'
T_EQUALS = '='
T_COMMA = ','
T_SEMICOL = ';'
T_DOT = '.'
T_CONCAT = '..'
T_EOF = 'EOF'


class Tokenizer:
    """Single-pass tokenizer for Lua data files."""

    def __init__(self, text: str):
        self.text = text
        self.pos = 0
        self.line = 1
        self.col = 1
        self.length = len(text)

    def peek_char(self) -> str:
        if self.pos >= self.length:
            return ''
        return self.text[self.pos]

    def advance(self) -> str:
        ch = self.text[self.pos]
        self.pos += 1
        if ch == '\n':
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return ch

    def skip_whitespace(self):
        while self.pos < self.length and self.text[self.pos] in ' \t\r\n':
            self.advance()

    def skip_comment(self):
        """Skip a -- comment (single-line or block)."""
        # Already consumed '--'
        if self.pos < self.length and self.text[self.pos] == '[':
            # Check for block comment --[[ or --[==[
            level = self._count_long_bracket_level()
            if level >= 0:
                self._skip_long_string(level)
                return
        # Single-line comment
        while self.pos < self.length and self.text[self.pos] != '\n':
            self.pos += 1
            self.col += 1

    def _count_long_bracket_level(self) -> int:
        """Check if we're at a long bracket opening [==[ and return level, or -1."""
        i = self.pos
        if i >= self.length or self.text[i] != '[':
            return -1
        i += 1
        level = 0
        while i < self.length and self.text[i] == '=':
            level += 1
            i += 1
        if i < self.length and self.text[i] == '[':
            return level
        return -1

    def _skip_long_string(self, level: int):
        """Skip past a long bracket string/comment of given level."""
        # Skip opening [==..==[
        self.pos += 2 + level  # [ + =*level + [
        self.col += 2 + level
        closing = ']' + '=' * level + ']'
        close_len = len(closing)
        while self.pos < self.length:
            if self.text[self.pos:self.pos + close_len] == closing:
                self.pos += close_len
                self.col += close_len
                return
            if self.text[self.pos] == '\n':
                self.line += 1
                self.col = 1
            else:
                self.col += 1
            self.pos += 1

    def _read_long_string(self, level: int) -> str:
        """Read a long bracket string and return its content."""
        # Skip opening [==..==[
        self.pos += 2 + level
        self.col += 2 + level
        closing = ']' + '=' * level + ']'
        close_len = len(closing)
        start = self.pos
        while self.pos < self.length:
            if self.text[self.pos:self.pos + close_len] == closing:
                content = self.text[start:self.pos]
                self.pos += close_len
                self.col += close_len
                return content
            if self.text[self.pos] == '\n':
                self.line += 1
                self.col = 1
            else:
                self.col += 1
            self.pos += 1
        return self.text[start:self.pos]

    def _read_string(self, quote: str) -> str:
        """Read a quoted string (single or double)."""
        parts = []
        while self.pos < self.length:
            ch = self.text[self.pos]
            if ch == '\\':
                self.advance()
                if self.pos < self.length:
                    esc = self.advance()
                    if esc == 'n':
                        parts.append('\n')
                    elif esc == 't':
                        parts.append('\t')
                    elif esc == 'r':
                        parts.append('\r')
                    elif esc == '\\':
                        parts.append('\\')
                    elif esc == quote:
                        parts.append(quote)
                    else:
                        parts.append(esc)
            elif ch == quote:
                self.advance()
                return ''.join(parts)
            elif ch == '\n':
                # Unterminated string at newline - include it anyway
                parts.append(ch)
                self.advance()
            else:
                parts.append(ch)
                self.advance()
        return ''.join(parts)

    def _read_number(self, start_char: str) -> float | int:
        """Read a numeric literal."""
        num_str = start_char
        # Hex check
        if start_char == '0' and self.pos < self.length and self.text[self.pos] in 'xX':
            num_str += self.advance()
            while self.pos < self.length and self.text[self.pos] in '0123456789abcdefABCDEF':
                num_str += self.advance()
            return int(num_str, 16)
        # Decimal
        while self.pos < self.length and self.text[self.pos] in '0123456789':
            num_str += self.advance()
        if self.pos < self.length and self.text[self.pos] == '.':
            num_str += self.advance()
            while self.pos < self.length and self.text[self.pos] in '0123456789':
                num_str += self.advance()
        if self.pos < self.length and self.text[self.pos] in 'eE':
            num_str += self.advance()
            if self.pos < self.length and self.text[self.pos] in '+-':
                num_str += self.advance()
            while self.pos < self.length and self.text[self.pos] in '0123456789':
                num_str += self.advance()
        if '.' in num_str or 'e' in num_str or 'E' in num_str:
            return float(num_str)
        return int(num_str)

    def next_token(self) -> Token:
        """Return the next token."""
        while True:
            self.skip_whitespace()
            if self.pos >= self.length:
                return Token(T_EOF, None, self.line, self.col)

            line, col = self.line, self.col
            ch = self.text[self.pos]

            # Comments
            if ch == '-' and self.pos + 1 < self.length and self.text[self.pos + 1] == '-':
                self.pos += 2
                self.col += 2
                self.skip_comment()
                continue

            # Strings
            if ch in '"\'':
                self.advance()
                s = self._read_string(ch)
                return Token(T_STRING, s, line, col)

            # Long strings [[...]]
            if ch == '[':
                level = self._count_long_bracket_level()
                if level >= 0:
                    s = self._read_long_string(level)
                    return Token(T_STRING, s, line, col)
                self.advance()
                return Token(T_LBRACKET, '[', line, col)

            # Negative number literals: a '-' immediately before a digit (or
            # .digit) is a unary-minus literal - e.g. ``-5``, ``-2.5``, or a
            # negative table key ``[-1]``. Keep the sign rather than dropping
            # '-' as a bare operator below; otherwise ``Foo = -5`` parses to
            # ``5`` and the key ``[-1]`` collapses onto ``[1]``. Binary
            # subtraction in these data files is written with surrounding
            # spaces (``a - b``), so it is not mis-read as a literal here.
            if ch == '-' and self.pos + 1 < self.length and (
                self.text[self.pos + 1].isdigit()
                or (self.text[self.pos + 1] == '.'
                    and self.pos + 2 < self.length
                    and self.text[self.pos + 2].isdigit())
            ):
                self.advance()              # consume '-'
                num_ch = self.advance()     # consume first digit / '.'
                n = self._read_number(num_ch)
                return Token(T_NUMBER, -n, line, col)

            # Numbers
            if ch.isdigit() or (ch == '.' and self.pos + 1 < self.length and self.text[self.pos + 1].isdigit()):
                self.advance()
                n = self._read_number(ch)
                return Token(T_NUMBER, n, line, col)

            # Identifiers and keywords
            if ch.isalpha() or ch == '_':
                start = self.pos
                while self.pos < self.length and (self.text[self.pos].isalnum() or self.text[self.pos] == '_'):
                    self.advance()
                word = self.text[start:self.pos]
                if word == 'true':
                    return Token(T_BOOL, True, line, col)
                if word == 'false':
                    return Token(T_BOOL, False, line, col)
                if word == 'nil':
                    return Token(T_NIL, None, line, col)
                return Token(T_IDENT, word, line, col)

            # Single-char tokens
            if ch == '{':
                self.advance()
                return Token(T_LBRACE, '{', line, col)
            if ch == '}':
                self.advance()
                return Token(T_RBRACE, '}', line, col)
            if ch == ']':
                self.advance()
                return Token(T_RBRACKET, ']', line, col)
            if ch == '(':
                self.advance()
                return Token(T_LPAREN, '(', line, col)
            if ch == ')':
                self.advance()
                return Token(T_RPAREN, ')', line, col)
            if ch == '=':
                self.advance()
                # Skip == (comparison operator, not assignment)
                if self.pos < self.length and self.text[self.pos] == '=':
                    self.advance()
                    # Treat as expression token - skip
                    continue
                return Token(T_EQUALS, '=', line, col)
            if ch == ',':
                self.advance()
                return Token(T_COMMA, ',', line, col)
            if ch == ';':
                self.advance()
                return Token(T_SEMICOL, ';', line, col)
            if ch == '.':
                self.advance()
                if self.pos < self.length and self.text[self.pos] == '.':
                    self.advance()
                    return Token(T_CONCAT, '..', line, col)
                return Token(T_DOT, '.', line, col)

            # Operators we can skip in data files
            if ch in '+-*/%^#<>~':
                self.advance()
                # Skip multi-char operators
                if self.pos < self.length and self.text[self.pos] == '=':
                    self.advance()
                continue

            # Unknown char - skip
            self.advance()


# --- Parser ---

class LuaParser:
    """Recursive descent parser for Lua data files."""

    def __init__(self, text: str):
        self.tokenizer = Tokenizer(text)
        self.current = self.tokenizer.next_token()
        self.peeked = None

    def peek(self) -> Token:
        if self.peeked is None:
            self.peeked = self.tokenizer.next_token()
        return self.peeked

    def advance(self) -> Token:
        tok = self.current
        if self.peeked is not None:
            self.current = self.peeked
            self.peeked = None
        else:
            self.current = self.tokenizer.next_token()
        return tok

    def expect(self, token_type: str) -> Token:
        if self.current.type != token_type:
            raise ParseError(
                f"Expected {token_type}, got {self.current.type} ({self.current.value!r})",
                self.current.line, self.current.col
            )
        return self.advance()

    def parse_file(self) -> dict:
        """Parse a Lua file, collecting top-level assignments into a dict."""
        result = {}
        while self.current.type != T_EOF:
            # Skip keywords we don't care about (local, return, function, etc.)
            if self.current.type == T_IDENT and self.current.value in ('local', 'return', 'function', 'if', 'for', 'while', 'do', 'end', 'then', 'else', 'elseif', 'repeat', 'until'):
                self._skip_statement()
                continue

            # Look for: IDENT = value or IDENT.IDENT... = value
            if self.current.type == T_IDENT:
                name_tok = self.advance()
                name = name_tok.value

                # Handle dotted names: Table.SubKey = ...
                while self.current.type == T_DOT:
                    self.advance()
                    if self.current.type == T_IDENT:
                        name += '.' + self.advance().value

                if self.current.type == T_EQUALS:
                    self.advance()
                    value = self.parse_value()
                    # Consume Lua expression continuations like ``X or {}`` /
                    # ``X and Y`` after the RHS value. The initial operand is
                    # what we care about; the rest of the expression is
                    # short-circuit noise from the dialogue extractor's point
                    # of view but must be consumed so we don't bleed into the
                    # next statement. The ``X = X or {}`` idiom is used
                    # throughout H2 to lazily initialise top-level tables
                    # before populating them via ``OverwriteTableKeys`` (e.g.
                    # ``HubRoomData = HubRoomData or {}`` at the top of
                    # ``DeathLoopData.lua``).
                    while (self.current.type == T_IDENT
                           and self.current.value in ('or', 'and')):
                        self.advance()
                        self.parse_value()
                    result[name] = value
                    # Skip optional comma/semicolon
                    if self.current.type in (T_COMMA, T_SEMICOL):
                        self.advance()
                elif name == 'OverwriteTableKeys' and self.current.type == T_LPAREN:
                    # H2 EncounterData_*.lua and DeathLoopData.lua dump their
                    # payload directly inside this call rather than first
                    # assigning it to a named identifier
                    # (``OverwriteTableKeys( HubRoomData, { Hub_Main = ... } )``).
                    # Capture the inline table as if it had been assigned to
                    # the target name so the rest of the pipeline can treat
                    # it uniformly. When the second argument is itself an
                    # identifier (the H1 / H2 NPCData / LootData pattern,
                    # ``OverwriteTableKeys( EnemyData, UnitSetData.NPC_Hecate )``)
                    # there is nothing inline to capture - the source data is
                    # already in ``result`` under its own name, and we skip
                    # the wrapper call as a no-op.
                    self._capture_overwrite_table_keys(result)
                else:
                    # Not an assignment - skip rest of statement
                    self._skip_statement()
                continue

            # Skip anything else
            self.advance()

        return result

    def parse_value(self) -> Any:
        """Parse a Lua value (string, number, bool, nil, table, identifier, expression)."""
        tok = self.current

        if tok.type == T_STRING:
            self.advance()
            return tok.value

        if tok.type == T_NUMBER:
            self.advance()
            return tok.value

        if tok.type == T_BOOL:
            self.advance()
            return tok.value

        if tok.type == T_NIL:
            self.advance()
            return None

        if tok.type == T_LBRACE:
            return self.parse_table()

        if tok.type == T_IDENT:
            ident_tok = self.advance()
            # Check for function call: ident(...)
            if self.current.type == T_LPAREN:
                raw = ident_tok.value + self._consume_balanced('(', ')')
                return LuaExpression(raw)
            # Check for table access: ident.field, ident.field[N], or ident.field(...).
            # ``[N]`` subscripts (e.g. ``ScreenData.GhostAdmin.ItemCategories[1]`` in
            # H2 NPCData_Hecate / NPCData_Nemesis / RequirementsData) are captured
            # verbatim into the identifier name; we never resolve them ourselves,
            # they just need to round-trip through the parser without erroring.
            if self.current.type in (T_DOT, T_LBRACKET):
                name = ident_tok.value
                while self.current.type in (T_DOT, T_LBRACKET):
                    if self.current.type == T_DOT:
                        self.advance()
                        if self.current.type == T_IDENT:
                            name += '.' + self.advance().value
                    else:
                        name += self._consume_balanced('[', ']')
                if self.current.type == T_LPAREN:
                    raw = name + self._consume_balanced('(', ')')
                    return LuaExpression(raw)
                return LuaIdentifier(name)
            return LuaIdentifier(ident_tok.value)

        # Unary minus for negative numbers
        if tok.type == T_IDENT and tok.value == 'not':
            self.advance()
            val = self.parse_value()
            return LuaExpression(f"not {val}")

        # Handle negative numbers (minus sign)
        # The tokenizer skips '-' as an operator, so negative numbers
        # may appear as just a NUMBER token if preceded by the sign.
        # If we get here with unexpected token, store as expression
        if tok.type in (T_LPAREN,):
            raw = self._consume_balanced('(', ')')
            return LuaExpression(raw)

        # Concatenation or other binary expressions after a value
        # shouldn't reach here normally, but handle gracefully
        if tok.type == T_EOF:
            return None

        # Unknown - skip token
        self.advance()
        return None

    def parse_table(self) -> LuaTable:
        """Parse a Lua table literal { ... }."""
        open_brace = self.expect(T_LBRACE)
        table = LuaTable(line=open_brace.line)

        while self.current.type != T_RBRACE and self.current.type != T_EOF:
            # Try to detect: key = value
            if self.current.type == T_IDENT and self.peek().type == T_EQUALS:
                key_tok = self.advance()
                self.advance()  # skip =
                value = self.parse_value()
                # Handle string concatenation: value .. value
                while self.current.type == T_CONCAT:
                    self.advance()
                    right = self.parse_value()
                    if isinstance(value, str) and isinstance(right, str):
                        value = value + right
                    else:
                        value = LuaExpression(f"{value} .. {right}")
                table.named[key_tok.value] = value
            # Bracket key: [expr] = value
            elif self.current.type == T_LBRACKET:
                self.advance()
                key = self.parse_value()
                self.expect(T_RBRACKET)
                self.expect(T_EQUALS)
                value = self.parse_value()
                while self.current.type == T_CONCAT:
                    self.advance()
                    right = self.parse_value()
                    if isinstance(value, str) and isinstance(right, str):
                        value = value + right
                    else:
                        value = LuaExpression(f"{value} .. {right}")
                # Use string or int key
                if isinstance(key, str):
                    table.named[key] = value
                elif isinstance(key, int):
                    table.named[str(key)] = value
                else:
                    table.array.append(value)
            else:
                # Anonymous entry (array element)
                value = self.parse_value()
                if value is not None:
                    # Handle string concatenation
                    while self.current.type == T_CONCAT:
                        self.advance()
                        right = self.parse_value()
                        if isinstance(value, str) and isinstance(right, str):
                            value = value + right
                        else:
                            value = LuaExpression(f"{value} .. {right}")
                    table.array.append(value)

            # Skip separator (comma or semicolon)
            if self.current.type in (T_COMMA, T_SEMICOL):
                self.advance()

        self.expect(T_RBRACE)
        return table

    def _consume_balanced(self, open_char: str, close_char: str) -> str:
        """Consume balanced delimiters and return raw text including delimiters."""
        delim_type = {
            '(': (T_LPAREN, T_RPAREN),
            '{': (T_LBRACE, T_RBRACE),
            '[': (T_LBRACKET, T_RBRACKET),
        }
        open_type, close_type = delim_type[open_char]
        result = open_char
        self.advance()  # consume opening
        depth = 1
        while depth > 0 and self.current.type != T_EOF:
            if self.current.type == open_type:
                depth += 1
                result += open_char
                self.advance()
            elif self.current.type == close_type:
                depth -= 1
                result += close_char
                self.advance()
            elif self.current.type == T_STRING:
                result += f'"{self.current.value}"'
                self.advance()
            elif self.current.type == T_LBRACE and open_char != '{':
                result += self._consume_balanced('{', '}')
            elif self.current.type == T_LPAREN and open_char != '(':
                result += self._consume_balanced('(', ')')
            elif self.current.type == T_LBRACKET and open_char != '[':
                result += self._consume_balanced('[', ']')
            else:
                result += str(self.current.value) if self.current.value is not None else ''
                self.advance()
        return result

    def _skip_statement(self):
        """Skip tokens until we reach a likely top-level assignment.

        Used to recover past constructs we don't care about (function
        definitions, control flow, standalone calls, etc.). A "boundary" is a
        non-keyword identifier followed by ``=`` or ``.`` at depth 0.
        """
        brace_depth = 0
        paren_depth = 0
        bracket_depth = 0
        # Lua statement/control keywords that should never be treated as the
        # start of a new top-level assignment.
        keywords = {
            'local', 'function', 'return', 'if', 'for', 'while', 'do', 'end',
            'then', 'else', 'elseif', 'repeat', 'until', 'in', 'not', 'and', 'or',
        }
        while self.current.type != T_EOF:
            t = self.current.type
            if t == T_LBRACE:
                brace_depth += 1
            elif t == T_RBRACE:
                if brace_depth > 0:
                    brace_depth -= 1
                else:
                    # Unbalanced closing brace: stop and let caller handle it.
                    return
            elif t == T_LPAREN:
                paren_depth += 1
            elif t == T_RPAREN:
                if paren_depth > 0:
                    paren_depth -= 1
            elif t == T_LBRACKET:
                bracket_depth += 1
            elif t == T_RBRACKET:
                if bracket_depth > 0:
                    bracket_depth -= 1
            elif (t == T_IDENT
                  and brace_depth == 0
                  and paren_depth == 0
                  and bracket_depth == 0
                  and self.current.value not in keywords):
                peek_tok = self.peek()
                if peek_tok.type == T_EQUALS or peek_tok.type == T_DOT:
                    return
            self.advance()


    def _capture_overwrite_table_keys(self, result: dict) -> None:
        """Handle a top-level ``OverwriteTableKeys( TARGET, ... )`` call.

        Called when the parser has already consumed the ``OverwriteTableKeys``
        identifier and is positioned on the opening ``(``. Parses the target
        identifier (possibly dotted) and, if the second argument is an inline
        table literal, captures it as if it had been assigned to the target
        name. Tables captured this way merge into any existing entry under the
        same target so that multiple files contributing to the same global
        (e.g. ``EncounterData`` across the ``EncounterData_*.lua`` set) stack
        correctly when their parsed dicts are merged downstream.

        When the second argument is itself an identifier (the standard
        ``OverwriteTableKeys( EnemyData, UnitSetData.NPC_Hecate )`` pattern
        used by NPCData / LootData / EnemyData files), the source data is
        already present in ``result`` under its own name and the wrapper call
        is skipped as a no-op.

        The method always consumes the rest of the call up to and including
        the closing ``)`` so the main loop can resume cleanly.
        """
        self.advance()  # consume '('

        # Parse the target identifier (possibly dotted).
        target_name = None
        if self.current.type == T_IDENT:
            target_name = self.advance().value
            while self.current.type == T_DOT:
                self.advance()
                if self.current.type == T_IDENT:
                    target_name += '.' + self.advance().value

        # Expect ',' then either '{' (inline table) or another value to skip.
        if target_name is not None and self.current.type == T_COMMA:
            self.advance()
            if self.current.type == T_LBRACE:
                table = self.parse_table()
                existing = result.get(target_name)
                if isinstance(existing, LuaTable):
                    for k, v in table.named.items():
                        existing.named[k] = v
                    existing.array.extend(table.array)
                else:
                    result[target_name] = table

        # Consume everything up to and including the call's closing ')'.
        # parse_table left us past the inline table's '}'; whatever remains
        # is trailing arguments and the close paren.
        paren_depth = 1
        while self.current.type != T_EOF and paren_depth > 0:
            t = self.current.type
            if t == T_LPAREN:
                paren_depth += 1
            elif t == T_RPAREN:
                paren_depth -= 1
                if paren_depth == 0:
                    self.advance()
                    break
            self.advance()
        # Skip optional trailing comma/semicolon between statements.
        if self.current.type in (T_COMMA, T_SEMICOL):
            self.advance()


def parse_lua_file(filepath: str) -> dict:
    """Parse a Lua data file and return top-level assignments as a dict."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()
    if text.startswith('\ufeff'):
        text = text.lstrip('\ufeff')
    parser = LuaParser(text)
    return parser.parse_file()
