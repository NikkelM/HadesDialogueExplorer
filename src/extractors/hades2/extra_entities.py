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
}
