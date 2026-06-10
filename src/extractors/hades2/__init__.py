"""Hades II-specific extractors and supporting data.

This subpackage mirrors :mod:`src.extractors.hades1` for the second game.
H2 ships per-character Lua files (``NPCData_<Char>.lua`` x 23) rather than
a single ``NPCData.lua`` and uses a different requirement format
(``GameStateRequirements`` list of ``{Path, Operator}`` records instead of
flat ``Required.*TextLines`` fields).

Game-agnostic logic (Lua parsing, generic textline-section extraction,
graph building, merge) lives outside this subpackage and is shared
with H1.
"""

from .section_keys import (
    HADES2_TEXTLINE_SECTION_KEYS,
    HADES2_SECTION_KEY_LABELS,
)
from .speakers import HADES2_SPEAKERS
from .req_types import (
    HADES2_REQ_OPERATORS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
)
from .named_requirements import extract_named_requirements
from .req_extractor import (
    HADES2_REQUIREMENT_SET_FIELDS,
    extract_requirements,
)

__all__ = [
    "HADES2_TEXTLINE_SECTION_KEYS",
    "HADES2_SECTION_KEY_LABELS",
    "HADES2_SPEAKERS",
    "HADES2_REQ_OPERATORS",
    "HADES2_REQ_TYPE_LABELS",
    "HADES2_REQ_TYPE_EDGE_LABELS",
    "HADES2_REQ_TYPE_TOOLTIPS",
    "HADES2_REQ_TYPE_DISPLAY_ORDER",
    "extract_named_requirements",
    "HADES2_REQUIREMENT_SET_FIELDS",
    "extract_requirements",
]
