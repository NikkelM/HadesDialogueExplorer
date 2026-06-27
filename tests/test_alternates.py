"""Tests for ``build_alternates``: detection of mutually-exclusive alternate
dialogues (the ``_A`` / ``_B`` and ``_Alt`` variant patterns).

Two-step algorithm: (1) group textlines by name stem (strip a trailing
``_?[A-Z]`` suffix or an explicit ``_Alt`` marker), (2) confirm a group only
when its members are mutually exclusive. Confirmation accepts a direct
``RequiredFalse*`` / ``RequiredAny*`` cross-reference, and three indirect patterns
that never name each other directly: complementary choice branches (Accept vs
Decline of one choice), HasAny-vs-HasNone over the same referenced set, and a
complementary fixed-per-save flag gate (one sibling needs flag F true, the other
false, where F never changes within a save - only ``HardMode``).
Sharing a stem alone is not enough.
"""

from src.graph import build_alternates


def _tl(reqs=None):
    """Minimal textline entry: only the requirements drive alternate
    confirmation."""
    return {"requirements": reqs or {}}


class TestBuildAlternates:
    def test_confirmed_pair_via_required_false(self):
        tls = {
            "FooBar_A": _tl({"RequiredFalseTextLines": ["FooBar_B"]}),
            "FooBar_B": _tl({"RequiredFalseTextLines": ["FooBar_A"]}),
        }
        assert build_alternates(tls) == {
            "FooBar_A": ["FooBar_B"],
            "FooBar_B": ["FooBar_A"],
        }

    def test_confirmed_via_required_any(self):
        tls = {
            "Greeting_A": _tl({"RequiredAnyTextLines": ["Greeting_B"]}),
            "Greeting_B": _tl({"RequiredAnyTextLines": ["Greeting_A"]}),
        }
        assert build_alternates(tls) == {
            "Greeting_A": ["Greeting_B"],
            "Greeting_B": ["Greeting_A"],
        }

    def test_one_directional_reference_confirms_both(self):
        # Only one member needs to name the other for the whole group to
        # confirm (the co-occurrence pulls both in).
        tls = {
            "FooBar_A": _tl({"RequiredFalseTextLines": ["FooBar_B"]}),
            "FooBar_B": _tl(),
        }
        assert build_alternates(tls) == {
            "FooBar_A": ["FooBar_B"],
            "FooBar_B": ["FooBar_A"],
        }

    def test_three_way_group(self):
        tls = {
            "Talk_A": _tl({"RequiredFalseTextLines": ["Talk_B", "Talk_C"]}),
            "Talk_B": _tl({"RequiredFalseTextLines": ["Talk_A", "Talk_C"]}),
            "Talk_C": _tl({"RequiredFalseTextLines": ["Talk_A", "Talk_B"]}),
        }
        assert build_alternates(tls) == {
            "Talk_A": ["Talk_B", "Talk_C"],
            "Talk_B": ["Talk_A", "Talk_C"],
            "Talk_C": ["Talk_A", "Talk_B"],
        }

    def test_base_form_joins_suffixed_group(self):
        # The no-suffix base name (``FooBar``) is added to its suffixed
        # siblings' group when it exists.
        tls = {
            "FooBar": _tl({"RequiredFalseTextLines": ["FooBar_A"]}),
            "FooBar_A": _tl({"RequiredFalseTextLines": ["FooBar"]}),
        }
        assert build_alternates(tls) == {
            "FooBar": ["FooBar_A"],
            "FooBar_A": ["FooBar"],
        }

    def test_alt_suffix_pairs_with_base(self):
        # The ``_Alt`` naming convention (a base line and its ``..._Alt``
        # variant that forbid each other) groups under the shared stem -
        # the trailing ``_Alt`` is stripped just like a single-letter suffix.
        tls = {
            "DusaLoungeRenovationQuest02": _tl({"RequiredFalseTextLines": ["DusaLoungeRenovationQuest02_Alt"]}),
            "DusaLoungeRenovationQuest02_Alt": _tl({"RequiredFalseTextLines": ["DusaLoungeRenovationQuest02"]}),
        }
        assert build_alternates(tls) == {
            "DusaLoungeRenovationQuest02": ["DusaLoungeRenovationQuest02_Alt"],
            "DusaLoungeRenovationQuest02_Alt": ["DusaLoungeRenovationQuest02"],
        }

    def test_shared_stem_without_co_occurrence_is_not_confirmed(self):
        # Same stem, but no confirming reference between them -> not alternates.
        tls = {
            "FooBar_A": _tl({"RequiredTextLines": ["Unrelated"]}),
            "FooBar_B": _tl(),
        }
        assert build_alternates(tls) == {}

    def test_non_confirming_requirement_type_does_not_confirm(self):
        # RequiredTextLines is a hard AND prerequisite, not a confirming
        # (mutual-exclusion) field, so cross-references through it don't count.
        tls = {
            "FooBar_A": _tl({"RequiredTextLines": ["FooBar_B"]}),
            "FooBar_B": _tl({"RequiredTextLines": ["FooBar_A"]}),
        }
        assert build_alternates(tls) == {}

    def test_single_member_group_ignored(self):
        tls = {"Lonely_A": _tl({"RequiredFalseTextLines": ["Missing_B"]})}
        assert build_alternates(tls) == {}

    def test_self_reference_is_not_its_own_alternate(self):
        # A textline listing itself in a confirming field (a play-once
        # idiom) must not become its own sibling.
        tls = {
            "FooBar_A": _tl({"RequiredFalseTextLines": ["FooBar_A", "FooBar_B"]}),
            "FooBar_B": _tl(),
        }
        result = build_alternates(tls)
        assert "FooBar_A" not in result["FooBar_A"]
        assert result == {
            "FooBar_A": ["FooBar_B"],
            "FooBar_B": ["FooBar_A"],
        }

    def test_complementary_choice_branches_confirm(self):
        # Each member is gated on the opposite branch of a one-time choice
        # (Accept vs Decline of the same choice node), so exactly one can ever
        # play - they confirm without naming each other.
        tls = {
            "ErisAboutRelationship03": _tl(
                {"RequiredAnyTextLines": ["ErisBecomingCloser01Choice_ErisAccept"]}
            ),
            "ErisAboutRelationship03_B": _tl(
                {"RequiredAnyTextLines": ["ErisBecomingCloser01Choice_ErisDecline"]}
            ),
        }
        assert build_alternates(tls) == {
            "ErisAboutRelationship03": ["ErisAboutRelationship03_B"],
            "ErisAboutRelationship03_B": ["ErisAboutRelationship03"],
        }

    def test_same_choice_outcome_does_not_confirm(self):
        # Both gated on the *same* outcome - not mutually exclusive.
        tls = {
            "Talk_A": _tl({"RequiredAnyTextLines": ["ChoiceFoo_Accept"]}),
            "Talk_B": _tl({"RequiredAnyTextLines": ["ChoiceFoo_Accept"]}),
        }
        assert build_alternates(tls) == {}

    def test_has_any_vs_has_none_over_same_set_confirms(self):
        # One member needs at least one of a set, the other needs none of that
        # same set - strictly complementary.
        gate = ["BecameCloseWithMegaera01", "BecameCloseWithMegaera01_B"]
        tls = {
            "FuryPactReaction02": _tl({"RequiredFalseTextLines": gate}),
            "FuryPactReaction02_B": _tl({"RequiredAnyTextLines": gate}),
        }
        assert build_alternates(tls) == {
            "FuryPactReaction02": ["FuryPactReaction02_B"],
            "FuryPactReaction02_B": ["FuryPactReaction02"],
        }

    def test_has_any_vs_has_none_over_different_sets_not_confirmed(self):
        tls = {
            "Talk_A": _tl({"RequiredFalseTextLines": ["LineX"]}),
            "Talk_B": _tl({"RequiredAnyTextLines": ["LineY"]}),
        }
        assert build_alternates(tls) == {}

    def test_complementary_fixed_per_save_flag_confirms(self):
        # One sibling needs HardMode true, the other false. HardMode is fixed at
        # save creation and never changes, so exactly one can ever play - they
        # confirm without naming each other.
        tls = {
            "FuryPactReaction01": {
                "requirements": {"RequiredTextLines": ["FuryFirstAppearance"]},
                "otherRequirements": {"RequiredFalseFlags": ["HardMode"]},
            },
            "FuryPactReaction01_B": {
                "requirements": {"RequiredTextLines": ["FuryFirstAppearance"]},
                "otherRequirements": {"RequiredTrueFlags": ["HardMode"]},
            },
        }
        assert build_alternates(tls) == {
            "FuryPactReaction01": ["FuryPactReaction01_B"],
            "FuryPactReaction01_B": ["FuryPactReaction01"],
        }

    def test_complementary_toggle_flag_does_not_confirm(self):
        # PersephoneAway flips true/false repeatedly over a save (a ~7-run
        # cycle), so a "must be away" and "must NOT be away" sibling can both
        # play at different times - not a genuine alternate partition.
        tls = {
            "Talk_A": {"requirements": {}, "otherRequirements": {"RequiredTrueFlags": ["PersephoneAway"]}},
            "Talk_B": {"requirements": {}, "otherRequirements": {"RequiredFalseFlags": ["PersephoneAway"]}},
        }
        assert build_alternates(tls) == {}

    def test_complementary_one_way_unlock_flag_does_not_confirm(self):
        # ShrineUnlocked only ever flips false -> true once, so the "false"
        # sibling plays before the unlock and the "true" sibling after - both
        # can play across a save's lifetime, so they are not alternates.
        tls = {
            "Talk_A": {"requirements": {}, "otherRequirements": {"RequiredTrueFlags": ["ShrineUnlocked"]}},
            "Talk_B": {"requirements": {}, "otherRequirements": {"RequiredFalseFlags": ["ShrineUnlocked"]}},
        }
        assert build_alternates(tls) == {}
