"""Curated friendly names for Hades II entities that have no usable
``DisplayName`` in the game text data but still appear as ``otherRequirements``
path leaves - a handful of kill-source / spawn-record / resource-drop ids.

Merged into the viewer's ``entityNames`` lookup (below the vendored sjson map,
which has priority) so that the dotted-path gates that reference them read with
a friendly name appended; the internal id stays in the path and the tooltip.

H2 gates almost never use named kill sources (its story flags carry the weight),
so this map is intentionally tiny.
"""

HADES2_EXTRA_ENTITY_NAMES = {
    # The blood-mine enemy in its pre-fused state (ArachneAboutMines01).
    "BloodMinePreFused": "Blood Mine",
    # Spawned soul-pylon objects tracked in the run's spawn record.
    "SoulPylon": "Soul Pylon",
    # Eris' rubbish drop (ErisAboutTrash03).
    "TrashPointsDrop": "Dropped Rubbish",

    # Biome codes. These single-letter ids are the biome / region keys used in
    # ``BiomesReached`` path leaves and ``CurrentRoom.RoomSetName`` comparisons.
    # They appear nowhere else as values, so resolving them globally is safe.
    "F": "Erebus",
    "G": "Oceanus",
    "H": "Fields of Mourning",
    "I": "Tartarus",
    "N": "City of Ephyra",
    "O": "Rift of Thessaly",
    "P": "Olympus",
    "Q": "The Summit",
    "Chaos": "Chaos",

    # UseRecord interactables (``GameState/CurrentRun.UseRecord.<id>`` leaves) -
    # Crossroads objects, stations and decorations Melinoe can interact with.
    "InspectPoint": "Narrative Point",
    "CrossroadsFamilyPortrait02": "Family Portrait",
    "GhostAdmin": "Cauldron",
    "QuestLog": "Fated List of Minor Prophecies",
    "CrossroadsPet01": "Hecuba",
    "GameStatsScreen": "Archived Trivia",
    "MusicPlayerScreen": "Music Player",
    "RunHistoryScreen": "Past Deeds",
    "StatueTrap_Hestia": "Olympus Hestia Statue",
    "CharonPointsDrop": "Obol Points",
    "HubGardenPlot": "Garden Plot",

    # Encounter ids (Encounters*Cache / EncounterClearStats leaves and operands).
    # Most follow ``<Character>Combat<BiomeLetter>[2]`` - a field encounter with a
    # guest character in a biome (the "2" suffix is an alternate version).
    "ArtemisCombatF": "Artemis encounter (Erebus)",
    "ArtemisCombatF2": "Artemis encounter (Erebus, variant 2)",
    "ArtemisCombatG": "Artemis encounter (Oceanus)",
    "ArtemisCombatG2": "Artemis encounter (Oceanus, variant 2)",
    "ArtemisCombatN": "Artemis encounter (City of Ephyra)",
    "ArtemisCombatN2": "Artemis encounter (City of Ephyra, variant 2)",
    "BossZagreus01": "Zagreus fight",
    "BridgeNemesisRandomEvent": "Nemesis in Echo's chamber",
    "BridgeShop": "Echo's chamber",
    "GeneratedAnomalyB": "Asphodel",
    "HeraclesCombatF": "Heracles encounter (Erebus)",
    "HeraclesCombatF2": "Heracles encounter (Erebus, variant 2)",
    "HeraclesCombatG": "Heracles encounter (Oceanus)",
    "HeraclesCombatG2": "Heracles encounter (Oceanus, variant 2)",
    "HeraclesCombatIntro": "Heracles encounter (intro)",
    "HeraclesCombatN": "Heracles encounter (City of Ephyra)",
    "HeraclesCombatN2": "Heracles encounter (City of Ephyra, variant 2)",
    "HeraclesCombatO": "Heracles encounter (Rift of Thessaly)",
    "HeraclesCombatO2": "Heracles encounter (Rift of Thessaly, variant 2)",
    "HeraclesCombatP": "Heracles encounter (Olympus)",
    "HeraclesCombatP2": "Heracles encounter (Olympus, variant 2)",
    "IcarusCombatO": "Icarus encounter (Rift of Thessaly)",
    "IcarusCombatO2": "Icarus encounter (Rift of Thessaly, variant 2)",
    "IcarusCombatP": "Icarus encounter (Olympus)",
    "IcarusCombatP2": "Icarus encounter (Olympus, variant 2)",
    "NemesisCombatF": "Nemesis encounter (Erebus)",
    "NemesisCombatG": "Nemesis encounter (Oceanus)",
    "NemesisCombatH": "Nemesis encounter (Fields of Mourning)",
    "NemesisCombatI": "Nemesis encounter (Tartarus)",
    "OlympusIntro": "Olympus intro",

    # The 8 Hexes of Selene (WeaponsFiredRecord weapon ids).
    "WeaponSpellPotion": "Moon Water",
    "WeaponSpellLaser": "Lunar Ray",
    "WeaponSpellPolymorph": "Twilight Curse",
    "WeaponSpellSummon": "Night Bloom",
    "WeaponSpellTimeSlow": "Phase Shift",
    "WeaponSpellMeteor": "Total Eclipse",
    "WeaponSpellTransform": "Dark Side",
    "WeaponSpellLeap": "Wolf Howl",
    # Generic weapon-attack tracking ids (no standalone item name).
    "WeaponCast": "Cast",
    "WeaponCastArm": "Omega Cast",
    "WeaponStaffBall": "Witch's Staff (Special)",
    "WeaponStaffSwing5": "Witch's Staff (Omega Attack)",

    # Hidden 5th aspects of the Nocturnal Arms (WeaponsUnlocked unlock records).
    "SuitHexAspect5": "Aspect of Selene",
    "SuitMarkCritAspect5": "Aspect of Nyx",
    "DaggerBlockAspect5": "Aspect of Artemis",
    "DaggerHomingThrowAspect5": "Aspect of Pan",
    "AxeArmCastAspect5": "Aspect of Charon",
    "AxePerfectCriticalAspect5": "Aspect of Thanatos",
    "StaffClearCastAspect5": "Aspect of Circe",
    "StaffSelfHitAspect5": "Aspect of Momus",
    "LobCloseAttackAspect5": "Aspect of Medea",
    "LobImpulseAspect5": "Aspect of Persephone",
    "TorchDetonateAspect5": "Aspect of Moros",
    "TorchSprintRecallAspect5": "Aspect of Eos",
    # Rank-2 of the Moonstone Axe's base aspect (not a hidden aspect).
    "AxeRecoveryAspect2": "Moonstone Axe",

    # Objective ids (ObjectivesCompleted leaves).
    "NemesisBet": "Nemesis' wager",
}
