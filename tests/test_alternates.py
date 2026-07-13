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
Sharing a stem alone is not enough. Confirming references are gathered from a
textline's top-level ``requirements`` as well as from each ``orBranches`` clause,
so a gate expressed only inside an OR branch still confirms.
"""

from src.graph import build_alternates, audit_content_alternate_drift, _CONTENT_ALTERNATE_GROUPS


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

    def test_complementary_choice_in_or_branches_confirms(self):
        # The mutually-exclusive choice gate lives inside ``orBranches`` (the
        # top-level requirements are empty) - e.g. MorosAboutRelationship03 needs
        # the Accept branch of the one-time MorosBecomingCloser01 choice and its
        # ``_B`` sibling the Decline branch. Branch refs must be gathered for the
        # complementary-choice confirmation to see them.
        tls = {
            "MorosAboutRelationship03": {
                "requirements": {},
                "orBranches": [
                    {"requirements": {"RequiredAnyTextLines": ["MorosBecomingCloser01Choice_MorosAccept"]}},
                    {"requirements": {"RequiredAnyTextLines": ["MorosBecomingCloser01_BChoice_MorosAccept"]}},
                ],
            },
            "MorosAboutRelationship03_B": {
                "requirements": {},
                "orBranches": [
                    {"requirements": {"RequiredAnyTextLines": ["MorosBecomingCloser01Choice_MorosDecline"]}},
                    {"requirements": {"RequiredAnyTextLines": ["MorosBecomingCloser01_BChoice_MorosDecline"]}},
                ],
            },
        }
        assert build_alternates(tls) == {
            "MorosAboutRelationship03": ["MorosAboutRelationship03_B"],
            "MorosAboutRelationship03_B": ["MorosAboutRelationship03"],
        }

    def test_direct_cross_reference_in_or_branch_confirms(self):
        # A sibling cross-reference inside an OR branch confirms just like a
        # top-level one.
        tls = {
            "Chat_A": {"requirements": {}, "orBranches": [
                {"requirements": {"RequiredFalseTextLines": ["Chat_B"]}},
            ]},
            "Chat_B": {"requirements": {}},
        }
        assert build_alternates(tls) == {
            "Chat_A": ["Chat_B"],
            "Chat_B": ["Chat_A"],
        }

    def test_content_alternate_group_linked_without_gate(self):
        # Names in _CONTENT_ALTERNATE_GROUPS (issue #133) are linked even with no
        # gating requirements and no shared name stem - the trailing "03" means
        # the name-stem heuristic never groups them, so only the content list
        # links them.
        tls = {
            "Inspect_Q_Boss01_03": _tl(),
            "Inspect_Q_Boss02_03": _tl(),
        }
        assert build_alternates(tls) == {
            "Inspect_Q_Boss01_03": ["Inspect_Q_Boss02_03"],
            "Inspect_Q_Boss02_03": ["Inspect_Q_Boss01_03"],
        }

    def test_content_alternate_skips_absent_members(self):
        # A content group only links members actually present in the textline
        # set, so an H1 group never leaks into an H2-only build (and vice versa).
        assert build_alternates({"Inspect_Q_Boss01_03": _tl()}) == {}

    def test_content_alternate_multi_member_group_is_symmetric(self):
        # A 4-member content group is emitted as one symmetric cluster (each
        # member lists the other three).
        members = {"MegaeraMeeting01", "MegaeraMeeting01_Alt",
                   "MegaeraMeeting01_Alt_B", "MegaeraMeeting01_B"}
        alt = build_alternates({m: _tl() for m in members})
        for m in members:
            assert set(alt[m]) == members - {m}


class TestContentAlternateDrift:
    """``audit_content_alternate_drift`` surfaces curated content-alternate
    groups whose members no longer exist across the extracted data (a rename /
    removal in a game update), so a silently-dropped alternate link is noticed."""

    def _all_members(self):
        return {n for group in _CONTENT_ALTERNATE_GROUPS for n in group}

    def test_no_drift_when_every_member_present(self):
        warnings = []
        drift = audit_content_alternate_drift(self._all_members(), warn=warnings.append)
        assert drift == []
        assert warnings == []

    def test_drift_detected_and_warned_when_a_member_is_missing(self):
        victim = _CONTENT_ALTERNATE_GROUPS[0][0]
        names = self._all_members() - {victim}
        warnings = []
        drift = audit_content_alternate_drift(names, warn=warnings.append)
        flagged = [missing for _g, _present, missing in drift if victim in missing]
        assert flagged, "the drifted group was not flagged"
        assert any("_CONTENT_ALTERNATE_GROUPS" in w for w in warnings)

    def test_full_union_is_clean_no_cross_game_false_trigger(self):
        # The union of ALL groups' members (both games) must audit clean - a
        # group whose members belong to the other game still counts as present.
        assert audit_content_alternate_drift(self._all_members(), warn=lambda m: None) == []
