"""
Semantic extractor for DeathLoopData.lua (Hades 1).

TextLineSets here are nested deep inside various subtables of each
``DeathLoopData.<DeathArea>`` entry (most commonly under ``InspectPoints``,
sometimes under ``ObstacleData`` or other named maps). Singular
``TextLineSet`` sections also appear nested inside distance-trigger event
configurations.

Owner attribution model:

  1. **Parametric collapse**: any path containing an idmap segment whose
     parent map is in :data:`IDMAP_PARENT_OWNER_OVERRIDES` collapses to a
     single shared owner. Currently this is ``InspectPoints -> Storyteller``:
     all inspect-point entries are ambient narration spoken by the
     Narrator, and the synthetic ``InspectPoint_<id>`` owner surfaced
     nothing useful in the viewer. The per-textline
     ``sourceFile:sourceLine`` pointer (preserved by
     :func:`extract_textline`) is the traceback mechanism back to the
     original container.

  2. **Manual per-id attribution**: every other synthetic owner is
     produced verbatim (``ObstacleData_<id>``,
     ``DeathArea_StartUnthreadedEvents_<n>``, etc.) and then looked up
     in :data:`SYNTHETIC_OWNER_OVERRIDES`. When matched, the entry is
     re-keyed under the real owner (Skelly, Persephone, etc.) and the
     real owner is also used as the default speaker for any line in
     that block without an explicit ``Speaker = ...``. Unmapped
     synthetic owners keep their raw synthetic name (we'd rather expose
     a clearly-synthetic name than misattribute it).

  3. Otherwise: the closest meaningful named ancestor, disambiguated by
     array index if needed (e.g. ``StartUnthreadedEvents_4``).
"""

from ...lua_parser import LuaTable
from ..textline_set import (
    extract_textline_sections,
    collect_local_requirements,
    merge_ancestor_requirements,
)
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_PRIORITY_TIER

# Parametric idmap collapse. Any path passing through an idmap segment
# whose parent map name is a key here resolves to the mapped owner.
# ``InspectPoints -> Storyteller`` covers all ~370 inspect-point entries
# (audited to be uniformly Narrator-spoken ambient lines), avoiding a
# 370-entry override map for what is structurally a single rule. Other
# idmap parents (e.g. ``ObstacleData``) are NOT parametric because the
# real owners vary per-id - they go through :data:`SYNTHETIC_OWNER_OVERRIDES`.
IDMAP_PARENT_OWNER_OVERRIDES = {
    "InspectPoints": "Storyteller",
}

# Per-synthetic-id manual attribution map, keyed by the raw synthetic
# owner name the walker produces (e.g. ``ObstacleData_487120``,
# ``DeathAreaBedroom_StartUnthreadedEvents_1``). Hand-maintained: each
# entry was confirmed against the surrounding Lua context. Each value:
#
#   ``owner``    -> real speaker id (must exist in HADES1_SPEAKERS).
#                   Used both as the owner key in the result dict AND as
#                   the per-line default speaker fallback for lines in
#                   that block without an explicit ``Speaker = ...``
#                   (e.g. Skelly's TrophyQuest_* lines).
#   ``partner``  -> optional second speaker for mixed-speaker scenes,
#                   injected as the ``partner`` field on each contained
#                   textline (rendered as "Partner: <name>" in the
#                   viewer's info panel). Only used for
#                   ``DeathAreaBedroom_StartUnthreadedEvents_9``
#                   (MegaeraWithThanatosBedroom01) where the
#                   textline-name primary (Megaera) is the owner and
#                   the other speaker (Thanatos) is the partner.
#
# Notes:
#   - ``NPC_FurySister_01`` is the canonical id for the "house Megaera"
#     speaker in this codebase (the boss form is ``Harpy``).
#   - ``CharProtag`` is the canonical id for Zagreus (renders as
#     "Zagreus" via HADES1_SPEAKERS).
#   - ``TrainingMelee`` is the canonical id for Skelly. He's structurally
#     an enemy (training-dummy) definition in EnemyData.lua, where the
#     bulk of his dialogue lives; all his content is consolidated under
#     that single owner so the viewer surfaces one Skelly entry.
#   - Unmapped synthetic owners (e.g. a future ``ObstacleData_<newid>``)
#     keep their raw name rather than silently defaulting to Storyteller;
#     missing attributions surface visibly in the viewer rather than
#     hiding behind a wrong owner.
SYNTHETIC_OWNER_OVERRIDES = {
    # ObstacleData_<id>: trophy plinths + flashback obstacle + badge seller.
    "ObstacleData_310036": {"owner": "Storyteller"},
    "ObstacleData_487120": {"owner": "TrainingMelee"},
    "ObstacleData_487421": {"owner": "TrainingMelee"},
    "ObstacleData_487422": {"owner": "TrainingMelee"},
    "ObstacleData_555853": {"owner": "CharProtag"},
    # DeathAreaBedroom_StartUnthreadedEvents_<n>: bedroom-scene triggers.
    "DeathAreaBedroom_StartUnthreadedEvents_1": {"owner": "NPC_FurySister_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_2": {"owner": "NPC_FurySister_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_3": {"owner": "NPC_FurySister_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_4": {"owner": "NPC_FurySister_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_5": {"owner": "NPC_FurySister_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_6": {"owner": "NPC_Thanatos_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_7": {"owner": "NPC_Thanatos_01"},
    "DeathAreaBedroom_StartUnthreadedEvents_9": {
        "owner": "NPC_FurySister_01",
        "partner": "NPC_Thanatos_01",
    },
    # DeathArea_StartUnthreadedEvents_<n>: ending trigger in the main area.
    "DeathArea_StartUnthreadedEvents_4": {"owner": "NPC_Persephone_01"},
}

# Path segment names that are too generic to be a useful owner label.
# Walking up the path skips these to find a meaningful ancestor.
GENERIC_PATH_NAMES = {
    "Args",
    "DistanceTrigger",
    "TextLineSet",
    "TextLineSets",
    "InteractTextLineSets",
    "TextLines",
}

# Defensive depth cap on ``_walk_owners``. Hades data is finite and
# well-shaped (max real-world depth is well under 20), so any walk that
# exceeds this bound indicates either a cycle introduced by a future
# parser change or a malformed Lua input. Matches the project-wide
# "fail loud" idiom rather than risking a silent ``RecursionError``.
_WALK_OWNERS_MAX_DEPTH = 64


def extract_deathloop_data(parsed: dict, source_label: str = "", source_file: str = "", game_data_lists: dict = None) -> dict:
    """
    Walk the DeathLoopData tree and pull out every owner that contains at
    least one `*TextLineSets` (or singular `TextLineSet`) section. Returns
    the same shape as the NPC extractor.
    """
    result = {}

    root = parsed.get("DeathLoopData")
    if not isinstance(root, LuaTable):
        return result

    for synthetic_owner, owner_table, path_default_speaker, ancestor_reqs in _walk_owners(root):
        # Per-id manual attribution. When the walker yields a
        # synthetic owner that the override map recognises, re-key the
        # entry under the real owner AND use the real owner as the
        # default speaker for any line that doesn't declare its own
        # ``Speaker = ...`` (e.g. Skelly's TrophyQuest_* lines on the
        # ObstacleData plinths).
        override = SYNTHETIC_OWNER_OVERRIDES.get(synthetic_owner)
        if override is not None:
            owner_name = override["owner"]
            owner_default_speaker = override["owner"]
            partner = override.get("partner")
        else:
            owner_name = synthetic_owner
            owner_default_speaker = path_default_speaker
            partner = None

        sections = extract_textline_sections(
            owner_name, owner_table, source_file,
            section_keys=HADES1_TEXTLINE_SECTION_KEYS,
            default_speaker=owner_default_speaker,
            game_data_lists=game_data_lists,
            section_priority_tiers=HADES1_SECTION_KEY_PRIORITY_TIER,
        )
        if not any(sections.values()):
            continue

        # Lift container-level requirements (sibling-level ``Required*``
        # fields and/or a ``GameStateRequirements`` sub-table) onto each
        # extracted textline. Inspect points in DeathLoopData.lua almost
        # always use the sibling-level form (e.g. ``[370001] = { ...
        # RequiredMinCompletedRuns = 4, RequiredTextLines = { ... },
        # InteractTextLineSets = { ... } }``) with no GSR wrapper.
        if ancestor_reqs is not None:
            for tl_map in sections.values():
                for tl in tl_map.values():
                    merge_ancestor_requirements(tl, ancestor_reqs, game_data_lists)

        # Mixed-speaker scene support: inject ``partner`` on every
        # textline in this block when the override declares one.
        # Mirrors the ``Partner = "..."`` Lua field that
        # :func:`extract_textline` captures natively for xWithY pairs
        # (see ``textline_set.py``); the viewer renders it identically.
        if partner is not None:
            for tl_map in sections.values():
                for tl in tl_map.values():
                    tl.setdefault("partner", partner)

        # Defensively merge instead of overwriting: multiple synthetic
        # owners can collapse to the same real owner (e.g. three Skelly
        # trophy plinths under ``TrainingMelee``), so accumulate
        # textlines per-section rather than overwriting the entry.
        entry = result.setdefault(owner_name, {"source": source_label})
        for section_key, tl_map in sections.items():
            existing = entry.setdefault(section_key, {})
            for tl_name, tl_data in tl_map.items():
                if tl_name not in existing:
                    existing[tl_name] = tl_data

    return result


def _walk_owners(node, path=(), ancestor_reqs=None):
    """Yield ``(owner_name, owner_table, default_speaker, ancestor_reqs)``
    for every table that contains a textline-set section.

    ``ancestor_reqs`` is the closest enclosing block's combined
    requirement set (sibling-level ``Required*`` fields unioned with any
    explicit ``GameStateRequirements`` sub-table - see
    ``collect_local_requirements``). Replace-on-encounter: each level's
    reqs gate only its own subtree, so a closer block fully overrides an
    outer one once it declares its own. Returns ``None`` when no
    enclosing block has declared any requirement fields.
    """
    if len(path) > _WALK_OWNERS_MAX_DEPTH:
        tail = " -> ".join(repr(seg) for seg in path[-8:])
        raise ValueError(
            f"DeathLoopData walker exceeded max depth "
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
        # Numeric ids under a named map are tagged ``idmap`` so the
        # owner resolver can either (a) parametrically collapse them via
        # :data:`IDMAP_PARENT_OWNER_OVERRIDES` (e.g. InspectPoints), or
        # (b) emit a raw synthetic ``<parent_name>_<id>`` name that
        # :data:`SYNTHETIC_OWNER_OVERRIDES` can then re-map to a real
        # owner. See the module docstring for the two-tier attribution model.
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
    """Derive a (raw, pre-override) owner name from the walker path.

    Priority:
      1. Innermost idmap segment whose parent map is in
         :data:`IDMAP_PARENT_OWNER_OVERRIDES` -> the parametric
         collapse target (e.g. ``InspectPoints[<id>]`` -> ``Storyteller``).
         This is the single rule that handles ~370 inspect points
         without enumerating each id.
      2. Otherwise innermost idmap segment -> ``<parent_name>_<id>``
         (e.g. ``ObstacleData_310036``). This raw synthetic name is
         then looked up in :data:`SYNTHETIC_OWNER_OVERRIDES` by
         :func:`extract_deathloop_data` for per-id real-owner attribution.
      3. Otherwise: walk the full path, joining every non-generic named
         segment with underscores, and appending the innermost array
         index for disambiguation when one was crossed. This produces
         unique readable names like ``DeathArea_StartUnthreadedEvents_4``
         for singular ``TextLineSet`` sections embedded in distance
         triggers, which the override map can also re-map per-id.
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, key, parent_name = segment
            collapsed = IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
            if collapsed is not None:
                return collapsed
            return f"{parent_name}_{key}"

    parts = []
    innermost_array = None
    for segment in path:
        if segment[0] == "named":
            if segment[1] not in GENERIC_PATH_NAMES:
                parts.append(segment[1])
        elif segment[0] == "array":
            innermost_array = segment[1]

    if innermost_array is not None:
        parts.append(str(innermost_array))

    return "_".join(parts) if parts else "DeathLoopData"


def _default_speaker_for(path) -> str:
    """Per-line default speaker fallback for lines without explicit
    ``Speaker = ...``.

    Only applies to the parametric idmap collapse: when an idmap path
    resolves to a fixed owner via :data:`IDMAP_PARENT_OWNER_OVERRIDES`,
    we also use that owner as the default speaker (e.g. all inspect
    points default to Storyteller). For everything else - including
    other idmap parents like ``ObstacleData`` - we return ``None`` so
    :func:`extract_deathloop_data` either uses the per-id override's
    real owner or falls back to the synthetic owner name.
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, _, parent_name = segment
            return IDMAP_PARENT_OWNER_OVERRIDES.get(parent_name)
    return None
