"""End-to-end integration test: parse a synthetic NPCData.lua fixture
through the full pipeline (tokenizer -> parser -> extractor -> graph)."""

from pathlib import Path

import pytest

from src.lua_parser import parse_lua_file
from src.extractors.npc_data import extract_npc_data
from src.graph import build_graph_data


FIXTURE = Path(__file__).parent / "fixtures" / "mini_npc_data.lua"


@pytest.fixture(scope="module")
def graph_data():
    """Run the full pipeline once and reuse the result across tests."""
    parsed = parse_lua_file(str(FIXTURE))
    npcs = extract_npc_data(parsed, source_label="Test Fixture")
    return build_graph_data(npcs)


def test_npc_discovered(graph_data):
    # The NPC should appear in textlines (via its textline entries)
    npcs = {tl["npc"] for tl in graph_data["textlines"].values()}
    assert "NPC_Orpheus_01" in npcs


def test_all_textlines_present(graph_data):
    expected = {
        "OrpheusIntro01",
        "OrpheusFollowup01",
        "OrpheusSecret01",
        "OrpheusGift01",
        "OrpheusRepeat01",
    }
    assert expected <= set(graph_data["textlines"].keys())


def test_sections_assigned_correctly(graph_data):
    tls = graph_data["textlines"]
    assert tls["OrpheusIntro01"]["section"] == "InteractTextLineSets"
    assert tls["OrpheusGift01"]["section"] == "GiftTextLineSets"
    assert tls["OrpheusRepeat01"]["section"] == "RepeatableTextLineSets"


def test_speaker_attribution_end_to_end(graph_data):
    intro = graph_data["textlines"]["OrpheusIntro01"]
    assert intro["dialogueLines"] == [
        {"speaker": "CharProtag", "text": "Who are you?"},
        {"speaker": "NPC_Orpheus_01", "text": "I am Orpheus, my lord."},
    ]


def test_dependency_chain(graph_data):
    deps = graph_data["dependents"]
    # OrpheusIntro01 -> OrpheusFollowup01
    intro_deps = {d["name"] for d in deps.get("OrpheusIntro01", [])}
    assert "OrpheusFollowup01" in intro_deps
    # OrpheusFollowup01 -> OrpheusSecret01
    followup_deps = {d["name"] for d in deps.get("OrpheusFollowup01", [])}
    assert "OrpheusSecret01" in followup_deps


def test_required_false_recorded_with_type(graph_data):
    deps = graph_data["dependents"]["OrpheusForbidden01"]
    # OrpheusForbidden01 doesn't exist as a textline but is referenced
    # as a RequiredFalseTextLines by OrpheusSecret01
    assert any(d["type"] == "RequiredFalseTextLines" for d in deps)


def test_unresolved_external_ref(graph_data):
    unresolved = set(graph_data["stats"]["unresolvedRefs"])
    # SomeExternalLine and OrpheusForbidden01 are referenced but not defined
    assert "SomeExternalLine" in unresolved
    assert "OrpheusForbidden01" in unresolved


def test_other_requirements_preserved(graph_data):
    secret = graph_data["textlines"]["OrpheusSecret01"]
    assert secret["otherRequirements"]["RequiredMinCompletedRuns"] == 5


def test_formatting_tags_stripped(graph_data):
    repeat = graph_data["textlines"]["OrpheusRepeat01"]
    assert repeat["dialogueLines"][0]["text"] == "Singing softly..."


def test_required_textlines_not_misclassified(graph_data):
    # OrpheusFollowup01 has `RequiredTextLines = { "OrpheusIntro01" }` and
    # exactly one dialogue line. The old parser would have treated the
    # requirement list as a dialogue entry.
    followup = graph_data["textlines"]["OrpheusFollowup01"]
    assert followup["requirements"]["RequiredTextLines"] == ["OrpheusIntro01"]
    assert len(followup["dialogueLines"]) == 1
    assert followup["dialogueLines"][0]["text"] == "Have you heard my song?"


def test_stats_match_fixture(graph_data):
    stats = graph_data["stats"]
    assert stats["totalTextlines"] == 5
    assert stats["totalNPCs"] == 1
    # Edges: Intro<-Followup, Followup<-Secret, Forbidden<-Secret, External<-Repeat
    assert stats["totalEdges"] == 4
