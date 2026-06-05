"""Unit tests for the private helper ``_normalize_value`` in
``src/extractors/textline_set.py``.

The helper has a fail-loud guard for mixed-shape Lua tables: tables that
populate BOTH the array part and the named part at the same time. No
requirement field across the H1 sources currently uses this idiom, but
the earlier version of the helper silently dropped the array half,
which would have caused data loss with no diagnostic if a future
H2 (or new H1) field used the mixed-table shape. The guard raises a
ValueError with the relevant table context so the developer is forced
to add an explicit representation rather than silently losing data.
"""

import pytest

from src.lua_parser import LuaTable, LuaIdentifier, LuaExpression
from src.extractors.textline_set import _normalize_value


class TestPureShapes:
    """The two pure shapes (array-only, named-only) round-trip cleanly,
    matching the pre-fix behaviour."""

    def test_array_only_returns_list(self):
        tbl = LuaTable(array=["a", "b", "c"])
        assert _normalize_value(tbl) == ["a", "b", "c"]

    def test_named_only_returns_dict(self):
        tbl = LuaTable(named={"x": 1, "y": 2})
        assert _normalize_value(tbl) == {"x": 1, "y": 2}

    def test_empty_table_returns_empty_dict(self):
        """An empty LuaTable is treated as a named dict for backwards
        compatibility - the empty-array case would be indistinguishable
        and a dict is the safer default for downstream JSON serialisation
        of otherRequirements entries."""
        assert _normalize_value(LuaTable()) == {}


class TestMixedShapeFailsLoud:
    """The latent-bug guard: any LuaTable with BOTH array and named
    parts populated must raise so data can't silently vanish."""

    def test_mixed_table_raises(self):
        tbl = LuaTable(named={"Count": 3}, array=["A", "B"])
        with pytest.raises(ValueError, match="mixed-shape LuaTable"):
            _normalize_value(tbl)

    def test_error_message_includes_diagnostic_context(self):
        tbl = LuaTable(named={"Count": 3, "Mode": "X"}, array=["A", "B"], line=42)
        with pytest.raises(ValueError) as excinfo:
            _normalize_value(tbl)
        msg = str(excinfo.value)
        # Counts should help the developer locate the offending table.
        assert "2 entries" in msg          # array length
        assert "named (2 entries)" in msg  # named length
        # Named keys are listed sorted so the message is deterministic.
        assert "'Count'" in msg
        assert "'Mode'" in msg
        # Source line propagates from the LuaTable for traceability.
        assert "42" in msg

    def test_mixed_table_nested_inside_named_also_raises(self):
        """The guard must fire even when the mixed table is nested
        deep inside an otherwise-pure named dict, since _normalize_value
        recurses on every value."""
        inner = LuaTable(named={"k": 1}, array=["v"])
        outer = LuaTable(named={"nested": inner})
        with pytest.raises(ValueError, match="mixed-shape LuaTable"):
            _normalize_value(outer)

    def test_mixed_table_nested_inside_array_also_raises(self):
        inner = LuaTable(named={"k": 1}, array=["v"])
        outer = LuaTable(array=[inner])
        with pytest.raises(ValueError, match="mixed-shape LuaTable"):
            _normalize_value(outer)


class TestNonTableValues:
    """Pass-through behaviour for non-table values is unchanged."""

    def test_primitives_pass_through(self):
        assert _normalize_value("hello") == "hello"
        assert _normalize_value(42) == 42
        assert _normalize_value(3.14) == 3.14
        assert _normalize_value(True) is True
        assert _normalize_value(None) is None

    def test_lua_identifier_returns_name(self):
        assert _normalize_value(LuaIdentifier(name="SomeRef")) == "SomeRef"

    def test_lua_identifier_resolves_against_gamedata_lists(self):
        game_data = {"MyList": ["A", "B", "C"]}
        result = _normalize_value(LuaIdentifier(name="MyList"), game_data_lists=game_data)
        assert result == ["A", "B", "C"]

    def test_lua_expression_returns_raw(self):
        assert _normalize_value(LuaExpression(raw="x + 1")) == "x + 1"
