"""Tests for the dependency graph builder."""


from src.graph import build_graph_data


def make_npc(name, section, textlines):
    """Helper: build the dict shape that extract_npc_data produces."""
    return {name: {"source": "Test", section: textlines}}


def make_textline(requirements=None, other=None, dialogue=None, skip=False):
    tl = {
        "requirements": requirements or {},
        "otherRequirements": other or {},
        "dialogueLines": dialogue or [],
    }
    if skip:
        tl["skip"] = True
    return tl


class TestBasicGraph:
    def test_empty_input(self):
        result = build_graph_data({})
        assert result["textlines"] == {}
        assert result["dependents"] == {}
        assert result["stats"]["totalSpeakers"] == 0
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
    def test_speaker_count(self):
        npcs = {
            "NPC_A_01": {"source": "T", "InteractTextLineSets": {
                "A_Line": make_textline(),
            }},
            "NPC_B_01": {"source": "T", "InteractTextLineSets": {
                "B_Line": make_textline(),
            }},
        }
        result = build_graph_data(npcs)
        assert result["stats"]["totalSpeakers"] == 2

    def test_owners_with_no_textlines_not_counted(self):
        """Owners that contributed no textlines (e.g. NPC entries that are
        pure shared-component templates, or empty {} stubs that inherit
        from a parent) must not inflate ``totalSpeakers``. The viewer's
        speaker count reflects distinct dialogue contributors only."""
        npcs = {
            "NPC_Skeleton": {"source": "T", "InteractTextLineSets": {}},
            "NPC_Real": {"source": "T", "InteractTextLineSets": {
                "Line01": make_textline(),
            }},
        }
        result = build_graph_data(npcs)
        assert result["stats"]["totalSpeakers"] == 1

    def test_speaker_count_collapses_display_name_variants(self):
        """Owners whose display names share a base (e.g. ``"Hades"`` and
        ``"Hades (Boss)"``) must collapse to one character in the count.
        This prevents in-house / field / boss variants of the same
        character from each adding one to the header stat."""
        npcs = {
            "NPC_Hades_01": {"source": "T", "InteractTextLineSets": {
                "HouseLine": make_textline(),
            }},
            "Hades": {"source": "T", "BossPresentationTextLineSets": {
                "BossLine": make_textline(),
            }},
        }
        speakers = {
            "NPC_Hades_01": {"name": "Hades", "description": "God of the Dead"},
            "Hades":        {"name": "Hades (Boss)", "description": "God of the Dead"},
        }
        result = build_graph_data(npcs, speakers=speakers)
        assert result["stats"]["totalSpeakers"] == 1

    def test_speaker_count_owner_without_speakers_entry_falls_back_to_id(self):
        """An owner missing from the speakers map still contributes one
        to the count (keyed by its raw id) - the dedup must not silently
        drop unmapped speakers by collapsing them under an empty key."""
        npcs = {
            "OwnerA": {"source": "T", "InteractTextLineSets": {
                "A": make_textline(),
            }},
            "OwnerB": {"source": "T", "InteractTextLineSets": {
                "B": make_textline(),
            }},
        }
        result = build_graph_data(npcs, speakers={})
        assert result["stats"]["totalSpeakers"] == 2

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


class TestSpeakersDefault:
    """Regression coverage for the ``speakers`` parameter default.

    The parameter used to default to ``{}`` (a mutable literal), which is a
    Python footgun: the default object is shared across every no-arg call,
    so any in-place mutation persists between invocations. The function
    happens to never mutate the parameter today and the result-assembly site
    short-circuits via ``speakers or {}``, but the latent risk was
    real - a future maintainer adding ``speakers.setdefault(...)``
    inside the function would silently leak state across calls. The default
    is now ``None``; these tests pin both the public contract (``None`` ==
    "no speakers") and the no-shared-state guarantee.
    """

    def test_default_returns_empty_speakers(self):
        result = build_graph_data({})
        assert result["speakers"] == {}

    def test_explicit_none_is_equivalent_to_default(self):
        result = build_graph_data({}, speakers=None)
        assert result["speakers"] == {}

    def test_explicit_mapping_is_passed_through(self):
        result = build_graph_data({}, speakers={
            "NPC_X_01": {"name": "Mr X", "description": "Mysterious"},
        })
        assert result["speakers"] == {
            "NPC_X_01": {"name": "Mr X", "description": "Mysterious"},
        }

    def test_none_subfields_are_dropped(self):
        """``description = None`` (and any other empty subfield) is
        omitted from the serialized result so consumers can use a
        truthy check against ``speakers[id]?.description`` instead of
        comparing to ``None``."""
        result = build_graph_data({}, speakers={
            "NPC_X_01": {"name": "Mr X", "description": None},
        })
        assert result["speakers"] == {"NPC_X_01": {"name": "Mr X"}}

    def test_entries_with_all_subfields_empty_are_dropped(self):
        result = build_graph_data({}, speakers={
            "NPC_X_01": {"name": "", "description": None},
        })
        assert result["speakers"] == {}

    def test_no_shared_state_across_default_calls(self):
        """If two default-arg calls accidentally shared a backing dict,
        mutating one result's ``speakers`` would leak into the next
        call's result. Guard against that regression."""
        first = build_graph_data({})
        first["speakers"]["bogus"] = {"name": "leak"}
        second = build_graph_data({})
        assert second["speakers"] == {}


class TestNarrativePriorityFieldForwarding:
    """``build_graph_data`` must forward every narrative-priority field
    from the per-source ``owners_data`` extracted by the per-game
    extractors onto each merged textline entry. Each game uses a
    different priority model (H1 intrinsic tier/setlevel vs H2
    extrinsic ordinal/sectionSize/clusterMembers) and the viewer
    dispatches on which fields are present, so silently dropping any
    of them at the merge step strands the badge in the source JSON.
    """

    def test_h1_priority_fields_forwarded(self):
        npcs = make_npc("NPC_Zeus_01", "InteractTextLineSets", {
            "ZeusFirstMeeting": {
                **make_textline(),
                "narrativePrioritySectionTier": "super",
                "narrativePrioritySetLevel": "priority",
            },
        })
        result = build_graph_data(npcs)
        tl = result["textlines"]["ZeusFirstMeeting"]
        assert tl["narrativePrioritySectionTier"] == "super"
        assert tl["narrativePrioritySetLevel"] == "priority"

    def test_h2_priority_fields_forwarded(self):
        npcs = make_npc("NPC_Hecate_01", "GiftTextLineSets", {
            "HecateGift01": {
                **make_textline(),
                "narrativePriorityOrdinal": 1,
                "narrativePrioritySectionSize": 18,
                "narrativePriorityClusterMembers": ["HecateGift02", "HecateGift03"],
            },
        })
        result = build_graph_data(npcs)
        tl = result["textlines"]["HecateGift01"]
        assert tl["narrativePriorityOrdinal"] == 1
        assert tl["narrativePrioritySectionSize"] == 18
        assert tl["narrativePriorityClusterMembers"] == ["HecateGift02", "HecateGift03"]

    def test_priority_fields_omitted_when_absent(self):
        """Textlines without priority data must NOT have any priority
        keys synthesised - the viewer dispatcher relies on
        ``in textline`` checks to decide whether to render a badge,
        so silently writing ``None`` here would change the dispatch."""
        npcs = make_npc("NPC_Test_01", "InteractTextLineSets", {
            "PlainLine": make_textline(),
        })
        result = build_graph_data(npcs)
        tl = result["textlines"]["PlainLine"]
        for field in (
            "narrativePrioritySectionTier",
            "narrativePrioritySetLevel",
            "narrativePriorityOrdinal",
            "narrativePrioritySectionSize",
            "narrativePriorityClusterMembers",
        ):
            assert field not in tl, f"unexpected {field} on plain textline"


class TestOrBranches:
    """H2 alternative requirement groups (``orBranches``) must survive
    the graph build, and their textline edges must reach
    ``dependents`` tagged with 1-based branch index + total branch
    count so the viewer can render the dependent as a conditional
    alternative rather than a hard requirement."""

    def test_or_branches_passed_through_entry(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Gate": make_textline(),
            "Host": {
                "requirements": {},
                "otherRequirements": {},
                "dialogueLines": [],
                "orBranches": [
                    {"requirements": {"RequiredTextLines": ["Gate"]}},
                    {"otherRequirements": {"PathTrue:GameState.X": [{"PathTrue": ["GameState", "X"]}]}},
                ],
            },
        })
        result = build_graph_data(npcs)
        host = result["textlines"]["Host"]
        assert "orBranches" in host
        assert len(host["orBranches"]) == 2
        assert host["orBranches"][0]["requirements"]["RequiredTextLines"] == ["Gate"]

    def test_or_branches_absent_when_empty(self):
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Plain": make_textline(),
        })
        result = build_graph_data(npcs)
        assert "orBranches" not in result["textlines"]["Plain"]

    def test_or_branch_textline_edges_reach_dependents_with_tag(self):
        """An OR-branch textline edge produces a dependent entry that
        carries ``orBranchIndex`` (1-based) and ``orBranchTotal`` so
        the viewer can render "(OR alt N of M)"."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Gate": make_textline(),
            "Other": make_textline(),
            "Host": {
                "requirements": {},
                "otherRequirements": {},
                "dialogueLines": [],
                "orBranches": [
                    {"requirements": {"RequiredTextLines": ["Gate"]}},
                    {"requirements": {"RequiredAnyTextLines": ["Other"]}},
                ],
            },
        })
        result = build_graph_data(npcs)
        gate_deps = result["dependents"]["Gate"]
        assert gate_deps == [{
            "name": "Host",
            "type": "RequiredTextLines",
            "orBranchIndex": 1,
            "orBranchTotal": 2,
        }]
        other_deps = result["dependents"]["Other"]
        assert other_deps == [{
            "name": "Host",
            "type": "RequiredAnyTextLines",
            "orBranchIndex": 2,
            "orBranchTotal": 2,
        }]

    def test_or_branch_and_base_dependents_coexist(self):
        """Same target as base + OR branch: both edges appear in
        ``dependents``, only the OR-branch one carries the tag."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Gate": make_textline(),
            "Host": {
                "requirements": {"RequiredTextLines": ["Gate"]},
                "otherRequirements": {},
                "dialogueLines": [],
                "orBranches": [
                    {"requirements": {"RequiredAnyTextLines": ["Gate"]}},
                ],
            },
        })
        result = build_graph_data(npcs)
        deps = result["dependents"]["Gate"]
        assert len(deps) == 2
        base = [d for d in deps if "orBranchIndex" not in d]
        or_edge = [d for d in deps if "orBranchIndex" in d]
        assert base == [{"name": "Host", "type": "RequiredTextLines"}]
        assert or_edge == [{
            "name": "Host",
            "type": "RequiredAnyTextLines",
            "orBranchIndex": 1,
            "orBranchTotal": 1,
        }]

    def test_or_branch_self_ref_excluded_from_dependents(self):
        """Mirror the base self-ref filter: a textline that lists
        itself inside one of its OR-branch requirements (e.g. a
        cooldown-style field on a per-alternative branch) must not
        produce a self-edge in dependents."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Host": {
                "requirements": {},
                "otherRequirements": {},
                "dialogueLines": [],
                "orBranches": [
                    {"requirements": {"MinRunsSinceAnyTextLines": ["Host"]}},
                ],
            },
        })
        result = build_graph_data(npcs)
        assert "Host" not in result["dependents"]
        assert result["stats"]["totalEdges"] == 0

    def test_or_branch_textline_edges_count_as_unresolved_refs(self):
        """An OR-branch alternative pointing at a missing textline is
        reported in ``stats.unresolvedRefs`` alongside base refs."""
        npcs = make_npc("NPC_X_01", "InteractTextLineSets", {
            "Host": {
                "requirements": {},
                "otherRequirements": {},
                "dialogueLines": [],
                "orBranches": [
                    {"requirements": {"RequiredTextLines": ["DoesNotExist"]}},
                ],
            },
        })
        result = build_graph_data(npcs)
        assert "DoesNotExist" in result["stats"]["unresolvedRefs"]


class TestSkipRetiredLines:
    """`Skip = true` lines are retired/permanently unplayable; the builder
    propagates the flag and links each to its live replacement when the
    shared base name makes it derivable."""

    def _build(self, lines):
        npcs = make_npc("NPC_X_01", "GiftTextLineSets", lines)
        return build_graph_data(npcs)["textlines"]

    def test_skip_flag_propagates(self):
        tl = self._build({
            "XGift04": make_textline(dialogue=[{"speaker": "NPC_X_01", "text": "a"}], skip=True),
            "XGift04_A": make_textline(dialogue=[{"speaker": "NPC_X_01", "text": "b"}]),
        })
        assert tl["XGift04"]["skip"] is True
        assert "skip" not in tl["XGift04_A"]

    def test_replacement_links_to_a_sibling(self):
        tl = self._build({
            "XGift04": make_textline(skip=True),
            "XGift04_A": make_textline(),
        })
        assert tl["XGift04"]["skipReplacement"] == "XGift04_A"

    def test_replacement_prefers_a_over_b(self):
        tl = self._build({
            "XGift05": make_textline(skip=True),
            "XGift05_A": make_textline(),
            "XGift05_B": make_textline(),
        })
        assert tl["XGift05"]["skipReplacement"] == "XGift05_A"

    def test_replacement_alt_sibling(self):
        tl = self._build({
            "DusaGift05": make_textline(skip=True),
            "DusaGift05_Alt": make_textline(),
        })
        assert tl["DusaGift05"]["skipReplacement"] == "DusaGift05_Alt"

    def test_replacement_strips_suffix_to_live_base(self):
        tl = self._build({
            "BadgeSeller01_B": make_textline(skip=True),
            "BadgeSeller01": make_textline(),
        })
        assert tl["BadgeSeller01_B"]["skipReplacement"] == "BadgeSeller01"

    def test_no_replacement_when_only_b_sibling(self):
        # `_B` siblings are alternates/distinct lines, never the primary
        # replacement (cf. HadesRunCleared03 with a live _B variant).
        tl = self._build({
            "RunCleared03": make_textline(skip=True),
            "RunCleared03_B": make_textline(),
        })
        assert "skipReplacement" not in tl["RunCleared03"]

    def test_no_replacement_when_base_also_skip(self):
        tl = self._build({
            "RunCleared03": make_textline(skip=True),
            "RunCleared03_C": make_textline(skip=True),
        })
        assert "skipReplacement" not in tl["RunCleared03_C"]

    def test_no_replacement_when_no_sibling(self):
        tl = self._build({
            "PersephoneChat12": make_textline(skip=True),
        })
        assert "skipReplacement" not in tl["PersephoneChat12"]
