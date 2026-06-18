"""Regression tests for ``HADES2_SPEAKERS``.

Mirrors the H1 ``test_speakers.py`` shape - the H2 viewer surfaces the
same fields (display name + character description) in the same UI
contexts, so the same invariants apply:

  * Every entry has a non-empty ``name`` and a present (possibly
    ``None``) ``description`` field.
  * Display-name collisions are intentional and explicitly
    allowlisted - distinct internal IDs should either resolve to
    distinct presentation names or be on
    :data:`ALLOWED_NAME_COLLISIONS` with a justification.
  * Speakers without a quip are explicitly allowlisted in
    :data:`INTENTIONALLY_EMPTY_DESCRIPTIONS` so the next maintainer
    sees the deliberate choice rather than an apparent omission.
  * Base ``NPC_<Char>_01`` forms keep the bare character name so the
    viewer search dropdown reads naturally.
  * Mystery (``_Unnamed_``) variants keep the ``? ? ?`` marker.
  * Spot-checks for a handful of canonical descriptions catch typos.
"""

from collections import defaultdict

from src.extractors.hades2.speakers import HADES2_SPEAKERS


def _names():
    return {sid: entry["name"] for sid, entry in HADES2_SPEAKERS.items()}


def _descriptions():
    return {sid: entry.get("description") for sid, entry in HADES2_SPEAKERS.items()}


# Display names that are intentionally shared by multiple internal IDs.
# Each entry is `display_name -> {internal_id, ...}` and must match the
# actual collision set in HADES2_SPEAKERS exactly.
ALLOWED_NAME_COLLISIONS = {
    # Melinoë's three speaker tags - primary, flashback scenes, and
    # the story-event variant - all surface as the same character in
    # the UI. (``PlayerUnit_Intro`` was dropped because it only
    # appears in a ``SetupEvents.OverwriteSelf`` runtime speaker-tag
    # switch and never as a cue speaker.)
    "Melinoë": {
        "PlayerUnit", "PlayerUnit_Flashback", "NPC_Melinoe_Story_01",
    },
    # Echo's first- and second-act variants are the same character at
    # different points in her arc - the "Dispirited" / "Spirited"
    # split lives in the description quip, not in the display name.
    "Echo": {"NPC_Echo_01", "NPC_Echo_02"},
    # Hypnos has four numbered variants spoken in different rooms /
    # states; player perceives them all as the same character.
    "Hypnos": {
        "NPC_Hypnos_01", "NPC_Hypnos_02",
        "NPC_Hypnos_03", "NPC_Hypnos_04",
    },
    # Both dream-run variants of Hypnos surface with the same
    # "(Dreaming)" label - the ``_Alt`` form differs only in the
    # underlying cue selection logic the engine uses.
    "Hypnos (Dreaming)": {
        "NPC_Hypnos_DreamRun", "NPC_Hypnos_DreamRun_Alt",
    },
    # Chronos's base form and his story-event variant both ship the
    # Titan-of-Time framing; the player notices no shift in context.
    "Chronos": {"NPC_Chronos_01", "NPC_Chronos_Story_01"},
    # ``NPC_Chronos_02`` is the late-game post-redemption form;
    # ``Speaker_Chronos_02`` is the matching subtitle/voice tag on
    # the actual cue blocks (NPCData_Chronos.lua, 103 cues). Same
    # character, same framing.
    "Chronos (Reformed)": {"NPC_Chronos_02", "Speaker_Chronos_02"},
    # Hecate's base hub form and her story-event variant both fire
    # in continuous Crossroads context; no qualifier needed.
    "Hecate": {"NPC_Hecate_01", "NPC_Hecate_Story_01"},
    # Nyx behaves the same way; the ``_Story_01`` variant fires
    # during the same House-of-Hades framing as her base ``_01``.
    "Nyx": {"NPC_Nyx_01", "NPC_Nyx_Story_01"},
    # Narcissus's chamber-encounter ``_Field_01``, his original ``_01``,
    # and the ``Story_Narcissus_01`` story-event cue tag all speak as the
    # same flower-blossom in-fiction.
    "Narcissus": {"NPC_Narcissus_01", "NPC_Narcissus_Field_01", "Story_Narcissus_01"},
    # Arachne's base ``_01`` and her ``Story_Arachne_01`` story-event cue
    # tag are the same Silk Weaver (the ``_Home_01`` Crossroads variant
    # takes a qualifier and does not collide).
    "Arachne": {"NPC_Arachne_01", "Story_Arachne_01"},
    # Zagreus appears in two contexts: the present-day cameo
    # (``_01``) and the flashback ``_Past_01`` tag. Same character.
    "Zagreus": {"NPC_Zagreus_01", "NPC_Zagreus_Past_01"},
    # Hades speaks under four ids that all surface as "Hades" - the
    # contextual distinction lives in the description quip:
    # ``_Field_01`` (present-day Tartarus) and ``LordHades_01``
    # (formal voice) both carry "God of the Dead"; ``_01``
    # (captive HelpText id) and ``_Story_01`` (chained-Hades True
    # Ending sequence) both carry "Prisoner of Time". The
    # ``_02`` House-of-Hades variant is the only one that takes
    # a parenthetical qualifier.
    "Hades": {
        "NPC_Hades_Field_01", "NPC_Hades_01",
        "NPC_Hades_Story_01", "NPC_LordHades_01",
    },
    # Cerberus speaks via Field and Story variants registered in
    # NarrativeData.lua; both surface as the same Watchdog.
    "Cerberus": {"NPC_Cerberus_Field_01", "NPC_Cerberus_Story_01"},
    # Both Hermes ids surface as "Hermes" via separate display
    # names - ``HermesUpgrade`` as the canonical bare form,
    # ``NPC_Hermes_01`` as ``Hermes (Field)``. No collision under
    # this map; left here as a reminder that the two are intentionally
    # split. (Removed from the collision set; kept as documentation.)
    # Boon-offer ``<God>Upgrade`` owners share the bare god name with
    # their ``NPC_<God>_01`` form so the speaker overview groups the
    # boon dialogue under the god (mirrors H1). ``TrialUpgrade`` /
    # ``SpellDrop`` are the two non-"<God>Upgrade" boon owners, grouped
    # with their granting deity (Chaos / Selene).
    "Aphrodite": {"NPC_Aphrodite_01", "AphroditeUpgrade"},
    "Apollo": {"NPC_Apollo_01", "ApolloUpgrade"},
    "Ares": {"NPC_Ares_01", "AresUpgrade"},
    "Demeter": {"NPC_Demeter_01", "DemeterUpgrade"},
    "Hephaestus": {"NPC_Hephaestus_01", "HephaestusUpgrade"},
    "Hera": {"NPC_Hera_01", "HeraUpgrade"},
    "Hestia": {"NPC_Hestia_01", "HestiaUpgrade"},
    "Poseidon": {"NPC_Poseidon_01", "PoseidonUpgrade"},
    "Zeus": {"NPC_Zeus_01", "ZeusUpgrade"},
    "Chaos": {"NPC_Chaos_01", "TrialUpgrade"},
    "Selene": {"NPC_Selene_01", "SpellDrop"},
}


# Speakers we intentionally leave without a description. Each entry is
# annotated with the reason so the next maintainer doesn't try to
# "fix" it without understanding the intent.
INTENTIONALLY_EMPTY_DESCRIPTIONS = {
    # Inanimate / cameo entities. ``Strange Rock`` (Bouldy) has no
    # source quip; inventing one would be canon-fan-fiction.
    "NPC_Bouldy_01": "Returning cameo with no source quip.",
    # Bare mystery tag for first-meeting cues whose speaker has not
    # yet been disambiguated. Showing a quip would defeat the masking.
    "NPC_Unnamed_01": "Mystery tag; quip would defeat the masking.",
    # Off-screen / uncertain-attribution Nyx voice (``Nyx?`` display).
    "NPC_NyxVoice_01": "Off-screen voice tag; ambiguous identity by design.",
    # Non-character narrative tags - no character description applies.
    "Speaker_Anonymous": "Unattributed environment / system lines.",
    "Speaker_Homer": "Narrator framing tag; no character quip.",
}


def _collisions_in(table):
    by_name = defaultdict(set)
    for sid, name in table.items():
        by_name[name].add(sid)
    return {name: ids for name, ids in by_name.items() if len(ids) > 1}


class TestShape:
    def test_every_entry_has_a_name(self):
        missing = [sid for sid, entry in HADES2_SPEAKERS.items() if not entry.get("name")]
        assert not missing, (
            f"Every speaker must have a non-empty ``name``: {missing}"
        )

    def test_every_entry_has_a_description_key(self):
        """The ``description`` key must be present on every entry,
        even when its value is ``None``. This guarantees the audit
        below (intentionally-empty allowlist) catches new additions
        that forget to make a deliberate choice."""
        missing = [sid for sid, entry in HADES2_SPEAKERS.items()
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
            for sid, entry in HADES2_SPEAKERS.items()
            if set(entry) - allowed
        }
        assert not offenders, (
            f"Unknown subfields on speaker entries: {offenders}"
        )

    def test_no_duplicate_keys(self):
        # Sanity: the Python dict literal can silently overwrite duplicate
        # keys. Bump this floor when adding entries.
        assert len(HADES2_SPEAKERS) >= 80


class TestNameCollisionsMatchAllowlist:
    def test_every_collision_is_explicitly_allowed(self):
        actual = _collisions_in(_names())
        unexpected_names = set(actual) - set(ALLOWED_NAME_COLLISIONS)
        assert not unexpected_names, (
            "Display name collisions not on the allowlist - either pick "
            "a contextual qualifier or add to ALLOWED_NAME_COLLISIONS with "
            f"a justification: "
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


class TestBaseFormsStayBare:
    """The labelling convention reserves the bare character name for
    whichever id actually carries dialogue (typically ``NPC_<Char>_01``,
    except for Hades where ``NPC_Hades_Field_01`` is the dialogue
    carrier) so the search dropdown reads naturally when the user
    types e.g. 'Hecate'."""

    base_form_expectations = {
        "NPC_Hecate_01": "Hecate",
        # Hermes's bare name belongs to ``HermesUpgrade`` (the boon-offer
        # canonical form); ``NPC_Hermes_01`` is the running-courier
        # ``Hermes (Field)`` variant. Pinned in ``TestKnownDescriptions``
        # rather than here since the id is not an ``NPC_X_01`` form.
        "NPC_Nemesis_01": "Nemesis",
        "NPC_Chronos_01": "Chronos",
        "NPC_Odysseus_01": "Odysseus",
        "NPC_Persephone_01": "Persephone",
        "NPC_Apollo_01": "Apollo",
        "NPC_Zeus_01": "Zeus",
        "NPC_Hera_01": "Hera",
        "NPC_Aphrodite_01": "Aphrodite",
        "NPC_Demeter_01": "Demeter",
        "NPC_Poseidon_01": "Poseidon",
        "NPC_Dionysus_01": "Dionysus",
        "NPC_Hestia_01": "Hestia",
        "NPC_Hephaestus_01": "Hephaestus",
        "NPC_Selene_01": "Selene",
        "NPC_Eris_01": "Eris",
        "NPC_Heracles_01": "Heracles",
        "NPC_Icarus_01": "Icarus",
        "NPC_Arachne_01": "Arachne",
        "NPC_Artemis_01": "Artemis",
        "NPC_Circe_01": "Circe",
        "NPC_Medea_01": "Medea",
        "NPC_Moros_01": "Moros",
        "NPC_Narcissus_01": "Narcissus",
        "NPC_Scylla_01": "Scylla",
        "NPC_Echo_01": "Echo",
        "NPC_Dora_01": "Dora",
        "NPC_Dusa_01": "Dusa",
        "NPC_Zagreus_01": "Zagreus",
        # Hades's dialogue lives on ``_Field_01``, not the bare
        # ``_01`` form (which carries the captive Prisoner-of-Time
        # framing). The Field id is therefore the "base" form for
        # labelling purposes.
        "NPC_Hades_Field_01": "Hades",
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
        for sid in (
            "NPC_Unnamed_01",
            "NPC_Cyclops_Unnamed_01",
            "NPC_Scylla_Unnamed_01",
        ):
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
                f"from HADES2_SPEAKERS."
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
        # Hades's main present-day dialogue carrier is ``_Field_01``;
        # the ``_02`` House framing variant is the only one that takes
        # a parenthetical qualifier ("Hades (House)"); the captive
        # ``_01`` and chained-Hades ``_Story_01`` carry the
        # "Prisoner of Time" description; the formal ``LordHades_01``
        # carries "God of the Dead" same as the Field id.
        "NPC_Hades_Field_01": "God of the Dead",
        "NPC_Hades_02": "God of the Dead",
        "NPC_LordHades_01": "God of the Dead",
        "NPC_Hades_01": "Prisoner of Time",
        "NPC_Hades_Story_01": "Prisoner of Time",
        "NPC_Hecate_01": "Witch of the Crossroads",
        # Hermes's canonical bare-name form is ``HermesUpgrade`` (the
        # boon-offer Hermes); ``NPC_Hermes_01`` is the running-courier
        # variant "Hermes (Field)".
        "HermesUpgrade": "God of Swiftness",
        "NPC_Hermes_01": "God of Swiftness",
        "NPC_Nemesis_01": "Retribution Incarnate",
        "NPC_Chronos_01": "Titan of Time",
        # ``NPC_Chronos_02`` is the post-redemption Father Time
        # framing - distinct quip from the Titan tag. The matching
        # subtitle/voice tag ``Speaker_Chronos_02`` shares the
        # description.
        "NPC_Chronos_02": "Father Time",
        "Speaker_Chronos_02": "Father Time",
        "NPC_Odysseus_01": "Veteran Tactician",
        "NPC_Eris_01": "Strife Incarnate",
        # Persephone in H2 is the Queen, not the Goddess of Verdure
        # (her H1 quip) - useful as a regression target if anyone tries
        # to copy-paste the H1 entry by mistake.
        "NPC_Persephone_01": "Queen of the Underworld",
        # Schelemeus is the in-fiction name of H2's Skelly; the
        # ``_TrueMythologicalOrigin_`` variant unmasks him further as
        # Schelememnon during the late-game reveal sequence.
        "NPC_Skelly_01": "Training Master",
        "NPC_Skelly_TrueMythologicalOrigin_01": "Second Judge of the Dead",
        # Cerberus appears via two NarrativeData-registered ids - the
        # Field variant for the Crossroads-hub greetings, the Story
        # variant for the late-game plot beats. Both display as the
        # same Watchdog.
        "NPC_Cerberus_Field_01": "Notorious Watchdog",
        "NPC_Cerberus_Story_01": "Notorious Watchdog",
        # Melinoë's primary tag carries the princess quip; the
        # flashback variant carries the nymph quip.
        "PlayerUnit": "Princess of the Underworld",
        "PlayerUnit_Flashback": "Chthonic Nymph",
        # Boss-fight speaker entries. The bare boss container key from
        # ``UnitSetData.<Char>.<Char>`` is the speaker id; display name
        # disambiguates with ``"(Boss)"`` when the character also has a
        # walking-NPC form, or ``"(Summit)"`` for the Typhon alt-fight
        # apparition voice (Chronos under another mask). Descriptions
        # mirror the canonical HelpText quip from the matching NPC
        # entry verbatim - same convention as the H1 ``Hades`` /
        # ``Harpy`` / ``Minotaur`` entries.
        "Hecate": "Witch of the Crossroads",
        "Eris": "Strife Incarnate",
        "Chronos": "Titan of Time",
        "Zagreus": "Prince of the Underworld",
        "TyphonHead": "Titan of Time",
    }

    def test_descriptions_match_expected(self):
        descriptions = _descriptions()
        mismatches = {
            sid: (descriptions.get(sid), expected)
            for sid, expected in self.EXPECTED.items()
            if descriptions.get(sid) != expected
        }
        assert not mismatches, (
            f"Description mismatches (got -> expected): {mismatches}"
        )
