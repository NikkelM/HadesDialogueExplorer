"""Parity guard: the viewer's requirement-type sets in
``templates/viewer/requirements.js`` must stay in lockstep with the
generator's canonical ``REQUIREMENT_BLOCKING_SEMANTICS`` map.

The save-progress badge and the eligibility tracer both classify
requirement fields against these JS sets; if they drift from the data
pipeline's semantics (as a hand-maintained copy once did), dialogues get
mislabelled eligible/blocked. This test reads the JS source directly so the
drift surfaces as a failing test rather than a silent runtime bug.
"""

import re
from pathlib import Path

from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS

_REQUIREMENTS_JS = (
    Path(__file__).resolve().parents[1] / "templates" / "viewer" / "requirements.js"
)


def _extract_js_set(text: str, var_name: str) -> set:
    """Pull the string members of a ``const VAR = new Set([...])`` literal."""
    match = re.search(
        re.escape(var_name) + r"\s*=\s*new Set\(\[(.*?)\]\)",
        text,
        re.DOTALL,
    )
    assert match, f"{var_name} not found in requirements.js"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def _fields_with(semantics: str) -> set:
    return {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == semantics}


def test_js_requirement_sets_match_canonical_map():
    text = _REQUIREMENTS_JS.read_text(encoding="utf-8")
    assert _extract_js_set(text, "AND_REQ_TYPES") == _fields_with("all")
    assert _extract_js_set(text, "OR_REQ_TYPES") == _fields_with("any")
    assert _extract_js_set(text, "NEGATIVE_REQ_TYPES") == _fields_with("none")
    assert _extract_js_set(text, "COUNT_MIN_REQ_TYPES") == _fields_with("count-min")
    # The two count-permissive JS sets (global count-max + the run-count
    # cooldown fields) together cover exactly the Python "count-permissive"
    # fields. Without this, a typo in either hand-maintained set would
    # mis-evaluate save eligibility undetected.
    assert (
        _extract_js_set(text, "COUNT_MAX_REQ_TYPES")
        | _extract_js_set(text, "RUNS_SINCE_REQ_TYPES")
        == _fields_with("count-permissive")
    )


def test_js_sets_partition_every_canonical_field():
    """Every requirement field is classified by exactly one JS set, and the
    six sets together cover the whole canonical map - so neither side can add
    an unknown field or drop a known one without failing here."""
    text = _REQUIREMENTS_JS.read_text(encoding="utf-8")
    js_sets = [
        _extract_js_set(text, name)
        for name in (
            "AND_REQ_TYPES",
            "OR_REQ_TYPES",
            "NEGATIVE_REQ_TYPES",
            "COUNT_MIN_REQ_TYPES",
            "COUNT_MAX_REQ_TYPES",
            "RUNS_SINCE_REQ_TYPES",
        )
    ]
    union = set().union(*js_sets)
    # Disjoint partition: no field lives in two sets.
    assert sum(len(s) for s in js_sets) == len(union), "a field appears in two JS sets"
    # Complete: the union is exactly the canonical field set.
    assert union == set(REQUIREMENT_BLOCKING_SEMANTICS)


def test_js_evaluated_sets_exclude_run_count_fields():
    # Run-count / cooldown fields (count-permissive) aren't evaluable from a
    # save's played set, so they must appear in none of the four evaluated
    # sets.
    text = _REQUIREMENTS_JS.read_text(encoding="utf-8")
    evaluated = (
        _extract_js_set(text, "AND_REQ_TYPES")
        | _extract_js_set(text, "OR_REQ_TYPES")
        | _extract_js_set(text, "NEGATIVE_REQ_TYPES")
        | _extract_js_set(text, "COUNT_MIN_REQ_TYPES")
    )
    assert evaluated.isdisjoint(_fields_with("count-permissive"))
