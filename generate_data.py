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
    find_unattached_priority_groups,
    HADES2_SPEAKERS,
)
from src.extractors.hades2.gamedata_refs import extract_gamedata_refs
from src.extractors.hades2.named_requirements import extract_named_requirements
from src.extractors.hades2.req_extractor import extract_requirements
from src.extractors.textline_set import (
    reset_section_key_audit,
    get_unlisted_section_keys,
)
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
    attached_priority_keys: set,
) -> tuple[str, dict]:
    """Parse one H2 Lua source file and return ``(output_name, graph_data)``.

    Applies the shared narrative-priority annotations in place before
    building the graph, so the JSON the build pipeline consumes already
    carries the priority badges the viewer renders.
    ``attached_priority_keys`` is a shared accumulator; every
    ``(owner, section, textline)`` tuple this source attached is
    recorded into it so :func:`main` can report unconsumed priority
    records at the end of the H2 pass.
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

    attached = apply_narrative_priorities(
        owners, narrative_priorities, attached_keys=attached_priority_keys,
    )
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


def report_unlisted_section_keys(game_label: str) -> None:
    """Surface owner-level keys that look like textline-set sections and
    carry data but were dropped because they are not in the per-game
    allowlist. Populated by the walkers during the game's pass (see
    :func:`src.extractors.textline_set._note_unlisted_section_key`);
    silent when every section-shaped owner-level key is allowlisted.

    This is the data->allowlist half of the section-key audit; the
    allowlist->data half (allowlisted keys that matched zero containers)
    lives in :func:`src.section_key_audit.audit_section_keys`, which runs
    against the merged per-game graph in the build pipeline.
    """
    unlisted = get_unlisted_section_keys()
    if not unlisted:
        return
    print(
        f"\nWARNING ({game_label}): {len(unlisted)} owner-level textline-set "
        f"section key(s) carry data but are not in the allowlist - they were "
        f"dropped. Add them to the game's section-key allowlist, or confirm "
        f"the exclusion is intended."
    )
    for owner, key, source_file in unlisted[:10]:
        print(f"  {owner}.{key}  ({source_file})")
    if len(unlisted) > 10:
        print(f"  ... and {len(unlisted) - 10} more")


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
    # Restricted to the prefixes this script writes (``hades1_*``,
    # ``hades2_*``) so user-dropped diagnostic JSONs, saved queries, or
    # release notes in ``outputs/`` aren't wiped on rebuilds.
    for stale_pattern in ("hades1_*.json", "hades2_*.json"):
        for stale in OUTPUT_DIR.glob(stale_pattern):
            stale.unlink()

    # --- Hades 1 ---
    print("=" * 60)
    print("Hades 1")
    print("=" * 60)
    game_data_lists = load_game_data_lists(hades1_scripts)

    reset_section_key_audit()
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
    report_unlisted_section_keys("hades1")

    # --- Hades 2 ---
    print()
    print("=" * 60)
    print("Hades 2")
    print("=" * 60)
    named_reqs, narrative_priorities = load_hades2_context(hades2_scripts)

    # Accumulator for cross-source orphan-priority audit (see end of
    # this function). Every ``apply_narrative_priorities`` call below
    # records its attached ``(owner, section, textline)`` tuples here;
    # the difference against the full key set surfaces NarrativeData
    # records that no source consumed - typically a sign that an
    # extractor section-key rename has drifted from the NarrativeData
    # reference.
    attached_priority_keys: set = set()

    # Standalone metadata payload: GameData/ScreenData/QuestOrderData
    # registry tables that ``otherRequirements`` records reference via
    # ``<ref:Name>`` placeholders, plus the resolved NamedRequirements
    # registry so the viewer can inline-expand each NamedRequirements*
    # entry into the underlying requirement chain. Shipped as a
    # separate JSON so the build_viewer pipeline can attach it to the
    # H2 graph_data without going through the textline merger (which
    # would drop the extra top-level field). The file has no
    # ``textlines`` key, which is the signal build_viewer uses to
    # route it as metadata.
    gamedata_refs = extract_gamedata_refs(hades2_scripts)
    # Pre-resolve every named requirement into the same normalised
    # ``{requirements, otherRequirements, orBranches, flags}`` shape
    # the per-textline extractor produces, so the viewer can render
    # each entry with the exact same machinery used for the host
    # textline's requirements block. Recursion is bounded by the
    # walker's built-in ``_visited`` cycle guard.
    named_req_resolved = {
        name: extract_requirements(table, named_reqs)
        for name, table in named_reqs.items()
    }
    metadata_payload = {}
    if gamedata_refs:
        metadata_payload["gameDataRefs"] = gamedata_refs
        print(f"  GameData / ScreenData / QuestOrderData refs: {len(gamedata_refs)} tables")
    if named_req_resolved:
        metadata_payload["namedRequirements"] = named_req_resolved
        print(f"  NamedRequirements (resolved): {len(named_req_resolved)} entries")
    if metadata_payload:
        metadata_path = OUTPUT_DIR / "hades2_metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata_payload, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        print(f"  Written to: {metadata_path}")

    reset_section_key_audit()
    for output_prefix, source_label, pattern, extractor in HADES2_SOURCES:
        matched_files = sorted(hades2_scripts.glob(pattern))
        if not matched_files:
            print(f"  SKIP {pattern}: no matching files in {hades2_scripts}")
            continue
        print(f"\n{source_label} source family: {pattern} ({len(matched_files)} files)")
        skipped_empty = 0
        for lua_path in matched_files:
            output_name, data = generate_hades2_source(
                output_prefix, source_label, lua_path, extractor,
                named_reqs, narrative_priorities,
                attached_priority_keys,
            )
            # Skip writing per-source JSONs that hold zero textlines.
            # Each empty stub still carries the full ~9 KB speakers /
            # stats scaffolding even though it contributes nothing to
            # the merged graph; ~100 H2 files (most EnemyData_* mooks
            # and EncounterData_* / RoomData* without dialogue) fall
            # into this bucket. Skipping them keeps ``outputs/``
            # readable when investigating real data and avoids
            # re-writing identical-shaped stubs on every run.
            if not data.get("textlines"):
                skipped_empty += 1
                continue
            out_path = OUTPUT_DIR / output_name
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
                f.write("\n")
            print(f"  Written to: {out_path}")
        if skipped_empty:
            print(f"  Skipped {skipped_empty} empty-textlines file(s) in this family.")
    report_unlisted_section_keys("hades2")

    # Cross-source orphan-priority audit: every (owner, section,
    # textline) tuple present in ``narrative_priorities`` should have
    # been attached by exactly one source's call to
    # ``apply_narrative_priorities``. Residuals indicate the
    # extractor section-key allowlist, an owner id, or a textline name
    # has drifted from the NarrativeData reference - dropping them
    # silently would violate the "audits over silent skips" doctrine.
    # ``find_unattached_priority_groups`` filters out cluster sub-
    # entries whose leader did attach (pure ordering hints with no
    # body), so the surfaced list focuses on likely real drift.
    orphan_priority_keys = find_unattached_priority_groups(
        narrative_priorities, attached_priority_keys,
    )
    if orphan_priority_keys:
        print(
            f"\nWARNING: {len(orphan_priority_keys)} NarrativeData priority "
            f"group(s) had no matching textline in any H2 source. "
            f"Likely an owner / section-key / textline-name rename."
        )
        for owner_id, section_key, textline_name in orphan_priority_keys[:10]:
            print(f"  {owner_id}.{section_key}.{textline_name}")
        if len(orphan_priority_keys) > 10:
            print(f"  ... and {len(orphan_priority_keys) - 10} more")

    print("\nDone!")


if __name__ == "__main__":
    main()
