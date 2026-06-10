"""Tests for the H2 EncounterData / RoomData extractor.

Covers the discovery, owner-collapse, ancestor-merge, and per-textline
override contracts of
:func:`.encounter_room_data.extract_encounter_room_data`:

* Discovers ``EncounterData.<Encounter>`` and ``RoomSetData.<L>.<Room>``
  trees as roots; ignores anything else at the top level.
* Generic tree walker yields any container holding at least one
  textline-set section (handles arbitrary nesting depth - InspectPoints
  for narrator, ObstacleData for room interaction, UnthreadedEvents
  Args.TextLineSet for inline narrative beats).
* ``InspectPoints[<id>]`` paths collapse to :data:`HUB_NARRATOR_SPEAKER`
  via :data:`IDMAP_PARENT_OWNER_OVERRIDES`; other named-ancestor paths
  use the encounter / room name as owner.
* :data:`TEXTLINE_OWNER_OVERRIDES` re-routes the listed textlines
  (PalaceBoonExit*, NemesisWithNarcissus0X, HecateWithArachne01,
  TrueEnding01/02, TrueEndingFinale01) to their natural NPC owner with
  optional ``partner`` annotation.
* Ancestor-level requirements (GameStateRequirements,
  OnUsedGameStateRequirements, SetupGameStateRequirements) lift onto
  contained textlines via :func:`merge_ancestor_requirements_h2`.
* Returns ``{}`` when no walkable root is found.
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.encounter_room_data import (
    HUB_NARRATOR_SPEAKER,
    IDMAP_PARENT_OWNER_OVERRIDES,
    TEXTLINE_OWNER_OVERRIDES,
    extract_encounter_room_data,
)


def _parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestRootDiscovery:
    def test_no_walkable_roots_returns_empty(self):
        parsed = _parse("""
            NarrativeData = { Foo = { } }
        """)
        result = extract_encounter_room_data(parsed)
        assert result == {}

    def test_encounter_data_root_discovered(self):
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_Arachne_01 = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                TextLineSet = {
                                    HecateWithArachne01 = {
                                        { Cue = "/VO/Hecate_0549", Text = "Hi." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed, source_label="Hades 2")
        # Routed via TEXTLINE_OWNER_OVERRIDES to NPC_Hecate_01.
        assert "NPC_Hecate_01" in result
        assert "HecateWithArachne01" in result["NPC_Hecate_01"]["TextLineSet"]

    def test_room_set_data_biome_root_discovered(self):
        # RoomSetData.<L> is matched by prefix - any biome letter works.
        parsed = _parse("""
            RoomSetData.F =
            {
                F_Opening01 = {
                    InspectPoints = {
                        [1] = {
                            InteractTextLineSets = {
                                InspectFOpening = {
                                    { Cue = "/VO/Homer_0010", Text = "{#Emph}A scene." },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed)
        # InspectPoints collapse to Speaker_Homer (idmap rule).
        assert HUB_NARRATOR_SPEAKER in result
        assert "InspectFOpening" in result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]


class TestOwnerNaming:
    def test_inspect_points_collapse_to_homer(self):
        # Any InspectPoints idmap entry collapses regardless of which
        # room / encounter ancestor it sits under.
        parsed = _parse("""
            RoomSetData.G =
            {
                G_Boss01 = {
                    InspectPoints = {
                        [55] = {
                            InteractTextLineSets = {
                                InspectScene = {
                                    { Cue = "/VO/Homer_0099", Text = "Scene." },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed)
        assert "G_Boss01" not in result
        assert HUB_NARRATOR_SPEAKER in result

    def test_obstacle_data_does_not_collapse(self):
        # ObstacleData[<id>] uses idmap form but isn't in
        # IDMAP_PARENT_OWNER_OVERRIDES; textlines keep the room name
        # (then optionally re-routed by TEXTLINE_OWNER_OVERRIDES).
        parsed = _parse("""
            RoomSetData.Q =
            {
                Q_TestRoom = {
                    ObstacleData = {
                        [1] = {
                            InteractTextLineSets = {
                                ObstacleTalk = {
                                    { Cue = "/VO/Foo_0001", Text = "Hi." },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed)
        # Owner is the room name (no override match for ObstacleTalk).
        assert "Q_TestRoom" in result
        assert HUB_NARRATOR_SPEAKER not in result
        assert "ObstacleTalk" in result["Q_TestRoom"]["InteractTextLineSets"]

    def test_topmost_named_ancestor_wins(self):
        # When a textline-set lives several levels under a room, the
        # owner is the room name (topmost named ancestor below the root)
        # rather than any intermediate key.
        parsed = _parse("""
            RoomSetData.I =
            {
                I_Story01 = {
                    StartRoomUnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                InteractTextLineSets = {
                                    StoryTalk = {
                                        { Cue = "/VO/Foo_0001", Text = "Hi." },
                                    },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed)
        # Owner is the encounter name, not "Args" / "StartRoomUnthreadedEvents".
        assert "I_Story01" in result
        assert "StoryTalk" in result["I_Story01"]["InteractTextLineSets"]


class TestTextlineOwnerOverrides:
    def test_palace_boon_exit_routes_to_player(self):
        parsed = _parse("""
            RoomSetData.Q =
            {
                Q_Story01 = {
                    ObstacleData = {
                        [792347] = {
                            SpeakerName = "Hecate",
                            InteractTextLineSets = {
                                PalaceBoonExit01 = {
                                    { Cue = "/VO/MelinoeField_3834", UsePlayerSource = true,
                                      Text = "I'm unaccustomed to being on this side!" },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed, source_label="Hades 2")
        # Re-routed under PlayerUnit (Melinoë opens the set), NOT under
        # the room name or under NPC_Hecate_01 (the SpeakerName tag).
        assert "PlayerUnit" in result
        assert "PalaceBoonExit01" in result["PlayerUnit"]["InteractTextLineSets"]
        assert "Q_Story01" not in result
        assert "NPC_Hecate_01" not in result

    def test_xwithy_pair_gets_partner_annotation(self):
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_Narcissus_01 = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                TextLineSet = {
                                    NemesisWithNarcissus01 = {
                                        { Cue = "/VO/NemesisField_0025", Text = "..." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed)
        nem = result["NPC_Nemesis_01"]
        tl = nem["TextLineSet"]["NemesisWithNarcissus01"]
        assert tl["partner"] == "NPC_Narcissus_01"

    def test_true_ending_finale_routes_to_selene(self):
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_EndCredits = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                TextLineSet = {
                                    TrueEndingFinale01 = {
                                        { Cue = "/VO/Selene_0001", Source = "NPC_Selene_01",
                                          Text = "We have arrived." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed)
        assert "NPC_Selene_01" in result
        assert "TrueEndingFinale01" in result["NPC_Selene_01"]["TextLineSet"]
        assert "PlayerUnit" not in result

    def test_override_owner_does_not_get_synthetic_entry(self):
        # If every textline under an encounter is rerouted by overrides,
        # the encounter name should NOT show up as a (now-empty) owner.
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_Arachne_01 = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                TextLineSet = {
                                    HecateWithArachne01 = {
                                        { Cue = "/VO/Hecate_0549", Text = "Hi." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed)
        assert "Story_Arachne_01" not in result


class TestAncestorRequirements:
    def test_event_game_state_requirements_lifted_onto_textline(self):
        # GameStateRequirements on the event level is lifted onto the
        # textline so the dependency graph sees the gate.
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_Narcissus_01 = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "SurpriseNPCPresentation",
                            GameStateRequirements = {
                                {
                                    PathTrue = { "GameState", "TextLinesRecord", "NemesisWithNarcissus01_FollowUp" },
                                },
                            },
                            Args = {
                                TextLineSet = {
                                    NemesisWithNarcissus01 = {
                                        { Cue = "/VO/NemesisField_0025", Text = "..." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed)
        tl = result["NPC_Nemesis_01"]["TextLineSet"]["NemesisWithNarcissus01"]
        assert tl["requirements"].get("RequiredTextLines") == ["NemesisWithNarcissus01_FollowUp"]

    def test_obstacle_on_used_requirements_lifted(self):
        # ObstacleData carries OnUsedGameStateRequirements as a sibling
        # of InteractTextLineSets - exercise the newly-added member of
        # HADES2_REQUIREMENT_SET_FIELDS.
        parsed = _parse("""
            RoomSetData.Q =
            {
                Q_Story01 = {
                    ObstacleData = {
                        [792347] = {
                            OnUsedGameStateRequirements = {
                                {
                                    PathFalse = { "GameState", "TextLinesRecord", "PalaceBoonExit01" },
                                },
                            },
                            InteractTextLineSets = {
                                PalaceBoonExit01 = {
                                    { Cue = "/VO/Mel_001", UsePlayerSource = true, Text = "Hi." },
                                },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed)
        tl = result["PlayerUnit"]["InteractTextLineSets"]["PalaceBoonExit01"]
        assert tl["requirements"].get("RequiredFalseTextLines") == ["PalaceBoonExit01"]

    def test_nearest_ancestor_with_requirements_wins(self):
        # Outer container declares GameStateRequirements; inner one too.
        # The inner (nearer) container's reqs should win.
        parsed = _parse("""
            OverwriteTableKeys( EncounterData, {
                Story_Narcissus_01 = {
                    GameStateRequirements = {
                        {
                            PathTrue = { "GameState", "TextLinesRecord", "OuterReq" },
                        },
                    },
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            GameStateRequirements = {
                                {
                                    PathTrue = { "GameState", "TextLinesRecord", "InnerReq" },
                                },
                            },
                            Args = {
                                TextLineSet = {
                                    NemesisWithNarcissus01 = {
                                        { Cue = "/VO/X_001", Text = "..." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_encounter_room_data(parsed)
        tl = result["NPC_Nemesis_01"]["TextLineSet"]["NemesisWithNarcissus01"]
        # Only inner req should be lifted (replace-on-encounter, not union).
        assert tl["requirements"].get("RequiredTextLines") == ["InnerReq"]


class TestSourceData:
    def test_source_label_propagated_to_owner_entry(self):
        parsed = _parse("""
            RoomSetData.F =
            {
                F_Room = {
                    InspectPoints = {
                        [1] = {
                            InteractTextLineSets = {
                                X = { { Cue = "/VO/Homer_0001", Text = "Hi." } },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed, source_label="Hades 2")
        assert result[HUB_NARRATOR_SPEAKER]["source"] == "Hades 2"

    def test_source_file_recorded_on_each_textline(self):
        parsed = _parse("""
            RoomSetData.F =
            {
                F_Room = {
                    InspectPoints = {
                        [1] = {
                            InteractTextLineSets = {
                                X = { { Cue = "/VO/Homer_0001", Text = "Hi." } },
                            },
                        },
                    },
                },
            }
        """)
        result = extract_encounter_room_data(parsed, source_file="RoomDataF.lua")
        tl = result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]["X"]
        assert tl["sourceFile"] == "RoomDataF.lua"


class TestOverrideMaps:
    def test_palace_boon_exit_entries_all_route_to_player(self):
        # All 7 Q_Story01 ObstacleData boon prompts should be in the
        # override table and route to PlayerUnit (Melinoë opens every
        # set; Hecate is a respondent).
        for name in (
            "PalaceBoonExit01",
            "PalaceBoonExitTyphonDestroyed01",
            "PalaceBoonExitPostTrueEnding01",
            "PalaceBoonExit02",
            "PalaceBoonExitRepeatable01",
            "PalaceBoonExitRepeatable02",
            "PalaceBoonExitRepeatable03",
        ):
            assert name in TEXTLINE_OWNER_OVERRIDES
            assert TEXTLINE_OWNER_OVERRIDES[name]["owner"] == "PlayerUnit"

    def test_true_ending_owner_routing(self):
        # Per-set routing: opener speaker wins.
        assert TEXTLINE_OWNER_OVERRIDES["TrueEnding01"]["owner"] == "NPC_Hecate_01"
        assert TEXTLINE_OWNER_OVERRIDES["TrueEnding02"]["owner"] == "NPC_Persephone_01"
        assert TEXTLINE_OWNER_OVERRIDES["TrueEndingFinale01"]["owner"] == "NPC_Selene_01"

    def test_inspect_points_idmap_collapse_registered(self):
        assert IDMAP_PARENT_OWNER_OVERRIDES["InspectPoints"] == HUB_NARRATOR_SPEAKER
