"""
Build the final HTML viewer by combining all JSON datasets in ``outputs/``
with the HTML template.

Usage:
    python build_viewer.py [output_path]
"""

import json
import sys
from pathlib import Path

from src.graph import _resolve_duplicate, _dup_summary
from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS
from src.extractors.hades1 import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
)

PROJECT_DIR = Path(__file__).parent
TEMPLATE_PATH = PROJECT_DIR / "templates" / "viewer.html"
STYLES_DIR = PROJECT_DIR / "styles"
OUTPUT_DIR = PROJECT_DIR / "outputs"
DEFAULT_OUTPUT = PROJECT_DIR / "dialogue_explorer.html"


def merge_graph_data(datasets: list[dict]) -> dict:
    """Merge multiple per-source graph datasets into one combined dataset.

    - Detects duplicate textline names across files (these can cause silent
      dependency mis-resolution and so are surfaced for the developer to
      fix at the source).
    - Recomputes `dependents` from the merged textline set rather than
      unioning per-source maps (which could include stale edges from
      overwritten textlines).
    - Unions `speakerNames`; conflicting mappings (same id -> different
      display name) are surfaced as a warning.
    """
    merged_textlines = {}
    merged_speaker_names = {}
    total_owners = 0
    duplicates = []
    speaker_name_conflicts = []

    for data in datasets:
        for tl_name, tl_data in data.get("textlines", {}).items():
            if tl_name in merged_textlines:
                chosen, dropped = _resolve_duplicate(merged_textlines[tl_name], tl_data)
                duplicates.append({
                    "name": tl_name,
                    "kept": _dup_summary(chosen),
                    "dropped": _dup_summary(dropped),
                })
                merged_textlines[tl_name] = chosen
            else:
                merged_textlines[tl_name] = tl_data

        total_owners += data.get("stats", {}).get("totalOwners", 0)

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
        "totalOwners": total_owners,
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


def _short_loc(tl_data: dict) -> str:
    """Compact owner/source/line string for diagnostics."""
    owner = tl_data.get("owner", "?")
    sf = tl_data.get("sourceFile", "?")
    sl = tl_data.get("sourceLine")
    return f"{owner} @ {sf}:{sl}" if sl is not None else f"{owner} @ {sf}"


# Hardcoded per-game known-unresolved maps in priority order. Each entry is
# ``(label, mapping)`` so the audit can identify which game's list is drifting.
# Future H2 support adds its own entry here.
_KNOWN_UNRESOLVED_SOURCES = [
    ("HADES1_KNOWN_UNRESOLVED_REFS", HADES1_KNOWN_UNRESOLVED_REFS),
]


def annotate_known_unresolved(graph_data: dict) -> None:
    """Attach the categorized known-unresolved-refs map to the merged graph
    data and audit it against what the parser actually computed.

    Adds to ``graph_data``:
      - ``knownUnresolvedRefs``: ``{name: {category, reason}}`` for every
        currently-unresolved ref that has a hardcoded entry.
      - ``unresolvedCategoryLabels``: ``{category: human-label}``.
      - ``unresolvedCategoryDescriptions``: ``{category: explainer}``.
      - ``stats.unresolvedByCategory``: ``{category: count}`` (the count of
        unresolved refs in each category, plus ``uncategorized`` for any
        ref the hardcoded list doesn't cover).

    Audits and prints warnings for:
      - hardcoded entries no longer in the unresolved set (parser fix);
      - unresolved refs missing from every hardcoded list (new content).
    """
    unresolved_set = set(graph_data["stats"]["unresolvedRefs"])
    union_known = {}
    for label, mapping in _KNOWN_UNRESOLVED_SOURCES:
        stale = sorted(set(mapping) - unresolved_set)
        if stale:
            print(
                f"WARNING: {len(stale)} entry(ies) in {label} are now "
                f"resolved by the parser - remove them: {stale}"
            )
        for name, info in mapping.items():
            if name in unresolved_set:
                union_known[name] = info

    untriaged = sorted(unresolved_set - set(union_known))
    if untriaged:
        print(
            f"WARNING: {len(untriaged)} unresolved ref(s) are not "
            f"categorized in any *_KNOWN_UNRESOLVED_REFS map - triage and "
            f"add them: {untriaged}"
        )

    by_category = {"uncategorized": len(untriaged)}
    for info in union_known.values():
        by_category[info["category"]] = by_category.get(info["category"], 0) + 1

    graph_data["knownUnresolvedRefs"] = union_known
    graph_data["unresolvedCategoryLabels"] = dict(UNRESOLVED_CATEGORY_LABELS)
    graph_data["unresolvedCategoryDescriptions"] = dict(UNRESOLVED_CATEGORY_DESCRIPTIONS)
    graph_data["stats"]["unresolvedByCategory"] = by_category


def annotate_blocked_textlines(graph_data: dict) -> None:
    """Walk every defined textline and flag those whose requirements can
    never be satisfied because of unresolved references.

    A textline is considered *blocked* when at least one of its requirement
    fields has a hard failure given the unresolved set:

      - ``RequiredTextLines`` and other ALL-semantics fields: ANY unresolved
        entry blocks the textline (every entry must have played).
      - ``RequiredAnyTextLines`` and other ANY-semantics fields: blocks only
        when EVERY entry in the list is unresolved (no satisfying choice
        remains).
      - ``RequiredMinAnyTextLines``: blocks when the requested ``Count``
        exceeds the number of resolved entries.

    Permissive forms (``RequiredFalse*``, ``RequiredMaxAnyTextLines``,
    ``MinRunsSinceAnyTextLines``, ``MaxRunsSinceAnyTextLines``) are never
    blocking from unresolved entries alone - lines that were never defined
    can never play, so a "must not have played" or "permissive count" check
    is trivially satisfied.

    Each affected textline gains:
      ``blocked``: ``True``
      ``blockingReasons``: list of ``{field, semantics, missingRefs, ...}``
        - ``field``         the requirement-field name (e.g. RequiredTextLines)
        - ``semantics``     "all" | "any" | "count-min"
        - ``missingRefs``   the unresolved names that caused the block
        - ``totalRefs``     total entries in the field (for context)
        - ``requiredCount`` (count-min only) the ``Count`` parameter
        - ``resolvedCount`` (count-min only) entries currently resolved

    Stats: ``stats.blockedTextlines`` is the total blocked count.
    """
    textlines = graph_data["textlines"]
    resolved_names = set(textlines.keys())
    blocked_count = 0
    unresolved_blocks: dict = {}

    for name, tl in textlines.items():
        reasons = []
        for field, refs in (tl.get("requirements") or {}).items():
            semantics = REQUIREMENT_BLOCKING_SEMANTICS.get(field)
            if semantics is None or semantics in ("none", "count-permissive"):
                continue

            missing = [r for r in refs if r not in resolved_names]

            if semantics == "all" and missing:
                reasons.append({
                    "field": field,
                    "semantics": "all",
                    "missingRefs": sorted(set(missing)),
                    "totalRefs": len(refs),
                })
            elif semantics == "any":
                if refs and len(missing) == len(refs):
                    reasons.append({
                        "field": field,
                        "semantics": "any",
                        "missingRefs": sorted(set(missing)),
                        "totalRefs": len(refs),
                    })
            elif semantics == "count-min":
                meta = (tl.get("otherRequirements") or {}).get(field) or {}
                count = meta.get("Count", 1) if isinstance(meta, dict) else 1
                resolved_count = len(refs) - len(missing)
                if resolved_count < count:
                    reasons.append({
                        "field": field,
                        "semantics": "count-min",
                        "missingRefs": sorted(set(missing)),
                        "totalRefs": len(refs),
                        "requiredCount": count,
                        "resolvedCount": resolved_count,
                    })

        if reasons:
            tl["blocked"] = True
            tl["blockingReasons"] = reasons
            blocked_count += 1
            # Reverse-index: every unresolved ref that contributed to a
            # block is recorded against the blocked textline so the
            # unresolved-ref info-panel can show "blocks: ..." cleanly.
            for reason in reasons:
                for ref in reason["missingRefs"]:
                    unresolved_blocks.setdefault(ref, set()).add(name)

    graph_data["stats"]["blockedTextlines"] = blocked_count
    graph_data["unresolvedRefBlocks"] = {
        ref: sorted(names) for ref, names in unresolved_blocks.items()
    }
    if blocked_count:
        print(
            f"INFO: {blocked_count} textline(s) can never play due to "
            f"unresolved requirement references."
        )


def build_css() -> str:
    """Read and concatenate all CSS files in order."""
    css_files = sorted(STYLES_DIR.glob("*.css"))
    if not css_files:
        print("WARNING: No CSS files found in styles/")
        return ""
    parts = []
    for css_file in css_files:
        parts.append(f"/* --- {css_file.name} --- */")
        parts.append(css_file.read_text(encoding="utf-8").strip())
    return "\n\n".join(parts)


def build_html(graph_data: dict, output_path: Path):
    """Generate the self-contained HTML viewer."""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    json_data = json.dumps(graph_data, separators=(",", ":"))
    css_data = build_css()

    html = template.replace("/* __CSS_PLACEHOLDER__ */", css_data)
    html = html.replace("/* __DATA_PLACEHOLDER__ */", f"const DATA = {json_data};")

    output_path.write_text(html, encoding="utf-8")
    size_kb = output_path.stat().st_size / 1024
    print(f"Generated: {output_path} ({size_kb:.0f} KB)")


def main():
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    datasets = []
    json_files = sorted(OUTPUT_DIR.glob("*.json"))

    if not json_files:
        print("ERROR: No JSON files found in outputs/. Run generate_data.py first.")
        sys.exit(1)

    for json_file in json_files:
        print(f"Loading: {json_file.name}")
        with open(json_file, "r", encoding="utf-8") as f:
            datasets.append(json.load(f))

    if len(datasets) == 1:
        graph_data = datasets[0]
    else:
        print(f"Merging {len(datasets)} datasets...")
        graph_data = merge_graph_data(datasets)

    annotate_known_unresolved(graph_data)
    annotate_blocked_textlines(graph_data)

    print(f"Total: {graph_data['stats']['totalTextlines']} textlines, "
          f"{graph_data['stats']['totalEdges']} edges, "
          f"{len(graph_data['stats']['unresolvedRefs'])} external refs")

    build_html(graph_data, output_path)


if __name__ == "__main__":
    main()
