"""Tests for ``annotate_play_once``: folding the self-negative
``RequiredFalseTextLines`` idiom into the ``playOnce`` flag."""

from src.play_once import annotate_play_once, is_self_play_once


def _tl(reqs=None, **extra):
    tl = {
        "owner": "TestOwner",
        "section": "TextLineSet",
        "requirements": reqs or {},
        "otherRequirements": {},
    }
    tl.update(extra)
    return tl


class TestIsSelfPlayOnce:
    def test_self_reference_is_play_once(self):
        assert is_self_play_once("A", {"RequiredFalseTextLines": ["A"]}) is True

    def test_self_reference_among_others(self):
        assert is_self_play_once("A", {"RequiredFalseTextLines": ["B", "A"]}) is True

    def test_negative_on_other_line_is_not_self_play_once(self):
        assert is_self_play_once("A", {"RequiredFalseTextLines": ["B"]}) is False

    def test_scoped_negative_self_reference_does_not_count(self):
        # ThisRun / ThisRoom / LastRun / queued negatives reset, so a
        # self-reference there is a cooldown, not a permanent single-play.
        assert is_self_play_once("A", {"RequiredFalseTextLinesThisRun": ["A"]}) is False
        assert is_self_play_once("A", {"RequiredFalseTextLinesLastRun": ["A"]}) is False

    def test_no_requirements(self):
        assert is_self_play_once("A", {}) is False
        assert is_self_play_once("A", None) is False


class TestAnnotatePlayOnce:
    def test_self_negative_line_is_flagged(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredFalseTextLines": ["A"]}),
        })
        annotate_play_once(gd)
        assert gd["textlines"]["A"]["playOnce"] is True
        assert gd["stats"]["playOnceFromSelfNegative"] == 1

    def test_existing_flag_is_left_alone_and_not_counted(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({}, playOnce=True),
        })
        annotate_play_once(gd)
        assert gd["textlines"]["A"]["playOnce"] is True
        assert gd["stats"]["playOnceFromSelfNegative"] == 0

    def test_repeatable_line_is_untouched(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"RequiredTextLines": ["B"]}),
            "B": _tl(),
        })
        annotate_play_once(gd)
        assert "playOnce" not in gd["textlines"]["A"]
        assert gd["stats"]["playOnceFromSelfNegative"] == 0

    def test_mixed_set_counts_only_newly_flipped(self, make_graph_data):
        gd = make_graph_data(textlines={
            "SelfNeg": _tl({"RequiredFalseTextLines": ["SelfNeg"]}),
            "Flagged": _tl({"RequiredFalseTextLines": ["Flagged"]}, playOnce=True),
            "Repeat": _tl({"RequiredAnyTextLines": ["X"]}),
        })
        annotate_play_once(gd)
        assert gd["textlines"]["SelfNeg"]["playOnce"] is True
        assert gd["textlines"]["Flagged"]["playOnce"] is True
        assert "playOnce" not in gd["textlines"]["Repeat"]
        assert gd["stats"]["playOnceFromSelfNegative"] == 1
