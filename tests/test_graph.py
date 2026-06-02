"""Tests for the dependency graph builder."""

import pytest

from src.graph import build_graph_data


def make_npc(name, section, textlines):
    """Helper: build the dict shape that extract_npc_data produces."""
    return {name: {"source": "Test", section: textlines}}


def make_textline(requirements=None, other=None, dialogue=None):
    return {
        "requirements": requirements or {},
        "otherRequirements": other or {},
        "dialogueLines": dialogue or [],
    }


class TestBasicGraph:
    def test_empty_input(self):
        result = build_graph_data({})
        assert result["textlines"] == {}
        assert result["dependents"] == {}
        assert result["stats"]["totalNPCs"] == 0
        assert result["stats"]["totalTextlines"] == 0
        assert result["stats"]["totalEdges"] == 0

    def test_single_textline_no_deps(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(dialogue=[{"speaker": "NPC_X_01", "text": "Hi"}])
        })
        result = build_graph_data(npcs)
        assert "Line01" in result["textlines"]
        tl = result["textlines"]["Line01"]
        assert tl["npc"] == "NPC_X_01"
        assert tl["section"] == "InteractTextLineSets"
        assert tl["source"] == "Test"
        assert result["dependents"] == {}
        assert result["stats"]["totalEdges"] == 0


class TestDependencyEdges:
    def test_forward_dependency_recorded(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(),
            "Line02": make_textline(requirements={"RequiredTextLines": ["Line01"]}),
        })
        result = build_graph_data(npcs)
        # Line02 declares Line01 as a requirement
        assert result["textlines"]["Line02"]["requirements"] == {
            "RequiredTextLines": ["Line01"]
        }

    def test_reverse_dependency_lookup(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(),
            "Line02": make_textline(requirements={"RequiredTextLines": ["Line01"]}),
        })
        result = build_graph_data(npcs)
        # Line01 should know that Line02 depends on it
        assert "Line01" in result["dependents"]
        deps = result["dependents"]["Line01"]
        assert deps == [{"name": "Line02", "type": "RequiredTextLines"}]

    def test_multiple_dependents(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Root": make_textline(),
            "A": make_textline(requirements={"RequiredTextLines": ["Root"]}),
            "B": make_textline(requirements={"RequiredTextLines": ["Root"]}),
        })
        result = build_graph_data(npcs)
        names = {d["name"] for d in result["dependents"]["Root"]}
        assert names == {"A", "B"}

    def test_multiple_requirement_types(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "X": make_textline(requirements={
                "RequiredTextLines": ["A"],
                "RequiredFalseTextLines": ["B"],
            }),
        })
        result = build_graph_data(npcs)
        # Both should appear in dependents with the correct type
        assert result["dependents"]["A"] == [{"name": "X", "type": "RequiredTextLines"}]
        assert result["dependents"]["B"] == [{"name": "X", "type": "RequiredFalseTextLines"}]


class TestUnresolvedReferences:
    def test_external_ref_flagged(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(requirements={"RequiredTextLines": ["DoesNotExist"]}),
        })
        result = build_graph_data(npcs)
        assert "DoesNotExist" in result["stats"]["unresolvedRefs"]

    def test_local_refs_not_flagged(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(),
            "Line02": make_textline(requirements={"RequiredTextLines": ["Line01"]}),
        })
        result = build_graph_data(npcs)
        assert result["stats"]["unresolvedRefs"] == []


class TestStats:
    def test_npc_count(self):
        npcs = {
            "NPC_A_01": {"source": "T", "InteractTextLineSets": {}},
            "NPC_B_01": {"source": "T", "InteractTextLineSets": {}},
        }
        result = build_graph_data(npcs)
        assert result["stats"]["totalNPCs"] == 2

    def test_textline_and_edge_counts(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "A": make_textline(),
            "B": make_textline(requirements={"RequiredTextLines": ["A"]}),
            "C": make_textline(requirements={"RequiredTextLines": ["A", "B"]}),
        })
        result = build_graph_data(npcs)
        assert result["stats"]["totalTextlines"] == 3
        assert result["stats"]["totalEdges"] == 3  # A<-B, A<-C, B<-C


class TestMultipleSections:
    def test_sections_from_same_npc_merged_into_textlines(self):
        npcs = {
            "NPC_X_01": {
                "source": "T",
                "InteractTextLineSets": {"A": make_textline()},
                "GiftTextLineSets": {"B": make_textline()},
            }
        }
        result = build_graph_data(npcs)
        assert result["textlines"]["A"]["section"] == "InteractTextLineSets"
        assert result["textlines"]["B"]["section"] == "GiftTextLineSets"
