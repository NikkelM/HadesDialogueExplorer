"""Build dependency graph data from parsed NPC dialogue data."""


def build_graph_data(npcs: dict) -> dict:
    """
    Build the final data structure for the viewer from parsed NPC data.

    Returns a dict with:
      - textlines: flat dict of textline name -> metadata
      - dependents: reverse lookup of what depends on each textline
      - stats: summary statistics
    """
    textlines = {}

    for npc_name, npc_data in npcs.items():
        source = npc_data.get("source", "Unknown")
        for section in ("InteractTextLineSets", "RepeatableTextLineSets"):
            for tl_name, tl_data in npc_data.get(section, {}).items():
                textlines[tl_name] = {
                    "name": tl_name,
                    "npc": npc_name,
                    "section": section,
                    "source": source,
                    "line": tl_data.get("line"),
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
        "stats": stats,
    }
