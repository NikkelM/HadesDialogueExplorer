"""Static game-data tables the viewer's Hades 1 save-eligibility evaluator
needs to resolve a handful of ``otherRequirements`` gates exactly.

A few H1 requirement fields can't be answered from the persistent save
slice alone - the engine consults static design-data tables the save
doesn't carry:

  - The Mirror of Night "active" gates (``RequiredActiveMetaUpgrade`` /
    ``RequiredInactiveMetaUpgrade`` / ``RequiredMin/MaxActiveMetaUpgradeLevel``)
    run through ``GetNumMetaUpgrades`` -> ``IsMetaUpgradeActive``
    (MetaUpgrades.lua), which treats a Mirror talent as inactive unless
    it is the currently-selected side of its row and that row isn't
    struck through by the ``MetaUpgradeStrikeThroughShrineUpgrade`` Pact.
    Resolving that needs ``ShrineUpgradeOrder`` (always-active shrine
    upgrades), the number of Mirror rows (``#MetaUpgradeOrder``), and the
    strike-through upgrade's ``ChangeValue``.

  - The weapon-aspect gates run through ``WeaponUpgradeData``
    (WeaponUpgradeScripts.lua): the enchantment-count gates
    (``RequiredMin/MaxUnlockedWeaponEnchantments``) exclude each weapon's
    base aspect (the ``StartsUnlocked`` slot); ``RequiredLastInteractedWeaponUpgrade``
    maps a ``{WeaponName, ItemIndex}`` pointer to a slot's ``TraitName`` /
    ``RequiredInvestmentTraitName``; ``RequiredLastInteractedWeaponUpgradeMaxed``
    compares the bought level against ``MaxUpgradeLevel``; and
    ``RequiredMinSuperLockKeysSpentOnWeapon`` sums the per-level ``Costs``
    (Titan Blood) across a weapon's slots. The per-(weapon, index) slot
    table carries all of these.

  - ``RequiredCosmeticItemVisible`` compares a cosmetic's state against
    the literal ``UIData.Constants.VISIBLE`` ("visible"), not mere
    truthiness (a "pending" cosmetic is truthy but not visible).

This extractor parses those tables out of the game's Lua so the viewer
can ship them in ``data-hades1.json`` and resolve the gates client-side.
The shapes returned are intentionally minimal (orders, a length, a
number, a per-(weapon, index) slot map, one constant) - everything else
the engine reads for these gates is in the persistent save slice.
"""

from typing import Dict, List, Optional, Set

from ...lua_parser import LuaTable

# ``UIData.Constants.VISIBLE`` (UIData.lua). Vendored as a constant rather
# than parsed: UIData.lua is ~2,500 lines and this is the only value the
# save evaluator reads from it. ``PENDING_REVEAL = "pending"`` sits beside
# it; a cosmetic can be truthy-but-pending, so the visible gate must match
# this exact string.
_COSMETIC_VISIBLE_VALUE = "visible"


def _as_int(value, default=None):
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return int(value)
    return default


def extract_meta_upgrade_order_length(parsed: dict) -> int:
    """Number of Mirror-of-Night rows = ``#MetaUpgradeOrder``.

    ``MetaUpgradeOrder`` (MetaUpgradeData.lua) is an array of two-element
    ``{ sideA, sideB }`` rows; its length is the row count that
    ``IsMetaUpgradeActive`` compares the strike-through-nulled count
    against.
    """
    order = parsed.get("MetaUpgradeOrder")
    if isinstance(order, LuaTable):
        return len(order.array)
    return 0


def extract_shrine_upgrade_order(parsed: dict) -> list:
    """The ``ShrineUpgradeOrder`` name list (MetaUpgradeData.lua).

    Shrine (Pact of Punishment) upgrades are always "active" in
    ``IsMetaUpgradeActive``, so the viewer special-cases these names
    before the Mirror selection / strike-through logic.
    """
    order = parsed.get("ShrineUpgradeOrder")
    if isinstance(order, LuaTable):
        return [name for name in order.array if isinstance(name, str)]
    return []


def extract_strike_through_change_value(parsed: dict) -> int:
    """``MetaUpgradeData.MetaUpgradeStrikeThroughShrineUpgrade.ChangeValue``.

    ``GetNulledMetaUpgradeCount`` multiplies the player's level in this
    Pact upgrade by ``abs(ChangeValue)`` to get how many Mirror rows
    (from the end) are struck through / inactive.
    """
    data = parsed.get("MetaUpgradeData")
    if isinstance(data, LuaTable):
        entry = data.get("MetaUpgradeStrikeThroughShrineUpgrade")
        if isinstance(entry, LuaTable):
            return _as_int(entry.get("ChangeValue"), default=0)
    return 0


def extract_weapon_upgrade_slots(parsed: dict) -> dict:
    """``{ WeaponName: { index: slot } }`` keyed by 1-based slot index.

    Each slot carries the fields the H1 save evaluator reads for the
    weapon-aspect gates: ``trait`` (TraitName), ``reqTrait``
    (RequiredInvestmentTraitName, the base-aspect investment trait),
    ``max`` (MaxUpgradeLevel), ``costs`` (the per-level Titan Blood cost
    array) and ``startsUnlocked`` (the base aspect, excluded from the
    enchantment count). Parsed from ``WeaponUpgradeData``
    (WeaponUpgradeData.lua); the ``DefaultGameStateRequirement`` sibling
    key (not a weapon) is skipped because its value is not an
    array-of-upgrade-slots table. Fields absent in the Lua are omitted so
    the shipped JSON stays compact.
    """
    data = parsed.get("WeaponUpgradeData")
    result: dict = {}
    if not isinstance(data, LuaTable):
        return result
    for weapon_name, weapon_table in data.items():
        if not isinstance(weapon_table, LuaTable) or not weapon_table.array:
            continue
        slots: dict = {}
        for slot_index, slot in enumerate(weapon_table.array, start=1):
            if not isinstance(slot, LuaTable):
                continue
            entry: dict = {}
            trait = slot.get("TraitName")
            if isinstance(trait, str):
                entry["trait"] = trait
            req_trait = slot.get("RequiredInvestmentTraitName")
            if isinstance(req_trait, str):
                entry["reqTrait"] = req_trait
            max_level = _as_int(slot.get("MaxUpgradeLevel"))
            if max_level is not None:
                entry["max"] = max_level
            costs = slot.get("Costs")
            if isinstance(costs, LuaTable):
                entry["costs"] = [_as_int(c, default=0) for c in costs.array]
            if slot.get("StartsUnlocked") is True:
                entry["startsUnlocked"] = True
            if entry:
                slots[str(slot_index)] = entry
        if slots:
            result[weapon_name] = slots
    return result


# ---- god-loot trait index (RequiredGodLoot / RequiredNoGodBoons) -------------
#
# The H1 engine builds a per-god ``TraitIndex`` at load (RunData.lua, the
# ``ProcessDataStore( LootData )`` loop): the union of each loot owner's
# ``WeaponUpgrades`` / ``Traits`` / ``PermanentTraits`` / ``TemporaryTraits``
# lists plus its ``LinkedUpgrades`` keys. Two ``otherRequirements`` gates read
# it against the hero's equipped traits (``CurrentRun.Hero.Traits``):
#
#   - ``RequiredGodLoot`` (RunManager.lua:2826): met iff the hero holds any
#     trait in ``LootData[god].TraitIndex`` (a boon from that god equipped).
#   - ``RequiredNoGodBoons`` (RunManager.lua:2864): met iff the hero holds no
#     trait that ``IsGodTrait( name, { ForShop = true } )`` (TraitScripts.lua) -
#     i.e. no trait from any non-``DebugOnly`` owner flagged ``GodLoot`` or
#     (for the shop test) ``TreatAsGodLootByShops``.
#
# A static save can't run these loops, so the union sets are pre-computed and
# shipped in ``h1SaveEvalStatic``. ``GodLoot`` / ``TreatAsGodLootByShops`` are
# inheritable (``InheritFrom`` - the per-god owners inherit ``GodLoot = true``
# from the ``BaseLoot`` template), while ``DebugOnly`` is read from the owner's
# own value only (it sits in the engine's inheritance-ignores set, so the
# ``DebugOnly`` ``BaseLoot`` template doesn't taint its inheritors).

# Trait-list fields whose union (plus LinkedUpgrades keys) forms a god's
# runtime TraitIndex.
_GOD_TRAIT_LIST_KEYS = ("WeaponUpgrades", "Traits", "PermanentTraits", "TemporaryTraits")


def _loot_store(loot_parsed: dict) -> Dict[str, LuaTable]:
    """Map ``{owner_id: LuaTable}`` from the flat ``LootData`` table.

    Doubles as the ``InheritFrom`` resolution scope so a per-god owner can
    see the ``BaseLoot`` template it inherits ``GodLoot`` from.
    """
    store: Dict[str, LuaTable] = {}
    loot = loot_parsed.get("LootData")
    if isinstance(loot, LuaTable):
        for owner_id, table in loot.named.items():
            if isinstance(table, LuaTable):
                store[owner_id] = table
    return store


def _inherited_flag(
    owner_id: str, store: Dict[str, LuaTable], key: str, _seen: Optional[Set[str]] = None
) -> Optional[bool]:
    """Resolve an inheritable boolean flag (owner's own value wins, including
    an explicit ``false`` overriding a parent's ``true``; else the
    ``InheritFrom`` parents in order). ``None`` when unset. Cycle-guarded."""
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
    """Resolve an inheritable string-list field (owner's own list wins, else
    the first non-empty inherited list). Cycle-guarded."""
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


def _linked_upgrade_keys(
    owner_id: str, store: Dict[str, LuaTable], _seen: Optional[Set[str]] = None
) -> List[str]:
    """The ``LinkedUpgrades`` keys (a named table, not a list) that also feed a
    god's TraitIndex. Resolved with the same own-wins / inherit fallback."""
    _seen = _seen if _seen is not None else set()
    if owner_id in _seen:
        return []
    _seen.add(owner_id)
    table = store.get(owner_id)
    if table is None:
        return []
    val = table.named.get("LinkedUpgrades")
    if isinstance(val, LuaTable):
        return [k for k in val.named.keys() if isinstance(k, str)]
    if "LinkedUpgrades" in table.named:
        return []
    inherit = table.named.get("InheritFrom")
    if isinstance(inherit, LuaTable):
        for parent in inherit.array:
            if isinstance(parent, str):
                keys = _linked_upgrade_keys(parent, store, _seen)
                if keys:
                    return keys
    return []


def _trait_index(owner_id: str, store: Dict[str, LuaTable]) -> Set[str]:
    """Union of an owner's resolved trait-list fields and LinkedUpgrades keys."""
    names: Set[str] = set()
    for key in _GOD_TRAIT_LIST_KEYS:
        names.update(_inherited_list(owner_id, store, key))
    names.update(_linked_upgrade_keys(owner_id, store))
    return names


def extract_god_loot_data(loot_parsed: dict) -> dict:
    """Return ``{"godLootTraitIndex": {...}, "godTraitNamesForShop": [...]}``.

    ``godLootTraitIndex`` maps every loot owner with a non-empty TraitIndex to
    its sorted trait-name list - ``RequiredGodLoot`` reads ``LootData[god]``
    for any god value (even ``GodLoot = false`` ones like ``TrialUpgrade`` /
    ``HermesUpgrade``), so the index isn't restricted to god-loot owners.
    ``godTraitNamesForShop`` is the flat ``IsGodTrait( ForShop )`` set used by
    ``RequiredNoGodBoons``: the union of every non-``DebugOnly`` owner flagged
    ``GodLoot`` or ``TreatAsGodLootByShops``. Missing ``LootData`` yields empty
    tables (the two gates then stay indeterminate, as before this hook).
    """
    store = _loot_store(loot_parsed)
    per_god: Dict[str, List[str]] = {}
    shop_traits: Set[str] = set()
    for owner_id, table in store.items():
        index = _trait_index(owner_id, store)
        if index:
            per_god[owner_id] = sorted(index)
        if bool(table.named.get("DebugOnly")):
            continue
        if _inherited_flag(owner_id, store, "GodLoot") or _inherited_flag(
            owner_id, store, "TreatAsGodLootByShops"
        ):
            shop_traits.update(index)
    return {
        "godLootTraitIndex": per_god,
        "godTraitNamesForShop": sorted(shop_traits),
    }


def _trait_store(trait_parsed: dict) -> Dict[str, LuaTable]:
    """Map ``{trait_name: LuaTable}`` from the flat ``TraitData`` table.

    Doubles as the ``InheritFrom`` resolution scope so a keepsake can see the
    ``GiftTrait`` / ``AssistTrait`` base it inherits ``ChamberThresholds`` from.
    """
    store: Dict[str, LuaTable] = {}
    data = trait_parsed.get("TraitData")
    if isinstance(data, LuaTable):
        for name, table in data.named.items():
            if isinstance(table, LuaTable):
                store[name] = table
    return store


def _inherited_number_list(
    owner_id: str, store: Dict[str, LuaTable], key: str, _seen: Optional[Set[str]] = None
) -> List[float]:
    """Resolve an inheritable numeric-list field (owner's own list wins, else
    the first non-empty inherited list). Cycle-guarded."""
    _seen = _seen if _seen is not None else set()
    if owner_id in _seen:
        return []
    _seen.add(owner_id)
    table = store.get(owner_id)
    if table is None:
        return []
    val = table.named.get(key)
    if isinstance(val, LuaTable):
        return [x for x in val.array if isinstance(x, (int, float))]
    if key in table.named:
        return []
    inherit = table.named.get("InheritFrom")
    if isinstance(inherit, LuaTable):
        for parent in inherit.array:
            if isinstance(parent, str):
                lst = _inherited_number_list(parent, store, key, _seen)
                if lst:
                    return lst
    return []


def extract_keepsake_max_chambers(trait_parsed: dict) -> Dict[str, int]:
    """Map each threshold-based keepsake trait to the chamber count at which it
    is mastered (``IsKeepsakeMaxed``, KeepsakeScripts.lua).

    ``RequiresMaxKeepsake`` (RunManager.lua:3152) passes unless the currently
    equipped keepsake (``GameState.LastAwardTrait``) is mastered. A keepsake is
    mastered once its ``GameState.KeepsakeChambers`` count reaches the sum of its
    ``ChamberThresholds`` (every keepsake inherits ``{25, 50}`` from the
    ``GiftTrait`` / ``AssistTrait`` base, so the threshold is 75). The companion
    keepsakes (the ``AssistTrait`` inheritors with
    ``KeepsakeRarityGameStateRequirements``) are mastered via the assist-NPC
    upgrade levels instead, which the save slice doesn't carry, so they're left
    out of this map and stay indeterminate.
    """
    store = _trait_store(trait_parsed)
    out: Dict[str, int] = {}
    for name in store:
        if _inherited_flag(name, store, "KeepsakeRarityGameStateRequirements"):
            continue
        thresholds = _inherited_number_list(name, store, "ChamberThresholds")
        if thresholds:
            out[name] = int(sum(thresholds))
    return out


def extract_save_eval_static(
    meta_parsed: dict,
    weapon_parsed: dict,
    loot_parsed: Optional[dict] = None,
    trait_parsed: Optional[dict] = None,
) -> dict:
    """Bundle every static table the H1 save evaluator needs.

    ``meta_parsed`` is the parsed ``MetaUpgradeData.lua`` (carries
    ``MetaUpgradeOrder`` / ``ShrineUpgradeOrder`` / ``MetaUpgradeData``);
    ``weapon_parsed`` is the parsed ``WeaponUpgradeData.lua``;
    ``loot_parsed`` is the parsed ``LootData.lua`` (per-god boon owners);
    ``trait_parsed`` is the parsed ``TraitData.lua`` (keepsake thresholds).
    Returns the single ``h1SaveEvalStatic`` payload the build attaches to
    the H1 graph data and ``data.js`` exposes to ``gamestate-eval-h1.js``.
    """
    god_loot = extract_god_loot_data(loot_parsed or {})
    return {
        "metaUpgradeOrderLength": extract_meta_upgrade_order_length(meta_parsed),
        "shrineUpgradeOrder": extract_shrine_upgrade_order(meta_parsed),
        "strikeThroughChangeValue": extract_strike_through_change_value(meta_parsed),
        "weaponUpgradeSlots": extract_weapon_upgrade_slots(weapon_parsed),
        "cosmeticVisibleValue": _COSMETIC_VISIBLE_VALUE,
        "godLootTraitIndex": god_loot["godLootTraitIndex"],
        "godTraitNamesForShop": god_loot["godTraitNamesForShop"],
        "keepsakeMaxChambers": extract_keepsake_max_chambers(trait_parsed or {}),
    }
