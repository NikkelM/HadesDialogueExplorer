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
    "RequiredValues":                           "GameState field must equal",
    "RequiredFalseValues":                      "GameState field must NOT equal",
    "RequiredMinValues":                        "Minimum GameState field value",
    "RequiredTrueConfigOptions":                "Game setting must be enabled (ALL)",
    "RequiredFalseConfigOptions":               "Game setting must be disabled (ALL)",

    # ----- NPC / item / interaction counts -----
    "RequiredMinNPCInteractions":               "Minimum NPC interactions",
    "RequiredMaxNPCInteractions":               "Maximum NPC interactions",
    "RequiredMinItemInteractions":              "Minimum item interactions",
    "RequiredFalseInteractionThisRun":          "Must NOT have interacted with (this run)",
    "RequiredNotActivatedThisRun":              "Interactable must NOT have activated (this run)",
    "RequiredIdsNotActivatedThisRun":           "Interactable must NOT have activated (ANY, this run)",

    # ----- Current room / biome -----
    "RequiredRoom":                             "Must be in room",
    "RequiredBiome":                            "Must be in biome",
    "RequiredFalseBiome":                       "Must NOT be in biome",
    "RequiredMinExits":                         "Minimum exits in current room",
    "RequiredMinBiomeDepth":                    "Minimum biome depth (this run)",
    "RequiredMaxBiomeDepth":                    "Maximum biome depth (this run)",
    "RequiredMinDepth":                         "Minimum rooms visited (this run)",
    "RequiredMaxDepth":                         "Maximum rooms visited (this run)",

    # ----- Room history (per-run / lifetime) -----
    "RequiredRoomThisRun":                      "Must have entered room (this run)",
    "RequiredRoomLastRun":                      "Must have entered room (last run)",
    "RequiredAnyRoomsThisRun":                  "Must have entered room (ANY, this run)",
    "RequiredAnyRoomsLastRun":                  "Must have entered room (ANY, last run)",
    "RequiredRooms":                            "Must be in room (ANY)",
    "RequiredSeenRooms":                        "Must have seen room (ALL)",
    "RequiredFalseSeenRoomThisRun":             "Must NOT have entered room (this run)",
    "RequiredFalseSeenRoomsThisRun":            "Must NOT have entered room (ANY, this run)",
    "RequiredFalseRoomLastRun":                 "Must NOT have entered room (last run)",
    "RequiredFalseRooms":                       "Must NOT be in room (ANY)",
    "RequiredFalseSeenRooms":                   "Must NOT have entered room (ANY)",
    "RequiredMinTimesSeenRoom":                 "Minimum room visits",
    "RequiredMaxTimesSeenRoom":                 "Maximum room visits",

    # ----- Encounters / boss phase -----
    "RequiredBossPhase":                        "Boss phase must equal",
    "RequiredSeenEncounter":                    "Must have seen encounter",
    "RequiredEncounterThisRun":                 "Must have seen encounter (this run)",
    "RequiredAnyEncountersThisRun":             "Must have seen encounter (ANY, this run)",

    # ----- Loadout: boons (engine name: Traits) -----
    "RequiredTrait":                            "Must have trait (boon or other upgrade) equipped",
    "RequiredOneOfTraits":                      "Must have trait (boon or other upgrade) equipped (ANY)",
    "RequiredFalseTraits":                      "Must NOT have trait (boon or other upgrade) equipped (ANY)",
    "RequiredCountOfTraits":                    "Boon candidate set",
    "RequiredCountOfTraitsCount":               "Minimum matching traits (boons or other upgrades) from set",
    "RequiredTraitsTaken":                      "Must have taken trait (boon or other upgrade) (ALL, across save)",
    "RequiredRunHasOneOfTraits":                "Must have taken trait (boon or other upgrade) (ANY, this run)",

    # ----- Loadout: god boons (engine name: GodLoot) -----
    "RequiredGodLoot":                          "Must have boon from god",
    "RequiredFalseGodLoot":                     "Must NOT have boon from god",
    "RequiredFalseGodLoots":                    "Must NOT have boon from god (ANY, this run)",
    "RequiredNoGodBoons":                       "Must have no god boons",
    "RequiredLootThisRun":                      "Must have boon from god",
    "RequiredLootChoices":                      "Number of shown boon options must equal",

    # ----- Loadout: weapons / Aspects / hammer upgrades -----
    "RequiredWeapon":                           "Must have weapon equipped",
    "RequiredWeaponsUnlocked":                  "Must have weapon unlocked (ALL)",
    "RequiredAnyWeaponsUnlocked":               "Must have weapon unlocked (ANY)",
    "RequiredFalseWeaponsUnlocked":             "Must NOT have weapon unlocked (ANY)",
    "RequiredMaxWeaponUpgrade":                 "Weapon Aspect must be fully upgraded",
    "RequiredFalseMaxWeaponUpgrade":            "Weapon Aspect must NOT be fully upgraded",
    "RequiredMaxWeaponUpgradeIndex":            "Weapon Aspect index to check",
    "RequiredFalseMaxWeaponUpgradeIndex":       "Weapon Aspect index to check",
    "RequiredLastInteractedWeaponUpgrade":      "Must have most recently interacted with Aspect",
    "RequiredLastInteractedWeaponUpgradeMaxed": "Most recently interacted Aspect must be at max level",
    "RequiredMinUnlockedWeaponEnchantments":    "Minimum total weapon Aspects unlocked",
    "RequiredMaxUnlockedWeaponEnchantments":    "Maximum total weapon Aspects unlocked",
    "RequiredMaxWeaponUpgrades":                "Maximum hammer upgrades",
    "RequiredMinWeaponUpgrades":                "Minimum hammer upgrades",
    "RequiredMinWeaponKills":                   "Minimum total kills with weapon",
    "RequiredMinRunsWithWeapons":               "Minimum runs completed with weapon",
    "RequiredMaxRunsWithWeapons":               "Maximum runs completed with weapon",
    "RequiredMinSuperLockKeysSpentOnWeapon":    "Minimum Titan Blood spent on weapon",

    # ----- Loadout: keepsakes -----
    "RequiredKeepsake":                         "Must have keepsake equipped",
    "RequiresMaxKeepsake":                      "Equipped keepsake must be at max level",
    "RequiredAssistKeepsake":                   "Must have companion equipped",

    # ----- Loadout: cosmetics (House contractor) -----
    "RequiredCosmetics":                        "Must own cosmetic (ALL)",
    "RequiredFalseCosmetics":                   "Must NOT own cosmetic (ANY)",
    "RequiredAnyCosmetics":                     "Must own cosmetic (ANY)",
    "RequiredMinAnyCosmetics":                  "Minimum cosmetics owned (from set)",
    "RequiredMaxAnyCosmetics":                  "Maximum cosmetics owned (from set)",
    "RequiredCosmeticItemVisible":              "Cosmetic must be visible",
    "RequiredCosmeticPurchaseable":             "Cosmetic must be purchaseable",
    "RequiredSeenCosmeticPurchaseable":         "Must have seen cosmetic being purchaseable",

    # ----- Loadout: supporting enemies (engine name: SupportAI) -----
    "RequiredSupportAINames":                   "Encounter must have additional Fury Sister (ALL)",
    "RequiredFalseSupportAINames":              "Encounter must NOT have additional Fury Sister (ANY)",
    "RequiredMaxSupportAINames":                "Maximum number of additional Fury Sisters in encounter",

    # ----- Combat / damage state -----
    "RequiredMaxHealthFraction":                "Maximum health fraction",
    "RequiredMaxLastStands":                    "Maximum Death Defiance charges remaining",
    "RequiredKills":                            "Minimum enemy kills",
    "RequiredKillsThisRun":                     "Must have killed enemy (ALL, this run)",
    "RequiredAnyKillsThisRun":                  "Must have killed enemy (ANY, this run)",
    "RequiredKillsLastRun":                     "Must have killed enemy (ANY, last run)",
    "RequiredFalseKills":                       "Must NOT have killed enemy (ANY)",
    "RequiredMinTotalKills":                    "Minimum lifetime kills",
    "RequiredLastKilledByUnits":                "Last killed by enemy (ANY)",
    "RequiredLastKilledByWeaponNames":          "Last killed by weapon (ANY)",
    "RequiredUnitNotAlive":                     "Character must NOT be alive",
    "RequiredUnitAlive":                        "Character must be alive",
    "RequiredUsedAssistInRoomThisRun":          "Must have used companion in room (this run)",

    # ----- Death history -----
    "RequiredDeathRoom":                        "Most recent death must be in room",
    "RequiredFalseDeathRoom":                   "Most recent death must NOT be in room",
    "RequiredAnyDeathEncounters":               "Most recent death must be in encounter (ANY)",
    "RequiredFalseDeathEncounters":             "Most recent death must NOT be in encounter (ANY)",

    # ----- Run status -----
    "RequiresRunCleared":                       "Current run cleared",
    "RequiresRunNotCleared":                    "Current run not cleared",
    "RequiresLastRunCleared":                   "Previous run cleared",
    "RequiresLastRunNotCleared":                "Previous run NOT cleared",
    "RequiresBestClearTimeLastRun":             "Previous run matched or beat best clear time",
    "RequiredCompletedRuns":                    "Completed runs must equal",
    "RequiredMinCompletedRuns":                 "Minimum completed runs",
    "RequiredMaxCompletedRuns":                 "Maximum completed runs",
    "RequiredRunsCleared":                      "Cleared runs must equal",
    "RequiredMinRunsCleared":                   "Minimum cleared runs",
    "RequiredMaxRunsCleared":                   "Maximum cleared runs",
    "RequiredMinConsecutiveClears":             "Minimum consecutive cleared runs",
    "RequiredMinShrinePointThresholdClear":     "Minimum Heat that has been cleared",
    "RequiredMinBountiesEarned":                "Minimum completed bounties",
    "RequiredMinQuestsComplete":                "Minimum cashed-out prophecies",
    "RequiredMaxQuestsComplete":                "Maximum cashed-out prophecies",
    "RequiredPurchasedWorldItemCountMin":       "Minimum completed store purchases (this room)",
    "RequiredPurchasedWorldItemCountMax":       "Maximum completed store purchases (this room)",

    # ----- Resources / counters -----
    "RequiredAccumulatedMetaPoints":            "Minimum lifetime collected Darkness",
    "RequiredActiveMetaPointsMin":              "Minimum Darkness invested in the Mirror of Night",
    "RequiredActiveMetaPointsMax":              "Maximum Darkness invested in the Mirror of Night",
    "RequiredActiveMetaPointMax":               "Maximum Darkness invested in the Mirror of Night",
    "RequiredActiveShrinePointsMin":            "Minimum currently active Heat",
    "RequiredLifetimeResourcesGainedMin":       "Minimum lifetime resources gained",
    "RequiredLifetimeResourcesGainedMax":       "Maximum lifetime resources gained",
    "RequiredLifetimeResourcesSpentMin":        "Minimum lifetime resources spent",
    "RequiredLifetimeResourcesSpentMax":        "Maximum lifetime resources spent",
    "RequiredResourcesMin":                     "Minimum current resources",

    # ----- Meta progression (Mirror of Night / Pact of Punishment) -----
    "RequiredActiveMetaUpgrade":                "Mirror/Pact upgrade must be active",
    "RequiredMinActiveMetaUpgradeLevel":        "Minimum Mirror/Pact upgrade level",
    "RequiredMaxActiveMetaUpgradeLevel":        "Maximum Mirror/Pact upgrade level",
    "RequiredInactiveMetaUpgrade":              "Mirror/Pact upgrade must be inactive",
    "RequiredMetaUpgradeUnlocked":              "Mirror/Pact upgrade must be unlocked",
    "RequiredAllMetaUpgradesMaxed":             "All Mirror upgrades must be maxed",

    # ----- Played sound cues / special textline names -----
    "RequiredPlayed":                           "Voiceline must have played (ALL)",
    "RequiredAnyPlayedThisRun":                 "Voiceline must have played (ANY, this run)",
    "RequiredFalsePlayed":                      "Voiceline must NOT have played (ANY)",
    "RequiredFalsePlayedThisRoom":              "Voiceline must NOT have played (ANY, this room)",

    # ----- Ambient audio -----
    "RequiredAmbientTrackName":                 "Ambient music track must equal",
    "RequiredAmbientTrackNameMatch":            "Ambient music track must match",
    "RequiresAmbientMusicId":                   "Ambient music must be playing",
    "RequiresNullAmbientMusicId":               "Ambient music must NOT be playing",

    # ----- Codex -----
    "RequiredCodexEntry":                       "Codex entry must be unlocked",
    "RequiredCodexEntriesMin":                  "Minimum Codex entries unlocked",
    "RequiresCodexFullyUnlocked":               "All Codex entries must be unlocked",

    # ----- Fishing -----
    "RequiredHasFish":                          "Must be carrying fish",
    "RequiresFishingPointInRoom":               "Current room must have fishing point",
    "RequiredMinTotalCaughtFish":               "Minimum lifetime caught fish",
    "RequiredMinCaughtFishThisRun":             "Minimum caught fish (this run)",
    "RequiredAnyCaughtFishTypes":               "Must have caught fish (ANY)",

    # ----- Pickups / consumables -----
    "RequiredConsumablesThisRun":               "Minimum consumables used (this run)",

    # ----- Screens / structural -----
    "RequiredScreenViewed":                     "Screen must have been opened",
    "RequiredScreenViewedFalse":                "Screen must NOT have been opened",
    "RequiredTextLinesThis":                    "Unused engine field (typo)",

    # ----- Non-Require eligibility gates (captured from IsGameStateEligible;
    #        these engine gates don't use the Require* naming) -----
    "ConsecutiveClearsOfRoom":                  "Minimum consecutive clears of a room",
    "ConsecutiveDeathsInRoom":                  "Minimum consecutive deaths in a room",
    "HasTraitNameInRoom":                       "Boon must be offered in current room",
    "ValuableUpgradeInRoom":                    "Boon offerings in the room must meet given rarities",
    "MinRunsSinceSquelchedHermes":              "Minimum runs since Hermes was silenced",
    "MaxRunsSinceSquelchedHermes":              "Maximum runs since Hermes was silenced",
    "ReachedShrineSoftCapWithAnyWeaponName":    "Reached Heat cap with any weapon",
    "ObjectivesCompleted":                      "Minimum objective completions",
    "ObjectiveCompletedLastOffer":              "Objective was completed the last time it was active",
    "AreIdsAlive":                              "Specific unit(s) must be alive",
    "AreIdsNotAlive":                           "Specific unit(s) must NOT be alive",
    "IsIdAlive":                                "Specific unit must be alive",
}


# Plain-English explanations shown as the second line of the hover
# tooltip on every ``otherRequirements`` row (the internal field name
# forms the first line, the blurb forms the second). Full coverage:
# every distinct ``otherRequirements`` key encountered in the merged
# H1 dataset gets an entry. The blurbs are verified against the engine's
# ``IsGameStateEligible`` (RunManager.lua) and its helpers, not inferred
# from the field name.
#
# Wording conventions match HADES1_REQ_TYPE_TOOLTIPS: short
# (one or two sentences), present tense, no leading "This dialogue
# requires..." preamble (the viewer's context makes that implicit).
HADES1_OTHER_REQ_TOOLTIPS = {
    # ----- Flags -----
    "RequiredFalseFlags":
        "Every listed flag must be unset on GameState.Flags.",
    "RequiredTrueFlags":
        "Every listed flag must be set on GameState.Flags.",

    # ----- NPC interactions -----
    "RequiredMinNPCInteractions":
        "The player must have interacted with the NPC at least N times in total.",
    "RequiredMaxNPCInteractions":
        "The player must have interacted with the NPC at most N times in total.",

    # ----- Room / biome / encounter (current) -----
    "RequiredRoom":
        "The player must be in the named room.",
    "RequiredDeathRoom":
        "The player's most recent run must have ended with a death in the named room.",
    "RequiredFalseDeathRoom":
        "If the current run was not cleared, it must NOT have ended with a death in the named room.",
    "RequiredBiome":
        "The current room must be in the named biome.",
    "RequiredFalseBiome":
        "The current room must NOT be in the named biome.",
    "RequiredMinBiomeDepth":
        "The player must have reached at least the Nth room within the current biome.",
    "RequiredMaxBiomeDepth":
        "The player must have reached no more than the Nth room within the current biome.",
    "RequiredMinDepth":
        "The player must have visited at least N rooms in this run.",
    "RequiredMaxDepth":
        "The player must have visited fewer than N rooms in this run.",
    "RequiredMinExits":
        "The current room must offer at least N exits.",

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
        "The current room must NOT be one of the named rooms.",
    "RequiredRooms":
        "The current room must be one of the named rooms.",
    "RequiredMinTimesSeenRoom":
        "The named room must have been entered at least N times across the save.",
    "RequiredMaxTimesSeenRoom":
        "The named room must have been entered at most N times across the save.",

    # ----- Encounters -----
    "RequiredSeenEncounter":
        "The named encounter must have been seen at least once in the save.",
    "RequiredEncounterThisRun":
        "The named encounter must have occurred during the current run.",
    "RequiredAnyEncountersThisRun":
        "At least one of the listed encounters must have been completed during the current run.",
    "RequiredAnyDeathEncounters":
        "The player's most recent run must have ended with a death during one of the listed encounters.",
    "RequiredFalseDeathEncounters":
        "The player's most recent run must NOT have ended with a death during one of the listed encounters.",

    # ----- Combat / kills -----
    "RequiredKills":
        "The player must have killed at least N of the named enemy type across the save.",
    "RequiredKillsThisRun":
        "Any of the listed enemy types must have been killed during the current run.",
    "RequiredKillsLastRun":
        "Any of the listed enemy types must have been killed during the previous run.",
    "RequiredAnyKillsThisRun":
        "At least one of the listed enemy types must have been killed during the current run.",
    "RequiredFalseKills":
        "None of the listed enemy types may have been killed at any point in the save.",
    "RequiredMinTotalKills":
        "The player must have killed at least N enemies in total across the save.",
    "RequiredLastKilledByUnits":
        "The player's most recent death must have been caused by one of the listed enemy types.",
    "RequiredLastKilledByWeaponNames":
        "The player's most recent death must have been caused by one of the listed sources of damage.",
    "RequiredUnitAlive":
        "The named enemy or character must be alive or present.",
    "RequiredUnitNotAlive":
        "The named enemy or character must NOT be alive or present.",
    "RequiredBossPhase":
        "The current boss encounter must be in the named phase.",

    # ----- Combat / damage / defiance -----
    "RequiredMaxHealthFraction":
        "The player's current HP must be at most this fraction of their maximum HP.",
    "RequiredMaxLastStands":
        "The player must have at most N Death Defiance charges remaining in the current run.",

    # ----- Loadout / weapons / traits / cosmetics -----
    "RequiredTrait":
        "The player must have the named trait (boon or other upgrade) equipped.",
    "RequiredFalseTraits":
        "The player must NOT have any of the listed traits (boon or other upgrade) equipped.",
    "RequiredOneOfTraits":
        "The player must have at least one of the listed traits (boon or other upgrade) equipped.",
    "RequiredCountOfTraits":
        "Companion to RequiredCountOfTraitsCount: a candidate set of traits (boon or other upgrade) whose currently-equipped count is compared against the threshold.",
    "RequiredCountOfTraitsCount":
        "Companion to RequiredCountOfTraits: the minimum number of traits (boon or other upgrade) from the candidate set that must be equipped.",
    "RequiredTraitsTaken":
        "Every listed trait (boon or other upgrade) must have been equipped at some point across the save.",
    "RequiredRunHasOneOfTraits":
        "At least one of the listed traits (boon or other upgrade) must have been equipped at some point during the current run.",
    "RequiredKeepsake":
        "The player must have the named keepsake equipped.",
    "RequiredAssistKeepsake":
        "The player must have the named companion equipped.",
    "RequiresMaxKeepsake":
        "The currently equipped keepsake must be at its maximum level.",
    "RequiredWeapon":
        "The player must have the named weapon equipped.",
    "RequiredGodLoot":
        "The player must have at least one boon from the named god equipped.",
    "RequiredFalseGodLoot":
        "The player must NOT have received any boons from the named god during the current run.",
    "RequiredFalseGodLoots":
        "The player must NOT have received boons from any of the listed gods during the current run.",
    "RequiredLootChoices":
        "The number of loot choices offered for the current pickup must equal this value.",
    "RequiredLootThisRun":
        "The player must have at least one boon from the named god equipped.",
    "RequiredNoGodBoons":
        "The player must NOT have any god boons equipped.",
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
        "The named cosmetic must currently be equipped.",
    "RequiredCosmeticPurchaseable":
        "The named cosmetic must currently be available for purchase from the House contractor.",
    "RequiredSeenCosmeticPurchaseable":
        "The named cosmetic must have been seen as an available purchase from the House contractor.",
    "RequiredFalseInteractionThisRun":
        "The player may NOT have interacted with the named NPC during the current run.",
    "RequiredSupportAINames":
        "The listed Fury Sisters must be active in the current fight.",
    "RequiredFalseSupportAINames":
        "None of the listed Fury Sisters may be active in the current fight.",
    "RequiredMaxSupportAINames":
        "At most N additional Fury Sisters may be active in the current fight.",
    "RequiredLastInteractedWeaponUpgrade":
        "The most recently interacted with weapon must have been the named Aspect.",
    "RequiredLastInteractedWeaponUpgradeMaxed":
        "The most recently interacted with weapon Aspect must be at its maximum level.",
    "RequiredMinUnlockedWeaponEnchantments":
        "At least N weapon Aspects must be unlocked.",
    "RequiredMaxUnlockedWeaponEnchantments":
        "At most N weapon Aspects may be unlocked.",
    "RequiredWeaponsUnlocked":
        "Every listed weapon must be unlocked.",
    "RequiredFalseWeaponsUnlocked":
        "None of the listed weapons may be unlocked.",
    "RequiredAnyWeaponsUnlocked":
        "At least one of the listed weapons must be unlocked.",
    "RequiredMaxWeaponUpgrade":
        "Companion to RequiredMaxWeaponUpgradeIndex: the named weapon's Aspect at the paired index must be fully upgraded.",
    "RequiredFalseMaxWeaponUpgrade":
        "Companion to RequiredFalseMaxWeaponUpgradeIndex: the named weapon's Aspect at the paired index must NOT be fully upgraded.",
    "RequiredMaxWeaponUpgradeIndex":
        "Companion to RequiredMaxWeaponUpgrade: which Aspect slot of the named weapon to test for being fully upgraded.",
    "RequiredFalseMaxWeaponUpgradeIndex":
        "Companion to RequiredFalseMaxWeaponUpgrade: which Aspect slot of the named weapon to test for NOT being fully upgraded.",
    "RequiredMinWeaponUpgrades":
        "The player must have picked up at least N hammer upgrades during the current run.",
    "RequiredMaxWeaponUpgrades":
        "The player must have picked up at most N hammer upgrades during the current run.",
    "RequiredMinWeaponKills":
        "The player must have at least N lifetime kills with the named weapon.",
    "RequiredMinRunsWithWeapons":
        "The named weapon must have been used in at least N runs.",
    "RequiredMaxRunsWithWeapons":
        "The named weapon must have been used in at most N runs.",
    "RequiredMinSuperLockKeysSpentOnWeapon":
        "The named weapon must have had at least N Titan Blood spent on its Aspect upgrades.",

    # ----- Run status -----
    "RequiresRunCleared":
        "The current/most recent run must have been cleared.",
    "RequiresRunNotCleared":
        "The current/most recent run must NOT have been cleared.",
    "RequiresLastRunCleared":
        "The previous run must have been cleared.",
    "RequiresLastRunNotCleared":
        "The previous run must NOT have been cleared.",
    "RequiresBestClearTimeLastRun":
        "The previous run must have been cleared and set a new personal-best clear time.",
    "RequiredMinCompletedRuns":
        "The player must have completed at least N runs (whether cleared or not).",
    "RequiredMaxCompletedRuns":
        "The player must have completed at most N runs (whether cleared or not).",
    "RequiredCompletedRuns":
        "The player must have completed exactly N runs (whether cleared or not).",
    "RequiredMinRunsCleared":
        "The player must have cleared at least N runs.",
    "RequiredMaxRunsCleared":
        "The player must have cleared at most N runs.",
    "RequiredRunsCleared":
        "The player must have cleared exactly N runs.",
    "RequiredMinConsecutiveClears":
        "The player must have cleared at least N consecutive runs.",
    "RequiredMinBountiesEarned":
        "The player must have earned at least N Pact of Punishment bounty rewards.",
    "RequiredMinQuestsComplete":
        "At least N Fated List prophecies must have been cashed out (completed and redeemed).",
    "RequiredMaxQuestsComplete":
        "At most N Fated List prophecies may have been cashed out (completed and redeemed).",

    # ----- Meta progression -----
    "RequiredMinActiveMetaUpgradeLevel":
        "The named Mirror/Pact upgrade must currently be active at level >= N.",
    "RequiredMaxActiveMetaUpgradeLevel":
        "The named Mirror/Pact upgrade must currently be active at level <= N.",
    "RequiredActiveMetaUpgrade":
        "The named Mirror/Pact upgrade must currently be active.",
    "RequiredInactiveMetaUpgrade":
        "The named Mirror/Pact upgrade must currently be inactive.",
    "RequiredMetaUpgradeUnlocked":
        "The named Mirror/Pact upgrade must be unlocked.",
    "RequiredAllMetaUpgradesMaxed":
        "Every Mirror of Night upgrade must be at its maximum level.",
    "RequiredAccumulatedMetaPoints":
        "Lifetime Darkness accumulated must be at least N.",
    "RequiredActiveMetaPointsMin":
        "Darkness currently invested in the Mirror of Night must be at least N.",
    "RequiredActiveMetaPointsMax":
        "Darkness currently invested in the Mirror of Night must be at most N.",
    "RequiredActiveMetaPointMax":
        "Typo of RequiredActiveMetaPointsMax - the game never checks this field.",

    # ----- Resources -----
    "RequiredActiveShrinePointsMin":
        "Currently active Heat must be at least N.",
    "RequiredMinShrinePointThresholdClear":
        "The highest Heat ever cleared must be at least N.",
    "RequiredResourcesMin":
        "Currently-held resources must meet the listed per-resource minimums.",
    "RequiredLifetimeResourcesGainedMin":
        "Lifetime obtained amount of the named resource must be at least N.",
    "RequiredLifetimeResourcesGainedMax":
        "Lifetime obtained amount of the named resource must be at most N.",
    "RequiredLifetimeResourcesSpentMin":
        "Lifetime spent amount of the named resource must be at least N.",
    "RequiredLifetimeResourcesSpentMax":
        "Lifetime spent amount of the named resource must be at most N.",
    "RequiredPurchasedWorldItemCountMin":
        "At least N items must have been purchased in the current room.",
    "RequiredPurchasedWorldItemCountMax":
        "At most N items must have been purchased in the current room.",

    # ----- Flags / Values (generic key-value game state) -----
    "RequiredValues":
        "Every listed key must equal the given value in the save's GameState.",
    "RequiredFalseValues":
        "None of the listed keys may be equal to the given value in the save's GameState.",
    "RequiredMinValues":
        "Every listed key must be at least the given value in the save's GameState.",
    "RequiredNotActivatedThisRun":
        "The named interactable ID must NOT have been activated during the current run.",
    "RequiredIdsNotActivatedThisRun":
        "None of the listed interactable IDs may have been activated during the current run.",

    # ----- Played / queued tail (some not in textline-set allowlist) -----
    "RequiredPlayed":
        "Every listed voiceline must have already played at some point in the save.",
    "RequiredFalsePlayed":
        "None of the listed voicelines may have played at any point in the save.",
    "RequiredAnyPlayedThisRun":
        "At least one of the listed voicelines must have played during the current run.",
    "RequiredFalsePlayedThisRoom":
        "None of the listed voicelines may have played during the current room.",
    "RequiredTextLinesThis":
        "Typo of RequiredTextLinesThisRun - the game never checks this field.",

    # ----- Audio / ambient -----
    "RequiredAmbientTrackNameMatch":
        "The currently playing ambient music track must match a specified track name expected by the dialogue.",
    "RequiredAmbientTrackName":
        "The currently playing ambient music track must equal the named track.",
    "RequiresAmbientMusicId":
        "Any ambient music track must currently be playing.",
    "RequiresNullAmbientMusicId":
        "No ambient music track may currently be playing.",

    # ----- Linking / screens / misc -----
    "RequiredScreenViewed":
        "The named UI screen must have been opened at least once in the save.",
    "RequiredScreenViewedFalse":
        "The named UI screen must NOT have been opened in the save.",
    "RequiredConsumablesThisRun":
        "The player must have used at least N consumables of the listed names during the current run.",
    "RequiredCodexEntry":
        "The named Codex entry must be unlocked.",
    "RequiredCodexEntriesMin":
        "At least N Codex entries must be unlocked.",
    "RequiresCodexFullyUnlocked":
        "All Codex entries must be unlocked.",
    "RequiredFalseConfigOptions":
        "All listed config options (game settings) must be disabled.",
    "RequiredTrueConfigOptions":
        "All listed config options (game settings) must be enabled.",
    "RequiredUsedAssistInRoomThisRun":
        "The player must have used a companion in the named room during the current run.",

    # ----- Fishing -----
    "RequiredHasFish":
        "The player must be carrying at least one fish.",
    "RequiredMinCaughtFishThisRun":
        "At least N fish must have been caught during the current run.",
    "RequiredMinTotalCaughtFish":
        "At least N fish in total must have been caught in the save.",
    "RequiredAnyCaughtFishTypes":
        "At least one of the listed fish types must have been caught at some point in the save.",
    "RequiresFishingPointInRoom":
        "The current room must contain a fishing point.",

    # ----- Misc -----
    "RequiredMinItemInteractions":
        "The player must have interacted with the named object at least N times.",

    # ----- Non-Require eligibility gates (captured from IsGameStateEligible) -----
    "ConsecutiveClearsOfRoom":
        "The player must have cleared the named room across at least N "
        "consecutive recent runs.",
    "ConsecutiveDeathsInRoom":
        "The player must have died in the named room across at least N "
        "consecutive recent runs.",
    "HasTraitNameInRoom":
        "The named boon must be offered in the current room. Not part of "
        "the save file.",
    "ValuableUpgradeInRoom":
        "The boons currently offered in this room must meet the listed rarity thresholds. "
        "Read from the live reward being offered, so a save can't confirm it.",
    "MinRunsSinceSquelchedHermes":
        "Hermes must have be silenced at least N runs ago.",
    "MaxRunsSinceSquelchedHermes":
        "Hermes must have be silenced within the last N runs.",
    "ReachedShrineSoftCapWithAnyWeaponName":
        "With at least one weapon, all available bounties at the Pact of Punishment "
        "must have been completed.",
    "ObjectivesCompleted":
        "The named objective must have been completed at least Min, or at most "
        "Max, times on record (GameState.ObjectivesCompleted).",
    "ObjectiveCompletedLastOffer":
        "The named objective must have been completed the last time it was active.",
    "AreIdsAlive":
        "Every listed unit id must currently be alive - live combat state a "
        "save can't provide.",
    "AreIdsNotAlive":
        "None of the listed unit ids may currently be alive - live combat "
        "state a save can't provide.",
    "IsIdAlive":
        "The listed unit id must currently be alive - live combat state a "
        "save can't provide.",
}
