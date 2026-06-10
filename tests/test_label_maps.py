"""Tests for :mod:`src.label_maps`.

Confirms :func:`annotate_label_maps` attaches every per-game
vocabulary union to the graph data under the documented keys, and
that H2's vocabulary contributions land in the merged output
alongside H1's.

The tests do NOT pin exact dict contents (that would duplicate the
per-game vocabulary tests and break every time the games' label
maps gain a new entry). They DO pin that:

* every documented output key is present after annotation;
* H1 and H2 contributions both surface (anti-regression against the
  H1-only era of the merge code).
"""

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


def _annotated():
    graph_data: dict = {}
    annotate_label_maps(graph_data)
    return graph_data


class TestDocumentedKeysPresent:
    def test_all_documented_keys_attached(self):
        graph_data = _annotated()
        for key in (
            "reqTypeLabels",
            "reqTypeEdgeLabels",
            "reqTypeTooltips",
            "reqTypeOrder",
            "sectionKeyLabels",
            "choiceNames",
            "metaUpgradeNames",
        ):
            assert key in graph_data, key

    def test_req_type_order_is_list(self):
        graph_data = _annotated()
        assert isinstance(graph_data["reqTypeOrder"], list)

    def test_other_outputs_are_dicts(self):
        graph_data = _annotated()
        for key in (
            "reqTypeLabels",
            "reqTypeEdgeLabels",
            "reqTypeTooltips",
            "sectionKeyLabels",
            "choiceNames",
            "metaUpgradeNames",
        ):
            assert isinstance(graph_data[key], dict), key


class TestSectionKeyLabelsMerge:
    def test_h1_section_keys_present(self):
        graph_data = _annotated()
        sample = next(iter(HADES1_SECTION_KEY_LABELS))
        assert sample in graph_data["sectionKeyLabels"]

    def test_h2_section_keys_present(self):
        graph_data = _annotated()
        sample = next(iter(HADES2_SECTION_KEY_LABELS))
        assert sample in graph_data["sectionKeyLabels"]


class TestReqTypeLabelsMerge:
    def test_h1_req_labels_present(self):
        graph_data = _annotated()
        sample = next(iter(HADES1_REQ_TYPE_LABELS))
        assert sample in graph_data["reqTypeLabels"]

    def test_h2_req_labels_present(self):
        graph_data = _annotated()
        sample = next(iter(HADES2_REQ_TYPE_LABELS))
        assert sample in graph_data["reqTypeLabels"]


class TestChoiceNamesMerge:
    def test_h1_choices_present(self):
        graph_data = _annotated()
        for key in HADES1_CHOICE_NAMES:
            assert key in graph_data["choiceNames"], key

    def test_h2_choices_present(self):
        graph_data = _annotated()
        for key in HADES2_CHOICE_NAMES:
            assert key in graph_data["choiceNames"], key

    def test_no_key_collision_between_games(self):
        # H1 and H2 ChoiceText namespaces are disjoint (H1 ids use
        # game-specific patterns like ``HermesAccept_`` etc.; H2 uses
        # ``Choice_<NPC>Accept`` etc.). A collision would silently
        # overwrite one game's label with the other's, surfacing as a
        # mystery mislabel in the viewer.
        overlap = set(HADES1_CHOICE_NAMES) & set(HADES2_CHOICE_NAMES)
        assert overlap == set(), f"Cross-game ChoiceText collision: {overlap}"


class TestMetaUpgradeNamesMerge:
    def test_h1_meta_upgrades_present(self):
        graph_data = _annotated()
        for key in HADES1_META_UPGRADE_NAMES:
            assert key in graph_data["metaUpgradeNames"], key

    def test_h2_intentionally_absent(self):
        # H2 contributes no meta-upgrade refs (only count-based gates),
        # so its absence from the merge is deliberate. The aggregate
        # map should equal the H1 map verbatim until that changes.
        graph_data = _annotated()
        assert graph_data["metaUpgradeNames"] == dict(HADES1_META_UPGRADE_NAMES)
