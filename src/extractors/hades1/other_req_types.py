"""Viewer-label data for Hades 1's non-textline ``otherRequirements``
vocabulary.

H1 textlines carry a second tier of requirement fields that the
extractor catches under the ``Require*`` / ``Requires*`` prefix but
that are *not* in the textline-set allowlist (those live in
:mod:`src.extractors.hades1.req_types`). They gate on non-dialogue
gameplay state: flags, room / biome history, loadout, kill counts,
meta progression, run status, and a long tail of one-offs.

This module supplies two parallel 1:1 maps:

* :data:`HADES1_OTHER_REQ_LABELS` - friendly short label rendered as
  the row's pill (``Must NOT have flag (ALL): InFlashback``).
* :data:`HADES1_OTHER_REQ_TOOLTIPS` - one-line plain-English blurb
  shown as the second line of the per-row hover tooltip (internal
  name on line 1, blurb on line 2).

Every distinct ``otherRequirements`` key encountered in the merged H1
dataset must appear in BOTH maps; ``tests/hades1/test_other_req_types``
enforces full coverage and the disjoint-from-textline-vocab invariant.
Some long-tail entries are best-effort reasoned from field name +
sample values rather than verified against the engine's
``RequirementMethods.lua`` - corrections welcome.

Both maps are merged into the existing per-game ``reqTypeLabels`` /
``reqTypeTooltips`` bundles by :mod:`src.label_maps` so the viewer
only ever sees one flat dict per game. The textline-vs-other split
is preserved at the source level so :mod:`tests.hades1.test_req_types`
invariants on the textline allowlist stay tight.

Wording conventions mirror :data:`HADES1_REQ_TYPE_LABELS`:

* positives use ``Must have`` / ``Must be``;
* negatives use ``Must NOT have`` / ``Must NOT be``;
* quantifier (``ALL`` / ``ANY``) appears in parens where applicable;
* scope (``this run`` / ``last run`` / ``this room``) appears in
  parens after the quantifier;
* numeric thresholds use ``Min.`` / ``Max.`` prefixes and rely on
  the viewer to append the value as a trailing ``: N``.
"""


# Friendly short labels for every H1 ``otherRequirements`` key that
# turns up in the merged dataset. The viewer renders the row as
# ``<friendly label>: <value summary>`` with a hover tooltip carrying
# the internal field name + the matching blurb from
# HADES1_OTHER_REQ_TOOLTIPS. Coverage is enforced as 1:1 with the
# tooltip dict by tests/hades1/test_other_req_types.py.
HADES1_OTHER_REQ_LABELS = {
    # ----- Flag state -----
    "RequiredFalseFlags":                       "Must NOT have flag (ALL)",
    "RequiredTrueFlags":                        "Must have flag (ALL)",

    # ----- GameState.Values / config options -----
    "RequiredValues":                           "GameState.Values must equal",
    "RequiredFalseValues":                      "GameState.Values must NOT equal",
    "RequiredMinValues":                        "Min. GameState.Values",
    "RequiredTrueConfigOptions":                "Config option must be enabled (ALL)",
    "RequiredFalseConfigOptions":               "Config option must be disabled (ALL)",

    # ----- NPC / item / interaction counts -----
    "RequiredMinNPCInteractions":               "Min. NPC interactions",
    "RequiredMaxNPCInteractions":               "Max. NPC interactions",
    "RequiredMinItemInteractions":              "Min. item interactions",
    "RequiredFalseInteractionThisRun":          "Must NOT have triggered interaction (this run)",
    "RequiredNotActivatedThisRun":              "Interaction id must NOT have activated (this run)",
    "RequiredIdsNotActivatedThisRun":           "Interaction id must NOT have activated (ANY, this run)",

    # ----- Current room / biome -----
    "RequiredRoom":                             "Must be in room",
    "RequiredBiome":                            "Must be in biome",
    "RequiredFalseBiome":                       "Must NOT be in biome",
    "RequiredMinExits":                         "Min. exits in current room",
    "RequiredMinBiomeDepth":                    "Min. biome depth (this run)",
    "RequiredMaxBiomeDepth":                    "Max. biome depth (this run)",
    "RequiredMinDepth":                         "Min. rooms visited (this run)",
    "RequiredMaxDepth":                         "Max. rooms visited (this run)",
    "RequiredMinElapsedTime":                   "Min. run duration (seconds)",

    # ----- Room history (per-run / lifetime) -----
    "RequiredRoomThisRun":                      "Must have entered room (this run)",
    "RequiredRoomLastRun":                      "Must have entered room (last run)",
    "RequiredAnyRoomsThisRun":                  "Must have entered room (ANY, this run)",
    "RequiredAnyRoomsLastRun":                  "Must have entered room (ANY, last run)",
    "RequiredRooms":                            "Must have entered room (ALL)",
    "RequiredSeenRooms":                        "Must have seen room (ALL)",
    "RequiredFalseSeenRoomThisRun":             "Must NOT have entered room (this run)",
    "RequiredFalseSeenRoomsThisRun":            "Must NOT have entered room (ANY, this run)",
    "RequiredFalseRoomLastRun":                 "Must NOT have entered room (last run)",
    "RequiredFalseRooms":                       "Must NOT have entered room (ANY)",
    "RequiredFalseSeenRooms":                   "Must NOT have entered room (ANY)",
    "RequiredMinTimesSeenRoom":                 "Min. room visits",
    "RequiredMaxTimesSeenRoom":                 "Max. room visits",

    # ----- Encounters / boss phase -----
    "RequiredBossPhase":                        "Boss phase must equal",
    "RequiredSeenEncounter":                    "Must have seen encounter",
    "RequiredEncounterThisRun":                 "Must have completed encounter (this run)",
    "RequiredAnyEncountersThisRun":             "Must have completed encounter (ANY, this run)",

    # ----- Loadout: boons (engine name: Traits) -----
    "RequiredTrait":                            "Must have boon equipped",
    "RequiredOneOfTraits":                      "Must have boon equipped (ANY)",
    "RequiredFalseTraits":                      "Must NOT have boon equipped (ANY)",
    "RequiredCountOfTraits":                    "Boon candidate set",
    "RequiredCountOfTraitsCount":               "Min. matching boons from set",
    "RequiredTraitsTaken":                      "Must have taken boon (ALL, this run)",
    "RequiredRunHasOneOfTraits":                "Must have taken boon (ANY, this run)",

    # ----- Loadout: god boons (engine name: GodLoot) -----
    "RequiredGodLoot":                          "Must have boon from god (this run)",
    "RequiredFalseGodLoot":                     "Must NOT have boon from god (this run)",
    "RequiredFalseGodLoots":                    "Must NOT have boon from god (ANY, this run)",
    "RequiredNoGodBoons":                       "Must have no god boons (this run)",
    "RequiredLootThisRun":                      "Must have picked up loot (this run)",
    "RequiredLootChoices":                      "Min. boon options shown",

    # ----- Loadout: weapons / Aspects / hammer upgrades -----
    "RequiredWeapon":                           "Must have weapon equipped",
    "RequiredWeaponsUnlocked":                  "Must have weapon unlocked (ALL)",
    "RequiredAnyWeaponsUnlocked":               "Must have weapon unlocked (ANY)",
    "RequiredFalseWeaponsUnlocked":             "Must NOT have weapon unlocked (ANY)",
    "RequiredMaxWeaponUpgrade":                 "Weapon Aspect must be base form",
    "RequiredFalseMaxWeaponUpgrade":            "Weapon Aspect must NOT be base form",
    "RequiredMaxWeaponUpgradeIndex":            "Max. weapon Aspect index",
    "RequiredFalseMaxWeaponUpgradeIndex":       "Weapon Aspect must NOT be at index",
    "RequiredLastInteractedWeaponUpgrade":      "Last touched weapon-upgrade altar",
    "RequiredLastInteractedWeaponUpgradeMaxed": "Last touched weapon-upgrade altar at max",
    "RequiredMinUnlockedWeaponEnchantments":    "Min. weapon Aspects unlocked",
    "RequiredMaxUnlockedWeaponEnchantments":    "Max. weapon Aspects unlocked",
    "RequiredMaxWeaponUpgrades":                "Max. hammer upgrades on weapon (this run)",
    "RequiredMinWeaponUpgrades":                "Min. hammer upgrades on weapon (this run)",
    "RequiredMinWeaponKills":                   "Min. lifetime kills per weapon",
    "RequiredMinRunsWithWeapons":               "Min. runs completed per weapon",
    "RequiredMaxRunsWithWeapons":               "Max. runs completed per weapon",
    "RequiredMinSuperLockKeysSpentOnWeapon":    "Min. Titan Blood spent on weapon",

    # ----- Loadout: keepsakes -----
    "RequiredKeepsake":                         "Must have keepsake equipped",
    "RequiresMaxKeepsake":                      "Equipped keepsake must be at max level",
    "RequiredAssistKeepsake":                   "Must have Call keepsake equipped",

    # ----- Loadout: cosmetics (House contractor) -----
    "RequiredCosmetics":                        "Must own cosmetic (ALL)",
    "RequiredFalseCosmetics":                   "Must NOT own cosmetic (ANY)",
    "RequiredAnyCosmetics":                     "Must own cosmetic (ANY)",
    "RequiredMinAnyCosmetics":                  "Min. cosmetics owned (from set)",
    "RequiredMaxAnyCosmetics":                  "Max. cosmetics owned (from set)",
    "RequiredCosmeticItemVisible":              "Cosmetic must be visible in House",
    "RequiredCosmeticPurchaseable":             "Cosmetic must be on sale",
    "RequiredSeenCosmeticPurchaseable":         "Must have seen cosmetic on sale",

    # ----- Loadout: supporting enemies (engine name: SupportAI) -----
    "RequiredSupportAINames":                   "Must have supporting enemy (ANY)",
    "RequiredFalseSupportAINames":              "Must NOT have supporting enemy (ANY)",
    "RequiredMaxSupportAINames":                "Max. supporting enemies equipped",

    # ----- Combat / damage state -----
    "RequiredMaxHealthFraction":                "Max. health fraction",
    "RequiredMaxLastStands":                    "Max. Death Defiance charges used",
    "RequiredKills":                            "Min. kills per enemy",
    "RequiredKillsThisRun":                     "Must have killed enemy (this run)",
    "RequiredAnyKillsThisRun":                  "Must have killed enemy (ANY, this run)",
    "RequiredKillsLastRun":                     "Must have killed enemy (ALL, last run)",
    "RequiredFalseKills":                       "Must NOT have killed enemy (ANY)",
    "RequiredMinTotalKills":                    "Min. lifetime kills",
    "RequiredLastKilledByUnits":                "Last killed by enemy (ANY)",
    "RequiredLastKilledByWeaponNames":          "Last killed by weapon (ANY)",
    "RequiredUnitNotAlive":                     "Unit must NOT be alive",
    "RequiredUnitAlive":                        "Unit must be alive",
    "RequiredUsedAssistInRoomThisRun":          "Must have used Call in room (this run)",

    # ----- Death history -----
    "RequiredDeathRoom":                        "Most recent death must be in room",
    "RequiredFalseDeathRoom":                   "Most recent death must NOT be in room",
    "RequiredAnyDeathEncounters":               "Most recent death must be in encounter (ANY)",
    "RequiredFalseDeathEncounters":             "Most recent death must NOT be in encounter (ANY)",

    # ----- Run status -----
    "RequiresRunCleared":                       "Current run cleared",
    "RequiresRunNotCleared":                    "Current run not yet cleared",
    "RequiresLastRunCleared":                   "Previous run cleared",
    "RequiresLastRunNotCleared":                "Previous run NOT cleared",
    "RequiresBestClearTimeLastRun":             "Previous run set new clear-time record",
    "RequiredCompletedRuns":                    "Completed runs must equal",
    "RequiredMinCompletedRuns":                 "Min. completed runs",
    "RequiredMaxCompletedRuns":                 "Max. completed runs",
    "RequiredRunsCleared":                      "Cleared runs must equal",
    "RequiredMinRunsCleared":                   "Min. runs cleared",
    "RequiredMaxRunsCleared":                   "Max. runs cleared",
    "RequiredMinConsecutiveClears":             "Min. consecutive cleared runs",
    "RequiredMinShrinePointThresholdClear":     "Min. runs cleared at Heat threshold",
    "RequiredMinBountiesEarned":                "Min. completed bounties",
    "RequiredMinQuestsComplete":                "Min. completed prophecies",
    "RequiredMaxQuestsComplete":                "Max. completed prophecies",
    "RequiredPurchasedWorldItemCountMin":       "Min. House contractor purchases",
    "RequiredPurchasedWorldItemCountMax":       "Max. House contractor purchases",

    # ----- Resources / counters -----
    "RequiredAccumulatedMetaPoints":            "Min. lifetime Darkness",
    "RequiredActiveMetaPointsMin":              "Min. current Darkness",
    "RequiredActiveMetaPointsMax":              "Max. current Darkness",
    "RequiredActiveMetaPointMax":               "Max. current Darkness",
    "RequiredActiveShrinePointsMin":            "Min. current Heat",
    "RequiredLifetimeResourcesGainedMin":       "Min. lifetime resource gained",
    "RequiredLifetimeResourcesGainedMax":       "Max. lifetime resource gained",
    "RequiredLifetimeResourcesSpentMin":        "Min. lifetime resource spent",
    "RequiredLifetimeResourcesSpentMax":        "Max. lifetime resource spent",
    "RequiredResourcesMin":                     "Min. current resources",

    # ----- Meta progression (Mirror of Night / Pact of Punishment) -----
    "RequiredActiveMetaUpgrade":                "Mirror/Pact upgrade must be active",
    "RequiredMinActiveMetaUpgradeLevel":        "Min. Mirror/Pact upgrade level",
    "RequiredMaxActiveMetaUpgradeLevel":        "Max. Mirror/Pact upgrade level",
    "RequiredInactiveMetaUpgrade":              "Mirror/Pact upgrade must be inactive",
    "RequiredMetaUpgradeUnlocked":              "Mirror/Pact upgrade must be unlocked",
    "RequiredAllMetaUpgradesMaxed":             "All Mirror/Pact upgrades must be maxed",

    # ----- Played sound cues / special textline names -----
    "RequiredPlayed":                           "Sound cue must have played (ALL)",
    "RequiredAnyPlayedThisRun":                 "Sound cue must have played (ANY, this run)",
    "RequiredFalsePlayed":                      "Sound cue must NOT have played (ANY)",
    "RequiredFalsePlayedThisRoom":              "Sound cue must NOT have played (ANY, this room)",

    # ----- Ambient audio -----
    "RequiredAmbientTrackName":                 "Ambient music track must equal",
    "RequiredAmbientTrackNameMatch":            "Ambient music track must match",
    "RequiresAmbientMusicId":                   "Some ambient music must be playing",
    "RequiresNullAmbientMusicId":               "No ambient music must be playing",

    # ----- Codex -----
    "RequiredCodexEntry":                       "Codex entry must be unlocked",
    "RequiredCodexEntriesMin":                  "Min. Codex entries unlocked",
    "RequiresCodexFullyUnlocked":               "All Codex entries must be unlocked",

    # ----- Fishing -----
    "RequiredHasFish":                          "Must be carrying caught fish",
    "RequiresFishingPointInRoom":               "Current room must have fishing point",
    "RequiredMinTotalCaughtFish":               "Min. lifetime caught fish",
    "RequiredMinCaughtFishThisRun":             "Min. caught fish (this run)",
    "RequiredAnyCaughtFishTypes":               "Must have caught fish type (ANY)",

    # ----- Pickups / consumables -----
    "RequiredConsumablesThisRun":               "Min. consumables used (this run)",

    # ----- Screens / structural -----
    "RequiredScreenViewed":                     "Screen must have been opened",
    "RequiredScreenViewedFalse":                "Screen must NOT have been opened",
    "RequiresLinked":                           "Must play as a follow-up line",
    "RequiredTextLinesThis":                    "Unused engine field (typo)",
}


# Plain-English explanations shown as the second line of the hover
# tooltip on every ``otherRequirements`` row (the internal field name
# forms the first line, the blurb forms the second). Full coverage:
# every distinct ``otherRequirements`` key encountered in the merged
# H1 dataset gets an entry. Best-effort for the long tail - some
# blurbs are reasoned from the field name + sample values rather
# than verified against ``RequirementMethods.lua``.
#
# Wording conventions match HADES1_REQ_TYPE_TOOLTIPS: short
# (one or two sentences), present tense, no leading "This dialogue
# requires..." preamble (the viewer's context makes that implicit).
HADES1_OTHER_REQ_TOOLTIPS = {
    # ----- Flags -----
    "RequiredFalseFlags":
        "Every listed flag must be unset (nil or false) on GameState.Flags.",
    "RequiredTrueFlags":
        "Every listed flag must be set (truthy) on GameState.Flags.",

    # ----- NPC interactions -----
    "RequiredMinNPCInteractions":
        "The hero must have interacted with the named NPC at least N times across the save (per-NPC threshold map).",
    "RequiredMaxNPCInteractions":
        "The hero must have interacted with the named NPC at most N times across the save (per-NPC threshold map).",

    # ----- Room / biome / encounter (current) -----
    "RequiredRoom":
        "The current room name must match. Single value (the engine checks CurrentRun.CurrentRoom.Name).",
    "RequiredDeathRoom":
        "The hero's most recent death must have occurred in the named room.",
    "RequiredFalseDeathRoom":
        "The hero's most recent death must NOT have occurred in the named room.",
    "RequiredBiome":
        "The current room must be in the named biome (Tartarus / Asphodel / Elysium / Styx / Surface).",
    "RequiredFalseBiome":
        "The current room must NOT be in the named biome.",
    "RequiredMinBiomeDepth":
        "The current run must have reached at least the Nth room within the current biome.",
    "RequiredMaxBiomeDepth":
        "The current run must be no deeper than the Nth room within the current biome.",
    "RequiredMinDepth":
        "The current run must have visited at least N rooms in total.",
    "RequiredMaxDepth":
        "The current run must have visited at most N rooms in total.",
    "RequiredMinExits":
        "The current room must offer at least N exit doors.",

    # ----- Room / biome (history this/last run) -----
    "RequiredRoomThisRun":
        "The named room must have been entered during the current run.",
    "RequiredRoomLastRun":
        "The named room must have been entered during the previous run.",
    "RequiredFalseRoomLastRun":
        "The named room must NOT have been entered during the previous run.",
    "RequiredSeenRooms":
        "Every listed room must have been entered at some point in the save.",
    "RequiredFalseSeenRooms":
        "None of the listed rooms may have been entered at any point in the save.",
    "RequiredFalseSeenRoomThisRun":
        "The named room must NOT have been entered during the current run.",
    "RequiredFalseSeenRoomsThisRun":
        "None of the listed rooms may have been entered during the current run.",
    "RequiredAnyRoomsThisRun":
        "At least one of the listed rooms must have been entered during the current run.",
    "RequiredAnyRoomsLastRun":
        "At least one of the listed rooms must have been entered during the previous run.",
    "RequiredFalseRooms":
        "None of the listed rooms may have been entered (at any point).",
    "RequiredRooms":
        "Every listed room must have been entered.",
    "RequiredMinTimesSeenRoom":
        "The named room must have been entered at least N times across the save (per-room threshold map).",
    "RequiredMaxTimesSeenRoom":
        "The named room must have been entered at most N times across the save (per-room threshold map).",

    # ----- Encounters -----
    "RequiredSeenEncounter":
        "The named encounter must have been seen at least once in the save.",
    "RequiredEncounterThisRun":
        "The named encounter must have been completed during the current run.",
    "RequiredAnyEncountersThisRun":
        "At least one of the listed encounters must have been completed during the current run.",
    "RequiredAnyDeathEncounters":
        "The hero's most recent death must have occurred in one of the listed encounters.",
    "RequiredFalseDeathEncounters":
        "The hero's most recent death must NOT have occurred in any of the listed encounters.",

    # ----- Combat / kills -----
    "RequiredKills":
        "The hero must have killed at least N of the named enemy type across the save (per-unit threshold map).",
    "RequiredKillsThisRun":
        "Every listed enemy type must have been killed at least once during the current run.",
    "RequiredKillsLastRun":
        "Every listed enemy type must have been killed at least once during the previous run.",
    "RequiredAnyKillsThisRun":
        "At least one of the listed enemy types must have been killed during the current run.",
    "RequiredFalseKills":
        "None of the listed enemy types may have been killed (no kills of those types).",
    "RequiredMinTotalKills":
        "The hero must have killed at least N enemies in total across the save.",
    "RequiredLastKilledByUnits":
        "The hero's most recent death must have been caused by one of the listed unit types.",
    "RequiredLastKilledByWeaponNames":
        "The hero's most recent death must have been caused by damage from one of the listed weapon names.",
    "RequiredUnitAlive":
        "The named unit must currently be alive (present in the active room).",
    "RequiredUnitNotAlive":
        "The named unit must NOT currently be alive (absent, dead, or removed).",
    "RequiredBossPhase":
        "The current boss encounter must be in the named phase (1, 2, 3, ...).",

    # ----- Combat / damage / defiance -----
    "RequiredMaxHealthFraction":
        "The hero's current HP must be at most this fraction of their maximum HP.",
    "RequiredMaxLastStands":
        "The hero must have consumed at most N Death Defiance charges in the current run.",

    # ----- Loadout / weapons / traits / cosmetics -----
    "RequiredTrait":
        "The hero must currently have the named trait equipped.",
    "RequiredFalseTraits":
        "None of the listed traits may currently be equipped on the hero.",
    "RequiredOneOfTraits":
        "At least one of the listed traits must currently be equipped on the hero.",
    "RequiredCountOfTraits":
        "Companion to RequiredCountOfTraitsCount: a candidate set of traits whose currently-equipped count is compared against the threshold.",
    "RequiredCountOfTraitsCount":
        "Minimum number of traits from the RequiredCountOfTraits candidate set that must currently be equipped.",
    "RequiredTraitsTaken":
        "Every listed trait must have been taken at some point during the current run (whether or not it is still equipped).",
    "RequiredRunHasOneOfTraits":
        "At least one of the listed traits must have been taken at some point during the current run.",
    "RequiredKeepsake":
        "The hero must currently have the named keepsake equipped.",
    "RequiredAssistKeepsake":
        "The hero must currently have the named Companion (call) keepsake equipped.",
    "RequiresMaxKeepsake":
        "The currently equipped keepsake must be at its maximum level (gold-tier).",
    "RequiredWeapon":
        "The hero must currently have the named Infernal Arms equipped (e.g. SwordWeapon, BowWeapon).",
    "RequiredGodLoot":
        "The hero must have received at least one boon from the named god (e.g. ZeusUpgrade) during the current run.",
    "RequiredFalseGodLoot":
        "The hero must NOT have received any boons from the named god during the current run.",
    "RequiredFalseGodLoots":
        "The hero must NOT have received boons from any of the listed gods during the current run.",
    "RequiredLootChoices":
        "Minimum number of loot choices offered for the current pickup (used on multi-option boon screens to gate dialogue on the number of choices the player can see).",
    "RequiredLootThisRun":
        "The named loot type must have been picked up during the current run.",
    "RequiredNoGodBoons":
        "The hero must NOT have received any god boons during the current run.",
    "RequiredCosmetics":
        "Every listed House cosmetic must be owned by the player.",
    "RequiredAnyCosmetics":
        "At least one of the listed House cosmetics must be owned by the player.",
    "RequiredFalseCosmetics":
        "None of the listed House cosmetics may be owned by the player.",
    "RequiredMinAnyCosmetics":
        "At least N of the listed House cosmetics must be owned by the player.",
    "RequiredMaxAnyCosmetics":
        "At most N of the listed House cosmetics may be owned by the player.",
    "RequiredCosmeticItemVisible":
        "The named cosmetic item must currently be visible (placed and unhidden) in the House.",
    "RequiredCosmeticPurchaseable":
        "The named cosmetic must currently be available for purchase from the House contractor.",
    "RequiredSeenCosmeticPurchaseable":
        "The named cosmetic must have been seen (at least once) as an available purchase from the House contractor.",
    "RequiredFalseInteractionThisRun":
        "The named interaction (NPC dialogue prompt, item interact, etc.) must NOT have happened during the current run.",
    "RequiredSupportAINames":
        "At least one of the listed supporting enemies (Summons) must currently be equipped.",
    "RequiredFalseSupportAINames":
        "None of the listed supporting enemies (Summons) may currently be equipped.",
    "RequiredMaxSupportAINames":
        "At most N supporting enemies may currently be equipped.",
    "RequiredLastInteractedWeaponUpgrade":
        "The most recently interacted weapon-upgrade altar must have been the named aspect / hammer.",
    "RequiredLastInteractedWeaponUpgradeMaxed":
        "The most recently interacted weapon-upgrade altar must be at its maximum level.",
    "RequiredMinUnlockedWeaponEnchantments":
        "At least N weapon Aspects must currently be unlocked across all Infernal Arms.",
    "RequiredMaxUnlockedWeaponEnchantments":
        "At most N weapon Aspects may currently be unlocked across all Infernal Arms.",
    "RequiredWeaponsUnlocked":
        "Every listed Infernal Arms must currently be unlocked.",
    "RequiredFalseWeaponsUnlocked":
        "None of the listed Infernal Arms may currently be unlocked.",
    "RequiredAnyWeaponsUnlocked":
        "At least one of the listed Infernal Arms must currently be unlocked.",
    "RequiredMaxWeaponUpgrade":
        "The named weapon's currently chosen Aspect must be its base / default form.",
    "RequiredFalseMaxWeaponUpgrade":
        "The named weapon's currently chosen Aspect must NOT be its base / default form.",
    "RequiredMaxWeaponUpgradeIndex":
        "The named weapon's currently chosen Aspect must be at most index N within its upgrade table.",
    "RequiredFalseMaxWeaponUpgradeIndex":
        "The named weapon's currently chosen Aspect must NOT be at index N within its upgrade table.",
    "RequiredMinWeaponUpgrades":
        "The hero's current weapon must have received at least N hammer upgrades during the current run.",
    "RequiredMaxWeaponUpgrades":
        "The hero's current weapon must have received at most N hammer upgrades during the current run.",
    "RequiredMinWeaponKills":
        "The named Infernal Arms must have at least N lifetime kills attributed to it (per-weapon threshold map).",
    "RequiredMinRunsWithWeapons":
        "The named Infernal Arms must have been used in at least N completed runs (per-weapon threshold map).",
    "RequiredMaxRunsWithWeapons":
        "The named Infernal Arms must have been used in at most N completed runs (per-weapon threshold map).",
    "RequiredMinSuperLockKeysSpentOnWeapon":
        "The named Infernal Arms must have had at least N Titan Blood spent on its Aspect upgrades (per-weapon threshold map).",

    # ----- Run status -----
    "RequiresRunCleared":
        "The current run must have been cleared (boss defeated, escape achieved).",
    "RequiresRunNotCleared":
        "The current run must NOT yet have been cleared.",
    "RequiresLastRunCleared":
        "The previous run must have been cleared.",
    "RequiresLastRunNotCleared":
        "The previous run must NOT have been cleared.",
    "RequiresBestClearTimeLastRun":
        "The previous run must have set a new personal-best clear time.",
    "RequiredMinCompletedRuns":
        "The save must record at least N completed runs (whether cleared or not).",
    "RequiredMaxCompletedRuns":
        "The save must record at most N completed runs.",
    "RequiredCompletedRuns":
        "The save's completed-run count must equal N exactly.",
    "RequiredMinRunsCleared":
        "The save must record at least N runs that ended in a clear.",
    "RequiredMaxRunsCleared":
        "The save must record at most N runs that ended in a clear.",
    "RequiredRunsCleared":
        "The save's cleared-run count must equal N exactly.",
    "RequiredMinConsecutiveClears":
        "The save must record at least N consecutive cleared runs.",
    "RequiredMinElapsedTime":
        "The current run must have lasted at least N seconds of in-game time.",
    "RequiredMinBountiesEarned":
        "The save must record at least N completed bounties (Fated List).",
    "RequiredMinQuestsComplete":
        "The save must record at least N completed quests (Fated List of Minor Prophecies).",
    "RequiredMaxQuestsComplete":
        "The save must record at most N completed quests.",

    # ----- Meta progression -----
    "RequiredMinActiveMetaUpgradeLevel":
        "The named Mirror/Pact upgrade must currently be active at level >= N (record carries Count + Name).",
    "RequiredMaxActiveMetaUpgradeLevel":
        "The named Mirror/Pact upgrade must currently be active at level <= N (record carries Count + Name).",
    "RequiredActiveMetaUpgrade":
        "The named Mirror/Pact upgrade must currently be active (any level).",
    "RequiredInactiveMetaUpgrade":
        "The named Mirror/Pact upgrade must currently be inactive (other side of its pair is active, or upgrade unowned).",
    "RequiredMetaUpgradeUnlocked":
        "The named Mirror/Pact upgrade must have been unlocked (purchased at least once).",
    "RequiredAllMetaUpgradesMaxed":
        "Every Mirror/Pact upgrade must be at its maximum level.",
    "RequiredAccumulatedMetaPoints":
        "Lifetime Darkness accumulated must be at least N.",
    "RequiredActiveMetaPointsMin":
        "Currently-held Darkness must be at least N.",
    "RequiredActiveMetaPointsMax":
        "Currently-held Darkness must be at most N.",
    "RequiredActiveMetaPointMax":
        "Currently-held Darkness must be at most N (singular form used by a small number of entries).",

    # ----- Resources -----
    "RequiredActiveShrinePointsMin":
        "Currently-held Heat (Pact of Punishment shrine points) must be at least N.",
    "RequiredMinShrinePointThresholdClear":
        "The save must record at least N runs cleared at or above the named Heat threshold.",
    "RequiredResourcesMin":
        "Currently-held resources must meet the listed per-resource minimums (e.g. SuperLockKeys, GiftPoints).",
    "RequiredLifetimeResourcesGainedMin":
        "Lifetime gained amount of the named resource must be at least N (per-resource threshold map).",
    "RequiredLifetimeResourcesGainedMax":
        "Lifetime gained amount of the named resource must be at most N (per-resource threshold map).",
    "RequiredLifetimeResourcesSpentMin":
        "Lifetime spent amount of the named resource must be at least N (per-resource threshold map).",
    "RequiredLifetimeResourcesSpentMax":
        "Lifetime spent amount of the named resource must be at most N (per-resource threshold map).",
    "RequiredPurchasedWorldItemCountMin":
        "The save must record at least N House contractor purchases.",
    "RequiredPurchasedWorldItemCountMax":
        "The save must record at most N House contractor purchases.",

    # ----- Flags / Values (generic key-value game state) -----
    "RequiredValues":
        "Every listed GameState.Values entry must equal the given value (per-key map).",
    "RequiredFalseValues":
        "Every listed GameState.Values entry must NOT equal the given value (per-key map).",
    "RequiredMinValues":
        "Every listed GameState.Values entry must be at least the given threshold (per-key threshold map).",
    "RequiredNotActivatedThisRun":
        "The named interaction (by id) must NOT have been activated during the current run.",
    "RequiredIdsNotActivatedThisRun":
        "None of the listed interaction ids may have been activated during the current run.",

    # ----- Played / queued tail (some not in textline-set allowlist) -----
    "RequiredPlayed":
        "Every listed sound cue (/VO/...) or special textline name must have already played at some point in the save.",
    "RequiredFalsePlayed":
        "None of the listed sound cues / special textlines may have played at any point in the save.",
    "RequiredAnyPlayedThisRun":
        "At least one of the listed sound cues must have played during the current run.",
    "RequiredFalsePlayedThisRoom":
        "None of the listed sound cues may have played during the current room.",
    "RequiredTextLinesThis":
        "Looks like a typo of RequiredTextLinesThisRun; treated as a no-op by the engine. Reported here so the next maintainer can decide whether to alias-map it.",

    # ----- Audio / ambient -----
    "RequiredAmbientTrackNameMatch":
        "The currently playing ambient music track must match the dialogue's expected track name (true if the engine's current AmbientMusicId equals the row's named track).",
    "RequiredAmbientTrackName":
        "The currently playing ambient music track must equal the named id (e.g. /Music/OrpheusSong2).",
    "RequiresAmbientMusicId":
        "An ambient music track must currently be playing (any non-empty AmbientMusicId).",
    "RequiresNullAmbientMusicId":
        "No ambient music track may currently be playing (AmbientMusicId is nil or empty).",

    # ----- Linking / screens / misc -----
    "RequiresLinked":
        "The dialogue must be playing as a link (immediate follow-up to a previous line), not as a standalone cue.",
    "RequiredScreenViewed":
        "The named screen (e.g. WeaponUpgradeScreen) must have been opened at least once.",
    "RequiredScreenViewedFalse":
        "The named screen must NOT have been opened.",
    "RequiredConsumablesThisRun":
        "The hero must have used at least N consumables of the listed names during the current run.",
    "RequiredCodexEntry":
        "The named Codex entry must currently be unlocked (record carries EntryName + EntryIndex).",
    "RequiredCodexEntriesMin":
        "The save must record at least N unlocked Codex entries.",
    "RequiresCodexFullyUnlocked":
        "Every Codex entry must currently be unlocked.",
    "RequiredFalseConfigOptions":
        "Every listed config option must currently be disabled (e.g. EasyMode false).",
    "RequiredTrueConfigOptions":
        "Every listed config option must currently be enabled.",
    "RequiredUsedAssistInRoomThisRun":
        "The hero must have used a Companion call in the named room during the current run.",

    # ----- Fishing -----
    "RequiredHasFish":
        "The hero must currently be carrying at least one caught fish.",
    "RequiredMinCaughtFishThisRun":
        "At least N fish must have been caught during the current run.",
    "RequiredMinTotalCaughtFish":
        "Lifetime total caught fish must be at least N.",
    "RequiredAnyCaughtFishTypes":
        "At least one of the listed fish types must have been caught at some point in the save.",
    "RequiresFishingPointInRoom":
        "The current room must currently contain an active fishing point.",

    # ----- Misc -----
    "RequiredMinItemInteractions":
        "The hero must have interacted with the named item at least N times (per-item threshold map).",
}
