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

  - The weapon-enchantment count gates
    (``RequiredMin/MaxUnlockedWeaponEnchantments``) run through
    ``GetNumUnlockedWeaponUpgrades`` (WeaponUpgradeScripts.lua), which
    counts unlocked weapon-upgrade slots *excluding* the base aspect of
    each weapon (the per-(weapon, index) ``StartsUnlocked`` slots).

  - ``RequiredCosmeticItemVisible`` compares a cosmetic's state against
    the literal ``UIData.Constants.VISIBLE`` ("visible"), not mere
    truthiness (a "pending" cosmetic is truthy but not visible).

This extractor parses those tables out of the game's Lua so the viewer
can ship them in ``data-hades1.json`` and resolve the gates client-side.
The shapes returned are intentionally minimal (orders, a length, a
number, a per-weapon index map, one constant) - everything else the
engine reads for these gates is in the persistent save slice.
"""

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


def extract_weapon_upgrade_starts_unlocked(parsed: dict) -> dict:
    """``{ WeaponName: [1-based indices that StartsUnlocked] }``.

    ``GetNumUnlockedWeaponUpgrades`` excludes these base-aspect slots
    from the unlocked-enchantment count. Parsed from
    ``WeaponUpgradeData`` (WeaponUpgradeData.lua); the
    ``DefaultGameStateRequirement`` sibling key (not a weapon) is skipped
    because its value is not an array-of-upgrade-slots table.
    """
    data = parsed.get("WeaponUpgradeData")
    result: dict = {}
    if not isinstance(data, LuaTable):
        return result
    for weapon_name, weapon_table in data.items():
        if not isinstance(weapon_table, LuaTable) or not weapon_table.array:
            continue
        indices = []
        for slot_index, slot in enumerate(weapon_table.array, start=1):
            if isinstance(slot, LuaTable) and slot.get("StartsUnlocked") is True:
                indices.append(slot_index)
        if indices:
            result[weapon_name] = indices
    return result


def extract_save_eval_static(meta_parsed: dict, weapon_parsed: dict) -> dict:
    """Bundle every static table the H1 save evaluator needs.

    ``meta_parsed`` is the parsed ``MetaUpgradeData.lua`` (carries
    ``MetaUpgradeOrder`` / ``ShrineUpgradeOrder`` / ``MetaUpgradeData``);
    ``weapon_parsed`` is the parsed ``WeaponUpgradeData.lua``. Returns the
    single ``h1SaveEvalStatic`` payload the build attaches to the H1 graph
    data and ``data.js`` exposes to ``gamestate-eval-h1.js``.
    """
    return {
        "metaUpgradeOrderLength": extract_meta_upgrade_order_length(meta_parsed),
        "shrineUpgradeOrder": extract_shrine_upgrade_order(meta_parsed),
        "strikeThroughChangeValue": extract_strike_through_change_value(meta_parsed),
        "weaponUpgradeStartsUnlocked": extract_weapon_upgrade_starts_unlocked(weapon_parsed),
        "cosmeticVisibleValue": _COSMETIC_VISIBLE_VALUE,
    }
