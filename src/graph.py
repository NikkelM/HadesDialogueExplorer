"""Build the per-source dependency-graph data structure consumed by the
viewer.

Public API:

- :func:`build_graph_data` -- assemble the textlines / dependents /
  speakerNames / stats payload from one extractor's owner -> sections
  output. The single entry point used by :mod:`generate_data`.
- :func:`resolve_duplicate` and :func:`dup_summary` -- helpers for the
  same-textline-name collision case. Re-exported across module
  boundaries because the cross-source merge in
  ``src.graph_merge.merge_graph_data`` reuses them when stitching
  per-source datasets together; keep them stable as part of the
  contract.
"""


def build_graph_data(owners: dict, speaker_names: dict | None = None) -> dict:
    """
    Build the final data structure for the viewer from per-source extractor
    output.

    Args:
        owners: Dict of owner_name -> {section: {textline: data}}. The owner
            may be an NPC, an enemy, a god boon, an inspect point, etc.
        speaker_names: Optional dict of internal_id -> display_name for owners
            and other speaker IDs. The viewer uses this to render friendly
            names while keeping internal IDs canonical in the data. ``None``
            (the default) is treated as an empty mapping; pass an explicit
            dict to populate ``speakerNames`` in the result. ``None`` is the
            default rather than ``{}`` to avoid the
            mutable-default-argument footgun if a future maintainer adds
            in-place mutation here.

    Returns a dict with:
      - textlines: flat dict of textline name -> metadata (incl. `owner`)
      - dependents: reverse lookup of what depends on each textline
      - speakerNames: optional id -> display-name map
      - stats: summary statistics (incl. `totalOwners`)
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
                # Narrative-priority fields, when present. Two distinct
                # sources, both meaningful:
                #   - section-tier: which container the textline lives in
                #     (the engine cascades super-tier sections before
                #     priority-tier sections before plain).
                #   - set-level: `Priority`/`SuperPriority` boolean on the
                #     textline-set table itself (biases random selection
                #     within whichever section is being consulted).
                for opt_key in ("narrativePrioritySectionTier", "narrativePrioritySetLevel"):
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
                existing = textlines.get(tl_name)
                if existing is not None:
                    chosen, dropped = resolve_duplicate(existing, new_entry)
                    duplicates.append({
                        "name": tl_name,
                        # `intra-file` = same source file. Within a single
                        # source (e.g. NPCData.lua) the only known cause is
                        # the xWithY partner-stub pattern. `cross-file` is
                        # emitted by ``graph_merge.merge_graph_data`` for
                        # collisions detected when stitching different
                        # per-source datasets together.
                        "scope": "intra-file",
                        "kept": dup_summary(chosen),
                        "dropped": dup_summary(dropped),
                    })
                    textlines[tl_name] = chosen
                else:
                    textlines[tl_name] = new_entry

    dependents = _build_dependents(textlines)

    all_referenced = set()
    for tl_data in textlines.values():
        for req_list in tl_data["requirements"].values():
            all_referenced.update(req_list)

    stats = {
        "totalOwners": len({tl["owner"] for tl in textlines.values()}),
        "totalTextlines": len(textlines),
        "totalEdges": sum(len(v) for v in dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(textlines.keys())),
        "duplicates": duplicates,
    }

    return {
        "textlines": textlines,
        "dependents": dependents,
        "speakerNames": speaker_names or {},
        "stats": stats,
    }


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


def _build_dependents(textlines: dict) -> dict:
    """Reverse-index requirements: dep_name -> [{name, type}, ...].

    Self-references are intentionally excluded. They always come from
    cooldown / PlayOnce-style fields (``MinRunsSinceAnyTextLines``,
    ``RequiredFalseTextLines*``) and never from hard-prereq fields, so
    they are idiomatic game-data patterns rather than real graph edges.
    Including them would inflate ``stats.totalEdges`` and produce
    misleading "cycle" markers in the viewer's tree.
    """
    dependents = {}
    for tl_name, tl_data in textlines.items():
        for req_type, req_list in tl_data["requirements"].items():
            for dep in req_list:
                if dep == tl_name:
                    continue
                dependents.setdefault(dep, []).append({"name": tl_name, "type": req_type})
    return dependents
