"""Merge multiple per-source graph datasets into one combined dataset."""

from src.graph import (
    resolve_duplicate,
    dup_summary,
    attach_variant,
    transfer_orphan_annotations,
    split_name_collisions,
    count_distinct_speakers,
    build_dependents,
    build_alternates,
    collect_referenced_textlines,
)


def merge_graph_data(datasets: list[dict]) -> dict:
    """Merge multiple per-source graph datasets into one combined dataset.

    - Detects duplicate textline names across files (these can cause silent
      dependency mis-resolution and so are surfaced for the developer to
      fix at the source).
    - Recomputes `dependents` from the merged textline set rather than
      unioning per-source maps (which could include stale edges from
      overwritten textlines).
    - Recomputes `stats.totalSpeakers` from the distinct owners in the
      merged textline set (collapsing display-name variants onto one
      character via the merged speakers map). Summing per-file counts
      would double-count owners appearing in multiple sources and
      include skeleton owners that contributed no textlines.
    - Unions `speakers`; conflicting per-id fields (same id ->
      different ``name`` or ``description``) are surfaced as a
      warning. Each subfield is compared independently so a dataset
      that supplies only ``name`` and another that supplies only
      ``description`` for the same id will merge cleanly.
    - Propagates each input dataset's ``stats.duplicates`` (the
      intra-file partner-stub pattern detected by ``build_graph_data``)
      into the merged ``stats.duplicates`` alongside any new cross-file
      collisions detected here. Without this, intra-file duplicates would
      silently disappear from the viewer dataset.
    """
    merged_textlines = {}
    merged_speakers = {}
    duplicates = []
    speaker_conflicts = []

    for data in datasets:
        # Carry over intra-file duplicates the per-source ``build_graph_data``
        # already detected. Each one is already tagged ``scope: "intra-file"``.
        duplicates.extend(data.get("stats", {}).get("duplicates", []))
        for tl_name, tl_data in data.get("textlines", {}).items():
            if tl_name in merged_textlines:
                chosen, dropped = resolve_duplicate(merged_textlines[tl_name], tl_data)
                duplicates.append({
                    "name": tl_name,
                    "scope": "cross-file",
                    "kept": dup_summary(chosen),
                    "dropped": dup_summary(dropped),
                })
                transfer_orphan_annotations(chosen, dropped)
                attach_variant(chosen, dropped)
                merged_textlines[tl_name] = chosen
            else:
                merged_textlines[tl_name] = tl_data

        for sid, entry in data.get("speakers", {}).items():
            if not isinstance(entry, dict):
                continue
            existing = merged_speakers.setdefault(sid, {})
            for field, value in entry.items():
                if not value:
                    continue
                if field in existing and existing[field] != value:
                    speaker_conflicts.append({
                        "id": sid,
                        "field": field,
                        "existing": existing[field],
                        "new": value,
                    })
                else:
                    existing[field] = value

    # Split any name-collision entries into one suffixed textline per
    # variant before building the dependents index, so each split
    # entry gets its own correct reverse-edges. See
    # :func:`src.graph.split_name_collisions` for the rationale.
    split_name_collisions(merged_textlines)

    # Reverse-index over the merged textline set rather than unioning
    # per-source dependents maps, since per-source maps can include
    # stale edges from textlines that lost the cross-file dedup. The
    # shared helper handles self-reference filtering and ``orBranches``
    # tagging so the merge path stays in lockstep with the per-source
    # pass in ``build_graph_data``.
    merged_dependents = build_dependents(merged_textlines)
    merged_alternates = build_alternates(merged_textlines)

    all_referenced = collect_referenced_textlines(merged_textlines)

    cross_file = [d for d in duplicates if d.get("scope") == "cross-file"]
    intra_file = [d for d in duplicates if d.get("scope") == "intra-file"]
    if duplicates:
        print(
            f"INFO: {len(duplicates)} duplicate textline definition(s) "
            f"({len(intra_file)} intra-file, "
            f"{len(cross_file)} cross-file). Richer/canonical entry kept."
        )
        for d in cross_file[:5]:
            k, dr = d["kept"], d["dropped"]
            print(f"  cross-file {d['name']}: kept {k['owner']}@{k['sourceFile']}:{k['sourceLine']} ({k['dialogueLines']}L/{k['requirementCount']}R), dropped {dr['owner']}@{dr['sourceFile']}:{dr['sourceLine']} ({dr['dialogueLines']}L/{dr['requirementCount']}R)")
        if len(cross_file) > 5:
            print(f"  ... and {len(cross_file) - 5} more cross-file duplicates")
    if speaker_conflicts:
        print(f"WARNING: {len(speaker_conflicts)} speakers conflict(s):")
        for c in speaker_conflicts[:5]:
            print(f"  {c['id']}.{c['field']}: {c['existing']!r} vs {c['new']!r}")

    # Drop ids that ended up with no populated subfields (e.g. a
    # dataset shipped ``{name: '', description: None}``).
    merged_speakers = {sid: entry for sid, entry in merged_speakers.items() if entry}

    stats = {
        "totalSpeakers": count_distinct_speakers(
            {tl["owner"] for tl in merged_textlines.values()}, merged_speakers
        ),
        "totalTextlines": len(merged_textlines),
        "totalEdges": sum(len(v) for v in merged_dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(merged_textlines.keys())),
        "duplicates": duplicates,
    }

    return {
        "textlines": merged_textlines,
        "dependents": merged_dependents,
        "alternates": merged_alternates,
        "speakers": merged_speakers,
        "stats": stats,
    }
