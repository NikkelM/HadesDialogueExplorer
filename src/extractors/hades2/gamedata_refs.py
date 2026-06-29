"""Hades II ``GameData.*`` / ``ScreenData.*`` / ``QuestOrderData``
table extractor.

H2 ``otherRequirements`` records reference shared registry tables via
identifiers like ``GameData.AllWeaponAspects`` /
``GameData.GodAboutGodEvents`` / ``QuestOrderData``. The req extractor
preserves these as ``<ref:Name>`` placeholders so nothing is silently
inlined. The viewer wants to expand those placeholders inline in the
row tooltip so a reader hovering on a ``CountOf: GameData.X`` row sees
the actual contents of that table.

This module reads the small set of source files that define those
tables (``NarrativeData.lua``, ``QuestData.lua``, ``RunData.lua``,
``ShrineData.lua``) and returns ``{full.identifier.name: normalised-value}``
for every top-level assignment whose name matches one of the registry
roots. The extracted values use the same ``<ref:...>`` / ``<expr:...>``
placeholder shape as ``otherRequirements`` so nested references resolve
uniformly on the viewer side.
"""

from pathlib import Path
from typing import Any, Dict

from src.lua_parser import LuaExpression, LuaIdentifier, LuaTable, parse_lua_file


# Source files that define the registry tables referenced from
# ``otherRequirements`` ``<ref:...>`` placeholders. Each is optional -
# missing files are silently skipped so the build still completes when
# a partial source tree is present.
HADES2_GAMEDATA_REF_SOURCE_FILES = (
    "NarrativeData.lua",
    "QuestData.lua",
    "RunData.lua",
    "ShrineData.lua",
    "GhostAdminData_Items.lua",
)


# Top-level identifier roots whose assignments we capture. Anything
# outside these roots is ignored - the live ``otherRequirements`` data
# only references identifiers under these prefixes (see the audit of
# ``<ref:...>`` placeholders in ``dist/data.json``).
_REF_ROOT_PREFIXES = ("GameData.", "ScreenData.")
_REF_EXACT_NAMES = frozenset({"QuestOrderData"})


def _normalise(value: Any) -> Any:
    """Convert a ``LuaTable`` / ``LuaIdentifier`` / ``LuaExpression``
    tree into plain dict / list / scalar values for JSON storage.

    Mirrors :func:`src.extractors.hades2.req_extractor._normalise_lua`
    so cross-referenced placeholders use the exact same on-disk shape
    the viewer already understands.
    """
    if isinstance(value, LuaTable):
        if value.named and not value.array:
            return {k: _normalise(v) for k, v in value.named.items()}
        if value.array and not value.named:
            return [_normalise(v) for v in value.array]
        out = {k: _normalise(v) for k, v in value.named.items()}
        if value.array:
            out["_array"] = [_normalise(v) for v in value.array]
        return out
    if isinstance(value, LuaIdentifier):
        return f"<ref:{value.name}>"
    if isinstance(value, LuaExpression):
        return f"<expr:{value.raw}>"
    return value


def _name_is_ref_root(name: str) -> bool:
    if name in _REF_EXACT_NAMES:
        return True
    return any(name.startswith(p) for p in _REF_ROOT_PREFIXES)


def extract_gamedata_refs(scripts_dir: Path) -> Dict[str, Any]:
    """Parse the H2 source files that define registry tables and return
    ``{full.identifier.name: normalised-value}``.

    The returned mapping is suitable for shipping in the viewer payload
    under ``gameDataRefs``: the viewer looks up ``<ref:Name>``
    placeholders in this map to expand them inline inside the row
    tooltip.

    Files that don't exist are silently skipped (the pipeline still
    runs - placeholders just stay unresolved in the viewer, as they
    were before this hook). Later files overwrite earlier ones for the
    same key so the read order in
    ``HADES2_GAMEDATA_REF_SOURCE_FILES`` reflects definition priority
    (NarrativeData first - it owns the bulk of the referenced tables).
    """
    refs: Dict[str, Any] = {}
    for fname in HADES2_GAMEDATA_REF_SOURCE_FILES:
        path = scripts_dir / fname
        if not path.exists():
            continue
        parsed = parse_lua_file(str(path))
        for name, value in parsed.items():
            if _name_is_ref_root(name):
                refs[name] = _normalise(value)
    return refs
