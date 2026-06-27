"""Tests for :mod:`src.extractors.hades1.save_eval_data`.

The extractor pulls the small static design-data tables the viewer's H1
save-eligibility evaluator needs (Mirror-of-Night order / strike-through,
weapon base-aspect slots, the cosmetic VISIBLE constant) out of the game
Lua. These tests pin the shapes and the parsing of representative
fixtures so a game-data layout change surfaces as a failure here rather
than as a silently-wrong eligibility verdict in the viewer.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.save_eval_data import (
    extract_save_eval_static,
    extract_meta_upgrade_order_length,
    extract_shrine_upgrade_order,
    extract_strike_through_change_value,
    extract_weapon_upgrade_slots,
)


def parse(lua_text):
    return LuaParser(lua_text).parse_file()


META_LUA = """
MetaUpgradeOrder =
{
    { "BackstabMetaUpgrade", "FirstStrikeMetaUpgrade" },
    { "DoorHealMetaUpgrade", "DarknessHealMetaUpgrade" },
    { "ExtraChanceMetaUpgrade", "ExtraChanceReplenishMetaUpgrade" },
}

ShrineUpgradeOrder =
{
    "EnemyDamageShrineUpgrade",
    "MetaUpgradeStrikeThroughShrineUpgrade",
    "BiomeSpeedShrineUpgrade",
}

MetaUpgradeData =
{
    MetaUpgradeStrikeThroughShrineUpgrade =
    {
        ChangeValue = -3,
    },
    HealingReductionShrineUpgrade =
    {
        ChangeValue = 1.25,
    },
}
"""

WEAPON_LUA = """
WeaponUpgradeData =
{
    DefaultGameStateRequirement =
    {
        RequiredTrueFlags = { "AspectsUnlocked" },
    },
    SwordWeapon =
    {
        { MaxUpgradeLevel = 5, StartsUnlocked = true, RequiredInvestmentTraitName = "SwordBaseUpgradeTrait", Costs = { 1, 1, 1, 1, 1 }, },
        { MaxUpgradeLevel = 5, TraitName = "SwordRushTrait", Costs = { 1, 1, 2, 2, 3 }, },
        { MaxUpgradeLevel = 5, TraitName = "SwordConsecrationTrait", Costs = { 3, 3, 3, 3, 3 }, },
    },
    SpearWeapon =
    {
        { MaxUpgradeLevel = 5, StartsUnlocked = true, },
        { MaxUpgradeLevel = 5, TraitName = "SpearWaveTrait", },
    },
}
"""


def test_meta_upgrade_order_length_counts_mirror_rows():
    parsed = parse(META_LUA)
    assert extract_meta_upgrade_order_length(parsed) == 3


def test_shrine_upgrade_order_is_the_name_list():
    parsed = parse(META_LUA)
    assert extract_shrine_upgrade_order(parsed) == [
        "EnemyDamageShrineUpgrade",
        "MetaUpgradeStrikeThroughShrineUpgrade",
        "BiomeSpeedShrineUpgrade",
    ]


def test_strike_through_change_value():
    parsed = parse(META_LUA)
    assert extract_strike_through_change_value(parsed) == -3


def test_weapon_upgrade_slots_capture_the_per_slot_fields():
    parsed = parse(WEAPON_LUA)
    # 1-based index keys; the non-weapon DefaultGameStateRequirement sibling
    # is skipped; absent fields are omitted.
    assert extract_weapon_upgrade_slots(parsed) == {
        "SwordWeapon": {
            "1": {"reqTrait": "SwordBaseUpgradeTrait", "max": 5, "costs": [1, 1, 1, 1, 1], "startsUnlocked": True},
            "2": {"trait": "SwordRushTrait", "max": 5, "costs": [1, 1, 2, 2, 3]},
            "3": {"trait": "SwordConsecrationTrait", "max": 5, "costs": [3, 3, 3, 3, 3]},
        },
        "SpearWeapon": {
            "1": {"max": 5, "startsUnlocked": True},
            "2": {"trait": "SpearWaveTrait", "max": 5},
        },
    }


def test_extract_save_eval_static_bundles_every_table():
    bundle = extract_save_eval_static(parse(META_LUA), parse(WEAPON_LUA))
    assert bundle == {
        "metaUpgradeOrderLength": 3,
        "shrineUpgradeOrder": [
            "EnemyDamageShrineUpgrade",
            "MetaUpgradeStrikeThroughShrineUpgrade",
            "BiomeSpeedShrineUpgrade",
        ],
        "strikeThroughChangeValue": -3,
        "weaponUpgradeSlots": {
            "SwordWeapon": {
                "1": {"reqTrait": "SwordBaseUpgradeTrait", "max": 5, "costs": [1, 1, 1, 1, 1], "startsUnlocked": True},
                "2": {"trait": "SwordRushTrait", "max": 5, "costs": [1, 1, 2, 2, 3]},
                "3": {"trait": "SwordConsecrationTrait", "max": 5, "costs": [3, 3, 3, 3, 3]},
            },
            "SpearWeapon": {
                "1": {"max": 5, "startsUnlocked": True},
                "2": {"trait": "SpearWaveTrait", "max": 5},
            },
        },
        "cosmeticVisibleValue": "visible",
    }


def test_missing_tables_degrade_gracefully():
    empty = parse("SomethingElse = { 1, 2 }")
    assert extract_meta_upgrade_order_length(empty) == 0
    assert extract_shrine_upgrade_order(empty) == []
    assert extract_strike_through_change_value(empty) == 0
    assert extract_weapon_upgrade_slots(empty) == {}
