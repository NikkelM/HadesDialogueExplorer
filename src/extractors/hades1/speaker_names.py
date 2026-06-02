"""
Hardcoded speaker / NPC display name mappings.

These map internal IDs (used in NPCData.lua dialogue entries) to friendly
display names shown in the viewer. Internal IDs remain canonical everywhere
in the data; friendly names are presentation only.

The set of speakers per game is small and stable, so hardcoding is simpler
than parsing the game's HelpText.en.sjson localization file. Sources include
the player character (which has no HelpText entry), regular NPCs, and
encounter/boss/boon variants that reuse the same underlying character.

Display-name convention (see issue #30):
  * Base form (``NPC_X_01``) keeps the bare character name.
  * Variants that represent a distinct narrative context get a
    parenthesized qualifier so they can be told apart in the search
    dropdown, info panel, dialogue attributions, and tree node labels:
      - ``_Story_``    -> "X (Field)" / "X (Ending)"
                          (post-Hub Story content - per-character labeling:
                          Achilles/Nyx/Orpheus appear in chamber Field rooms,
                          Hades exclusively in the Ending sequence)
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
    ``tests/hades1/test_speaker_names.py``):
      - boon-offer owners (LootData ``*Upgrade``) share the god's name
        with the NPC_*_01 speaker - the offer line IS that god speaking
      - lesser Fury bosses (Harpy2/Harpy3) share with their NPC form
        (only Megaera has a substantial House/Boss split)
      - training dummy ``TrainingMelee`` shares with ``NPC_Skelly_01``
  * Hover tooltip / canonical id remains available via the viewer's
    ``renderSpeakerHtml`` (issue #5), so collisions are disambiguated on
    hover via the underlying internal ID.
"""

HADES1_SPEAKER_NAMES = {
    "CharProtag": "Zagreus",

    # House of Hades regulars + their Field / Story / House / Unnamed variants.
    "NPC_Achilles_01": "Achilles",
    "NPC_Achilles_Story_01": "Achilles (Field)",
    "NPC_Bouldy_01": "Bouldy",
    "NPC_Cerberus_01": "Cerberus",
    "NPC_Cerberus_Field_01": "Cerberus (Field)",
    "NPC_Charon_01": "Charon",
    "NPC_Chaos_01": "Chaos",
    "NPC_Dusa_01": "Dusa",
    "NPC_Eurydice_01": "Eurydice",
    "NPC_FurySister_01": "Megaera",
    "NPC_FurySister_02": "Alecto",
    "NPC_FurySister_03": "Tisiphone",
    "NPC_Hades_01": "Hades",
    "NPC_Hades_Story_01": "Hades (Ending)",
    "NPC_Hypnos_01": "Hypnos",
    "NPC_Nyx_01": "Nyx",
    "NPC_Nyx_Story_01": "Nyx (Field)",
    "NPC_Orpheus_01": "Orpheus",
    "NPC_Orpheus_Story_01": "Orpheus (Field)",
    "NPC_Patroclus_01": "Patroclus",
    "NPC_Patroclus_Unnamed_01": "? ? ? (Patroclus)",
    "NPC_Persephone_01": "Persephone",
    "NPC_Persephone_Home_01": "Persephone (House)",
    "NPC_Persephone_Unnamed_01": "? ? ? (Persephone)",
    "NPC_Sisyphus_01": "Sisyphus",
    "NPC_SisyphusAndBouldy_01": "Sisyphus & Bouldy",
    "NPC_Skelly_01": "Skelly",
    "NPC_Thanatos_01": "Thanatos",
    "NPC_Thanatos_Field_01": "Thanatos (Field)",

    # Olympian NPC speakers. These share their display name with the
    # corresponding *Upgrade boon-offer owner below by design.
    "NPC_Aphrodite_01": "Aphrodite",
    "NPC_Ares_01": "Ares",
    "NPC_Artemis_01": "Artemis",
    "NPC_Athena_01": "Athena",
    "NPC_Demeter_01": "Demeter",
    "NPC_Dionysus_01": "Dionysus",
    "NPC_Hermes_01": "Hermes",
    "NPC_Poseidon_01": "Poseidon",
    "NPC_Zeus_01": "Zeus",

    # God-boon-offer owners from LootData.lua. Intentionally share the
    # plain god name with the NPC_*_01 speakers above - the boon offer
    # line IS that god speaking, so a "(Boon)" qualifier would be visual
    # noise rather than useful disambiguation.
    "AphroditeUpgrade": "Aphrodite",
    "AresUpgrade": "Ares",
    "ArtemisUpgrade": "Artemis",
    "AthenaUpgrade": "Athena",
    "DemeterUpgrade": "Demeter",
    "DionysusUpgrade": "Dionysus",
    "HermesUpgrade": "Hermes",
    "HermesUpgradeRare": "Hermes",
    "PoseidonUpgrade": "Poseidon",
    "ZeusUpgrade": "Zeus",
    "ChaosUpgrade": "Chaos",
    "TrialUpgrade": "Chaos",

    # Enemy / boss owners from EnemyData.lua. Only Megaera / Charon /
    # Hades get a "(Boss)" qualifier - they each have substantial NPC
    # dialogue distinct from their boss encounter. Lesser Furies
    # (Alecto/Tisiphone) and the training dummy (Skelly) intentionally
    # share their NPC display name.
    "Charon": "Charon (Boss)",
    "Hades": "Hades (Boss)",
    "Harpy": "Megaera (Boss)",
    "Harpy2": "Alecto",
    "Harpy3": "Tisiphone",
    "Minotaur": "Asterius",
    "Theseus": "Theseus",
    "TrainingMelee": "Skelly",

    # DeathLoopData ambient narration.
    "Storyteller": "Narrator",
}
