"""
Semantic extractor for DeathLoopData.lua (Hades 1).

TextLineSets here are nested deep inside various subtables of each
``DeathLoopData.<DeathArea>`` entry (most commonly under ``InspectPoints``,
sometimes under ``ObstacleData`` or other named maps). Singular
``TextLineSet`` sections also appear nested inside distance-trigger event
configurations.

The owner of each section is derived from the path:
  - InspectPoints[<id>]    -> ``InspectPoint_<id>`` (singularized)
  - <NamedMap>[<id>]       -> ``<NamedMap>_<id>`` for any other numeric child
  - everything else        -> the closest meaningful named ancestor,
                              disambiguated by array index if needed
                              (e.g. ``StartUnthreadedEvents_4``)
"""

from ...lua_parser import LuaTable
from ..textline_set import extract_textline_sections
from .section_keys import HADES1_TEXTLINE_SECTION_KEYS

# Special-case prefixes for known parent maps. Anything else just uses the
# parent name verbatim (e.g. ``ObstacleData_310036``).
PARENT_NAME_PREFIX_OVERRIDES = {
    "InspectPoints": "InspectPoint",
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

    for owner_name, owner_table, owner_default_speaker in _walk_owners(root):
        sections = extract_textline_sections(
            owner_name, owner_table, source_file,
            section_keys=HADES1_TEXTLINE_SECTION_KEYS,
            default_speaker=owner_default_speaker,
            game_data_lists=game_data_lists,
        )
        if not any(sections.values()):
            continue
        # Defensively merge instead of overwriting: if path-derived owner
        # naming ever produces a collision again, we want the textlines to
        # accumulate rather than silently disappear.
        entry = result.setdefault(owner_name, {"source": source_label})
        for section_key, tl_map in sections.items():
            existing = entry.setdefault(section_key, {})
            for tl_name, tl_data in tl_map.items():
                if tl_name not in existing:
                    existing[tl_name] = tl_data

    return result


def _walk_owners(node, path=()):
    """Yield (owner_name, owner_table, default_speaker) for every table
    that contains a textline-set section."""
    if not isinstance(node, LuaTable):
        return

    if _has_textline_section(node):
        yield _owner_name_for(path), node, _default_speaker_for(path)

    parent_name = path[-1][1] if (path and path[-1][0] == "named") else None

    for k, v in node.items():
        # Numeric ids under a named map get tagged so they can become
        # "<ParentName>_<id>" owners (e.g. "InspectPoint_370001").
        if k.isdigit() and parent_name is not None:
            yield from _walk_owners(v, path + (("idmap", k, parent_name),))
        else:
            yield from _walk_owners(v, path + (("named", k),))

    for i, v in enumerate(node.array):
        yield from _walk_owners(v, path + (("array", i),))


def _has_textline_section(table: LuaTable) -> bool:
    return any(
        k in HADES1_TEXTLINE_SECTION_KEYS and isinstance(v, LuaTable)
        for k, v in table.items()
    )


def _owner_name_for(path) -> str:
    """Derive an owner name from the walker path.

    Priority:
      1. Closest idmap segment -> ``<Prefix>_<id>`` (e.g. ``InspectPoint_370001``,
         ``ObstacleData_310036``).
      2. Otherwise: walk the full path, joining every non-generic named
         segment with underscores, and appending the innermost array index
         for disambiguation when one was crossed. This produces unique
         readable names like ``DeathArea_StartUnthreadedEvents_4`` for
         singular ``TextLineSet`` sections embedded in distance triggers.
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            _, key, parent_name = segment
            prefix = PARENT_NAME_PREFIX_OVERRIDES.get(parent_name, parent_name)
            return f"{prefix}_{key}"

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
    # Inspect-point and other ambient-narration lines default to Storyteller
    # when no explicit Speaker is set on the dialogue entry. Lines inside a
    # numeric-id map (idmap segment) are always ambient/world-object lines
    # so the same default applies.
    for segment in path:
        if segment[0] == "idmap":
            return "Storyteller"
    return None
