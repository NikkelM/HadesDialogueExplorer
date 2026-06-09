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

The merge + annotation passes live in ``src/`` so this file stays focused
on CLI parsing and output writing:

  - ``src/graph_merge.py``       merge per-source datasets into one graph
  - ``src/known_unresolved.py``  categorize unresolved refs
  - ``src/blocked_textlines.py`` flag dialogues that can never play
  - ``src/label_maps.py``        wire viewer-side friendly-name lookups

The viewer JS lives as ES modules under ``templates/viewer/*.js`` for
clean cross-file analysis (ESLint, IDE jump-to-definition). Those
modules are concatenated into a single classic ``dist/viewer.js`` here
because the offline bundle runs from ``file://`` where browsers block
real ES module imports.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from src.graph_merge import merge_graph_data
from src.known_unresolved import annotate_known_unresolved
from src.blocked_textlines import annotate_blocked_textlines
from src.label_maps import annotate_label_maps

PROJECT_DIR = Path(__file__).parent
TEMPLATES_DIR = PROJECT_DIR / "templates"
INDEX_TEMPLATE = TEMPLATES_DIR / "index.html"
VIEWER_JS_DIR = TEMPLATES_DIR / "viewer"
STYLES_DIR = PROJECT_DIR / "styles"
OUTPUT_DIR = PROJECT_DIR / "outputs"
DIST_DIR = PROJECT_DIR / "dist"

# Files written by the split build. Tracked explicitly so the cleaner
# only removes managed artifacts, not anything else the user may have
# dropped in ``dist/`` (e.g. screenshots, release notes).
_SPLIT_OUTPUT_NAMES = ("index.html", "viewer.js", "viewer.css", "data.json")
_BUNDLE_OUTPUT_NAME = "dialogue_explorer.html"


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


# Single-line ``import { a, b } from './foo.js';`` blocks - the only
# import shape used in templates/viewer/*.js.
_JS_IMPORT_RE = re.compile(
    r"^\s*import\s*\{[^}]*\}\s*from\s*['\"][^'\"]+['\"]\s*;?\s*$",
    re.MULTILINE,
)

# ``export function|const|let|async function|class ...`` declarations.
# The leading whitespace is preserved so indentation stays consistent
# after the keyword is removed.
_JS_EXPORT_RE = re.compile(
    r"^(\s*)export\s+(?=(?:async\s+)?(?:function|const|let|class)\s)",
    re.MULTILINE,
)


def _strip_module_syntax(js_text: str) -> str:
    """Strip ES module ``import``/``export`` syntax so the file can be
    concatenated into a single classic browser script.

    Sources under ``templates/viewer/`` use ES module syntax purely so
    ESLint can validate cross-file references. The deployed artifact
    is one concatenated script (``dist/viewer.js``) because the offline
    bundle runs from ``file://`` where browsers block ES module imports
    via CORS.
    """
    js_text = _JS_IMPORT_RE.sub("", js_text)
    js_text = _JS_EXPORT_RE.sub(r"\1", js_text)
    return js_text


def build_js() -> str:
    """Concatenate every ``templates/viewer/*.js`` module into a single
    classic script.

    Files are sorted alphabetically with ``init.js`` pinned to the end.
    The pinning matters because ``init.js`` ends with a top-level
    ``boot()`` call, and ``boot()`` synchronously calls into
    ``loadData()`` which assigns to the ``let`` bindings declared in
    ``data.js`` and other modules. Those bindings are in TDZ until
    their textual declaration is reached, so the call site has to come
    after every declaration. Function declarations hoist so their
    ordering doesn't matter.

    Module syntax is stripped so the result runs as a plain script in
    any browser, including from ``file://`` (the offline bundle case,
    where browsers block real ES module imports via CORS).
    """
    js_files = sorted(VIEWER_JS_DIR.glob("*.js"))
    if not js_files:
        raise RuntimeError(f"No viewer JS modules found in {VIEWER_JS_DIR}")
    init_files = [f for f in js_files if f.name == "init.js"]
    if not init_files:
        raise RuntimeError(
            f"Expected {VIEWER_JS_DIR / 'init.js'} (must contain the "
            f"top-level boot() call); not found."
        )
    other_files = [f for f in js_files if f.name != "init.js"]
    ordered = other_files + init_files

    parts = []
    for js_file in ordered:
        parts.append(f"// --- {js_file.name} ---")
        parts.append(_strip_module_syntax(js_file.read_text(encoding="utf-8")).strip())
    return "\n\n".join(parts) + "\n"


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
    js_data = build_js()
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
