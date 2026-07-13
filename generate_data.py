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
import re
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
    extract_save_eval_static,
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
from src.extractors.hades2.god_traits import extract_god_trait_metadata
from src.extractors.hades2.named_requirements import extract_named_requirements
from src.extractors.hades2.req_extractor import extract_requirements
from src.extractors.hades2.textline_set import extract_hero_repeatable_sets
from src.extractors.textline_set import (
    reset_section_key_audit,
    get_unlisted_section_keys,
    reset_unrecognised_textline_key_audit,
    get_unrecognised_textline_keys,
    build_cue_comment_map,
    build_h2_cue_text_map,
    apply_cue_comment_texts,
    drop_textless_end_cues,
)
from src.graph import build_graph_data
from src.localization import build_localization, read_subtitles_map

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

# "Played"-family H1 requirement types whose operands are ``/VO/<cue>`` voice-
# line ids. The referenced cue's spoken line is recovered from the dev comment
# above its definition (build_cue_comment_map) and baked into ``cueTexts`` so the
# viewer shows the line instead of the raw cue id.
H1_PLAYED_REQ_TYPES = {
    "RequiredPlayed", "RequiredFalsePlayed",
    "RequiredAnyPlayed", "RequiredAnyPlayedThisRun",
    "RequiredPlayedThisRun", "RequiredPlayedThisRoom",
    "RequiredFalsePlayedThisRoom", "RequiredFalsePlayedThisRun",
}

# Cue-id prefixes that are not the speaking character's name. Intercom
# announcements play over the House public-address system but are voiced by
# Hades, so an ``Intercom_XXXX`` cue is attributed to Hades, not "Intercom".
H1_CUE_SPEAKER_OVERRIDES = {"Intercom": "Hades"}

# H2 cue-id prefixes whose friendly speaker name differs from the prefix (the
# protagonist Melinoë carries a diaeresis; Skelly's proper name is Schelemeus).
H2_CUE_SPEAKER_OVERRIDES = {"Melinoe": "Melino\u00eb", "Skelly": "Schelemeus"}

# H2 "played"-family voiceline refs are ``PathTrue`` / ``PathFalse`` records on a
# ``GameState.SpeechRecord.<cue>`` path (there is no RequiredPlayed field). The
# cue's spoken line lives in an inline ``Text`` next to the cue, recovered by
# build_h2_cue_text_map and baked into ``cueTexts``.
H2_SPEECH_PATH_OPS = ("PathTrue", "PathFalse", "Path", "PathEmpty", "PathNotEmpty")


def _collect_h2_speech_cues(textlines: dict, out: set) -> None:
    """Add every ``GameState.SpeechRecord.<cue>`` leaf referenced by a textline's
    otherRequirements (trimmed of the ``/VO/`` prefix) to ``out``."""
    for tl in (textlines or {}).values():
        for recs in (tl.get("otherRequirements") or {}).values():
            for rec in (recs if isinstance(recs, list) else [recs]):
                if not isinstance(rec, dict):
                    continue
                for op in H2_SPEECH_PATH_OPS:
                    path = rec.get(op)
                    if isinstance(path, list) and "SpeechRecord" in path:
                        i = path.index("SpeechRecord")
                        if i + 1 < len(path):
                            out.add(str(path[i + 1]).replace("/VO/", ""))

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
    en_subtitles: dict | None = None,
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

    # Recover the subtitle text of cue-only closing voicelines (EndCue /
    # EndVoiceLines) from the dev comment above each cue line in this source -
    # the cue itself carries no inline Text (H1 plays it as audio).
    apply_cue_comment_texts(
        graph_data["textlines"],
        build_cue_comment_map(lua_path.read_text(encoding="utf-8", errors="replace")),
    )
    # Fallback for cue-only closing voicelines the ``--`` comment heuristic
    # misses (it only reads the line directly above the ``EndCue``, so a cue
    # with an intervening property line - e.g. ``EndWait = 0.45,`` between the
    # comment and ``ZagreusHome_0329`` - stays text-less). The shipped English
    # voiceline subtitle CSV is the authoritative source; genuinely audio-only
    # barks (absent from it, e.g. ``CerberusWhineSad``) stay a bare cue chip.
    if en_subtitles:
        apply_cue_comment_texts(graph_data["textlines"], en_subtitles)

    # Any closing voiceline still without subtitle text after both fallbacks is an
    # audio-only sound cue (e.g. CerberusWhineSad), not a spoken line - drop it so
    # it isn't shown as a bare cue chip.
    removed = drop_textless_end_cues(graph_data["textlines"])
    if removed:
        print(f"  Dropped {removed} audio-only (subtitle-less) closing voiceline(s)")

    stats = graph_data["stats"]
    print(f"  Textlines: {stats['totalTextlines']}")
    print(f"  Dependency edges: {stats['totalEdges']}")
    if stats["duplicates"]:
        print(f"  Duplicate textline names within this file: {len(stats['duplicates'])}")

    return graph_data


def load_hades2_context(hades2_scripts: Path) -> tuple[dict, dict, dict]:
    """Load H2's shared cross-file context: NamedRequirements registry,
    NarrativeData priority annotations, and the ``HeroRepeatableTextLines``
    shared cue sets (spliced into repeatable NPC dialogues by name).

    All files are optional - returns an empty mapping for each when the
    corresponding source isn't present, so the H2 pipeline still runs
    (named refs surface as unresolved, priorities go unattached, repeatable
    shared-set branches drop).
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

    hero_path = hades2_scripts / "HeroData.lua"
    if hero_path.exists():
        print(f"Parsing Hades 2: {hero_path}")
        hero_repeatable = extract_hero_repeatable_sets(parse_lua_file(str(hero_path)))
        print(f"  HeroRepeatableTextLines shared sets: {len(hero_repeatable)}")
    else:
        print(f"SKIP HeroData.lua: file not found at {hero_path}")
        hero_repeatable = {}

    return named_reqs, priorities, hero_repeatable


def generate_hades2_source(
    output_prefix: str,
    source_label: str,
    lua_path: Path,
    extractor,
    named_requirements: dict,
    narrative_priorities: dict,
    attached_priority_keys: set,
    hero_repeatable_sets: dict = None,
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

    # Only the NPC extractor consumes the HeroRepeatableTextLines shared sets
    # (repeatable NPC dialogues splice them in); other families don't accept it.
    extra = {"hero_repeatable_sets": hero_repeatable_sets} if extractor is h2_extract_npc_data else {}
    owners = extractor(
        parsed,
        source_label=source_label,
        source_file=lua_path.name,
        named_requirements=named_requirements,
        **extra,
    )
    print(f"  Owners: {len(owners)}")

    attached = apply_narrative_priorities(
        owners, narrative_priorities, attached_keys=attached_priority_keys,
    )
    if attached:
        print(f"  Narrative priorities attached: {attached}")

    graph_data = build_graph_data(
        owners,
        speakers=HADES2_SPEAKERS,
    )
    # Drop any audio-only (subtitle-less) closing voiceline; keeps the H2 pipeline
    # consistent with H1 (currently a no-op - all H2 end cues carry text).
    drop_textless_end_cues(graph_data["textlines"])

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


def report_unrecognised_textline_keys(game_label: str) -> None:
    """Surface engine eligibility fields present on a textline that the extractor
    failed to capture - a silently-dropped eligibility gate (H1 has ~35 fields
    that don't follow the ``Require*`` naming the flat loop keys off, e.g.
    ``ConsecutiveClearsOfRoom`` / ``HasTraitNameInRoom``). Populated during the
    game's pass by :func:`src.extractors.textline_set._note_unrecognised_textline_keys`;
    silent once every such gate is captured.
    """
    unknown = get_unrecognised_textline_keys()
    if not unknown:
        return
    distinct = sorted({key for _tl, key, _src in unknown})
    print(
        f"\nWARNING ({game_label}): {len(unknown)} eligibility gate(s) across "
        f"{len(distinct)} field type(s) are present on textlines but dropped by "
        f"the extractor (not surfaced as requirements): {', '.join(distinct)}. "
        f"Capture them in the extractor so the gate isn't lost."
    )
    for tl_name, key, source_file in unknown[:10]:
        print(f"  {tl_name}.{key}  ({source_file})")
    if len(unknown) > 10:
        print(f"  ... and {len(unknown) - 10} more")


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
    for stale_pattern in ("hades1_*.json", "hades2_*.json", "loc-*.json"):
        for stale in OUTPUT_DIR.glob(stale_pattern):
            stale.unlink()

    # --- Hades 1 ---
    print("=" * 60)
    print("Hades 1")
    print("=" * 60)
    game_data_lists = load_game_data_lists(hades1_scripts)

    # Shipped English voiceline subtitles (Content/Subtitles/en) - the fallback
    # source for closing-voiceline text the in-source ``--`` comment heuristic
    # misses (see generate_source). Absent in CI, where this is an empty no-op.
    h1_subtitles_en = read_subtitles_map(hades1_scripts.parent / "Subtitles" / "en")
    if h1_subtitles_en:
        print(f"  English voiceline subtitles: {len(h1_subtitles_en)} cues (end-cue text fallback)")

    reset_section_key_audit()
    reset_unrecognised_textline_key_audit()
    # Collect the cues actually referenced by "played"-family gates across the
    # surfaced dialogues, so the viewer can render a ``RequiredPlayed`` voice-line
    # reference as its spoken line (recovered from the dev comment above the cue)
    # rather than the raw cue id.
    h1_referenced_cues: set = set()
    for output_name, source_label, lua_name, extractor in HADES1_SOURCES:
        data = generate_source(
            output_name, source_label, lua_name, extractor,
            game_data_lists, hades1_scripts, h1_subtitles_en,
        )
        if data is None:
            continue
        for tl in (data.get("textlines") or {}).values():
            for rk, rv in (tl.get("otherRequirements") or {}).items():
                if rk in H1_PLAYED_REQ_TYPES and isinstance(rv, list):
                    for ref in rv:
                        h1_referenced_cues.add(str(ref).replace("/VO/", ""))
        out_path = OUTPUT_DIR / output_name
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        print(f"  Written to: {out_path}")
    report_unlisted_section_keys("hades1")
    report_unrecognised_textline_keys("hades1")

    # The referenced cues are often defined in files that aren't textline
    # sources themselves (e.g. HeroData.lua's Zagreus barks), so recover their
    # subtitle comment across EVERY H1 source.
    h1_cue_texts_all: dict = {}
    for lua_file in sorted(hades1_scripts.glob("*.lua")):
        try:
            src_text = lua_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for cue, text in build_cue_comment_map(src_text).items():
            h1_cue_texts_all.setdefault(cue, text)

    # Resolve only the referenced cues (keeps the baked map tiny - a couple of
    # dozen entries rather than all ~12k source cue comments). Each entry carries
    # the spoken line plus its speaker (the H1 cue-id character prefix, e.g.
    # ``ZagreusHome_2930`` -> "Zagreus", ``HadesField_0625`` -> "Hades"), so the
    # viewer can annotate who says the line.
    h1_cue_texts = {}
    for cue in sorted(h1_referenced_cues):
        text = h1_cue_texts_all.get(cue)
        if not text:
            continue
        pm = re.match(r"[A-Z][a-z]+", cue)
        entry = {"text": text}
        if pm:
            entry["speaker"] = H1_CUE_SPEAKER_OVERRIDES.get(pm.group(0), pm.group(0))
        h1_cue_texts[cue] = entry
    print(
        f"  Cue-text refs: {len(h1_cue_texts)}/{len(h1_referenced_cues)} "
        f"played-family cues resolved to their spoken line"
    )

    # Standalone H1 metadata payload: the static design-data tables the
    # viewer's save-eligibility evaluator needs to resolve the Mirror /
    # weapon-enchantment / cosmetic-visible gates client-side (the engine
    # reads these from tables the save file doesn't carry), plus the recovered
    # ``cueTexts`` for played-family voice-line refs. Written as a separate JSON
    # with no ``textlines`` key so build_viewer routes it as metadata onto the
    # H1 graph_data (the same channel hades2_metadata.json uses), rather than
    # treating it as a textline source to merge.
    h1_metadata: dict = {}
    if h1_cue_texts:
        h1_metadata["cueTexts"] = h1_cue_texts
    meta_lua = hades1_scripts / "MetaUpgradeData.lua"
    weapon_lua = hades1_scripts / "WeaponUpgradeData.lua"
    if meta_lua.exists() and weapon_lua.exists():
        print(f"Parsing Hades 1: {meta_lua}")
        meta_parsed = parse_lua_file(str(meta_lua))
        print(f"Parsing Hades 1: {weapon_lua}")
        weapon_parsed = parse_lua_file(str(weapon_lua))
        loot_lua = hades1_scripts / "LootData.lua"
        loot_parsed = {}
        if loot_lua.exists():
            print(f"Parsing Hades 1: {loot_lua}")
            loot_parsed = parse_lua_file(str(loot_lua))
        trait_lua = hades1_scripts / "TraitData.lua"
        trait_parsed = {}
        if trait_lua.exists():
            print(f"Parsing Hades 1: {trait_lua}")
            trait_parsed = parse_lua_file(str(trait_lua))
        save_eval_static = extract_save_eval_static(meta_parsed, weapon_parsed, loot_parsed, trait_parsed)
        h1_metadata["h1SaveEvalStatic"] = save_eval_static
        print(
            f"  Save-eval static: {save_eval_static['metaUpgradeOrderLength']} Mirror rows, "
            f"{len(save_eval_static['shrineUpgradeOrder'])} shrine upgrades, "
            f"{len(save_eval_static['weaponUpgradeSlots'])} weapons, "
            f"{len(save_eval_static['godLootTraitIndex'])} god-loot owners, "
            f"{len(save_eval_static['keepsakeMaxChambers'])} keepsakes"
        )
    else:
        print(
            "SKIP hades1 save-eval static: MetaUpgradeData.lua / WeaponUpgradeData.lua "
            "not found - save-eval static gates will stay indeterminate."
        )
    if h1_metadata:
        meta_out = OUTPUT_DIR / "hades1_metadata.json"
        with open(meta_out, "w", encoding="utf-8") as f:
            json.dump(h1_metadata, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        print(f"  Written to: {meta_out}")

    # --- Hades 2 ---
    print()
    print("=" * 60)
    print("Hades 2")
    print("=" * 60)
    named_reqs, narrative_priorities, hero_repeatable_sets = load_hades2_context(hades2_scripts)

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
    # God-trait + restricted-boon name sets resolve the
    # RequiredSellableGodTraits / RequireUnrestrictedBoonChoices
    # FunctionName gates against the hero's equipped traits in a save.
    god_trait_meta = extract_god_trait_metadata(hades2_scripts)
    if god_trait_meta.get("godTraitNames"):
        metadata_payload["godTraitNames"] = god_trait_meta["godTraitNames"]
        metadata_payload["restrictBoonChoiceTraitNames"] = god_trait_meta["restrictBoonChoiceTraitNames"]
        print(
            f"  God traits: {len(god_trait_meta['godTraitNames'])}; "
            f"restricted-boon traits: {len(god_trait_meta['restrictBoonChoiceTraitNames'])}"
        )
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
    reset_unrecognised_textline_key_audit()
    h2_referenced_cues: set = set()
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
                hero_repeatable_sets=hero_repeatable_sets,
            )
            _collect_h2_speech_cues(data.get("textlines"), h2_referenced_cues)
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
    report_unrecognised_textline_keys("hades2")

    # Resolve the H2 voice-line cues referenced by SpeechRecord "played" gates to
    # their spoken line (inline ``Text`` next to the cue) + speaker (cue-id
    # prefix), and bake them as a small ``cueTexts`` metadata file routed onto the
    # H2 graph (same channel as hades2_metadata.json).
    h2_cue_texts_all: dict = {}
    for lua_file in sorted(hades2_scripts.glob("*.lua")):
        try:
            src_text = lua_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for cue, text in build_h2_cue_text_map(src_text).items():
            h2_cue_texts_all.setdefault(cue, text)
    h2_cue_texts = {}
    for cue in sorted(h2_referenced_cues):
        text = h2_cue_texts_all.get(cue)
        if not text:
            continue
        entry = {"text": text}
        pm = re.match(r"[A-Z][a-z]+", cue)
        if pm:
            entry["speaker"] = H2_CUE_SPEAKER_OVERRIDES.get(pm.group(0), pm.group(0))
        h2_cue_texts[cue] = entry
    print(
        f"  Cue-text refs: {len(h2_cue_texts)}/{len(h2_referenced_cues)} "
        f"SpeechRecord cues resolved to their spoken line"
    )
    if h2_cue_texts:
        cuetext_path = OUTPUT_DIR / "hades2_cuetext.json"
        with open(cuetext_path, "w", encoding="utf-8") as f:
            json.dump({"cueTexts": h2_cue_texts}, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
        print(f"  Written to: {cuetext_path}")

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

    # --- Dialogue localisation maps -------------------------------------
    # Emit one ``loc-<game>-<lang>.json`` per non-English language from the
    # games' ``Game/Text/<lang>`` sjson, filtered to the cue / text / choice /
    # speaker ids this build references. Generated locally (the game text
    # folders are absent in CI) alongside the extracted data; baked into
    # ``dist/`` by build_viewer.py. English stays inline in the base data.
    print("\n" + "=" * 60)
    print("Localisation")
    print("=" * 60)
    for game, scripts_dir, speakers_en in (
        ("hades1", hades1_scripts, HADES1_SPEAKERS),
        ("hades2", hades2_scripts, HADES2_SPEAKERS),
    ):
        text_root = scripts_dir.parent / "Game" / "Text"
        game_outputs = sorted(OUTPUT_DIR.glob(f"{game}_*.json"))
        written = build_localization(text_root, OUTPUT_DIR, game, game_outputs, speakers_en)
        print(f"  {game}: {len(written)} language file(s) -> {', '.join(written) or '(none)'}")

    print("\nDone!")


if __name__ == "__main__":
    main()
