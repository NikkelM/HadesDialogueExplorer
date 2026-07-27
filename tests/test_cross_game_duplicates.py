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


def test_category_uses_shared_group_when_both_games_agree():
    payload = {
        "hades1": {
            "textlines": {"Shared01": {"owner": "A", "section": "GiftTextLineSets"}},
            "sectionKeyLabels": {"GiftTextLineSets": "NPC gifting"},
        },
        "hades2": {
            "textlines": {"Shared01": {"owner": "C", "section": "GiftTextLineSets"}},
            "sectionKeyLabels": {"GiftTextLineSets": "NPC gifting"},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["category"] == "NPC gifting"


def test_category_collapses_parenthetical_variant():
    # A repeatable-fallback variant ("... (repeatable)") is the same category
    # as its base once the parenthetical qualifier is dropped, so the two games
    # agree rather than landing in the reclassified bucket.
    payload = {
        "hades1": {
            "textlines": {"Shared01": {"owner": "A", "section": "RepeatableTextLineSets"}},
            "sectionKeyLabels": {"RepeatableTextLineSets": "NPC interaction (repeatable)"},
        },
        "hades2": {
            "textlines": {"Shared01": {"owner": "C", "section": "InteractTextLineSets"}},
            "sectionKeyLabels": {"InteractTextLineSets": "NPC interaction"},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["category"] == "NPC interaction"


def test_category_uses_hades2_group_when_games_disagree():
    # A boon "About" line is a boon-pickup line in Hades 1 but an NPC-interaction
    # line in Hades II; the internal sets differ, so the Hades II grouping wins.
    payload = {
        "hades1": {
            "textlines": {"Shared01": {"owner": "A", "section": "PriorityPickupTextLineSets"}},
            "sectionKeyLabels": {"PriorityPickupTextLineSets": "God boon pickup"},
        },
        "hades2": {
            "textlines": {"Shared01": {"owner": "C", "section": "InteractTextLineSets"}},
            "sectionKeyLabels": {"InteractTextLineSets": "NPC interaction"},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["category"] == "NPC interaction"


def test_category_shows_both_labels_when_same_set_named_differently():
    # Both games file the name under the same internal set (RejectionTextLines)
    # but label it differently, so both friendly names are shown as "<H1>/<H2>".
    payload = {
        "hades1": {
            "textlines": {"Shared01": {"owner": "A", "section": "RejectionTextLines"}},
            "sectionKeyLabels": {"RejectionTextLines": '"Trial of the Gods" - Displeased'},
        },
        "hades2": {
            "textlines": {"Shared01": {"owner": "C", "section": "RejectionTextLines"}},
            "sectionKeyLabels": {"RejectionTextLines": '"Family Dispute" - Displeased'},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["category"] == '"Trial of the Gods" - Displeased/"Family Dispute" - Displeased'


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


def test_speaker_uses_friendly_name_from_first_game():
    payload = {
        "hades1": {
            "textlines": {"Shared01": {"owner": "ZeusUpgrade", "section": "S1"}},
            "speakers": {"ZeusUpgrade": {"name": "Zeus"}},
        },
        "hades2": {
            "textlines": {"Shared01": {"owner": "NPC_Zeus_01", "section": "S3"}},
            "speakers": {"NPC_Zeus_01": {"name": "Zeus (Boss)"}},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["speaker"] == "Zeus"


def test_speaker_falls_back_to_second_game_when_first_has_no_name():
    payload = {
        "hades1": {"textlines": {"Shared01": {"owner": "A", "section": "S1"}}},
        "hades2": {
            "textlines": {"Shared01": {"owner": "NPC_Zeus_01", "section": "S3"}},
            "speakers": {"NPC_Zeus_01": {"name": "Zeus"}},
        },
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["speaker"] == "Zeus"


def test_speaker_falls_back_to_owner_id_without_speaker_data():
    payload = {
        "hades1": {"textlines": {"Shared01": {"owner": "A", "section": "S1"}}},
        "hades2": {"textlines": {"Shared01": {"owner": "C", "section": "S3"}}},
    }
    result = _compute_cross_game_duplicates(payload)
    assert result[0]["speaker"] == "A"
