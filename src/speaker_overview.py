"""Compute per-speaker aggregate stats for the viewer's speaker
overview view.

The viewer ships a ``speakers`` map per game with ``{name, description}``
populated by the per-game extractors; this pass walks the merged
``graph_data`` once and attaches additional aggregate fields used by
the speaker overview view:

* ``ownedTextlines``     list of textline names where ``owner`` is this
                         speaker, sorted alphabetically.
* ``asSpeakerTextlines`` list of textline names where this speaker
                         appears in ``dialogueLines[*].speaker`` but is
                         NOT the owner. Sorted alphabetically. Useful
                         for surfacing cross-NPC cameos (e.g. CharProtag
                         speaking inside an NPC_FurySister_01-owned
                         set).
* ``sectionCounts``      ``{section: count}`` of owned textlines
                         bucketed by section key. The viewer sorts
                         this by its own per-game section display
                         order.
* ``priorityCounts``     ``{super: N, priority: M, plain: K}`` of
                         owned textlines bucketed by priority. See
                         :func:`_priority_bucket` for the per-game
                         bucketing rules. Always emits all three
                         keys (zero counts inclusive) so the viewer
                         can render the filter UI without guarding
                         every lookup.
* ``adjacencyUpstream``  ``{otherSpeakerId: count}`` of owned
                         textlines that depend on at least one
                         textline owned by ``otherSpeakerId``. Counts
                         distinct dependent textlines, NOT distinct
                         requirement refs - one of this speaker's
                         textlines counts once towards each other
                         speaker it references, regardless of how
                         many of that speaker's textlines it gates
                         on. Self-loops (speaker depends on its own
                         textlines) are included.
* ``adjacencyDownstream`` ``{otherSpeakerId: count}`` of textlines
                         owned by ``otherSpeakerId`` that depend on
                         at least one textline owned by this speaker.
                         Mirror of ``adjacencyUpstream``: if
                         ``A.adjacencyUpstream[B] = N`` then
                         ``B.adjacencyDownstream[A] = N`` is NOT
                         guaranteed - they count from opposite sides
                         so the per-edge dedup differs. (Specifically,
                         ``A.adjacencyUpstream[B]`` counts how many of
                         A's textlines reference at least one of B's;
                         ``B.adjacencyDownstream[A]`` counts how many
                         of B's textlines are referenced by at least
                         one of A's.) Both are useful and they are
                         intentionally NOT symmetric.

Speakers absent from any owned-textline are still annotated (with
empty / zero fields) so the viewer can present a consistent shape
regardless of which speaker the user navigates to.

This pass is purely additive: it reads ``graph_data['textlines']``,
``graph_data['dependents']``, and ``graph_data['speakers']`` and
mutates each speaker entry in place.
"""


# Priority bucketing rules. The speaker overview groups owned
# textlines into three buckets - ``super``, ``priority``, ``plain`` -
# so users can see at a glance how much of a speaker's catalogue the
# engine biases towards.
#
# H1 has two per-textline priority fields. ``narrativePrioritySectionTier``
# is the section-level baseline (``super`` / ``priority`` / ``low`` /
# unset = normal). ``narrativePrioritySetLevel`` is the set-level
# elevation (``super`` / ``priority`` / unset). The effective bucket
# is the strongest of the two: a ``normal``-section textline with a
# ``super`` set-level elevation is treated as ``super``, because the
# set-level flag overrides the section default within the eligible
# set. ``low`` and unset both collapse to ``plain`` - the issue's
# tri-state filter intentionally treats both as the same bucket so
# the UI stays manageable.
#
# H2 has no super/priority tier system. Priority is ordinal-based
# (NarrativeData.lua orders textlines per owner+section). For the
# bucket we map: ordinal present -> ``priority`` (the textline is
# explicitly ranked); ordinal absent -> ``plain``. There's no
# H2-native ``super`` bucket, so that count is always zero for H2
# speakers. The viewer can hide the super filter chip for H2 based
# on the per-game stats it already ships.
_PRIORITY_BUCKETS = ("super", "priority", "plain")


def _priority_bucket(textline: dict) -> str:
    """Bucket a single textline into ``super`` / ``priority`` /
    ``plain``. Returns the strongest applicable bucket - see module
    docstring for the per-game rules."""
    set_level = textline.get("narrativePrioritySetLevel")
    section_tier = textline.get("narrativePrioritySectionTier")
    if set_level == "super" or section_tier == "super":
        return "super"
    if set_level == "priority" or section_tier == "priority":
        return "priority"
    if textline.get("narrativePriorityOrdinal") is not None:
        return "priority"
    return "plain"


def annotate_speaker_aggregates(graph_data: dict) -> None:
    """Compute and attach the per-speaker aggregate fields documented
    in the module docstring. Idempotent: running twice on the same
    ``graph_data`` produces the same result (each pass overwrites
    the previously-computed aggregate fields)."""
    textlines = graph_data.get("textlines") or {}
    dependents = graph_data.get("dependents") or {}
    speakers = graph_data.get("speakers")
    if speakers is None:
        speakers = {}
        graph_data["speakers"] = speakers

    # Two-pass walk so unknown owners / speakers are auto-registered
    # before we start counting. Both H1 and H2 fixtures contain a few
    # textlines whose owner is a runtime player-character id
    # (``CharProtag`` / ``Player``) that the per-game speakers
    # extractors don't always pre-populate; rather than leaking those
    # rows or dropping their textlines from the overview we register a
    # bare-bones speaker entry on demand. The friendly name falls back
    # to the id and the description stays empty - identical to how
    # ``renderSpeakerHtml`` handles unmapped ids today.
    for name, tl in textlines.items():
        owner = tl.get("owner")
        if owner and owner not in speakers:
            speakers[owner] = {"name": owner, "description": ""}
        for line in tl.get("dialogueLines") or []:
            speaker = line.get("speaker")
            if speaker and speaker not in speakers:
                speakers[speaker] = {"name": speaker, "description": ""}

    owned_by: dict[str, list[str]] = {sid: [] for sid in speakers}
    spoken_by: dict[str, set[str]] = {sid: set() for sid in speakers}
    section_counts: dict[str, dict[str, int]] = {sid: {} for sid in speakers}
    priority_counts: dict[str, dict[str, int]] = {
        sid: {b: 0 for b in _PRIORITY_BUCKETS} for sid in speakers
    }

    for name, tl in textlines.items():
        owner = tl.get("owner")
        if owner:
            owned_by[owner].append(name)
            section = tl.get("section")
            if section:
                section_counts[owner][section] = (
                    section_counts[owner].get(section, 0) + 1
                )
            bucket = _priority_bucket(tl)
            priority_counts[owner][bucket] += 1

        # Track every speaker that appears in a dialogue line. Owner
        # speech rolls up into ``owned`` already; we only record the
        # cross-speaker hits in ``asSpeakerTextlines`` so the field
        # isn't dominated by self-mentions on every owned textline.
        for line in tl.get("dialogueLines") or []:
            speaker = line.get("speaker")
            if speaker and speaker != owner:
                spoken_by[speaker].add(name)

    adjacency_upstream: dict[str, dict[str, int]] = {sid: {} for sid in speakers}
    adjacency_downstream: dict[str, dict[str, int]] = {sid: {} for sid in speakers}

    for name, tl in textlines.items():
        owner = tl.get("owner")
        if not owner:
            continue
        # Adjacency upstream: this textline references some refs (both its flat
        # ``requirements`` and any H2 ``orBranches`` alternative-set
        # requirements); collect the unique set of OTHER-SPEAKER OWNERS those
        # refs resolve to, then increment ``adjacencyUpstream[owner][otherId]``
        # by 1 for each distinct other-speaker reference. This textline
        # therefore contributes 1 vote per (this-owner, other-owner) pair,
        # regardless of how many refs land on that other owner. OR-branch refs
        # are included so the upstream side mirrors the downstream side (built
        # from the ``dependents`` index, which graph.py populates from orBranches
        # too) and the prerequisite tree (which surfaces orBranch refs).
        referenced_owners: set[str] = set()
        req_sources = list((tl.get("requirements") or {}).values())
        for branch in tl.get("orBranches") or []:
            req_sources.extend(((branch or {}).get("requirements") or {}).values())
        for refs in req_sources:
            for ref in refs:
                ref_tl = textlines.get(ref)
                if not ref_tl:
                    continue
                ref_owner = ref_tl.get("owner")
                if ref_owner:
                    referenced_owners.add(ref_owner)
        for other in referenced_owners:
            bucket = adjacency_upstream[owner]
            bucket[other] = bucket.get(other, 0) + 1

    for name, deps in dependents.items():
        ref_tl = textlines.get(name)
        if not ref_tl:
            continue
        ref_owner = ref_tl.get("owner")
        if not ref_owner:
            continue
        # Adjacency downstream: dedup dependents by owner once per
        # depended-on textline, then bump the count. This mirrors the
        # upstream "1 vote per pair" semantics: each owned textline of
        # the depended-on speaker counts once towards each dependent
        # speaker that references it.
        dependent_owners: set[str] = set()
        for dep in deps:
            dep_name = dep.get("name") if isinstance(dep, dict) else dep
            dep_tl = textlines.get(dep_name) if dep_name else None
            if not dep_tl:
                continue
            dep_owner = dep_tl.get("owner")
            if dep_owner:
                dependent_owners.add(dep_owner)
        for other in dependent_owners:
            bucket = adjacency_downstream[ref_owner]
            bucket[other] = bucket.get(other, 0) + 1

    for sid, entry in speakers.items():
        owned = sorted(owned_by.get(sid, []))
        as_speaker = sorted(spoken_by.get(sid, set()))
        entry["ownedTextlines"] = owned
        entry["asSpeakerTextlines"] = as_speaker
        entry["sectionCounts"] = dict(section_counts.get(sid, {}))
        entry["priorityCounts"] = dict(priority_counts.get(sid, {b: 0 for b in _PRIORITY_BUCKETS}))
        entry["adjacencyUpstream"] = dict(adjacency_upstream.get(sid, {}))
        entry["adjacencyDownstream"] = dict(adjacency_downstream.get(sid, {}))
