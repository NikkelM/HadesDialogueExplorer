"""Invariant tests for H1's non-textline ``otherRequirements`` label /
tooltip vocabulary.

These guardrails make sure:

* every curated friendly label has a matching tooltip;
* the OtherReq vocabulary stays disjoint from the textline-set
  vocabulary in :mod:`src.extractors.hades1.req_types` (so a label or
  tooltip can never be defined twice with different wording);
* every distinct ``otherRequirements`` key encountered in the merged
  H1 dataset is covered by either the textline-set tooltip map or
  the new OtherReq tooltip map (data-driven completeness check,
  skipped when ``dist/data.json`` is absent so the test suite stays
  runnable in a fresh clone).
"""

import json
import os

import pytest

from src.extractors.textline_set import (
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
)
from src.extractors.hades1 import (
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_OTHER_REQ_LABELS,
    HADES1_OTHER_REQ_TOOLTIPS,
)


_TEXTLINE_FIELDS = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT


def test_every_other_req_label_has_a_tooltip():
    missing = set(HADES1_OTHER_REQ_LABELS) - set(HADES1_OTHER_REQ_TOOLTIPS)
    assert not missing, (
        "HADES1_OTHER_REQ_LABELS keys without a matching tooltip in "
        f"HADES1_OTHER_REQ_TOOLTIPS: {sorted(missing)}"
    )


def test_every_other_req_tooltip_has_a_label():
    """Coverage is 1:1 - every documented OtherReq field also gets a
    friendly viewer label. Without this, the long-tail fields would
    fall back to raw camel-case in the pill while still having a
    populated tooltip, which the curated-mode UI no longer expects."""
    missing = set(HADES1_OTHER_REQ_TOOLTIPS) - set(HADES1_OTHER_REQ_LABELS)
    assert not missing, (
        "HADES1_OTHER_REQ_TOOLTIPS keys without a matching friendly "
        f"label in HADES1_OTHER_REQ_LABELS: {sorted(missing)}"
    )


def test_other_req_labels_disjoint_from_textline_fields():
    overlap = set(HADES1_OTHER_REQ_LABELS) & _TEXTLINE_FIELDS
    assert not overlap, (
        "HADES1_OTHER_REQ_LABELS overlaps with textline-set "
        f"vocabulary (defined twice): {sorted(overlap)}"
    )


def test_other_req_tooltips_disjoint_from_textline_fields():
    overlap = set(HADES1_OTHER_REQ_TOOLTIPS) & _TEXTLINE_FIELDS
    assert not overlap, (
        "HADES1_OTHER_REQ_TOOLTIPS overlaps with textline-set "
        f"vocabulary (defined twice): {sorted(overlap)}"
    )


def test_other_req_labels_disjoint_from_textline_labels():
    """The merged H1 ``reqTypeLabels`` dict in ``label_maps`` is built
    by union-ing the two vocabularies; this test catches a name
    collision that would let the OtherReq dict silently overwrite a
    textline-set label (or vice versa)."""
    overlap = set(HADES1_OTHER_REQ_LABELS) & set(HADES1_REQ_TYPE_LABELS)
    assert not overlap, (
        f"H1 label vocabularies collide on: {sorted(overlap)}"
    )


def test_other_req_tooltips_disjoint_from_textline_tooltips():
    overlap = set(HADES1_OTHER_REQ_TOOLTIPS) & set(HADES1_REQ_TYPE_TOOLTIPS)
    assert not overlap, (
        f"H1 tooltip vocabularies collide on: {sorted(overlap)}"
    )


def test_curated_label_count_is_reasonable():
    """The label set is supposed to give every documented OtherReq
    field a viewer pill. Catch accidental wholesale removal early."""
    n = len(HADES1_OTHER_REQ_LABELS)
    assert n >= 100, (
        f"HADES1_OTHER_REQ_LABELS has only {n} entries; expected full "
        "coverage of every documented H1 OtherReq field (~150+). "
        "Either coverage has regressed or the labels map was "
        "accidentally truncated - revisit the source-level docstring "
        "in src/extractors/hades1/other_req_types.py."
    )


def _load_h1_other_req_keys_from_data() -> set[str] | None:
    """Returns the set of distinct ``otherRequirements`` keys observed
    on H1 textlines in ``dist/data.json``, or None if the build
    artifact is not present (fresh clone, CI before build, etc.)."""
    path = os.path.join("dist", "data.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    h1 = data.get("games", {}).get("hades1")
    if not h1 or "textlines" not in h1:
        return None
    keys: set[str] = set()
    for tl in h1["textlines"].values():
        keys.update((tl.get("otherRequirements") or {}).keys())
    return keys


def test_full_dataset_coverage_under_either_tooltip_map():
    """Every distinct ``otherRequirements`` key actually emitted by
    the H1 extractors must have a tooltip in EITHER
    HADES1_REQ_TYPE_TOOLTIPS (textline-set vocab) or
    HADES1_OTHER_REQ_TOOLTIPS (non-textline vocab). Adding a new
    requirement field that the parser starts catching will fail
    this test until a tooltip is provided.

    Skipped when ``dist/data.json`` is absent so a fresh clone can
    still run the suite before the first ``build_viewer.py``."""
    observed = _load_h1_other_req_keys_from_data()
    if observed is None:
        pytest.skip(
            "dist/data.json not present - run "
            "`python build_viewer.py` to populate the merged dataset "
            "and re-run."
        )
    covered = set(HADES1_REQ_TYPE_TOOLTIPS) | set(HADES1_OTHER_REQ_TOOLTIPS)
    uncovered = observed - covered
    assert not uncovered, (
        "H1 otherRequirements keys without a tooltip in either "
        "HADES1_REQ_TYPE_TOOLTIPS or HADES1_OTHER_REQ_TOOLTIPS: "
        f"{sorted(uncovered)}"
    )
