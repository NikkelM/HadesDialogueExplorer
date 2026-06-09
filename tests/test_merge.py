"""Tests for src.graph_merge.merge_graph_data and src.graph.resolve_duplicate.

The merge combines per-source JSON datasets into one viewer dataset,
detecting duplicate textline names, rebuilding the dependents index, and
flagging conflicting speakerNames mappings.
"""

from src.graph_merge import merge_graph_data
from src.graph import resolve_duplicate


def _make_textline(name, owner, *, dialogue_lines=None, requirements=None,
                   source_file="X.lua", source_line=None, other_reqs=None,
                   partner=None):
    tl = {
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
    if partner is not None:
        tl["partner"] = partner
    return tl


def _make_dataset(*textlines, speaker_names=None, duplicates=None):
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
            "duplicates": list(duplicates or []),
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


class TestPartnerPreferredOverStub:
    """``Partner = "..."`` on the full xWithY entry is an explicit signal
    that the other side is the queue-only stub. ``resolve_duplicate``
    must always pick the partner-marked entry regardless of richness so
    a future stub that happens to ship extra placeholder metadata can
    never accidentally outscore the cue-bearing canonical side."""

    def test_partner_marked_entry_wins_against_richer_stub(self):
        # Pathological case: stub has more `otherRequirements` than the
        # partner-marked entry. Richness alone would pick the stub; the
        # explicit Partner check must override.
        stub = _make_textline(
            "Shared", "NPC_Hades_01",
            other_reqs={"RequiredFalseFlags": {"A": True},
                        "RequiredMinCompletedRuns": 1},
        )
        full = _make_textline(
            "Shared", "NPC_Nyx_01",
            partner="NPC_Hades_01",
        )
        kept, dropped = resolve_duplicate(stub, full)
        assert kept["owner"] == "NPC_Nyx_01"
        assert kept.get("partner") == "NPC_Hades_01"
        # And the other call order.
        kept, dropped = resolve_duplicate(full, stub)
        assert kept["owner"] == "NPC_Nyx_01"

    def test_falls_back_to_richness_when_neither_declares_partner(self):
        a = _make_textline(
            "Shared", "A",
            dialogue_lines=[{"speaker": "A", "text": "Hi"}],
        )
        b = _make_textline("Shared", "B")
        kept, _ = resolve_duplicate(a, b)
        assert kept["owner"] == "A"

    def test_falls_back_to_richness_when_both_declare_partner(self):
        # Hypothetical: both sides declare Partner (would imply a true
        # data conflict). Resolution must still be deterministic - the
        # richness comparison takes over.
        a = _make_textline(
            "Shared", "A",
            partner="B",
            dialogue_lines=[{"speaker": "A", "text": "..."}],
        )
        b = _make_textline("Shared", "B", partner="A")
        kept, _ = resolve_duplicate(a, b)
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


class TestDuplicateStatsPropagation:
    """``stats.duplicates`` from each input dataset (intra-file partner-stub
    pattern) must be carried into the merged dataset alongside any new
    cross-file collisions detected at merge time. Both kinds get a
    ``scope`` tag (``intra-file`` / ``cross-file``) so the viewer can
    distinguish them."""

    def test_intra_file_duplicates_propagated_from_input_stats(self):
        intra = {
            "name": "NyxWithHades03",
            "scope": "intra-file",
            "kept": {"owner": "NPC_Nyx_01", "section": "InteractTextLineSets",
                     "sourceFile": "NPCData.lua", "sourceLine": 13251,
                     "dialogueLines": 5, "requirementCount": 4,
                     "partner": "NPC_Hades_01"},
            "dropped": {"owner": "NPC_Hades_01", "section": "InteractTextLineSets",
                        "sourceFile": "NPCData.lua", "sourceLine": 3750,
                        "dialogueLines": 0, "requirementCount": 0},
        }
        ds1 = _make_dataset(
            _make_textline("NyxWithHades03", "NPC_Nyx_01",
                           partner="NPC_Hades_01"),
            duplicates=[intra],
        )
        ds2 = _make_dataset(_make_textline("Other", "OwnerZ"))
        merged = merge_graph_data([ds1, ds2])
        dups = merged["stats"]["duplicates"]
        names = [d["name"] for d in dups]
        assert "NyxWithHades03" in names
        rec = next(d for d in dups if d["name"] == "NyxWithHades03")
        assert rec["scope"] == "intra-file"
        assert rec["kept"].get("partner") == "NPC_Hades_01"

    def test_cross_file_collisions_tagged_cross_file(self):
        ds1 = _make_dataset(
            _make_textline("Shared", "OwnerA", source_file="A.lua",
                           dialogue_lines=[{"speaker": "OwnerA", "text": "a"}]),
        )
        ds2 = _make_dataset(
            _make_textline("Shared", "OwnerB", source_file="B.lua"),
        )
        merged = merge_graph_data([ds1, ds2])
        dups = merged["stats"]["duplicates"]
        assert len(dups) == 1
        assert dups[0]["name"] == "Shared"
        assert dups[0]["scope"] == "cross-file"

    def test_intra_and_cross_file_duplicates_coexist(self):
        intra = {
            "name": "PartnerLine",
            "scope": "intra-file",
            "kept": {"owner": "NPC_A", "section": "InteractTextLineSets",
                     "sourceFile": "NPCData.lua", "sourceLine": 100,
                     "dialogueLines": 1, "requirementCount": 0,
                     "partner": "NPC_B"},
            "dropped": {"owner": "NPC_B", "section": "InteractTextLineSets",
                        "sourceFile": "NPCData.lua", "sourceLine": 200,
                        "dialogueLines": 0, "requirementCount": 0},
        }
        ds1 = _make_dataset(
            _make_textline("PartnerLine", "NPC_A", partner="NPC_B"),
            _make_textline("CrossLine", "OwnerC", source_file="NPCData.lua",
                           dialogue_lines=[{"speaker": "OwnerC", "text": "..."}]),
            duplicates=[intra],
        )
        ds2 = _make_dataset(
            _make_textline("CrossLine", "OwnerD", source_file="LootData.lua"),
        )
        merged = merge_graph_data([ds1, ds2])
        dups = merged["stats"]["duplicates"]
        by_name = {d["name"]: d for d in dups}
        assert by_name["PartnerLine"]["scope"] == "intra-file"
        assert by_name["CrossLine"]["scope"] == "cross-file"


class TestDupSummaryIncludesPartner:
    def test_partner_preserved_in_summary(self):
        from src.graph import dup_summary
        entry = _make_textline("X", "NPC_Nyx_01", partner="NPC_Hades_01")
        summary = dup_summary(entry)
        assert summary["partner"] == "NPC_Hades_01"

    def test_no_partner_key_when_absent(self):
        from src.graph import dup_summary
        entry = _make_textline("X", "NPC_Nyx_01")
        summary = dup_summary(entry)
        assert "partner" not in summary
