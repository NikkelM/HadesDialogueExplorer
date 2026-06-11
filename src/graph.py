"""Build the per-source dependency-graph data structure consumed by the
viewer.

Public API:

- :func:`build_graph_data` -- assemble the textlines / dependents /
  speakers / stats payload from one extractor's owner -> sections
  output. The single entry point used by :mod:`generate_data`.
- :func:`resolve_duplicate` and :func:`dup_summary` -- helpers for the
  same-textline-name collision case. Re-exported across module
  boundaries because the cross-source merge in
  ``src.graph_merge.merge_graph_data`` reuses them when stitching
  per-source datasets together; keep them stable as part of the
  contract.
- :func:`count_distinct_speakers` -- character-aware owner-count
  helper. Reused by :mod:`src.graph_merge` so the per-source and
  merged stats use identical dedup logic.
"""

import re


_VARIANT_SUFFIX_RE = re.compile(r"\s*\([^()]*\)\s*$")


def count_distinct_speakers(owner_ids, speakers_map: dict | None = None) -> int:
    """Count the number of distinct *characters* represented by a set of
    owner ids.

    Several owner ids can refer to the same character: e.g. the in-house
    NPC, the field-encounter variant, and the boss form of Hades each
    use a different internal id but share one character identity. The
    speakers map encodes that grouping via display names like ``"Hades"``,
    ``"Hades (Boss)"``, and ``"Hades (Field)"`` - same base name, the
    parenthetical suffix marks the variant.

    Grouping by stripped base display name lets the viewer's header stat
    reflect how many actual characters own dialogue, instead of the
    larger raw owner-id count. Owner ids without a speakers-map entry
    fall back to the id itself as the key so they still contribute to
    the count exactly once.
    """
    chars = set()
    smap = speakers_map or {}
    for oid in owner_ids:
        disp = (smap.get(oid) or {}).get("name") or oid
        chars.add(_VARIANT_SUFFIX_RE.sub("", disp).strip() or oid)
    return len(chars)


def build_graph_data(owners: dict, speakers: dict | None = None) -> dict:
    """
    Build the final data structure for the viewer from per-source extractor
    output.

    Args:
        owners: Dict of owner_name -> {section: {textline: data}}. The owner
            may be an NPC, an enemy, a god boon, an inspect point, etc.
        speakers: Optional dict of ``internal_id -> {"name": str,
            "description": str | None}``. The viewer uses this to
            render friendly names and the hover-tooltip character quip
            while keeping internal IDs canonical in the data. ``None``
            (the default) is treated as an empty mapping; pass an
            explicit dict to populate ``speakers`` in the result. The
            two fields are intentionally kept together because the set
            is strictly 1:1 with the internal id - splitting into
            parallel maps invites silent drift. Entries with
            ``description = None`` are emitted with the description
            field omitted so consumers can use a truthy check; entries
            without a name fall through the same way.

    Returns a dict with:
      - textlines: flat dict of textline name -> metadata (incl. `owner`)
      - dependents: reverse lookup of what depends on each textline
      - speakers: optional ``id -> {name?, description?}`` map (each
        sub-field is omitted when the source had ``None``)
      - stats: summary statistics (incl. `totalSpeakers` - a
        character count that collapses display-name variants like
        ``"Hades"`` / ``"Hades (Boss)"`` onto one bucket)
    """
    textlines = {}
    duplicates = []

    for owner_name, owner_data in owners.items():
        source = owner_data.get("source", "Unknown")
        for section_key, section_data in owner_data.items():
            # The extractor already filtered to known textline-set sections
            # for this game; the only non-section key at owner level is
            # ``source`` (a string), filtered out by the isinstance check.
            if not isinstance(section_data, dict):
                continue
            for tl_name, tl_data in section_data.items():
                if not isinstance(tl_data, dict):
                    continue
                new_entry = {
                    "name": tl_name,
                    "owner": owner_name,
                    "section": section_key,
                    "source": source,
                    "sourceFile": tl_data.get("sourceFile", ""),
                    "sourceLine": tl_data.get("sourceLine"),
                    "requirements": tl_data.get("requirements", {}),
                    "otherRequirements": tl_data.get("otherRequirements", {}),
                    "dialogueLines": tl_data.get("dialogueLines", []),
                }
                # H2 alternative requirement groups (set-level
                # ``OrRequirements`` on the source RequirementSet). Each
                # branch is itself a {requirements, otherRequirements,
                # flags} record produced by the H2 req walker. The
                # viewer renders them as collapsible OR-group boxes
                # alongside the base AND requirements; the dependent
                # builder also walks them so OR-branch textline edges
                # remain navigable downstream (tagged with branch index
                # for visual disambiguation).
                if tl_data.get("orBranches"):
                    new_entry["orBranches"] = tl_data["orBranches"]
                # Per-requirement-type provenance: each entry in
                # `requirements[type]` is paired 1:1 with an entry here that
                # is either a "GameData.X" group name (the expansion source)
                # or None for bare/unknown entries. Only present when at
                # least one expansion happened.
                if "requirementSources" in tl_data:
                    new_entry["requirementSources"] = tl_data["requirementSources"]
                # Synthetic choice-variant metadata, when present.
                for opt_key in ("parentTextline", "choiceText", "isSynthetic"):
                    if opt_key in tl_data:
                        new_entry[opt_key] = tl_data[opt_key]
                # Narrative-priority fields, when present. Each game uses
                # a different model and the fields are mutually exclusive
                # per textline:
                #   H1 (intrinsic, encoded by container shape):
                #   - section-tier: which container the textline lives in
                #     (the engine cascades super-tier sections before
                #     priority-tier sections before plain).
                #   - set-level: `Priority`/`SuperPriority` boolean on the
                #     textline-set table itself (biases random selection
                #     within whichever section is being consulted).
                #   H2 (extrinsic, looked up from NarrativeData.lua):
                #   - ordinal: 1-based rank in the priority registry list
                #     for this owner+section.
                #   - section-size: total number of priority slots in the
                #     list (so the viewer can render "#1/47").
                #   - cluster-members: sibling textline names tied at the
                #     same ordinal (inline sub-array in the priority list).
                for opt_key in (
                    "narrativePrioritySectionTier",
                    "narrativePrioritySetLevel",
                    "narrativePriorityOrdinal",
                    "narrativePrioritySectionSize",
                    "narrativePriorityClusterMembers",
                ):
                    if opt_key in tl_data:
                        new_entry[opt_key] = tl_data[opt_key]
                # PlayOnce flag (once per save). Surfaced in the details
                # panel only.
                if tl_data.get("playOnce"):
                    new_entry["playOnce"] = True
                # `Partner = "NPC_..."` on xWithY partner dialogues. Names
                # the second NPC; the same textline name also exists as
                # an empty `Skip = true` stub under that partner NPC.
                # `resolve_duplicate` uses the presence of `partner` to
                # pick the canonical (cue-bearing) side over the stub.
                if tl_data.get("partner"):
                    new_entry["partner"] = tl_data["partner"]
                # Variants pre-populated by the extractor (within-owner
                # name collisions caught by ``encounter_room_data.py``).
                # Surfaced verbatim so the cross-file merge layer can
                # chain additional variants onto the same entry.
                if tl_data.get("nameCollision"):
                    new_entry["nameCollision"] = True
                if tl_data.get("variants"):
                    new_entry["variants"] = list(tl_data["variants"])
                existing = textlines.get(tl_name)
                if existing is not None:
                    chosen, dropped = resolve_duplicate(existing, new_entry)
                    duplicates.append({
                        "name": tl_name,
                        # `intra-file` = same source file. Within a single
                        # source (e.g. NPCData.lua) the historic cause is
                        # the xWithY partner-stub pattern; the encounter
                        # /room walker now also flags same-name-different
                        # -owner collisions inside a single file here.
                        # `cross-file` is emitted by
                        # ``graph_merge.merge_graph_data`` for collisions
                        # detected when stitching different per-source
                        # datasets together.
                        "scope": "intra-file",
                        "kept": dup_summary(chosen),
                        "dropped": dup_summary(dropped),
                    })
                    attach_variant(chosen, dropped)
                    textlines[tl_name] = chosen
                else:
                    textlines[tl_name] = new_entry

    dependents = _build_dependents(textlines)

    all_referenced = set()
    for tl_data in textlines.values():
        for req_list in tl_data["requirements"].values():
            all_referenced.update(req_list)
        # H2 OR-branch textline edges also count as references for
        # unresolved-ref reporting: an OR alternative pointing at a
        # missing textline is just as broken as a base requirement.
        for branch in tl_data.get("orBranches") or []:
            for req_list in (branch.get("requirements") or {}).values():
                all_referenced.update(req_list)

    stats = {
        "totalSpeakers": count_distinct_speakers(
            {tl["owner"] for tl in textlines.values()}, speakers
        ),
        "totalTextlines": len(textlines),
        "totalEdges": sum(len(v) for v in dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(textlines.keys())),
        "duplicates": duplicates,
    }

    return {
        "textlines": textlines,
        "dependents": dependents,
        "speakers": _filter_speakers(speakers),
        "stats": stats,
    }


def _filter_speakers(speakers: dict | None) -> dict:
    """Strip empty/None subfields from a speakers map so consumers can
    use a truthy check against ``speakers[id]?.name`` /
    ``speakers[id]?.description`` instead of comparing to ``None``."""
    out = {}
    for sid, entry in (speakers or {}).items():
        if not isinstance(entry, dict):
            continue
        slim = {k: v for k, v in entry.items() if v}
        if slim:
            out[sid] = slim
    return out


def resolve_duplicate(existing: dict, new: dict) -> tuple:
    """When the same textline name appears under two owners, pick the one
    with more content (more dialogue lines + more requirements). This matches
    the game's pattern where shared dialogues have one "stub" entry (queue
    trigger only) and one "full" entry with the actual content / dependencies.

    Two explicit signals override the richness heuristic so the rule is
    documented and robust against future game-data changes:

    - Synthetic choice-variant entries always lose to a real definition
      (the engine only ever fires the real cue-bearing textline; the
      synthetic exists purely to model the choice flag's name in the
      dependency graph).
    - The xWithY partner pattern: the side declaring ``Partner = "..."``
      is by definition the cue-bearing canonical entry; the partner-NPC
      side is a queue-only stub that never declares ``Partner``. Prefer
      the side with ``partner`` set whenever exactly one side has it.
      This handles the (hypothetical but possible) case where future
      game data ships stubs with enough placeholder metadata to outscore
      the canonical side under the plain richness comparison.

    Returns (kept, dropped). Ties go to the existing entry (first-wins).

    Public alongside :func:`dup_summary` because the merge pipeline in
    ``src.graph_merge.merge_graph_data`` reuses these helpers across module
    boundaries when stitching per-source datasets together.
    """
    existing_synth = bool(existing.get("isSynthetic"))
    new_synth = bool(new.get("isSynthetic"))
    if existing_synth and not new_synth:
        return new, existing
    if new_synth and not existing_synth:
        return existing, new
    existing_partner = bool(existing.get("partner"))
    new_partner = bool(new.get("partner"))
    if existing_partner and not new_partner:
        return existing, new
    if new_partner and not existing_partner:
        return new, existing
    if _richness(new) > _richness(existing):
        return new, existing
    return existing, new


def _richness(entry: dict) -> int:
    lines = len(entry.get("dialogueLines") or [])
    reqs = sum(len(v) for v in (entry.get("requirements") or {}).values())
    other = len(entry.get("otherRequirements") or {})
    return lines * 100 + reqs * 10 + other


def dup_summary(entry: dict) -> dict:
    """Compact descriptor for one half of a duplicate pair, written into
    ``stats.duplicates`` so the viewer can surface which definition won
    and which lost when the same textline name appeared twice across
    parsed source files. Public counterpart to :func:`resolve_duplicate`.

    The ``partner`` field is preserved when present so consumers can
    distinguish the well-known xWithY partner-stub pattern (kept side
    declares ``Partner``) from accidental cross-file collisions
    (neither side declares ``Partner``).
    """
    summary = {
        "owner": entry["owner"],
        "section": entry["section"],
        "sourceFile": entry.get("sourceFile", ""),
        "sourceLine": entry.get("sourceLine"),
        "dialogueLines": len(entry.get("dialogueLines") or []),
        "requirementCount": sum(len(v) for v in (entry.get("requirements") or {}).values()),
    }
    if entry.get("partner"):
        summary["partner"] = entry["partner"]
    return summary


# Per-entry fields that participate in a variant payload. Both
# graph-shape entries (with ``owner``/``section`` set) and raw extractor
# ``tl_data`` (with the outer dict supplying owner/section) flow through
# :func:`make_variant_summary`; the optional set is kept here so the
# extractor and the merge layers stay in sync about which fields a
# variant carries.
_VARIANT_OPTIONAL_FIELDS = (
    "requirementSources",
    "orBranches",
    "playOnce",
    "partner",
    "parentTextline",
    "choiceText",
    "isSynthetic",
    "narrativePrioritySectionTier",
    "narrativePrioritySetLevel",
    "narrativePriorityOrdinal",
    "narrativePrioritySectionSize",
    "narrativePriorityClusterMembers",
)


def make_variant_summary(data: dict, owner: str, section: str) -> dict:
    """Build a variant payload from either a graph-shape entry or a raw
    extractor ``tl_data``.

    The variant carries the per-definition fields that differ across
    name-collision siblings: owner, section, source location, dialogue
    lines, and requirements (textline + non-textline). ``source`` is
    intentionally omitted because a name collision only happens within a
    single parsed dataset; the game label is set on the canonical entry.
    """
    v = {
        "owner": owner,
        "section": section,
        "sourceFile": data.get("sourceFile", ""),
        "sourceLine": data.get("sourceLine"),
        "dialogueLines": data.get("dialogueLines", []),
        "requirements": data.get("requirements", {}),
        "otherRequirements": data.get("otherRequirements", {}),
    }
    for opt_key in _VARIANT_OPTIONAL_FIELDS:
        if data.get(opt_key):
            v[opt_key] = data[opt_key]
    return v


def attach_variant(
    kept: dict,
    dropped: dict,
    *,
    kept_owner: str | None = None,
    kept_section: str | None = None,
    dropped_owner: str | None = None,
    dropped_section: str | None = None,
) -> None:
    """Promote a duplicate-textline drop into a sibling variant on the
    kept entry. Mutates ``kept`` in place.

    The viewer renders ``kept["variants"]`` as a single per-textline
    block with one sub-block per variant, plus a banner explaining the
    engine's "first variant to trigger wins, others are blocked" rule.
    The first entry in ``variants`` is always the seed variant (the
    canonical's own data) so the renderer can iterate variants
    uniformly without special-casing the canonical.

    Chained collisions are handled by lifting any pre-existing
    ``variants`` array on ``dropped`` (set when the extractor already
    detected a within-owner collision, or when an earlier
    merge-layer pass already attached siblings) onto the kept entry,
    deduplicated by ``(sourceFile, sourceLine)``.

    ``kept_owner`` / ``kept_section`` (and the ``dropped_*`` pair) are
    consulted only when the corresponding entry lacks an ``owner`` /
    ``section`` field, which happens when this is called from inside an
    extractor on raw ``tl_data``. Graph-shape entries already carry
    both, so the merge layers can omit the keyword arguments entirely.

    No-op when the dropped side is not a substantive variant:

    * **Synthetic choice variants** are routed through the parent's
      choice-link UI, not the variant block, so they are intentionally
      excluded.
    * **Empty placeholder stubs** (the xWithY partner-stub pattern in
      ``NPCData.lua``: ``Skip = true`` with no dialogue and no
      requirements) are the same logical textline registered under the
      partner NPC so the engine can find it from either side. They
      carry no distinct content and would just pollute the variant
      list with empty rows.
    """
    if not _is_substantive_variant(dropped):
        return
    kept["nameCollision"] = True
    if "variants" not in kept:
        kept["variants"] = [make_variant_summary(
            kept,
            kept.get("owner", kept_owner),
            kept.get("section", kept_section),
        )]
    dropped_variants = dropped.get("variants")
    if dropped_variants:
        candidates = list(dropped_variants)
    else:
        candidates = [make_variant_summary(
            dropped,
            dropped.get("owner", dropped_owner),
            dropped.get("section", dropped_section),
        )]
    for cand in candidates:
        if not _variant_already_present(kept["variants"], cand):
            kept["variants"].append(cand)


def _is_substantive_variant(entry: dict) -> bool:
    """A variant is substantive when it carries content distinct enough
    to be worth surfacing in the viewer's variant block. Synthetic
    choice placeholders and empty partner stubs are both excluded; see
    :func:`attach_variant` for why."""
    if entry.get("isSynthetic"):
        return False
    if entry.get("dialogueLines"):
        return True
    if entry.get("requirements"):
        return True
    if entry.get("otherRequirements"):
        return True
    # An entry whose ``variants`` list has already been populated by an
    # earlier dedup pass is substantive by definition (each of those
    # variants was itself substantive when added). Without this branch
    # a chained merge would lose previously-recorded siblings the
    # moment a stub drops into the chain.
    if entry.get("variants"):
        return True
    return False


def _variant_already_present(variants: list, candidate: dict) -> bool:
    """Variants are uniquely identified by ``(sourceFile, sourceLine)``.

    Two textline-set tables can never share a source location, and the
    pair survives any later re-parse of the same source, so it is a
    stable key for the chained-merge dedup loop in :func:`attach_variant`.
    """
    key = (candidate.get("sourceFile"), candidate.get("sourceLine"))
    return any(
        (v.get("sourceFile"), v.get("sourceLine")) == key
        for v in variants
    )


def split_name_collisions(textlines: dict) -> dict:
    """Replace each ``nameCollision`` entry with one suffixed entry per
    variant. Mutates ``textlines`` in place and returns it.

    The collisions are real distinct content - different rooms, inspect
    points or boon sources happen to share a textline name in the
    game's source data, the engine treats them as the same logical
    textline (only the first to trigger plays), but to a player they
    are clearly separate dialogues with separate texts. Surfacing them
    as separate textlines under suffixed names (``Foo_1``, ``Foo_2``)
    is more faithful to the player-visible content than merging them
    into one entry with a variants list. Each new entry carries the
    rename-aware fields the viewer uses to surface the warning label
    and link siblings:

    * ``collisionOriginalName`` - the un-suffixed source-data name.
    * ``collisionIndex`` / ``collisionTotal`` - this entry's 1-based
      position in the sibling list.
    * ``collisionSiblings`` - the full ordered list of suffixed names
      (including this entry) so the viewer can render sibling-link UI
      without scanning the textline map.

    The original (un-suffixed) name is removed from the map. We
    verified that no dialogue in the parsed data references any of
    the colliding names from its requirements, so dropping the
    original name does not strand any edges; if a future game ships
    a requirement that DOES reference one, it will surface in
    ``unresolvedRefs`` and we can revisit the policy.

    Sorted by ``(sourceFile, sourceLine)`` so the suffix is stable
    across builds even if the upstream dict iteration order changes.
    """
    to_add = {}
    to_remove = []
    for name, entry in textlines.items():
        if not entry.get("nameCollision"):
            continue
        variants = entry.get("variants") or []
        if len(variants) < 2:
            continue
        sorted_variants = sorted(
            variants,
            key=lambda v: (v.get("sourceFile") or "", v.get("sourceLine") or 0),
        )
        total = len(sorted_variants)
        siblings = [f"{name}_{i + 1}" for i in range(total)]
        for i, variant in enumerate(sorted_variants):
            to_add[siblings[i]] = _entry_from_variant(
                entry, variant, name, i + 1, total, siblings,
            )
        to_remove.append(name)
    for name in to_remove:
        del textlines[name]
    textlines.update(to_add)
    return textlines


def _entry_from_variant(canonical: dict, variant: dict, original_name: str,
                        index: int, total: int, siblings: list) -> dict:
    """Build a fresh textline entry from one collision variant.

    Carries over the canonical's stable shared fields (``source`` game
    label) plus the variant-specific content (owner, section, source
    location, dialogue lines, requirements). Strips the
    ``nameCollision`` / ``variants`` book-keeping (no longer relevant
    after the split) and adds the rename-aware fields the viewer
    consumes.
    """
    new_entry = {
        "owner": variant["owner"],
        "section": variant["section"],
        "source": canonical.get("source", "Unknown"),
        "sourceFile": variant.get("sourceFile", ""),
        "sourceLine": variant.get("sourceLine"),
        "requirements": variant.get("requirements", {}),
        "otherRequirements": variant.get("otherRequirements", {}),
        "dialogueLines": variant.get("dialogueLines", []),
    }
    for opt_key in _VARIANT_OPTIONAL_FIELDS:
        if variant.get(opt_key):
            new_entry[opt_key] = variant[opt_key]
    new_entry["collisionOriginalName"] = original_name
    new_entry["collisionIndex"] = index
    new_entry["collisionTotal"] = total
    new_entry["collisionSiblings"] = list(siblings)
    return new_entry


def _build_dependents(textlines: dict) -> dict:
    """Reverse-index requirements: dep_name -> [{name, type, ...}, ...].

    Self-references are intentionally excluded. They always come from
    cooldown / PlayOnce-style fields (``MinRunsSinceAnyTextLines``,
    ``RequiredFalseTextLines*``) and never from hard-prereq fields, so
    they are idiomatic game-data patterns rather than real graph edges.
    Including them would inflate ``stats.totalEdges`` and produce
    misleading "cycle" markers in the viewer's tree.

    H2 ``orBranches`` (alternative requirement groups) are walked as
    well so OR-branch textline edges remain navigable from the
    downstream side. Each OR-branch edge carries ``orBranchIndex``
    (1-based) and ``orBranchTotal`` so the viewer can tag the
    dependent as "(OR alt N of M)" rather than a hard requirement.
    """
    dependents = {}
    for tl_name, tl_data in textlines.items():
        for req_type, req_list in tl_data["requirements"].items():
            for dep in req_list:
                if dep == tl_name:
                    continue
                dependents.setdefault(dep, []).append({"name": tl_name, "type": req_type})
        or_branches = tl_data.get("orBranches") or []
        total_branches = len(or_branches)
        for branch_index, branch in enumerate(or_branches, start=1):
            branch_reqs = (branch or {}).get("requirements") or {}
            for req_type, req_list in branch_reqs.items():
                for dep in req_list:
                    if dep == tl_name:
                        continue
                    dependents.setdefault(dep, []).append({
                        "name": tl_name,
                        "type": req_type,
                        "orBranchIndex": branch_index,
                        "orBranchTotal": total_branches,
                    })
    return dependents
