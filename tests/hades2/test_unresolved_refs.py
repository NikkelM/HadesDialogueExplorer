"""Tests for the H2 known-unresolved-refs categorisation and the
``annotate_known_unresolved`` audit step that wires it into the merged
graph data."""

from src.extractors.hades2 import (
    HADES2_KNOWN_UNRESOLVED_REFS,
    HADES2_UNRESOLVED_CATEGORY_LABELS,
    HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS,
)
from src.known_unresolved import annotate_known_unresolved


VALID_CATEGORIES = set(HADES2_UNRESOLVED_CATEGORY_LABELS.keys())


class TestHardcodedListShape:
    """The hardcoded list must be well-formed: every entry has a known
    category and a non-empty reason."""

    def test_every_entry_has_valid_category(self):
        for name, info in HADES2_KNOWN_UNRESOLVED_REFS.items():
            assert info["category"] in VALID_CATEGORIES, \
                f"{name}: bad category {info.get('category')!r}"

    def test_every_entry_has_non_empty_reason(self):
        for name, info in HADES2_KNOWN_UNRESOLVED_REFS.items():
            assert info.get("reason"), f"{name}: missing reason"

    def test_every_category_has_label_and_description(self):
        for cat in VALID_CATEGORIES:
            assert HADES2_UNRESOLVED_CATEGORY_LABELS[cat]
            assert HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS[cat]

    def test_extractor_deferred_entries_reference_inherit_variants(self):
        # Every extractor-deferred entry should mention the followup
        # work item so a reader knows what unblocks the cleanup.
        for name, info in HADES2_KNOWN_UNRESOLVED_REFS.items():
            if info["category"] != "extractor-deferred":
                continue
            assert "h2-npc-inherit-variants" in info["reason"], \
                f"{name}: extractor-deferred reason should cite " \
                f"h2-npc-inherit-variants as the unblocking work"


class TestAnnotateKnownUnresolved:
    """``annotate_known_unresolved`` mutates the merged graph dict in place
    and attaches category metadata for the viewer."""

    def test_known_unresolved_attached_with_category(self, make_graph_data):
        gd = make_graph_data(unresolved=["MedeaHubMeeting01", "NemesisShopping01"])
        annotate_known_unresolved(gd, "hades2")
        assert "MedeaHubMeeting01" in gd["knownUnresolvedRefs"]
        assert gd["knownUnresolvedRefs"]["MedeaHubMeeting01"]["category"] == "cut-content"
        assert gd["knownUnresolvedRefs"]["NemesisShopping01"]["category"] == "extractor-deferred"

    def test_resolved_entries_not_attached(self, make_graph_data):
        gd = make_graph_data()  # no unresolved refs
        annotate_known_unresolved(gd, "hades2")
        assert gd["knownUnresolvedRefs"] == {}

    def test_uncategorized_unresolved_listed_by_category(self, make_graph_data):
        gd = make_graph_data(unresolved=["SomeBrandNewRef", "MedeaHubMeeting01"])
        annotate_known_unresolved(gd, "hades2")
        by_cat = gd["stats"]["unresolvedByCategory"]
        assert by_cat["uncategorized"] == 1
        assert by_cat["cut-content"] == 1

    def test_labels_and_descriptions_attached(self, make_graph_data):
        gd = make_graph_data(unresolved=["MedeaHubMeeting01"])
        annotate_known_unresolved(gd, "hades2")
        assert gd["unresolvedCategoryLabels"] == HADES2_UNRESOLVED_CATEGORY_LABELS
        assert gd["unresolvedCategoryDescriptions"] == HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS


class TestAuditWarnings:
    """The annotate step must print drift warnings - parser fixes that
    leave stale entries, and new unresolved refs that aren't categorized."""

    def test_warns_when_hardcoded_entry_is_now_resolved(self, capsys, make_graph_data):
        # Empty unresolved set means EVERY hardcoded entry is stale.
        annotate_known_unresolved(make_graph_data(), "hades2")
        out = capsys.readouterr().out
        assert "HADES2_KNOWN_UNRESOLVED_REFS" in out
        assert "now resolved" in out

    def test_warns_when_unresolved_ref_not_categorized(self, capsys, make_graph_data):
        annotate_known_unresolved(
            make_graph_data(unresolved=["UnknownNewRefThatNoOneClassified"]),
            "hades2",
        )
        out = capsys.readouterr().out
        assert "not categorized" in out
        assert "UnknownNewRefThatNoOneClassified" in out

    def test_no_warnings_when_lists_match_exactly(self, capsys, make_graph_data):
        gd = make_graph_data(unresolved=list(HADES2_KNOWN_UNRESOLVED_REFS.keys()))
        annotate_known_unresolved(gd, "hades2")
        out = capsys.readouterr().out
        assert "now resolved" not in out
        assert "not categorized" not in out


class TestPerGameRouting:
    """An H2-only ref must not be considered known when audited under H1
    (strict per-game separation, mirrors the H1-side check)."""

    def test_hades2_curated_does_not_leak_into_hades1(self, capsys, make_graph_data):
        gd = make_graph_data(unresolved=["MedeaHubMeeting01"])
        annotate_known_unresolved(gd, "hades1")
        assert "MedeaHubMeeting01" not in gd["knownUnresolvedRefs"]
        assert gd["stats"]["unresolvedByCategory"]["uncategorized"] == 1
        out = capsys.readouterr().out
        assert "HADES1_KNOWN_UNRESOLVED_REFS" in out
        assert "not categorized" in out
