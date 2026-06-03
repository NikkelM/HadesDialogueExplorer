"""
Hardcoded categorization of Hades 1 textline references that are present in
the source data but have no matching definition.

The pipeline (``build_viewer.py``) audits this list against the set of refs
that the parser computed as unresolved. Drift in either direction prints a
warning:
  - An entry here that the parser already resolves -> remove it (likely
    fixed by a recent parser change or a new source file).
  - An unresolved ref the parser found that isn't in this list -> triage
    and add it with a category and brief reason.

Categories (the viewer renders these with distinct colors and an inline
explanation):

  back-compatibility
      Source explicitly retains the ref for save-file or version
      compatibility - typically a cut/renamed event whose old name is
      still checked in RequiredFalseTextLines to avoid replaying it.

  typo-or-bug
      The ref is a clear typo, convention drift, or game-data bug (e.g.
      missing underscore, extra digit, or an owner-name used as a flag
      in place of the standard ``<X>FirstPickUp`` pattern).

  cut-content
      The referenced textline was planned but never made it into the
      final game data. May appear in RequiredFalseTextLines (harmless,
      requirement trivially satisfied) or in positive RequiredTextLines
      (the referencing textline can therefore never play).
"""

HADES1_KNOWN_UNRESOLVED_REFS = {
    # --- back-compatibility (3) ---
    "Fury3SisterUnionWithMeg02": {
        "category": "back-compatibility",
        "reason": "Event was originally named Fury3 then renamed to Fury2; "
                  "the old name is still checked (see explicit comment in "
                  "EnemyData.lua).",
    },
    "FuryFirstAppearanceFirstRun": {
        "category": "back-compatibility",
        "reason": "Definition was removed when the QuestLog system was added "
                  "(per block-comment dated 2019-11-23 in EnemyData.lua); "
                  "the ref is retained.",
    },
    "PatroclusAboutAchilles01C": {
        "category": "back-compatibility",
        "reason": "Older textline that no longer exists - superseded by the "
                  "sibling variants PatroclusAboutAchilles01C_01 and _02. "
                  "Source comments call it out as kept for compatibility.",
    },

    # --- typo-or-bug (5) ---
    "DemeterUpgrade": {
        "category": "typo-or-bug",
        "reason": "Should be DemeterFirstPickUp (which is defined) to match "
                  "the other entries in HadesPostFlashback01's "
                  "RequiredMinAnyTextLines list - the other gods use "
                  "<God>FirstPickUp textline names.",
    },
    "HermesUpgrade": {
        "category": "typo-or-bug",
        "reason": "Should be HermesFirstPickUp (which is defined) to match "
                  "the other entries in HadesPostFlashback01's "
                  "RequiredMinAnyTextLines list - the other gods use "
                  "<God>FirstPickUp textline names.",
    },
    "ThanatosGift010": {
        "category": "typo-or-bug",
        "reason": "Almost certainly a typo for ThanatosGift10 (extra zero).",
    },
    "LordHadesEncounter01B": {
        "category": "typo-or-bug",
        "reason": "Almost certainly a typo for LordHadesEncounter01_B "
                  "(missing underscore).",
    },
    "Athena_07": {
        "category": "typo-or-bug",
        "reason": "Required by AthenaMaxRelationship01's RequiredTextLines "
                  "but no matching definition exists - doesn't follow the "
                  "AthenaGift<N> or AthenaMaxRelationship<N> patterns, so "
                  "AthenaMaxRelationship01 can never play.",
    },

    # --- cut-content (13) ---
    "LordHadesFirstDefeat": {
        "category": "cut-content",
        "reason": "Cut event; referenced only in RequiredFalseTextLines as a "
                  "defensive null check (always satisfied).",
    },
    "TheseusFirstAppearance_MetMinotaur": {
        "category": "cut-content",
        "reason": "Cut event; referenced only in RequiredFalseTextLines as a "
                  "defensive null check.",
    },
    "InspectPointLoungeClosed01": {
        "category": "cut-content",
        "reason": "Cut content; referenced as an alternative in "
                  "RequiredAnyTextLines for CerberusLoungeClosed01.",
    },
    "NyxAboutAres01_B": {
        "category": "cut-content",
        "reason": "Cut _B variant; paired with the existing NyxAboutAres01 "
                  "in OR-style requirements as a defensive fallback.",
    },
    "NyxAboutAres02_B": {
        "category": "cut-content",
        "reason": "Cut _B variant; paired with the existing NyxAboutAres02 "
                  "in OR-style requirements as a defensive fallback.",
    },
    "NyxAboutAres05_B": {
        "category": "cut-content",
        "reason": "Cut _B variant; paired with NyxAboutAres05 in OR-style "
                  "and false-check requirements.",
    },
    "AchillesGift08": {
        "category": "cut-content",
        "reason": "Required by AchillesAboutMyrmidonReunionQuest03_A's "
                  "RequiredAnyTextLines; cut, so one branch can never "
                  "activate via this path.",
    },
    "AthenaGift05": {
        "category": "cut-content",
        "reason": "Required by AthenaPostGiftPickup05's RequiredTextLines; "
                  "cut, so AthenaPostGiftPickup05 can never play.",
    },
    "PersephoneMeeting05": {
        "category": "cut-content",
        "reason": "Used in DusaVsNyx04's MinRunsSinceAnyTextLines list; cut, "
                  "contributes a no-op to the count.",
    },
    "HermesAboutWhippedFrenzy03": {
        "category": "cut-content",
        "reason": "Required by HermesAboutBiomeSpeedCondition02; cut, so the "
                  "follow-up can never play.",
    },
    "ZeusRevealsLuciferAspect02": {
        "category": "cut-content",
        "reason": "Used in ZeusAboutLuciferAspect01's RequiredFalseTextLines; "
                  "cut, requirement trivially satisfied.",
    },
    "PoseidonFishQuest01": {
        "category": "cut-content",
        "reason": "Required by PoseidonFishQuestComplete's RequiredTextLines "
                  "(so PoseidonFishQuestComplete can never play). Also "
                  "referenced in the same textline's "
                  "RequiredFalseTextLinesLastRun (harmless).",
    },
    "DusaMiscMeeting01": {
        "category": "cut-content",
        "reason": "Used in DusaChat26's RequiredFalseTextLines; cut, "
                  "requirement trivially satisfied.",
    },
}

# Display labels and short descriptions for the viewer; keeps category
# strings in the data layer terse while still surfacing the full intent
# in the UI.
UNRESOLVED_CATEGORY_LABELS = {
    "back-compatibility": "Back-compatibility",
    "typo-or-bug":        "Typo / bug",
    "cut-content":        "Cut content",
}

UNRESOLVED_CATEGORY_DESCRIPTIONS = {
    "back-compatibility":
        "Definition was removed or renamed in a game update but the old "
        "name is still referenced - usually so old save files behave "
        "correctly. The reference is intentional and harmless.",
    "typo-or-bug":
        "The reference looks like a typo, convention drift, or game-data "
        "bug. The intended textline may exist under a slightly different "
        "name, or no such textline is actually needed at all.",
    "cut-content":
        "The referenced textline was planned but never made it into the "
        "final game data. Whether this breaks anything depends on how "
        "it is referenced (a null-check is harmless; a positive requirement "
        "blocks the referencing textline).",
}
