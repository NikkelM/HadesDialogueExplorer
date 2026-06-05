"""
Build the final HTML viewer by combining all JSON datasets in ``outputs/``
with the HTML template.

Two output flavours are supported:

  - ``--split`` (default): writes ``dist/index.html`` + ``dist/viewer.js``
    + ``dist/viewer.css`` + ``dist/data.json``. This is the canonical
    artifact - it's what gets deployed to GitHub Pages and is the only
    shape that benefits from HTTP caching (each file is cached and
    invalidated independently). Requires an HTTP server to view locally
    because browsers block ``fetch()`` from ``file://``.

  - ``--bundle``: stitches the split outputs into a single
    ``dist/dialogue_explorer.html`` for offline ``file://`` use. CSS and
    JS are inlined; data is embedded as a ``<script
    type="application/json">`` block read via ``textContent``. Suitable
    as a GitHub Releases attachment.

  - ``--all``: runs both, in that order. This is the default when no flag
    is passed because the bundler is fast and most release flows want
    both artifacts.

Usage:
    python build_viewer.py            # equivalent to --all
    python build_viewer.py --split
    python build_viewer.py --bundle
    python build_viewer.py --all
"""

import argparse
import json
import sys
from pathlib import Path

from src.graph import resolve_duplicate, dup_summary
from src.extractors.textline_set import (
    REQUIREMENT_BLOCKING_SEMANTICS,
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
    audit_section_key_labels,
    audit_section_key_labels_stale,
    audit_req_type_labels,
    audit_req_type_labels_stale,
)
from src.extractors.hades1 import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
    HADES1_TEXTLINE_SECTION_KEYS,
    HADES1_SECTION_KEY_LABELS,
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
)

PROJECT_DIR = Path(__file__).parent
TEMPLATES_DIR = PROJECT_DIR / "templates"
INDEX_TEMPLATE = TEMPLATES_DIR / "index.html"
VIEWER_JS_TEMPLATE = TEMPLATES_DIR / "viewer.js"
STYLES_DIR = PROJECT_DIR / "styles"
OUTPUT_DIR = PROJECT_DIR / "outputs"
DIST_DIR = PROJECT_DIR / "dist"

# Files written by the split build. Tracked explicitly so the cleaner
# only removes managed artifacts, not anything else the user may have
# dropped in ``dist/`` (e.g. screenshots, release notes).
_SPLIT_OUTPUT_NAMES = ("index.html", "viewer.js", "viewer.css", "data.json")
_BUNDLE_OUTPUT_NAME = "dialogue_explorer.html"


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
                chosen, dropped = resolve_duplicate(merged_textlines[tl_name], tl_data)
                duplicates.append({
                    "name": tl_name,
                    "kept": dup_summary(chosen),
                    "dropped": dup_summary(dropped),
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
# ``(game_label, mapping)`` so the audit can identify which game's list is
# drifting; the warning string interpolates the variable-name suffix from
# the game prefix (e.g. ``HADES1`` -> ``HADES1_KNOWN_UNRESOLVED_REFS``).
# Mirrors the ``_SECTION_KEY_LABEL_SOURCES`` convention below so adding H2
# is a one-line change in both lists.
_KNOWN_UNRESOLVED_SOURCES = [
    ("HADES1", HADES1_KNOWN_UNRESOLVED_REFS),
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
    for game_label, mapping in _KNOWN_UNRESOLVED_SOURCES:
        stale = sorted(set(mapping) - unresolved_set)
        if stale:
            print(
                f"WARNING: {len(stale)} entry(ies) in "
                f"{game_label}_KNOWN_UNRESOLVED_REFS are now resolved by "
                f"the parser - remove them: {stale}"
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


# Semantics tags ``annotate_blocked_textlines`` is allowed to emit on
# ``blockingReasons[*]["semantics"]``. ``viewer.js::renderBlockingReason``
# has a finite branch ladder matching these exact strings; any new value
# emitted here without a corresponding viewer-side branch would render
# as a generic fallback line and (historically) hit a
# ``ReferenceError`` on a typo. Kept as a separate constant from
# ``textline_set.REQUIREMENT_BLOCKING_SEMANTICS`` because that map also
# contains ``"none"`` / ``"count-permissive"`` values that are filtered
# out before reaching ``blockingReasons``.
_VIEWER_KNOWN_SEMANTICS = frozenset({"all", "any", "count-min"})


def _assert_viewer_knows_semantics(reasons: list, textline_name: str) -> None:
    """Fail loud if ``reasons`` contains any semantics value the viewer
    doesn't know how to render.

    Called once per textline that gains a ``blockingReasons`` list, so
    that adding a new semantics branch to ``annotate_blocked_textlines``
    forces the contributor to either add the matching viewer-side
    branch or update ``_VIEWER_KNOWN_SEMANTICS`` (which surfaces the
    drift in code review).
    """
    unknown = {r["semantics"] for r in reasons} - _VIEWER_KNOWN_SEMANTICS
    if unknown:
        raise ValueError(
            f"annotate_blocked_textlines emitted unknown semantics "
            f"{sorted(unknown)} for textline {textline_name!r}. "
            f"viewer.js::renderBlockingReason only handles "
            f"{sorted(_VIEWER_KNOWN_SEMANTICS)}; add the new branch(es) "
            f"there before extending the emit set."
        )


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
            _assert_viewer_knows_semantics(reasons, name)
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


# Per-game section-key allowlists and their friendly-name maps. Future
# Hades II support adds its own tuple here so the audit runs against
# each game's data independently.
_SECTION_KEY_LABEL_SOURCES = [
    ("HADES1", HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_LABELS),
]

# Per-game requirement-type label data. Tuple shape:
#   (game_label, allowed_fields, labels, edge_labels, display_order)
# H1 and H2 use disjoint requirement-field vocabularies (H1: flat
# ``Required.*TextLine.*`` fields; H2: nested ``GameStateRequirements``
# with ``HasAny``/``HasAll``/``Path`` records), so each game contributes
# its own allowlist + maps and the build merges them into a single
# viewer-side lookup. Mirrors ``_SECTION_KEY_LABEL_SOURCES``. Adding H2
# is a one-line append once ``hades2/req_types.py`` and the H2-side
# req-fields allowlist exist.
_REQ_TYPE_LABEL_SOURCES = [
    (
        "HADES1",
        TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT,
        HADES1_REQ_TYPE_LABELS,
        HADES1_REQ_TYPE_EDGE_LABELS,
        HADES1_REQ_TYPE_DISPLAY_ORDER,
    ),
]


def annotate_label_maps(graph_data: dict) -> None:
    """Attach the viewer's friendly-name lookups to the merged graph data
    and audit them against the Python-side allowlists.

    Adds to ``graph_data``:
      - ``reqTypeLabels``: ``{field: human-label}`` for the requirement
        groups shown in the details panel - merged across all games.
      - ``reqTypeEdgeLabels``: ``{field: short-chip-label}`` for the tree
        view edge badges - merged across all games.
      - ``reqTypeOrder``: ordered list of fields used to sort tree
        children into per-type groups - concatenation in game order
        (later games append after earlier ones; duplicates dropped).
      - ``sectionKeyLabels``: ``{key: human-label}`` for the per-game
        union of section-key labels (merged across all games so the
        viewer can do a single lookup regardless of source).

    Audits and prints warnings for:
      - section keys allowlisted in any game's ``*_TEXTLINE_SECTION_KEYS``
        but missing from the corresponding ``*_SECTION_KEY_LABELS`` map
        (would silently fall back to the raw camelCase key);
      - labels defined for keys no longer in the allowlist (stale);
      - requirement fields allowlisted in any game's req-fields
        allowlist but missing from the corresponding
        ``*_REQ_TYPE_LABELS`` map (would silently fall back to the raw
        camelCase field name);
      - req-type labels defined for fields no longer in the allowlist;
      - duplicate field names across two games' req-type maps (the
        merged map would silently last-wins and mask a real conflict
        between disjoint per-game vocabularies).
    """
    merged_section_labels: dict[str, str] = {}
    for game_label, section_keys, labels in _SECTION_KEY_LABEL_SOURCES:
        missing = sorted(audit_section_key_labels(section_keys, labels))
        if missing:
            print(
                f"WARNING: {len(missing)} {game_label} section key(s) "
                f"have no entry in {game_label}_SECTION_KEY_LABELS - "
                f"viewer will fall back to the raw key: {missing}"
            )
        stale = sorted(audit_section_key_labels_stale(section_keys, labels))
        if stale:
            print(
                f"WARNING: {len(stale)} entry(ies) in "
                f"{game_label}_SECTION_KEY_LABELS reference keys that "
                f"are not in {game_label}_TEXTLINE_SECTION_KEYS - "
                f"remove them: {stale}"
            )
        merged_section_labels.update(labels)

    merged_req_labels: dict[str, str] = {}
    merged_req_edge_labels: dict[str, str] = {}
    merged_req_order: list[str] = []
    merged_req_order_seen: set[str] = set()
    for game_label, allowed_fields, labels, edge_labels, display_order in _REQ_TYPE_LABEL_SOURCES:
        # Per-game allowlist vs labels: any allowed field without a
        # friendly header would render as the raw camelCase key in the
        # viewer. The matching equality test in
        # ``tests/hades1/test_section_key_labels.py`` catches this at
        # CI time; this runtime warning is the safety net for any
        # future game whose label map drifts post-merge.
        missing_labels = sorted(audit_req_type_labels(allowed_fields, labels))
        if missing_labels:
            print(
                f"WARNING: {len(missing_labels)} {game_label} req-type "
                f"field(s) have no entry in {game_label}_REQ_TYPE_LABELS - "
                f"viewer will fall back to the raw field name: "
                f"{missing_labels}"
            )
        stale_labels = sorted(audit_req_type_labels_stale(allowed_fields, labels))
        if stale_labels:
            print(
                f"WARNING: {len(stale_labels)} entry(ies) in "
                f"{game_label}_REQ_TYPE_LABELS reference fields that "
                f"are not in the {game_label} req-fields allowlist - "
                f"remove them: {stale_labels}"
            )

        # Per-game vocabularies are expected to be disjoint (H1 and H2
        # use different field names entirely). Warn loudly if any name
        # collides so the silent last-wins merge below doesn't mask a
        # real conflict.
        label_conflicts = sorted(set(labels) & set(merged_req_labels))
        if label_conflicts:
            print(
                f"WARNING: {len(label_conflicts)} {game_label}_REQ_TYPE_LABELS "
                f"entry(ies) conflict with another game's map and will "
                f"be silently overwritten: {label_conflicts}"
            )
        edge_conflicts = sorted(set(edge_labels) & set(merged_req_edge_labels))
        if edge_conflicts:
            print(
                f"WARNING: {len(edge_conflicts)} {game_label}_REQ_TYPE_EDGE_LABELS "
                f"entry(ies) conflict with another game's map and will "
                f"be silently overwritten: {edge_conflicts}"
            )
        order_conflicts = sorted(set(display_order) & merged_req_order_seen)
        if order_conflicts:
            print(
                f"WARNING: {len(order_conflicts)} {game_label}_REQ_TYPE_DISPLAY_ORDER "
                f"entry(ies) already appear in an earlier game's order "
                f"and will be skipped: {order_conflicts}"
            )
        merged_req_labels.update(labels)
        merged_req_edge_labels.update(edge_labels)
        for field in display_order:
            if field not in merged_req_order_seen:
                merged_req_order.append(field)
                merged_req_order_seen.add(field)

    graph_data["reqTypeLabels"] = merged_req_labels
    graph_data["reqTypeEdgeLabels"] = merged_req_edge_labels
    graph_data["reqTypeOrder"] = merged_req_order
    graph_data["sectionKeyLabels"] = merged_section_labels


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


def _ensure_clean_dist() -> None:
    """Remove just the managed split/bundle outputs from ``dist/`` so a
    rebuild can't leave a stale ``data.json`` next to a fresh
    ``index.html``. Unrelated files (e.g. user-dropped screenshots,
    release notes) are preserved."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    for name in (*_SPLIT_OUTPUT_NAMES, _BUNDLE_OUTPUT_NAME):
        target = DIST_DIR / name
        if target.exists():
            target.unlink()


def build_split(graph_data: dict) -> dict:
    """Write the canonical split-build outputs into ``dist/``.

    Returns a dict mapping output name -> file size in bytes, used by
    the caller for reporting and by ``build_bundle`` to inline the same
    artifacts without re-reading the source templates.
    """
    _ensure_clean_dist()

    css_data = build_css()
    js_data = VIEWER_JS_TEMPLATE.read_text(encoding="utf-8")
    index_html = INDEX_TEMPLATE.read_text(encoding="utf-8")
    json_data = json.dumps(graph_data, separators=(",", ":"))

    (DIST_DIR / "index.html").write_text(index_html, encoding="utf-8")
    (DIST_DIR / "viewer.js").write_text(js_data, encoding="utf-8")
    (DIST_DIR / "viewer.css").write_text(css_data, encoding="utf-8")
    (DIST_DIR / "data.json").write_text(json_data, encoding="utf-8")

    sizes = {name: (DIST_DIR / name).stat().st_size for name in _SPLIT_OUTPUT_NAMES}
    print(
        f"Split build -> dist/: "
        f"index.html {sizes['index.html']/1024:.1f} KB, "
        f"viewer.js {sizes['viewer.js']/1024:.1f} KB, "
        f"viewer.css {sizes['viewer.css']/1024:.1f} KB, "
        f"data.json {sizes['data.json']/1024:.0f} KB"
    )
    return sizes


def _inline_data_for_bundle(json_text: str) -> str:
    """Escape a JSON document so it can safely be embedded inside a
    ``<script type="application/json">`` element.

    The HTML tokenizer scans script contents for ``</script>`` (case
    insensitive, partial-match-friendly) to find the end tag and also
    has historical edge cases around ``<!--``, ``<script``, etc.
    Replacing every ``<`` with its ``\\u003C`` JSON escape sidesteps the
    entire family - the JSON parser decodes ``\\u003C`` back to ``<``
    transparently and the HTML tokenizer never sees a literal ``<`` in
    the embedded text.
    """
    return json_text.replace("<", "\\u003C")


def build_bundle(sizes: dict) -> None:
    """Stitch the split outputs into a single ``dialogue_explorer.html``.

    Reads the four ``dist/`` artifacts produced by :func:`build_split`
    and inlines them so the result opens directly from ``file://``.
    ``sizes`` is taken as input rather than re-computed so the report
    line agrees with the split build's own report.
    """
    index_html = (DIST_DIR / "index.html").read_text(encoding="utf-8")
    viewer_js = (DIST_DIR / "viewer.js").read_text(encoding="utf-8")
    viewer_css = (DIST_DIR / "viewer.css").read_text(encoding="utf-8")
    json_text = (DIST_DIR / "data.json").read_text(encoding="utf-8")

    css_link = '<link rel="stylesheet" href="viewer.css">'
    if css_link not in index_html:
        raise RuntimeError(
            f"Bundler expected to find {css_link!r} in index.html but did not. "
            f"templates/index.html may have drifted from the bundler's expectations."
        )
    script_tag = '<script src="viewer.js"></script>'
    if script_tag not in index_html:
        raise RuntimeError(
            f"Bundler expected to find {script_tag!r} in index.html but did not. "
            f"templates/index.html may have drifted from the bundler's expectations."
        )

    inline_css = f"<style>\n{viewer_css}\n</style>"
    inline_data = (
        f'<script type="application/json" id="viewer-data">'
        f'{_inline_data_for_bundle(json_text)}'
        f'</script>'
    )
    inline_js = f"<script>\n{viewer_js}\n</script>"

    bundled = index_html.replace(css_link, inline_css)
    bundled = bundled.replace(script_tag, inline_data + "\n" + inline_js)

    out = DIST_DIR / _BUNDLE_OUTPUT_NAME
    out.write_text(bundled, encoding="utf-8")
    print(f"Bundle build -> {out} ({out.stat().st_size/1024:.0f} KB)")


def _parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Build the HTML viewer in split, bundled, or both forms."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--split", dest="mode", action="store_const", const="split",
        help="Write dist/index.html + viewer.js + viewer.css + data.json (for GH Pages / local HTTP).",
    )
    mode.add_argument(
        "--bundle", dest="mode", action="store_const", const="bundle",
        help="Write dist/dialogue_explorer.html as a single offline-friendly file.",
    )
    mode.add_argument(
        "--all", dest="mode", action="store_const", const="all",
        help="Run --split then --bundle (default).",
    )
    parser.set_defaults(mode="all")
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv if argv is not None else sys.argv[1:])

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
    annotate_label_maps(graph_data)

    print(f"Total: {graph_data['stats']['totalTextlines']} textlines, "
          f"{graph_data['stats']['totalEdges']} edges, "
          f"{len(graph_data['stats']['unresolvedRefs'])} external refs")

    if args.mode in ("split", "all"):
        sizes = build_split(graph_data)
    else:
        sizes = {}

    if args.mode in ("bundle", "all"):
        if args.mode == "bundle":
            # Bundle-only run still needs the split outputs to stitch
            # from; refresh them so we don't bundle stale content.
            sizes = build_split(graph_data)
        build_bundle(sizes)


if __name__ == "__main__":
    main()
