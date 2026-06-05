"""Tests for the section-key friendly-label map and the
``annotate_label_maps`` audit step that wires it into the merged graph
data and surfaces drift warnings.

Issue #56: render section keys as human-readable names in the viewer.
"""

import io
import sys

import pytest

from src.extractors.hades1 import (
    HADES1_TEXTLINE_SECTION_KEYS,
    HADES1_SECTION_KEY_LABELS,
)
from src.extractors.textline_set import (
    REQ_TYPE_LABELS,
    REQ_TYPE_EDGE_LABELS,
    REQ_TYPE_DISPLAY_ORDER,
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
    audit_section_key_labels,
    audit_section_key_labels_stale,
)
from build_viewer import annotate_label_maps


class TestSectionKeyLabelMap:
    """Every key the parser is allowed to extract from must have a
    human-readable label so the viewer never falls back to the raw
    camelCase key."""

    def test_every_section_key_has_label(self):
        missing = audit_section_key_labels(
            HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_LABELS
        )
        assert missing == set(), (
            f"H1 section keys without a friendly label: {sorted(missing)}"
        )

    def test_no_stale_labels(self):
        """Labels referencing keys no longer in the allowlist would
        silently render unreachable entries in any UI that iterates the
        label map."""
        stale = audit_section_key_labels_stale(
            HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_LABELS
        )
        assert stale == set(), (
            f"H1 SECTION_KEY_LABELS entries with no matching allowlist "
            f"key: {sorted(stale)}"
        )

    def test_every_label_is_non_empty(self):
        for key, label in HADES1_SECTION_KEY_LABELS.items():
            assert label, f"{key}: empty label"


class TestReqTypeLabelMaps:
    """The req-type labels live in Python as the single source of
    truth so the viewer never embeds static label data."""

    def test_req_type_order_covers_all_known_fields(self):
        """Every field that can appear as a requirement group should be
        in the display-order list - otherwise it sorts to the end with
        a fallback sentinel and renders out-of-band."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        missing = known - set(REQ_TYPE_DISPLAY_ORDER)
        assert missing == set(), (
            f"Fields missing from REQ_TYPE_DISPLAY_ORDER: {sorted(missing)}"
        )

    def test_req_type_edge_labels_covers_all_known_fields(self):
        """Tree edge chips must have an explicit mapping for every
        requirement field so the JS layer never needs heuristic
        fallbacks for label data."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        missing = known - set(REQ_TYPE_EDGE_LABELS)
        assert missing == set(), (
            f"Fields missing from REQ_TYPE_EDGE_LABELS: {sorted(missing)}"
        )

    def test_req_type_labels_are_subset_of_known_fields(self):
        """Friendly headers must not reference unknown fields."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        unknown = set(REQ_TYPE_LABELS) - known
        assert unknown == set(), (
            f"REQ_TYPE_LABELS references unknown fields: {sorted(unknown)}"
        )


class TestAnnotateLabelMaps:
    """``annotate_label_maps`` must attach all four label/order lookups
    to the merged graph data so the viewer can do pure lookups."""

    def _base(self):
        return {
            "textlines": {},
            "dependents": {},
            "speakerNames": {},
            "stats": {
                "totalOwners": 0,
                "totalTextlines": 0,
                "totalEdges": 0,
                "unresolvedRefs": [],
                "duplicates": [],
            },
        }

    def test_all_label_maps_attached(self):
        gd = self._base()
        annotate_label_maps(gd)
        assert gd["reqTypeLabels"] == REQ_TYPE_LABELS
        assert gd["reqTypeEdgeLabels"] == REQ_TYPE_EDGE_LABELS
        assert gd["reqTypeOrder"] == list(REQ_TYPE_DISPLAY_ORDER)
        # Merged across all games; today H1 is the only contributor.
        assert gd["sectionKeyLabels"] == dict(HADES1_SECTION_KEY_LABELS)

    def test_section_key_label_drift_prints_warning(self, monkeypatch):
        """Stub the H1 source list so the audit sees a missing label
        and verify the build pipeline prints a warning rather than
        silently emitting a viewer with raw camelCase keys."""
        import build_viewer

        fake_keys = frozenset({"InteractTextLineSets", "BrandNewSectionKey"})
        fake_labels = {"InteractTextLineSets": "NPC interaction"}
        monkeypatch.setattr(
            build_viewer,
            "_SECTION_KEY_LABEL_SOURCES",
            [("HADES1", fake_keys, fake_labels)],
        )
        buf = io.StringIO()
        monkeypatch.setattr(sys, "stdout", buf)

        gd = self._base()
        build_viewer.annotate_label_maps(gd)

        out = buf.getvalue()
        assert "BrandNewSectionKey" in out
        assert "no entry in HADES1_SECTION_KEY_LABELS" in out

    def test_stale_label_prints_warning(self, monkeypatch):
        import build_viewer

        fake_keys = frozenset({"InteractTextLineSets"})
        fake_labels = {
            "InteractTextLineSets": "NPC interaction",
            "RemovedFromAllowlist": "Should not exist",
        }
        monkeypatch.setattr(
            build_viewer,
            "_SECTION_KEY_LABEL_SOURCES",
            [("HADES1", fake_keys, fake_labels)],
        )
        buf = io.StringIO()
        monkeypatch.setattr(sys, "stdout", buf)

        gd = self._base()
        build_viewer.annotate_label_maps(gd)

        out = buf.getvalue()
        assert "RemovedFromAllowlist" in out
        assert "are not in HADES1_TEXTLINE_SECTION_KEYS" in out
