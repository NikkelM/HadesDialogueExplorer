"""Constants for requirement field names."""

# Requirement field names that reference other textlines (dialogue dependencies)
TEXTLINE_REQ_FIELDS = {
    "RequiredTextLines",          # All must be completed
    "RequiredAnyTextLines",       # At least one must be completed
    "RequiredAnyOtherTextLines",  # At least one must be completed (different context)
    "RequiredFalseTextLines",     # None must be completed (blockers)
    "RequiredFalseQueuedTextLines",  # None must be queued (blockers)
    "RequiredFalseTextLinesThisRun",
    "RequiredFalseTextLinesLastRun",
    "RequiredTextLinesThisRun",
    "RequiredTextLinesLastRun",
    "RequiredAnyTextLinesThisRun",
    "RequiredAnyTextLinesLastRun",
}

# Known non-dialogue requirement fields to capture
NON_DIALOGUE_REQ_PATTERNS = [
    "RequiredRoomThisRun", "RequiredRoomLastRun",
    "RequiredAnyRoomsThisRun", "RequiredAnyRoomsLastRun",
    "RequiresRunCleared", "RequiresRunNotCleared",
    "RequiresLastRunCleared", "RequiresLastRunNotCleared",
    "RequiredMinRunsCleared", "RequiredMaxRunsCleared",
    "RequiredCosmetics", "RequiredFalseCosmetics",
    "RequiredMinNPCInteractions", "RequiredMaxNPCInteractions",
    "RequiredMinItemInteractions",
    "RequiredScreenViewed",
    "RequiredAmbientTrackNameMatch",
    "RequiresNullAmbientMusicId",
    "RequiredFalseFlags", "RequiredFlags",
    "RequiredFalseDeathRoom",
    "RequiredGiftLevel", "RequiredMinGiftLevel",
    "RequiredActiveMetaPointsMin",
    "RequiredFalseCosmeticPurchaseable",
    "RequiredMinCompletedRuns", "RequiredMaxCompletedRuns",
    "RequiredMinTimesCleared",
    "RequiredKills", "RequiredAnyKillsThisRun",
    "RequiredFalseTraits",
    "RequiredBiome",
    "RequiredSeenRoomThisRun",
    "RequiredAnyPlayed", "RequiredAnyPlayedThisRun",
]
