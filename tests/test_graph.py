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
        assert result["stats"]["totalOwners"] == 0
        assert result["stats"]["totalTextlines"] == 0
        assert result["stats"]["totalEdges"] == 0

    def test_single_textline_no_deps(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(dialogue=[{"speaker": "NPC_X_01", "text": "Hi"}])
        })
        result = build_graph_data(npcs)
        assert "Line01" in result["textlines"]
        tl = result["textlines"]["Line01"]
        assert tl["owner"] == "NPC_X_01"
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
    def test_owner_count(self):
        npcs = {
            "NPC_A_01": {"source": "T", "InteractTextLineSets": {
                "A_Line": make_textline(),
            }},
            "NPC_B_01": {"source": "T", "InteractTextLineSets": {
                "B_Line": make_textline(),
            }},
        }
        result = build_graph_data(npcs)
        assert result["stats"]["totalOwners"] == 2

    def test_owners_with_no_textlines_not_counted(self):
        """Owners that contributed no textlines (e.g. NPC entries that are
        pure shared-component templates, or empty {} stubs that inherit
        from a parent) must not inflate ``totalOwners``. The viewer's
        owner count reflects distinct dialogue contributors only."""
        npcs = {
            "NPC_Skeleton": {"source": "T", "InteractTextLineSets": {}},
            "NPC_Real": {"source": "T", "InteractTextLineSets": {
                "Line01": make_textline(),
            }},
        }
        result = build_graph_data(npcs)
        assert result["stats"]["totalOwners"] == 1

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


class TestSelfReferenceFiltering:
    """Self-references are kept in each textline's ``requirements`` map
    (so the info panel can show them) but excluded from the
    ``dependents`` reverse-index and from ``stats.totalEdges``."""

    def test_self_ref_kept_in_requirements(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(
                requirements={"MinRunsSinceAnyTextLines": ["Line01", "Line02"]}
            ),
            "Line02": make_textline(),
        })
        result = build_graph_data(npcs)
        # Faithful to source: self-ref still listed in requirements.
        assert result["textlines"]["Line01"]["requirements"] == {
            "MinRunsSinceAnyTextLines": ["Line01", "Line02"]
        }

    def test_self_ref_excluded_from_dependents(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(
                requirements={"MinRunsSinceAnyTextLines": ["Line01", "Line02"]}
            ),
            "Line02": make_textline(),
        })
        result = build_graph_data(npcs)
        # Line01 must not appear as its own dependent.
        assert "Line01" not in result["dependents"]
        # The non-self peer-edge IS recorded.
        assert result["dependents"]["Line02"] == [
            {"name": "Line01", "type": "MinRunsSinceAnyTextLines"}
        ]

    def test_self_ref_excluded_from_edge_count(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(
                requirements={"MinRunsSinceAnyTextLines": ["Line01", "Line02"]}
            ),
            "Line02": make_textline(),
        })
        result = build_graph_data(npcs)
        # Only the Line01 -> Line02 edge counts; the self-edge does not.
        assert result["stats"]["totalEdges"] == 1

    def test_self_ref_across_multiple_fields(self):
        """A textline can self-reference in several fields (e.g.
        MinRunsSinceAnyTextLines AND RequiredFalseTextLinesThisRun);
        none of them should land in dependents."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(requirements={
                "MinRunsSinceAnyTextLines": ["Line01"],
                "RequiredFalseTextLinesThisRun": ["Line01"],
                "RequiredFalseTextLinesLastRun": ["Line01"],
            }),
        })
        result = build_graph_data(npcs)
        assert result["dependents"] == {}
        assert result["stats"]["totalEdges"] == 0

    def test_only_self_ref_makes_isolated_textline(self):
        """A textline whose only requirements are self-references is
        effectively isolated from a graph perspective."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Line01": make_textline(
                requirements={"RequiredFalseTextLines": ["Line01"]}
            ),
        })
        result = build_graph_data(npcs)
        assert result["dependents"] == {}
        assert result["stats"]["totalEdges"] == 0
        # Self-ref is still NOT treated as an unresolved external ref.
        assert result["stats"]["unresolvedRefs"] == []


class TestSpeakerNamesDefault:
    """Regression coverage for the ``speaker_names`` parameter default.

    The parameter used to default to ``{}`` (a mutable literal), which is a
    Python footgun: the default object is shared across every no-arg call,
    so any in-place mutation persists between invocations. The function
    happens to never mutate the parameter today and the result-assembly site
    short-circuits via ``speaker_names or {}``, but the latent risk was
    real - a future maintainer adding ``speaker_names.setdefault(...)``
    inside the function would silently leak state across calls. The default
    is now ``None``; these tests pin both the public contract (``None`` ==
    "no speaker names") and the no-shared-state guarantee.
    """

    def test_default_returns_empty_speaker_names(self):
        result = build_graph_data({})
        assert result["speakerNames"] == {}

    def test_explicit_none_is_equivalent_to_default(self):
        result = build_graph_data({}, speaker_names=None)
        assert result["speakerNames"] == {}

    def test_explicit_mapping_is_passed_through(self):
        result = build_graph_data({}, speaker_names={"NPC_X_01": "Mr X"})
        assert result["speakerNames"] == {"NPC_X_01": "Mr X"}

    def test_no_shared_state_across_default_calls(self):
        """If two default-arg calls accidentally shared a backing dict,
        mutating one result's ``speakerNames`` would leak into the next
        call's result. Guard against that regression."""
        first = build_graph_data({})
        first["speakerNames"]["bogus"] = "leak"
        second = build_graph_data({})
        assert second["speakerNames"] == {}
