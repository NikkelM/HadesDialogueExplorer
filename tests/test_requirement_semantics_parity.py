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


def test_js_sets_exclude_count_based_fields():
    text = _REQUIREMENTS_JS.read_text(encoding="utf-8")
    evaluated = (
        _extract_js_set(text, "AND_REQ_TYPES")
        | _extract_js_set(text, "OR_REQ_TYPES")
        | _extract_js_set(text, "NEGATIVE_REQ_TYPES")
    )
    count_fields = _fields_with("count-min") | _fields_with("count-permissive")
    assert evaluated.isdisjoint(count_fields)
