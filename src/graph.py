"""Build dependency graph data from parsed NPC dialogue data."""


def build_graph_data(npcs: dict, speaker_names: dict = None) -> dict:
    """
    Build the final data structure for the viewer from parsed NPC data.

    Args:
        npcs: Dict of npc_name -> {section: {textline: data}} from extract_npc_data.
        speaker_names: Optional dict of internal_id -> display_name for NPCs
            and other speaker IDs. Used by the viewer to show friendly names
            while keeping internal IDs canonical in the data.

    Returns a dict with:
      - textlines: flat dict of textline name -> metadata
      - dependents: reverse lookup of what depends on each textline
      - speakerNames: optional id -> display-name map
      - stats: summary statistics
    """
    textlines = {}

    for npc_name, npc_data in npcs.items():
        source = npc_data.get("source", "Unknown")
        for section_key, section_data in npc_data.items():
            if not section_key.endswith("TextLineSets"):
                continue
            if not isinstance(section_data, dict):
                continue
            for tl_name, tl_data in section_data.items():
                if not isinstance(tl_data, dict):
                    continue
                textlines[tl_name] = {
                    "name": tl_name,
                    "npc": npc_name,
                    "section": section_key,
                    "source": source,
                    "requirements": tl_data.get("requirements", {}),
                    "otherRequirements": tl_data.get("otherRequirements", {}),
                    "dialogueLines": tl_data.get("dialogueLines", []),
                }

    # Build reverse lookup: what depends on each textline
    dependents = {}
    for tl_name, tl_data in textlines.items():
        for req_type, req_list in tl_data["requirements"].items():
            for dep in req_list:
                if dep not in dependents:
                    dependents[dep] = []
                dependents[dep].append({"name": tl_name, "type": req_type})

    # Stats
    stats = {
        "totalNPCs": len(npcs),
        "totalTextlines": len(textlines),
        "totalEdges": sum(len(v) for v in dependents.values()),
        "unresolvedRefs": [],
    }

    # Find unresolved references
    all_referenced = set()
    for tl_data in textlines.values():
        for req_list in tl_data["requirements"].values():
            all_referenced.update(req_list)
    stats["unresolvedRefs"] = sorted(all_referenced - set(textlines.keys()))

    return {
        "textlines": textlines,
        "dependents": dependents,
        "speakerNames": speaker_names or {},
        "stats": stats,
    }
