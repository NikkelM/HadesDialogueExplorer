"""Tests for the H2 DeathLoop data extractor.

Covers the discovery, collapse, and ancestor-merge contracts of
:func:`.deathloop_data.extract_deathloop_data`:

* Discovers ``HubRoomData.<Hub>.InspectPoints.<id>`` containers via
  parent-keyed iteration.
* Discovers ``HubRoomData.<Hub>.OnLoadEvents[i].Args.PresentationFunctionArgs``
  containers for ``PostPortraitTextLines`` story beats.
* Collapses every inspect point + on-load event across every hub
  under a single owner (:data:`HUB_NARRATOR_SPEAKER`) so the viewer
  doesn't drown in synthetic ``InspectPoint_<id>`` entries.
* Lifts inspect-point ``SetupGameStateRequirements`` and event-level
  ``GameStateRequirements`` onto each contained textline so the graph
  picks up the container-level gates.
* Returns ``{}`` when no dialogue-bearing nodes are found (defensive).
"""

from src.lua_parser import LuaParser
from src.extractors.hades2.deathloop_data import (
    HUB_NARRATOR_SPEAKER,
    extract_deathloop_data,
)


def _parse(lua_text):
    return LuaParser(lua_text).parse_file()


class TestDiscovery:
    def test_inspect_point_textlines_collapse_under_homer(self):
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [421076] = {
                            PlayOnce = true,
                            InteractTextLineSets = {
                                InspectCrossroads01 = {
                                    { Cue = "/VO/Homer_0001", Text = "{#Emph}The Crossroads." },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert list(result.keys()) == [HUB_NARRATOR_SPEAKER]
        homer = result[HUB_NARRATOR_SPEAKER]
        assert homer["source"] == "Hades 2"
        assert "InspectCrossroads01" in homer["InteractTextLineSets"]

    def test_inspect_point_forced_play_once_without_source_field(self):
        """H2 inspect-point narration is one-shot in-game; the extractor
        force-marks it ``playOnce`` even when the source omits the flag."""
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [421076] = {
                            InteractTextLineSets = {
                                InspectCrossroads01 = {
                                    { Cue = "/VO/Homer_0001", Text = "The Crossroads." },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        tl = result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]["InspectCrossroads01"]
        assert tl["playOnce"] is True

    def test_multiple_hubs_collapse_to_one_owner(self):
        # Hub_Main + Hub_PreRun + Flashback_Hub_Main all contribute
        # to the single Speaker_Homer entry.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [1] = { InteractTextLineSets = {
                            MainOne = { { Cue = "/VO/Homer_0001", Text = "A." } } } },
                    },
                },
                Hub_PreRun = {
                    InspectPoints = {
                        [2] = { InteractTextLineSets = {
                            PreRunOne = { { Cue = "/VO/Homer_0002", Text = "B." } } } },
                    },
                },
                Flashback_Hub_Main = {
                    InspectPoints = {
                        [3] = { InteractTextLineSets = {
                            FlashbackOne = { { Cue = "/VO/Homer_0003", Text = "C." } } } },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert list(result.keys()) == [HUB_NARRATOR_SPEAKER]
        homer = result[HUB_NARRATOR_SPEAKER]
        tls = homer["InteractTextLineSets"]
        assert {"MainOne", "PreRunOne", "FlashbackOne"} <= set(tls)

    def test_on_load_event_post_portrait_lines_extracted(self):
        # OnLoadEvents.PresentationFunctionArgs.PostPortraitTextLines path.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    OnLoadEvents = {
                        {
                            FunctionName = "StartDeathLoop",
                            Args = {
                                PresentationFunctionArgs = {
                                    PostPortraitTextLines = {
                                        TrueEndingFinaleResponse01 = {
                                            PlayOnce = true,
                                            { Cue = "/VO/Melinoe_5736",
                                              UsePlayerSource = true,
                                              Text = "May it all turn out that way in time, Homer." },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        homer = result[HUB_NARRATOR_SPEAKER]
        pptl = homer["PostPortraitTextLines"]
        assert "TrueEndingFinaleResponse01" in pptl
        # UsePlayerSource overrides the Homer default speaker.
        line = pptl["TrueEndingFinaleResponse01"]["dialogueLines"][0]
        assert line["speaker"] == "PlayerUnit"

    def test_no_hub_root_returns_empty(self):
        parsed = _parse("""
            GameData.HubMapName = "Hub_Main"
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert result == {}

    def test_no_dialogue_returns_empty(self):
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_PreRun = {
                    InspectPoints = {
                        [1] = { PlayOnce = true, UseText = "UseExamineMisc" },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert result == {}


class TestSpeakerResolution:
    def test_unattributed_cue_defaults_to_homer(self):
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [1] = { InteractTextLineSets = {
                            Foo = { { Cue = "/VO/Homer_0001", Text = "Narration." } } } },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        line = result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == HUB_NARRATOR_SPEAKER

    def test_explicit_speaker_overrides_homer_default(self):
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [1] = { InteractTextLineSets = {
                            Foo = { { Speaker = "NPC_Hermes_01", Cue = "/VO/X_0001", Text = "Hi." } } } },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        line = result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]["Foo"]["dialogueLines"][0]
        assert line["speaker"] == "NPC_Hermes_01"


class TestAncestorRequirements:
    def test_setup_game_state_requirements_lifted_onto_textline(self):
        # The inspect point declares SetupGameStateRequirements as a
        # sibling of InteractTextLineSets; those gates must reach the
        # textline so the dependency graph picks them up.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    InspectPoints = {
                        [1] = {
                            SetupGameStateRequirements = {
                                {
                                    PathTrue = { "GameState", "TextLinesRecord", "InspectHomerReveal01" },
                                },
                            },
                            InteractTextLineSets = {
                                InspectTent01 = {
                                    { Cue = "/VO/Homer_0010", Text = "Tent narration." },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        tl = result[HUB_NARRATOR_SPEAKER]["InteractTextLineSets"]["InspectTent01"]
        # PathTrue ending in a textline name is a RequiredTextLines edge.
        assert tl["requirements"].get("RequiredTextLines") == ["InspectHomerReveal01"]

    def test_on_load_event_game_state_requirements_lifted(self):
        # OnLoadEvents have GameStateRequirements as a sibling of Args;
        # those gates must reach the PostPortraitTextLines inside.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Hub_Main = {
                    OnLoadEvents = {
                        {
                            FunctionName = "StartDeathLoop",
                            Args = {
                                PresentationFunctionArgs = {
                                    PostPortraitTextLines = {
                                        TrueEndingFinaleResponse01 = {
                                            { Cue = "/VO/Melinoe_5736", UsePlayerSource = true,
                                              Text = "Melinoe line." },
                                        },
                                    },
                                },
                            },
                            GameStateRequirements = {
                                {
                                    PathTrue = { "CurrentRun", "RoomsEntered", "I_DeathAreaRestored" },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        tl = result[HUB_NARRATOR_SPEAKER]["PostPortraitTextLines"]["TrueEndingFinaleResponse01"]
        # The PathTrue on CurrentRun.RoomsEntered.<flag> is a
        # PathTrue:CurrentRun.RoomsEntered.I_DeathAreaRestored synthetic key
        # under otherRequirements (not a textline reference).
        assert "PathTrue:CurrentRun.RoomsEntered.I_DeathAreaRestored" in tl["otherRequirements"]


class TestEventTextLineSets:
    """Tests for inline ``Args.TextLineSet`` flashback narrative beats
    embedded in ``StartUnthreadedEvents`` / ``UnthreadedEvents`` event
    blocks. These are routed via :data:`TEXTLINE_OWNER_OVERRIDES` so
    mixed-speaker xWithY dialogue lands under its natural NPC owner
    rather than collapsing to Homer.
    """

    def test_event_textline_set_routed_via_override(self):
        # HadesWithHecate01 in the override map -> NPC_LordHades_01.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Flashback_Hub = {
                    StartUnthreadedEvents = {
                        {
                            FunctionName = "SurpriseNPCPresentation",
                            Args = {
                                SourceId = 560340,
                                TextLineSet = {
                                    HadesWithHecate01 = {
                                        { Cue = "/VO/Hades_0048", Speaker = "NPC_LordHades_01",
                                          Text = "You have your orders." },
                                        { Cue = "/VO/Hecate_0208", Speaker = "NPC_Hecate_01",
                                          Text = "No harm shall come to young Melinoë." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert "NPC_LordHades_01" in result
        tl = result["NPC_LordHades_01"]["TextLineSet"]["HadesWithHecate01"]
        assert tl["partner"] == "NPC_Hecate_01"
        assert len(tl["dialogueLines"]) == 2

    def test_narrator_routed_event_collapses_to_homer(self):
        # HecateHideAndSeekIntro01 in the override map -> Speaker_Homer
        # (pure narrator prologue). Should NOT create a separate owner.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Flashback_Hub_Main = {
                    StartUnthreadedEvents = {
                        {
                            FunctionName = "SetupFlashback01",
                            Args = {
                                TextLineSet = {
                                    HecateHideAndSeekIntro01 = {
                                        { Cue = "/VO/Storyteller_0235", IsNarration = true,
                                          Text = "It is the dead of night..." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        # Routed to Homer (override owner == HUB_NARRATOR_SPEAKER) -
        # surfaces under the same single owner as the inspect-point
        # narration, not as a separate entry.
        assert list(result.keys()) == [HUB_NARRATOR_SPEAKER]
        assert "HecateHideAndSeekIntro01" in result[HUB_NARRATOR_SPEAKER]["TextLineSet"]

    def test_unknown_event_textline_falls_back_to_homer(self):
        # A textline name NOT in TEXTLINE_OWNER_OVERRIDES defaults to
        # the narrator collapse (defensive against future flashback
        # additions before their override is wired).
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Flashback_Hub = {
                    UnthreadedEvents = {
                        {
                            FunctionName = "X",
                            Args = {
                                TextLineSet = {
                                    SomeNewUnknownFlashback01 = {
                                        { Cue = "/VO/Storyteller_0001", Text = "Narration." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        assert list(result.keys()) == [HUB_NARRATOR_SPEAKER]
        assert "SomeNewUnknownFlashback01" in result[HUB_NARRATOR_SPEAKER]["TextLineSet"]

    def test_event_game_state_requirements_lifted_onto_event_textline(self):
        # GameStateRequirements on the event level is lifted onto the
        # TextLineSet textline same as the existing OnLoadEvents path.
        parsed = _parse("""
            OverwriteTableKeys( HubRoomData, {
                Flashback_Hub = {
                    StartUnthreadedEvents = {
                        {
                            FunctionName = "SurpriseNPCPresentation",
                            GameStateRequirements = {
                                {
                                    PathFalse = { "GameState", "TextLinesRecord", "ChronosNightmare01" },
                                },
                            },
                            Args = {
                                TextLineSet = {
                                    HadesWithHecate01 = {
                                        { Cue = "/VO/Hades_0048", Text = "..." },
                                    },
                                },
                            },
                        },
                    },
                },
            } )
        """)
        result = extract_deathloop_data(parsed, source_label="Hades 2", source_file="DeathLoopData.lua")
        tl = result["NPC_LordHades_01"]["TextLineSet"]["HadesWithHecate01"]
        assert tl["requirements"].get("RequiredFalseTextLines") == ["ChronosNightmare01"]
