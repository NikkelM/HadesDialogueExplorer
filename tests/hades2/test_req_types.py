"""Lock the invariants of the Hades II requirement-operator label maps.

These tests mirror :mod:`tests.hades1.test_req_types` to act as a
guardrail so future additions to ``HADES2_REQ_OPERATORS`` (or future
edits to the per-game label maps) keep the viewer's lookups complete
and the shorthand chips 1:1.

The edge-label shorthand must be DISTINCT per operator so the tree
view's chips do not collapse semantically different requirement types
onto the same glyph.

Two key sets contribute to the expected coverage:

* ``HADES2_REQ_OPERATORS`` - the primary operator keys
  ``IsGameStateEligible`` reads.
* ``HADES2_TEXTLINE_DEPENDENCY_FIELDS`` - the 12 H1 synthetic
  textline-dependency field names that H2's req extractor re-keys
  textline records into so the graph builder produces dialogue
  edges uniformly with H1. Labels for these are imported verbatim
  from H1's req-type maps and must remain identical (asserted below).
"""

from src.extractors.hades1 import (
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_REQ_TYPE_LABELS_DEPENDENTS,
    HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS,
)
from src.extractors.hades2 import (
    HADES2_REQ_OPERATORS,
    HADES2_TEXTLINE_DEPENDENCY_FIELDS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
    HADES2_REQ_TYPE_LABELS_DEPENDENTS,
    HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS,
)
from src.extractors.hades2.req_extractor import (
    _FUNCTION_TEXTLINE_SYNTHETIC_KEYS,
    _TEXTLINE_PATH_PREFIXES,
)


# Combined "expected key" set: every entry in the H2 label maps must
# be one of these. Updating the maps means updating one of the two
# constants this set is built from.
EXPECTED_KEYS = HADES2_REQ_OPERATORS | HADES2_TEXTLINE_DEPENDENCY_FIELDS


def test_labels_cover_every_known_operator():
    missing = EXPECTED_KEYS - set(HADES2_REQ_TYPE_LABELS)
    assert not missing, (
        f"HADES2_REQ_TYPE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_edge_labels_cover_every_known_operator():
    missing = EXPECTED_KEYS - set(HADES2_REQ_TYPE_EDGE_LABELS)
    assert not missing, (
        f"HADES2_REQ_TYPE_EDGE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_tooltips_cover_every_known_operator():
    missing = EXPECTED_KEYS - set(HADES2_REQ_TYPE_TOOLTIPS)
    assert not missing, (
        f"HADES2_REQ_TYPE_TOOLTIPS is missing entries for: {sorted(missing)}"
    )


def test_display_order_covers_every_known_operator():
    missing = EXPECTED_KEYS - set(HADES2_REQ_TYPE_DISPLAY_ORDER)
    assert not missing, (
        f"HADES2_REQ_TYPE_DISPLAY_ORDER is missing entries for: {sorted(missing)}"
    )


def test_labels_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_LABELS) - EXPECTED_KEYS
    assert not extras, (
        f"HADES2_REQ_TYPE_LABELS contains entries for keys no longer in "
        f"HADES2_REQ_OPERATORS | HADES2_TEXTLINE_DEPENDENCY_FIELDS: "
        f"{sorted(extras)}"
    )


def test_edge_labels_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_EDGE_LABELS) - EXPECTED_KEYS
    assert not extras, (
        f"HADES2_REQ_TYPE_EDGE_LABELS contains entries for keys no longer "
        f"in HADES2_REQ_OPERATORS | HADES2_TEXTLINE_DEPENDENCY_FIELDS: "
        f"{sorted(extras)}"
    )


def test_tooltips_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_TOOLTIPS) - EXPECTED_KEYS
    assert not extras, (
        f"HADES2_REQ_TYPE_TOOLTIPS contains entries for keys no longer in "
        f"HADES2_REQ_OPERATORS | HADES2_TEXTLINE_DEPENDENCY_FIELDS: "
        f"{sorted(extras)}"
    )


def test_display_order_has_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_DISPLAY_ORDER) - EXPECTED_KEYS
    assert not extras, (
        f"HADES2_REQ_TYPE_DISPLAY_ORDER contains entries for keys no "
        f"longer in HADES2_REQ_OPERATORS | "
        f"HADES2_TEXTLINE_DEPENDENCY_FIELDS: {sorted(extras)}"
    )


def test_display_order_has_no_duplicates():
    seen = set()
    duplicates = []
    for op in HADES2_REQ_TYPE_DISPLAY_ORDER:
        if op in seen:
            duplicates.append(op)
        seen.add(op)
    assert not duplicates, (
        f"HADES2_REQ_TYPE_DISPLAY_ORDER must not list any operator "
        f"twice: duplicates = {duplicates}"
    )


def test_edge_labels_are_unique_per_operator():
    """Every operator (including borrowed H1 textline-dependency
    fields) must have a DISTINCT short chip so the tree view never
    shows two semantically different operator types under the same
    glyph (e.g. ``HasNone`` vs ``NotHasAll`` both rendering as
    ``\u00AC``)."""
    seen: dict[str, str] = {}
    collisions: dict[str, list[str]] = {}
    for op, label in HADES2_REQ_TYPE_EDGE_LABELS.items():
        if label in seen:
            collisions.setdefault(label, [seen[label]]).append(op)
        else:
            seen[label] = op
    assert not collisions, (
        "HADES2_REQ_TYPE_EDGE_LABELS must be 1:1 but the "
        f"following labels are shared by multiple operators: {collisions}"
    )


def test_h2_operator_vocabulary_is_disjoint_from_h1_operator_vocabulary():
    """The H2 operator allowlist (``HADES2_REQ_OPERATORS``) must not
    share keys with H1's primary requirement-field vocabulary. The
    two are passed through separate per-game label dicts in
    :mod:`src.label_maps`, but the disjoint guarantee keeps it
    obvious that no operator-label could ever silently masquerade as
    an H1 field. ``HADES2_TEXTLINE_DEPENDENCY_FIELDS`` is the
    DELIBERATE overlap layer - 12 H1 field names H2 reuses for
    dialogue edges with identical semantics - and is excluded from
    this check."""
    from src.extractors.textline_set import (
        TEXTLINE_REQ_FIELDS,
        TEXTLINE_REQ_FIELDS_COUNT,
    )
    h1_fields = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
    overlap = HADES2_REQ_OPERATORS & h1_fields
    assert not overlap, (
        f"H2 operator vocabulary overlaps with H1's: {sorted(overlap)}. "
        f"H2 operators must use H2-native names; H1 field-name reuse "
        f"happens via HADES2_TEXTLINE_DEPENDENCY_FIELDS instead."
    )


def test_textline_dependency_fields_match_extractor_outputs():
    """The borrowed-from-H1 field set must exactly match the
    synthetic H1 keys the H2 extractor actually produces, from both
    sources: ``_TEXTLINE_PATH_PREFIXES`` (container-form Path records)
    and ``_FUNCTION_TEXTLINE_SYNTHETIC_KEYS`` (FunctionName records
    with textline semantics). A drift between the two would either
    leave a real synthetic field without a friendly label (regression)
    or pollute the label maps with entries the extractor can never
    emit (dead code)."""
    emitted = {
        field
        for path_ops in _TEXTLINE_PATH_PREFIXES.values()
        for field in path_ops.values()
    } | set(_FUNCTION_TEXTLINE_SYNTHETIC_KEYS)
    assert HADES2_TEXTLINE_DEPENDENCY_FIELDS == emitted, (
        f"HADES2_TEXTLINE_DEPENDENCY_FIELDS does not match the synthetic "
        f"keys produced by _TEXTLINE_PATH_PREFIXES + "
        f"_FUNCTION_TEXTLINE_SYNTHETIC_KEYS:\n"
        f"  missing from constant: {sorted(emitted - HADES2_TEXTLINE_DEPENDENCY_FIELDS)}\n"
        f"  extra in constant:     {sorted(HADES2_TEXTLINE_DEPENDENCY_FIELDS - emitted)}"
    )


def test_textline_dependency_labels_mirror_h1_wording():
    """The whole point of the borrowed-field layer is that identical
    semantics get identical wording in both games. Pin label /
    edge-label / tooltip equality for every borrowed key so a future
    H1 wording change has to flow through to H2 (or be explicitly
    diverged by removing the key from
    ``HADES2_TEXTLINE_DEPENDENCY_FIELDS``)."""
    for key in HADES2_TEXTLINE_DEPENDENCY_FIELDS:
        assert HADES2_REQ_TYPE_LABELS[key] == HADES1_REQ_TYPE_LABELS[key], (
            f"H2 label for {key!r} diverges from H1's "
            f"({HADES2_REQ_TYPE_LABELS[key]!r} vs "
            f"{HADES1_REQ_TYPE_LABELS[key]!r})."
        )
        assert HADES2_REQ_TYPE_EDGE_LABELS[key] == HADES1_REQ_TYPE_EDGE_LABELS[key], (
            f"H2 edge label for {key!r} diverges from H1's "
            f"({HADES2_REQ_TYPE_EDGE_LABELS[key]!r} vs "
            f"{HADES1_REQ_TYPE_EDGE_LABELS[key]!r})."
        )
        assert HADES2_REQ_TYPE_TOOLTIPS[key] == HADES1_REQ_TYPE_TOOLTIPS[key], (
            f"H2 tooltip for {key!r} diverges from H1's "
            f"({HADES2_REQ_TYPE_TOOLTIPS[key]!r} vs "
            f"{HADES1_REQ_TYPE_TOOLTIPS[key]!r})."
        )


def test_dependents_labels_cover_every_textline_dependency_field():
    """The dependents tree view in H2 only traverses textline-
    dependency edges (H2-native operators like ``PathTrue`` never
    produce a downstream edge), so the dependents-perspective map
    must cover exactly that subset."""
    missing = HADES2_TEXTLINE_DEPENDENCY_FIELDS - set(
        HADES2_REQ_TYPE_LABELS_DEPENDENTS
    )
    assert not missing, (
        "HADES2_REQ_TYPE_LABELS_DEPENDENTS is missing entries for: "
        f"{sorted(missing)}"
    )


def test_dependents_tooltips_cover_every_textline_dependency_field():
    missing = HADES2_TEXTLINE_DEPENDENCY_FIELDS - set(
        HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS
    )
    assert not missing, (
        "HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS is missing entries for: "
        f"{sorted(missing)}"
    )


def test_dependents_maps_have_no_stale_entries():
    """H2 has no native dependent-edge operators, so the dependents
    maps must not carry entries beyond
    ``HADES2_TEXTLINE_DEPENDENCY_FIELDS``."""
    label_extras = (
        set(HADES2_REQ_TYPE_LABELS_DEPENDENTS) - HADES2_TEXTLINE_DEPENDENCY_FIELDS
    )
    tooltip_extras = (
        set(HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS)
        - HADES2_TEXTLINE_DEPENDENCY_FIELDS
    )
    assert not label_extras and not tooltip_extras, (
        f"HADES2_REQ_TYPE_LABELS_DEPENDENTS extras: {sorted(label_extras)}; "
        f"HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS extras: {sorted(tooltip_extras)}"
    )


def test_dependents_maps_mirror_h1_wording():
    """H2's dependents labels / tooltips are sliced directly out of
    H1's so identical-semantics keys always read identically across
    games."""
    for key in HADES2_TEXTLINE_DEPENDENCY_FIELDS:
        assert (
            HADES2_REQ_TYPE_LABELS_DEPENDENTS[key]
            == HADES1_REQ_TYPE_LABELS_DEPENDENTS[key]
        ), (
            f"H2 dependents label for {key!r} diverges from H1's "
            f"({HADES2_REQ_TYPE_LABELS_DEPENDENTS[key]!r} vs "
            f"{HADES1_REQ_TYPE_LABELS_DEPENDENTS[key]!r})."
        )
        assert (
            HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS[key]
            == HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS[key]
        ), (
            f"H2 dependents tooltip for {key!r} diverges from H1's "
            f"({HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS[key]!r} vs "
            f"{HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS[key]!r})."
        )
