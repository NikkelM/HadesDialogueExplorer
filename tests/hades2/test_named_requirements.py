"""Tests for the H2 NamedRequirementsData loader.

Covers the loader contract (parse a RequirementsData.lua-shaped table
into a ``{name: RequirementSet}`` dict) plus a smoke test against
synthetic fixtures shaped like the real registry, including:

* set-level gate keys (``NamedRequirementsFalse``) coexisting with
  per-record array entries on the same value
* nested ``OrRequirements`` branches (each branch is itself a
  RequirementSet)
* the engine's tail-end ``DebugData.LegalGenericRequirementKeys`` /
  ``DebugData.LegalNonGenericRequirementKeys`` blocks being ignored
"""

from src.lua_parser import LuaParser, LuaTable
from src.extractors.hades2.named_requirements import (
    NAMED_REQUIREMENTS_KEY,
    extract_named_requirements,
)


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestExtractNamedRequirements:
    def test_empty_parsed_returns_empty_map(self):
        assert extract_named_requirements({}) == {}

    def test_missing_registry_returns_empty_map(self):
        lua = '''SomeOtherTable = { Foo = "bar" }'''
        assert extract_named_requirements(parse(lua)) == {}

    def test_simple_registry_extracted(self):
        lua = '''
        NamedRequirementsData =
        {
            AllWeaponsUnlocked =
            {
                { Path = { "GameState", "WeaponsUnlocked" }, HasAll = { "WeaponA" } },
            },
            FirstSurfaceVisit =
            {
                { Path = { "CurrentRun", "CurrentRoom", "Name" }, IsAny = { "N_Opening01" } },
            },
        }
        '''
        result = extract_named_requirements(parse(lua))
        assert set(result.keys()) == {"AllWeaponsUnlocked", "FirstSurfaceVisit"}

    def test_values_are_lua_tables(self):
        lua = '''
        NamedRequirementsData =
        {
            Foo = { { PathTrue = { "GameState", "TextLinesRecord", "Bar01" } } },
        }
        '''
        result = extract_named_requirements(parse(lua))
        foo = result["Foo"]
        assert isinstance(foo, LuaTable)
        assert len(foo.array) == 1
        record = foo.array[0]
        assert isinstance(record, LuaTable)
        assert "PathTrue" in record.named

    def test_set_level_keys_preserved_on_value(self):
        """Set-level gates (NamedRequirementsFalse / OrRequirements / ...)
        live on the RequirementSet's named dict alongside per-record array
        entries. The loader must NOT discard either side."""
        lua = '''
        NamedRequirementsData =
        {
            OlympianOnSpawnVoiceLinesAllowed =
            {
                { Path = { "GameState", "TextLinesRecord", "Foo" }, IsNone = { "Bar" } },
                { FunctionName = "RequiredAlive", FunctionArgs = { "SomeUnit" } },
                NamedRequirementsFalse = { "FirstSurfaceVisit" },
            },
        }
        '''
        result = extract_named_requirements(parse(lua))
        oo = result["OlympianOnSpawnVoiceLinesAllowed"]
        assert len(oo.array) == 2, "two per-record entries"
        assert "NamedRequirementsFalse" in oo.named, "set-level gate preserved"
        assert oo.named["NamedRequirementsFalse"].array == ["FirstSurfaceVisit"]

    def test_or_requirements_branches_preserved_as_lua_tables(self):
        """Each OrRequirements branch is itself a RequirementSet - the
        loader returns them as raw LuaTables so the req extractor can
        recursively walk them later."""
        lua = '''
        NamedRequirementsData =
        {
            HasEitherUpgrade =
            {
                OrRequirements =
                {
                    { { PathTrue = { "GameState", "TextLinesRecord", "UpgradeA" } } },
                    { { PathTrue = { "GameState", "TextLinesRecord", "UpgradeB" } } },
                },
            },
        }
        '''
        result = extract_named_requirements(parse(lua))
        entry = result["HasEitherUpgrade"]
        branches = entry.named["OrRequirements"]
        assert isinstance(branches, LuaTable)
        assert len(branches.array) == 2
        for branch in branches.array:
            assert isinstance(branch, LuaTable)
            assert len(branch.array) == 1

    def test_debug_data_enumerations_ignored(self):
        """RequirementsData.lua's tail-end DebugData blocks are siblings
        of NamedRequirementsData (parsed as separate top-level keys),
        not entries inside it, so they must not leak into the result."""
        lua = '''
        NamedRequirementsData =
        {
            FirstSurfaceVisit = { { PathTrue = { "GameState", "x", "y" } } },
        }
        DebugData = { }
        DebugData.LegalGenericRequirementKeys = { "PathTrue", "PathFalse", "HasAny" }
        DebugData.LegalNonGenericRequirementKeys = { "Skip", "Force", "ChanceToPlay" }
        '''
        result = extract_named_requirements(parse(lua))
        assert set(result.keys()) == {"FirstSurfaceVisit"}

    def test_non_string_keys_skipped(self):
        """Defensive: a malformed registry with array entries shouldn't
        crash the loader."""
        lua = '''
        NamedRequirementsData =
        {
            "garbage",
            ValidEntry = { { PathTrue = { "GameState", "x", "y" } } },
        }
        '''
        result = extract_named_requirements(parse(lua))
        assert set(result.keys()) == {"ValidEntry"}

    def test_non_table_value_skipped(self):
        """A scalar masquerading under the registry shouldn't appear in
        the result - downstream code assumes values are RequirementSets."""
        lua = '''
        NamedRequirementsData =
        {
            BogusFlag = true,
            ValidEntry = { { PathTrue = { "GameState", "x", "y" } } },
        }
        '''
        result = extract_named_requirements(parse(lua))
        assert set(result.keys()) == {"ValidEntry"}

    def test_non_table_registry_returns_empty(self):
        """If NamedRequirementsData itself somehow isn't a table (e.g. a
        boolean stub), we return empty rather than raising."""
        assert extract_named_requirements({NAMED_REQUIREMENTS_KEY: True}) == {}

    def test_registry_key_constant_matches_implementation(self):
        """Guards against accidental rename of the key without updating
        callers (the constant is part of the public surface)."""
        assert NAMED_REQUIREMENTS_KEY == "NamedRequirementsData"
