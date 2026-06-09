"""
Semantic extractor for NPCData.lua (Hades 1).

The "owner" of each textline-set section is the NPC entry itself
(e.g. `NPC_Orpheus_01`).
"""

import re

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_PRIORITY_TIER


# Textlines that ship in the game data but are dev-test artefacts the
# tool should not surface. Filtered out post-extraction so they don't
# pollute the owner list, dependency graph, or save-file matchers.
#
# - ``TestArgument``: the only textline on ``NPC_Skelly_01``'s NPCData
#   entry (NPCData.lua:24671) - a stub with no ``Cue`` / ``Text`` and
#   the structural fields ``PlayOnce`` / ``AngleTowardTarget`` /
#   ``UseableOffSource``. All of Skelly's real dialogue lives under
#   his ``TrainingMelee`` enemy definition in EnemyData.lua; filtering
#   this stub leaves no leftover textlines on the NPC entry so the
#   empty owner is dropped entirely.
EXCLUDED_TEXTLINE_NAMES = {
    "TestArgument",
}


# NPC entry aliases. Some NPCData entries are thin variant wrappers that
# ``InheritFrom`` a parent NPC and only exist to group a handful of
# scene-specific textlines under a tagged owner key. We re-key those
# entries onto the canonical NPC so all of that character's dialogue
# accumulates under one owner in the viewer. Per-line speakers that
# referenced the alias get rewritten to the canonical id too, so the
# speaker label in the dialogue list matches the new owner.
#
# - ``NPC_Hades_Story_01`` (NPCData.lua:5259) is annotated "used in
#   special scenes" and inherits from ``NPC_Hades_01``. It only
#   contains the two ``Hades_Flashback_DayNightJob_*`` lines from the
#   childhood flashback; they're the same character speaking, so they
#   belong under the main ``NPC_Hades_01`` owner.
OWNER_NAME_ALIASES = {
    "NPC_Hades_Story_01": "NPC_Hades_01",
}


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
    # NPC data is normally found under "UnitSetData.NPCs" (matches the
    # `enemy_data` / `loot_data` / `deathloop_data` pinning style and the
    # project-wide "explicit allowlist over heuristics" philosophy).
    # Some files instead define individual top-level NPC_* assignments
    # alongside or instead of the container, so both code paths still
    # run below.
    npcs_table = None
    candidate = parsed.get("UnitSetData.NPCs")
    if isinstance(candidate, LuaTable):
        npcs_table = candidate
    else:
        # Fallback: loose scan for files using a non-standard container
        # name. No known H1 file currently triggers this path; retained
        # as a safety net for future game data that wraps the same
        # `NPC_*` children under a different parent key. First match
        # wins, so the pin above must always be tried first to avoid
        # an earlier same-substring key hijacking discovery.
        for key, value in parsed.items():
            if "NPC" in key and isinstance(value, LuaTable):
                if any("NPC_" in k for k in value.keys()):
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
                _add_entry(result, npc_name, npc_data, source_label, source_file, game_data_lists)

    for npc_name, npc_data in individual_npcs.items():
        # The dedup check uses the resolved (post-alias) owner key so
        # an alias entry doesn't get extracted twice when it appears
        # in both ``individual_npcs`` and ``npcs_table``.
        if _resolve_owner(npc_name) not in result or npc_name not in result:
            _add_entry(result, npc_name, npc_data, source_label, source_file, game_data_lists)

    return result


def _resolve_owner(npc_name: str) -> str:
    """Map an NPC entry name to its canonical owner key, applying any
    declared alias. Non-aliased names pass through unchanged."""
    return OWNER_NAME_ALIASES.get(npc_name, npc_name)


def _add_entry(result, npc_name, npc_data, source_label, source_file, game_data_lists):
    """Build an owner entry for ``npc_name`` and merge it into ``result``
    under the resolved (post-alias) owner key. Aliased entries
    accumulate their sections into the canonical owner's existing
    entry without overwriting same-named textlines."""
    entry = _build_owner_entry(npc_name, npc_data, source_label, source_file, game_data_lists)
    if entry is None:
        return
    owner_key = _resolve_owner(npc_name)
    if owner_key == npc_name:
        result.setdefault(owner_key, entry)
        return
    # Aliased: merge sections into the canonical owner's entry. Don't
    # clobber the canonical entry's ``source`` label (the alias may have
    # been read from the same source so this is usually a no-op, but
    # keep the canonical metadata authoritative either way).
    target = result.setdefault(owner_key, {"source": source_label})
    for section_key, tl_map in entry.items():
        if section_key == "source":
            continue
        existing = target.setdefault(section_key, {})
        for tl_name, tl_data in tl_map.items():
            existing.setdefault(tl_name, tl_data)


def _build_owner_entry(owner_name, owner_table, source_label, source_file, game_data_lists=None):
    """Return an owner entry for the NPC, or ``None`` if it contributed
    no textline sections.

    Returning ``None`` lets the calling loops skip skeleton NPCs that
    are pure shared-component templates (``NPC_Giftable``,
    ``NPC_Neutral``) or empty ``{}`` stubs that inherit from a parent
    NPC. Mirrors the ``if any(sections.values()):`` filter in
    ``enemy_data`` / ``loot_data`` / ``deathloop_data`` so per-file
    ``stats.totalOwners`` reflects owners that actually contribute
    dialogue.

    The default speaker used to fill in implicit-speaker lines is the
    resolved (post-alias) owner name, so aliased entries' lines
    surface under the canonical speaker id rather than the alias.
    """
    default_speaker = _resolve_owner(owner_name)
    sections = extract_textline_sections(
        owner_name, owner_table, source_file,
        section_keys=HADES1_TEXTLINE_SECTION_KEYS,
        default_speaker=default_speaker,
        game_data_lists=game_data_lists,
        section_priority_tiers=HADES1_SECTION_KEY_PRIORITY_TIER,
    )
    if EXCLUDED_TEXTLINE_NAMES:
        for tl_map in sections.values():
            for tl_name in list(tl_map.keys()):
                if tl_name in EXCLUDED_TEXTLINE_NAMES:
                    del tl_map[tl_name]
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
