"""Tests for the H1 known-unresolved-refs categorization and the
``annotate_known_unresolved`` audit step that wires it into the merged
graph data."""

from src.extractors.hades1 import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
)
from build_viewer import annotate_known_unresolved


VALID_CATEGORIES = set(UNRESOLVED_CATEGORY_LABELS.keys())


class TestHardcodedListShape:
    """The hardcoded list must be well-formed: every entry has a known
    category and a non-empty reason."""

    def test_every_entry_has_valid_category(self):
        for name, info in HADES1_KNOWN_UNRESOLVED_REFS.items():
            assert info["category"] in VALID_CATEGORIES, \
                f"{name}: bad category {info.get('category')!r}"

    def test_every_entry_has_non_empty_reason(self):
        for name, info in HADES1_KNOWN_UNRESOLVED_REFS.items():
            assert info.get("reason"), f"{name}: missing reason"

    def test_every_category_has_label_and_description(self):
        for cat in VALID_CATEGORIES:
            assert UNRESOLVED_CATEGORY_LABELS[cat]
            assert UNRESOLVED_CATEGORY_DESCRIPTIONS[cat]


class TestAnnotateKnownUnresolved:
    """``annotate_known_unresolved`` mutates the merged graph dict in place
    and attaches category metadata for the viewer."""

    def test_known_unresolved_attached_with_category(self, make_graph_data):
        gd = make_graph_data(unresolved=["ThanatosGift010", "Fury3SisterUnionWithMeg02"])
        annotate_known_unresolved(gd)
        assert "ThanatosGift010" in gd["knownUnresolvedRefs"]
        assert gd["knownUnresolvedRefs"]["ThanatosGift010"]["category"] == "typo-or-bug"
        assert gd["knownUnresolvedRefs"]["Fury3SisterUnionWithMeg02"]["category"] == "back-compatibility"

    def test_resolved_entries_not_attached(self, make_graph_data):
        """A name in the hardcoded list but NOT in the unresolved set must
        not appear in knownUnresolvedRefs - only currently-unresolved refs
        carry over."""
        gd = make_graph_data()  # no unresolved refs
        annotate_known_unresolved(gd)
        assert gd["knownUnresolvedRefs"] == {}

    def test_uncategorized_unresolved_listed_by_category(self, make_graph_data):
        gd = make_graph_data(unresolved=["SomeBrandNewRef", "ThanatosGift010"])
        annotate_known_unresolved(gd)
        by_cat = gd["stats"]["unresolvedByCategory"]
        assert by_cat["uncategorized"] == 1
        assert by_cat["typo-or-bug"] == 1

    def test_labels_and_descriptions_attached(self, make_graph_data):
        gd = make_graph_data(unresolved=["ThanatosGift010"])
        annotate_known_unresolved(gd)
        assert gd["unresolvedCategoryLabels"] == UNRESOLVED_CATEGORY_LABELS
        assert gd["unresolvedCategoryDescriptions"] == UNRESOLVED_CATEGORY_DESCRIPTIONS


class TestAuditWarnings:
    """The annotate step must print drift warnings - parser fixes that
    leave stale entries, and new unresolved refs that aren't categorized."""

    def test_warns_when_hardcoded_entry_is_now_resolved(self, capsys, make_graph_data):
        # Empty unresolved set means EVERY hardcoded entry is stale.
        annotate_known_unresolved(make_graph_data())
        out = capsys.readouterr().out
        assert "HADES1_KNOWN_UNRESOLVED_REFS" in out
        assert "now resolved" in out

    def test_warns_when_unresolved_ref_not_categorized(self, capsys, make_graph_data):
        annotate_known_unresolved(make_graph_data(unresolved=["UnknownNewRefThatNoOneClassified"]))
        out = capsys.readouterr().out
        assert "not categorized" in out
        assert "UnknownNewRefThatNoOneClassified" in out

    def test_no_warnings_when_lists_match_exactly(self, capsys, make_graph_data):
        gd = make_graph_data(unresolved=list(HADES1_KNOWN_UNRESOLVED_REFS.keys()))
        annotate_known_unresolved(gd)
        out = capsys.readouterr().out
        assert "now resolved" not in out
        assert "not categorized" not in out
