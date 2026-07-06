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
# default and adds nothing.
HADES2_PATH_SCOPE_NAMES = {
    "CurrentRun": "this run",
    "PrevRun": "last run",
    "GameState": "",
}

# Field key -> friendly label. Keys are the path segment after the root (or a
# two-segment sub-path under Hero / CurrentRoom). Object-taking fields (see
# HADES2_PATH_OBJECT_FIELDS) read as "<label> <entity>"; the rest are terminal.
HADES2_PATH_FIELD_NAMES = {
    # --- interaction / progress counters (take an object) ---
    "UseRecord": "interacted with",
    "RoomsEntered": "entered",
    "RoomCountCache": "entered",
    "BiomesReached": "reached",
    "EnemyKills": "killed",
    "EncountersOccurredCache": "encounters occurred:",
    "WeaponsUnlocked": "weapons unlocked:",
    "TextLinesRecord": "dialogues played:",
    "SpawnRecord": "spawned",
    "WorldUpgradesAdded": "performed incantation/unlocked cosmetic:",
    "WorldUpgrades": "performed incantation/unlocked cosmetic:",
    "LifetimeResourcesGained": "gained",
    "LifetimeResourcesSpent": "spent",
    "Resources": "current",
    # Leaf-subject GameState records: the trailing leaf is the meaningful entity
    # (a boon / incantation / resource), resolved via entityNames with a colon.
    "TraitsTaken": "boons/traits taken:",
    "TraitCache": "boons/traits taken:",
    "WorldUpgradesRevealed": "incantation/cosmetic revealed:",
    "ResourcesGained": "resources gained:",
    "Hero.TraitDictionary": "has equipped",
    "Hero.Weapons": "equipped",
    # ScreensViewed leaf ids are UI-screen names, not game entities (and several
    # collide with unrelated sjson ids), so they resolve through a dedicated
    # screen-name map (HADES2_PATH_FIELD_LEAF_NAMES) rather than entityNames.
    "ScreensViewed": "viewed UI screen:",

    # --- terminal flags / scalars (label stands alone) ---
    "ReachedTrueEnding": "reached the credits",
    "TyphonDefeatedWithStormStop":
        'defeated Typhon after casting "Disintegration of Monstrosity"',
    "CompletedRunsCache": "completed runs",
    "SpentShrinePointsCache": "total active Fear",
    "ActiveBounty": "Chaos Trial",
    "ActiveShrineBounty": "active Testament",
    "EquippedFamiliar": "equipped Animal Familiar",
    "GamePhase": "Moon Phase",
    "TimePassageOccurred": "additional time was passed in the Crossroads",
    "IsDreamRun": "is a Dream Dive",
    "Cleared": "run cleared",
    "LastBossHealthBarRecord": "previous-encounter health of",
    "LastBossDifficultyRecord": "previous-encounter difficulty of",
    "CurrentRoom": "current room",
    "CurrentRoom.Name": "current room",
    "CurrentRoom.RoomSetName": "current region",
    "CurrentRoom.UseRecord": "interactions in current room",
    "CurrentRoom.SpeechRecord": "voiceline played in current room",
    "CurrentRoom.FishingPointChoices": "current room has a fishing point",
    "CurrentRoom.FishingPointUsed": "player used a fishing point in current room",
    "CurrentRoom.Kills": "kills in current room",
    "CurrentRoom.Encounter.Name": "current room encounter",
    "CurrentRoom.Encounter.Spawns": "current room spawns",
    "CurrentRoom.Encounter.PlayerTookDamage": "took damage in current room",
    "Hero": "the player",
    "Hero.IsDead": "the player is dead",
    "Hero.LastStands": "Death Defiances remaining",
    "Hero.MetGods": "gods encountered",
    "Hero.UpgradableHammerCount": "Upgradable Daedalus' Hammers equipped",

    # --- count / record GameState fields (terminal nouns; the comparison or
    # operand list carries the specifics) ---
    "SpeechRecord": "voicelines played",
    "ClearedRunsCache": "cleared runs",
    "ClearedUnderworldRunsCache": "cleared Underworld runs",
    "ClearedSurfaceRunsCache": "cleared Surface runs",
    "ShrineBountiesCompleted": "Testaments completed",
    "ObjectivesCompleted": "objectives completed:",
    "ExorcismSuccesses": "shades pacified",
    "MetaUpgradeUnlockedCountCache": "Arcana unlocked",
    "MaxMetaUpgradeCostCache": "maximum Grasp unlocked",
    "CosmeticsPurchasedCountCache": "bought cosmetics:",
    "GiftPresentation": "keepsakes unlocked",
    "WeaponsFiredRecord": "weapons/effects used:",
    "EncountersCompletedCache": "encounters completed (all time):",
    "EncounterClearStats": "encounter clear stats",
    "EncountersOccurredBiomeCache": "encountered",
    "BiomeDepthCache": "rooms entered (current region)",
    "HighestShrinePointClearUnderworldCache": "highest Fear cleared (Underworld)",
    "HighestShrinePointClearSurfaceCache": "highest Fear cleared (Surface)",
    "LastAwardTrait": "keepsake currently equipped",
    "WasRandomLoot": "was random shop boon",

    # --- gathering-tool / familiar success counters (terminal counts; the
    # comparison carries the magnitude, e.g. "fish caught by hand >= 5") ---
    "FishingSuccessesManual": "fish caught by hand",
    "FishingSuccessesFamiliar": "fish caught by Familiar",
    "ShovelSuccesses": "successful digs",
    "PickaxeSuccesses": "ore deposits mined",
    "HarvestSuccesses": "successful harvests",
    "ExorcismSuccessesFamiliar": "shades pacified by Familiar",
    "ExorcismSuccessesManual": "shades pacified by hand",
    "NightmaresOccurred": "Chronos' death taunts",
    "SurfaceShopPurchases": "Shrine of Hermes purchases",
    "FieldsRewardFindersActivated": "Golden Boughs used (Fields of Mourning)",
    "ActiveBountyAttempts": "attempts on the active Chaos Trial",
    "PackagedBountyClears": "Chaos Trials cleared",
    "PackagedBountyAttempts": "Chaos Trial attempts",
    "FishCaught": "fish caught",
    # --- progress / cache counters (terminal) ---
    "ClearedDreamRunsCache": "cleared Dream Dives",
    "StoryResetCount": "story resets",
    "CodexEntriesUnlockedCache": "Codex entries unlocked",
    "MetaUpgradeMaxLevelCountCache": "Arcana Cards at max rank",
    # --- value caches / settings (terminal; a raw threshold, not a count) ---
    "MetaUpgradeCostCache": "Grasp spent on equipped Arcana",
    "MoneySpentTowardCharonPoints": "Gold spent toward Charon's reward",
    "RunDepthCache": "run depth (room number)",
    "GameplayTime": "play time (seconds)",
    "BadgeRank": "Spirit Mixer badge rank",
    "NextBiomeStateName": "next region condition",
    "LastReward.Name": "last reward taken",
    # --- boolean flags (terminal; a scope suffix supplies "this run"/"last run") ---
    "AnyMailboxReady": "Charon Crossroads reward is available for pickup",
    "NewRecordClearTime": "set a new fastest-clear record",
    "NightmareOccurred": "saw a Chronos death taunt",
    # --- object fields keyed by an entity leaf (see HADES2_PATH_OBJECT_FIELDS).
    # Verb style ("<verb> <entity>") unless the leaf is a value/name matched by
    # IsAny. Value-cache object fields keep the raw operator. ---
    # ShrineUpgrades.<vow> = that Oath of the Unseen vow's rank (value cache);
    # vow id resolves via entityNames ("Vow of Rivals", ...).
    "ShrineUpgrades": "rank of vow:",
    # ConfigOptionCache.<option> = an engine setting value (value cache).
    "ConfigOptionCache": "setting:",
    "ProjectileRecord": "fired",
    "SpecialInteractRecord": "saluted",
    "TraitUses": "used",
    "QuestsViewed": "viewed Minor Prophecy",
    "QuestsCompleted": "completed Minor Prophecy",
    # QuestStatus.<quest> value = status enum, matched via IsAny.
    "QuestStatus": "Minor Prophecy status of",
    "WorldUpgradesViewed": "viewed incantation(s)/cosmetic(s):",
    "WorldUpgradesAffordable": "can afford incantation(s)/cosmetic(s):",
    "LootTypeHistory": "interacted with",
    "CodexEntriesViewed": "read the Codex entry on",
    "WeaponsCache": "used",
    "BiomeVisits": "visited",
    "ResourcesSpent": "spent",
    "ExorcisedNames": "pacified",
    "DreamRunClearedWithWeapons": "cleared a Dream Dive with",
    # TraitRarityCache.<trait> value = rarity enum, matched via IsAny.
    "TraitRarityCache": "rarity of",
    "AchievementsUnlocked": "unlocked achievement",
    "Flags": "story flag:",
    "FamiliarsUnlocked": "unlocked",
    "NemesisTakeExitRecord": "Nemesis took an exit to",
    "NemesisTakeRoomExitRecord": "Nemesis took an exit to",
    # Handled by dedicated renderers in info-panel.js (the label here is a
    # fallback if the special renderer declines): MetaUpgradeState.<card>.Level/
    # .Unlocked/.Equipped -> Arcana rank/state; LifetimeTraitStats.<trait>.UseCount
    # -> "runs using <trait>"; LastObjectiveFailedRun.<obj> -> "last failed N+ runs
    # ago"; ClearedWithWeapons.<region|weapon> -> region-vs-weapon aware.
    "MetaUpgradeState": "Arcana card state",
    "LifetimeTraitStats": "lifetime stats for boon/trait",
    "LastObjectiveFailedRun": "run when objective last failed:",
    "ClearedWithWeapons": "cleared with weapon:",
    # Live-playback audio snapshot (root with no scope prefix).
    "AudioState.MusicName": "current music track",
    "AudioState.AmbientTrackName": "current ambient track",
    # --- previously-unlabelled fields ---
    # ``CurrentHubRoom`` is a top-level global holding the current hub room's
    # internal name (a string), or nil when not in a hub - so a truthy value
    # means the player is in a hub room. ``.Name`` is its room-name sub-field.
    "CurrentHubRoom": "in a hub room",
    "CurrentHubRoom.Name": "current hub room",
    "AllSpellInvestedCache": "Hex fully upgraded",
    "ArtemisHubSong": "Artemis singing in the Crossroads",
    "BountyCleared": "Chaos Trial cleared",
    "PendingSpellDrop": "Shrine of Hermes Hex delivery pending",
    "UsedStoryReset": "performed Returning to a Real Possibility (story reset)",
    "LastDreamRunCleared": "cleared the last Dream Dive",
    "BiomeHarvestPointsSeen.PickaxePoint": "pickaxe resource point seen (this region)",
    "BiomeHarvestPointsSeen.ShovelPoint": "shovel resource point seen (this region)",
    "ScreenViewRecord.CosmeticsShop": "viewed any cosmetics screen",
    "ShrineUpgradesDisabled.MinibossCountShrineUpgrade": "Vow of Shadow inactive",
    "SessionMapState.CauldronWitchcraftOccurring": "Hecate is using the Cauldron",
    "SessionMapState.OdysseusAtTaverna": "Odysseus is at the Taverna",
    # Music-record fields take a track leaf resolved via the leaf-name map below.
    "MusicRecord": "heard",
    "ScyllaDefeatMusicRecord": "heard",
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
    "TraitsTaken",
    "TraitCache",
    "WorldUpgradesRevealed",
    "ResourcesGained",
    "Hero.TraitDictionary",
    "Hero.Weapons",
    "LastBossHealthBarRecord",
    "LastBossDifficultyRecord",
    "EncountersCompletedCache",
    "WeaponsFiredRecord",
    "ObjectivesCompleted",
    "CosmeticsPurchasedCountCache",
    "ShrineUpgrades",
    "ConfigOptionCache",
    "ProjectileRecord",
    "SpecialInteractRecord",
    "TraitUses",
    "QuestsViewed",
    "QuestsCompleted",
    "QuestStatus",
    "WorldUpgradesViewed",
    "WorldUpgradesAffordable",
    "LootTypeHistory",
    "CodexEntriesViewed",
    "WeaponsCache",
    "BiomeVisits",
    "ResourcesSpent",
    "ExorcisedNames",
    "DreamRunClearedWithWeapons",
    "TraitRarityCache",
    "AchievementsUnlocked",
    "Flags",
    "FamiliarsUnlocked",
    "NemesisTakeExitRecord",
    "NemesisTakeRoomExitRecord",
    "EncountersOccurredBiomeCache",
    "MusicRecord",
    "ScyllaDefeatMusicRecord",
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
    # Cosmetics-purchase count categories (the leaf is a location/total bucket,
    # not a game entity, and the words are generic - keep them in a per-field map
    # rather than the global entityNames lookup).
    "CosmeticsPurchasedCountCache": {
        "Total": "Total",
        "Tent": "Melinoe's Tent",
        "PreRun": "Training Grounds",
    },
    # Scylla band song tracks (the leaf is an internal ``/Music/...`` id), shown
    # as the song's in-game title.
    "MusicRecord": {
        "/Music/IrisMusicScylla2_MC": '"I am Gonna Claw (Out Your Eyes)"',
    },
    "ScyllaDefeatMusicRecord": {
        "/Music/IrisMusicScylla4_MC": '"Bewitching Eyes"',
    },
    # Engine config-option names (the leaf is an internal setting key), shown as
    # a plain-language setting name.
    "ConfigOptionCache": {
        "MusicVolume": "music volume",
    },
    # Projectile ids (fired by the player, an enemy, or an ally - e.g. Artemis
    # fires ArtemisSniperBolt); shown as a plain-language projectile name.
    "ProjectileRecord": {
        "ArtemisSniperBolt": "Artemis's sniper bolt",
    },
    # Story-flag ids have no systematic friendly form (splitting the camelCase is
    # misleading), so curated names are kept here. Unlisted flags fall back to the
    # raw id rather than a wrong guess.
    "Flags": {
        "AcquiredMixerForCirceQuest": "Acquired Pearl for Circe",
    },
}

# Object-fields whose trailing leaf is itself the meaningful value even though it
# is not a friendly-named entity (the raw id is what the gate refers to and what
# the reader wants to see). These render as "<label>: <raw leaf>" and count as
# fully resolved (the raw dotted path moves to the tooltip). ``TextLinesRecord``
# leaves are dialogue ids - shown verbatim as the played line.
HADES2_PATH_LITERAL_LEAF_FIELDS = frozenset({
    "TextLinesRecord",
})
