"""Tests for the H2 Loot data extractor.

Covers the discovery and speaker-mapping contracts of
:func:`.loot_data.extract_loot_data`:

* Discovers ``LootSetData.<God>`` top-level keys via regex.
* Iterates owner entries inside; multi-owner per container supported.
* Owners with zero non-empty sections dropped (master file templates
  and helper entries like ``LootSetData.Apollo.Using``).
* ``LOOT_DEFAULT_SPEAKERS`` maps standard ``<God>Upgrade`` ids to the
  canonical god NPC id; ``TrialUpgrade``/``SpellDrop`` covered.
* ``HermesUpgrade`` intentionally absent from the speaker map - the
  owner-fallback path emits it as-is (it IS a canonical speaker).
* Output shape mirrors the NPC extractor (``source`` + per-section dicts).
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.loot_data import (
    LOOT_DEFAULT_SPEAKERS,
    extract_loot_data,
)


def _parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestDiscovery:
    def test_per_god_container_discovered(self):
        parsed = _parse("""
            LootSetData.Aphrodite = {
                AphroditeUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Aphrodite.lua")
        assert "AphroditeUpgrade" in owners
        assert owners["AphroditeUpgrade"]["source"] == "Hades 2"

    def test_master_loot_container_discovered_but_drops_empty_templates(self):
        parsed = _parse("""
            LootSetData.Loot = {
                BaseLoot = { },
                StackUpgrade = { InheritFrom = { "BaseLoot" } },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData.lua")
        assert owners == {}

    def test_non_loot_top_level_ignored(self):
        # GlobalVoiceLines / RewardStoreData / MetaRewardStandData in the
        # master file (and per-god files) must not be picked up.
        parsed = _parse("""
            LootSetData.Aphrodite = {
                AphroditeUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
            GlobalVoiceLines.PoseidonDoubleRewardReactionLines = { }
            RewardStoreData.HubRewards = { }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Aphrodite.lua")
        assert set(owners.keys()) == {"AphroditeUpgrade"}

    def test_helper_owner_without_textlines_dropped(self):
        # LootSetData.Apollo also contains a `Using` entry that only
        # carries Animation - it must drop.
        parsed = _parse("""
            LootSetData.Apollo = {
                ApolloUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
                Using = {
                    Animation = "ApolloUsing",
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Apollo.lua")
        assert set(owners.keys()) == {"ApolloUpgrade"}


class TestSpeakerMapping:
    def test_standard_upgrade_maps_to_god_npc(self):
        parsed = _parse("""
            LootSetData.Aphrodite = {
                AphroditeUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Aphrodite.lua")
        line = owners["AphroditeUpgrade"]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Aphrodite_01"

    def test_trial_upgrade_maps_to_chaos_npc(self):
        # Chaos's owner is `TrialUpgrade`, not `ChaosUpgrade`.
        parsed = _parse("""
            LootSetData.Chaos = {
                TrialUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Chaos.lua")
        line = owners["TrialUpgrade"]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Chaos_01"

    def test_spell_drop_maps_to_selene_npc(self):
        # Selene's owner is `SpellDrop`, not `SeleneUpgrade`.
        parsed = _parse("""
            LootSetData.Selene = {
                SpellDrop = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Selene.lua")
        line = owners["SpellDrop"]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Selene_01"

    def test_hermes_upgrade_falls_back_to_self(self):
        # HermesUpgrade is intentionally unmapped because it IS the
        # canonical speaker id - the textline walker's owner fallback
        # should emit it.
        parsed = _parse("""
            LootSetData.Hermes = {
                HermesUpgrade = {
                    InteractTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Hermes.lua")
        line = owners["HermesUpgrade"]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "HermesUpgrade"

    def test_hermes_upgrade_not_in_speaker_map(self):
        # Belt-and-braces: lock in the intentional absence so a future
        # well-meaning edit doesn't add it back.
        assert "HermesUpgrade" not in LOOT_DEFAULT_SPEAKERS

    def test_all_god_upgrade_keys_covered(self):
        # Spot-check the standard set so a missing entry would fail
        # this test (would silently default to the owner key
        # otherwise, which would break the speaker label).
        for owner in ("AphroditeUpgrade", "ApolloUpgrade", "AresUpgrade",
                      "DemeterUpgrade", "HephaestusUpgrade", "HeraUpgrade",
                      "HestiaUpgrade", "PoseidonUpgrade", "ZeusUpgrade"):
            assert owner in LOOT_DEFAULT_SPEAKERS


class TestSections:
    def test_multiple_loot_section_keys_extracted(self):
        parsed = _parse("""
            LootSetData.Aphrodite = {
                AphroditeUpgrade = {
                    InteractTextLineSets = {
                        I = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                    BoughtTextLines = {
                        B = { { Cue = "/VO/X_0002", Text = "Hi." } },
                    },
                    MakeUpTextLines = {
                        M = { { Cue = "/VO/X_0003", Text = "Hi." } },
                    },
                    RejectionTextLines = {
                        R = { { Cue = "/VO/X_0004", Text = "Hi." } },
                    },
                    DuoPickupTextLines = {
                        D = { { Cue = "/VO/X_0005", Text = "Hi." } },
                    },
                    GiftTextLineSets = {
                        G = { { Cue = "/VO/X_0006", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_loot_data(parsed, source_label="Hades 2", source_file="LootData_Aphrodite.lua")
        entry = owners["AphroditeUpgrade"]
        for sk in ("InteractTextLineSets", "BoughtTextLines", "MakeUpTextLines",
                   "RejectionTextLines", "DuoPickupTextLines", "GiftTextLineSets"):
            assert sk in entry
