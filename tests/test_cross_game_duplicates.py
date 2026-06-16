"""Unit tests for ``build_viewer._compute_cross_game_duplicates``."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_viewer import _compute_cross_game_duplicates


def test_returns_empty_for_single_game():
    payload = {"hades1": {"textlines": {"Foo": {"owner": "X", "section": "S"}}}}
    assert _compute_cross_game_duplicates(payload) == []


def test_detects_shared_names():
    payload = {
        "hades1": {"textlines": {
            "Shared01": {"owner": "A", "section": "S1"},
            "OnlyH1": {"owner": "B", "section": "S2"},
        }},
        "hades2": {"textlines": {
            "Shared01": {"owner": "C", "section": "S3"},
            "OnlyH2": {"owner": "D", "section": "S4"},
        }},
    }
    result = _compute_cross_game_duplicates(payload)
    assert len(result) == 1
    assert result[0]["name"] == "Shared01"
    assert result[0]["hades1"] == {"owner": "A", "section": "S1"}
    assert result[0]["hades2"] == {"owner": "C", "section": "S3"}


def test_results_are_sorted_by_name():
    payload = {
        "hades1": {"textlines": {
            "Bravo": {"owner": "X", "section": "S"},
            "Alpha": {"owner": "X", "section": "S"},
        }},
        "hades2": {"textlines": {
            "Alpha": {"owner": "Y", "section": "S"},
            "Bravo": {"owner": "Y", "section": "S"},
        }},
    }
    result = _compute_cross_game_duplicates(payload)
    assert [d["name"] for d in result] == ["Alpha", "Bravo"]
