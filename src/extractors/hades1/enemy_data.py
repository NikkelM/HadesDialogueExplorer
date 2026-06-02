"""
Semantic extractor for EnemyData.lua (Hades 1).

The top-level table is `UnitSetData.Enemies`. Each entry (e.g. `TrainingMelee`
for Skelly, or boss names) may own `*TextLineSets` sections including the
various `BossPresentation*TextLineSets` variants for boss encounter banter.
"""

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections


def extract_enemy_data(parsed: dict, source_label: str = "", source_file: str = "", game_data_lists: dict = None) -> dict:
    result = {}

    root = parsed.get("UnitSetData.Enemies")
    if not isinstance(root, LuaTable):
        return result

    for owner_name, owner_table in root.items():
        if not isinstance(owner_table, LuaTable):
            continue
        sections = extract_textline_sections(
            owner_name, owner_table, source_file,
            game_data_lists=game_data_lists,
        )
        if any(sections.values()):
            entry = {"source": source_label}
            entry.update(sections)
            result[owner_name] = entry

    return result
