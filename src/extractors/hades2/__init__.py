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

__all__ = [
    "HADES2_TEXTLINE_SECTION_KEYS",
    "HADES2_SECTION_KEY_LABELS",
    "HADES2_SPEAKERS",
]
