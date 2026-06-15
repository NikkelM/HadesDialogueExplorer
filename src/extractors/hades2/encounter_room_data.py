"""
Semantic extractor for Hades II ``EncounterData_*.lua`` and the
``RoomData<L>.lua`` family (one file per biome letter).

Both source kinds share the same shape: a top-level container
(``EncounterData`` for the encounter files, ``RoomSetData.<L>`` for each
room file) keyed by encounter or room name, with textline-set sections
buried several layers deep inside the per-room / per-encounter subtree.

The textline-bearing paths observed in current H2 data are:

* ``RoomSetData.<L>.<Room>.InspectPoints.<idmap>.InteractTextLineSets``
  - ambient narrator dialogue; collapses to
  :data:`HUB_NARRATOR_SPEAKER` (same rule as
  :mod:`.deathloop_data`).
* ``RoomSetData.Q.Q_Story01.ObstacleData.<idmap>.InteractTextLineSets``
  - the boon-exit prompts (7 textlines all routed under
  ``PlayerUnit`` via :data:`TEXTLINE_OWNER_OVERRIDES` because
  Melinoë opens every set, with Hecate as a respondent).
* ``RoomSetData.I.<Room>.ObstacleData.<idmap>.OnUsedFunctionArgs.TextLineSet.<TextLineName>``
  - the True Ending family-reunion scene (``TrueEnding02``, routed
  under Persephone who opens the scene).
* ``EncounterData.<Encounter>.UnthreadedEvents.[i].Args.TextLineSet.<TextLineName>``
  - rare event-triggered narrative interludes (Story_Narcissus_01,
  Story_EndCredits).

Owner naming rules (in priority order):

1. Per-textline :data:`TEXTLINE_OWNER_OVERRIDES` re-route mixed-speaker
   ``xWithY`` style dialogue and structural-encounter textlines onto
   the natural NPC owner, mirroring the H1 convention.
2. Idmap-collapse for any path whose immediate parent is ``InspectPoints``
   - those textlines are unattributed narrator prose and all flow to
   :data:`HUB_NARRATOR_SPEAKER` regardless of which room they belong to.
3. Otherwise the topmost named ancestor below the root is the owner
   (the encounter name for ``EncounterData``, the room name for
   ``RoomSetData.*``).

Ancestor-level requirements (``GameStateRequirements``,
``OnUsedGameStateRequirements``, ``SetupGameStateRequirements`` and the
rest of :data:`HADES2_REQUIREMENT_SET_FIELDS`) declared on any block
above a textline-set container are lifted onto each contained textline
via :func:`merge_ancestor_requirements_h2`. The nearest declaring
ancestor wins (a closer container's requirements fully replace an
outer one's once it declares any of its own).
"""

from ...lua_parser import LuaTable
from ...graph import resolve_duplicate, attach_variant
from .textline_set import (
    extract_textline_sections,
    merge_ancestor_requirements_h2,
    has_local_h2_requirements,
)
from .section_keys import HADES2_TEXTLINE_SECTION_KEYS
from .owner_overrides import (
    HUB_NARRATOR_SPEAKER,
    TEXTLINE_OWNER_OVERRIDES,
    IDMAP_PARENT_OWNER_OVERRIDES,
)


# Top-level root key prefixes this extractor knows how to walk.
# ``EncounterData`` is a single top-level for every ``EncounterData_*.lua``
# file (data is injected via the parser-unwrapped ``OverwriteTableKeys``
# call). ``RoomSetData.`` is a prefix because each ``RoomData<L>.lua``
# defines its own biome key (``RoomSetData.F``, ``.G``, ``.H``, ...).
_ENCOUNTER_ROOT = "EncounterData"
_ROOM_ROOT_PREFIX = "RoomSetData."


# Defensive cap mirroring the H1 walker. EncounterData / RoomData trees
# are shallow in practice (max real depth well under 20); anything
# beyond this points at a cycle introduced by a future parser change.
_WALK_OWNERS_MAX_DEPTH = 64


def extract_encounter_room_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
) -> dict:
    """Walk every ``EncounterData`` / ``RoomSetData.*`` root in ``parsed``
    and pull out every container that holds at least one textline-set
    section.

    Multiple containers under the same top-level encounter / room name
    get merged into a single owner entry whose sections accumulate.
    Per-textline :data:`TEXTLINE_OWNER_OVERRIDES` re-route the listed
    textlines onto a different owner (typically a real NPC speaker id)
    before the merge so they end up alongside that NPC's other
    dialogue rather than under a synthetic encounter / room name.

    ``game_data_lists`` / ``offer_text_map`` / ``preset_choices`` are
    accepted for pipeline API compatibility (current H2 walker has no
    use for them; mirrors the NPC / Loot / Enemy / DeathLoop signatures).
    ``named_requirements`` is the registry returned by
    :func:`src.extractors.hades2.named_requirements.extract_named_requirements`.
    """
    roots = []
    for key, value in parsed.items():
        if not isinstance(value, LuaTable):
            continue
        if key == _ENCOUNTER_ROOT or key.startswith(_ROOM_ROOT_PREFIX):
            roots.append(value)

    if not roots:
        return {}

    result: dict = {}
    for root in roots:
        for owner_name, owner_table, default_speaker, ancestor in _walk_owners(root):
            sections = extract_textline_sections(
                owner_name, owner_table, source_file,
                section_keys=HADES2_TEXTLINE_SECTION_KEYS,
                default_speaker=default_speaker,
                named_requirements=named_requirements,
            )

            # Re-route per-textline overrides onto their target owner
            # entries. Pop from the structural-owner sections first so
            # the override-owner gets a clean copy.
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

            if ancestor is not None:
                for tl_map in sections.values():
                    for tl in tl_map.values():
                        merge_ancestor_requirements_h2(tl, ancestor, named_requirements)
                for _override_owner, _sk, _name, tl in rerouted:
                    merge_ancestor_requirements_h2(tl, ancestor, named_requirements)

            for override_owner, section_key, tl_name, tl_data in rerouted:
                override_entry = result.setdefault(override_owner, {"source": source_label})
                override_section = override_entry.setdefault(section_key, {})
                # Defensive insert-if-absent: a duplicate would mean
                # the same overridden textline name appears in two
                # different encounter / room subtrees. Keep the first
                # definition deterministically (the file iteration
                # order is alphabetical via ``glob`` in
                # ``generate_data.py``).
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
                    # Within-owner name collision: merge via the richer-
                    # wins picker, same convention as the H1 walker.
                    existing_tl = existing[tl_name]
                    chosen, _dropped = resolve_duplicate(existing_tl, tl_data)
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


def _walk_owners(node, path=(), ancestor=None):
    """Yield ``(owner_name, owner_table, default_speaker, ancestor_table)``
    for every table that contains at least one textline-set section.

    ``ancestor`` is the nearest enclosing :class:`LuaTable` declaring at
    least one field in :data:`HADES2_REQUIREMENT_SET_FIELDS`. Replace-on-
    encounter rather than union across levels: each declaring block's
    requirements gate only its own subtree, so a closer block fully
    overrides an outer one once it declares any of its own.

    Numeric-id children under a named parent map (e.g.
    ``InspectPoints = { [510795] = {...} }``) get tagged ``idmap`` so
    the owner resolver can apply the :data:`IDMAP_PARENT_OWNER_OVERRIDES`
    parametric collapse. ``ObstacleData = { [<id>] = {...} }`` uses the
    same idmap form but isn't in the collapse map, so its textlines
    keep the room name as their owner (then optionally re-routed by
    :data:`TEXTLINE_OWNER_OVERRIDES`).
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

    if has_local_h2_requirements(node):
        ancestor = node

    if _has_textline_section(node):
        yield _owner_name_for(path), node, _default_speaker_for(path), ancestor

    parent_name = path[-1][1] if (path and path[-1][0] == "named") else None

    for k, v in node.items():
        if k.isdigit() and parent_name is not None:
            yield from _walk_owners(v, path + (("idmap", k, parent_name),), ancestor)
        else:
            yield from _walk_owners(v, path + (("named", k),), ancestor)

    for i, v in enumerate(node.array):
        yield from _walk_owners(v, path + (("array", i),), ancestor)


def _has_textline_section(table: LuaTable) -> bool:
    return any(
        k in HADES2_TEXTLINE_SECTION_KEYS and isinstance(v, LuaTable)
        for k, v in table.items()
    )


def _owner_name_for(path) -> str:
    """Topmost named ancestor below the root, with one exception:
    paths passing through an idmap segment whose parent name is in
    :data:`IDMAP_PARENT_OWNER_OVERRIDES` collapse to that mapped owner
    (e.g. ``InspectPoints[<id>]`` -> ``Speaker_Homer``).
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, _, parent_name = segment
            collapsed = IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
            if collapsed is not None:
                return collapsed
            break  # inner idmap parent isn't a parametric collapse, keep walking out
    for segment in path:
        if segment[0] == "named":
            return segment[1]
    return "Unnamed"


def _default_speaker_for(path) -> str:
    """Per-line default-speaker fallback for cues lacking an explicit
    ``Speaker`` and ``UsePlayerSource``. Mirrors :func:`_owner_name_for`:
    when the path collapses under :data:`IDMAP_PARENT_OWNER_OVERRIDES`,
    use that collapsed owner as the default speaker too instead of
    falling back to the room / encounter name. For everything else we
    return ``None`` so ``extract_textline_sections`` falls back to the
    owner name (the existing behaviour for non-InspectPoint paths).
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, _, parent_name = segment
            return IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
    return None
