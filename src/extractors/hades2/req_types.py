"""Viewer-label data for Hades II's requirement-operator vocabulary.

Where H1 expresses dependencies as flat ``Required*TextLines*`` fields
on the textline table, H2 nests them into ``GameStateRequirements``
(and ~70 sibling fields like ``SetupGameStateRequirements`` /
``CompleteGameStateRequirements`` / ``PurchaseRequirements`` / ...)
which the evaluator
(``Content/Scripts/RequirementsLogic.lua::IsGameStateEligible``)
treats as a "RequirementSet" with two AND'd levels:

* **Set-level named keys** at the top of the requirements value
  (``Skip`` / ``Force`` / ``ChanceToPlay`` / ``NamedRequirements`` /
  ``NamedRequirementsFalse`` / ``OrRequirements``) - short-circuits or
  composition gates that apply to the entire set.
* **Per-record array entries**, each carrying a primary operator
  (``PathTrue`` / ``Path`` + ``HasAny`` / ``Comparison`` / ...) plus
  modifiers and parameters.

A typical record looks like::

    {
        Path = { "GameState", "TextLinesRecord" },
        HasAny = { "NeoChronosAboutTartarus01", ... },
    }

or with aggregation + comparison::

    {
        SumPrevRuns = 4,
        Path = { "SpeechRecord", "/VO/Melinoe_0115" },
        CountPathTrue = true,
        Comparison = "<=",
        Value = 0,
    }

The four maps in this module turn the leading **primary operator** of
each record (or each set-level gate) into the friendly header / short
chip / display order / tooltip the viewer renders.
``HADES2_REQ_OPERATORS`` is the allowlist used by tests and by
:mod:`src.extractors.hades2` registration to enforce per-game label
completeness.

Operator-vs-parameter split:
  * Operators carry semantic intent (``HasAny`` / ``IsNone`` /
    ``Comparison`` / ``OrRequirements`` / ``Skip`` / ``Force`` / ...).
    One per record (or set-level slot), drives the requirement *type*
    shown in the viewer, gets a label / edge-chip / tooltip entry here.
    The list is reproduced verbatim in :data:`HADES2_REQ_OPERATORS`.
  * Parameters configure the operator (``Path`` / ``PathFromArgs`` /
    ``PathFromSource`` / ``HintId`` / ``Value`` / ``ValuePath`` /
    ``ValuePathAddition`` / ``CountOf`` / ``SumOf`` / ``MaxOf`` /
    ``UseLength`` / ``Modulo`` / ``CountPathTrue`` /
    ``TableValuesToCount`` / ``ValuesToCount`` / ``SumPrevRuns`` /
    ``SumPrevRooms`` / ``IgnoreCurrentRun`` / ``FunctionArgs``).
    The extractor walks them and surfaces the resolved values inline
    in the rendered record string ("WeaponKills >= 400",
    "/VO/Melinoe_0115 over last 4 runs <= 0", etc.); no per-parameter
    label lives here.
  * Two non-operator fields are tolerated inside requirement sets and
    must be silently skipped by the extractor:
    ``Append = true`` (table-merge directive consumed by the data
    inheritance pre-pass, used in ``RoomDataI.lua``),
    ``DeepInheritance = true`` (companion data-merge directive used
    pervasively across EnemyData / WeaponData / AllyData), and
    ``PlayFirst = true`` (cue-level metadata accidentally placed
    inside a ``GameStateRequirements`` block in ``HeroData.lua``).
    None of these are read by ``IsGameStateEligible``.

Canonical operator/parameter source: the engine itself enumerates the
legal keys in the tail of ``Content/Scripts/RequirementsData.lua``::

    DebugData.LegalGenericRequirementKeys = ToLookup({ ... 28 keys ... })
    DebugData.LegalNonGenericRequirementKeys = ToLookup({
        "Skip", "Force", "ChanceToPlay", "NamedRequirements",
        "NamedRequirementsFalse", "OrRequirements",
        "DeepInheritance", "Append",
    })

The 18 operators below are the union of the 6 set-level operators
(non-generic, minus the 2 data-merge directives) and the 12 per-record
predicates (the generic list minus the 16 parameters/modifiers).
Mirrors the same merge-and-attach pattern as
:mod:`src.extractors.hades1.req_types` - ``src.label_maps`` unions
both games' maps into a single viewer-side lookup so the JS code does
one dictionary lookup regardless of source game. Vocabularies are
disjoint so the union is safe.

Keep the operator allowlist in sync with the parser's primary-key
detection in :mod:`src.extractors.hades2.requirements` (once that
module lands - this label module is built first so the parser has a
canonical reference list to lint against).
"""

# Primary requirement-operator allowlist. Every entry here is a key
# that can lead a requirement record or sit at the set-level of a
# RequirementSet (the verb that determines the set/record's semantic
# type). Aggregation modifiers (``CountOf`` / ``SumOf`` /
# ``SumPrevRuns`` / ``UseLength`` / ``Modulo`` / ...) and parameters
# (``Path`` / ``Value`` / ``Min`` / ``Max`` / ``FunctionArgs`` / ...)
# are not operators - they are properties of the record's primary
# operator and get surfaced inline in the rendered record string.
#
# Coverage source: the engine's own debug-validation enumeration at
# the tail of ``Content/Scripts/RequirementsData.lua``
# (``DebugData.LegalGenericRequirementKeys`` for per-record keys,
# ``DebugData.LegalNonGenericRequirementKeys`` for set-level keys).
# The 18 operators below are the union of those two lists minus 2
# data-merge directives (``DeepInheritance`` / ``Append``) and 16
# parameters/modifiers (``Path`` / ``Value`` / ``CountOf`` / ...) -
# those entries configure operators rather than being operators
# themselves. Cross-checked against an exhaustive parse of all 479 H2
# ``Scripts/*.lua`` files: every key found at either the set or record
# level inside one of the 72 known requirement-set fields (the field
# names the engine actually passes to ``IsGameStateEligible``) is
# accounted for by either an entry below or one of the documented
# parameter / non-operator categories above.
HADES2_REQ_OPERATORS = frozenset({
    # Set-level short-circuits (apply to the entire RequirementSet
    # before any per-record check; only one of these per set, but
    # they can sit alongside record entries which are then ignored).
    "Skip",
    "Force",
    # Set-level composition / probability (apply to the entire set,
    # AND'd with the per-record checks).
    "ChanceToPlay",
    "NamedRequirements",
    "NamedRequirementsFalse",
    "OrRequirements",
    # Per-record path-truthiness predicates.
    "PathTrue",
    "PathFalse",
    "PathEmpty",
    "PathNotEmpty",
    # Per-record set-membership predicates (against the container at
    # Path).
    "HasAny",
    "HasAll",
    "HasNone",
    "NotHasAll",
    # Per-record value-membership predicates (against the scalar value
    # at Path).
    "IsAny",
    "IsNone",
    # Per-record numeric comparison (paired with ``Value`` /
    # ``ValuePath`` / ``ValuePathAddition`` and optionally an
    # aggregation modifier like ``CountOf`` / ``SumOf`` /
    # ``CountPathTrue`` / ``SumPrevRuns`` / ``SumPrevRooms`` /
    # ``UseLength`` / ``Modulo``).
    "Comparison",
    # Per-record function-based predicate (paired with
    # ``FunctionArgs``).
    "FunctionName",
})


# Friendly headers shown above each requirement group in the details
# panel (also used in unresolved-ref reason text). Every entry in
# ``HADES2_REQ_OPERATORS`` must be covered.
#
# Naming scheme: positive predicates start with "Must" / "Path must";
# negatives use "Must NOT" / "Path must NOT". Quantifier (ALL / ANY /
# NONE) is in parens where applicable. Set-level short-circuits use
# "Always".
HADES2_REQ_TYPE_LABELS = {
    "Skip":                   "Always blocked (Skip)",
    "Force":                  "Always passes (Force)",
    "ChanceToPlay":           "Probability gate",
    "NamedRequirements":      "Named requirements must pass",
    "NamedRequirementsFalse": "Named requirements must NOT pass",
    "OrRequirements":         "At least one nested group must pass (OR)",
    "PathTrue":               "Path must be truthy",
    "PathFalse":              "Path must be falsy",
    "PathEmpty":              "Path must be empty",
    "PathNotEmpty":           "Path must be non-empty",
    "HasAny":                 "Must include (ANY)",
    "HasAll":                 "Must include (ALL)",
    "HasNone":                "Must NOT include (ANY)",
    "NotHasAll":              "Must NOT include (ALL)",
    "IsAny":                  "Value must be (ANY)",
    "IsNone":                 "Value must NOT be (ANY)",
    "Comparison":             "Value comparison",
    "FunctionName":           "Custom function check",
}


# Short chips rendered next to each child in the dependency tree.
# Pure lookup with no JS heuristics; ``getEdgeLabel`` falls back to
# ``ALL`` only for genuinely unknown types not present in this map.
# Every entry must be DISTINCT - the test enforces 1:1 so the viewer
# never collapses two semantically different operator types onto the
# same glyph.
#
# Symbol legend (H2 column):
#   - ``SKIP`` / ``FORCE`` - set-level short-circuits (always block /
#                            always pass)
#   - ``%``            - probability gate (paired with the ChanceToPlay
#                        value)
#   - ``NAMED``        - reference to one or more named req sets
#   - ``\u00ACNAMED``       - inverse reference to named req sets
#   - ``OR``           - OR composition of nested req groups
#   - ``T``    / ``F``     - path's value is truthy / falsy
#   - ``\u2205``      / ``\u2260\u2205``   - container at path is empty / non-empty
#   - ``\u220BANY`` / ``\u220BALL``  - container at path includes ANY / ALL listed items
#   - ``\u220B\u00AC``           - container at path includes NONE of the listed items
#   - ``\u00AC\u220BALL``        - container at path does NOT include all listed items
#   - ``=ANY`` / ``=\u00AC``    - scalar value at path matches ANY / NONE
#   - ``<>``           - numeric comparison (the comparator + Value
#                        render inline; the chip just marks the type)
#   - ``\u0192``            - function-based custom predicate
HADES2_REQ_TYPE_EDGE_LABELS = {
    "Skip":                   "SKIP",
    "Force":                  "FORCE",
    "ChanceToPlay":           "%",
    "NamedRequirements":      "NAMED",
    "NamedRequirementsFalse": "\u00ACNAMED",
    "OrRequirements":         "OR",
    "PathTrue":               "T",
    "PathFalse":              "F",
    "PathEmpty":              "\u2205",
    "PathNotEmpty":           "\u2260\u2205",
    "HasAny":                 "\u220BANY",
    "HasAll":                 "\u220BALL",
    "HasNone":                "\u220B\u00AC",
    "NotHasAll":              "\u00AC\u220BALL",
    "IsAny":                  "=ANY",
    "IsNone":                 "=\u00AC",
    "Comparison":             "<>",
    "FunctionName":           "\u0192",
}


# Plain-English explanations shown as the second line of the hover
# tooltip on every requirement-type label (details-panel headers,
# tree-view group headers, blocked-banner blocking-field chips). The
# viewer prepends the internal operator name as the first line so the
# tooltip carries both the canonical engine name and a short blurb of
# what the check actually gates on. Every entry in
# ``HADES2_REQ_OPERATORS`` should be covered.
HADES2_REQ_TYPE_TOOLTIPS = {
    "Skip":
        "Set-level escape hatch. When Skip = true sits at the top of a "
        "RequirementSet, IsGameStateEligible short-circuits to false and the "
        "dialogue is unconditionally blocked.",
    "Force":
        "Set-level escape hatch. When Force = true sits at the top of a "
        "RequirementSet, IsGameStateEligible short-circuits to true and the "
        "dialogue unconditionally passes the requirement check.",
    "ChanceToPlay":
        "Probability gate evaluated independently of the other predicates in "
        "the set. Even if every other check passes, the engine rolls against "
        "this probability before queuing the dialogue.",
    "NamedRequirements":
        "This dialogue references one or more reusable requirement sets defined "
        "in NamedRequirementsData (Content/Scripts/RequirementsData.lua). All "
        "referenced sets must pass.",
    "NamedRequirementsFalse":
        "This dialogue references one or more reusable requirement sets defined "
        "in NamedRequirementsData. None of the referenced sets may pass "
        "(inverse of NamedRequirements).",
    "OrRequirements":
        "This dialogue is eligible if AT LEAST ONE of the nested requirement "
        "groups passes. Used to express OR semantics within an otherwise "
        "AND-combined RequirementSet.",
    "PathTrue":
        "This dialogue is only eligible if the value at the given GameState "
        "path is truthy (non-nil, non-false, non-zero for numbers).",
    "PathFalse":
        "This dialogue is only eligible if the value at the given GameState "
        "path is falsy (nil, false, or zero for numbers).",
    "PathEmpty":
        "This dialogue is only eligible if the container (table) at the given "
        "GameState path is empty.",
    "PathNotEmpty":
        "This dialogue is only eligible if the container (table) at the given "
        "GameState path has at least one entry.",
    "HasAny":
        "This dialogue is eligible if the container at the given path includes "
        "AT LEAST ONE of the listed items.",
    "HasAll":
        "This dialogue is only eligible if the container at the given path "
        "includes EVERY listed item.",
    "HasNone":
        "This dialogue is only eligible if the container at the given path "
        "includes NONE of the listed items.",
    "NotHasAll":
        "This dialogue is eligible as long as the container at the given path "
        "is missing AT LEAST ONE of the listed items (i.e. it does NOT include "
        "all of them).",
    "IsAny":
        "This dialogue is eligible if the scalar value at the given path "
        "matches ANY of the listed values.",
    "IsNone":
        "This dialogue is only eligible if the scalar value at the given path "
        "matches NONE of the listed values.",
    "Comparison":
        "This dialogue is gated on a numeric comparison (==, !=, <, <=, >, >=) "
        "between the value at the given path (optionally aggregated via CountOf "
        "/ SumOf / MaxOf / CountPathTrue / SumPrevRuns / SumPrevRooms / "
        "UseLength / Modulo) and a constant or referenced Value.",
    "FunctionName":
        "This dialogue is gated on a custom Lua function (called with "
        "FunctionArgs as parameters). The function returns true to allow the "
        "dialogue, false to block.",
}


# Display order for requirement-type groupings in the dependency tree.
# Set-level short-circuits first (they suppress everything else), then
# probability and composition, then positive predicates, then negatives,
# then function checks. Anything not listed sorts to the end.
HADES2_REQ_TYPE_DISPLAY_ORDER = [
    # Set-level overrides surface first so their effect is obvious.
    "Skip",
    "Force",
    "ChanceToPlay",
    "NamedRequirements",
    "NamedRequirementsFalse",
    "OrRequirements",
    # Positive per-record predicates.
    "PathTrue",
    "PathNotEmpty",
    "HasAll",
    "HasAny",
    "IsAny",
    "Comparison",
    # Negative per-record predicates.
    "PathFalse",
    "PathEmpty",
    "HasNone",
    "NotHasAll",
    "IsNone",
    # Function-based predicate last (semantically opaque to the
    # extractor; rendered as a passthrough chip).
    "FunctionName",
]
