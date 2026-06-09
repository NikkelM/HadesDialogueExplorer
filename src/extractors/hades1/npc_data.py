"""
Semantic extractor for NPCData.lua (Hades 1).

The "owner" of each textline-set section is the NPC entry itself
(e.g. `NPC_Orpheus_01`).
"""

import re

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_PRIORITY_TIER


def extract_npc_data(parsed: dict, source_label: str = "", source_file: str = "", game_data_lists: dict = None) -> dict:
    """
    Extract NPC dialogue data from a parsed Lua file.

    Returns a dict shaped like::

        {
            "NPC_Orpheus_01": {
                "source": "Hades 1",
                "InteractTextLineSets": {...},
                "GiftTextLineSets": {...},
            },
            ...
        }
    """
    # NPC data is normally found under "UnitSetData.NPCs" (matches the
    # `enemy_data` / `loot_data` / `deathloop_data` pinning style and the
    # project-wide "explicit allowlist over heuristics" philosophy).
    # Some files instead define individual top-level NPC_* assignments
    # alongside or instead of the container, so both code paths still
    # run below.
    npcs_table = None
    candidate = parsed.get("UnitSetData.NPCs")
    if isinstance(candidate, LuaTable):
        npcs_table = candidate
    else:
        # Fallback: loose scan for files using a non-standard container
        # name. No known H1 file currently triggers this path; retained
        # as a safety net for future game data that wraps the same
        # `NPC_*` children under a different parent key. First match
        # wins, so the pin above must always be tried first to avoid
        # an earlier same-substring key hijacking discovery.
        for key, value in parsed.items():
            if "NPC" in key and isinstance(value, LuaTable):
                if any("NPC_" in k for k in value.keys()):
                    npcs_table = value
                    break

    individual_npcs = {}
    for key, value in parsed.items():
        if re.match(r"\w*NPC_\w+", key) and isinstance(value, LuaTable):
            individual_npcs[key] = value

    if npcs_table is None and not individual_npcs:
        return {}

    result = {}

    if npcs_table:
        for npc_name, npc_data in npcs_table.items():
            if isinstance(npc_data, LuaTable) and "NPC_" in npc_name:
                entry = _build_owner_entry(npc_name, npc_data, source_label, source_file, game_data_lists)
                if entry is not None:
                    result[npc_name] = entry

    for npc_name, npc_data in individual_npcs.items():
        if npc_name not in result:
            entry = _build_owner_entry(npc_name, npc_data, source_label, source_file, game_data_lists)
            if entry is not None:
                result[npc_name] = entry

    return result


def _build_owner_entry(owner_name, owner_table, source_label, source_file, game_data_lists=None):
    """Return an owner entry for the NPC, or ``None`` if it contributed
    no textline sections.

    Returning ``None`` lets the calling loops skip skeleton NPCs that
    are pure shared-component templates (``NPC_Giftable``,
    ``NPC_Neutral``) or empty ``{}`` stubs that inherit from a parent
    NPC. Mirrors the ``if any(sections.values()):`` filter in
    ``enemy_data`` / ``loot_data`` / ``deathloop_data`` so per-file
    ``stats.totalOwners`` reflects owners that actually contribute
    dialogue.
    """
    sections = extract_textline_sections(
        owner_name, owner_table, source_file,
        section_keys=HADES1_TEXTLINE_SECTION_KEYS,
        game_data_lists=game_data_lists,
        section_priority_tiers=HADES1_SECTION_KEY_PRIORITY_TIER,
    )
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
