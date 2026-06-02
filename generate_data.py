"""
Parse game source files and generate JSON data into the outputs/ folder.

Usage:
    python generate_data.py

Outputs:
    outputs/hades1.json  - Hades 1 dialogue graph data
"""

import json
from pathlib import Path

from src.lua_parser import parse_lua_file
from src.extractors.npc_data import extract_npc_data
from src.graph import build_graph_data
from src.speaker_names import HADES1_SPEAKER_NAMES

# Game data source paths
SOURCES = {
    "Hades 1": {
        "npc_data": Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hades\Content\Scripts\NPCData.lua"),
        "speaker_names": HADES1_SPEAKER_NAMES,
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
    parsed = parse_lua_file(str(npc_path))
    npcs = extract_npc_data(parsed, source_label="Hades 1", source_file=npc_path.name)
    print(f"  Found {len(npcs)} NPCs")

    speaker_names = source["speaker_names"]
    graph_data = build_graph_data(npcs, speaker_names=speaker_names)

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
