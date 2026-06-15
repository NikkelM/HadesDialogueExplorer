"""Tests for the H2 NarrativeData priority extractor.

Covers the parse + per-textline annotation contract of
:func:`.narrative_data.extract_narrative_priorities` and the in-place
attachment helper :func:`.narrative_data.apply_narrative_priorities`:

* Solo entries get ``narrativePriorityOrdinal`` and
  ``narrativePrioritySectionSize``, with an empty
  ``narrativePriorityClusterMembers``.
* Inline-table entries (cluster sub-arrays) all share an ordinal and
  each lists its siblings in ``narrativePriorityClusterMembers``.
* The ``<Stem>TextLinePriorities`` -> ``<Stem>TextLineSets`` /
  ``<Stem>TextLines`` mapping resolves to the section keys used by
  the textline extractors.
* Apply step is robust to missing owners / sections / textlines and
  reports an accurate attached count.
"""

import pytest

from src.lua_parser import LuaParser
from src.extractors.hades2.narrative_data import (
    apply_narrative_priorities,
    extract_narrative_priorities,
)


def _parse(text: str):
    return LuaParser(text).parse_file()


class TestDiscovery:
    def test_no_narrative_data_returns_empty(self):
        parsed = _parse("SomethingElse = { Foo = 1 }")
        assert extract_narrative_priorities(parsed) == {}

    def test_owner_with_no_priority_keys_skipped(self):
        # NPC entry contains non-priority fields only (real example
        # from Hecate's section in NarrativeData.lua).
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    SpecialGiftTrackHintId = "Hint01",
                    BonusGiftHeartRequirements = { Count = 3 },
                },
            } )
        """)
        assert extract_narrative_priorities(parsed) == {}

    def test_owner_with_empty_priority_list_skipped(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    InteractTextLinePriorities = {},
                },
            } )
        """)
        assert extract_narrative_priorities(parsed) == {}


class TestSoloEntries:
    def test_solo_entries_get_sequential_ordinals(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    InteractTextLinePriorities = {
                        "HecateA",
                        "HecateB",
                        "HecateC",
                    },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["NPC_Hecate_01"]["InteractTextLineSets"]
        assert section["HecateA"]["narrativePriorityOrdinal"] == 1
        assert section["HecateB"]["narrativePriorityOrdinal"] == 2
        assert section["HecateC"]["narrativePriorityOrdinal"] == 3

    def test_section_size_matches_last_ordinal(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    InteractTextLinePriorities = { "A", "B", "C" },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["NPC_Hecate_01"]["InteractTextLineSets"]
        for name in ("A", "B", "C"):
            assert section[name]["narrativePrioritySectionSize"] == 3

    def test_solo_entries_have_empty_cluster_members(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    InteractTextLinePriorities = { "A" },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["NPC_Hecate_01"]["InteractTextLineSets"]
        assert section["A"]["narrativePriorityClusterMembers"] == []


class TestClusterEntries:
    def test_cluster_members_share_ordinal(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                Chronos = {
                    BossIntroTextLinePriorities = {
                        "ChronosA",
                        { "ChronosB", "ChronosC" },
                        "ChronosD",
                    },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["Chronos"]["BossIntroTextLineSets"]
        # A=1, {B,C}=2 (tied), D=3
        assert section["ChronosA"]["narrativePriorityOrdinal"] == 1
        assert section["ChronosB"]["narrativePriorityOrdinal"] == 2
        assert section["ChronosC"]["narrativePriorityOrdinal"] == 2
        assert section["ChronosD"]["narrativePriorityOrdinal"] == 3

    def test_cluster_members_list_siblings(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                Chronos = {
                    BossIntroTextLinePriorities = {
                        { "ChronosA", "ChronosB", "ChronosC" },
                    },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["Chronos"]["BossIntroTextLineSets"]
        assert sorted(section["ChronosA"]["narrativePriorityClusterMembers"]) == ["ChronosB", "ChronosC"]
        assert sorted(section["ChronosB"]["narrativePriorityClusterMembers"]) == ["ChronosA", "ChronosC"]
        assert sorted(section["ChronosC"]["narrativePriorityClusterMembers"]) == ["ChronosA", "ChronosB"]

    def test_cluster_counts_as_one_slot_in_section_size(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                Chronos = {
                    BossIntroTextLinePriorities = {
                        "A",
                        { "B", "C" },
                        "D",
                        { "E", "F", "G" },
                    },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["Chronos"]["BossIntroTextLineSets"]
        # 4 ordinal slots (A, {B,C}, D, {E,F,G})
        for name in ("A", "B", "C", "D", "E", "F", "G"):
            assert section[name]["narrativePrioritySectionSize"] == 4

    def test_empty_sub_table_is_skipped(self):
        # Empty inline tables should not consume an ordinal slot.
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                Chronos = {
                    BossIntroTextLinePriorities = {
                        "A",
                        {},
                        "B",
                    },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        section = result["Chronos"]["BossIntroTextLineSets"]
        assert section["A"]["narrativePriorityOrdinal"] == 1
        assert section["B"]["narrativePriorityOrdinal"] == 2
        assert section["A"]["narrativePrioritySectionSize"] == 2


class TestSectionKeyMapping:
    def test_interact_priorities_map_to_interact_text_line_sets(self):
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    InteractTextLinePriorities = { "A" },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        assert "InteractTextLineSets" in result["NPC_Hecate_01"]

    def test_bought_priorities_map_to_bought_text_lines(self):
        # BoughtTextLines is the *Lines* plural (not *LineSets*) -
        # exercise the second-candidate path in _section_key_for.
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                AphroditeUpgrade = {
                    BoughtTextLinePriorities = { "AphroditeBought01" },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        assert "BoughtTextLines" in result["AphroditeUpgrade"]

    def test_unknown_priority_key_is_skipped(self):
        # A priority list whose stem doesn't resolve to a known section
        # key (e.g. a future game patch family we don't know about) is
        # silently dropped rather than producing garbage section keys.
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    FutureUnknownFamilyTextLinePriorities = { "X" },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        assert result == {}

    def test_non_priority_keys_in_section_skipped(self):
        # Mixed real-data shape - priorities + scalar config fields.
        parsed = _parse("""
            OverwriteTableKeys( NarrativeData, {
                NPC_Hecate_01 = {
                    SpecialGiftTrackHintId = "Hint01",
                    InteractTextLinePriorities = { "HecateA" },
                    SpecialGiftTrackHintRequirements = { Foo = 1 },
                },
            } )
        """)
        result = extract_narrative_priorities(parsed)
        sections = result["NPC_Hecate_01"]
        assert list(sections.keys()) == ["InteractTextLineSets"]


class TestApply:
    def _priorities(self):
        return {
            "NPC_Hecate_01": {
                "InteractTextLineSets": {
                    "HecateA": {
                        "narrativePriorityOrdinal": 1,
                        "narrativePrioritySectionSize": 2,
                        "narrativePriorityClusterMembers": [],
                    },
                    "HecateB": {
                        "narrativePriorityOrdinal": 2,
                        "narrativePrioritySectionSize": 2,
                        "narrativePriorityClusterMembers": [],
                    },
                },
            },
        }

    def test_apply_attaches_priority_fields_in_place(self):
        owners = {
            "NPC_Hecate_01": {
                "source": "Hades 2",
                "InteractTextLineSets": {
                    "HecateA": {"dialogueLines": [], "requirements": {}},
                    "HecateB": {"dialogueLines": [], "requirements": {}},
                },
            },
        }
        count = apply_narrative_priorities(owners, self._priorities())
        assert count == 2
        a = owners["NPC_Hecate_01"]["InteractTextLineSets"]["HecateA"]
        assert a["narrativePriorityOrdinal"] == 1
        assert a["narrativePrioritySectionSize"] == 2
        assert a["narrativePriorityClusterMembers"] == []

    def test_apply_skips_missing_owner(self):
        owners = {
            "NPC_Nemesis_01": {
                "source": "Hades 2",
                "InteractTextLineSets": {"NemX": {}},
            },
        }
        count = apply_narrative_priorities(owners, self._priorities())
        assert count == 0

    def test_apply_skips_missing_section(self):
        owners = {
            "NPC_Hecate_01": {
                "source": "Hades 2",
                "GiftTextLineSets": {"HecateA": {}},
            },
        }
        count = apply_narrative_priorities(owners, self._priorities())
        assert count == 0

    def test_apply_skips_missing_textline(self):
        # Priority registers HecateA + HecateB but data only has A.
        owners = {
            "NPC_Hecate_01": {
                "source": "Hades 2",
                "InteractTextLineSets": {"HecateA": {}},
            },
        }
        count = apply_narrative_priorities(owners, self._priorities())
        assert count == 1
        assert owners["NPC_Hecate_01"]["InteractTextLineSets"]["HecateA"]["narrativePriorityOrdinal"] == 1


class TestRealData:
    """Smoke-test against the real ``NarrativeData.lua``."""

    @pytest.fixture(scope="class")
    def priorities(self):
        # Import locally so the fixture file can be missing on dev
        # machines without breaking module-level import of the test
        # module (which other classes' tests still rely on).
        import os
        fp = r'C:\Program Files (x86)\Steam\steamapps\common\Hades II\Content\Scripts\NarrativeData.lua'
        if not os.path.exists(fp):
            pytest.skip("Hades II install not available")
        with open(fp, encoding='utf-8-sig') as f:
            src = f.read()
        parsed = LuaParser(src).parse_file()
        return extract_narrative_priorities(parsed)

    def test_hecate_first_priority_is_bath_house_epilogue(self, priorities):
        # Canonical highest-priority Hecate interaction. If this ever
        # changes it's a noteworthy game data shift, not a test bug.
        hk = priorities["NPC_Hecate_01"]["InteractTextLineSets"]
        first = next(name for name, r in hk.items() if r["narrativePriorityOrdinal"] == 1)
        assert first == "HecateBathHouseEpilogue01"

    def test_chronos_has_tied_cluster_at_known_slot(self, priorities):
        # Verifies the cluster-routing code against the live data set.
        # ChronosBossAboutHades02 + ChronosBossAboutGameplayTimer02
        # share an ordinal in BossIntroTextLinePriorities.
        ch = priorities["Chronos"]["BossIntroTextLineSets"]
        h = ch["ChronosBossAboutHades02"]
        g = ch["ChronosBossAboutGameplayTimer02"]
        assert h["narrativePriorityOrdinal"] == g["narrativePriorityOrdinal"]
        assert "ChronosBossAboutGameplayTimer02" in h["narrativePriorityClusterMembers"]
        assert "ChronosBossAboutHades02" in g["narrativePriorityClusterMembers"]
