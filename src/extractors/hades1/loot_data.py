"""
Semantic extractor for LootData.lua (Hades 1).

Each top-level entry under `LootData` (e.g. `ZeusUpgrade`, `AthenaUpgrade`)
owns several `*TextLineSets` sections describing god boon dialogues. The
owner is the upgrade key itself; the default speaker for lines without an
explicit Speaker is the canonical god NPC id (so search/group/filter sees
one speaker per god, not one per boon table).
"""

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS

# Maps `LootData.<key>` -> canonical speaker id for that boon. Lines without
# an explicit `Speaker` default to this id rather than the owner key.
LOOT_DEFAULT_SPEAKERS = {
    "ZeusUpgrade": "NPC_Zeus_01",
    "PoseidonUpgrade": "NPC_Poseidon_01",
    "AthenaUpgrade": "NPC_Athena_01",
    "AphroditeUpgrade": "NPC_Aphrodite_01",
    "ArtemisUpgrade": "NPC_Artemis_01",
    "AresUpgrade": "NPC_Ares_01",
    "DionysusUpgrade": "NPC_Dionysus_01",
    "DemeterUpgrade": "NPC_Demeter_01",
    "HermesUpgrade": "NPC_Hermes_01",
    "TrialUpgrade": "NPC_Chaos_01",
}


def extract_loot_data(parsed: dict, source_label: str = "", source_file: str = "", game_data_lists: dict = None) -> dict:
    result = {}

    root = parsed.get("LootData")
    if not isinstance(root, LuaTable):
        return result

    for owner_name, owner_table in root.items():
        if not isinstance(owner_table, LuaTable):
            continue
        sections = extract_textline_sections(
            owner_name, owner_table, source_file,
            section_keys=HADES1_TEXTLINE_SECTION_KEYS,
            default_speaker=LOOT_DEFAULT_SPEAKERS.get(owner_name),
            game_data_lists=game_data_lists,
        )
        if any(sections.values()):
            entry = {"source": source_label}
            entry.update(sections)
            result[owner_name] = entry

    return result
