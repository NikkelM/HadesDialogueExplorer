"""Tests for :mod:`src.extractors.hades2.gamedata_refs`.

The extractor parses a small set of source files
(``NarrativeData.lua`` / ``QuestData.lua`` / ``RunData.lua`` /
``ShrineData.lua``) and returns ``{full.identifier.name:
normalised-value}`` for every top-level assignment whose name matches
one of the registry roots used by ``otherRequirements`` ``<ref:Name>``
placeholders.

Tests use the small Lua-text-fixture pattern so they're independent of
which Steam install is on disk, then a separate smoke test against a
realistic shape confirms list / dict / nested-dict / cross-file
behaviour matches what the viewer expects.
"""

from pathlib import Path

import pytest

from src.extractors.hades2.gamedata_refs import (
    HADES2_GAMEDATA_REF_SOURCE_FILES,
    extract_gamedata_refs,
)


def _write(tmp_path: Path, name: str, body: str) -> None:
    (tmp_path / name).write_text(body, encoding="utf-8")


class TestSourceFilesConstant:
    def test_contains_known_sources(self):
        # NarrativeData carries the bulk; the other three each contribute
        # one or more registry tables referenced from otherRequirements.
        assert "NarrativeData.lua" in HADES2_GAMEDATA_REF_SOURCE_FILES
        assert "QuestData.lua" in HADES2_GAMEDATA_REF_SOURCE_FILES
        assert "RunData.lua" in HADES2_GAMEDATA_REF_SOURCE_FILES
        assert "ShrineData.lua" in HADES2_GAMEDATA_REF_SOURCE_FILES

    def test_all_entries_are_lua_filenames(self):
        for name in HADES2_GAMEDATA_REF_SOURCE_FILES:
            assert isinstance(name, str) and name.endswith(".lua"), name


class TestExtractGamedataRefs:
    def test_returns_empty_when_no_source_files_present(self, tmp_path):
        # No source files in the scripts directory -> empty map. The
        # pipeline still runs; placeholders just stay unresolved.
        assert extract_gamedata_refs(tmp_path) == {}

    def test_captures_top_level_gamedata_list(self, tmp_path):
        _write(
            tmp_path,
            "NarrativeData.lua",
            'GameData.AllWeaponAspects = { "AspectA", "AspectB", "AspectC" }\n',
        )
        refs = extract_gamedata_refs(tmp_path)
        assert refs["GameData.AllWeaponAspects"] == ["AspectA", "AspectB", "AspectC"]

    def test_captures_questorderdata_by_exact_name(self, tmp_path):
        _write(
            tmp_path,
            "QuestData.lua",
            'QuestOrderData = { "QuestOne", "QuestTwo" }\n',
        )
        refs = extract_gamedata_refs(tmp_path)
        assert refs["QuestOrderData"] == ["QuestOne", "QuestTwo"]

    def test_captures_nested_screendata_table(self, tmp_path):
        _write(
            tmp_path,
            "ShrineData.lua",
            (
                "ScreenData.Shrine = {\n"
                '    BountyOrder = { "BountyA", "BountyB" },\n'
                "    Other = 42,\n"
                "}\n"
            ),
        )
        refs = extract_gamedata_refs(tmp_path)
        assert "ScreenData.Shrine" in refs
        assert refs["ScreenData.Shrine"]["BountyOrder"] == ["BountyA", "BountyB"]
        assert refs["ScreenData.Shrine"]["Other"] == 42

    def test_ignores_assignments_outside_registry_roots(self, tmp_path):
        _write(
            tmp_path,
            "NarrativeData.lua",
            (
                'GameData.Allowed = { "x" }\n'
                'UnitSetData.NPC_Foo_01 = { Speaker = "Foo" }\n'
                'LootSetData.Athena = { "y" }\n'
                'SomeRandomGlobal = "no"\n'
            ),
        )
        refs = extract_gamedata_refs(tmp_path)
        assert "GameData.Allowed" in refs
        assert "UnitSetData.NPC_Foo_01" not in refs
        assert "LootSetData.Athena" not in refs
        assert "SomeRandomGlobal" not in refs

    def test_later_file_overwrites_earlier_for_same_key(self, tmp_path):
        # Order in HADES2_GAMEDATA_REF_SOURCE_FILES is the read order;
        # later files overwrite earlier ones on key collision. The
        # constant intentionally puts NarrativeData first because it
        # owns the bulk of the canonical definitions.
        _write(
            tmp_path,
            "NarrativeData.lua",
            'GameData.Shared = { "from-narrative" }\n',
        )
        _write(
            tmp_path,
            "RunData.lua",
            'GameData.Shared = { "from-rundata" }\n',
        )
        refs = extract_gamedata_refs(tmp_path)
        # RunData is listed after NarrativeData in the source-file
        # tuple, so its value wins.
        idx_narr = HADES2_GAMEDATA_REF_SOURCE_FILES.index("NarrativeData.lua")
        idx_run = HADES2_GAMEDATA_REF_SOURCE_FILES.index("RunData.lua")
        assert idx_run > idx_narr
        assert refs["GameData.Shared"] == ["from-rundata"]

    def test_merges_keys_across_files(self, tmp_path):
        _write(
            tmp_path,
            "NarrativeData.lua",
            'GameData.FromNarrative = { "a" }\n',
        )
        _write(
            tmp_path,
            "QuestData.lua",
            'QuestOrderData = { "q1" }\n',
        )
        refs = extract_gamedata_refs(tmp_path)
        assert "GameData.FromNarrative" in refs
        assert "QuestOrderData" in refs

    def test_lazy_init_idiom_does_not_overwrite(self, tmp_path):
        # ``X = X or {}`` is a lazy-init pattern; the parser surfaces
        # the right-hand-side identifier as a string ref. The real
        # definition (a full table literal) wins because we capture
        # in declaration order and the later assignment overrides.
        _write(
            tmp_path,
            "NarrativeData.lua",
            (
                "GameData.LazyInit = GameData.LazyInit or {}\n"
                'GameData.LazyInit = { "real" }\n'
            ),
        )
        refs = extract_gamedata_refs(tmp_path)
        assert refs["GameData.LazyInit"] == ["real"]


class TestRealDataSmoke:
    """End-to-end smoke against the real H2 source tree when present.

    Skipped automatically on machines without the Steam install. Pinning
    the exact set of refs would be brittle (Supergiant patches add to
    these tables), so we only assert the structural invariants the
    viewer relies on.
    """

    @pytest.fixture
    def real_scripts(self):
        path = Path("C:/Program Files (x86)/Steam/steamapps/common/Hades II/Content/Scripts")
        if not path.exists():
            pytest.skip("Hades II install not present on this machine")
        return path

    def test_captures_canonical_god_about_god_events(self, real_scripts):
        refs = extract_gamedata_refs(real_scripts)
        # GameData.GodAboutGodEvents is referenced from ~123
        # otherRequirements records - the single most-cited ref. If
        # this drops to <50 entries the extractor regressed.
        entries = refs.get("GameData.GodAboutGodEvents")
        assert isinstance(entries, list)
        assert len(entries) > 50
        assert all(isinstance(e, str) for e in entries)

    def test_captures_questorderdata(self, real_scripts):
        refs = extract_gamedata_refs(real_scripts)
        entries = refs.get("QuestOrderData")
        assert isinstance(entries, list)
        assert len(entries) > 10

    def test_captures_shrine_bounty_order_via_nested_screendata(self, real_scripts):
        refs = extract_gamedata_refs(real_scripts)
        shrine = refs.get("ScreenData.Shrine")
        assert isinstance(shrine, dict)
        bounty = shrine.get("BountyOrder")
        assert isinstance(bounty, list)
        assert len(bounty) > 10
