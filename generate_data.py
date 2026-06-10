"""
Parse Hades 1 and Hades 2 game source files and generate per-source JSON
data files into ``outputs/``. Stale JSONs are removed before generation so
that renames or removed sources can't leave orphans behind.

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
    extract_encounter_room_data,
    extract_game_data_lists,
    HADES1_OFFER_TEXT_MAP,
    HADES1_PRESET_CHOICES,
    HADES1_SPEAKERS,
)
from src.extractors.hades2 import (
    extract_npc_data as h2_extract_npc_data,
    extract_deathloop_data as h2_extract_deathloop_data,
    extract_loot_data as h2_extract_loot_data,
    extract_enemy_data as h2_extract_enemy_data,
    extract_encounter_room_data as h2_extract_encounter_room_data,
    extract_narrative_priorities,
    apply_narrative_priorities,
    HADES2_SPEAKERS,
)
from src.extractors.hades2.named_requirements import extract_named_requirements
from src.graph import build_graph_data

# Each entry: (output filename, source label, lua filename, extractor function)
HADES1_SOURCES = [
    ("hades1_npc.json",          "Hades 1", "NPCData.lua",          extract_npc_data),
    ("hades1_deathloop.json",    "Hades 1", "DeathLoopData.lua",    extract_deathloop_data),
    ("hades1_loot.json",         "Hades 1", "LootData.lua",         extract_loot_data),
    ("hades1_enemy.json",        "Hades 1", "EnemyData.lua",        extract_enemy_data),
    ("hades1_encounter.json",    "Hades 1", "EncounterData.lua",    extract_encounter_room_data),
    ("hades1_room_base.json",    "Hades 1", "RoomData.lua",         extract_encounter_room_data),
    ("hades1_room_tartarus.json","Hades 1", "RoomDataTartarus.lua", extract_encounter_room_data),
    ("hades1_room_asphodel.json","Hades 1", "RoomDataAsphodel.lua", extract_encounter_room_data),
    ("hades1_room_elysium.json", "Hades 1", "RoomDataElysium.lua",  extract_encounter_room_data),
    ("hades1_room_styx.json",    "Hades 1", "RoomDataStyx.lua",     extract_encounter_room_data),
    ("hades1_room_surface.json", "Hades 1", "RoomDataSurface.lua",  extract_encounter_room_data),
    ("hades1_room_secrets.json", "Hades 1", "RoomDataSecrets.lua",  extract_encounter_room_data),
]

# TextLineSets.lua defines named string-arrays referenced by the per-source
# files via bare identifiers (e.g. `GameData.AphroditeBasicPickUpTextLines`).
# It is NOT a per-source dataset and so does not get its own output JSON
# (build_viewer.py would otherwise try to merge it as a graph dataset).
HADES1_TEXTLINE_SETS = "TextLineSets.lua"

# H2 splits per-character / per-god / per-biome / per-encounter dialogue
# data across many files, so the H2 sources are declared as globs that
# expand to one output JSON per matched Lua file at runtime. Each entry:
# (output prefix, source label, glob pattern, extractor function); the
# resulting output filename is ``{prefix}_{lua_stem}.json``.
HADES2_SOURCES = [
    # ``NPCData*.lua`` (no underscore enforced) matches both the master
    # ``NPCData.lua`` and the 23 per-character ``NPCData_<Char>.lua``
    # files. The master holds palace/Story NPCs (NPC_Nyx_01,
    # NPC_Zeus_Palace_01, NPC_Demeter_Palace_01, NPC_Zagreus_Past_01,
    # etc.) under ``UnitSetData.NPCs`` - the same regex-driven walker
    # picks them up since the extractor's discovery regex matches both
    # ``UnitSetData.NPCs`` and ``UnitSetData.NPC_<Char>``.
    ("hades2_npc",       "Hades 2", "NPCData*.lua",       h2_extract_npc_data),
    ("hades2_deathloop", "Hades 2", "DeathLoopData.lua",  h2_extract_deathloop_data),
    ("hades2_loot",      "Hades 2", "LootData*.lua",      h2_extract_loot_data),
    # ``EnemyData*.lua`` matches both the master ``EnemyData.lua`` (mook
    # templates, no dialogue) and the per-boss ``EnemyData_<Boss>.lua``
    # files (Hecate, Chronos, Prometheus, Eris, Scylla, Polyphemus,
    # Zagreus, InfestedCerberus, TyphonHead) carrying
    # BossIntroTextLineSets / BossOutroTextLineSets /
    # BossPhaseChangeTextLineSets. The empty-owner filter drops the
    # master's templates and any mook file with no dialogue sections.
    ("hades2_enemy",     "Hades 2", "EnemyData*.lua",     h2_extract_enemy_data),
    ("hades2_encounter", "Hades 2", "EncounterData*.lua", h2_extract_encounter_room_data),
    ("hades2_room",      "Hades 2", "RoomData*.lua",      h2_extract_encounter_room_data),
]

# RequirementsData.lua holds H2's ``NamedRequirementsData`` registry that
# textline-set ``NamedRequirements = { "Name" }`` refs resolve against; it
# is loaded once and passed into every H2 extractor so inline expansion
# of named refs uses the shared registry rather than re-parsing per file.
HADES2_NAMED_REQUIREMENTS_FILE = "RequirementsData.lua"

# NarrativeData.lua holds H2's per-textline priority annotations, loaded
# once and applied (in-place) to each per-file owners dict after
# extraction. Owners / textlines absent from a given file are silently
# skipped by ``apply_narrative_priorities``.
HADES2_NARRATIVE_DATA_FILE = "NarrativeData.lua"

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
        offer_text_map=HADES1_OFFER_TEXT_MAP,
        preset_choices=HADES1_PRESET_CHOICES,
    )
    print(f"  Owners: {len(owners)}")

    graph_data = build_graph_data(owners, speakers=HADES1_SPEAKERS)

    stats = graph_data["stats"]
    print(f"  Textlines: {stats['totalTextlines']}")
    print(f"  Dependency edges: {stats['totalEdges']}")
    if stats["duplicates"]:
        print(f"  Duplicate textline names within this file: {len(stats['duplicates'])}")

    return graph_data


def load_hades2_context(hades2_scripts: Path) -> tuple[dict, dict]:
    """Load H2's shared cross-file context: NamedRequirements registry
    and NarrativeData priority annotations.

    Both files are optional - returns an empty mapping for each when the
    corresponding source isn't present, so the H2 pipeline still runs
    (named refs surface as unresolved, priorities go unattached).
    """
    nr_path = hades2_scripts / HADES2_NAMED_REQUIREMENTS_FILE
    if nr_path.exists():
        print(f"Parsing Hades 2: {nr_path}")
        named_reqs = extract_named_requirements(parse_lua_file(str(nr_path)))
        print(f"  NamedRequirements: {len(named_reqs)}")
    else:
        print(f"SKIP {HADES2_NAMED_REQUIREMENTS_FILE}: file not found at {nr_path}")
        named_reqs = {}

    nd_path = hades2_scripts / HADES2_NARRATIVE_DATA_FILE
    if nd_path.exists():
        print(f"Parsing Hades 2: {nd_path}")
        priorities = extract_narrative_priorities(parse_lua_file(str(nd_path)))
        priority_count = sum(
            len(tl_map)
            for owner_sections in priorities.values()
            for tl_map in owner_sections.values()
        )
        print(f"  Narrative priorities: {priority_count} textline records across {len(priorities)} owners")
    else:
        print(f"SKIP {HADES2_NARRATIVE_DATA_FILE}: file not found at {nd_path}")
        priorities = {}

    return named_reqs, priorities


def generate_hades2_source(
    output_prefix: str,
    source_label: str,
    lua_path: Path,
    extractor,
    named_requirements: dict,
    narrative_priorities: dict,
) -> tuple[str, dict]:
    """Parse one H2 Lua source file and return ``(output_name, graph_data)``.

    Applies the shared narrative-priority annotations in place before
    building the graph, so the JSON the build pipeline consumes already
    carries the priority badges the viewer renders.
    """
    print(f"Parsing {source_label}: {lua_path}")
    parsed = parse_lua_file(str(lua_path))

    owners = extractor(
        parsed,
        source_label=source_label,
        source_file=lua_path.name,
        named_requirements=named_requirements,
    )
    print(f"  Owners: {len(owners)}")

    attached = apply_narrative_priorities(owners, narrative_priorities)
    if attached:
        print(f"  Narrative priorities attached: {attached}")

    graph_data = build_graph_data(owners, speakers=HADES2_SPEAKERS)

    stats = graph_data["stats"]
    print(f"  Textlines: {stats['totalTextlines']}")
    print(f"  Dependency edges: {stats['totalEdges']}")
    if stats["duplicates"]:
        print(f"  Duplicate textline names within this file: {len(stats['duplicates'])}")

    output_name = f"{output_prefix}_{lua_path.stem}.json"
    return output_name, graph_data


def main():
    try:
        cfg = load_config()
    except ConfigError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    hades1_scripts = cfg.hades1_scripts
    hades2_scripts = cfg.hades2_scripts

    OUTPUT_DIR.mkdir(exist_ok=True)

    # Clear stale output JSONs (renames/removed sources must not linger).
    for stale in OUTPUT_DIR.glob("*.json"):
        stale.unlink()

    # --- Hades 1 ---
    print("=" * 60)
    print("Hades 1")
    print("=" * 60)
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

    # --- Hades 2 ---
    print()
    print("=" * 60)
    print("Hades 2")
    print("=" * 60)
    named_reqs, narrative_priorities = load_hades2_context(hades2_scripts)

    for output_prefix, source_label, pattern, extractor in HADES2_SOURCES:
        matched_files = sorted(hades2_scripts.glob(pattern))
        if not matched_files:
            print(f"  SKIP {pattern}: no matching files in {hades2_scripts}")
            continue
        print(f"\n{source_label} source family: {pattern} ({len(matched_files)} files)")
        for lua_path in matched_files:
            output_name, data = generate_hades2_source(
                output_prefix, source_label, lua_path, extractor,
                named_reqs, narrative_priorities,
            )
            out_path = OUTPUT_DIR / output_name
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
                f.write("\n")
            print(f"  Written to: {out_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()
