"""
Parse Hades 1 game source files and generate per-source JSON data files
into ``outputs/``. Stale JSONs are removed before generation so that
renames or removed sources can't leave orphans behind.

Local paths (which Steam install to read from) live in ``config.toml`` at
the repo root - copy ``config.example.toml`` to ``config.toml`` and edit
it before running.

Usage:
    python generate_data.py
"""

import json
import sys
from pathlib import Path

from src.config import ConfigError, load_config
from src.lua_parser import parse_lua_file
from src.extractors.hades1 import (
    extract_npc_data,
    extract_deathloop_data,
    extract_loot_data,
    extract_enemy_data,
    extract_game_data_lists,
    HADES1_SPEAKERS,
)
from src.graph import build_graph_data

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


def load_game_data_lists(hades1_scripts: Path) -> dict:
    """Parse TextLineSets.lua and return the {GameData.X: [textlines]} map.

    Returns ``{}`` when the file isn't found, so the pipeline still runs
    (just with the identifier references left unresolved).
    """
    lua_path = hades1_scripts / HADES1_TEXTLINE_SETS
    if not lua_path.exists():
        print(f"SKIP {HADES1_TEXTLINE_SETS}: file not found at {lua_path}")
        return {}

    print(f"Parsing Hades 1: {lua_path}")
    parsed = parse_lua_file(str(lua_path))
    lists = extract_game_data_lists(parsed)
    total_refs = sum(len(v) for v in lists.values())
    print(f"  GameData.* textline lists: {len(lists)} ({total_refs} textline refs)")
    return lists


def generate_source(
    output_name: str,
    source_label: str,
    lua_name: str,
    extractor,
    game_data_lists: dict,
    hades1_scripts: Path,
) -> dict:
    """Parse one Lua source file and return its graph dataset (or None)."""
    lua_path = hades1_scripts / lua_name
    if not lua_path.exists():
        print(f"  SKIP {lua_name}: file not found at {lua_path}")
        return None

    print(f"Parsing {source_label}: {lua_path}")
    parsed = parse_lua_file(str(lua_path))

    owners = extractor(
        parsed,
        source_label=source_label,
        source_file=lua_path.name,
        game_data_lists=game_data_lists,
    )
    print(f"  Owners: {len(owners)}")

    graph_data = build_graph_data(owners, speakers=HADES1_SPEAKERS)

    stats = graph_data["stats"]
    print(f"  Textlines: {stats['totalTextlines']}")
    print(f"  Dependency edges: {stats['totalEdges']}")
    if stats["duplicates"]:
        print(f"  Duplicate textline names within this file: {len(stats['duplicates'])}")

    return graph_data


def main():
    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    hades1_scripts = cfg.hades1_scripts

    OUTPUT_DIR.mkdir(exist_ok=True)

    # Clear stale output JSONs (renames/removed sources must not linger).
    for stale in OUTPUT_DIR.glob("*.json"):
        stale.unlink()

    game_data_lists = load_game_data_lists(hades1_scripts)

    for output_name, source_label, lua_name, extractor in HADES1_SOURCES:
        data = generate_source(
            output_name, source_label, lua_name, extractor,
            game_data_lists, hades1_scripts,
        )
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
