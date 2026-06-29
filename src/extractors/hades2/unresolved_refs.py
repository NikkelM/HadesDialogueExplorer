"""
Hardcoded categorisation of Hades II textline references that are present
in the source data but have no matching definition reachable by the
current set of H2 extractors.

The pipeline (``build_viewer.py``) audits this list against the set of
refs that the parser computed as unresolved. Drift in either direction
prints a warning:
  - An entry here that the parser already resolves -> remove it (likely
    fixed by a recent extractor change).
  - An unresolved ref the parser found that isn't in this list -> triage
    and add it with a category and brief reason.

Categories (the viewer renders these with distinct colours and an inline
explanation):

  cut-content
      The referenced textline was planned but never made it into the
      final game data. May appear in negative ``PathFalse`` /
      ``HasNone`` requirements (harmless - the requirement is trivially
      satisfied) or in positive ``HasAll`` / ``HasAny`` requirements
      (the referencing textline can therefore never play).

  typo-or-bug
      The reference is a clear typo, convention drift, or game-data bug
      (e.g. transposed words in the name). The intended textline usually
      exists under a slightly different name; the game still ships the
      broken reference, so the tool surfaces it as unresolved rather than
      silently "correcting" it.

  extractor-deferred
      The referenced textline IS defined in the H2 source, but inside
      a container that the current extractor set does not walk yet.
      No entries currently use this category (the
      ``VariantSetData.NPC_<Char>_01.*`` subtrees that previously
      contributed the bulk of entries here are now walked by the H2
      NPC extractor). Reserved for the remaining
      ``h2-npc-inherit-variants`` sub-tasks (list-form ``InheritFrom``
      flattening and ``CopyDataFromPartner`` partner-stub rehoming)
      that may surface new deferred refs.
"""

HADES2_KNOWN_UNRESOLVED_REFS = {
    # --- cut-content (7) ---
    "ChronosBossSuit01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "ErisAboutShrine01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "ErisAboutShrine02": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "ErisAboutShrine03": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "MedeaHubMeeting01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "required by MedeaHubMeeting02, which can therefore never "
                  "play.",
    },
    "NemesisWithMoros03": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },
    "TyphonHeadAltFight01": {
        "category": "cut-content",
        "reason": "A dialogue that was never added to the game. It is "
                  "only referenced as a harmless check, so nothing is "
                  "affected.",
    },

    # --- typo-or-bug (2) ---
    "ChronosBossPreTrueEndingOutro01": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for ChronosBossOutroPreTrueEnding01, which does exist.",
    },
    "ChronosBossPreTrueEndingOutro01_B": {
        "category": "typo-or-bug",
        "reason": "Looks like a typo for ChronosBossOutroPreTrueEnding01_B, which does exist.",
    },
}


# Display labels and short descriptions for the viewer; keeps category
# strings in the data layer terse while still surfacing the full intent
# in the UI. H2 adds the ``extractor-deferred`` category on top of the
# H1 set; the shared ``UNRESOLVED_CATEGORY_LABELS`` /
# ``UNRESOLVED_CATEGORY_DESCRIPTIONS`` maps in ``src.known_unresolved``
# are populated as the union of both games' categories at import time.
HADES2_UNRESOLVED_CATEGORY_LABELS = {
    "cut-content":        "Cut content",
    "typo-or-bug":        "Typo / bug",
    "extractor-deferred": "Extractor coverage gap",
}

HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS = {
    "cut-content":
        "The referenced textline was planned but never made it into the "
        "final game data. Whether this breaks anything depends on how "
        "it is referenced (a null-check is harmless; a positive requirement "
        "blocks the referencing textline).",
    "typo-or-bug":
        "The reference looks like a typo, convention drift, or game-data "
        "bug. The intended textline may exist under a slightly different "
        "name, or no such textline is actually needed at all.",
    "extractor-deferred":
        "The referenced textline IS defined in the H2 source, but inside "
        "a container that the current extractor set does not walk yet "
        "(typically a VariantSetData per-character subtree). These will "
        "resolve automatically when the corresponding extractor work "
        "lands.",
}
