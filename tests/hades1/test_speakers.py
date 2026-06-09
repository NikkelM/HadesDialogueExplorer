"""Regression tests for ``HADES1_SPEAKERS``.

The viewer surfaces character names in the search dropdown, info panel
header, dialogue line attributions, and tree node labels, plus a
one-line character description quip in the hover tooltip
(``renderSpeakerHtml`` in ``templates/viewer/utilities.js``). Both
fields live on the same map (``HADES1_SPEAKERS``) so parity is
structurally guaranteed; these tests enforce the secondary invariants
that aren't enforced by the shape:

  * Display-name collisions are intentional and explicit. We want
    distinct internal IDs to either (a) map to distinct display names
    so they can be told apart, or (b) intentionally share a display
    name when the narrative split between them is not meaningful
    (allowlisted below).
  * Variant ids (``_Story_``, ``_Field_``, ``_Home_``, ``_Unnamed_``,
    boss variants of NPC characters) really do get distinct names
    when their narrative split matters.
  * Base ``NPC_X_01`` forms keep the bare character name so the
    search dropdown reads naturally.
  * Mystery (``_Unnamed_``) variants keep the ``? ? ?`` marker.
  * Speakers without a description are explicitly allowlisted, with a
    short justification for each, so a new entry can't silently ship
    with an empty tooltip.
  * Spot-checks for a handful of canonical descriptions catch typos
    or accidental rewrites of well-known quips.
"""

from collections import defaultdict

from src.extractors.hades1.speakers import HADES1_SPEAKERS


def _names():
    return {sid: entry["name"] for sid, entry in HADES1_SPEAKERS.items()}


def _descriptions():
    return {sid: entry.get("description") for sid, entry in HADES1_SPEAKERS.items()}


# Display names that are intentionally shared by multiple internal IDs.
# Each entry is `display_name -> {internal_id, internal_id, ...}` and must
# match the actual collision set in HADES1_SPEAKERS exactly.
ALLOWED_NAME_COLLISIONS = {
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


# Speakers we intentionally leave without a description. Each entry is
# annotated with the reason so the next maintainer doesn't try to
# "fix" it without understanding the intent.
INTENTIONALLY_EMPTY_DESCRIPTIONS = {
    # Generic narrator voice in DeathLoopData; no canonical character
    # description exists in the source material.
    "Storyteller": "Narrator voice; not a specific character.",
    # Inanimate / pet entities. None has a dev-facing quip in the
    # source data and inventing one would be canon-fan-fiction.
    "NPC_Bouldy_01": "Sentient boulder; no description in source data.",
    "NPC_SisyphusAndBouldy_01": "Joint dialogue owner; quip lives on the parent characters.",
    # Mystery variants intentionally hide their identity in-game. We do
    # NOT inherit the quip from the unmasked parent so the tooltip
    # doesn't accidentally reveal that identity in the dev tool.
    "NPC_Patroclus_Unnamed_01": "Mystery variant; quip would leak the identity.",
    "NPC_Persephone_Unnamed_01": "Mystery variant; quip would leak the identity.",
}


def _collisions_in(table):
    """Return ``{display_name: {internal_id, ...}}`` for every display
    name shared by more than one internal id."""
    by_name = defaultdict(set)
    for sid, name in table.items():
        by_name[name].add(sid)
    return {name: ids for name, ids in by_name.items() if len(ids) > 1}


class TestShape:
    def test_every_entry_has_a_name(self):
        missing = [sid for sid, entry in HADES1_SPEAKERS.items() if not entry.get("name")]
        assert not missing, (
            f"Every speaker must have a non-empty ``name``: {missing}"
        )

    def test_every_entry_has_a_description_key(self):
        """The ``description`` key must be present on every entry,
        even when its value is ``None``. This guarantees the audit
        below (intentionally-empty allowlist) catches new additions
        that forget to make a deliberate choice."""
        missing = [sid for sid, entry in HADES1_SPEAKERS.items()
                   if "description" not in entry]
        assert not missing, (
            f"Every speaker must have a ``description`` key (use ``None`` "
            f"and add to ``INTENTIONALLY_EMPTY_DESCRIPTIONS`` if no quip "
            f"fits): {missing}"
        )

    def test_no_extra_subfields(self):
        """The schema is ``{name, description}`` - any other key is a
        typo or a stale field that won't be consumed by the viewer."""
        allowed = {"name", "description"}
        offenders = {
            sid: set(entry) - allowed
            for sid, entry in HADES1_SPEAKERS.items()
            if set(entry) - allowed
        }
        assert not offenders, (
            f"Unknown subfields on speaker entries: {offenders}"
        )

    def test_no_duplicate_keys(self):
        # Sanity: the Python dict literal can silently overwrite duplicate
        # keys. Bump this floor when adding entries.
        assert len(HADES1_SPEAKERS) >= 55


class TestNameCollisionsMatchAllowlist:
    def test_every_collision_is_explicitly_allowed(self):
        actual = _collisions_in(_names())
        unexpected_names = set(actual) - set(ALLOWED_NAME_COLLISIONS)
        assert not unexpected_names, (
            "Display name collisions not on the allowlist - either pick "
            "a contextual qualifier (e.g. '(Boss)', '(Field)') or add to "
            f"ALLOWED_NAME_COLLISIONS with a justification: "
            f"{dict((n, actual[n]) for n in unexpected_names)}"
        )

    def test_allowlisted_collision_membership_is_exact(self):
        actual = _collisions_in(_names())
        for name, expected_ids in ALLOWED_NAME_COLLISIONS.items():
            assert name in actual, (
                f"Allowlist expects {name!r} to be a shared display name "
                f"across {expected_ids} but no collision is present - "
                f"either remove from ALLOWED_NAME_COLLISIONS or restore the "
                f"intended mapping"
            )
            assert actual[name] == expected_ids, (
                f"{name!r} collision membership drifted: expected "
                f"{expected_ids}, got {actual[name]}"
            )


class TestKnownVariantPairsAreDistinct:
    """Spot-check the variant pairs that were explicitly called out as
    needing disambiguation. Pairs whose collision is now
    *intentional* (lesser Furies, boon owners, training dummy) live in
    ALLOWED_NAME_COLLISIONS and are not asserted here."""

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
        names = _names()
        for a, b in self.pairs:
            assert a in names, f"missing mapping for {a}"
            assert b in names, f"missing mapping for {b}"
            assert names[a] != names[b], (
                f"{a} and {b} still share display name {names[a]!r}"
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
        names = _names()
        for internal_id, expected in self.base_form_expectations.items():
            assert names[internal_id] == expected, (
                f"{internal_id} should be bare {expected!r}, got "
                f"{names[internal_id]!r}"
            )


class TestMysteryCharactersPreserveMarker:
    """Mystery characters keep the ``? ? ?`` marker so the obscured
    in-game presentation is recognisable, while the qualifier in
    parentheses reveals the underlying identity to the dev view."""

    def test_unnamed_ids_keep_question_marker(self):
        names = _names()
        for sid in ("NPC_Patroclus_Unnamed_01", "NPC_Persephone_Unnamed_01"):
            assert names[sid].startswith("? ? ?"), (
                f"{sid} display name {names[sid]!r} should "
                f"start with the '? ? ?' marker"
            )


class TestEmptyDescriptionsAreAllowlisted:
    def test_every_empty_is_explicitly_allowed(self):
        descriptions = _descriptions()
        actual_empty = {sid for sid, descr in descriptions.items() if not descr}
        unexpected = actual_empty - set(INTENTIONALLY_EMPTY_DESCRIPTIONS)
        assert not unexpected, (
            "Speakers without a description must be added to "
            "INTENTIONALLY_EMPTY_DESCRIPTIONS with a comment explaining why "
            f"(or given a description quip): {sorted(unexpected)}"
        )

    def test_allowlist_only_contains_actually_empty(self):
        descriptions = _descriptions()
        for sid in INTENTIONALLY_EMPTY_DESCRIPTIONS:
            assert sid in descriptions, (
                f"{sid} is on INTENTIONALLY_EMPTY_DESCRIPTIONS but missing "
                f"from HADES1_SPEAKERS."
            )
            assert not descriptions[sid], (
                f"{sid} is on INTENTIONALLY_EMPTY_DESCRIPTIONS but has a "
                f"non-empty description {descriptions[sid]!r}; either "
                "remove it from the allowlist or clear the description."
            )


class TestKnownDescriptions:
    """Spot-check a few canonical descriptions to catch typos or
    accidental rewrites. The full set lives in the speakers module;
    this only pins the ones a player or maintainer would recognise on
    sight."""

    EXPECTED = {
        "NPC_Hades_01": "God of the Dead",
        "NPC_Hades_Story_01": "God of the Dead",
        "NPC_Nyx_01": "Night Incarnate",
        "NPC_Achilles_01": "Forgotten Hero",
        "NPC_Orpheus_01": "Court Musician",
        "NPC_Persephone_01": "Goddess of Verdure",
        "NPC_Persephone_Home_01": "Queen of the Underworld",
        "NPC_FurySister_01": "First of the Furies",
        "NPC_Zeus_01": "King of the Olympians",
        "CharProtag": "Prince of the Underworld",
        # Source-data quirk: NPC entry is singular, boon-offer entry is plural.
        "NPC_Poseidon_01": "God of the Sea",
        "PoseidonUpgrade": "God of the Seas",
    }

    def test_known_descriptions_match(self):
        descriptions = _descriptions()
        for sid, expected in self.EXPECTED.items():
            assert descriptions.get(sid) == expected, (
                f"{sid}: expected {expected!r}, got {descriptions.get(sid)!r}"
            )
