"""Tests for the H2 Enemy data extractor.

Covers the discovery and speaker-mapping contracts of
:func:`.enemy_data.extract_enemy_data`:

* Discovers ``UnitSetData.<BossName>`` top-level keys via regex.
* Iterates owner entries inside; the single named owner usually shares
  the container's name (``UnitSetData.Hecate.Hecate``).
* Owners with zero non-empty section keys are dropped so the master
  file's ``UnitSetData.Enemies`` mook templates and every dialogue-less
  ``EnemyData_<Mook>.lua`` file are filtered.
* ``ENEMY_DEFAULT_SPEAKERS`` maps each boss owner key to its canonical
  NPC speaker id; bosses without an NPC speaker form
  (``InfestedCerberus`` / ``TyphonHead``) fall through to documented
  substitutes.
* Output shape mirrors the NPC and Loot extractors (``source`` +
  per-section dicts).
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.enemy_data import (
    ENEMY_DEFAULT_SPEAKERS,
    extract_enemy_data,
)


def _parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestDiscovery:
    def test_per_boss_container_discovered(self):
        parsed = _parse("""
            UnitSetData.Hecate = {
                Hecate = {
                    BossIntroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Hecate.lua")
        assert "Hecate" in owners
        assert owners["Hecate"]["source"] == "Hades 2"

    def test_master_enemy_container_discovered_but_drops_empty_templates(self):
        # The master EnemyData.lua holds UnitSetData.Enemies = { BaseEnemy = {...}, ... }
        # full of combat-mook templates with no dialogue sections.
        parsed = _parse("""
            UnitSetData.Enemies = {
                BaseEnemy = { },
                BaseMeleeTough = { InheritFrom = { "BaseEnemy" } },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData.lua")
        assert owners == {}

    def test_non_unit_set_top_level_ignored(self):
        # CollisionReactionData / StatusAnimations / ConstantsData in the
        # master file (and other per-boss files) must not be picked up.
        parsed = _parse("""
            UnitSetData.Hecate = {
                Hecate = {
                    BossIntroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
            CollisionReactionData.Damage = { }
            StatusAnimations.Burning = { }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Hecate.lua")
        assert set(owners.keys()) == {"Hecate"}

    def test_dialogue_less_per_enemy_file_drops(self):
        # The vast majority of EnemyData_<Mook>.lua files have no dialogue.
        parsed = _parse("""
            UnitSetData.PunchingBagUnit = {
                PunchingBagUnit = {
                    Health = 100,
                    MoveSpeed = 0,
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_PunchingBagUnit.lua")
        assert owners == {}


class TestSpeakerMapping:
    def test_chronos_maps_to_chronos_npc(self):
        parsed = _parse("""
            UnitSetData.Chronos = {
                Chronos = {
                    BossIntroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Chronos.lua")
        line = owners["Chronos"]["BossIntroTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Chronos_01"

    def test_polyphemus_maps_to_cyclops_npc(self):
        # Polyphemus is the boss owner key; the canonical speaker id is NPC_Cyclops_01.
        parsed = _parse("""
            UnitSetData.Polyphemus = {
                Polyphemus = {
                    BossIntroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Polyphemus.lua")
        line = owners["Polyphemus"]["BossIntroTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Cyclops_01"

    def test_infested_cerberus_maps_to_homer(self):
        # Cerberus does not actually speak; the unattributed cues on the
        # alt-fight outro are Homer-style narration.
        parsed = _parse("""
            UnitSetData.InfestedCerberus = {
                InfestedCerberus = {
                    BossOutroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_InfestedCerberus.lua")
        line = owners["InfestedCerberus"]["BossOutroTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "Speaker_Homer"

    def test_typhon_head_maps_to_chronos(self):
        # Typhon has no NPC speaker; unattributed cues are Chronos.
        parsed = _parse("""
            UnitSetData.TyphonHead = {
                TyphonHead = {
                    BossIntroTextLineSets = {
                        Foo = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_TyphonHead.lua")
        line = owners["TyphonHead"]["BossIntroTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Chronos_01"

    def test_explicit_speaker_overrides_default(self):
        # The TyphonHead phase-change sets cover lines explicitly tagged
        # ``Speaker = "PlayerUnit_Flashback"``; the cue Speaker must win.
        parsed = _parse("""
            UnitSetData.TyphonHead = {
                TyphonHead = {
                    BossPhaseChangeTextLineSets = {
                        Foo = { { Speaker = "PlayerUnit_Flashback", Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_TyphonHead.lua")
        line = owners["TyphonHead"]["BossPhaseChangeTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "PlayerUnit_Flashback"

    def test_use_player_source_overrides_default(self):
        # UsePlayerSource takes precedence over the boss default speaker
        # (the cue is voiced by Melinoë inside a boss-owned set).
        parsed = _parse("""
            UnitSetData.Hecate = {
                Hecate = {
                    BossIntroTextLineSets = {
                        Foo = { { UsePlayerSource = true, Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Hecate.lua")
        line = owners["Hecate"]["BossIntroTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "PlayerUnit"

    def test_all_known_boss_owners_covered(self):
        # The 9 bosses with textlines are the entire population that this
        # extractor needs to map (verified by audit). A missing entry
        # would silently fall back to the bare owner key, which is NOT a
        # registered speaker - lock the set in.
        for owner in ("Chronos", "Eris", "Hecate", "InfestedCerberus",
                      "Polyphemus", "Prometheus", "Scylla", "TyphonHead",
                      "Zagreus"):
            assert owner in ENEMY_DEFAULT_SPEAKERS


class TestSections:
    def test_multiple_boss_section_keys_extracted(self):
        # Bosses can carry all three boss-* section keys at once.
        parsed = _parse("""
            UnitSetData.Hecate = {
                Hecate = {
                    BossIntroTextLineSets = {
                        I = { { Cue = "/VO/X_0001", Text = "Hi." } },
                    },
                    BossOutroTextLineSets = {
                        O = { { Cue = "/VO/X_0002", Text = "Hi." } },
                    },
                    BossPhaseChangeTextLineSets = {
                        P = { { Cue = "/VO/X_0003", Text = "Hi." } },
                    },
                },
            }
        """)
        owners = extract_enemy_data(parsed, source_label="Hades 2", source_file="EnemyData_Hecate.lua")
        entry = owners["Hecate"]
        for sk in ("BossIntroTextLineSets", "BossOutroTextLineSets",
                   "BossPhaseChangeTextLineSets"):
            assert sk in entry
