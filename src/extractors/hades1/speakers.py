"""
Hardcoded Hades 1 speaker / NPC metadata.

Single source of truth for everything the viewer needs to know about a
speaker beyond what's in the dialogue data itself: the friendly display
name and (optionally) the one-line character description quip that
surfaces in the hover tooltip.

The two fields are kept in one map because they're strictly 1:1 with
the internal id; splitting them into parallel dicts would invite
silent drift (an entry added in one but not the other) without buying
anything. Audit logic that used to enforce parity is therefore made
structurally impossible to violate.

Internal IDs remain canonical everywhere in the data; friendly names
and descriptions are presentation only.

Source notes:
  * Display names mirror the convention from the previous
    ``speaker_names.py`` file: base form (``NPC_X_01``) keeps the bare
    character name; narrative-context variants get a parenthesized
    qualifier (``(Field)``, ``(House)``, ``(Boss)``, ``(Ending)``);
    mystery (``_Unnamed_``) variants render as ``? ? ? (X)``.
  * Description quips come from the game's
    ``Game/Text/en/HelpText.en.sjson``. Variant ids that use
    ``InheritFrom`` in the source data have the resolved quip
    duplicated here rather than recomputed on every load.
  * ``CharProtag`` ("Zagreus") has no HelpText entry; the canonical
    quip is hardcoded.
  * Mystery (``_Unnamed_``) variants intentionally get
    ``description = None`` so the hover tooltip in the dev tool
    doesn't leak the masked character's quip and undo the in-game
    reveal.
  * A handful of speakers genuinely have no description in the source
    data (Storyteller / Bouldy / etc.) and stay at ``None``.

Display-name disambiguation convention:
  * Base form (``NPC_X_01``) keeps the bare character name.
  * Variants that represent a distinct narrative context get a
    parenthesized qualifier so they can be told apart in the search
    dropdown, info panel, dialogue attributions, and tree node labels:
      - ``_Story_``    -> "X (Field)" / "X (Ending)"
                          (post-Hub Story content - per-character labeling:
                          Nyx/Orpheus appear in chamber Field rooms,
                          Hades exclusively in the Ending sequence;
                          Achilles' ``_Story_`` variant instead shares the
                          bare "Achilles" name - see the shared-name list)
      - ``_Field_``    -> "X (Field)"    (in-run chamber encounter variant)
      - ``_Home_``     -> "X (House)"    (House variant of a surface NPC)
      - ``_Unnamed_``  -> "? ? ? (X)"    (mystery character - identity
                                          preserved for the dev view without
                                          revealing it to readers of the
                                          in-game text)
      - Megaera boss   -> "Megaera (Boss)" / Charon / Hades bosses get
                          "(Boss)" suffix where the NPC and boss share
                          substantial dialogue but represent distinct
                          encounters
  * Variants whose split is *not* narratively meaningful intentionally
    share a single display name (allowlisted in
    ``tests/hades1/test_speakers.py``):
      - boon-offer owners (LootData ``*Upgrade``) share the god's name
        with the NPC_*_01 speaker - the offer line IS that god speaking
      - lesser Fury bosses (Harpy2/Harpy3) share with their NPC form
        (only Megaera has a substantial House/Boss split)
      - training dummy ``TrainingMelee`` shares with ``NPC_Skelly_01``
      - ``NPC_Achilles_Story_01`` shares the bare "Achilles" name - it
        owns no dialogue and only voices three guest lines in Patroclus'
        Elysium dialogues, so a "(Field)" split would surface an almost
        empty speaker rather than useful disambiguation
  * Hover tooltip / canonical id remains available via the viewer's
    ``renderSpeakerHtml``, so collisions are disambiguated on
    hover via the underlying internal ID.
"""

HADES1_SPEAKERS = {
    # The protagonist. No HelpText entry; the quip is the one used
    # throughout the game's marketing and narrative voice-over.
    "CharProtag": {"name": "Zagreus", "description": "Prince of the Underworld"},
    # PlayerUnit / PlayerUnit_Intro: alternate Zagreus speaker tags
    # used in cutscene cues (``Ending01``, ``Flashback05``) and the
    # intro voiceover (``AthenaFirstPickUp``). Same character, kept
    # as separate ids so the source-level speaker attribution stays
    # accurate when surfaced in the viewer.
    "PlayerUnit":       {"name": "Zagreus", "description": "Prince of the Underworld"},
    "PlayerUnit_Intro": {"name": "Zagreus", "description": "Prince of the Underworld"},

    # House of Hades regulars + their Field / Story / House / Unnamed
    # variants. Variant ids resolve to the same parent description in
    # the source data except where InheritFrom flips the parent
    # (Persephone_Home_01 -> "Queen of the Underworld").
    "NPC_Achilles_01":          {"name": "Achilles",            "description": "Forgotten Hero"},
    # Owns no dialogue; only voices three guest lines in Patroclus'
    # Elysium dialogues (``PatroclusWithAchilles01``-``03``). Shares the
    # bare "Achilles" name so it collapses into the main Achilles speaker
    # via the display-name grouping in ``speaker-groups.js`` rather than
    # surfacing an almost-empty "Achilles (Field)" speaker. Allowlisted
    # in ``tests/hades1/test_speakers.py`` ALLOWED_NAME_COLLISIONS.
    "NPC_Achilles_Story_01":    {"name": "Achilles",            "description": "Forgotten Hero"},
    "NPC_Bouldy_01":            {"name": "Bouldy",              "description": None},
    "NPC_Cerberus_01":          {"name": "Cerberus",            "description": "Notorious Watchdog"},
    "NPC_Cerberus_Field_01":    {"name": "Cerberus (Field)",    "description": "Notorious Watchdog"},
    "NPC_Charon_01":            {"name": "Charon",              "description": "Stygian Boatman"},
    "NPC_Chaos_01":             {"name": "Chaos",               "description": "Primordial Originator"},
    "NPC_Dusa_01":              {"name": "Dusa",                "description": "Duty-Bound Gorgon"},
    "NPC_Eurydice_01":          {"name": "Eurydice",            "description": "Carefree Muse"},
    "NPC_FurySister_01":        {"name": "Megaera",             "description": "First of the Furies"},
    "NPC_FurySister_02":        {"name": "Alecto",              "description": "Tormentor of Passions"},
    "NPC_FurySister_03":        {"name": "Tisiphone",           "description": "Tormentor of Murder"},
    # Mystery variants used for the lesser Furies' first appearance
    # cues (``Fury2FirstAppearance`` / ``Fury3FirstAppearance``).
    # Same ``? ? ? (X)`` masking pattern as the other ``_Unnamed_``
    # speakers - identity hidden until the player has actually met
    # the character in-game.
    "NPC_FurySister_Unnamed_02":{"name": "? ? ? (Alecto)",      "description": None},
    "NPC_FurySister_Unnamed_03":{"name": "? ? ? (Tisiphone)",   "description": None},
    "NPC_Hades_01":             {"name": "Hades",               "description": "God of the Dead"},
    "NPC_Hypnos_01":            {"name": "Hypnos",              "description": "Sleep Incarnate"},
    "NPC_Nyx_01":               {"name": "Nyx",                 "description": "Night Incarnate"},
    "NPC_Nyx_Story_01":         {"name": "Nyx (Field)",         "description": "Night Incarnate"},
    "NPC_Orpheus_01":           {"name": "Orpheus",             "description": "Court Musician"},
    "NPC_Orpheus_Story_01":     {"name": "Orpheus (with Eurydice)",     "description": "Court Musician"},
    "NPC_Patroclus_01":         {"name": "Patroclus",           "description": "Fallen Warrior"},
    # Mystery variants intentionally have no quip in the dev view -
    # surfacing the parent's quip in the tooltip would reveal the
    # masked identity that the in-game presentation hides.
    "NPC_Patroclus_Unnamed_01": {"name": "? ? ? (Patroclus)",   "description": None},
    "NPC_Persephone_01":        {"name": "Persephone",          "description": "Goddess of Verdure"},
    # Inherits from a sibling that overrides the quip in HelpText.
    "NPC_Persephone_Home_01":   {"name": "Persephone (House)",  "description": "Queen of the Underworld"},
    "NPC_Persephone_Unnamed_01":{"name": "? ? ? (Persephone)",  "description": None},
    "NPC_Sisyphus_01":          {"name": "Sisyphus",            "description": "Tortured Soul"},
    "NPC_SisyphusAndBouldy_01": {"name": "Sisyphus & Bouldy",   "description": None},
    "NPC_Skelly_01":            {"name": "Skelly",              "description": "Training Dummy"},
    # Backstory speaker tag used for Skelly's flashback cues
    # (``SkellyBackstory03/05``) where he recalls his living days as
    # a Cretan captain named Schelemeus. Same character as
    # ``NPC_Skelly_01`` but kept on a distinct id with a different
    # quip so the flashback flavour stays visible in the viewer.
    "SkellyBackstory":          {"name": "Skelly",              "description": "Schelemeus, Former Captain"},
    "NPC_Thanatos_01":          {"name": "Thanatos",            "description": "Death Incarnate"},
    "NPC_Thanatos_Field_01":    {"name": "Thanatos (Field)",    "description": "Death Incarnate"},

    # Olympian NPC speakers. These share their display name with the
    # corresponding *Upgrade boon-offer owner below by design.
    "NPC_Aphrodite_01":         {"name": "Aphrodite",           "description": "Goddess of Love"},
    "NPC_Ares_01":              {"name": "Ares",                "description": "God of War"},
    "NPC_Artemis_01":           {"name": "Artemis",             "description": "Goddess of the Hunt"},
    "NPC_Athena_01":            {"name": "Athena",              "description": "Goddess of Wisdom"},
    "NPC_Demeter_01":           {"name": "Demeter",             "description": "Goddess of Seasons"},
    "NPC_Dionysus_01":          {"name": "Dionysus",            "description": "God of Wine"},
    "NPC_Hermes_01":            {"name": "Hermes",              "description": "God of Swiftness"},
    # NPC entry reads "God of the Sea"; the boon-offer entry reads
    # "God of the Seas" (plural). We follow the entry canonical to
    # each id rather than normalising.
    "NPC_Poseidon_01":          {"name": "Poseidon",            "description": "God of the Sea"},
    "NPC_Zeus_01":              {"name": "Zeus",                "description": "King of the Olympians"},

    # God-boon-offer owners from LootData.lua. Intentionally share the
    # plain god name with the NPC_*_01 speakers above - the boon offer
    # line IS that god speaking, so a "(Boon)" qualifier would be visual
    # noise rather than useful disambiguation.
    "AphroditeUpgrade":         {"name": "Aphrodite",           "description": "Goddess of Love"},
    "AresUpgrade":              {"name": "Ares",                "description": "God of War"},
    "ArtemisUpgrade":           {"name": "Artemis",             "description": "Goddess of the Hunt"},
    "AthenaUpgrade":            {"name": "Athena",              "description": "Goddess of Wisdom"},
    "DemeterUpgrade":           {"name": "Demeter",             "description": "Goddess of Seasons"},
    "DionysusUpgrade":          {"name": "Dionysus",            "description": "God of Wine"},
    "HermesUpgrade":            {"name": "Hermes",              "description": "God of Swiftness"},
    "HermesUpgradeRare":        {"name": "Hermes",              "description": "God of Swiftness"},
    "PoseidonUpgrade":          {"name": "Poseidon",            "description": "God of the Seas"},
    "ZeusUpgrade":              {"name": "Zeus",                "description": "King of the Olympians"},
    "ChaosUpgrade":             {"name": "Chaos",               "description": "Primordial Originator"},
    # TrialUpgrade in HelpText reads "Origin of Creation" - a deeper
    # narrative gloss for the trial-of-the-gods variant; preserved.
    "TrialUpgrade":             {"name": "Chaos",               "description": "Origin of Creation"},
    # MysteryUpgrade is the masked Chaos speaker for the very first
    # encounter cue (``ChaosFirstPickUp``) before the player has met
    # Chaos. Same ``? ? ? (X)`` masking pattern used for the
    # ``NPC_*_Unnamed_*`` first-meeting variants - identity hidden
    # until the in-game reveal.
    "MysteryUpgrade":           {"name": "? ? ? (Chaos)",       "description": None},

    # Enemy / boss owners from EnemyData.lua. Only Megaera / Charon /
    # Hades get a "(Boss)" qualifier - they each have substantial NPC
    # dialogue distinct from their boss encounter. Lesser Furies
    # (Alecto/Tisiphone) and the training dummy (Skelly) intentionally
    # share their NPC display name.
    "Charon":                   {"name": "Charon (Boss)",       "description": "Stygian Boatman"},
    # The Hades boss shares the NPC quip; same character at the end of a run.
    "Hades":                    {"name": "Hades (Boss)",        "description": "God of the Dead"},
    # The Megaera boss entry has no Description field in HelpText;
    # share the NPC_FurySister_01 quip so the encounter still shows
    # the same character context.
    "Harpy":                    {"name": "Megaera (Boss)",      "description": "First of the Furies"},
    "Harpy2":                   {"name": "Alecto",              "description": "Tormentor of Passions"},
    "Harpy3":                   {"name": "Tisiphone",           "description": "Tormentor of Murder"},
    "Minotaur":                 {"name": "Asterius",            "description": "Bull of Minos"},
    "Theseus":                  {"name": "Theseus",             "description": "Hero of Athens"},
    "TrainingMelee":            {"name": "Skelly",              "description": "Training Dummy"},

    # DeathLoopData ambient narration. No in-game character description.
    "Storyteller":              {"name": "Narrator",            "description": None},
}
