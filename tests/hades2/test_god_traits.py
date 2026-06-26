"""Tests for :mod:`src.extractors.hades2.god_traits`.

The extractor pre-computes the two name sets that back the H2
``RequiredSellableGodTraits`` / ``RequireUnrestrictedBoonChoices``
``otherRequirements`` gates, mirroring the engine's
``IsGodTrait( name, { ForShop = true } )`` and ``RestrictBoonChoices``
logic.

Tests use small Lua-text fixtures (via ``tmp_path``) so they're
independent of which Steam install is on disk, exercising the inheritance
quirks the extractor is built around:

* ``GodLoot`` / ``TreatAsGodLootByShops`` are inherited through
  ``InheritFrom``; an owner's own value (including an explicit ``false``)
  wins.
* ``DebugOnly`` is *not* inherited - a ``DebugOnly`` template does not
  taint its inheritors, but an owner's own ``DebugOnly`` excludes it.
* ``TraitIndex`` is the union of ``Traits`` / ``WeaponUpgrades`` /
  ``PermanentTraits`` / ``TemporaryTraits``.
* Field gods come from ``NPCData_*.lua`` owners flagged
  ``TreatAsGodLootByShops`` (no ``DebugOnly`` exclusion there).
"""

from pathlib import Path

from src.extractors.hades2.god_traits import extract_god_trait_metadata


def _write(tmp_path: Path, name: str, body: str) -> None:
    (tmp_path / name).write_text(body, encoding="utf-8")


class TestEmpty:
    def test_no_source_files_yields_empty_sets(self, tmp_path):
        # Missing source files are skipped; the gates just stay indeterminate.
        assert extract_god_trait_metadata(tmp_path) == {
            "godTraitNames": [],
            "restrictBoonChoiceTraitNames": [],
        }


class TestGodLootInheritance:
    def test_per_god_owner_inherits_godloot_from_template(self, tmp_path):
        # BaseLoot template carries GodLoot=true; ZeusUpgrade inherits it
        # and contributes its Traits to the god-trait set.
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Loot = {\n"
                "    BaseLoot = { GodLoot = true },\n"
                "}\n"
                "LootSetData.Zeus = {\n"
                "    ZeusUpgrade = {\n"
                '        InheritFrom = { "BaseLoot" },\n'
                '        Traits = { "ZeusManaBoltBoon", "ZeusShieldBoon" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["ZeusManaBoltBoon", "ZeusShieldBoon"]

    def test_traitindex_unions_all_trait_list_fields(self, tmp_path):
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Loot = {\n"
                "    BaseLoot = { GodLoot = true },\n"
                "}\n"
                "LootSetData.Zeus = {\n"
                "    ZeusUpgrade = {\n"
                '        InheritFrom = { "BaseLoot" },\n'
                '        Traits = { "TraitA" },\n'
                '        WeaponUpgrades = { "TraitB" },\n'
                '        PermanentTraits = { "TraitC" },\n'
                '        TemporaryTraits = { "TraitD" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["TraitA", "TraitB", "TraitC", "TraitD"]

    def test_treat_as_god_loot_by_shops_also_qualifies(self, tmp_path):
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Shop = {\n"
                "    ShopBoon = {\n"
                "        TreatAsGodLootByShops = true,\n"
                '        Traits = { "ShopTrait" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["ShopTrait"]


class TestDebugOnlyHandling:
    def test_owners_own_debugonly_is_excluded(self, tmp_path):
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Debug = {\n"
                "    DebugBoon = {\n"
                "        GodLoot = true,\n"
                "        DebugOnly = true,\n"
                '        Traits = { "DebugTrait" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == []

    def test_debugonly_template_does_not_taint_inheritors(self, tmp_path):
        # DebugOnly is in the engine's inheritanceIgnores set: the child
        # inheriting from a DebugOnly+GodLoot template is still a god trait.
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Loot = {\n"
                "    BaseLoot = { GodLoot = true, DebugOnly = true },\n"
                "}\n"
                "LootSetData.Zeus = {\n"
                "    ZeusUpgrade = {\n"
                '        InheritFrom = { "BaseLoot" },\n'
                '        Traits = { "ZeusManaBoltBoon" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["ZeusManaBoltBoon"]


class TestFieldGods:
    def test_npc_field_god_owner_contributes_traits(self, tmp_path):
        _write(
            tmp_path,
            "NPCData_Athena.lua",
            (
                "UnitSetData.Athena = {\n"
                "    NPC_Athena_Field_01 = {\n"
                "        TreatAsGodLootByShops = true,\n"
                '        Traits = { "AthenaRushBoon" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["AthenaRushBoon"]


class TestRestrictBoonChoices:
    def test_collects_traits_defining_restrict_boon_choices(self, tmp_path):
        _write(
            tmp_path,
            "TraitData_Chaos.lua",
            (
                "TraitSetData.Chaos = {\n"
                "    ChaosRestrictBoonCurse = { RestrictBoonChoices = true },\n"
                "    ChaosBlessing = { Foo = 1 },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["restrictBoonChoiceTraitNames"] == ["ChaosRestrictBoonCurse"]


class TestDeterministicOutput:
    def test_lists_are_sorted_and_deduplicated(self, tmp_path):
        _write(
            tmp_path,
            "LootData.lua",
            (
                "LootSetData.Loot = {\n"
                "    BaseLoot = { GodLoot = true },\n"
                "}\n"
                "LootSetData.A = {\n"
                "    AUpgrade = {\n"
                '        InheritFrom = { "BaseLoot" },\n'
                '        Traits = { "Zebra", "Apple", "Apple" },\n'
                "    },\n"
                "}\n"
            ),
        )
        meta = extract_god_trait_metadata(tmp_path)
        assert meta["godTraitNames"] == ["Apple", "Zebra"]
