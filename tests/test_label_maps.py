"""Tests for :mod:`src.label_maps`.

Confirms :func:`annotate_label_maps` attaches each game's vocabulary to
the per-game graph dataset under the documented keys, without any
cross-game union (the viewer renders one game at a time and toggles
between them, so labels are strictly per-game).
"""

import pytest

from src.label_maps import annotate_label_maps
from src.extractors.hades2 import (
    HADES2_CHOICE_NAMES,
    HADES2_SECTION_KEY_LABELS,
    HADES2_REQ_TYPE_LABELS,
)
from src.extractors.hades1 import (
    HADES1_CHOICE_NAMES,
    HADES1_SECTION_KEY_LABELS,
    HADES1_META_UPGRADE_NAMES,
    HADES1_REQ_TYPE_LABELS,
)


_DOCUMENTED_KEYS = (
    "reqTypeLabels",
    "reqTypeEdgeLabels",
    "reqTypeTooltips",
    "reqTypeOrder",
    "sectionKeyLabels",
    "choiceNames",
    "metaUpgradeNames",
)


def _annotated(game: str) -> dict:
    graph_data: dict = {}
    annotate_label_maps(graph_data, game)
    return graph_data


class TestDocumentedKeysPresent:
    @pytest.mark.parametrize("game", ["hades1", "hades2"])
    def test_all_documented_keys_attached(self, game):
        graph_data = _annotated(game)
        for key in _DOCUMENTED_KEYS:
            assert key in graph_data, f"{game}: {key} missing"

    @pytest.mark.parametrize("game", ["hades1", "hades2"])
    def test_req_type_order_is_list(self, game):
        graph_data = _annotated(game)
        assert isinstance(graph_data["reqTypeOrder"], list)

    @pytest.mark.parametrize("game", ["hades1", "hades2"])
    def test_other_outputs_are_dicts(self, game):
        graph_data = _annotated(game)
        for key in _DOCUMENTED_KEYS:
            if key == "reqTypeOrder":
                continue
            assert isinstance(graph_data[key], dict), f"{game}: {key}"


class TestStrictPerGameSeparation:
    """The per-game annotation must NOT bleed any other game's vocabulary
    into the result. The viewer is strictly per-game; any cross-game
    union would silently mislabel chips and tooltips."""

    def test_hades1_section_keys_present_in_hades1(self):
        sample = next(iter(HADES1_SECTION_KEY_LABELS))
        assert sample in _annotated("hades1")["sectionKeyLabels"]

    def test_hades1_section_keys_absent_from_hades2(self):
        # H1 has unique section keys (e.g. ``GreetingTextLineSets``); a
        # disjoint sample exists - find one and confirm it's not in H2.
        h2_keys = set(HADES2_SECTION_KEY_LABELS)
        disjoint = [k for k in HADES1_SECTION_KEY_LABELS if k not in h2_keys]
        if not disjoint:
            pytest.skip("H1/H2 section-key labels fully overlap; nothing to test")
        annotated_h2 = _annotated("hades2")["sectionKeyLabels"]
        for k in disjoint:
            assert k not in annotated_h2, f"H1-only key {k!r} leaked into H2"

    def test_hades2_section_keys_present_in_hades2(self):
        sample = next(iter(HADES2_SECTION_KEY_LABELS))
        assert sample in _annotated("hades2")["sectionKeyLabels"]

    def test_hades2_section_keys_absent_from_hades1(self):
        h1_keys = set(HADES1_SECTION_KEY_LABELS)
        disjoint = [k for k in HADES2_SECTION_KEY_LABELS if k not in h1_keys]
        if not disjoint:
            pytest.skip("H1/H2 section-key labels fully overlap; nothing to test")
        annotated_h1 = _annotated("hades1")["sectionKeyLabels"]
        for k in disjoint:
            assert k not in annotated_h1, f"H2-only key {k!r} leaked into H1"

    def test_hades1_req_labels_present_in_hades1(self):
        sample = next(iter(HADES1_REQ_TYPE_LABELS))
        assert sample in _annotated("hades1")["reqTypeLabels"]

    def test_hades2_req_labels_present_in_hades2(self):
        sample = next(iter(HADES2_REQ_TYPE_LABELS))
        assert sample in _annotated("hades2")["reqTypeLabels"]

    def test_hades1_req_labels_disjoint_from_hades2(self):
        # H1's RequirementSet field vocabulary
        # (``RequiredTextLines`` etc.) is completely disjoint from H2's
        # operator vocabulary (``HasAny`` etc.), so H1 entries must not
        # leak into H2's reqTypeLabels.
        annotated_h2 = _annotated("hades2")["reqTypeLabels"]
        for k in HADES1_REQ_TYPE_LABELS:
            assert k not in annotated_h2, f"H1 req label {k!r} leaked into H2"

    def test_hades2_req_labels_disjoint_from_hades1(self):
        annotated_h1 = _annotated("hades1")["reqTypeLabels"]
        for k in HADES2_REQ_TYPE_LABELS:
            assert k not in annotated_h1, f"H2 req label {k!r} leaked into H1"


class TestChoiceNames:
    def test_hades1_choices_present_in_hades1(self):
        annotated = _annotated("hades1")["choiceNames"]
        for key in HADES1_CHOICE_NAMES:
            assert key in annotated, key

    def test_hades2_choices_present_in_hades2(self):
        annotated = _annotated("hades2")["choiceNames"]
        for key in HADES2_CHOICE_NAMES:
            assert key in annotated, key

    def test_hades2_choices_absent_from_hades1(self):
        annotated = _annotated("hades1")["choiceNames"]
        for key in HADES2_CHOICE_NAMES:
            assert key not in annotated, f"H2 choice {key!r} leaked into H1"

    def test_hades1_choices_absent_from_hades2(self):
        annotated = _annotated("hades2")["choiceNames"]
        for key in HADES1_CHOICE_NAMES:
            assert key not in annotated, f"H1 choice {key!r} leaked into H2"


class TestMetaUpgradeNames:
    def test_hades1_meta_upgrades_present(self):
        annotated = _annotated("hades1")["metaUpgradeNames"]
        for key in HADES1_META_UPGRADE_NAMES:
            assert key in annotated, key

    def test_hades2_metaUpgradeNames_empty(self):
        # H2 contributes no meta-upgrade refs (only count-based gates),
        # so its dict is intentionally empty.
        assert _annotated("hades2")["metaUpgradeNames"] == {}


class TestUnknownGameId:
    def test_unknown_game_id_raises(self):
        graph_data: dict = {}
        with pytest.raises(ValueError, match="Unknown game id"):
            annotate_label_maps(graph_data, "hades3")
