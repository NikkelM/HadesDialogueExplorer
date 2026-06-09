"""Lock the invariants of the Hades 1 requirement-type label maps.

These tests act as a guardrail so future additions to
``TEXTLINE_REQ_FIELDS`` / ``TEXTLINE_REQ_FIELDS_COUNT`` (or future
edits to the per-game label maps) keep the viewer's lookups complete
and the shorthand chips 1:1.

The edge-label shorthand must be DISTINCT per field so the tree view's
chips do not collapse semantically different requirement types onto
the same glyph.
"""

from src.extractors.textline_set import (
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
)
from src.extractors.hades1 import (
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
)


ALL_FIELDS = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT


def test_labels_cover_every_known_field():
    missing = ALL_FIELDS - set(HADES1_REQ_TYPE_LABELS)
    assert not missing, (
        f"HADES1_REQ_TYPE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_edge_labels_cover_every_known_field():
    missing = ALL_FIELDS - set(HADES1_REQ_TYPE_EDGE_LABELS)
    assert not missing, (
        f"HADES1_REQ_TYPE_EDGE_LABELS is missing entries for: {sorted(missing)}"
    )


def test_tooltips_cover_every_known_field():
    missing = ALL_FIELDS - set(HADES1_REQ_TYPE_TOOLTIPS)
    assert not missing, (
        f"HADES1_REQ_TYPE_TOOLTIPS is missing entries for: {sorted(missing)}"
    )


def test_display_order_covers_every_known_field():
    missing = ALL_FIELDS - set(HADES1_REQ_TYPE_DISPLAY_ORDER)
    assert not missing, (
        f"HADES1_REQ_TYPE_DISPLAY_ORDER is missing entries for: {sorted(missing)}"
    )


def test_edge_labels_have_no_stale_entries():
    extras = set(HADES1_REQ_TYPE_EDGE_LABELS) - ALL_FIELDS
    assert not extras, (
        f"HADES1_REQ_TYPE_EDGE_LABELS contains entries for fields no "
        f"longer in TEXTLINE_REQ_FIELDS / _COUNT: {sorted(extras)}"
    )


def test_edge_labels_are_unique_per_field():
    """Every requirement type must have a DISTINCT short chip so the
    tree view never shows two semantically different field types
    under the same glyph (e.g. RequiredFalseTextLines vs
    RequiredFalseTextLinesThisRun both rendering as ``\u00AC``)."""
    seen: dict[str, str] = {}
    collisions: dict[str, list[str]] = {}
    for field, label in HADES1_REQ_TYPE_EDGE_LABELS.items():
        if label in seen:
            collisions.setdefault(label, [seen[label]]).append(field)
        else:
            seen[label] = field
    assert not collisions, (
        "HADES1_REQ_TYPE_EDGE_LABELS must be 1:1 but the "
        f"following labels are shared by multiple fields: {collisions}"
    )
