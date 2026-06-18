"""Tests for the direct-eligibility classifier behind the eligibility API's
``status`` field.

Pins the AND / OR / negative / count-min semantics and that the
requirement-type sets derive from the generator's canonical
``REQUIREMENT_BLOCKING_SEMANTICS`` map rather than a hand-maintained copy
that can silently drift.
"""

import api
from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS


def _tl(reqs, other=None):
    return {"requirements": reqs, "otherRequirements": other or {}}


def _fields_with(semantics):
    return {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == semantics}


class TestDerivedSets:
    """The API's classifications must come straight from the canonical map."""

    def test_sets_derive_from_canonical_map(self):
        assert api.AND_REQ_TYPES == _fields_with("all")
        assert api.OR_REQ_TYPES == _fields_with("any")
        assert api.NEGATIVE_REQ_TYPES == _fields_with("none")
        assert api.COUNT_MIN_REQ_TYPES == _fields_with("count-min")

    def test_any_this_run_is_an_or_gate(self):
        # Regression: the previous hand-maintained OR set omitted this field.
        assert "RequiredAnyTextLinesThisRun" in api.OR_REQ_TYPES

    def test_run_count_fields_are_not_classified_as_prerequisites(self):
        # count-permissive (run-count / cooldown) fields can't be evaluated
        # from the played set, so they appear in none of the evaluated sets.
        evaluated = (
            api.AND_REQ_TYPES | api.OR_REQ_TYPES
            | api.NEGATIVE_REQ_TYPES | api.COUNT_MIN_REQ_TYPES
        )
        assert evaluated.isdisjoint(_fields_with("count-permissive"))


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

    def test_count_min_requires_count_played(self):
        # RequiredMinAnyTextLines: blocked until at least Count of the listed
        # lines have played (Count read from otherRequirements).
        t = _tl(
            {"RequiredMinAnyTextLines": ["A", "B", "C"]},
            {"RequiredMinAnyTextLines": {"Count": 2}},
        )
        assert api.is_directly_satisfied(t, set()) is False
        assert api.is_directly_satisfied(t, {"A"}) is False
        assert api.is_directly_satisfied(t, {"A", "B"}) is True

    def test_count_min_defaults_to_one_without_count_param(self):
        t = _tl({"RequiredMinAnyTextLines": ["A", "B"]})
        assert api.is_directly_satisfied(t, set()) is False
        assert api.is_directly_satisfied(t, {"B"}) is True

    def test_run_count_fields_treated_as_satisfied(self):
        # Run-count / cooldown gates can't be evaluated from the played set.
        assert api.is_directly_satisfied(_tl({"MinRunsSinceAnyTextLines": ["A"]}), set()) is True
        assert api.is_directly_satisfied(_tl({"RequiredMaxAnyTextLines": ["A", "B"]}), set()) is True

    def test_mixed_and_negative(self):
        t = _tl({"RequiredTextLines": ["A"], "RequiredFalseTextLines": ["B"]})
        assert api.is_directly_satisfied(t, set()) is False
        assert api.is_directly_satisfied(t, {"A"}) is True
        assert api.is_directly_satisfied(t, {"A", "B"}) is False

    def test_non_list_requirement_values_are_ignored(self):
        # otherRequirements-style scalar metadata can appear; it must not crash.
        assert api.is_directly_satisfied(_tl({"RequiredTextLines": "notalist"}), set()) is True


class TestOrBranches:
    """H2 set-level ``orBranches`` (alternative requirement sets): a dialogue
    is eligible when its base requirements hold AND at least one branch is
    satisfied. Each branch is a full requirement set in its own right."""

    def test_empty_base_blocks_until_a_branch_is_satisfied(self):
        # Real shape (HadesAboutUltimateProgress02).
        tl = {
            "requirements": {},
            "orBranches": [
                {"requirements": {"RequiredFalseTextLines": ["Zag_2"], "RequiredTextLines": ["Zag"]}},
                {"requirements": {"RequiredTextLines": ["Zag_3"]}},
            ],
        }
        assert api.is_directly_satisfied(tl, set()) is False
        assert api.is_directly_satisfied(tl, {"Zag"}) is True
        assert api.is_directly_satisfied(tl, {"Zag_3"}) is True
        # branch 0's negative gate breaks, branch 1 rescues it.
        assert api.is_directly_satisfied(tl, {"Zag", "Zag_2"}) is False
        assert api.is_directly_satisfied(tl, {"Zag", "Zag_2", "Zag_3"}) is True

    def test_branch_with_empty_requirements_is_always_satisfied(self):
        # Real shape (ArachneAboutGods02): one branch gates on a non-textline
        # condition only, so the OR is trivially satisfied.
        tl = {
            "requirements": {},
            "orBranches": [
                {"requirements": {"RequiredTextLines": ["ArachneAboutGods01"]}},
                {"requirements": {}},
            ],
        }
        assert api.is_directly_satisfied(tl, set()) is True

    def test_multi_line_and_branch_needs_all_its_lines(self):
        # Real shape (NemesisAboutErisRelationship01): each branch requires two
        # textlines together; the count-permissive run-count field is ignored.
        tl = {
            "requirements": {},
            "orBranches": [
                {
                    "requirements": {
                        "MinRunsSinceAnyTextLines": ["Eris03", "Nem01"],
                        "RequiredTextLines": ["Eris03", "Nem01"],
                    },
                    "otherRequirements": {"MinRunsSinceAnyTextLines": {"Count": 1}},
                },
                {"requirements": {"RequiredTextLines": ["Eris03_B", "Nem01_B"]}},
            ],
        }
        assert api.is_directly_satisfied(tl, {"Eris03"}) is False
        assert api.is_directly_satisfied(tl, {"Eris03", "Nem01"}) is True
        assert api.is_directly_satisfied(tl, {"Eris03_B", "Nem01_B"}) is True

    def test_base_requirements_must_hold_alongside_a_branch(self):
        tl = {
            "requirements": {"RequiredTextLines": ["Base"]},
            "orBranches": [{"requirements": {"RequiredTextLines": ["Alt"]}}],
        }
        assert api.is_directly_satisfied(tl, {"Alt"}) is False
        assert api.is_directly_satisfied(tl, {"Base"}) is False
        assert api.is_directly_satisfied(tl, {"Base", "Alt"}) is True

    def test_count_min_in_a_branch_reads_branch_other_requirements(self):
        tl = {
            "requirements": {},
            "orBranches": [
                {
                    "requirements": {"RequiredMinAnyTextLines": ["A", "B", "C"]},
                    "otherRequirements": {"RequiredMinAnyTextLines": {"Count": 2}},
                },
            ],
        }
        assert api.is_directly_satisfied(tl, {"A"}) is False
        assert api.is_directly_satisfied(tl, {"A", "B"}) is True
