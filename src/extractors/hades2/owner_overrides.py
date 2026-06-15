"""Shared owner-override constants for Hades II extractors.

Both :mod:`.encounter_room_data` and :mod:`.deathloop_data` walk trees
that may contain mixed-speaker ``xWithY`` dialogues or polyphonic
narrative beats embedded inside event ``Args.TextLineSet`` blocks.
Routing each such textline to its natural NPC owner is a cross-source
concern, so the override tables live here rather than in either
extractor module - this keeps a single source of truth and lets
:mod:`.deathloop_data` apply the same rerouting without creating a
circular import against :mod:`.encounter_room_data`.

See those modules' docstrings for the routing rationale per entry.
"""


# Canonical speaker id for the hub narrator. Matches the registered
# ``Speaker_Homer`` entry in :data:`HADES2_SPEAKERS`. Used both as the
# fallback owner for ``InspectPoints`` content (idmap collapse) and as
# the routing target for the narrator-only flashback prologue.
HUB_NARRATOR_SPEAKER = "Speaker_Homer"


# Per-textline-name owner overrides. Applied post-extraction to re-route
# textlines onto a target owner (typically a real NPC speaker id) so
# they sit alongside that character's NPCData / LootData / EnemyData
# lines after the cross-source merge. See
# :mod:`.encounter_room_data` for the full rationale.
TEXTLINE_OWNER_OVERRIDES = {
    # Q_Story01 ObstacleData - boon-exit prompts initiated by Melinoë
    # (every set opens with a ``MelinoeField_*`` line on
    # ``UsePlayerSource = true``; Hecate is a respondent). The
    # ObstacleData's ``SpeakerName = "Hecate"`` is the in-world boon
    # vendor tag, not the line owner.
    "PalaceBoonExit01":                  {"owner": "PlayerUnit"},
    "PalaceBoonExitTyphonDestroyed01":   {"owner": "PlayerUnit"},
    "PalaceBoonExitPostTrueEnding01":    {"owner": "PlayerUnit"},
    "PalaceBoonExit02":                  {"owner": "PlayerUnit"},
    "PalaceBoonExitRepeatable01":        {"owner": "PlayerUnit"},
    "PalaceBoonExitRepeatable02":        {"owner": "PlayerUnit"},
    "PalaceBoonExitRepeatable03":        {"owner": "PlayerUnit"},

    # EncounterData_Story.lua xWith pairs
    "NemesisWithNarcissus01":            {"owner": "NPC_Nemesis_01", "partner": "NPC_Narcissus_01"},
    "NemesisWithNarcissus02":            {"owner": "NPC_Nemesis_01", "partner": "NPC_Narcissus_01"},
    "HecateWithArachne01":               {"owner": "NPC_Hecate_01",  "partner": "NPC_Arachne_01"},

    # DeathLoopData.lua flashback pair.
    "HadesWithHecate01":                 {"owner": "NPC_LordHades_01", "partner": "NPC_Hecate_01"},

    # Narrator-only flashback prologue.
    "HecateHideAndSeekIntro01":          {"owner": HUB_NARRATOR_SPEAKER},

    # Polyphonic true-ending beats - routed to the speaker who opens
    # the set (the cue with the lowest index that carries an explicit
    # ``Source`` / ``Speaker``):
    #   * ``TrueEnding01`` - climactic Chronos-fight resolution opened
    #     by Hecate.
    #   * ``TrueEnding02`` - family reunion opened by Persephone
    #     ("Melinoë...! You're... you're all grown up?").
    #   * ``TrueEndingFinale01`` - Selene-Chronos credit-roll exchange
    #     opened by Selene ("...we have arrived at our initial
    #     destination, everyone.").
    "TrueEnding01":                      {"owner": "NPC_Hecate_01"},
    "TrueEnding02":                      {"owner": "NPC_Persephone_01"},
    "TrueEndingFinale01":                {"owner": "NPC_Selene_01"},
}


# Parent-name keys that trigger ``InspectPoints``-style idmap collapse:
# any idmap segment whose parent has one of these names collapses its
# contained textlines to the narrator (Homer) regardless of which
# encounter / room the path is in.
IDMAP_PARENT_OWNER_OVERRIDES = {
    "InspectPoints": HUB_NARRATOR_SPEAKER,
}
