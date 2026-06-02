"""Regression tests for HADES1_SPEAKER_NAMES (issue #30).

The viewer surfaces character names in the search dropdown, info panel
header, dialogue line attributions, and tree node labels. We want
distinct internal IDs to either:
  (a) map to distinct display names so they can be told apart, OR
  (b) intentionally share a display name when the narrative split
      between them is not meaningful (allowlisted below).

This test enforces both rules so future additions cannot silently
collide with an existing mapping.
"""

from collections import defaultdict

from src.extractors.hades1.speaker_names import HADES1_SPEAKER_NAMES


# Display names that are intentionally shared by multiple internal IDs.
# Each entry is `display_name -> {internal_id, internal_id, ...}` and must
# match the actual collision set in HADES1_SPEAKER_NAMES exactly.
ALLOWED_COLLISIONS = {
    # Olympians: boon-offer owners share the bare god name with the
    # NPC_*_01 speaker. The offer line is the same god speaking - a
    # "(Boon)" qualifier would be visual noise rather than disambiguation.
    "Aphrodite": {"NPC_Aphrodite_01", "AphroditeUpgrade"},
    "Ares": {"NPC_Ares_01", "AresUpgrade"},
    "Artemis": {"NPC_Artemis_01", "ArtemisUpgrade"},
    "Athena": {"NPC_Athena_01", "AthenaUpgrade"},
    "Demeter": {"NPC_Demeter_01", "DemeterUpgrade"},
    "Dionysus": {"NPC_Dionysus_01", "DionysusUpgrade"},
    "Hermes": {"NPC_Hermes_01", "HermesUpgrade", "HermesUpgradeRare"},
    "Poseidon": {"NPC_Poseidon_01", "PoseidonUpgrade"},
    "Zeus": {"NPC_Zeus_01", "ZeusUpgrade"},
    "Chaos": {"NPC_Chaos_01", "ChaosUpgrade", "TrialUpgrade"},
    # Lesser Furies don't have a substantial House-vs-Boss dialogue split
    # the way Megaera does, so their boss owners share the NPC name.
    "Alecto": {"NPC_FurySister_02", "Harpy2"},
    "Tisiphone": {"NPC_FurySister_03", "Harpy3"},
    # Training dummy shares Skelly's identity - it's the same character.
    "Skelly": {"NPC_Skelly_01", "TrainingMelee"},
}


def _collisions_in(table):
    """Return ``{display_name: {internal_id, ...}}`` for every display
    name shared by more than one internal id."""
    by_name = defaultdict(set)
    for sid, name in table.items():
        by_name[name].add(sid)
    return {name: ids for name, ids in by_name.items() if len(ids) > 1}


class TestCollisionsMatchAllowlist:
    def test_every_collision_is_explicitly_allowed(self):
        actual = _collisions_in(HADES1_SPEAKER_NAMES)
        unexpected_names = set(actual) - set(ALLOWED_COLLISIONS)
        assert not unexpected_names, (
            "Display name collisions not on the allowlist - either pick "
            "a contextual qualifier (e.g. '(Boss)', '(Field)') or add to "
            f"ALLOWED_COLLISIONS with a justification: {dict((n, actual[n]) for n in unexpected_names)}"
        )

    def test_allowlisted_collision_membership_is_exact(self):
        actual = _collisions_in(HADES1_SPEAKER_NAMES)
        for name, expected_ids in ALLOWED_COLLISIONS.items():
            assert name in actual, (
                f"Allowlist expects {name!r} to be a shared display name "
                f"across {expected_ids} but no collision is present - "
                f"either remove from ALLOWED_COLLISIONS or restore the "
                f"intended mapping"
            )
            assert actual[name] == expected_ids, (
                f"{name!r} collision membership drifted: expected "
                f"{expected_ids}, got {actual[name]}"
            )

    def test_no_duplicate_keys(self):
        # Sanity: the Python dict literal can silently overwrite duplicate
        # keys. Bump this floor when adding entries.
        assert len(HADES1_SPEAKER_NAMES) >= 55


class TestKnownVariantPairsAreDistinct:
    """Spot-check the variant pairs that were explicitly called out in
    issue #30 as needing disambiguation. Pairs whose collision is now
    *intentional* (lesser Furies, boon owners, training dummy) live in
    ALLOWED_COLLISIONS and are not asserted here."""

    pairs = [
        ("NPC_Thanatos_01", "NPC_Thanatos_Field_01"),
        ("NPC_Cerberus_01", "NPC_Cerberus_Field_01"),
        ("NPC_Orpheus_01", "NPC_Orpheus_Story_01"),
        ("NPC_Achilles_01", "NPC_Achilles_Story_01"),
        ("NPC_Hades_01", "NPC_Hades_Story_01"),
        ("NPC_Hades_01", "Hades"),               # NPC vs boss
        ("NPC_Nyx_01", "NPC_Nyx_Story_01"),
        ("NPC_Persephone_01", "NPC_Persephone_Home_01"),
        ("NPC_Persephone_01", "NPC_Persephone_Unnamed_01"),
        ("NPC_Patroclus_01", "NPC_Patroclus_Unnamed_01"),
        ("NPC_FurySister_01", "Harpy"),          # Megaera NPC vs Boss
        ("NPC_Charon_01", "Charon"),             # Charon NPC vs Boss
        ("NPC_Patroclus_Unnamed_01", "NPC_Persephone_Unnamed_01"),  # both mystery
    ]

    def test_paired_ids_get_distinct_display_names(self):
        for a, b in self.pairs:
            assert a in HADES1_SPEAKER_NAMES, f"missing mapping for {a}"
            assert b in HADES1_SPEAKER_NAMES, f"missing mapping for {b}"
            assert HADES1_SPEAKER_NAMES[a] != HADES1_SPEAKER_NAMES[b], (
                f"{a} and {b} still share display name "
                f"{HADES1_SPEAKER_NAMES[a]!r}"
            )


class TestBaseFormsStayBare:
    """The labeling convention reserves the bare character name for the
    primary ``NPC_X_01`` form, so the search dropdown reads naturally
    when the user types e.g. 'Orpheus'."""

    base_form_expectations = {
        "NPC_Achilles_01": "Achilles",
        "NPC_Cerberus_01": "Cerberus",
        "NPC_Hades_01": "Hades",
        "NPC_Nyx_01": "Nyx",
        "NPC_Orpheus_01": "Orpheus",
        "NPC_Persephone_01": "Persephone",
        "NPC_Thanatos_01": "Thanatos",
        "NPC_FurySister_01": "Megaera",
        "NPC_Charon_01": "Charon",
        "NPC_Skelly_01": "Skelly",
        "NPC_Aphrodite_01": "Aphrodite",
        "NPC_Zeus_01": "Zeus",
        "NPC_Chaos_01": "Chaos",
    }

    def test_base_forms_have_bare_names(self):
        for internal_id, expected in self.base_form_expectations.items():
            assert HADES1_SPEAKER_NAMES[internal_id] == expected, (
                f"{internal_id} should be bare {expected!r}, got "
                f"{HADES1_SPEAKER_NAMES[internal_id]!r}"
            )


class TestMysteryCharactersPreserveMarker:
    """Mystery characters keep the ``? ? ?`` marker so the obscured
    in-game presentation is recognisable, while the qualifier in
    parentheses reveals the underlying identity to the dev view."""

    def test_unnamed_ids_keep_question_marker(self):
        for sid in ("NPC_Patroclus_Unnamed_01", "NPC_Persephone_Unnamed_01"):
            assert HADES1_SPEAKER_NAMES[sid].startswith("? ? ?"), (
                f"{sid} display name {HADES1_SPEAKER_NAMES[sid]!r} should "
                f"start with the '? ? ?' marker"
            )
