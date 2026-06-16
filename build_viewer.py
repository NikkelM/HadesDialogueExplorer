"""
Build the final HTML viewer by combining all JSON datasets in ``outputs/``
with the HTML template.

The viewer is **strictly per-game**: H1 and H2 are loaded as two
entirely separate datasets and the UI toggles between them. They are
never merged, unioned, or otherwise conflated at any layer (data,
labels, indices, render). Each input JSON in ``outputs/`` carries a
``source`` field ("Hades 1" / "Hades 2") used to route it to the right
game bucket; the merge + annotation pipeline runs once per bucket.

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
from src.speaker_overview import annotate_speaker_aggregates

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

# Map each per-source JSON filename prefix to the canonical game id
# used as a key in the final ``games`` map and in the URL hash. The
# prefix is the canonical routing signal - ``generate_data.py`` writes
# every output as ``{prefix}*.json`` and the prefix uniquely identifies
# which game's pipeline produced the file (vs. sniffing the ``source``
# field on a textline, which doesn't work for files that contain no
# textlines, like H2 encounter files that only hold VoiceLines).
_FILENAME_PREFIX_TO_GAME = (
    ("hades1_", "hades1"),
    ("hades2_", "hades2"),
)

# Display labels for the game toggle UI. Order is preserved by the
# viewer's toggle renderer (so swapping the order here swaps the
# button order).
_GAME_LABELS = {
    "hades1": "Hades",
    "hades2": "Hades II",
}

# Default game shown when no ``game=`` URL hash key is present. Kept as
# a top-level constant so the choice is one obvious edit away from the
# build entry point.
_DEFAULT_GAME = "hades2"


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

# Post-strip safety net: any line whose first non-whitespace token is
# ``import`` or ``export`` indicates the strip pass missed a module-
# syntax shape (e.g. ``export default``, ``export *``, ``export {name}
# from ...``, ``import *``, ``import name``). The concatenated bundle
# would throw ``SyntaxError`` at script-eval time, so we raise here
# with a precise file:line pointer instead.
_JS_LEFTOVER_MODULE_KEYWORD_RE = re.compile(
    r"^\s*(?:import|export)\b",
    re.MULTILINE,
)


def _strip_module_syntax(js_text: str, source_name: str = "<viewer module>") -> str:
    """Strip ES module ``import``/``export`` syntax so the file can be
    concatenated into a single classic browser script.

    Sources under ``templates/viewer/`` use ES module syntax purely so
    ESLint can validate cross-file references. The deployed artifact
    is one concatenated script (``dist/viewer.js``) because the offline
    bundle runs from ``file://`` where browsers block ES module imports
    via CORS.

    After stripping, the result is asserted to contain no remaining
    top-level ``import``/``export`` keywords. The strip regexes only
    cover the shapes used today (single-line ``import { ... } from`` and
    ``export {function|const|let|class}``); anything else (``export
    default``, ``export *``, ``export { name } from ...``, ``import *``,
    ``import name``) would otherwise pass through verbatim and produce a
    ``SyntaxError`` at script-eval time of the concatenated bundle. The
    assertion turns that runtime failure into a build-time error with a
    pointer to the offending module.
    """
    js_text = _JS_IMPORT_RE.sub("", js_text)
    js_text = _JS_EXPORT_RE.sub(r"\1", js_text)
    leftover = _JS_LEFTOVER_MODULE_KEYWORD_RE.search(js_text)
    if leftover is not None:
        line_no = js_text.count("\n", 0, leftover.start()) + 1
        line_text = js_text.splitlines()[line_no - 1].rstrip()
        raise RuntimeError(
            f"{source_name}:{line_no}: leftover ES module keyword after strip pass: "
            f"{line_text!r}. _JS_IMPORT_RE / _JS_EXPORT_RE only cover the shapes used "
            f"by templates/viewer/*.js today (single-line ``import {{ ... }} from`` and "
            f"``export {{function|const|let|class}}``). Extend the regexes to cover the "
            f"new shape, or rewrite the module to use a supported one."
        )
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

    The same TDZ trap applies to top-level ``const`` declarations:
    invoking a function whose body dereferences a later-declared
    ``const`` from an earlier-concatenated file throws
    ``ReferenceError`` at script-eval time and prevents ``boot()``
    from ever running. Avoid cross-file top-level calls at module
    init - keep module top levels free of work that reaches into
    later-concatenated files.

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
        parts.append(
            _strip_module_syntax(
                js_file.read_text(encoding="utf-8"),
                source_name=str(js_file.relative_to(PROJECT_DIR)) if js_file.is_relative_to(PROJECT_DIR) else js_file.name,
            ).strip()
        )
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


def build_split(payload: dict) -> dict:
    """Write the canonical split-build outputs into ``dist/``.

    ``payload`` is the per-game-bundled dict produced by :func:`main`
    (``{games: {hades1: {...}, hades2: {...}}, defaultGame, gameLabels}``).

    Returns a dict mapping output name -> file size in bytes, used by
    the caller for reporting and by ``build_bundle`` to inline the same
    artifacts without re-reading the source templates.
    """
    _ensure_clean_dist()

    css_data = build_css()
    js_data = build_js()
    index_html = INDEX_TEMPLATE.read_text(encoding="utf-8")
    json_data = json.dumps(payload, separators=(",", ":"))

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


def _route_dataset(json_name: str) -> str:
    """Return the canonical game id for a per-source JSON dataset based
    on its filename prefix.

    ``generate_data.py`` emits every output as ``{prefix}*.json`` where
    the prefix uniquely identifies which game's pipeline produced the
    file. Any unknown prefix is a hard error because silently dropping
    a dataset on the floor would manifest as a mystery missing-textlines
    bug in the viewer rather than a build failure.
    """
    for prefix, game in _FILENAME_PREFIX_TO_GAME:
        if json_name.startswith(prefix):
            return game
    raise RuntimeError(
        f"{json_name}: cannot route dataset - no entry in "
        f"_FILENAME_PREFIX_TO_GAME ({[p for p, _ in _FILENAME_PREFIX_TO_GAME]!r}). "
        f"Add the new prefix to build_viewer.py."
    )


def _build_game(game: str, datasets: list[dict]) -> dict:
    """Run the full merge + annotation pipeline for one game's datasets.

    Metadata-only datasets (no ``textlines`` key) are peeled off before
    merging and their top-level fields are attached to the resulting
    ``graph_data``. This is the channel used by ``hades2_metadata.json``
    to ship registry tables (``gameDataRefs``) alongside the textline
    data without going through ``merge_graph_data`` (which only
    preserves ``textlines`` / ``dependents`` / ``speakers`` / ``stats``).
    """
    metadata = [d for d in datasets if "textlines" not in d]
    regular = [d for d in datasets if "textlines" in d]

    if not regular:
        raise RuntimeError(
            f"{game}: no datasets with a 'textlines' key - cannot build graph data."
        )

    if len(regular) == 1:
        graph_data = regular[0]
    else:
        print(f"  Merging {len(regular)} datasets for {game}...")
        graph_data = merge_graph_data(regular)

    for meta in metadata:
        for key, value in meta.items():
            graph_data[key] = value

    annotate_known_unresolved(graph_data, game)
    annotate_blocked_textlines(graph_data)
    annotate_label_maps(graph_data, game)
    annotate_speaker_aggregates(graph_data)

    return graph_data


def main(argv=None):
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    json_files = sorted(OUTPUT_DIR.glob("*.json"))
    if not json_files:
        print("ERROR: No JSON files found in outputs/. Run generate_data.py first.")
        sys.exit(1)

    # Route every per-source JSON to its game bucket. The pipeline then
    # runs independently per bucket so cross-game name collisions
    # cannot ever conflate textlines or speakers.
    datasets_by_game: dict[str, list[dict]] = {}
    for json_file in json_files:
        print(f"Loading: {json_file.name}")
        game = _route_dataset(json_file.name)
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        datasets_by_game.setdefault(game, []).append(data)

    games_payload: dict[str, dict] = {}
    for game in sorted(datasets_by_game):
        print(f"\n=== {game} ===")
        graph_data = _build_game(game, datasets_by_game[game])
        stats = graph_data["stats"]
        print(
            f"  Total: {stats['totalTextlines']} textlines, "
            f"{stats['totalEdges']} edges, "
            f"{len(stats['unresolvedRefs'])} external refs"
        )
        games_payload[game] = graph_data

    if _DEFAULT_GAME not in games_payload:
        raise RuntimeError(
            f"Default game {_DEFAULT_GAME!r} has no datasets in outputs/. "
            f"Either generate its sources or change _DEFAULT_GAME in "
            f"build_viewer.py."
        )

    # Final wire-up: a single payload with both games' graphs plus the
    # UI hints (default game + display labels) the viewer needs to
    # render the toggle. Per-game graphs keep the same shape they had
    # in the H1-only era, so all the existing per-game render code is
    # unchanged - the viewer just swaps which game's blob feeds its
    # let bindings on toggle.
    payload = {
        "games": games_payload,
        "defaultGame": _DEFAULT_GAME,
        "gameLabels": {gid: _GAME_LABELS[gid] for gid in games_payload},
    }

    if args.mode in ("split", "all"):
        sizes = build_split(payload)
    else:
        sizes = {}

    if args.mode in ("bundle", "all"):
        if args.mode == "bundle":
            # Bundle-only run still needs the split outputs to stitch
            # from; refresh them so we don't bundle stale content.
            sizes = build_split(payload)
        build_bundle(sizes)


if __name__ == "__main__":
    main()
