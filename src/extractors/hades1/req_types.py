"""Viewer-label data for Hades 1's requirement-field vocabulary.

H1 textlines express dependencies via flat ``Required.*TextLine.*``
fields directly on the textline table (``RequiredTextLines``,
``RequiredAnyTextLinesLastRun``, etc.). The three maps in this module
turn those internal field names into the friendly headers / short
chips / display order the viewer renders.

Why this lives under ``hades1/`` rather than the shared
``textline_set`` base: H2 uses a different requirement format
entirely - a list of ``GameStateRequirements`` records like::

    GameStateRequirements = {
        { Path = { "GameState", "TextLinesRecord" },
          HasAny = { "NeoChronosAboutTartarus01", ... } },
        ...
    }

so the H2 viewer-label vocabulary (``HasAny``, ``HasAll``, ``Path``,
...) is disjoint from H1's. ``build_viewer.annotate_label_maps``
merges each game's maps into one viewer-side lookup (mirroring the
``_SECTION_KEY_LABEL_SOURCES`` pattern), and the per-game seam keeps
each game's vocabulary additive rather than overwriting.

Keep additions here in sync with ``TEXTLINE_REQ_FIELDS`` /
``TEXTLINE_REQ_FIELDS_COUNT`` in ``src/extractors/textline_set.py``
(those H1-specific extractor allowlists drive which field names ever
reach the viewer).
"""

# Friendly headers shown above each requirement group in the details
# panel (also used in unresolved-ref reason text). Mapping is
# intentionally partial today - see issue #44 for the missing entries.
HADES1_REQ_TYPE_LABELS = {
    "RequiredTextLines":              "Required (ALL)",
    "RequiredAnyTextLines":           "Required (ANY)",
    "RequiredAnyOtherTextLines":      "Required (ANY other)",
    "RequiredFalseTextLines":         "Must NOT have played",
    "RequiredFalseQueuedTextLines":   "Must NOT be queued",
    "RequiredFalseTextLinesThisRun":  "Must NOT have played (this run)",
    "RequiredFalseTextLinesLastRun":  "Must NOT have played (last run)",
    "RequiredTextLinesThisRun":       "Required (this run)",
    "RequiredTextLinesLastRun":       "Required (last run)",
    "RequiredAnyTextLinesThisRun":    "Required ANY (this run)",
    "RequiredAnyTextLinesLastRun":    "Required ANY (last run)",
}

# Short chips rendered next to each child in the dependency tree. Full
# enumeration: every entry in H1's ``TEXTLINE_REQ_FIELDS`` and
# ``TEXTLINE_REQ_FIELDS_COUNT`` gets an explicit label so the viewer can
# do a pure lookup with no JS heuristics. Symbols: ``\u00AC`` is the
# logical NOT sign, used as a compact "must not" badge.
HADES1_REQ_TYPE_EDGE_LABELS = {
    "RequiredTextLines":              "ALL",
    "RequiredTextLinesThisRun":       "ALL",
    "RequiredTextLinesLastRun":       "ALL",
    "RequiredTextLinesThisRoom":      "ALL",
    "RequiredQueuedTextLines":        "ALL",

    "RequiredAnyTextLines":           "ANY",
    "RequiredAnyOtherTextLines":      "ANY",
    "RequiredAnyTextLinesThisRun":    "ANY",
    "RequiredAnyTextLinesLastRun":    "ANY",
    "RequiredAnyQueuedTextLines":     "ANY",

    "RequiredFalseTextLines":         "\u00AC",
    "RequiredFalseTextLinesThisRun":  "\u00AC",
    "RequiredFalseTextLinesLastRun":  "\u00AC",
    "RequiredFalseTextLinesThisRoom": "\u00AC",
    "RequiredFalseQueuedTextLines":   "\u00ACQ",

    "RequiredMinAnyTextLines":        "ANY",
    "RequiredMaxAnyTextLines":        "ANY",
    "MinRunsSinceAnyTextLines":       "ANY",
    "MaxRunsSinceAnyTextLines":       "ANY",
}

# Display order for requirement-type groupings in the dependency tree.
# The viewer sorts each level's children by this index so the same colour
# bands appear in a consistent semantic order: hard requirements first,
# then optional, then counts, then exclusions, then cooldowns. Anything
# not listed sorts to the end.
HADES1_REQ_TYPE_DISPLAY_ORDER = [
    "RequiredTextLines",
    "RequiredTextLinesThisRun",
    "RequiredTextLinesLastRun",
    "RequiredTextLinesThisRoom",
    "RequiredQueuedTextLines",
    "RequiredAnyTextLines",
    "RequiredAnyOtherTextLines",
    "RequiredAnyTextLinesThisRun",
    "RequiredAnyTextLinesLastRun",
    "RequiredAnyQueuedTextLines",
    "RequiredMinAnyTextLines",
    "RequiredMaxAnyTextLines",
    "RequiredFalseTextLines",
    "RequiredFalseQueuedTextLines",
    "RequiredFalseTextLinesThisRun",
    "RequiredFalseTextLinesLastRun",
    "RequiredFalseTextLinesThisRoom",
    "MinRunsSinceAnyTextLines",
    "MaxRunsSinceAnyTextLines",
]
