"""Hades 1-specific extractors and supporting data.

This subpackage contains the per-source extractors for Hades 1's Lua
data files (``NPCData.lua``, ``DeathLoopData.lua``, ``LootData.lua``,
``EnemyData.lua``, ``TextLineSets.lua``) as well as the H1 speaker-id
to display-name map.

Game-agnostic logic (Lua parsing, generic textline-section extraction,
graph building, merge) lives outside this subpackage and is shared
with any future Hades II extractors.
"""

from .npc_data import extract_npc_data
from .deathloop_data import extract_deathloop_data
from .loot_data import extract_loot_data, LOOT_DEFAULT_SPEAKERS
from .enemy_data import extract_enemy_data
from .text_line_sets import extract_game_data_lists
from .speaker_names import HADES1_SPEAKER_NAMES
from .section_keys import (
    HADES1_TEXTLINE_SECTION_KEYS,
    HADES1_SECTION_KEY_LABELS,
    HADES1_SECTION_KEY_PRIORITY_TIER,
)
from .req_types import (
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
)
from .unresolved_refs import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
)

__all__ = [
    "extract_npc_data",
    "extract_deathloop_data",
    "extract_loot_data",
    "LOOT_DEFAULT_SPEAKERS",
    "extract_enemy_data",
    "extract_game_data_lists",
    "HADES1_SPEAKER_NAMES",
    "HADES1_TEXTLINE_SECTION_KEYS",
    "HADES1_SECTION_KEY_LABELS",
    "HADES1_SECTION_KEY_PRIORITY_TIER",
    "HADES1_REQ_TYPE_LABELS",
    "HADES1_REQ_TYPE_EDGE_LABELS",
    "HADES1_REQ_TYPE_TOOLTIPS",
    "HADES1_REQ_TYPE_DISPLAY_ORDER",
    "HADES1_KNOWN_UNRESOLVED_REFS",
    "UNRESOLVED_CATEGORY_LABELS",
    "UNRESOLVED_CATEGORY_DESCRIPTIONS",
]
