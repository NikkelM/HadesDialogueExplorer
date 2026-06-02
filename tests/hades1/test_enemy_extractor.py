"""Tests for the EnemyData extractor."""

from src.lua_parser import LuaParser
from src.extractors.hades1.enemy_data import extract_enemy_data


def extract(lua_text, source="Test", source_file="EnemyData.lua"):
    parsed = LuaParser(lua_text).parse_file()
    return extract_enemy_data(parsed, source_label=source, source_file=source_file)


class TestBasicExtraction:
    def test_empty_input_returns_empty(self):
        assert extract("") == {}

    def test_input_without_unitsetdata_enemies_returns_empty(self):
        assert extract('SomethingElse = { x = 1 }') == {}

    def test_enemy_owner_keyed_by_internal_name(self):
        lua = '''UnitSetData.Enemies = {
            Theseus = {
                BossPresentationTextLineSets = {
                    TheseusFirstAppearance = { { Text = "Behold!" } }
                }
            }
        }'''
        result = extract(lua)
        assert "Theseus" in result
        assert result["Theseus"]["source"] == "Test"


class TestSpeakerAttribution:
    def test_default_speaker_is_owner(self):
        lua = '''UnitSetData.Enemies = {
            Theseus = {
                BossPresentationTextLineSets = {
                    L = { { Text = "Champion of Champions!" } }
                }
            }
        }'''
        result = extract(lua)
        line = result["Theseus"]["BossPresentationTextLineSets"]["L"]
        assert line["dialogueLines"][0]["speaker"] == "Theseus"

    def test_explicit_speaker_honored(self):
        lua = '''UnitSetData.Enemies = {
            Theseus = {
                BossPresentationTextLineSets = {
                    L = { { Speaker = "CharProtag", Text = "Hello." } }
                }
            }
        }'''
        result = extract(lua)
        line = result["Theseus"]["BossPresentationTextLineSets"]["L"]
        assert line["dialogueLines"][0]["speaker"] == "CharProtag"


class TestSectionDiscovery:
    def test_multiple_boss_presentation_sections(self):
        lua = '''UnitSetData.Enemies = {
            Hades = {
                BossPresentationTextLineSets = { A = { { Text = "a" } } },
                BossPresentationDefeatTextLineSets = { B = { { Text = "b" } } },
                BossPresentationFightTextLineSets = { C = { { Text = "c" } } },
            }
        }'''
        result = extract(lua)
        hades = result["Hades"]
        assert "BossPresentationTextLineSets" in hades
        assert "BossPresentationDefeatTextLineSets" in hades
        assert "BossPresentationFightTextLineSets" in hades

    def test_enemy_without_textline_sections_dropped(self):
        lua = '''UnitSetData.Enemies = {
            Theseus = { BossPresentationTextLineSets = { L = { { Text = "x" } } } },
            GenericEnemy = { Health = 100 }
        }'''
        result = extract(lua)
        assert "Theseus" in result
        assert "GenericEnemy" not in result
