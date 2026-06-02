"""
Semantic extractor for NPCData.lua (Hades 1).

The "owner" of each textline-set section is the NPC entry itself
(e.g. `NPC_Orpheus_01`).
"""

import re

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections


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
    # NPC data is normally found under "UnitSetData.NPCs". Some files instead
    # define individual top-level NPC_* assignments.
    npcs_table = None
    for key, value in parsed.items():
        if "NPC" in key and isinstance(value, LuaTable):
            if any(k.startswith("NPC_") or "NPC_" in k for k in value.keys()):
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
                result[npc_name] = _build_owner_entry(npc_name, npc_data, source_label, source_file, game_data_lists)

    for npc_name, npc_data in individual_npcs.items():
        if npc_name not in result:
            result[npc_name] = _build_owner_entry(npc_name, npc_data, source_label, source_file, game_data_lists)

    return result


def _build_owner_entry(owner_name, owner_table, source_label, source_file, game_data_lists=None):
    entry = {"source": source_label}
    entry.update(extract_textline_sections(
        owner_name, owner_table, source_file,
        game_data_lists=game_data_lists,
    ))
    return entry
