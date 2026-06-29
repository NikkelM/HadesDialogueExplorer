"""Curated friendly names for Hades 1 hub / named rooms.

Room ids mostly have no ``DisplayName`` in the game text data; the closest
authored names are the ``RichPresence_*`` / encounter strings in
``Content/Game/Text/en/MiscText.en.sjson``. The recognisable hub, boss, story
and secret rooms are vendored here (verified via the hades-knowledge agent) and
merged into the viewer's ``entityNames`` so room-id gates (``RequiredRoom`` /
``RequiredRoomThisRun`` / ``RequiredSeenRooms`` values) read with a friendly
name; the internal id stays in the row tooltip.

``DeathArea`` ("House of Hades") already resolves from a real ``DisplayName`` in
the text data, so it is not repeated here. Generic transition / opening /
reprieve chamber codes (``B_Intro``, ``RoomOpening``, ``D_Reprieve01``, ...)
have no authored name and are intentionally left to render raw.

Biome-letter prefixes: A=Tartarus, B=Asphodel, C=Elysium, D=Styx, E=Surface.
"""

HADES1_HUB_ROOM_NAMES = {
    # House of Hades sub-room (the main hall ``DeathArea`` already resolves via
    # its DisplayName). Only the master bedroom is gated on in dialogue.
    "DeathAreaBedroomHades": "Hades' Bedchamber",
    # Temple of Styx central hub (the satyr-guarded door-choice room).
    "D_Hub": "Temple of Styx (hub)",
    # Biome boss chambers (named by the boss fought there).
    "A_Boss01": "Megaera's boss chamber",
    "A_Boss02": "Alecto's boss chamber",
    "A_Boss03": "Tisiphone's boss chamber",
    "B_Boss01": "The Bone Hydra's boss chamber",
    "B_Boss02": "The Bone Hydra's boss chamber (Extreme Measures)",
    "C_Boss01": "Theseus and Asterius' boss chamber",
    "D_Boss01": "Hades' boss chamber",
    # Story / NPC chambers.
    "A_Story01": "Sisyphus' chamber",
    "B_Story01": "Eurydice's chamber",
    "C_Story01": "Patroclus' chamber",
    # Surface / Persephone meeting.
    "E_Story01": "Persephone's Garden",
    # Hidden Chaos chambers (three interchangeable variants).
    "RoomSecret01": "Chaos (room variant 1)",
    "RoomSecret02": "Chaos (room variant 2)",
    "RoomSecret03": "Chaos (room variant 3)",
    # Regular biome combat/transition rooms gated on by dialogue, named by
    # biome + room function. Numbered only where several of a kind are gated.
    "A_MiniBoss01": "Tartarus (mini-boss room)",
    "A_MiniBoss02": "Doomstone's chamber",
    "A_MiniBoss03": "The Wretched Sneak's chamber",
    "A_PostBoss01": "Tartarus (post-boss room)",
    "A_PreBoss01": "Tartarus (pre-boss shop)",
    "B_Intro": "Asphodel (entrance)",
    "B_MiniBoss01": "Megagorgon's chamber",
    "B_Wrapping01": "Asphodel (Barge of Death)",
    "B_PreBoss01": "Asphodel (pre-boss shop)",
    "C_Intro": "Elysium (entrance)",
    "C_MiniBoss01": "Asterius' chamber",
    "C_PostBoss01": "Elysium (post-boss room)",
    "C_PreBoss01": "Elysium (pre-boss shop)",
    "D_Intro": "Styx (entrance)",
    "D_Reprieve01": "Styx (fountain chamber)",
    "RoomSimple01": "Tartarus (introductory combat room)",
    # Named one-off encounter / story rooms.
    "CharonFight01": "Erebus (Charon's boss chamber)",
    "Return04": "Credits boat ride Asphodel room",
    "Return06": "Credits boat ride Tartarus opening room",
}
