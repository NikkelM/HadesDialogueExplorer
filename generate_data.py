"""
Parse Hades 1 game source files and generate per-source JSON data files
into ``outputs/``. Stale JSONs are removed before generation so that
renames or removed sources can't leave orphans behind.

Usage:
    python generate_data.py
"""

import json
from pathlib import Path

from src.lua_parser import parse_lua_file
from src.extractors.hades1 import (
    extract_npc_data,
    extract_deathloop_data,
    extract_loot_data,
    extract_enemy_data,
    extract_game_data_lists,
    HADES1_SPEAKER_NAMES,
)
from src.extractors.textline_set import audit_requirement_fields
from src.graph import build_graph_data

HADES1_SCRIPTS = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hades\Content\Scripts")

# Each entry: (output filename, source label, lua filename, extractor function)
HADES1_SOURCES = [
    ("hades1_npc.json",       "Hades 1", "NPCData.lua",        extract_npc_data),
    ("hades1_deathloop.json", "Hades 1", "DeathLoopData.lua",  extract_deathloop_data),
    ("hades1_loot.json",      "Hades 1", "LootData.lua",       extract_loot_data),
    ("hades1_enemy.json",     "Hades 1", "EnemyData.lua",      extract_enemy_data),
]

# TextLineSets.lua defines named string-arrays referenced by the per-source
# files via bare identifiers (e.g. `GameData.AphroditeBasicPickUpTextLines`).
# It is NOT a per-source dataset and so does not get its own output JSON
# (build_viewer.py would otherwise try to merge it as a graph dataset).
HADES1_TEXTLINE_SETS = "TextLineSets.lua"

OUTPUT_DIR = Path(__file__).parent / "outputs"


def load_game_data_lists() -> dict:
    """Parse TextLineSets.lua and return the {GameData.X: [textlines]} map.

    Returns ``{}`` when the file isn't found, so the pipeline still runs
    (just with the identifier references left unresolved).
    """
    lua_path = HADES1_SCRIPTS / HADES1_TEXTLINE_SETS
    if not lua_path.exists():
        print(f"SKIP {HADES1_TEXTLINE_SETS}: file not found at {lua_path}")
        return {}

    print(f"Parsing Hades 1: {lua_path}")
    parsed = parse_lua_file(str(lua_path))
    lists = extract_game_data_lists(parsed)
    total_refs = sum(len(v) for v in lists.values())
    print(f"  GameData.* textline lists: {len(lists)} ({total_refs} textline refs)")
    return lists


def generate_source(output_name: str, source_label: str, lua_name: str, extractor, game_data_lists: dict) -> dict:
    """Parse one Lua source file and return its graph dataset (or None)."""
    lua_path = HADES1_SCRIPTS / lua_name
    if not lua_path.exists():
        print(f"  SKIP {lua_name}: file not found at {lua_path}")
        return None

    print(f"Parsing {source_label}: {lua_path}")
    parsed = parse_lua_file(str(lua_path))

    unknown = audit_requirement_fields(parsed)
    if unknown:
        print(f"  WARNING: unknown Required*TextLine* fields: {sorted(unknown)}")

    owners = extractor(
        parsed,
        source_label=source_label,
        source_file=lua_path.name,
        game_data_lists=game_data_lists,
    )
    print(f"  Owners: {len(owners)}")

    graph_data = build_graph_data(owners, speaker_names=HADES1_SPEAKER_NAMES)

    stats = graph_data["stats"]
    print(f"  Textlines: {stats['totalTextlines']}")
    print(f"  Dependency edges: {stats['totalEdges']}")
    if stats["duplicates"]:
        print(f"  Duplicate textline names within this file: {len(stats['duplicates'])}")

    return graph_data


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Clear stale output JSONs (renames/removed sources must not linger).
    for stale in OUTPUT_DIR.glob("*.json"):
        stale.unlink()

    game_data_lists = load_game_data_lists()

    for output_name, source_label, lua_name, extractor in HADES1_SOURCES:
        data = generate_source(output_name, source_label, lua_name, extractor, game_data_lists)
        if data is None:
            continue
        out_path = OUTPUT_DIR / output_name
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        print(f"  Written to: {out_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
