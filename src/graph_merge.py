"""Merge multiple per-source graph datasets into one combined dataset."""

from src.graph import resolve_duplicate, dup_summary


def merge_graph_data(datasets: list[dict]) -> dict:
    """Merge multiple per-source graph datasets into one combined dataset.

    - Detects duplicate textline names across files (these can cause silent
      dependency mis-resolution and so are surfaced for the developer to
      fix at the source).
    - Recomputes `dependents` from the merged textline set rather than
      unioning per-source maps (which could include stale edges from
      overwritten textlines).
    - Recomputes `stats.totalOwners` from the distinct owners in the merged
      textline set rather than summing per-file counts: summing would
      double-count any owner name appearing in multiple sources and include
      skeleton owners that contributed no textlines.
    - Unions `speakerNames`; conflicting mappings (same id -> different
      display name) are surfaced as a warning.
    """
    merged_textlines = {}
    merged_speaker_names = {}
    duplicates = []
    speaker_name_conflicts = []

    for data in datasets:
        for tl_name, tl_data in data.get("textlines", {}).items():
            if tl_name in merged_textlines:
                chosen, dropped = resolve_duplicate(merged_textlines[tl_name], tl_data)
                duplicates.append({
                    "name": tl_name,
                    "kept": dup_summary(chosen),
                    "dropped": dup_summary(dropped),
                })
                merged_textlines[tl_name] = chosen
            else:
                merged_textlines[tl_name] = tl_data

        for sid, name in data.get("speakerNames", {}).items():
            if sid in merged_speaker_names and merged_speaker_names[sid] != name:
                speaker_name_conflicts.append({
                    "id": sid,
                    "existing": merged_speaker_names[sid],
                    "new": name,
                })
            else:
                merged_speaker_names[sid] = name

    merged_dependents = {}
    for tl_name, tl_data in merged_textlines.items():
        for req_type, req_list in tl_data.get("requirements", {}).items():
            for dep in req_list:
                # Self-references (textline lists itself in its own
                # requirements) always come from cooldown / PlayOnce
                # fields and are never real graph edges; excluded here
                # so they don't inflate totalEdges or render as
                # misleading self-loops in the viewer tree. Mirrors the
                # filter in src/graph.py:_build_dependents.
                if dep == tl_name:
                    continue
                merged_dependents.setdefault(dep, []).append({
                    "name": tl_name,
                    "type": req_type,
                })

    all_referenced = set()
    for tl_data in merged_textlines.values():
        for req_list in tl_data.get("requirements", {}).values():
            all_referenced.update(req_list)

    if duplicates:
        print(f"INFO: {len(duplicates)} textline name(s) defined in multiple sources (richer entry kept):")
        for d in duplicates[:5]:
            k, dr = d["kept"], d["dropped"]
            print(f"  {d['name']}: kept {k['owner']}@{k['sourceFile']}:{k['sourceLine']} ({k['dialogueLines']}L/{k['requirementCount']}R), dropped {dr['owner']}@{dr['sourceFile']}:{dr['sourceLine']} ({dr['dialogueLines']}L/{dr['requirementCount']}R)")
        if len(duplicates) > 5:
            print(f"  ... and {len(duplicates) - 5} more")
    if speaker_name_conflicts:
        print(f"WARNING: {len(speaker_name_conflicts)} speakerNames conflict(s):")
        for c in speaker_name_conflicts[:5]:
            print(f"  {c['id']}: {c['existing']!r} vs {c['new']!r}")

    stats = {
        "totalOwners": len({tl["owner"] for tl in merged_textlines.values()}),
        "totalTextlines": len(merged_textlines),
        "totalEdges": sum(len(v) for v in merged_dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(merged_textlines.keys())),
        "duplicates": duplicates,
    }

    return {
        "textlines": merged_textlines,
        "dependents": merged_dependents,
        "speakerNames": merged_speaker_names,
        "stats": stats,
    }
