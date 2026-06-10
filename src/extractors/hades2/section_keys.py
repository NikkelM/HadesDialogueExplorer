"""Hardcoded allowlist of owner-level dialogue-set container keys for Hades II.

H2 ships substantially the same dialogue-set keys as H1 (with the
``GiftTextLineSets`` / ``RejectionTextLines`` / ``MakeUpTextLines`` /
``BoughtTextLines`` / ``DuoPickupTextLines`` family unchanged) plus a small
number of new ones (``CombatIntroTextLineSets``, ``DeathPresentationTextLineSets``,
``OnHitTextLineSets``, ``PostPortraitTextLines``, ``BathHouseIntroTextLines``)
that the H1 game didn't have.

H2 drops H1's priority-tier system entirely - there are no
``SuperPriorityXxxTextLineSets`` / ``PriorityXxxTextLineSets`` variants.
Priority is now ordinal, expressed via ``NarrativeData.lua`` priority lists
(see :mod:`.narrative_data`).

H2 also adds a parallel ``VoiceLines`` family (``OnHitVoiceLines``,
``InteractVoiceLines``, ``EncounterStartVoiceLines``, ~20 keys) for in-combat
barks like "Too slow!" / "Nope." Per project decision these are NOT
extracted - this tool surfaces narrative dialogues, not combat barks.

The allowlist was derived from a grep across every dialogue-bearing
``Content/Scripts/*.lua`` file (`NPCData*`, `RoomData*`, `LootData_*`,
`EnemyData*`, `DeathLoopData`, `EncounterData*`). Each key here corresponds
to a real owner-level container holding a map of
``textline_name -> textline_table``.
"""

HADES2_TEXTLINE_SECTION_KEYS = frozenset({
    # NPCData / per-character files - the workhorse interaction containers.
    "InteractTextLineSets",       # 256 occurrences - the vast majority
    "GiftTextLineSets",           # 38

    # LootData_<God> (boon owners) - dialogue sets per pickup context.
    "BoughtTextLines",            # 10 - god boon shop purchase
    "DuoPickupTextLines",         # 10 - duo boon pickup
    "MakeUpTextLines",            # 9 - "Trial of the Gods" completion (rename)
    "RejectionTextLines",         # 9 - "Trial of the Gods" displeased (rename)

    # EnemyData_<Boss> - boss encounter banter.
    "BossIntroTextLineSets",      # 9 (H2 rename of H1 BossPresentationIntroTextLineSets)
    "BossOutroTextLineSets",      # 5 (H2 rename of H1 BossPresentationOutroTextLineSets)
    "BossPhaseChangeTextLineSets",  # 2 (H2 rename of H1 BossPresentationNextStageTextLineSets)

    # NPCData / EnemyData - new combat/death dialogue containers.
    "CombatIntroTextLineSets",    # 1 - dialogue triggered at combat start
    "DeathPresentationTextLineSets",  # 2 - dialogue on player death
    "OnHitTextLineSets",          # 1 - story dialogue triggered by being hit
                                  # (distinct from OnHitVoiceLines which are barks)

    # Hub only.
    "PostPortraitTextLines",      # 1 - dialogue after a portrait reveal
    "BathHouseIntroTextLines",    # 1 - bath house intro
})


# Human-readable labels for each H2 owner-level section key. The viewer
# shows these in the search dropdown and the details view, with the
# internal key available as a tooltip. Where the dialogue contexts
# overlap with H1's vocabulary the labels mirror H1's for visual
# consistency in the merged graph.
HADES2_SECTION_KEY_LABELS = {
    "InteractTextLineSets":          "NPC interaction",
    "GiftTextLineSets":              "NPC gifting",
    "BoughtTextLines":               "God boon shop purchase",
    "DuoPickupTextLines":            "Duo boon pickup",
    "MakeUpTextLines":               "\"Trial of the Gods\" - Completion",
    "RejectionTextLines":            "\"Trial of the Gods\" - Displeased",
    "BossIntroTextLineSets":         "Boss introduction",
    "BossOutroTextLineSets":         "Boss outro",
    "BossPhaseChangeTextLineSets":   "Boss phase transition",
    "CombatIntroTextLineSets":       "Combat introduction",
    "DeathPresentationTextLineSets": "Death presentation",
    "OnHitTextLineSets":             "NPC interaction (on hit)",
    "PostPortraitTextLines":         "Post-portrait dialogue",
    "BathHouseIntroTextLines":       "Bath House introduction",
}
