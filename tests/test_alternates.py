"""Tests for ``build_alternates``: detection of mutually-exclusive alternate
dialogues (the ``_A`` / ``_B`` variant pattern).

Two-step algorithm: (1) group textlines by name stem (strip a trailing
``_?[A-Z]`` suffix), (2) confirm a group only when its members reference
each other via a "confirming" requirement field (``RequiredFalse*`` /
``RequiredAny*``). Sharing a stem alone is not enough.
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
