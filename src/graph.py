"""Build dependency graph data from parsed source data."""


def build_graph_data(owners: dict, speaker_names: dict = {}) -> dict:
    """
    Build the final data structure for the viewer from per-source extractor
    output.

    Args:
        owners: Dict of owner_name -> {section: {textline: data}}. The owner
            may be an NPC, an enemy, a god boon, an inspect point, etc.
        speaker_names: Optional dict of internal_id -> display_name for owners
            and other speaker IDs. The viewer uses this to render friendly
            names while keeping internal IDs canonical in the data.

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
                existing = textlines.get(tl_name)
                if existing is not None:
                    chosen, dropped = resolve_duplicate(existing, new_entry)
                    duplicates.append({
                        "name": tl_name,
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

    Synthetic choice-variant entries always lose to a real definition (a real
    textline in another source file always wins) regardless of richness.

    Returns (kept, dropped). Ties go to the existing entry (first-wins).

    Public alongside :func:`dup_summary` because the merge pipeline in
    ``build_viewer.merge_graph_data`` reuses these helpers across module
    boundaries when stitching per-source datasets together.
    """
    existing_synth = bool(existing.get("isSynthetic"))
    new_synth = bool(new.get("isSynthetic"))
    if existing_synth and not new_synth:
        return new, existing
    if new_synth and not existing_synth:
        return existing, new
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
    """
    return {
        "owner": entry["owner"],
        "section": entry["section"],
        "sourceFile": entry.get("sourceFile", ""),
        "sourceLine": entry.get("sourceLine"),
        "dialogueLines": len(entry.get("dialogueLines") or []),
        "requirementCount": sum(len(v) for v in (entry.get("requirements") or {}).values()),
    }


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
