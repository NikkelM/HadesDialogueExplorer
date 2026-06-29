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
    # The one boss room with a distinct location banner. Named by the boss
    # fought there, matching the H1 boss-chamber pattern.
    "I_Boss01": "Chronos' boss chamber",
    # Biome boss chambers (named by the boss fought there). The "_Boss02"
    # variants are the higher-difficulty (Testament) version of the same fight.
    "C_Boss01": "Zagreus' boss chamber",
    "F_Boss01": "Hecate's boss chamber",
    "G_Boss01": "Scylla's boss chamber",
    "H_Boss01": "Cerberus' boss chamber",
    "N_Boss01": "Polyphemus' boss chamber",
    "N_Boss02": "Polyphemus' boss chamber (Vow of Rivals)",
    "O_Boss01": "Eris' boss chamber",
    "O_Boss02": "Eris' boss chamber (Vow of Rivals)",
    "P_Boss01": "Prometheus boss chamber",
    "Q_Boss01": "Typhon's boss chamber",
    "Q_Boss02": "Typhon's boss chamber (Vow of Rivals)",
    # Regular biome combat/transition rooms gated on by dialogue, named by
    # biome + room function. Numbered only where several of a kind are gated.
    "F_Opening03": "Erebus (entrance)",
    "F_PostBoss01": "Erebus (post-boss room)",
    "F_PreBoss01": "Erebus (pre-boss shop)",
    "F_Story01": "Arachne's chamber",
    "G_Intro": "Oceanus (entrance)",
    "G_MiniBoss02": "King Vermin's chamber",
    "G_MiniBoss03": "Jellyfish's chamber",
    "G_PostBoss01": "Oceanus (post-boss room)",
    "G_Story01": "Narcissus' chamber",
    "H_Intro": "Fields of Mourning (entrance)",
    "H_MiniBoss01": "Queen Lamia's chamber",
    "H_PostBoss01": "Fields of Mourning (post-boss room)",
    "H_PreBoss01": "Fields of Mourning (pre-boss shop)",
    "I_Intro": "Tartarus (entrance)",
    "I_PostBoss01": "Tartarus (post-boss room)",
    "I_Story01": "Hades' chamber",
    "N_MiniBoss02": "Erymanthian Boar's chamber",
    "N_Opening01": "Ephyra (entrance)",
    "N_PostBoss01": "Ephyra (post-boss room)",
    "N_PreBoss01": "Ephyra (pre-boss shop)",
    "N_Story01": "Medea's chamber",
    "O_Intro": "Rift of Thessaly (entrance)",
    "O_MiniBoss01": "Charybdis' chamber",
    "O_MiniBoss02": "The Yargonaut's chamber",
    "O_PostBoss01": "Rift of Thessaly (post-boss room)",
    "O_PreBoss01": "Rift of Thessaly (pre-boss shop)",
    "O_Story01": "Circe's chamber",
    "P_Intro": "Olympus (entrance)",
    "P_MiniBoss01": "Talos' chamber",
    "P_MiniBoss02": "Sky-Dracon's chamber",
    "P_PostBoss01": "Olympus (post-boss room)",
    "P_Story01": "Dionysus' chamber",
    "Q_Intro": "The Summit (entrance)",
    "Q_MiniBoss03": "Tail of Typhon's chamber",
    "Q_PreBoss01": "The Summit (pre-boss room)",
    "Q_Story01": "The Palace of Zeus",
    # Named one-off rooms.
    "Dream_Intro": "Dream Dive (entrance)",
    "I_DeathAreaRestored": "House of Hades (revonated)",
}
