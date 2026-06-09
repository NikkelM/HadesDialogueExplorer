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
...) is disjoint from H1's. ``src.label_maps.annotate_label_maps``
merges each game's maps into one viewer-side lookup (mirroring the
``_SECTION_KEY_LABEL_SOURCES`` pattern), and the per-game seam keeps
each game's vocabulary additive rather than overwriting.

Keep additions here in sync with ``TEXTLINE_REQ_FIELDS`` /
``TEXTLINE_REQ_FIELDS_COUNT`` in ``src/extractors/textline_set.py``
(those H1-specific extractor allowlists drive which field names ever
reach the viewer).
"""

# Friendly headers shown above each requirement group in the details
# panel (also used in unresolved-ref reason text). Every entry in
# ``TEXTLINE_REQ_FIELDS`` and ``TEXTLINE_REQ_FIELDS_COUNT`` must be
# covered.
#
# Naming scheme: positives use ``Must have played`` / ``Must be queued``;
# negatives use ``Must NOT have played`` / ``Must NOT be queued``.
# Quantifier (``ALL`` / ``ANY``) and scope (``this run`` / ``last run``
# / ``this room``) are in parens; every label carries an explicit
# quantifier marker so the headers are self-describing. Count-based
# fields use ``at least`` / ``at most`` / ``Min/Max runs since played``
# forms - the ``Count`` parameter is appended by the viewer as a
# trailing ``: N``, so e.g. ``Must have played at least (ANY)``
# renders as ``Must have played at least (ANY): 3``.
HADES1_REQ_TYPE_LABELS = {
    "RequiredTextLines":              "Must have played (ALL)",
    "RequiredAnyTextLines":           "Must have played (ANY)",
    "RequiredAnyOtherTextLines":      "Must have played (ANY other)",
    "RequiredTextLinesThisRun":       "Must have played (ALL, this run)",
    "RequiredTextLinesLastRun":       "Must have played (ALL, last run)",
    "RequiredTextLinesThisRoom":      "Must have played (ALL, this room)",
    "RequiredAnyTextLinesThisRun":    "Must have played (ANY, this run)",
    "RequiredAnyTextLinesLastRun":    "Must have played (ANY, last run)",
    "RequiredQueuedTextLines":        "Must be queued (ALL)",
    "RequiredAnyQueuedTextLines":     "Must be queued (ANY)",
    "RequiredFalseTextLines":         "Must NOT have played",
    "RequiredFalseQueuedTextLines":   "Must NOT be queued",
    "RequiredFalseTextLinesThisRun":  "Must NOT have played (this run)",
    "RequiredFalseTextLinesLastRun": "Must NOT have played (last run)",
    "RequiredFalseTextLinesThisRoom": "Must NOT have played (this room)",
    "RequiredMinAnyTextLines":        "Must have played at least (ANY)",
    "RequiredMaxAnyTextLines":        "Must have played at most (ANY)",
    "MinRunsSinceAnyTextLines":       "Min runs since played (ANY)",
    "MaxRunsSinceAnyTextLines":       "Max runs since played (ANY)",
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

# Plain-English explanations shown as the second line of the hover
# tooltip on every requirement-type label (details-panel headers,
# tree-view group headers, blocked-banner blocking-field chips). The
# viewer prepends the internal field name as the first line so the
# tooltip carries both the canonical engine name and a short blurb of
# what the check actually gates on. Every entry in
# ``TEXTLINE_REQ_FIELDS`` and ``TEXTLINE_REQ_FIELDS_COUNT`` should be
# covered; unmapped types fall back to the internal-name-only tooltip
# the viewer otherwise uses.
#
# Wording conventions mirror ``HADES1_REQ_TYPE_LABELS``: positives use
# "has been played" / "is queued", negatives use "has not been played"
# / "is not queued"; ALL/ANY quantifiers are spelled out; scope words
# match the labels ("this run" / "last run" / "this room"). Count-based
# entries reference the ``Count`` parameter explicitly so the user
# can connect the threshold shown next to the header (e.g. ``: 3``)
# with the field's meaning.
HADES1_REQ_TYPE_TOOLTIPS = {
    "RequiredTextLines":
        "This dialogue is only eligible if EVERY listed textline has been played at some point in a save.",
    "RequiredAnyTextLines":
        "This dialogue is eligible if AT LEAST ONE of the listed textlines has been played at some point in a save.",
    "RequiredAnyOtherTextLines":
        "This dialogue is eligible if AT LEAST ONE of the listed textlines has been played at some point in a save. Used as a second disjunctive group alongside RequiredAnyTextLines when two independent 'any' checks are needed on the same dialogue.",
    "RequiredTextLinesThisRun":
        "This dialogue is only eligible if EVERY listed textline has been played within the current run.",
    "RequiredTextLinesLastRun":
        "This dialogue is only eligible if EVERY listed textline was played during the previous run.",
    "RequiredTextLinesThisRoom":
        "This dialogue is only eligible if EVERY listed textline has been played within the current room.",
    "RequiredAnyTextLinesThisRun":
        "This dialogue is eligible if AT LEAST ONE of the listed textlines has been played within the current run.",
    "RequiredAnyTextLinesLastRun":
        "This dialogue is eligible if AT LEAST ONE of the listed textlines was played during the previous run.",
    "RequiredQueuedTextLines":
        "This dialogue is only eligible if EVERY listed textline is currently queued to play (assigned and waiting) but has not yet played.",
    "RequiredAnyQueuedTextLines":
        "This dialogue is eligible if AT LEAST ONE of the listed textlines is currently queued to play (assigned and waiting) but has not yet played.",
    "RequiredFalseTextLines":
        "This dialogue is only eligible if NONE of the listed textlines have been played at any point in a save.",
    "RequiredFalseQueuedTextLines":
        "This dialogue is only eligible if NONE of the listed textlines are currently queued to play.",
    "RequiredFalseTextLinesThisRun":
        "This dialogue is only eligible if NONE of the listed textlines have been played within the current run.",
    "RequiredFalseTextLinesLastRun":
        "This dialogue is only eligible if NONE of the listed textlines were played during the previous run.",
    "RequiredFalseTextLinesThisRoom":
        "This dialogue is only eligible if NONE of the listed textlines have been played within the current room.",
    "RequiredMinAnyTextLines":
        "This dialogue is only eligible if AT LEAST X of the listed textlines have been played at some point in a save.",
    "RequiredMaxAnyTextLines":
        "This dialogue is only eligible if AT MOST X of the listed textlines have been played at some point in a save.",
    "MinRunsSinceAnyTextLines":
        "This dialogue is only eligible if AT LEAST X runs have passed since any of the listed textlines was last played.",
    "MaxRunsSinceAnyTextLines":
        "This dialogue is only eligible if AT MOST X runs have passed since any of the listed textlines was last played.",
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
