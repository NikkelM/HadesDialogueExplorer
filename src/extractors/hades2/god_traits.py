"""Hades II god-trait + restricted-boon trait metadata extractor.

Two ``otherRequirements`` ``FunctionName`` gates resolve against the
hero's equipped traits in a loaded save (``CurrentRun.Hero.Traits``):

* ``RequiredSellableGodTraits`` - true iff the hero holds at least one
  *god* trait (a boon, as opposed to a meta-upgrade / weapon-aspect /
  keepsake) that also carries a ``Rarity``. The "is this a god trait"
  test is the engine's ``IsGodTrait( name, { ForShop = true } )``
  (``TraitLogic.lua``): a trait name counts when it appears in the
  ``TraitIndex`` of some loot source that is ``GodLoot`` (or, for the
  shop variant, ``TreatAsGodLootByShops``) and is not ``DebugOnly``.
* ``RequireUnrestrictedBoonChoices`` - false iff any equipped trait
  defines ``RestrictBoonChoices`` (only ``ChaosRestrictBoonCurse``).

A static save can't run ``IsGodTrait``, so this module pre-computes the
two name sets from the game's loot / trait data and ships them in the
H2 viewer payload, where ``gamestate-eval.js`` reads them to evaluate
the gates against the captured trait slice.

Faithfulness notes (mirrors ``RunData.lua`` / ``TraitLogic.lua``):

* A loot source's ``TraitIndex`` is the union of its ``Traits``,
  ``WeaponUpgrades``, ``PermanentTraits`` and ``TemporaryTraits`` lists
  (``RunData.lua`` ProcessDataStore loop).
* ``GodLoot`` / ``TreatAsGodLootByShops`` are inheritable
  (``InheritFrom``), so per-god owners (``ZeusUpgrade`` etc.) inherit
  ``GodLoot = true`` from the ``BaseLoot`` template. ``DebugOnly`` is in
  the engine's ``inheritanceIgnores`` set, so it is read from the
  owner's own value only (templates marked ``DebugOnly`` don't taint
  their inheritors).
* Field gods (``IsGodTrait`` also scans ``FieldLootData``) live in the
  ``NPCData_*.lua`` field-NPC owners (Athena / Artemis / Dionysus /
  Hades) flagged ``TreatAsGodLootByShops``; the engine's field-loot
  branch does not apply the ``DebugOnly`` exclusion.
"""

import re
from pathlib import Path
from typing import Dict, List, Optional, Set

from src.lua_parser import LuaTable, parse_lua_file


# Top-level container keys: per-god boon owners under ``LootSetData.<X>``
# (incl. the master ``LootSetData.Loot`` templates), NPC owners under
# ``UnitSetData.<X>`` / ``VariantSetData.<X>``, traits under
# ``TraitSetData.<X>``.
_LOOT_SET_DATA_RE = re.compile(r"^LootSetData\.\w+$")
_NPC_SET_DATA_RE = re.compile(r"^(?:Unit|Variant)SetData\.\w+$")
_TRAIT_SET_DATA_RE = re.compile(r"^TraitSetData\.\w+$")

# The trait-list fields whose union forms a loot source's TraitIndex.
_TRAIT_LIST_KEYS = ("Traits", "WeaponUpgrades", "PermanentTraits", "TemporaryTraits")


def _collect_owner_store(
    scripts_dir: Path, glob: str, container_re: "re.Pattern[str]"
) -> Dict[str, LuaTable]:
    """Merge every ``<container>.<owner>`` owner table across the files
    matching ``glob`` into one ``{owner_id: LuaTable}`` store.

    First-write-wins on owner-id collisions (each owner lives in exactly
    one file in practice). The store doubles as the ``InheritFrom``
    resolution scope so a per-god owner can see the ``BaseLoot`` template
    defined in the master ``LootData.lua``.
    """
    store: Dict[str, LuaTable] = {}
    for path in sorted(scripts_dir.glob(glob)):
        parsed = parse_lua_file(str(path))
        for key, value in parsed.items():
            if not container_re.match(key) or not isinstance(value, LuaTable):
                continue
            for owner_id, owner_table in value.named.items():
                if isinstance(owner_table, LuaTable):
                    store.setdefault(owner_id, owner_table)
    return store


def _inherited_flag(
    owner_id: str, store: Dict[str, LuaTable], key: str, _seen: Optional[Set[str]] = None
) -> Optional[bool]:
    """Resolve an inheritable boolean flag for ``owner_id``.

    The owner's own value wins (including an explicit ``false`` that
    overrides a parent's ``true``); otherwise the ``InheritFrom`` parents
    are tried in order. Returns ``None`` when no source in the chain sets
    the flag (cycle-guarded).
    """
    _seen = _seen if _seen is not None else set()
    if owner_id in _seen:
        return None
    _seen.add(owner_id)
    table = store.get(owner_id)
    if table is None:
        return None
    if key in table.named:
        return bool(table.named.get(key))
    inherit = table.named.get("InheritFrom")
    if isinstance(inherit, LuaTable):
        for parent in inherit.array:
            if isinstance(parent, str):
                val = _inherited_flag(parent, store, key, _seen)
                if val is not None:
                    return val
    return None


def _inherited_list(
    owner_id: str, store: Dict[str, LuaTable], key: str, _seen: Optional[Set[str]] = None
) -> List[str]:
    """Resolve an inheritable string-list field (e.g. ``Traits``).

    The owner's own list wins; otherwise the first non-empty inherited
    list is used (matching the engine's deep-inherit, which copies a
    parent list only when the child doesn't define one). Cycle-guarded.
    """
    _seen = _seen if _seen is not None else set()
    if owner_id in _seen:
        return []
    _seen.add(owner_id)
    table = store.get(owner_id)
    if table is None:
        return []
    val = table.named.get(key)
    if isinstance(val, LuaTable):
        return [x for x in val.array if isinstance(x, str)]
    if key in table.named:
        return []
    inherit = table.named.get("InheritFrom")
    if isinstance(inherit, LuaTable):
        for parent in inherit.array:
            if isinstance(parent, str):
                lst = _inherited_list(parent, store, key, _seen)
                if lst:
                    return lst
    return []


def _trait_index(owner_id: str, store: Dict[str, LuaTable]) -> Set[str]:
    """Union of an owner's resolved trait-list fields (its TraitIndex)."""
    names: Set[str] = set()
    for key in _TRAIT_LIST_KEYS:
        names.update(_inherited_list(owner_id, store, key))
    return names


def extract_god_trait_metadata(scripts_dir: Path) -> Dict[str, List[str]]:
    """Return ``{"godTraitNames": [...], "restrictBoonChoiceTraitNames": [...]}``.

    ``godTraitNames`` is the ForShop ``IsGodTrait`` set (god-boon trait
    names from every non-debug ``GodLoot`` / ``TreatAsGodLootByShops``
    loot source, plus the field-god NPC sources). ``restrictBoonChoiceTraitNames``
    is the set of traits defining ``RestrictBoonChoices``.

    Both lists are sorted for deterministic output. Missing source files
    are silently skipped (the pipeline still runs - the gates just stay
    indeterminate, as they were before this hook).
    """
    scripts_dir = Path(scripts_dir)
    god_traits: Set[str] = set()

    # LootData sources: god-boon owners (GodLoot or TreatAsGodLootByShops,
    # excluding the owner's own DebugOnly templates).
    loot_store = _collect_owner_store(scripts_dir, "LootData*.lua", _LOOT_SET_DATA_RE)
    for owner_id, table in loot_store.items():
        if bool(table.named.get("DebugOnly")):
            continue
        is_god = (
            _inherited_flag(owner_id, loot_store, "GodLoot")
            or _inherited_flag(owner_id, loot_store, "TreatAsGodLootByShops")
        )
        if is_god:
            god_traits.update(_trait_index(owner_id, loot_store))

    # FieldLootData sources: field-god NPC owners flagged
    # TreatAsGodLootByShops / GodLoot (no DebugOnly exclusion in-engine).
    npc_store = _collect_owner_store(scripts_dir, "NPCData_*.lua", _NPC_SET_DATA_RE)
    for owner_id, table in npc_store.items():
        if table.named.get("TreatAsGodLootByShops") or table.named.get("GodLoot"):
            god_traits.update(_trait_index(owner_id, npc_store))

    # Traits that restrict boon choices (RequireUnrestrictedBoonChoices).
    restrict: Set[str] = set()
    for path in sorted(scripts_dir.glob("TraitData*.lua")):
        parsed = parse_lua_file(str(path))
        for key, value in parsed.items():
            if not _TRAIT_SET_DATA_RE.match(key) or not isinstance(value, LuaTable):
                continue
            for trait_name, trait_table in value.named.items():
                if isinstance(trait_table, LuaTable) and trait_table.named.get("RestrictBoonChoices"):
                    restrict.add(trait_name)

    return {
        "godTraitNames": sorted(god_traits),
        "restrictBoonChoiceTraitNames": sorted(restrict),
    }
