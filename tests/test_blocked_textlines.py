"""Tests for ``annotate_blocked_textlines``: which textlines get flagged
as permanently unable to play because their hard requirements reference
undefined textlines, and the reverse-lookup used by the viewer to show
which dialogues a given unresolved ref blocks."""

from build_viewer import annotate_blocked_textlines


def _tl(reqs=None, other=None):
    """Build a minimal textline entry with the given requirements."""
    return {
        "owner": "TestOwner",
        "section": "TextLineSet",
        "source": "test",
        "requirements": reqs or {},
        "otherRequirements": other or {},
        "dialogueLines": [],
    }


class TestAllSemantics:
    """``RequiredTextLines``-family fields use 'all' semantics: any
    missing entry permanently blocks the textline from playing."""

    def test_any_missing_ref_blocks(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["MissingX"]}),
        })
        annotate_blocked_textlines(gd)
        assert gd["textlines"]["A"]["blocked"] is True
        reasons = gd["textlines"]["A"]["blockingReasons"]
        assert len(reasons) == 1
        assert reasons[0]["field"] == "RequiredTextLines"
        assert reasons[0]["semantics"] == "all"
        assert reasons[0]["missingRefs"] == ["MissingX"]
        assert reasons[0]["totalRefs"] == 1

    def test_partial_missing_still_blocks(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["MissingX", "B"]}),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert gd["textlines"]["A"]["blocked"] is True
        assert gd["textlines"]["A"]["blockingReasons"][0]["missingRefs"] == ["MissingX"]
        assert gd["textlines"]["A"]["blockingReasons"][0]["totalRefs"] == 2

    def test_all_resolved_does_not_block(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["B"]}),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert "blocked" not in gd["textlines"]["A"]

    def test_all_semantics_variants_block(self, make_graph_data):
        """The 'all'-semantics fields include ThisRun/LastRun/ThisRoom
        and the Queued variant."""
        for field in (
            "RequiredTextLines",
            "RequiredTextLinesThisRun",
            "RequiredTextLinesLastRun",
            "RequiredTextLinesThisRoom",
            "RequiredQueuedTextLines",
        ):
            gd = make_graph_data(textlines={"A": _tl({field: ["MissingX"]})})
            annotate_blocked_textlines(gd)
            assert gd["textlines"]["A"].get("blocked") is True, \
                f"{field} should be 'all' semantics and block"


class TestAnySemantics:
    """``RequiredAny*TextLines`` fields use 'any' semantics: blocked
    only when ALL entries are unresolved."""

    def test_all_missing_blocks(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredAnyTextLines": ["MissingX", "MissingY"]}),
        })
        annotate_blocked_textlines(gd)
        assert gd["textlines"]["A"]["blocked"] is True
        reason = gd["textlines"]["A"]["blockingReasons"][0]
        assert reason["semantics"] == "any"
        assert reason["totalRefs"] == 2
        assert reason["missingRefs"] == ["MissingX", "MissingY"]

    def test_partial_missing_does_not_block(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredAnyTextLines": ["MissingX", "B"]}),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert "blocked" not in gd["textlines"]["A"]

    def test_any_semantics_variants(self, make_graph_data):
        for field in (
            "RequiredAnyTextLines",
            "RequiredAnyOtherTextLines",
            "RequiredAnyTextLinesThisRun",
            "RequiredAnyTextLinesLastRun",
            "RequiredAnyQueuedTextLines",
        ):
            gd = make_graph_data(textlines={"A": _tl({field: ["MissingX"]})})
            annotate_blocked_textlines(gd)
            assert gd["textlines"]["A"].get("blocked") is True, \
                f"{field} should be 'any' semantics and block when all missing"


class TestNoneSemantics:
    """``RequiredFalse*TextLines`` fields are non-blocking: missing
    entries trivially satisfy 'this must NOT have played'."""

    def test_false_fields_never_block(self, make_graph_data):
        for field in (
            "RequiredFalseTextLines",
            "RequiredFalseTextLinesThisRun",
            "RequiredFalseTextLinesLastRun",
            "RequiredFalseTextLinesThisRoom",
            "RequiredFalseQueuedTextLines",
        ):
            gd = make_graph_data(textlines={"A": _tl({field: ["MissingX"]})})
            annotate_blocked_textlines(gd)
            assert "blocked" not in gd["textlines"]["A"], \
                f"{field} should never block"


class TestCountPermissiveSemantics:
    """``RequiredMaxAnyTextLines`` and the ``*RunsSince*`` family are
    permissive: 'X has been played at most N times' is trivially
    satisfied when X is undefined (it has been played zero times)."""

    def test_max_any_never_blocks(self, make_graph_data):
        for field in (
            "RequiredMaxAnyTextLines",
            "MinRunsSinceAnyTextLines",
            "MaxRunsSinceAnyTextLines",
        ):
            gd = make_graph_data(textlines={
                "A": _tl(
                    reqs={field: ["MissingX"]},
                    other={field: {"Count": 5}},
                ),
            })
            annotate_blocked_textlines(gd)
            assert "blocked" not in gd["textlines"]["A"], \
                f"{field} should be permissive and never block"


class TestCountMinSemantics:
    """``RequiredMinAnyTextLines`` requires Count entries to have played.
    Blocked when resolvedCount < Count."""

    def test_blocks_when_resolved_below_count(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl(
                reqs={"RequiredMinAnyTextLines": ["MissingX", "MissingY", "B"]},
                other={"RequiredMinAnyTextLines": {"Count": 2}},
            ),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert gd["textlines"]["A"]["blocked"] is True
        reason = gd["textlines"]["A"]["blockingReasons"][0]
        assert reason["semantics"] == "count-min"
        assert reason["requiredCount"] == 2
        assert reason["resolvedCount"] == 1
        assert reason["totalRefs"] == 3
        assert reason["missingRefs"] == ["MissingX", "MissingY"]

    def test_does_not_block_when_resolved_meets_count(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl(
                reqs={"RequiredMinAnyTextLines": ["MissingX", "B", "C"]},
                other={"RequiredMinAnyTextLines": {"Count": 2}},
            ),
            "B": _tl(),
            "C": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert "blocked" not in gd["textlines"]["A"]

    def test_default_count_is_one(self, make_graph_data):
        """When the meta dict lacks an explicit Count, the parser
        treats it as 1."""
        gd = make_graph_data(textlines={
            "A": _tl(
                reqs={"RequiredMinAnyTextLines": ["B"]},
                other={"RequiredMinAnyTextLines": {}},  # no Count
            ),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert "blocked" not in gd["textlines"]["A"]


class TestMultipleFields:
    """A textline blocked by multiple fields gets one entry per field
    in blockingReasons; non-blocking fields are not included."""

    def test_multiple_blocking_fields_listed(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({
                "RequiredTextLines": ["MissingX"],
                "RequiredAnyTextLines": ["MissingY", "MissingZ"],
                "RequiredFalseTextLines": ["MissingW"],  # never blocks
            }),
        })
        annotate_blocked_textlines(gd)
        reasons = gd["textlines"]["A"]["blockingReasons"]
        assert len(reasons) == 2
        fields = {r["field"] for r in reasons}
        assert fields == {"RequiredTextLines", "RequiredAnyTextLines"}


class TestReverseLookup:
    """``unresolvedRefBlocks`` maps each unresolved ref to the dialogues
    it blocks - used by the viewer to surface 'blocks: X, Y' on the
    unresolved-ref info-panel."""

    def test_reverse_index_built(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["MissingX"]}),
            "B": _tl({"RequiredTextLines": ["MissingX"]}),
            "C": _tl({"RequiredAnyTextLines": ["MissingY"]}),
        })
        annotate_blocked_textlines(gd)
        assert gd["unresolvedRefBlocks"]["MissingX"] == ["A", "B"]
        assert gd["unresolvedRefBlocks"]["MissingY"] == ["C"]

    def test_resolved_refs_absent_from_reverse_index(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["B"]}),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert gd["unresolvedRefBlocks"] == {}


class TestStats:
    """The blocked count must be written into stats."""

    def test_blocked_count_in_stats(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["MissingX"]}),
            "B": _tl({"RequiredTextLines": ["MissingY"]}),
            "C": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert gd["stats"]["blockedTextlines"] == 2

    def test_zero_when_nothing_blocked(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["B"]}),
            "B": _tl(),
        })
        annotate_blocked_textlines(gd)
        assert gd["stats"]["blockedTextlines"] == 0
        assert gd["unresolvedRefBlocks"] == {}
