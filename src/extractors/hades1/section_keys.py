"""Hardcoded allowlist of owner-level textline-set container keys for Hades 1.

Each entry here is a Lua key under an owner table (NPC, enemy, boon, inspect
point, ...) whose value is a map of ``textline_name -> textline_table`` that
the parser should extract.

The allowlist is hardcoded (rather than pattern-matched by suffix) because:
  - the games are complete, so the set is finite and stable;
  - pattern matching would silently accept new key names that don't fit
    the dialogue-set shape OR silently miss any container that doesn't
    follow the pattern - both are worse than an explicit list.

When adding a Hades II equivalent, define ``HADES2_TEXTLINE_SECTION_KEYS``
in the corresponding ``hades2/section_keys.py`` module and thread it through
the H2 extractors the same way the H1 ones do.
"""

HADES1_TEXTLINE_SECTION_KEYS = frozenset({
    # NPCData / EnemyData / DeathLoopData - common per-owner sets.
    "InteractTextLineSets",
    "GiftTextLineSets",
    "RepeatableTextLineSets",

    # EnemyData (and some NPCData entries) - boss encounter banter variants.
    "BossPresentationTextLineSets",
    "BossPresentationIntroTextLineSets",
    "BossPresentationPriorityIntroTextLineSets",
    "BossPresentationSuperPriorityIntroTextLineSets",
    "BossPresentationNextStageTextLineSets",
    "BossPresentationOutroTextLineSets",
    "BossPresentationOutroRepeatableTextLineSets",
    "BossPresentationRepeatableTextLineSets",
    "OnDeathTextLineSets",

    # LootData (boon owners) - dialogue sets per pickup context.
    "PickupTextLineSets",
    "PriorityPickupTextLineSets",
    "SuperPriorityPickupTextLineSets",
    "DuoPickupTextLineSets",
    "BoughtTextLines",        # plural-without-Sets variant
    "MakeUpTextLines",        # plural-without-Sets variant
    "RejectionTextLines",     # plural-without-Sets variant

    # DeathLoopData - inspect points / unlocks / trophy events.
    "OnUsedTextLineSets",
    "OnTrophyRevealedTextLineSets",
    "OnTrophyUnlockedTextLineSets",
    "TextLineSet",            # singular form, used inside distance triggers
                              # and inside EncounterData encounter events

    # RoomData* - boon-tied forced dialogue on specific rooms (Hades 1).
    "ForcedTextLines",
})

# Human-readable labels for each owner-level section key. The viewer shows
# these in the search dropdown and the details view (with the internal key
# available as a tooltip). The build pipeline audits this map against
# ``HADES1_TEXTLINE_SECTION_KEYS`` so any newly-allowlisted key without a
# friendly name surfaces as a warning rather than silently rendering as
# the raw camelCase key.
#
# Note: many keys share the same display label by design - e.g. all the
# boss-intro variants collapse to "Boss introduction" because the
# user-facing distinction (super-priority, etc.) is an internal sorting
# concern, not something the player would categorise differently.
HADES1_SECTION_KEY_LABELS = {
    "InteractTextLineSets":                          "NPC interaction",
    "GiftTextLineSets":                              "NPC gifting",
    "RepeatableTextLineSets":                        "NPC interaction (repeatable)",
    "BossPresentationTextLineSets":                  "Boss introduction",
    "BossPresentationIntroTextLineSets":             "Boss introduction",
    "BossPresentationPriorityIntroTextLineSets":     "Boss introduction",
    "BossPresentationSuperPriorityIntroTextLineSets": "Boss introduction",
    "BossPresentationRepeatableTextLineSets":        "Boss introduction (repeatable)",
    "BossPresentationNextStageTextLineSets":         "Boss phase transition",
    "BossPresentationOutroTextLineSets":             "Boss outro",
    "BossPresentationOutroRepeatableTextLineSets":   "Boss outro (repeatable)",
    "OnDeathTextLineSets":                           "NPC interaction",
    "PickupTextLineSets":                            "God boon pickup",
    "PriorityPickupTextLineSets":                    "God boon pickup",
    "SuperPriorityPickupTextLineSets":               "God boon pickup",
    "DuoPickupTextLineSets":                         "Duo boon pickup",
    "BoughtTextLines":                               "God boon shop purchase",
    "MakeUpTextLines":                               "\"Trial of the Gods\" - Completion",
    "RejectionTextLines":                            "\"Trial of the Gods\" - Displeased",
    "OnUsedTextLineSets":                            "Misc. interaction",
    "OnTrophyRevealedTextLineSets":                  "NPC interaction",
    "OnTrophyUnlockedTextLineSets":                  "NPC interaction",
    "TextLineSet":                                   "Misc. interaction",
    "ForcedTextLines":                               "Forced room dialogue",
}

# Section-tier narrative priority. Section names ending in
# `SuperPriorityXxxTextLineSets` map to `"super"`; `PriorityXxxTextLineSets`
# map to `"priority"`. The boss-intro cascade also has a strictly-lower
# fallback (`BossPresentationTextLineSets`, no "Intro" qualifier) which
# the engine consults only after the entire intro chain is exhausted -
# captured here as `"low"`. Engine call sites cascade super -> priority
# -> plain-intro -> low. See e.g. `RoomEvents.lua:1794-1802` and
# `Interactables.lua:785-789` in Hades 1.
HADES1_SECTION_KEY_PRIORITY_TIER = {
    "SuperPriorityPickupTextLineSets":                "super",
    "BossPresentationSuperPriorityIntroTextLineSets": "super",
    "PriorityPickupTextLineSets":                     "priority",
    "BossPresentationPriorityIntroTextLineSets":      "priority",
    "BossPresentationTextLineSets":                   "low",
}
