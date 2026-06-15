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
    HADES2_TEXTLINE_DEPENDENCY_FIELDS,
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
        # H1's H1-only fields (counts, room-scoped, ANY-other, etc.)
        # must never appear in H2's reqTypeLabels. The 12 textline-
        # dependency fields in HADES2_TEXTLINE_DEPENDENCY_FIELDS are
        # the DELIBERATE shared subset (H2's extractor re-keys
        # textline records into those H1 field names so dialogue
        # edges render uniformly across both games); they are
        # exempted from this disjoint check.
        annotated_h2 = _annotated("hades2")["reqTypeLabels"]
        h1_only = set(HADES1_REQ_TYPE_LABELS) - HADES2_TEXTLINE_DEPENDENCY_FIELDS
        for k in h1_only:
            assert k not in annotated_h2, f"H1-only req label {k!r} leaked into H2"

    def test_hades2_req_labels_disjoint_from_hades1(self):
        # H2's operator vocabulary (HasAny / HasNone / Path* / ...)
        # must never appear in H1's reqTypeLabels. The 12 borrowed
        # textline-dependency fields are exempt (same rationale as
        # above - they're H1 field names borrowed by H2).
        annotated_h1 = _annotated("hades1")["reqTypeLabels"]
        h2_only = set(HADES2_REQ_TYPE_LABELS) - HADES2_TEXTLINE_DEPENDENCY_FIELDS
        for k in h2_only:
            assert k not in annotated_h1, f"H2-only req label {k!r} leaked into H1"

    def test_textline_dependency_fields_shared_across_games(self):
        # Pin the cross-game shared subset: every borrowed key must
        # appear in BOTH games' annotated label maps with identical
        # values. This is the structural inverse of the two disjoint
        # checks above - we positively assert sharing for the
        # documented overlap layer so a future refactor that
        # accidentally drops the borrow has to update either this
        # test or HADES2_TEXTLINE_DEPENDENCY_FIELDS deliberately.
        h1_labels = _annotated("hades1")["reqTypeLabels"]
        h2_labels = _annotated("hades2")["reqTypeLabels"]
        for k in HADES2_TEXTLINE_DEPENDENCY_FIELDS:
            assert k in h1_labels, f"Shared field {k!r} missing from H1"
            assert k in h2_labels, f"Shared field {k!r} missing from H2"
            assert h1_labels[k] == h2_labels[k], (
                f"Shared field {k!r} wording diverges: "
                f"H1={h1_labels[k]!r}, H2={h2_labels[k]!r}"
            )


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
