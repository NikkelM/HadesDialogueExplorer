"""Tests for ``apply_manual_overrides``: the curated per-textline field
override layer, and the real registry's documented edge cases."""

import pytest

from src.manual_overrides import MANUAL_OVERRIDES, apply_manual_overrides


def _tl(**extra):
    """Minimal textline entry."""
    base = {
        "owner": "TestOwner",
        "section": "TextLineSet",
        "requirements": {},
        "dialogueLines": [],
    }
    base.update(extra)
    return base


class TestApply:
    def test_applies_field_override(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl()})
        overrides = {"hades2": {"A": {"playOnce": True}}}
        n = apply_manual_overrides(gd, "hades2", overrides=overrides)
        assert n == 1
        assert gd["textlines"]["A"]["playOnce"] is True

    def test_applies_multiple_fields(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl()})
        overrides = {"hades1": {"A": {"playOnce": True, "section": "Override"}}}
        apply_manual_overrides(gd, "hades1", overrides=overrides)
        assert gd["textlines"]["A"]["playOnce"] is True
        assert gd["textlines"]["A"]["section"] == "Override"

    def test_overwrites_existing_value(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl(playOnce=True)})
        overrides = {"hades2": {"A": {"playOnce": False}}}
        apply_manual_overrides(gd, "hades2", overrides=overrides)
        assert gd["textlines"]["A"]["playOnce"] is False

    def test_only_applies_to_the_named_textline(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl(), "B": _tl()})
        overrides = {"hades2": {"A": {"playOnce": True}}}
        apply_manual_overrides(gd, "hades2", overrides=overrides)
        assert gd["textlines"]["A"].get("playOnce") is True
        assert "playOnce" not in gd["textlines"]["B"]


class TestScoping:
    def test_game_without_overrides_is_noop(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl()})
        overrides = {"hades2": {"A": {"playOnce": True}}}
        n = apply_manual_overrides(gd, "hades1", overrides=overrides)
        assert n == 0
        assert "playOnce" not in gd["textlines"]["A"]

    def test_empty_registry_is_noop(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl()})
        assert apply_manual_overrides(gd, "hades2", overrides={}) == 0


class TestValidation:
    def test_missing_textline_raises(self, make_graph_data):
        gd = make_graph_data(textlines={"A": _tl()})
        overrides = {"hades2": {"DoesNotExist": {"playOnce": True}}}
        with pytest.raises(ValueError, match="DoesNotExist"):
            apply_manual_overrides(gd, "hades2", overrides=overrides)


class TestRegistry:
    """The real registry's documented edge-case corrections."""

    def test_hades2_marks_hades_with_hecate_play_once(self):
        assert MANUAL_OVERRIDES["hades2"]["HadesWithHecate01"]["playOnce"] is True

    def test_registry_shape_is_per_game_dicts(self):
        for game, entries in MANUAL_OVERRIDES.items():
            assert isinstance(game, str)
            assert isinstance(entries, dict)
            for name, fields in entries.items():
                assert isinstance(name, str)
                assert isinstance(fields, dict)

    def test_real_registry_applies_via_default_table(self, make_graph_data):
        # When called without an explicit table the module registry is
        # used; a graph that contains the targeted textline is corrected.
        gd = make_graph_data(textlines={"HadesWithHecate01": _tl()})
        n = apply_manual_overrides(gd, "hades2")
        assert n == 1
        assert gd["textlines"]["HadesWithHecate01"]["playOnce"] is True
