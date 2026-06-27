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
        "reason": "An old dialogue that was renamed or removed in a later "
                  "update. The leftover reference is kept only so existing "
                  "saves keep working and has no effect on play.",
    },
    "FuryFirstAppearanceFirstRun": {
        "category": "back-compatibility",
        "reason": "An old dialogue that was renamed or removed in a later "
                  "update. The leftover reference is kept only so existing "
                  "saves keep working and has no effect on play.",
    },
    "PatroclusAboutAchilles01C": {
        "category": "back-compatibility",
        "reason": "An old dialogue that was renamed or removed in a later "
                  "update. The leftover reference is kept only so existing "
                  "saves keep working and has no effect on play.",
    },

    # --- typo-or-bug (5) ---
    "DemeterUpgrade": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for DemeterFirstPickUp, which does exist.",
    },
    "HermesUpgrade": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for HermesFirstPickUp, which does exist.",
    },
    "ThanatosGift010": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for ThanatosGift10, which does exist.",
    },
    "LordHadesEncounter01B": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for LordHadesEncounter01_B, which does exist.",
    },
    "Athena_07": {
        "category": "typo-or-bug",
        "reason": "Required by AthenaMaxRelationship01, but no dialogue with "
                  "this name exists, so AthenaMaxRelationship01 can never play.",
    },

    # --- cut-content (13) ---
    "LordHadesFirstDefeat": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "TheseusFirstAppearance_MetMinotaur": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "InspectPointLoungeClosed01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It was "
                  "one option among alternatives for CerberusLoungeClosed01, "
                  "which can still play via its remaining options.",
    },
    "NyxAboutAres01_B": {
        "category": "cut-content",
        "reason": "An alternate version that was never added to the game. It "
                  "was paired with the existing NyxAboutAres01 as a fallback, "
                  "so nothing is affected.",
    },
    "NyxAboutAres02_B": {
        "category": "cut-content",
        "reason": "An alternate version that was never added to the game. It "
                  "was paired with the existing NyxAboutAres02 as a fallback, "
                  "so nothing is affected.",
    },
    "NyxAboutAres05_B": {
        "category": "cut-content",
        "reason": "An alternate version that was never added to the game. It "
                  "was paired with the existing NyxAboutAres05 as a fallback, "
                  "so nothing is affected.",
    },
    "AchillesGift08": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It was "
                  "one option among alternatives for "
                  "AchillesAboutMyrmidonReunionQuest03_A, which can still play "
                  "via its remaining options.",
    },
    "AthenaGift05": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "required by AthenaPostGiftPickup05, which can therefore "
                  "never play.",
    },
    "PersephoneMeeting05": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It "
                  "only feeds into a counter, so nothing is affected.",
    },
    "HermesAboutWhippedFrenzy03": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "required by HermesAboutBiomeSpeedCondition02, which can "
                  "therefore never play.",
    },
    "ZeusRevealsLuciferAspect02": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "DusaMiscMeeting01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
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
