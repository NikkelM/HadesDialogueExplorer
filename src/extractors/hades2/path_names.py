"""Curated friendly names for the Hades II save-state *paths* that appear in
``otherRequirements`` gates (``Path:`` / ``PathTrue:`` / ``PathFalse:`` keys and
the ``Path`` records inside comparison clauses).

H2 gates address save state by dotted path, e.g.
``CurrentRun.UseRecord.NPC_Hecate_01`` or ``GameState.ReachedTrueEnding``. The
viewer keeps the raw path (so the exact gate stays visible) and appends a
friendly gloss built from three pieces:

  - the *root scope* (``CurrentRun`` -> "this run", ``PrevRun`` -> "last run";
    ``GameState`` is the persistent default and adds no suffix);
  - the *state field* (``UseRecord`` -> "interacted with", ...); and
  - the trailing *entity leaf* for object-taking fields, resolved through the
    normal ``entityNames`` map (so ``...UseRecord.NPC_Hecate_01`` reads
    "interacted with Hecate").

Two field maps drive this:
  - ``HADES2_PATH_FIELD_NAMES`` maps a field key (one segment, or a two-segment
    sub-path under ``Hero`` / ``CurrentRoom``) to its label.
  - ``HADES2_PATH_OBJECT_FIELDS`` is the subset of those fields that take a
    trailing object (a record/dictionary keyed by an entity id); fields not in
    this set are terminal flags/scalars whose label stands alone.

H1 uses flat named ``otherRequirements`` fields rather than dotted paths, so it
has no path vocabulary; these maps are H2-only.
"""

# Root scope -> suffix appended to the gloss. GameState is the persistent
# default and adds nothing; CurrentHubRoom is a present-tense context.
HADES2_PATH_SCOPE_NAMES = {
    "CurrentRun": "this run",
    "PrevRun": "last run",
    "GameState": "",
    "CurrentHubRoom": "",
}

# Field key -> friendly label. Keys are the path segment after the root (or a
# two-segment sub-path under Hero / CurrentRoom). Object-taking fields (see
# HADES2_PATH_OBJECT_FIELDS) read as "<label> <entity>"; the rest are terminal.
HADES2_PATH_FIELD_NAMES = {
    # --- interaction / progress counters (take an object) ---
    "UseRecord": "interacted with",
    "RoomsEntered": "entered",
    "RoomCountCache": "entered",
    "BiomesReached": "reached biome",
    "EnemyKills": "killed",
    "EncountersOccurredCache": "completed encounter",
    "WeaponsUnlocked": "unlocked weapon",
    "TextLinesRecord": "played dialogue",
    "SpawnRecord": "spawned",
    "WorldUpgradesAdded": "unlocked incantation/cosmetic:",
    "WorldUpgrades": "active incantation/cosmetic:",
    "LifetimeResourcesGained": "gained",
    "LifetimeResourcesSpent": "spent",
    "Resources": "current",
    "Hero.TraitDictionary": "has equipped",
    "Hero.Weapons": "equipped weapon",
    # ScreensViewed leaf ids are UI-screen names, not game entities (and several
    # collide with unrelated sjson ids), so they resolve through a dedicated
    # screen-name map (HADES2_PATH_FIELD_LEAF_NAMES) rather than entityNames.
    "ScreensViewed": "viewed UI screen:",

    # --- terminal flags / scalars (label stands alone) ---
    "ReachedTrueEnding": "reached the credits",
    "TyphonDefeatedWithStormStop":
        'Defeated Typhon after casting "Disintegration of Monstrosity"',
    "CompletedRunsCache": "completed runs",
    "SpentShrinePointsCache": "Total active Fear",
    "ActiveBounty": "Chaos Trial",
    "ActiveShrineBounty": "Active Testament",
    "EquippedFamiliar": "equipped Animal Familiar",
    "GamePhase": "Moon Phase",
    "TimePassageOccurred": "Additional time was passed in the Crossroads",
    "IsDreamRun": "is a Dream Dive",
    "Cleared": "run cleared",
    "LastBossHealthBarRecord": "Boss health during previous encounter",
    "LastBossDifficultyRecord":
        "Boss in unrivalled form during previous encounter",
    "Hero": "the player",
    "Hero.IsDead": "is dead",
    "Hero.LastStands": "Death Defiances remaining",
    "CurrentRoom": "current room",
    "CurrentRoom.Name": "current room",
    "CurrentRoom.RoomSetName": "current biome",
    "CurrentRoom.UseRecord": "interactions in current room",
    "Hero": "the player",
    "Hero.IsDead": "is dead",
    "Hero.LastStands": "Death Defiances remaining",
    "Hero.MetGods": "gods encountered",
}

# Fields whose path carries a trailing entity-id object (a record keyed by an
# entity); the gloss reads "<label> <entity>". All other fields are terminal.
HADES2_PATH_OBJECT_FIELDS = frozenset({
    "UseRecord",
    "RoomsEntered",
    "RoomCountCache",
    "BiomesReached",
    "EnemyKills",
    "EncountersOccurredCache",
    "WeaponsUnlocked",
    "ScreensViewed",
    "TextLinesRecord",
    "SpawnRecord",
    "WorldUpgradesAdded",
    "WorldUpgrades",
    "LifetimeResourcesGained",
    "LifetimeResourcesSpent",
    "Resources",
    "Hero.TraitDictionary",
    "Hero.Weapons",
})

# Per-field leaf-name maps: an object-taking field whose trailing leaf is NOT a
# game entity resolves through its own map here instead of through
# ``entityNames``. ``ScreensViewed`` leaves are UI-screen ids (several of which
# collide with unrelated sjson entity ids), so they get friendly screen names
# here. The internal screen id stays in the raw path either way.
HADES2_PATH_FIELD_LEAF_NAMES = {
    "ScreensViewed": {
        "BountyBoard": "Chaos Trials",
        "QuestLog": "Fated List of Minor Prophecies",
        "Shrine": "Oath of the Unseen",
        "MetaUpgradeCardLayout": "Arcana",
        "MetaUpgradeCardUpgradeLayout": "Arcana (Upgrades)",
        "SurfaceShop": "Shrine of Hermes",
        "MarketScreen": "Wretched Broker",
        "GhostAdmin": "Cauldron",
        "KeepsakeRack": "Keepsake Display Case",
        "GraspLimitLayout": "Arcana Grasp",
    },
}
