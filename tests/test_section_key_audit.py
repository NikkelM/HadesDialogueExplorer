"""Tests for the section-key audit.

Two halves are covered:

* :func:`src.section_key_audit.audit_section_keys` - the allowlist->data
  and label-parity half that runs against the merged per-game graph in
  the build pipeline. Verifies the shipped allowlist / label maps stay
  in sync (the invariant both ``section_keys.py`` modules document) and
  that drift surfaces as warnings.
* The walker collector in :mod:`src.extractors.textline_set`
  (``_note_unlisted_section_key`` / ``reset_section_key_audit`` /
  ``get_unlisted_section_keys``) - the data->allowlist half that
  ``generate_data.py`` reports. Verifies a section-shaped owner-level
  key carrying real data is recorded while empty stubs and
  non-section-shaped keys are ignored.
"""

import pytest

from src.lua_parser import LuaParser
import src.section_key_audit as ska
from src.section_key_audit import audit_section_keys
from src.extractors.hades1 import HADES1_SECTION_KEY_LABELS
from src.extractors.hades1.section_keys import HADES1_TEXTLINE_SECTION_KEYS
from src.extractors.hades2 import HADES2_SECTION_KEY_LABELS
from src.extractors.hades2.section_keys import HADES2_TEXTLINE_SECTION_KEYS
from src.extractors.textline_set import (
    extract_textline_sections,
    get_unlisted_section_keys,
    reset_section_key_audit,
)
from src.extractors.hades2.textline_set import (
    extract_textline_sections as h2_extract_textline_sections,
)


_ALLOWLISTS = {
    "hades1": (HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_LABELS),
    "hades2": (HADES2_TEXTLINE_SECTION_KEYS, HADES2_SECTION_KEY_LABELS),
}


def _graph_using(section_keys) -> dict:
    """A minimal merged-graph payload whose textlines cover exactly the
    given section keys (one textline per key)."""
    return {
        "textlines": {
            f"tl{i}": {"section": key}
            for i, key in enumerate(sorted(section_keys))
        }
    }


class TestLabelParity:
    """``SECTION_KEY_LABELS`` must cover exactly the allowlist - the
    manual-maintenance invariant both ``section_keys.py`` modules
    promise the build pipeline enforces."""

    @pytest.mark.parametrize("game", ["hades1", "hades2"])
    def test_labels_match_allowlist_exactly(self, game):
        allowlist, labels = _ALLOWLISTS[game]
        assert set(labels) == set(allowlist), (
            f"{game}: SECTION_KEY_LABELS and TEXTLINE_SECTION_KEYS have drifted"
        )


class TestAuditSectionKeys:
    @pytest.mark.parametrize("game", ["hades1", "hades2"])
    def test_clean_data_emits_no_warning(self, game, capsys):
        allowlist, _ = _ALLOWLISTS[game]
        audit_section_keys(_graph_using(allowlist), game)
        assert "WARNING" not in capsys.readouterr().out

    def test_dead_allowlist_key_warns(self, capsys):
        # Graph uses only one real H1 section key; every other allowlisted
        # key is "dead" (matched zero textlines) and must be surfaced.
        audit_section_keys(_graph_using({"InteractTextLineSets"}), "hades1")
        out = capsys.readouterr().out
        assert "matched zero textlines" in out
        assert "GiftTextLineSets" in out
        # The one key that *was* used must not be reported as dead.
        assert "'InteractTextLineSets'" not in out

    def test_unknown_game_raises(self):
        with pytest.raises(ValueError):
            audit_section_keys({"textlines": {}}, "hades3")

    def test_unlabelled_and_stale_labels_warn(self, monkeypatch, capsys):
        # Inject a synthetic game whose label map both misses an
        # allowlisted key and carries a stale entry, to exercise both
        # label-parity warnings without touching the shipped maps.
        registry = dict(ska._SECTION_KEYS_BY_GAME)
        registry["testgame"] = (
            "TEST",
            {"AlphaTextLineSets", "BetaTextLineSets"},
            {"AlphaTextLineSets": "Alpha", "GoneTextLineSets": "Gone"},
        )
        monkeypatch.setattr(ska, "_SECTION_KEYS_BY_GAME", registry)
        audit_section_keys(
            _graph_using({"AlphaTextLineSets", "BetaTextLineSets"}), "testgame"
        )
        out = capsys.readouterr().out
        assert "no entry in TEST_SECTION_KEY_LABELS" in out
        assert "BetaTextLineSets" in out
        assert "no matching allowlist key" in out
        assert "GoneTextLineSets" in out


def _parse_owner(lua_text):
    """Parse ``O = { ... }`` and return the LuaTable value of ``O``."""
    return LuaParser(f"O = {lua_text}").parse_file()["O"]


class TestUnlistedSectionKeyCollector:
    def setup_method(self):
        reset_section_key_audit()

    def teardown_method(self):
        reset_section_key_audit()

    def test_populated_section_shaped_key_recorded(self):
        owner = _parse_owner("""{
            InteractTextLineSets = { Line01 = { } },
            SecretGiftTextLines = { Hidden01 = { } },
        }""")
        extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert get_unlisted_section_keys() == [
            ("NPC_Owner_01", "SecretGiftTextLines", "Test.lua")
        ]

    def test_empty_section_shaped_key_ignored(self):
        owner = _parse_owner("""{
            InteractTextLineSets = { Line01 = { } },
            EmptyTextLineSets = { },
        }""")
        extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert get_unlisted_section_keys() == []

    def test_non_section_named_key_ignored(self):
        owner = _parse_owner("""{
            InteractTextLineSets = { Line01 = { } },
            CombatData = { Phase01 = { } },
        }""")
        extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert get_unlisted_section_keys() == []

    def test_requirement_field_shape_ignored(self):
        # ``RequiredTextLines`` matches the name pattern but its value is a
        # list of textline-name *strings*, not a name->table map, so it is
        # not section-shaped and must not be flagged.
        owner = _parse_owner("""{
            InteractTextLineSets = { Line01 = { } },
            RequiredTextLines = { "Foo01", "Bar02" },
        }""")
        extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert get_unlisted_section_keys() == []

    def test_h2_walker_feeds_the_same_collector(self):
        owner = _parse_owner("""{
            InteractTextLineSets = { Line01 = { } },
            SecretGiftTextLines = { Hidden01 = { } },
        }""")
        h2_extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua",
            section_keys={"InteractTextLineSets"},
        )
        assert get_unlisted_section_keys() == [
            ("NPC_Owner_01", "SecretGiftTextLines", "Test.lua")
        ]

    def test_reset_clears_records(self):
        owner = _parse_owner("{ SecretGiftTextLines = { Hidden01 = { } } }")
        extract_textline_sections(
            "NPC_Owner_01", owner, "Test.lua", section_keys=set(),
        )
        assert get_unlisted_section_keys()
        reset_section_key_audit()
        assert get_unlisted_section_keys() == []
