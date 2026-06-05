"""Tests for the section-key friendly-label map and the
``annotate_label_maps`` audit step that wires it into the merged graph
data and surfaces drift warnings.

Issue #56: render section keys as human-readable names in the viewer.
"""

from src.extractors.hades1 import (
    HADES1_TEXTLINE_SECTION_KEYS,
    HADES1_SECTION_KEY_LABELS,
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
)
from src.extractors.textline_set import (
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
    audit_section_key_labels,
    audit_section_key_labels_stale,
    audit_req_type_labels,
    audit_req_type_labels_stale,
    audit_req_type_edge_labels,
    audit_req_type_edge_labels_stale,
    audit_req_type_display_order,
    audit_req_type_display_order_stale,
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
        missing = known - set(HADES1_REQ_TYPE_DISPLAY_ORDER)
        assert missing == set(), (
            f"Fields missing from HADES1_REQ_TYPE_DISPLAY_ORDER: {sorted(missing)}"
        )

    def test_req_type_edge_labels_covers_all_known_fields(self):
        """Tree edge chips must have an explicit mapping for every
        requirement field so the JS layer never needs heuristic
        fallbacks for label data."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        missing = known - set(HADES1_REQ_TYPE_EDGE_LABELS)
        assert missing == set(), (
            f"Fields missing from HADES1_REQ_TYPE_EDGE_LABELS: {sorted(missing)}"
        )

    def test_every_req_type_field_has_label(self):
        """Equality direction (issue #44): every field that can appear
        as a requirement group must have a friendly header so the
        viewer never falls back to the raw camelCase field name."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        missing = audit_req_type_labels(known, HADES1_REQ_TYPE_LABELS)
        assert missing == set(), (
            f"H1 req-type fields without a friendly label: {sorted(missing)}"
        )

    def test_no_stale_req_type_labels(self):
        """Labels referencing fields no longer in
        ``TEXTLINE_REQ_FIELDS{,_COUNT}`` would render unreachable
        entries in any UI that iterates the label map."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        stale = audit_req_type_labels_stale(known, HADES1_REQ_TYPE_LABELS)
        assert stale == set(), (
            f"HADES1_REQ_TYPE_LABELS entries with no matching allowlist "
            f"field: {sorted(stale)}"
        )

    def test_no_stale_req_type_edge_labels(self):
        """Edge-label entries for fields no longer in the allowlist
        would produce phantom chip mappings in the merged
        ``reqTypeEdgeLabels`` map. Reverse direction of
        :func:`audit_req_type_edge_labels` - the forward case is
        covered by ``test_req_type_edge_labels_covers_all_known_fields``
        above."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        stale = audit_req_type_edge_labels_stale(known, HADES1_REQ_TYPE_EDGE_LABELS)
        assert stale == set(), (
            f"HADES1_REQ_TYPE_EDGE_LABELS entries with no matching "
            f"allowlist field: {sorted(stale)}"
        )

    def test_no_stale_req_type_display_order(self):
        """Display-order entries for fields no longer in the allowlist
        would produce a phantom sort bucket. Reverse direction of
        :func:`audit_req_type_display_order` - the forward case is
        covered by ``test_req_type_order_covers_all_known_fields``
        above."""
        known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
        stale = audit_req_type_display_order_stale(known, HADES1_REQ_TYPE_DISPLAY_ORDER)
        assert stale == set(), (
            f"HADES1_REQ_TYPE_DISPLAY_ORDER entries with no matching "
            f"allowlist field: {sorted(stale)}"
        )


class TestAnnotateLabelMaps:
    """``annotate_label_maps`` must attach all four label/order lookups
    to the merged graph data so the viewer can do pure lookups."""

    def test_all_label_maps_attached(self, make_graph_data):
        gd = make_graph_data()
        annotate_label_maps(gd)
        # Merged across all games; today H1 is the only contributor so
        # the merged maps equal the H1 maps verbatim.
        assert gd["reqTypeLabels"] == dict(HADES1_REQ_TYPE_LABELS)
        assert gd["reqTypeEdgeLabels"] == dict(HADES1_REQ_TYPE_EDGE_LABELS)
        assert gd["reqTypeOrder"] == list(HADES1_REQ_TYPE_DISPLAY_ORDER)
        assert gd["sectionKeyLabels"] == dict(HADES1_SECTION_KEY_LABELS)

    def test_section_key_label_drift_prints_warning(self, capsys, monkeypatch, make_graph_data):
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

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "BrandNewSectionKey" in out
        assert "no entry in HADES1_SECTION_KEY_LABELS" in out

    def test_stale_label_prints_warning(self, capsys, monkeypatch, make_graph_data):
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

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "RemovedFromAllowlist" in out
        assert "are not in HADES1_TEXTLINE_SECTION_KEYS" in out


class TestReqTypeLabelSourcesPerGameSeam:
    """``_REQ_TYPE_LABEL_SOURCES`` is the per-game seam that lets H2
    contribute its own (disjoint) requirement-field vocabulary
    alongside H1 without overwriting it. The merge must concatenate
    per-game maps additively, drop duplicates from the display order,
    and warn loudly if two games' maps collide on a field name."""

    def test_two_games_with_disjoint_vocab_merge_additively(self, capsys, monkeypatch, make_graph_data):
        import build_viewer

        h1_allowed = {"H1Field"}
        h1_labels = {"H1Field": "H1 friendly"}
        h1_edge = {"H1Field": "ALL"}
        h1_order = ["H1Field"]
        h2_allowed = {"H2Field"}
        h2_labels = {"H2Field": "H2 friendly"}
        h2_edge = {"H2Field": "HAS-ANY"}
        h2_order = ["H2Field"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [
                ("HADES1", h1_allowed, h1_labels, h1_edge, h1_order),
                ("HADES2", h2_allowed, h2_labels, h2_edge, h2_order),
            ],
        )
        # Stub the section-key seam to a no-op so this test only
        # exercises the req-type merge path.
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        assert gd["reqTypeLabels"] == {"H1Field": "H1 friendly", "H2Field": "H2 friendly"}
        assert gd["reqTypeEdgeLabels"] == {"H1Field": "ALL", "H2Field": "HAS-ANY"}
        # Order: H1 first (declared first), then H2 appended.
        assert gd["reqTypeOrder"] == ["H1Field", "H2Field"]
        # No conflict warnings when vocabularies are disjoint.
        assert "conflict" not in capsys.readouterr().out

    def test_conflicting_req_type_field_emits_warning(self, capsys, monkeypatch, make_graph_data):
        """If H2 ever ships a field name H1 also uses, the silent
        last-wins behaviour of dict.update would mask a real
        per-game-vocabulary conflict. The audit must surface it."""
        import build_viewer

        shared = "SharedFieldName"
        h1_allowed = {shared}
        h1_labels = {shared: "H1 says"}
        h1_edge = {shared: "ALL"}
        h1_order = [shared]
        h2_allowed = {shared}
        h2_labels = {shared: "H2 says"}
        h2_edge = {shared: "HAS-ANY"}
        h2_order = [shared]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [
                ("HADES1", h1_allowed, h1_labels, h1_edge, h1_order),
                ("HADES2", h2_allowed, h2_labels, h2_edge, h2_order),
            ],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "HADES2_REQ_TYPE_LABELS" in out
        assert "HADES2_REQ_TYPE_EDGE_LABELS" in out
        assert "HADES2_REQ_TYPE_DISPLAY_ORDER" in out
        assert shared in out
        # Display-order dedupes - shared appears exactly once.
        assert gd["reqTypeOrder"] == [shared]

    def test_missing_req_type_label_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """Issue #44: stub the H1 allowlist with a field that has no
        friendly label and verify the build pipeline prints a warning
        rather than silently emitting a viewer with the raw camelCase
        field name."""
        import build_viewer

        fake_allowed = {"H1Field", "NewlyAddedField"}
        fake_labels = {"H1Field": "H1 friendly"}
        fake_edge = {"H1Field": "ALL", "NewlyAddedField": "ALL"}
        fake_order = ["H1Field", "NewlyAddedField"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "NewlyAddedField" in out
        assert "no entry in HADES1_REQ_TYPE_LABELS" in out

    def test_stale_req_type_label_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """Issue #44: labels referencing fields no longer in the
        allowlist would render unreachable entries; surface as a
        warning at build time so the dead label can be cleaned up."""
        import build_viewer

        fake_allowed = {"H1Field"}
        fake_labels = {
            "H1Field": "H1 friendly",
            "RemovedFromAllowlist": "Should not exist",
        }
        fake_edge = {"H1Field": "ALL"}
        fake_order = ["H1Field"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "RemovedFromAllowlist" in out
        assert "are not in the HADES1 req-fields allowlist" in out

    def test_missing_req_type_edge_label_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """A req-field allowlisted without an entry in the edge-label
        map would silently fall back to the literal 'ALL' chip in the
        viewer, which is a misnomer for any non-all-semantics field."""
        import build_viewer

        fake_allowed = {"H1Field", "NewlyAddedField"}
        fake_labels = {"H1Field": "H1 friendly", "NewlyAddedField": "New"}
        fake_edge = {"H1Field": "ALL"}
        fake_order = ["H1Field", "NewlyAddedField"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "NewlyAddedField" in out
        assert "no entry in HADES1_REQ_TYPE_EDGE_LABELS" in out

    def test_stale_req_type_edge_label_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """Edge-label entries referencing fields no longer in the
        allowlist would render phantom chip mappings in the merged
        ``reqTypeEdgeLabels`` map; surface as a warning so the dead
        entry can be cleaned up."""
        import build_viewer

        fake_allowed = {"H1Field"}
        fake_labels = {"H1Field": "H1 friendly"}
        fake_edge = {
            "H1Field": "ALL",
            "RemovedFromAllowlist": "STALE",
        }
        fake_order = ["H1Field"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "RemovedFromAllowlist" in out
        assert "HADES1_REQ_TYPE_EDGE_LABELS" in out
        assert "are not in the HADES1 req-fields allowlist" in out

    def test_missing_req_type_display_order_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """A req-field allowlisted but missing from the display-order
        list would sort to the end via the viewer's index fallback,
        breaking the curated hard-vs-permissive grouping."""
        import build_viewer

        fake_allowed = {"H1Field", "NewlyAddedField"}
        fake_labels = {"H1Field": "H1 friendly", "NewlyAddedField": "New"}
        fake_edge = {"H1Field": "ALL", "NewlyAddedField": "ALL"}
        fake_order = ["H1Field"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "NewlyAddedField" in out
        assert "HADES1_REQ_TYPE_DISPLAY_ORDER" in out

    def test_stale_req_type_display_order_prints_warning(self, capsys, monkeypatch, make_graph_data):
        """Display-order entries referencing fields no longer in the
        allowlist would produce a phantom sort bucket. Surface as a
        warning so the dead entry can be cleaned up."""
        import build_viewer

        fake_allowed = {"H1Field"}
        fake_labels = {"H1Field": "H1 friendly"}
        fake_edge = {"H1Field": "ALL"}
        fake_order = ["H1Field", "RemovedFromAllowlist"]
        monkeypatch.setattr(
            build_viewer,
            "_REQ_TYPE_LABEL_SOURCES",
            [("HADES1", fake_allowed, fake_labels, fake_edge, fake_order)],
        )
        monkeypatch.setattr(build_viewer, "_SECTION_KEY_LABEL_SOURCES", [])

        gd = make_graph_data()
        build_viewer.annotate_label_maps(gd)

        out = capsys.readouterr().out
        assert "RemovedFromAllowlist" in out
        assert "HADES1_REQ_TYPE_DISPLAY_ORDER" in out
        assert "are not in the HADES1 req-fields allowlist" in out
