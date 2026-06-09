"""
Semantic extractor for ``EncounterData.lua`` and the ``RoomData*.lua``
family (Hades 1).

Both source kinds use the same idea but at different nesting depths:

* ``EncounterData``: textlines live under ``TextLineSet = { <Name> = {...} }``
  nested inside ``<Encounter>.StartRoomUnthreadedEvents[i].Args
  .AddEncounterEvent.Args``. Requirements for the textline are on the
  enclosing event block's ``GameStateRequirements`` (two levels up from
  the textline-set container), NOT on the textline-set table itself.
* ``RoomData*``: textlines live under ``ForcedTextLines = { <Name> = {...} }``
  nested inside a ``Boon``-shaped entry of a room's ``ForcedRewards``
  array. ``GameStateRequirements`` is a sibling of ``ForcedTextLines``
  on the Boon entry.

For both, the cue array of each textline carries voice-over paths like
``/VO/Poseidon_0148`` or ``/VO/MegaeraField_0031`` but most cues do not
declare a ``Speaker``. The path prefix (``Poseidon``, ``MegaeraField``,
...) maps deterministically to a known speaker id, so we derive the
fallback speaker per-cue from the cue path rather than letting it
default to the (non-speaker) owner name.

Owner naming uses the topmost named ancestor below the root (the
encounter name for ``EncounterData``, the room name for ``RoomData*``).
Every textline inside an encounter / room therefore groups under a
single owner entry, regardless of how deeply nested its textline-set
container actually is.

One exception: textlines living inside an
``InspectPoints[<id>]`` container have the same ambient-narration role
as their DeathLoopData counterparts, so we reuse
:data:`~src.extractors.hades1.deathloop_data.IDMAP_PARENT_OWNER_OVERRIDES`
to collapse them to ``Storyteller`` instead of leaving them under the
room name. The room/encounter name only stays as the owner for
non-InspectPoint textlines (e.g. ``ForcedTextLines`` Poseidon quest
lines in ``RoomOpening`` keep ``RoomOpening`` as the owner, but the
two Storyteller inspect lines in the same room move to ``Storyteller``).
"""

import re

from ...lua_parser import LuaTable
from ..textline_set import (
    extract_textline_sections,
    collect_local_requirements,
    merge_ancestor_requirements,
)
from ...graph import resolve_duplicate, attach_variant
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_PRIORITY_TIER
from .deathloop_data import IDMAP_PARENT_OWNER_OVERRIDES

# Per-textline-name owner overrides for synthetic encounter/room owners
# that aren't well-served by the topmost-named-ancestor rule. Keyed by
# the textline's own name (not the encounter/room ancestor) and applied
# post-extraction to re-route the textline under a real character entry
# instead of the structural encounter name.
#
# Covers two cases:
#
# - ``Story_Sisyphus_01`` (EncounterData.lua:5201) groups 6 mixed-speaker
#   dialogues that the player encounters during Sisyphus's appearances
#   in the Tartarus reward chamber. Each line is a back-and-forth
#   between Sisyphus and either Megaera or Thanatos, with Sisyphus
#   driving the conversation, so Sisyphus is the more natural owner
#   and the visiting NPC is the partner (mirrors the explicit
#   ``Partner = "..."`` field that NPCData.lua uses on similar xWithY
#   pairs - see ``textline_set.py`` for native partner capture).
#
# - ``RoomOpening`` hosts two Poseidon-only ``ForcedTextLines`` (the
#   fishing quest pitch and the wrath intro) which live in
#   ``ForcedRewards`` rather than ``InspectPoints``, so they bypass
#   the parametric Storyteller collapse. They're spoken solo by
#   Poseidon, so they belong under ``PoseidonUpgrade`` directly
#   (the owner key all his other dialogue lives under, from LootData).
TEXTLINE_OWNER_OVERRIDES = {
    "MegaeraWithSisyphus01": {"owner": "NPC_Sisyphus_01", "partner": "NPC_FurySister_01"},
    "MegaeraWithSisyphus02": {"owner": "NPC_Sisyphus_01", "partner": "NPC_FurySister_01"},
    "MegaeraWithSisyphus03": {"owner": "NPC_Sisyphus_01", "partner": "NPC_FurySister_01"},
    "ThanatosWithSisyphus01": {"owner": "NPC_Sisyphus_01", "partner": "NPC_Thanatos_01"},
    "ThanatosWithSisyphus02": {"owner": "NPC_Sisyphus_01", "partner": "NPC_Thanatos_01"},
    "ThanatosWithSisyphus03": {"owner": "NPC_Sisyphus_01", "partner": "NPC_Thanatos_01"},
    "PoseidonFishQuest01": {"owner": "PoseidonUpgrade"},
    "PoseidonWrathIntro01": {"owner": "PoseidonUpgrade"},
}

# Textlines that ship in the game data but are dev-test artefacts the
# tool should not surface. Filtered out post-extraction so they don't
# pollute the owner list, dependency graph, or save-file matchers.
#
# - ``PersephoneVOTest1``: only textline in the unreachable ``TestNPCs``
#   room (``RoomData.lua:519``). Wraps a single dev test cue
#   (``/VO/Persephone_0018``) of Persephone's farewell letter read
#   aloud; real shipped dialogue lives elsewhere.
EXCLUDED_TEXTLINE_NAMES = {
    "PersephoneVOTest1",
}

# Defensive cap mirroring the DeathLoopData walker. EncounterData /
# RoomData trees are shallow (max real depth well under 20); anything
# beyond this points at a cycle introduced by a future parser change.
_WALK_OWNERS_MAX_DEPTH = 64

# Top-level keys that name a root subtree this extractor knows how to
# walk. ``RoomSetData.*`` is matched by prefix because each RoomData file
# defines its own region key (``RoomSetData.Tartarus``, ``.Elysium``,
# etc.). ``EncounterData`` is the only top-level for EncounterData.lua.
_ENCOUNTER_ROOT = "EncounterData"
_ROOM_ROOT_PREFIX = "RoomSetData."

# Voice-over cue path prefix -> canonical speaker id. The cue paths use
# narrative-variant tags (``MegaeraField`` vs ``MegaeraHome``) which all
# collapse to a single speaker for our purposes. ``ZagreusScratch`` is
# scratch-recording variants reusing the protagonist's cues.
CUE_PATH_SPEAKERS = {
    "Achilles":       "NPC_Achilles_01",
    "Alecto":         "NPC_FurySister_02",
    "Charon":         "NPC_Charon_01",
    "Eurydice":       "NPC_Eurydice_01",
    "Hades":          "NPC_Hades_01",
    "MegaeraField":   "NPC_FurySister_01",
    "MegaeraHome":    "NPC_FurySister_01",
    "Patroclus":      "NPC_Patroclus_01",
    "Poseidon":       "NPC_Poseidon_01",
    "Sisyphus":       "NPC_Sisyphus_01",
    "Storyteller":    "Storyteller",
    "Thanatos":       "NPC_Thanatos_01",
    "ThanatosField":  "NPC_Thanatos_01",
    "Tisiphone":      "NPC_FurySister_03",
    "ZagreusField":   "CharProtag",
    "ZagreusHome":    "CharProtag",
    "ZagreusScratch": "CharProtag",
}

_CUE_PATH_RE = re.compile(r"^/VO/([A-Za-z]+?)_\d")


def _cue_speaker_resolver(cue_entry):
    """Per-cue speaker fallback for EncounterData / RoomData cues.

    Returns the speaker id derived from the cue's ``/VO/<Prefix>_NNNN``
    path, or ``None`` if the cue has no recognizable path. Cues with an
    explicit ``Speaker = ...`` field never reach this function (they're
    handled upstream in ``extract_textline``).
    """
    cue = cue_entry.get("Cue")
    if not isinstance(cue, str):
        return None
    m = _CUE_PATH_RE.match(cue)
    if not m:
        return None
    return CUE_PATH_SPEAKERS.get(m.group(1))


def extract_encounter_room_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
) -> dict:
    """Walk every EncounterData / RoomSetData.* root in ``parsed`` and pull
    out every container that holds at least one textline-set section.

    Multiple containers under the same top-level encounter / room name
    get merged into a single owner entry whose sections accumulate.
    """
    result = {}

    roots = []
    for key, value in parsed.items():
        if not isinstance(value, LuaTable):
            continue
        if key == _ENCOUNTER_ROOT or key.startswith(_ROOM_ROOT_PREFIX):
            roots.append(value)

    if not roots:
        return result

    for root in roots:
        for owner_name, owner_table, default_speaker, ancestor_reqs in _walk_owners(root):
            sections = extract_textline_sections(
                owner_name, owner_table, source_file,
                section_keys=HADES1_TEXTLINE_SECTION_KEYS,
                default_speaker=default_speaker,
                game_data_lists=game_data_lists,
                section_priority_tiers=HADES1_SECTION_KEY_PRIORITY_TIER,
                cue_speaker_resolver=_cue_speaker_resolver,
            )

            # Drop dev-test / unwanted textlines before the empty-sections
            # check so that an owner whose only textline is filtered out
            # is also skipped (rather than leaking an empty owner entry).
            if EXCLUDED_TEXTLINE_NAMES:
                for tl_map in sections.values():
                    for tl_name in list(tl_map.keys()):
                        if tl_name in EXCLUDED_TEXTLINE_NAMES:
                            del tl_map[tl_name]

            # Re-route per-textline overrides (e.g. xWithSisyphus lines
            # from the structural ``Story_Sisyphus_01`` encounter onto
            # ``NPC_Sisyphus_01``). Detach the matching textlines from
            # ``sections`` here; we'll merge them into the override
            # owner's entry below so they sit alongside Sisyphus's own
            # NPCData lines after build_viewer cross-source merge.
            rerouted = []  # list[(override_owner, section_key, tl_name, tl_data)]
            if TEXTLINE_OWNER_OVERRIDES:
                for section_key, tl_map in sections.items():
                    for tl_name in list(tl_map.keys()):
                        override = TEXTLINE_OWNER_OVERRIDES.get(tl_name)
                        if override is None:
                            continue
                        tl_data = tl_map.pop(tl_name)
                        partner = override.get("partner")
                        if partner is not None:
                            tl_data.setdefault("partner", partner)
                        rerouted.append(
                            (override["owner"], section_key, tl_name, tl_data)
                        )

            if not any(sections.values()) and not rerouted:
                continue

            if ancestor_reqs is not None:
                for tl_map in sections.values():
                    for tl in tl_map.values():
                        merge_ancestor_requirements(tl, ancestor_reqs, game_data_lists)
                for _override_owner, _sk, _name, tl in rerouted:
                    merge_ancestor_requirements(tl, ancestor_reqs, game_data_lists)

            for override_owner, section_key, tl_name, tl_data in rerouted:
                override_entry = result.setdefault(override_owner, {"source": source_label})
                override_section = override_entry.setdefault(section_key, {})
                # If a duplicate slips in (shouldn't with the current
                # override set, but be defensive against future entries),
                # keep the first definition deterministically.
                if tl_name not in override_section:
                    override_section[tl_name] = tl_data

            if not any(sections.values()):
                continue

            entry = result.setdefault(owner_name, {"source": source_label})
            for section_key, tl_map in sections.items():
                existing = entry.setdefault(section_key, {})
                for tl_name, tl_data in tl_map.items():
                    if tl_name not in existing:
                        existing[tl_name] = tl_data
                        continue
                    # Within-owner name collision: multiple containers
                    # under the same encounter/room name expose the same
                    # textline name (e.g. ``A_Shop01`` defining
                    # ``CharonFirstInspect`` in two different inspect
                    # points). The engine treats these as the same logical
                    # textline (``TextLinesRecord`` is keyed by name) and
                    # only ever plays one of them per save. Merge them
                    # into a single ``variants``-bearing entry so the
                    # viewer can surface every distinct dialogue text;
                    # cross-file / cross-owner collisions are caught
                    # further downstream by ``build_graph_data`` and
                    # ``graph_merge``.
                    existing_tl = existing[tl_name]
                    chosen, dropped = resolve_duplicate(existing_tl, tl_data)
                    if chosen is tl_data:
                        existing[tl_name] = tl_data
                        attach_variant(
                            tl_data,
                            existing_tl,
                            kept_owner=owner_name,
                            kept_section=section_key,
                            dropped_owner=owner_name,
                            dropped_section=section_key,
                        )
                    else:
                        attach_variant(
                            existing_tl,
                            tl_data,
                            kept_owner=owner_name,
                            kept_section=section_key,
                            dropped_owner=owner_name,
                            dropped_section=section_key,
                        )

    return result


def _walk_owners(node, path=(), ancestor_reqs=None):
    """Yield ``(owner_name, owner_table, default_speaker, ancestor_requirements)``
    for every table that contains at least one textline-set section.

    ``ancestor_requirements`` is the nearest enclosing block's combined
    requirement set: union of any ``GameStateRequirements`` sub-table and
    any direct-sibling ``Required*`` fields on that block (see
    ``collect_local_requirements``). Replace-on-encounter rather than
    union across levels: each level's reqs gate only its own subtree, so
    a closer block fully overrides an outer one once it declares its own.

    Numeric-id children under a named parent map (e.g.
    ``InspectPoints = { [510795] = {...} }``) get tagged ``idmap`` so
    the owner resolver can apply the same
    :data:`IDMAP_PARENT_OWNER_OVERRIDES` parametric collapse used by
    the DeathLoopData extractor. The shipping RoomData
    files use this idmap form for inspect points; the array form
    ``InspectPoints = { { ObjectId = ..., ... } }`` is left untagged
    and keeps the room name as its owner.
    """
    if len(path) > _WALK_OWNERS_MAX_DEPTH:
        tail = " -> ".join(repr(seg) for seg in path[-8:])
        raise ValueError(
            f"EncounterRoom walker exceeded max depth "
            f"{_WALK_OWNERS_MAX_DEPTH} (path tail: ... -> {tail}). "
            f"This likely indicates a cycle introduced by a parser change "
            f"or malformed Lua input."
        )

    if not isinstance(node, LuaTable):
        return

    own_reqs = collect_local_requirements(node)
    if own_reqs is not None:
        ancestor_reqs = own_reqs

    if _has_textline_section(node):
        yield _owner_name_for(path), node, _default_speaker_for(path), ancestor_reqs

    parent_name = path[-1][1] if (path and path[-1][0] == "named") else None

    for k, v in node.items():
        if k.isdigit() and parent_name is not None:
            yield from _walk_owners(v, path + (("idmap", k, parent_name),), ancestor_reqs)
        else:
            yield from _walk_owners(v, path + (("named", k),), ancestor_reqs)

    for i, v in enumerate(node.array):
        yield from _walk_owners(v, path + (("array", i),), ancestor_reqs)


def _has_textline_section(table: LuaTable) -> bool:
    return any(
        k in HADES1_TEXTLINE_SECTION_KEYS and isinstance(v, LuaTable)
        for k, v in table.items()
    )


def _owner_name_for(path) -> str:
    """Use the topmost named ancestor as the owner, with one exception:
    any path passing through an idmap segment whose parent map is in
    :data:`IDMAP_PARENT_OWNER_OVERRIDES` collapses to that mapped owner
    (e.g. ``InspectPoints[<id>]`` -> ``Storyteller``).

    For ``EncounterData.<Encounter>.StartRoomUnthreadedEvents[i].Args.
    AddEncounterEvent.Args`` the default ancestor is the encounter name
    (e.g. ``Story_Sisyphus_01``). For ``RoomSetData.<Region>.<Room>.
    ForcedRewards[i]`` it is the room name (e.g. ``RoomOpening``). The
    InspectPoint collapse fires before either of these because the
    ambient inspect lines have the same ``Storyteller`` voice
    regardless of which room they describe.
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, _, parent_name = segment
            collapsed = IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
            if collapsed is not None:
                return collapsed
            break  # Inner idmap parent isn't a parametric collapse, keep walking out.
    for segment in path:
        if segment[0] == "named":
            return segment[1]
    return "Unnamed"


def _default_speaker_for(path) -> str:
    """Per-line default speaker fallback for lines without explicit
    ``Speaker = ...`` AND whose cue path doesn't resolve via
    :func:`_cue_speaker_resolver`.

    Mirrors :func:`_owner_name_for`: when the path collapses under
    :data:`IDMAP_PARENT_OWNER_OVERRIDES` (e.g. InspectPoints ->
    Storyteller), use that collapsed owner as the default speaker too
    instead of falling back to the room name. For everything else we
    return ``None`` so ``extract_textline_sections`` falls back to the
    owner name (the existing behaviour for non-InspectPoint paths).
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, _, parent_name = segment
            return IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
    return None
