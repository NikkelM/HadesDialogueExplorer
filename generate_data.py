"""
Parse game source files and generate JSON data into the outputs/ folder.

Usage:
    python generate_data.py

Outputs:
    outputs/hades1.json  - Hades 1 dialogue graph data
"""

import json
from pathlib import Path

from src.parser import parse_lua_file
from src.graph import build_graph_data

# Game data source paths
SOURCES = {
    "Hades 1": {
        "npc_data": Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hades\Content\Scripts\NPCData.lua"),
    },
}

OUTPUT_DIR = Path(__file__).parent / "outputs"


def generate_hades1():
    """Parse Hades 1 data and write JSON output."""
    source = SOURCES["Hades 1"]
    npc_path = source["npc_data"]

    if not npc_path.exists():
        print(f"ERROR: Hades 1 not found at {npc_path}")
        return None

    print(f"Parsing Hades 1: {npc_path}")
    npcs = parse_lua_file(str(npc_path))

    # Tag all NPCs with source
    for npc_data in npcs.values():
        npc_data["source"] = "Hades 1"

    print(f"  Found {len(npcs)} NPCs")

    graph_data = build_graph_data(npcs)

    print(f"  Textlines: {graph_data['stats']['totalTextlines']}")
    print(f"  Dependency edges: {graph_data['stats']['totalEdges']}")
    print(f"  External references: {len(graph_data['stats']['unresolvedRefs'])}")

    return graph_data


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Generate Hades 1 data
    hades1_data = generate_hades1()
    if hades1_data:
        output_path = OUTPUT_DIR / "hades1.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(hades1_data, f, separators=(",", ":"))
        print(f"  Written to: {output_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
