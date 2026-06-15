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


# Friendly headers shown above each requirement group in the
# DEPENDENTS view (per-section headers describing how each dependent
# below references the current textline). The upstream
# ``HADES1_REQ_TYPE_LABELS`` reads "this textline requires X"; this
# parallel map flips the perspective so the same field name reads
# "each dependent below has this textline somewhere in its X group".
# Every entry in ``TEXTLINE_REQ_FIELDS`` and ``TEXTLINE_REQ_FIELDS_COUNT``
# must be covered so the dependents view always renders the
# perspective-correct wording.
#
# Naming scheme: positives use "Required as prerequisite (in X group)"
# / "Required as queued (in X group)"; negatives use "Excluded as
# prerequisite (must NOT have played, ...)" / "Excluded as queued
# (must NOT be queued)". Count-based fields use "Counts towards X"
# since the dependent's own count threshold (not the current
# textline's) is what's checked - the threshold value still renders
# inline as the trailing ``: N``.
HADES1_REQ_TYPE_LABELS_DEPENDENTS = {
    "RequiredTextLines":              "Required as prerequisite (in ALL group)",
    "RequiredAnyTextLines":           "Required as prerequisite (in ANY group)",
    "RequiredAnyOtherTextLines":      "Required as prerequisite (in ANY-other group)",
    "RequiredTextLinesThisRun":       "Required as prerequisite (in ALL group, this run)",
    "RequiredTextLinesLastRun":       "Required as prerequisite (in ALL group, last run)",
    "RequiredTextLinesThisRoom":      "Required as prerequisite (in ALL group, this room)",
    "RequiredAnyTextLinesThisRun":    "Required as prerequisite (in ANY group, this run)",
    "RequiredAnyTextLinesLastRun":    "Required as prerequisite (in ANY group, last run)",
    "RequiredQueuedTextLines":        "Required as queued (in ALL group)",
    "RequiredAnyQueuedTextLines":     "Required as queued (in ANY group)",
    "RequiredFalseTextLines":         "Excluded as prerequisite (must NOT have played)",
    "RequiredFalseQueuedTextLines":   "Excluded as queued (must NOT be queued)",
    "RequiredFalseTextLinesThisRun":  "Excluded as prerequisite (must NOT have played, this run)",
    "RequiredFalseTextLinesLastRun":  "Excluded as prerequisite (must NOT have played, last run)",
    "RequiredFalseTextLinesThisRoom": "Excluded as prerequisite (must NOT have played, this room)",
    "RequiredMinAnyTextLines":        "Counts towards 'at least' (ANY)",
    "RequiredMaxAnyTextLines":        "Counts towards 'at most' (ANY)",
    "MinRunsSinceAnyTextLines":       "Counts towards Min. runs since played (ANY)",
    "MaxRunsSinceAnyTextLines":       "Counts towards Max. runs since played (ANY)",
}


# Plain-English explanations shown as the second line of the hover
# tooltip on every dependents-view requirement-type label (tree-view
# group headers in the dependents tree, per-row edge chips when the
# row sits under a dependents-direction parent). Wording mirrors
# ``HADES1_REQ_TYPE_TOOLTIPS`` but inverts the subject: instead of
# "this dialogue is eligible if EVERY listed textline ..." it reads
# "each dependent below requires every textline in its ALL group ...".
# Every entry in ``TEXTLINE_REQ_FIELDS`` and ``TEXTLINE_REQ_FIELDS_COUNT``
# should be covered; unmapped types fall back to the internal-name-only
# tooltip the viewer otherwise uses.
HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS = {
    "RequiredTextLines":
        "Each dependent below has this textline in its ALL-prerequisites group, where EVERY listed textline must have been played at some point in a save.",
    "RequiredAnyTextLines":
        "Each dependent below has this textline in its ANY-prerequisites group, where AT LEAST ONE listed textline must have been played at some point in a save.",
    "RequiredAnyOtherTextLines":
        "Each dependent below has this textline in its second ANY-prerequisites group, used as a disjunctive group alongside RequiredAnyTextLines when two independent 'any' checks are needed on the same dialogue.",
    "RequiredTextLinesThisRun":
        "Each dependent below has this textline in its ALL-prerequisites (this run) group, where EVERY listed textline must have been played within the current run.",
    "RequiredTextLinesLastRun":
        "Each dependent below has this textline in its ALL-prerequisites (last run) group, where EVERY listed textline must have been played during the previous run.",
    "RequiredTextLinesThisRoom":
        "Each dependent below has this textline in its ALL-prerequisites (this room) group, where EVERY listed textline must have been played within the current room.",
    "RequiredAnyTextLinesThisRun":
        "Each dependent below has this textline in its ANY-prerequisites (this run) group, where AT LEAST ONE listed textline must have been played within the current run.",
    "RequiredAnyTextLinesLastRun":
        "Each dependent below has this textline in its ANY-prerequisites (last run) group, where AT LEAST ONE listed textline must have been played during the previous run.",
    "RequiredQueuedTextLines":
        "Each dependent below has this textline in its queued ALL-prerequisites group, where EVERY listed textline must be currently queued to play (assigned and waiting) but not yet played.",
    "RequiredAnyQueuedTextLines":
        "Each dependent below has this textline in its queued ANY-prerequisites group, where AT LEAST ONE listed textline must be currently queued to play (assigned and waiting) but not yet played.",
    "RequiredFalseTextLines":
        "Each dependent below has this textline in its excluded-prerequisites group, where NONE of the listed textlines may have been played at any point in a save.",
    "RequiredFalseQueuedTextLines":
        "Each dependent below has this textline in its excluded-queued group, where NONE of the listed textlines may be currently queued to play.",
    "RequiredFalseTextLinesThisRun":
        "Each dependent below has this textline in its excluded-prerequisites (this run) group, where NONE of the listed textlines may have been played within the current run.",
    "RequiredFalseTextLinesLastRun":
        "Each dependent below has this textline in its excluded-prerequisites (last run) group, where NONE of the listed textlines may have been played during the previous run.",
    "RequiredFalseTextLinesThisRoom":
        "Each dependent below has this textline in its excluded-prerequisites (this room) group, where NONE of the listed textlines may have been played within the current room.",
    "RequiredMinAnyTextLines":
        "Each dependent below has this textline in its 'at least X' threshold group, where AT LEAST X of the listed textlines must have been played at some point in a save.",
    "RequiredMaxAnyTextLines":
        "Each dependent below has this textline in its 'at most X' threshold group, where AT MOST X of the listed textlines must have been played at some point in a save.",
    "MinRunsSinceAnyTextLines":
        "Each dependent below has this textline in its 'min runs since played' threshold group, where AT LEAST X runs must have passed since any of the listed textlines was last played.",
    "MaxRunsSinceAnyTextLines":
        "Each dependent below has this textline in its 'max runs since played' threshold group, where AT MOST X runs must have passed since any of the listed textlines was last played.",
}
