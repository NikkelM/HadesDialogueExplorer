"""Tests for src.graph_merge.merge_graph_data and src.graph.resolve_duplicate.

The merge combines per-source JSON datasets into one viewer dataset,
detecting duplicate textline names, rebuilding the dependents index, and
flagging conflicting speakerNames mappings.
"""

from src.graph_merge import merge_graph_data
from src.graph import resolve_duplicate


def _make_textline(name, owner, *, dialogue_lines=None, requirements=None,
                   source_file="X.lua", source_line=None, other_reqs=None):
    return {
        "name": name,
        "owner": owner,
        "section": "InteractTextLineSets",
        "source": "Test",
        "sourceFile": source_file,
        "sourceLine": source_line,
        "requirements": requirements or {},
        "otherRequirements": other_reqs or {},
        "dialogueLines": dialogue_lines or [],
    }


def _make_dataset(*textlines, speaker_names=None):
    tl_map = {tl["name"]: tl for tl in textlines}
    owners = {tl["owner"] for tl in textlines}
    return {
        "textlines": tl_map,
        "dependents": {},
        "speakerNames": speaker_names or {},
        "stats": {
            "totalOwners": len(owners),
            "totalTextlines": len(tl_map),
            "totalEdges": 0,
            "unresolvedRefs": [],
            "duplicates": [],
        },
    }


class TestRichnessResolution:
    """When two definitions of the same textline collide, the entry with
    more dialogue lines / requirements wins."""

    def test_richer_entry_wins_regardless_of_order(self):
        stub = _make_textline("Shared", "NPC_A")
        full = _make_textline(
            "Shared", "NPC_B",
            dialogue_lines=[{"speaker": "NPC_B", "text": "Hi"}],
            requirements={"RequiredTextLines": ["X", "Y"]},
        )
        # Stub first, full second.
        kept, dropped = resolve_duplicate(stub, full)
        assert kept["owner"] == "NPC_B"
        assert dropped["owner"] == "NPC_A"
        # And the other way round.
        kept, dropped = resolve_duplicate(full, stub)
        assert kept["owner"] == "NPC_B"
        assert dropped["owner"] == "NPC_A"

    def test_ties_go_to_existing_entry(self):
        # Bare textlines with identical shapes (no dialogue lines, no
        # requirements) score identical richness, so the tie-breaker is
        # first-wins on the existing entry.
        a = _make_textline("X", "A")
        b = _make_textline("X", "B")
        kept, dropped = resolve_duplicate(a, b)
        assert kept["owner"] == "A"


class TestMergeDatasets:
    def test_merge_unions_textlines_from_multiple_sources(self):
        ds1 = _make_dataset(_make_textline("Alpha", "OwnerA"))
        ds2 = _make_dataset(_make_textline("Beta", "OwnerB"))
        merged = merge_graph_data([ds1, ds2])
        assert set(merged["textlines"].keys()) == {"Alpha", "Beta"}

    def test_merge_picks_richer_entry_on_duplicate(self):
        stub = _make_textline("Shared", "OwnerStub")
        full = _make_textline(
            "Shared", "OwnerFull",
            dialogue_lines=[{"speaker": "OwnerFull", "text": "Real line."}],
        )
        ds1 = _make_dataset(stub)
        ds2 = _make_dataset(full)
        merged = merge_graph_data([ds1, ds2])
        assert merged["textlines"]["Shared"]["owner"] == "OwnerFull"

    def test_merge_rebuilds_dependents_from_merged_textlines(self):
        """The dependents index must come from the merged textline set, not
        from any per-source pre-computation - else stale edges referencing
        overwritten textlines could leak in."""
        ds1 = _make_dataset(
            _make_textline("Alpha", "A",
                           requirements={"RequiredTextLines": ["Target"]}),
        )
        ds2 = _make_dataset(
            _make_textline("Target", "B"),
            _make_textline("Beta", "B",
                           requirements={"RequiredAnyTextLines": ["Target"]}),
        )
        merged = merge_graph_data([ds1, ds2])
        deps = merged["dependents"]["Target"]
        names = sorted(d["name"] for d in deps)
        assert names == ["Alpha", "Beta"]

    def test_merge_counts_distinct_owners_across_sources(self):
        """Merged ``totalOwners`` is the count of distinct owners surviving
        into the merged textline set, NOT the sum of per-file owner counts.

        Summing per-file counts (the old behaviour) would double-count
        any owner appearing in multiple source files and would also
        include skeleton owners that contributed no textlines, producing
        the inflated header number that the new merge logic prevents.
        """
        ds1 = _make_dataset(
            _make_textline("A", "OwnerX"),
            _make_textline("B", "OwnerY"),
        )
        ds2 = _make_dataset(
            _make_textline("C", "OwnerZ"),
            # OwnerX also appears in ds2 - must not be double-counted.
            _make_textline("D", "OwnerX"),
        )
        merged = merge_graph_data([ds1, ds2])
        assert merged["stats"]["totalOwners"] == 3  # OwnerX, OwnerY, OwnerZ

    def test_merge_unions_speaker_names_without_conflict(self):
        ds1 = _make_dataset(_make_textline("A", "X"),
                            speaker_names={"NPC_A": "Aria"})
        ds2 = _make_dataset(_make_textline("B", "Y"),
                            speaker_names={"NPC_B": "Beck"})
        merged = merge_graph_data([ds1, ds2])
        assert merged["speakerNames"] == {"NPC_A": "Aria", "NPC_B": "Beck"}

    def test_merge_keeps_first_speaker_name_on_conflict(self):
        ds1 = _make_dataset(_make_textline("A", "X"),
                            speaker_names={"NPC_A": "Aria"})
        ds2 = _make_dataset(_make_textline("B", "Y"),
                            speaker_names={"NPC_A": "Different Name"})
        merged = merge_graph_data([ds1, ds2])
        assert merged["speakerNames"]["NPC_A"] == "Aria"

    def test_unresolved_refs_computed_against_merged_textline_set(self):
        """A textline referenced in one source but DEFINED in another should
        not appear in unresolvedRefs after merge."""
        ds1 = _make_dataset(
            _make_textline("Alpha", "A",
                           requirements={"RequiredTextLines": ["Beta"]}),
        )
        ds2 = _make_dataset(_make_textline("Beta", "B"))
        merged = merge_graph_data([ds1, ds2])
        assert "Beta" not in merged["stats"]["unresolvedRefs"]

    def test_merge_filters_self_references_from_dependents(self):
        """Self-references (textline lists itself in own requirements)
        are kept in the textline's requirements map but filtered from
        the merged dependents reverse-index and from totalEdges. This
        mirrors src/graph.py:_build_dependents."""
        ds = _make_dataset(
            _make_textline(
                "Solo", "X",
                requirements={
                    "MinRunsSinceAnyTextLines": ["Solo", "Peer"],
                    "RequiredFalseTextLinesThisRun": ["Solo"],
                },
            ),
            _make_textline("Peer", "X"),
        )
        merged = merge_graph_data([ds])
        # Self-ref preserved in requirements for the info panel.
        assert "Solo" in merged["textlines"]["Solo"]["requirements"]["MinRunsSinceAnyTextLines"]
        # But removed from the dependents reverse-index.
        assert "Solo" not in merged["dependents"]
        # Peer edge IS kept.
        assert merged["dependents"]["Peer"] == [
            {"name": "Solo", "type": "MinRunsSinceAnyTextLines"}
        ]
        # Edge count excludes the two self-edges.
        assert merged["stats"]["totalEdges"] == 1
