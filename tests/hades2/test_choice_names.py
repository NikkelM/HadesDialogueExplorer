"""Tests for :mod:`src.extractors.hades2.choice_names`.

Confirms the vendored ``HADES2_CHOICE_NAMES`` map covers every
``ChoiceText`` id observed in the H2 NPC source files at the time of
extraction, and that the friendly labels follow the consistent
"Accept" / "Decline" convention so the viewer can render them
side-by-side without per-NPC styling.
"""

from src.extractors.hades2.choice_names import HADES2_CHOICE_NAMES


class TestChoiceNamesShape:
    def test_all_keys_use_choice_prefix(self):
        for key in HADES2_CHOICE_NAMES:
            assert key.startswith("Choice_"), key

    def test_all_values_are_strings(self):
        for key, value in HADES2_CHOICE_NAMES.items():
            assert isinstance(value, str) and value, key

    def test_accept_decline_pairs_complete(self):
        # Every NPC with at least one Choice_<NPC>Accept must also
        # have a paired Decline (and vice versa). Sanity check that
        # the vendored map didn't drop one side of a pair.
        npcs = set()
        for key in HADES2_CHOICE_NAMES:
            if key.endswith("Accept"):
                npcs.add(key[len("Choice_"):-len("Accept")])
            elif key.endswith("Decline"):
                npcs.add(key[len("Choice_"):-len("Decline")])
        for npc in npcs:
            assert f"Choice_{npc}Accept" in HADES2_CHOICE_NAMES
            assert f"Choice_{npc}Decline" in HADES2_CHOICE_NAMES


class TestCurrentInventory:
    def test_four_npcs_with_choices(self):
        # As of the initial extraction pass: Eris, Icarus, Moros,
        # Nemesis each ship one Becoming Closer prompt.
        expected = {
            "Choice_ErisAccept",     "Choice_ErisDecline",
            "Choice_IcarusAccept",   "Choice_IcarusDecline",
            "Choice_MorosAccept",    "Choice_MorosDecline",
            "Choice_NemesisAccept",  "Choice_NemesisDecline",
        }
        assert set(HADES2_CHOICE_NAMES) == expected

    def test_accept_label_consistent(self):
        for key in HADES2_CHOICE_NAMES:
            if key.endswith("Accept"):
                assert HADES2_CHOICE_NAMES[key] == "Accept"

    def test_decline_label_consistent(self):
        for key in HADES2_CHOICE_NAMES:
            if key.endswith("Decline"):
                assert HADES2_CHOICE_NAMES[key] == "Decline"


class TestModuleExport:
    def test_exported_from_package(self):
        from src.extractors.hades2 import HADES2_CHOICE_NAMES as exported
        assert exported is HADES2_CHOICE_NAMES
