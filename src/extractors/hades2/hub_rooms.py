"""Curated friendly names for Hades II hub / special-named rooms.

Room ids have no ``DisplayName`` in the game text data (the save-banner name is
resolved indirectly via ``SaveProfileLocationText`` -> a ``HelpText`` id), so
the few player-facing hub and uniquely-named rooms are vendored here. They are
merged into the viewer's ``entityNames`` lookup so room-id gates
(``CurrentRun.CurrentRoom.Name``, ``CurrentHubRoom.Name``, ...) read with a
friendly name. The internal room id stays in the row tooltip.

Only genuinely-named locations are mapped; the per-biome combat / shop /
reprieve / opening / boss chamber codes (``F_Boss01``, ``N_Shop01``, ...) are a
room-function suffix on a biome, not a unique place, so they are intentionally
left to render raw. Sources: DeathLoopData.lua HubRoomData, RoomDataN.lua, and
the ``Location_*`` HelpText banners (verified via the hades2-knowledge agent).
"""

HADES2_HUB_ROOM_NAMES = {
    # The run-launch / training-grounds side of the Crossroads (Schelemeus,
    # the Altar, weapon + keepsake loadout). This is the hub form gated on in
    # dialogue; the camp-side ``Hub_Main`` is not referenced by any gate.
    "Hub_PreRun": "The Crossroads (Training Grounds)",
    # Young Melinoe's memory/dream version of the hub.
    "Flashback_Hub_Main": "The Crossroads (Flashback)",
    # Surface hub - the City of Ephyra.
    "N_Hub": "Ephyra (town square)",
    "N_PreHub01": "Ephyra (entrance)",
    # Biome boss chambers (named by the boss fought there). The "_Boss02"
    # variants are the higher-difficulty (Vow of Rivals / Testament) version of
    # the same fight.
    "I_Boss01": "Chronos' boss chamber",
    "C_Boss01": "Zagreus' boss chamber",
    "F_Boss01": "Hecate's boss chamber",
    "F_Boss02": "Hecate's boss chamber (Vow of Rivals)",
    "G_Boss01": "Scylla's boss chamber",
    "G_Boss02": "Scylla's boss chamber (Vow of Rivals)",
    "H_Boss01": "Cerberus' boss chamber",
    "H_Boss02": "Cerberus' boss chamber (Vow of Rivals)",
    "N_Boss01": "Polyphemus' boss chamber",
    "N_Boss02": "Polyphemus' boss chamber (Vow of Rivals)",
    "O_Boss01": "Eris' boss chamber",
    "O_Boss02": "Eris' boss chamber (Vow of Rivals)",
    "P_Boss01": "Prometheus' boss chamber",
    "Q_Boss01": "Typhon's boss chamber",
    "Q_Boss02": "Typhon's boss chamber (Vow of Rivals)",
    # Regular biome combat/transition rooms gated on by dialogue, named by
    # biome + room function. Mini-boss chambers are named after the enemy fought
    # there (proper HelpText DisplayName).
    # --- Erebus (F) ---
    "F_Opening01": "Erebus (entrance, variant 1)",
    "F_Opening02": "Erebus (entrance, variant 2)",
    "F_Opening03": "Erebus (entrance, variant 3)",
    "F_MiniBoss01": "Root-Stalker's chamber",
    "F_MiniBoss02": "Shadow-Spiller's chamber",
    "F_MiniBoss03": "Master-Slicer's chamber",
    "F_PreBoss01": "Erebus (pre-boss shop)",
    "F_PostBoss01": "Erebus (post-boss room)",
    "F_Shop01": "Erebus (shop)",
    "F_Reprieve01": "Erebus (fountain chamber)",
    "F_Story01": "Arachne's chamber",
    # --- Oceanus (G) ---
    "G_Intro": "Oceanus (entrance)",
    "G_MiniBoss01": "Deep Serpent's chamber",
    "G_MiniBoss02": "King Vermin's chamber",
    "G_MiniBoss03": "Hellifish's chamber",
    "G_PreBoss01": "Oceanus (pre-boss shop)",
    "G_PostBoss01": "Oceanus (post-boss room)",
    "G_Shop01": "Oceanus (shop)",
    "G_Reprieve01": "Oceanus (fountain chamber)",
    "G_Story01": "Narcissus' chamber",
    # --- Fields of Mourning (H) ---
    "H_Intro": "Fields of Mourning (entrance)",
    "H_Bridge01": "Fields of Mourning (Echo/shop chamber)",
    "H_MiniBoss01": "Phantom's chamber",
    "H_MiniBoss02": "Queen Lamia's chamber",
    "H_PreBoss01": "Fields of Mourning (pre-boss shop)",
    "H_PostBoss01": "Fields of Mourning (post-boss room)",
    "H_Shop01": "Fields of Mourning (shop)",
    # --- Tartarus / House of Hades (I) ---
    "I_Intro": "Tartarus (entrance)",
    "I_MiniBoss01": "The Verminancer's chamber",
    "I_MiniBoss02": "Goldwrath's chamber",
    "I_PreBoss01": "Tartarus (pre-boss shop)",
    "I_PreBoss02": "Tartarus (pre-boss shop, post-credits)",
    "I_PostBoss01": "Tartarus (post-boss room)",
    "I_Story01": "Hades' chamber",
    # --- City of Ephyra / surface (N) ---
    "N_Opening01": "Ephyra (entrance)",
    "N_MiniBoss01": "Satyr Champion's chamber",
    "N_MiniBoss02": "Erymanthian Boar's chamber",
    "N_PreBoss01": "Ephyra (pre-boss shop)",
    "N_PostBoss01": "Ephyra (post-boss room)",
    "N_Shop01": "City of Ephyra (shop)",
    "N_Story01": "Medea's chamber",
    # --- Rift of Thessaly (O) ---
    "O_Intro": "Rift of Thessaly (entrance)",
    "O_MiniBoss01": "Charybdis' chamber",
    "O_MiniBoss02": "The Yargonaut's chamber",
    "O_PreBoss01": "Rift of Thessaly (pre-boss shop)",
    "O_PostBoss01": "Rift of Thessaly (post-boss room)",
    "O_Shop01": "Rift of Thessaly (shop)",
    "O_Reprieve01": "Rift of Thessaly (fountain chamber)",
    "O_Story01": "Circe's chamber",
    # --- Olympus (P) ---
    "P_Intro": "Olympus (entrance)",
    "P_MiniBoss01": "Talos' chamber",
    "P_MiniBoss02": "Mega-Dracon's chamber",
    "P_PreBoss01": "Olympus (pre-boss shop)",
    "P_PostBoss01": "Olympus (post-boss room)",
    "P_Shop01": "Olympus (shop)",
    "P_Reprieve01": "Olympus (fountain chamber)",
    "P_Story01": "Dionysus' chamber",
    # --- The Summit (Q) ---
    "Q_Intro": "The Summit (entrance)",
    "Q_MiniBoss02": "Spawn of Typhon's chamber",
    "Q_MiniBoss03": "Tail of Typhon's chamber",
    "Q_MiniBoss05": "Twins of Typhon's chamber",
    "Q_PreBoss01": "The Summit (pre-boss shop)",
    "Q_Story01": "The Palace of Zeus",
    # Named one-off rooms.
    "Dream_Intro": "Dream Dive (entrance)",
    "I_DeathAreaRestored": "House of Hades (revonated)",
}
