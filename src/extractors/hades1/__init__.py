"""Hades 1-specific extractors and supporting data.

This subpackage contains the per-source extractors for Hades 1's Lua
data files (``NPCData.lua``, ``DeathLoopData.lua``, ``LootData.lua``,
``EnemyData.lua``, ``TextLineSets.lua``) as well as the H1 speaker
metadata map (friendly name + description quip).

Game-agnostic logic (Lua parsing, generic textline-section extraction,
graph building, merge) lives outside this subpackage and is shared
with any future Hades II extractors.
"""

from .npc_data import extract_npc_data
from .deathloop_data import extract_deathloop_data
from .loot_data import extract_loot_data, LOOT_DEFAULT_SPEAKERS
from .enemy_data import extract_enemy_data
from .encounter_room_data import extract_encounter_room_data
from .text_line_sets import extract_game_data_lists
from .offer_text import HADES1_OFFER_TEXT_MAP
from .choice_names import HADES1_CHOICE_NAMES
from .preset_choices import HADES1_PRESET_CHOICES
from .meta_upgrades import HADES1_META_UPGRADE_NAMES
from .speakers import HADES1_SPEAKERS
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
    "extract_encounter_room_data",
    "extract_game_data_lists",
    "HADES1_OFFER_TEXT_MAP",
    "HADES1_CHOICE_NAMES",
    "HADES1_PRESET_CHOICES",
    "HADES1_META_UPGRADE_NAMES",
    "HADES1_SPEAKERS",
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
