"""Tests for the LootData extractor."""

from src.lua_parser import LuaParser
from src.extractors.hades1.loot_data import extract_loot_data, LOOT_DEFAULT_SPEAKERS


def extract(lua_text, source="Test", source_file="LootData.lua"):
    parsed = LuaParser(lua_text).parse_file()
    return extract_loot_data(parsed, source_label=source, source_file=source_file)


class TestBasicExtraction:
    def test_empty_input_returns_empty(self):
        assert extract("") == {}

    def test_input_without_lootdata_returns_empty(self):
        assert extract('OtherTable = { x = 1 }') == {}

    def test_god_upgrade_owner_keyed_by_upgrade_name(self):
        lua = '''LootData = {
            ZeusUpgrade = {
                InteractTextLineSets = {
                    ZeusFirstPickUp = { { Text = "I am Zeus!" } }
                }
            }
        }'''
        result = extract(lua)
        assert "ZeusUpgrade" in result
        assert result["ZeusUpgrade"]["source"] == "Test"


class TestDefaultSpeakerMapping:
    """LootData lines without an explicit Speaker should fall back to the
    canonical god NPC id, not the owner key (otherwise search/filter by
    speaker is split across boon tables)."""

    def test_zeus_upgrade_default_speaker_is_npc_zeus_01(self):
        lua = '''LootData = {
            ZeusUpgrade = {
                InteractTextLineSets = {
                    ZeusFirstPickUp = { { Text = "Boon offered!" } }
                }
            }
        }'''
        result = extract(lua)
        line = result["ZeusUpgrade"]["InteractTextLineSets"]["ZeusFirstPickUp"]
        assert line["dialogueLines"][0]["speaker"] == "NPC_Zeus_01"

    def test_all_known_god_upgrades_have_canonical_npc_mapping(self):
        """Sanity check: every key in LOOT_DEFAULT_SPEAKERS maps to a
        canonical NPC_*_01 id (cheap regression against typo)."""
        for key, value in LOOT_DEFAULT_SPEAKERS.items():
            assert value.startswith("NPC_"), f"{key} -> {value}"

    def test_explicit_speaker_overrides_default(self):
        lua = '''LootData = {
            ZeusUpgrade = {
                InteractTextLineSets = {
                    ZeusFirstPickUp = {
                        { Speaker = "CharProtag", Text = "Thank you, Zeus." },
                        { Text = "You are welcome." }
                    }
                }
            }
        }'''
        result = extract(lua)
        lines = result["ZeusUpgrade"]["InteractTextLineSets"]["ZeusFirstPickUp"]["dialogueLines"]
        assert lines == [
            {"speaker": "CharProtag", "text": "Thank you, Zeus."},
            {"speaker": "NPC_Zeus_01", "text": "You are welcome."},
        ]

    def test_unknown_upgrade_falls_back_to_owner_name(self):
        """A LootData entry not in LOOT_DEFAULT_SPEAKERS should default the
        speaker to the owner key itself."""
        lua = '''LootData = {
            SomeUnknownUpgrade = {
                InteractTextLineSets = {
                    Line01 = { { Text = "Hi" } }
                }
            }
        }'''
        result = extract(lua)
        line = result["SomeUnknownUpgrade"]["InteractTextLineSets"]["Line01"]
        assert line["dialogueLines"][0]["speaker"] == "SomeUnknownUpgrade"


class TestNonUpgradeKeysIgnored:
    def test_lootdata_keys_without_textline_sections_dropped(self):
        lua = '''LootData = {
            ZeusUpgrade = {
                InteractTextLineSets = { L = { { Text = "x" } } }
            },
            SomeMetadataKey = { foo = "bar" }
        }'''
        result = extract(lua)
        assert "ZeusUpgrade" in result
        assert "SomeMetadataKey" not in result
