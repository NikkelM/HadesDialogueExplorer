"""Lock the invariants of the Hades II requirement-operator label maps.

These tests mirror :mod:`tests.hades1.test_req_types` to act as a
guardrail so future additions to ``HADES2_REQ_OPERATORS`` (or future
edits to the per-game label maps) keep the viewer's lookups complete
and the shorthand chips 1:1.

The edge-label shorthand must be DISTINCT per operator so the tree
view's chips do not collapse semantically different requirement types
onto the same glyph.
"""

from src.extractors.hades2 import (
    HADES2_REQ_OPERATORS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
)


def test_labels_cover_every_known_operator():
    missing = HADES2_REQ_OPERATORS - set(HADES2_REQ_TYPE_LABELS)
    assert not missing, (
        f"HADES2_REQ_TYPE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_edge_labels_cover_every_known_operator():
    missing = HADES2_REQ_OPERATORS - set(HADES2_REQ_TYPE_EDGE_LABELS)
    assert not missing, (
        f"HADES2_REQ_TYPE_EDGE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_tooltips_cover_every_known_operator():
    missing = HADES2_REQ_OPERATORS - set(HADES2_REQ_TYPE_TOOLTIPS)
    assert not missing, (
        f"HADES2_REQ_TYPE_TOOLTIPS is missing entries for: {sorted(missing)}"
    )


def test_display_order_covers_every_known_operator():
    missing = HADES2_REQ_OPERATORS - set(HADES2_REQ_TYPE_DISPLAY_ORDER)
    assert not missing, (
        f"HADES2_REQ_TYPE_DISPLAY_ORDER is missing entries for: {sorted(missing)}"
    )


def test_labels_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_LABELS) - HADES2_REQ_OPERATORS
    assert not extras, (
        f"HADES2_REQ_TYPE_LABELS contains entries for operators no "
        f"longer in HADES2_REQ_OPERATORS: {sorted(extras)}"
    )


def test_edge_labels_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_EDGE_LABELS) - HADES2_REQ_OPERATORS
    assert not extras, (
        f"HADES2_REQ_TYPE_EDGE_LABELS contains entries for operators no "
        f"longer in HADES2_REQ_OPERATORS: {sorted(extras)}"
    )


def test_tooltips_have_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_TOOLTIPS) - HADES2_REQ_OPERATORS
    assert not extras, (
        f"HADES2_REQ_TYPE_TOOLTIPS contains entries for operators no "
        f"longer in HADES2_REQ_OPERATORS: {sorted(extras)}"
    )


def test_display_order_has_no_stale_entries():
    extras = set(HADES2_REQ_TYPE_DISPLAY_ORDER) - HADES2_REQ_OPERATORS
    assert not extras, (
        f"HADES2_REQ_TYPE_DISPLAY_ORDER contains entries for operators "
        f"no longer in HADES2_REQ_OPERATORS: {sorted(extras)}"
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
    """Every operator must have a DISTINCT short chip so the tree
    view never shows two semantically different operator types under
    the same glyph (e.g. ``HasNone`` vs ``NotHasAll`` both rendering
    as ``\u00AC``)."""
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


def test_h2_vocabulary_is_disjoint_from_h1():
    """H1 and H2 use disjoint requirement-field vocabularies; the
    merge in :mod:`src.label_maps` assumes no overlap so a value
    from one game cannot silently overwrite the other's. If this
    test fires, the merge order in ``_REQ_TYPE_LABEL_SOURCES``
    starts mattering and the assumption needs revisiting."""
    from src.extractors.textline_set import (
        TEXTLINE_REQ_FIELDS,
        TEXTLINE_REQ_FIELDS_COUNT,
    )
    h1_fields = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT
    overlap = HADES2_REQ_OPERATORS & h1_fields
    assert not overlap, (
        f"H2 operator vocabulary overlaps with H1's: {sorted(overlap)}. "
        f"Each game's label maps would silently overwrite the other's "
        f"in the merged viewer lookup."
    )
