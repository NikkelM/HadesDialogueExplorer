"""Tests for the direct-eligibility classifier behind the eligibility API's
``status`` field.

Pins the AND / OR / negative semantics and that the requirement-type sets
derive from the generator's canonical ``REQUIREMENT_BLOCKING_SEMANTICS`` map
rather than a hand-maintained copy that can silently drift.
"""

import api
from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS


def _tl(reqs):
    return {"requirements": reqs}


def _fields_with(semantics):
    return {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == semantics}


class TestDerivedSets:
    """The API's classifications must come straight from the canonical map."""

    def test_sets_derive_from_canonical_map(self):
        assert api.AND_REQ_TYPES == _fields_with("all")
        assert api.OR_REQ_TYPES == _fields_with("any")
        assert api.NEGATIVE_REQ_TYPES == _fields_with("none")

    def test_any_this_run_is_an_or_gate(self):
        # Regression: the previous hand-maintained OR set omitted this field.
        assert "RequiredAnyTextLinesThisRun" in api.OR_REQ_TYPES

    def test_count_fields_are_not_classified_as_prerequisites(self):
        evaluated = api.AND_REQ_TYPES | api.OR_REQ_TYPES | api.NEGATIVE_REQ_TYPES
        count_fields = _fields_with("count-min") | _fields_with("count-permissive")
        assert evaluated.isdisjoint(count_fields)


class TestDirectlySatisfied:
    def test_no_requirements_is_satisfied(self):
        assert api.is_directly_satisfied(_tl({}), set()) is True
        assert api.is_directly_satisfied({}, set()) is True

    def test_and_requires_all(self):
        t = _tl({"RequiredTextLines": ["A", "B"]})
        assert api.is_directly_satisfied(t, {"A"}) is False
        assert api.is_directly_satisfied(t, {"A", "B"}) is True

    def test_or_requires_at_least_one(self):
        t = _tl({"RequiredAnyTextLines": ["A", "B"]})
        assert api.is_directly_satisfied(t, set()) is False
        assert api.is_directly_satisfied(t, {"B"}) is True

    def test_negative_blocks_only_when_the_forbidden_line_played(self):
        t = _tl({"RequiredFalseTextLines": ["X"]})
        assert api.is_directly_satisfied(t, set()) is True
        assert api.is_directly_satisfied(t, {"X"}) is False

    def test_negative_self_reference_satisfied_when_unplayed(self):
        # The canonical play-once gate: a line that forbids itself is
        # eligible until it has played.
        t = _tl({"RequiredFalseTextLines": ["Ending01"]})
        assert api.is_directly_satisfied(t, set(), "Ending01") is True

    def test_count_fields_treated_as_satisfied(self):
        assert api.is_directly_satisfied(_tl({"RequiredMinAnyTextLines": ["A", "B"]}), set()) is True
        assert api.is_directly_satisfied(_tl({"MinRunsSinceAnyTextLines": ["A"]}), set()) is True

    def test_mixed_and_negative(self):
        t = _tl({"RequiredTextLines": ["A"], "RequiredFalseTextLines": ["B"]})
        assert api.is_directly_satisfied(t, set()) is False
        assert api.is_directly_satisfied(t, {"A"}) is True
        assert api.is_directly_satisfied(t, {"A", "B"}) is False

    def test_non_list_requirement_values_are_ignored(self):
        # otherRequirements-style scalar metadata can appear; it must not crash.
        assert api.is_directly_satisfied(_tl({"RequiredTextLines": "notalist"}), set()) is True
