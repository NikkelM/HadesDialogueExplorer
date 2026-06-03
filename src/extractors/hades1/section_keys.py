"""Hardcoded allowlist of owner-level textline-set container keys for Hades 1.

Each entry here is a Lua key under an owner table (NPC, enemy, boon, inspect
point, ...) whose value is a map of ``textline_name -> textline_table`` that
the parser should extract.

The allowlist is hardcoded (rather than pattern-matched by suffix) because:
  - the games are complete, so the set is finite and stable;
  - pattern matching would silently accept new key names introduced by a
    future update OR silently miss any container that doesn't follow the
    pattern - both are worse than a hardcoded list that surfaces gaps
    explicitly via ``audit_textline_section_keys``.

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
})
