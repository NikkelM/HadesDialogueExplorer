"""Tests for src.graph_merge.merge_graph_data and src.graph.resolve_duplicate.

The merge combines per-source JSON datasets into one viewer dataset,
detecting duplicate textline names, rebuilding the dependents index, and
flagging conflicting speakers mappings.
"""

from src.graph_merge import merge_graph_data
from src.graph import resolve_duplicate


def _make_textline(name, owner, *, dialogue_lines=None, requirements=None,
                   source_file="X.lua", source_line=None, other_reqs=None,
                   partner=None, or_branches=None):
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
    if or_branches is not None:
        tl["orBranches"] = or_branches
    return tl


def _make_dataset(*textlines, speakers=None, duplicates=None):
    tl_map = {tl["name"]: tl for tl in textlines}
    owners = {tl["owner"] for tl in textlines}
    return {
        "textlines": tl_map,
        "dependents": {},
        "speakers": speakers or {},
        "stats": {
            "totalSpeakers": len(owners),
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

    def test_merge_counts_distinct_speakers_across_sources(self):
        """Merged ``totalSpeakers`` is the count of distinct characters
        surviving into the merged textline set, NOT the sum of per-file
        counts.

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
        assert merged["stats"]["totalSpeakers"] == 3  # OwnerX, OwnerY, OwnerZ

    def test_merge_collapses_speaker_display_name_variants(self):
        """Variants of the same character (e.g. in-house NPC vs boss form)
        share a display-name base in the merged speakers map and must
        therefore collapse to one speaker in the merged count, even when
        each variant lives in a separate source file."""
        ds1 = _make_dataset(
            _make_textline("HouseLine", "NPC_Hades_01"),
            speakers={"NPC_Hades_01": {"name": "Hades",
                                       "description": "God of the Dead"}},
        )
        ds2 = _make_dataset(
            _make_textline("BossLine", "Hades"),
            speakers={"Hades": {"name": "Hades (Boss)",
                                "description": "God of the Dead"}},
        )
        merged = merge_graph_data([ds1, ds2])
        assert merged["stats"]["totalSpeakers"] == 1

    def test_merge_unions_speakers_without_conflict(self):
        ds1 = _make_dataset(_make_textline("A", "X"),
                            speakers={"NPC_A": {"name": "Aria", "description": "First"}})
        ds2 = _make_dataset(_make_textline("B", "Y"),
                            speakers={"NPC_B": {"name": "Beck", "description": "Second"}})
        merged = merge_graph_data([ds1, ds2])
        assert merged["speakers"] == {
            "NPC_A": {"name": "Aria", "description": "First"},
            "NPC_B": {"name": "Beck", "description": "Second"},
        }

    def test_merge_keeps_first_speaker_subfield_on_conflict(self):
        ds1 = _make_dataset(_make_textline("A", "X"),
                            speakers={"NPC_A": {"name": "Aria"}})
        ds2 = _make_dataset(_make_textline("B", "Y"),
                            speakers={"NPC_A": {"name": "Different Name"}})
        merged = merge_graph_data([ds1, ds2])
        assert merged["speakers"]["NPC_A"]["name"] == "Aria"

    def test_merge_combines_complementary_speaker_subfields(self):
        """One dataset supplies only ``name``, another only ``description``
        for the same id - the merge unions them into a complete entry."""
        ds1 = _make_dataset(_make_textline("A", "X"),
                            speakers={"NPC_A": {"name": "Aria"}})
        ds2 = _make_dataset(_make_textline("B", "Y"),
                            speakers={"NPC_A": {"description": "Wise One"}})
        merged = merge_graph_data([ds1, ds2])
        assert merged["speakers"]["NPC_A"] == {"name": "Aria", "description": "Wise One"}

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


class TestOrBranchesAtMerge:
    """``orBranches`` survives the cross-file merge layer, and its
    textline edges produce dependent entries tagged with
    ``orBranchIndex`` / ``orBranchTotal`` in the merged dependents map.
    Mirrors the per-source pass in src/graph.py:_build_dependents."""

    def test_or_branches_preserved_on_kept_entry(self):
        gate = _make_textline("Gate", "NPC_A")
        host = _make_textline(
            "Host", "NPC_B",
            or_branches=[{"requirements": {"RequiredTextLines": ["Gate"]}}],
        )
        merged = merge_graph_data([_make_dataset(gate, host)])
        assert "orBranches" in merged["textlines"]["Host"]
        assert merged["textlines"]["Host"]["orBranches"][0][
            "requirements"]["RequiredTextLines"] == ["Gate"]

    def test_or_branch_dependent_tagged_in_merged_dependents(self):
        gate = _make_textline("Gate", "NPC_A")
        host = _make_textline(
            "Host", "NPC_B",
            or_branches=[
                {"requirements": {"RequiredTextLines": ["Gate"]}},
                {"otherRequirements": {"PathTrue:GameState.X": [{"PathTrue": ["GameState", "X"]}]}},
            ],
        )
        merged = merge_graph_data([_make_dataset(gate, host)])
        assert merged["dependents"]["Gate"] == [{
            "name": "Host",
            "type": "RequiredTextLines",
            "orBranchIndex": 1,
            "orBranchTotal": 2,
        }]

    def test_or_branch_unresolved_ref_reported(self):
        host = _make_textline(
            "Host", "NPC_B",
            or_branches=[{"requirements": {"RequiredTextLines": ["Missing"]}}],
        )
        merged = merge_graph_data([_make_dataset(host)])
        assert "Missing" in merged["stats"]["unresolvedRefs"]

    def test_or_branch_self_ref_excluded_from_merged_dependents(self):
        host = _make_textline(
            "Host", "NPC_B",
            or_branches=[{"requirements": {"MinRunsSinceAnyTextLines": ["Host"]}}],
        )
        merged = merge_graph_data([_make_dataset(host)])
        assert "Host" not in merged["dependents"]
        assert merged["stats"]["totalEdges"] == 0


class TestOrphanAnnotationsAtMerge:
    """When the same textline appears in two per-source datasets (an H2
    xWithY partner pair: canonical cue-bearing side in one file, empty
    partner-stub side in another), the dedup pipeline picks the
    canonical side and would silently drop the stub. NarrativeData
    priority fields can legitimately live on the stub side -- the
    partner NPC's ``NarrativeData_<Partner>.lua`` registers the
    textline name -- so the merge layer must transfer those annotations
    onto the kept entry before the stub is discarded.
    """

    def test_priority_fields_from_stub_side_transferred_to_canonical(self):
        # Mirrors IcarusWithEris01: NPCData_Icarus.lua ships the
        # cue-bearing entry (dialogue lines, requirements); the
        # NPCData_Eris.lua partner-stub side ships zero content but
        # NarrativeData_Eris.lua tags it with ordinal 40 of 44.
        canonical = _make_textline(
            "IcarusWithEris01", "NPC_Icarus_01",
            partner="NPC_Eris_01",
            source_file="NPCData_Icarus.lua",
            dialogue_lines=[{"speaker": "NPC_Icarus_01", "text": "hi"}],
        )
        stub = _make_textline(
            "IcarusWithEris01", "NPC_Eris_01",
            partner="NPC_Icarus_01",
            source_file="NPCData_Eris.lua",
        )
        stub["narrativePriorityOrdinal"] = 40
        stub["narrativePrioritySectionSize"] = 44
        ds_canonical = _make_dataset(canonical)
        ds_stub = _make_dataset(stub)
        merged = merge_graph_data([ds_canonical, ds_stub])
        kept = merged["textlines"]["IcarusWithEris01"]
        assert kept["owner"] == "NPC_Icarus_01"
        assert kept["narrativePriorityOrdinal"] == 40
        assert kept["narrativePrioritySectionSize"] == 44

    def test_canonical_side_priority_fields_not_overwritten_by_stub(self):
        # Defensive symmetry: when both sides happen to ship a value
        # the kept (canonical) side's data wins. ``resolve_duplicate``
        # has already picked it as authoritative.
        canonical = _make_textline(
            "Shared", "NPC_A",
            partner="NPC_B",
            dialogue_lines=[{"speaker": "NPC_A", "text": "hi"}],
        )
        canonical["narrativePriorityOrdinal"] = 5
        stub = _make_textline("Shared", "NPC_B", partner="NPC_A")
        stub["narrativePriorityOrdinal"] = 99
        merged = merge_graph_data([_make_dataset(canonical), _make_dataset(stub)])
        assert merged["textlines"]["Shared"]["narrativePriorityOrdinal"] == 5


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
