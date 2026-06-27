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
    extract_god_loot_data,
    extract_keepsake_max_chambers,
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

# Mirrors LootData.lua's shape: a DebugOnly BaseLoot template carrying the
# inheritable GodLoot flag; a god inheriting it (its TraitIndex unions the
# trait lists plus LinkedUpgrades keys); a shop-only god (GodLoot = false,
# TreatAsGodLootByShops = true, e.g. Hermes); and a non-god boon owner
# (GodLoot = false, no shop flag, e.g. the Chaos TrialUpgrade).
LOOT_LUA = """
LootData =
{
    BaseSoundPackage =
    {
        DebugOnly = true,
    },
    BaseLoot =
    {
        GodLoot = true,
        DebugOnly = true,
    },
    ZeusUpgrade =
    {
        InheritFrom = { "BaseLoot", "BaseSoundPackage" },
        WeaponUpgrades = { "ZeusWeaponTrait" },
        Traits = { "LightningRodTrait" },
        LinkedUpgrades =
        {
            ZeusBonusBounceTrait = { OneOf = { "ZeusWeaponTrait" } },
        },
    },
    HermesUpgrade =
    {
        InheritFrom = { "BaseLoot" },
        GodLoot = false,
        TreatAsGodLootByShops = true,
        Traits = { "RushSpeedBoostTrait" },
    },
    TrialUpgrade =
    {
        InheritFrom = { "BaseLoot" },
        GodLoot = false,
        Traits = { "ChaosBlessingHealthTrait" },
    },
}
"""


TRAIT_LUA = """
TraitData =
{
    GiftTrait =
    {
        Slot = "Keepsake",
        ChamberThresholds = { 25, 50 },
    },
    AssistTrait =
    {
        Slot = "Assist",
        ChamberThresholds = { 25, 50 },
    },
    MaxHealthKeepsakeTrait =
    {
        InheritFrom = { "GiftTrait" },
    },
    FuryAssistTrait =
    {
        InheritFrom = { "AssistTrait" },
        KeepsakeRarityGameStateRequirements =
        {
            { AssistUpgradeLevel = { Name = "FuryAssistTrait", Level = 0 } },
        },
    },
    LightningRodTrait =
    {
        Slot = "Minor",
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
    bundle = extract_save_eval_static(
        parse(META_LUA), parse(WEAPON_LUA), parse(LOOT_LUA), parse(TRAIT_LUA)
    )
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
        "godLootTraitIndex": {
            "ZeusUpgrade": ["LightningRodTrait", "ZeusBonusBounceTrait", "ZeusWeaponTrait"],
            "HermesUpgrade": ["RushSpeedBoostTrait"],
            "TrialUpgrade": ["ChaosBlessingHealthTrait"],
        },
        "godTraitNamesForShop": [
            "LightningRodTrait",
            "RushSpeedBoostTrait",
            "ZeusBonusBounceTrait",
            "ZeusWeaponTrait",
        ],
        "keepsakeMaxChambers": {
            "GiftTrait": 75,
            "AssistTrait": 75,
            "MaxHealthKeepsakeTrait": 75,
        },
    }


def test_god_loot_trait_index_unions_lists_and_linked_keys():
    data = extract_god_loot_data(parse(LOOT_LUA))
    # Zeus's TraitIndex unions WeaponUpgrades + Traits + LinkedUpgrades keys.
    assert data["godLootTraitIndex"]["ZeusUpgrade"] == [
        "LightningRodTrait",
        "ZeusBonusBounceTrait",
        "ZeusWeaponTrait",
    ]
    # A non-god boon owner (Chaos) still ships its index - RequiredGodLoot
    # reads LootData[god] for any god value, not just GodLoot ones.
    assert data["godLootTraitIndex"]["TrialUpgrade"] == ["ChaosBlessingHealthTrait"]
    # The DebugOnly BaseLoot template (no trait lists) is not indexed.
    assert "BaseLoot" not in data["godLootTraitIndex"]


def test_shop_set_uses_inherited_godloot_and_treat_as_god_loot():
    data = extract_god_loot_data(parse(LOOT_LUA))
    shop = set(data["godTraitNamesForShop"])
    # Zeus inherits GodLoot = true -> its traits are god traits for shops.
    assert {"ZeusWeaponTrait", "LightningRodTrait", "ZeusBonusBounceTrait"} <= shop
    # Hermes is GodLoot = false but TreatAsGodLootByShops -> still in the set.
    assert "RushSpeedBoostTrait" in shop
    # Chaos (GodLoot = false, no shop flag) is not a god boon for the shop test.
    assert "ChaosBlessingHealthTrait" not in shop


def test_god_loot_missing_table_degrades_gracefully():
    empty = extract_god_loot_data(parse("SomethingElse = { 1, 2 }"))
    assert empty == {"godLootTraitIndex": {}, "godTraitNamesForShop": []}


def test_keepsake_max_chambers_sum_inherited_thresholds():
    data = extract_keepsake_max_chambers(parse(TRAIT_LUA))
    # A keepsake inherits ChamberThresholds { 25, 50 } from GiftTrait -> mastered
    # at the 75-chamber sum.
    assert data["MaxHealthKeepsakeTrait"] == 75


def test_keepsake_max_chambers_excludes_companion_keepsakes():
    data = extract_keepsake_max_chambers(parse(TRAIT_LUA))
    # The companion keepsakes use KeepsakeRarityGameStateRequirements (assist-NPC
    # upgrade levels), not chamber thresholds, so they're left out and stay
    # indeterminate in the viewer.
    assert "FuryAssistTrait" not in data


def test_keepsake_max_chambers_excludes_non_keepsake_traits():
    data = extract_keepsake_max_chambers(parse(TRAIT_LUA))
    # A boon trait has no ChamberThresholds and isn't a keepsake.
    assert "LightningRodTrait" not in data


def test_keepsake_max_chambers_missing_table_degrades_gracefully():
    assert extract_keepsake_max_chambers(parse("SomethingElse = { 1, 2 }")) == {}


def test_missing_tables_degrade_gracefully():
    empty = parse("SomethingElse = { 1, 2 }")
    assert extract_meta_upgrade_order_length(empty) == 0
    assert extract_shrine_upgrade_order(empty) == []
    assert extract_strike_through_change_value(empty) == 0
    assert extract_weapon_upgrade_slots(empty) == {}
