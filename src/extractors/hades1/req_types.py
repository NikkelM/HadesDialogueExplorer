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
# fields use ``at least`` / ``at most`` / ``Min./Max. runs since played``
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
    "MinRunsSinceAnyTextLines":       "Min. runs since played (ANY)",
    "MaxRunsSinceAnyTextLines":       "Max. runs since played (ANY)",
}

# Short chips rendered next to each child in the dependency tree.
# Full enumeration: every entry in H1's ``TEXTLINE_REQ_FIELDS`` and
# ``TEXTLINE_REQ_FIELDS_COUNT`` gets a DISTINCT explicit label so the
# viewer's pure lookup never collapses two semantically different
# field types onto the same glyph. Pure lookup with no
# JS heuristics; ``getEdgeLabel`` falls back to ``ALL`` only for
# genuinely unknown types not present in this map.
#
# Symbol legend:
#   - ``ALL``     - every listed textline must have played (conjunction)
#   - ``ANY``     - at least one of the listed textlines must have played
#   - ``\u00AC``      - logical NOT: none of the listed textlines may have played
#   - ``\u2265 ANY``  - count: at least N of the listed textlines must have played
#   - ``\u2264 ANY``  - count: at most N of the listed textlines must have played
#   - ``+R ANY``  - cooldown: at least N runs since any of them was played
#   - ``-R ANY``  - cooldown: at most N runs since any of them was played
#
# Scope suffix legend (appended to the quantifier with a space):
#   - ``TR``      - this run only (subset of save-wide)
#   - ``LR``      - last run only (the run before the current one)
#   - ``R``       - this room only (subset of this run)
#   - ``Q``       - queued (assigned + waiting, not yet played)
#   - ``*``       - ``RequiredAnyOtherTextLines`` second disjunctive group
#                   (logically identical to ``ANY`` but a separate
#                   field, so the chip is starred to distinguish it
#                   when both fields coexist on one dialogue)
#
# Save-wide variants carry no scope suffix (``ALL`` / ``ANY`` /
# ``\u00AC``); narrower scopes append the suffix (``ALL TR``, ``ANY LR``,
# ``\u00AC R``, ...). The full internal field name + plain-English blurb
# is always reachable on hover via the tooltip wired in
# ``tree.js`` (per-row chip) and ``tree-renderers.js`` (group header).
HADES1_REQ_TYPE_EDGE_LABELS = {
    "RequiredTextLines":              "ALL",
    "RequiredTextLinesThisRun":       "ALL TR",
    "RequiredTextLinesLastRun":       "ALL LR",
    "RequiredTextLinesThisRoom":      "ALL R",
    "RequiredQueuedTextLines":        "ALL Q",

    "RequiredAnyTextLines":           "ANY",
    "RequiredAnyOtherTextLines":      "ANY*",
    "RequiredAnyTextLinesThisRun":    "ANY TR",
    "RequiredAnyTextLinesLastRun":    "ANY LR",
    "RequiredAnyQueuedTextLines":     "ANY Q",

    "RequiredFalseTextLines":         "\u00AC",
    "RequiredFalseTextLinesThisRun":  "\u00AC TR",
    "RequiredFalseTextLinesLastRun":  "\u00AC LR",
    "RequiredFalseTextLinesThisRoom": "\u00AC R",
    "RequiredFalseQueuedTextLines":   "\u00AC Q",

    "RequiredMinAnyTextLines":        "\u2265 ANY",
    "RequiredMaxAnyTextLines":        "\u2264 ANY",
    "MinRunsSinceAnyTextLines":       "+R ANY",
    "MaxRunsSinceAnyTextLines":       "-R ANY",
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


# Display order for requirement-type groupings in the dependency tree
# and details panel. The viewer sorts each level's children by this
# index so the same colour bands appear in a consistent semantic
# order. Anything not listed sorts to the end.
#
# Outer band: ALL -> ANY -> NONE -> MIN -> MAX.
# Inner scope (broadest -> most immediate):
#   cross-run -> this-run -> last-run -> this-room -> queued.
# Within MIN / MAX: explicit count thresholds before runs-since.
HADES1_REQ_TYPE_DISPLAY_ORDER = [
    # ALL band - dialogue must have played all of the named lines.
    "RequiredTextLines",
    "RequiredTextLinesThisRun",
    "RequiredTextLinesLastRun",
    "RequiredTextLinesThisRoom",
    "RequiredQueuedTextLines",
    # ANY band - dialogue must have played at least one of the named
    # lines (RequiredAnyOtherTextLines is a cross-run "any except the
    # parent itself" variant - slotted adjacent to RequiredAnyTextLines).
    "RequiredAnyTextLines",
    "RequiredAnyOtherTextLines",
    "RequiredAnyTextLinesThisRun",
    "RequiredAnyTextLinesLastRun",
    "RequiredAnyQueuedTextLines",
    # NONE band - dialogue must NOT have played any of the named lines.
    "RequiredFalseTextLines",
    "RequiredFalseTextLinesThisRun",
    "RequiredFalseTextLinesLastRun",
    "RequiredFalseTextLinesThisRoom",
    "RequiredFalseQueuedTextLines",
    # MIN band - thresholds (count of textlines played vs runs since
    # any one of them last played).
    "RequiredMinAnyTextLines",
    "MinRunsSinceAnyTextLines",
    # MAX band - mirror of MIN.
    "RequiredMaxAnyTextLines",
    "MaxRunsSinceAnyTextLines",
]
