"""Tests for the H2 RequirementSet walker (req_extractor).

Covers the four output channels (``requirements`` / ``otherRequirements`` /
``orBranches`` / ``flags``) plus the per-feature contracts:

* H1-compatible synthetic-key mapping for both container-form
  (``Path = {root, TextLinesRecord}, HasX = {names}``) AND direct-path
  form (``PathTrue = {root, TextLinesRecord, "Name"}``).
* Multiple records into the same synthetic key merge (per-record
  entries are AND'd by the engine).
* ``NamedRequirements`` inline-expand with cycle protection.
* ``NamedRequirementsFalse`` is surfaced in otherRequirements rather
  than inverted.
* ``OrRequirements`` branches walked into ``orBranches`` separately.
* ``Skip`` / ``Force`` / ``ChanceToPlay`` flags propagate (including
  through expanded named requirements).
* Non-dialogue records (FunctionName, Comparison, room-name paths,
  etc.) end up in ``otherRequirements`` with synthesised keys.
* Inheritance directives (``Append`` / ``DeepInheritance`` /
  ``PlayFirst``) are silently dropped.
"""

from src.lua_parser import LuaParser, LuaTable
from src.extractors.hades2.req_extractor import (
    HADES2_REQUIREMENT_SET_FIELDS,
    extract_requirements,
)


def _parse_req_set(lua_text):
    """Parse a Lua snippet of the form ``X = { ... }`` and return the
    value of ``X`` as a LuaTable - i.e. a RequirementSet ready to feed
    the walker."""
    parsed = LuaParser(f"R = {lua_text}").parse_file()
    return parsed["R"]


class TestEmptyAndNonTable:
    def test_none_returns_empty_result(self):
        result = extract_requirements(None)
        assert result == {
            "requirements": {},
            "otherRequirements": {},
            "orBranches": [],
            "flags": {},
        }

    def test_empty_req_set_returns_empty_result(self):
        result = extract_requirements(LuaTable())
        assert result["requirements"] == {}
        assert result["otherRequirements"] == {}
        assert result["orBranches"] == []
        assert result["flags"] == {}

    def test_non_lua_table_returns_empty(self):
        result = extract_requirements("bogus")
        assert result["requirements"] == {}


class TestSetLevelFlags:
    def test_skip_flag(self):
        result = extract_requirements(_parse_req_set('{ Skip = true }'))
        assert result["flags"] == {"skip": True}

    def test_force_flag(self):
        result = extract_requirements(_parse_req_set('{ Force = true }'))
        assert result["flags"] == {"force": True}

    def test_chance_to_play(self):
        result = extract_requirements(_parse_req_set('{ ChanceToPlay = 0.25 }'))
        assert result["flags"] == {"chanceToPlay": 0.25}

    def test_flags_with_records_coexist(self):
        lua = '{ ChanceToPlay = 0.5, { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["flags"]["chanceToPlay"] == 0.5
        assert result["requirements"]["RequiredTextLines"] == ["A"]


class TestContainerFormDialogueEdges:
    def test_gamestate_textlines_hasall(self):
        lua = '{ { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A", "B" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredTextLines": ["A", "B"]}

    def test_gamestate_textlines_hasany(self):
        lua = '{ { Path = { "GameState", "TextLinesRecord" }, HasAny = { "A", "B" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredAnyTextLines": ["A", "B"]}

    def test_gamestate_textlines_hasnone(self):
        lua = '{ { Path = { "GameState", "TextLinesRecord" }, HasNone = { "A", "B" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredFalseTextLines": ["A", "B"]}

    def test_currentrun_textlines_hasall(self):
        lua = '{ { Path = { "CurrentRun", "TextLinesRecord" }, HasAll = { "X" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredTextLinesThisRun": ["X"]}

    def test_currentrun_textlines_hasnone(self):
        lua = '{ { Path = { "CurrentRun", "TextLinesRecord" }, HasNone = { "X", "Y" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredFalseTextLinesThisRun": ["X", "Y"]}

    def test_prevrun_textlines_hasany(self):
        lua = '{ { Path = { "PrevRun", "TextLinesRecord" }, HasAny = { "X" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredAnyTextLinesLastRun": ["X"]}

    def test_queued_textlines_hasall(self):
        lua = '{ { Path = { "CurrentRun", "QueuedTextLines" }, HasAll = { "Q1" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredQueuedTextLines": ["Q1"]}


class TestDirectPathFormDialogueEdges:
    def test_pathtrue_gamestate_textline(self):
        lua = '{ { PathTrue = { "GameState", "TextLinesRecord", "NemesisGift05" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredTextLines": ["NemesisGift05"]}

    def test_pathfalse_gamestate_textline(self):
        lua = '{ { PathFalse = { "GameState", "TextLinesRecord", "NemesisGift05" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredFalseTextLines": ["NemesisGift05"]}

    def test_pathtrue_currentrun_textline(self):
        lua = '{ { PathTrue = { "CurrentRun", "TextLinesRecord", "X" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredTextLinesThisRun": ["X"]}

    def test_pathfalse_currentrun_textline(self):
        lua = '{ { PathFalse = { "CurrentRun", "TextLinesRecord", "X" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredFalseTextLinesThisRun": ["X"]}


class TestMultipleRecordsMerge:
    def test_multiple_pathtrue_records_merge_into_same_key(self):
        """Per-record entries are AND'd by the engine, so two PathTrue
        records into GameState.TextLinesRecord become a single synthetic
        ``RequiredTextLines`` list with both names."""
        lua = '''
        {
            { PathTrue = { "GameState", "TextLinesRecord", "A" } },
            { PathTrue = { "GameState", "TextLinesRecord", "B" } },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {"RequiredTextLines": ["A", "B"]}

    def test_container_and_direct_path_merge(self):
        """Container HasAll[A] AND direct PathTrue[B] AND HasAll[C] all
        AND'd -> RequiredTextLines = [A, C, B] (insertion order preserved)."""
        lua = '''
        {
            { Path = { "GameState", "TextLinesRecord" }, HasAll = { "A", "C" } },
            { PathTrue = { "GameState", "TextLinesRecord", "B" } },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"]["RequiredTextLines"] == ["A", "C", "B"]

    def test_merge_dedupes_repeated_names(self):
        lua = '''
        {
            { PathTrue = { "GameState", "TextLinesRecord", "A" } },
            { PathTrue = { "GameState", "TextLinesRecord", "A" } },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"]["RequiredTextLines"] == ["A"]

    def test_different_path_roots_get_separate_keys(self):
        lua = '''
        {
            { PathTrue = { "GameState",  "TextLinesRecord", "A" } },
            { PathTrue = { "CurrentRun", "TextLinesRecord", "B" } },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {
            "RequiredTextLines": ["A"],
            "RequiredTextLinesThisRun": ["B"],
        }


class TestOtherRequirements:
    def test_function_name_record(self):
        lua = '{ { FunctionName = "RequiredAlive", FunctionArgs = { "Hera" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert "FunctionName:RequiredAlive" in result["otherRequirements"]
        assert result["requirements"] == {}

    def test_room_name_path(self):
        lua = '{ { Path = { "CurrentRun", "CurrentRoom", "Name" }, IsAny = { "N_Opening01" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {}
        assert "Path:CurrentRun.CurrentRoom.Name" in result["otherRequirements"]

    def test_pathtrue_non_textline_path(self):
        lua = '{ { PathTrue = { "CurrentRun", "IsDreamRun" } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {}
        assert "PathTrue:CurrentRun.IsDreamRun" in result["otherRequirements"]

    def test_comparison_path_record(self):
        lua = '{ { Path = { "GameState", "SpentShrinePointsCache" }, Comparison = ">=", Value = 5 } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {}
        assert "Path:GameState.SpentShrinePointsCache" in result["otherRequirements"]

    def test_multiple_function_records_stack_into_list(self):
        lua = '''
        {
            { FunctionName = "RequiredAlive", FunctionArgs = { "Hera" } },
            { FunctionName = "RequiredAlive", FunctionArgs = { "Hephaestus" } },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        bucket = result["otherRequirements"]["FunctionName:RequiredAlive"]
        assert isinstance(bucket, list)
        assert len(bucket) == 2

    def test_textline_path_with_comparison_falls_through_to_other(self):
        """Comparison aggregator on TextLinesRecord doesn't map to an H1
        field - the value being tested is a COUNT, not a name list."""
        lua = '{ { Path = { "GameState", "TextLinesRecord" }, UseLength = true, Comparison = ">=", Value = 10 } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {}
        assert "Path:GameState.TextLinesRecord" in result["otherRequirements"]


class TestInheritanceDirectives:
    def test_deep_inheritance_directive_silently_dropped(self):
        lua = '{ { DeepInheritance = true } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["otherRequirements"] == {}

    def test_append_directive_silently_dropped(self):
        lua = '{ { Append = true } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["otherRequirements"] == {}

    def test_play_first_directive_silently_dropped(self):
        lua = '{ { PlayFirst = true } }'
        result = extract_requirements(_parse_req_set(lua))
        assert result["otherRequirements"] == {}

    def test_inheritance_directive_alongside_real_op_kept(self):
        """If a record carries both a directive AND a real check, the
        directive is dropped from the otherRequirements view but the
        real check still lands there."""
        lua = '{ { Append = true, FunctionName = "RequiredAlive" } }'
        result = extract_requirements(_parse_req_set(lua))
        bucket = result["otherRequirements"].get("FunctionName:RequiredAlive")
        assert bucket
        entry = bucket[0] if isinstance(bucket, list) else bucket
        assert "Append" not in entry


class TestNamedRequirementsExpansion:
    def test_named_requirement_expanded_inline(self):
        named = {
            "ScyllaUnlocked": _parse_req_set(
                '{ { PathTrue = { "GameState", "TextLinesRecord", "ScyllaIntro01" } } }'),
        }
        host = _parse_req_set('{ NamedRequirements = { "ScyllaUnlocked" } }')
        result = extract_requirements(host, named)
        assert result["requirements"] == {"RequiredTextLines": ["ScyllaIntro01"]}

    def test_unresolved_named_requirement_surfaced_as_other(self):
        host = _parse_req_set('{ NamedRequirements = { "UnknownName" } }')
        result = extract_requirements(host, {})
        assert result["requirements"] == {}
        assert "UnknownName" in result["otherRequirements"]["NamedRequirements"]

    def test_named_requirement_chain_recursive(self):
        """``A`` -> ``B`` -> textline record. Walker recurses through
        the chain and surfaces the leaf's textline edge on the host."""
        named = {
            "A": _parse_req_set('{ NamedRequirements = { "B" } }'),
            "B": _parse_req_set(
                '{ { PathTrue = { "GameState", "TextLinesRecord", "Leaf01" } } }'),
        }
        host = _parse_req_set('{ NamedRequirements = { "A" } }')
        result = extract_requirements(host, named)
        assert result["requirements"] == {"RequiredTextLines": ["Leaf01"]}

    def test_named_requirement_merges_with_host_records(self):
        named = {
            "ScyllaUnlocked": _parse_req_set(
                '{ { PathTrue = { "GameState", "TextLinesRecord", "ScyllaIntro01" } } }'),
        }
        host = _parse_req_set('''
        {
            { PathTrue = { "GameState", "TextLinesRecord", "MelinoeReady01" } },
            NamedRequirements = { "ScyllaUnlocked" },
        }
        ''')
        result = extract_requirements(host, named)
        assert set(result["requirements"]["RequiredTextLines"]) == {
            "MelinoeReady01", "ScyllaIntro01"
        }

    def test_named_requirement_cycle_protection(self):
        """``A`` -> ``B`` -> ``A`` - walker must not recurse infinitely."""
        named = {
            "A": _parse_req_set('{ NamedRequirements = { "B" } }'),
            "B": _parse_req_set('{ NamedRequirements = { "A" } }'),
        }
        host = _parse_req_set('{ NamedRequirements = { "A" } }')
        result = extract_requirements(host, named)
        # No infinite loop. Either cycle breadcrumb or nothing surfaced.
        assert "NamedRequirementsCycle" in result["otherRequirements"]

    def test_self_referential_named_requirement(self):
        named = {"Selfie": _parse_req_set('{ NamedRequirements = { "Selfie" } }')}
        host = _parse_req_set('{ NamedRequirements = { "Selfie" } }')
        result = extract_requirements(host, named)
        # No crash; the cycle breadcrumb should be there.
        assert "NamedRequirementsCycle" in result["otherRequirements"]

    def test_named_requirement_flags_propagate(self):
        """A ``Skip = true`` inside an expanded named req still short-circuits the host."""
        named = {"AlwaysSkip": _parse_req_set('{ Skip = true }')}
        host = _parse_req_set('{ NamedRequirements = { "AlwaysSkip" } }')
        result = extract_requirements(host, named)
        assert result["flags"].get("skip") is True


class TestNamedRequirementsFalse:
    def test_namedfalse_surfaced_not_inlined(self):
        """NamedRequirementsFalse with a target that has textline refs
        must NOT inline those as inverted edges - just surface the names."""
        named = {
            "FirstSurfaceVisit": _parse_req_set(
                '{ { Path = { "CurrentRun", "CurrentRoom", "Name" }, IsAny = { "N_Opening01" } } }'),
        }
        host = _parse_req_set('{ NamedRequirementsFalse = { "FirstSurfaceVisit" } }')
        result = extract_requirements(host, named)
        assert result["requirements"] == {}
        assert "FirstSurfaceVisit" in result["otherRequirements"]["NamedRequirementsFalse"]

    def test_namedfalse_multiple_names(self):
        host = _parse_req_set('{ NamedRequirementsFalse = { "A", "B" } }')
        result = extract_requirements(host, {})
        assert result["otherRequirements"]["NamedRequirementsFalse"] == ["A", "B"]


class TestOrBranches:
    def test_or_branch_walked_separately(self):
        lua = '''
        {
            OrRequirements =
            {
                { { PathTrue = { "GameState", "TextLinesRecord", "OptA" } } },
                { { PathTrue = { "GameState", "TextLinesRecord", "OptB" } } },
            }
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"] == {}
        assert len(result["orBranches"]) == 2
        assert result["orBranches"][0]["requirements"]["RequiredTextLines"] == ["OptA"]
        assert result["orBranches"][1]["requirements"]["RequiredTextLines"] == ["OptB"]

    def test_or_branches_alongside_and_records(self):
        """The host's per-record entries still AND with the OR group as a whole."""
        lua = '''
        {
            { PathTrue = { "GameState", "TextLinesRecord", "AlwaysReq" } },
            OrRequirements =
            {
                { { PathTrue = { "GameState", "TextLinesRecord", "OptA" } } },
                { { PathTrue = { "GameState", "TextLinesRecord", "OptB" } } },
            },
        }
        '''
        result = extract_requirements(_parse_req_set(lua))
        assert result["requirements"]["RequiredTextLines"] == ["AlwaysReq"]
        assert len(result["orBranches"]) == 2

    def test_empty_or_branches_dropped(self):
        lua = '{ OrRequirements = { { }, { { PathTrue = { "GameState", "TextLinesRecord", "X" } } } } }'
        result = extract_requirements(_parse_req_set(lua))
        assert len(result["orBranches"]) == 1


class TestPublicAPI:
    def test_requirement_set_fields_is_frozenset(self):
        assert isinstance(HADES2_REQUIREMENT_SET_FIELDS, frozenset)

    def test_requirement_set_fields_includes_core_names(self):
        # Spot-check the most common fields - regression guard against
        # an accidental rename / typo in the allowlist.
        for fld in (
            "GameStateRequirements",
            "SetupGameStateRequirements",
            "CompleteGameStateRequirements",
            "PurchaseRequirements",
            "BoughtTextLinesRequirements",
            "MusicMixerRequirements",
            "ZagreusContractRequirement",  # singular
            "MaxedRequirement",            # singular
        ):
            assert fld in HADES2_REQUIREMENT_SET_FIELDS, fld
