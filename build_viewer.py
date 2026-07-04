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
import base64
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from src.graph_merge import merge_graph_data
from src.known_unresolved import annotate_known_unresolved
from src.blocked_textlines import annotate_blocked_textlines
from src.manual_overrides import apply_manual_overrides
from src.label_maps import annotate_label_maps
from src.section_key_audit import audit_section_keys
from src.speaker_overview import annotate_speaker_aggregates
from src.play_once import annotate_play_once
from src.choice_prompt_text import annotate_choice_prompt_text
from src.extractors.hades2 import HADES2_OFFER_TEXT_MAP

PROJECT_DIR = Path(__file__).parent
TEMPLATES_DIR = PROJECT_DIR / "templates"
INDEX_TEMPLATE = TEMPLATES_DIR / "index.html"
VIEWER_JS_DIR = TEMPLATES_DIR / "viewer"
STYLES_DIR = PROJECT_DIR / "styles"
STATIC_DIR = PROJECT_DIR / "static"
OUTPUT_DIR = PROJECT_DIR / "outputs"
DIST_DIR = PROJECT_DIR / "dist"

# Files written by the split build. Tracked explicitly so the cleaner
# only removes managed artifacts, not anything else the user may have
# dropped in ``dist/`` (e.g. screenshots, release notes).
_SPLIT_OUTPUT_NAMES = ("index.html", "viewer.js", "viewer.css", "data.json")
_BUNDLE_OUTPUT_NAME = "dialogue_explorer.html"

# Static assets copied verbatim into ``dist/`` for the split build and
# inlined as data URIs for the single-file bundle. The per-game favicons
# the viewer swaps between (see ``updateFavicon`` in game-toggle.js).
_STATIC_ASSET_NAMES = ("hades.ico", "hades2.ico")

# Self-hosted IBM Plex woff2 files (styles/fonts.css @font-face rules point at
# ``fonts/<name>.woff2`` relative to viewer.css). Copied into ``dist/fonts/``
# for the split build so they load same-origin under the strict
# ``font-src 'self'`` CSP, and inlined as data: URIs for the single-file bundle
# so it stays self-contained offline. Discovered from disk so adding a weight is
# just dropping the woff2 in and referencing it from fonts.css.
_FONTS_DIR = STATIC_DIR / "fonts"

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

# Build-time "featured" dialogue per game: the viewer lands on it when no
# ``dialogue=`` URL hash key is present (the home / empty state) instead
# of a blank panel, and the onboarding tour anchors its walkthrough on
# the same textline. Pick something early-game and light but with a few
# interesting properties (badges, a requirement or two, up/downstream
# links) so it reads as a good first example without overwhelming.
_DEFAULT_DIALOGUE = {
    "hades2": "HecateBossGrantsWeaponUpgradeSystem01",
}


def build_css() -> str:
    """Read and concatenate all CSS files in order.

    ``responsive.css`` is pinned LAST (after the alphabetical sort) so its
    ``@media`` mobile overrides reliably win the cascade over the desktop
    base rules in every other file - media queries don't add specificity,
    so load order decides equal-specificity ties. Mirrors how ``build_js``
    pins ``init.js`` last.
    """
    css_files = sorted(STYLES_DIR.glob("*.css"))
    if not css_files:
        print("WARNING: No CSS files found in styles/")
        return ""
    responsive = [f for f in css_files if f.name == "responsive.css"]
    css_files = [f for f in css_files if f.name != "responsive.css"] + responsive
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

# Column-0 (top-level) declarations in a stripped viewer module. After
# ``_strip_module_syntax`` removes the ``export `` prefix, a top-level
# ``export function foo`` becomes a column-0 ``function foo``; anything nested
# inside a block is indented, so anchoring at the start of the line isolates the
# bundle's shared-scope top level. One capture group per declaration kind.
_JS_TOP_LEVEL_DECL_RE = re.compile(
    r"^(?:async\s+)?function\s+(\w+)"
    r"|^(?:const|let|var)\s+(\w+)"
    r"|^class\s+(\w+)",
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


def _assert_unique_top_level_names(file_texts: list) -> None:
    """Fail the build if any top-level declaration name appears in more than
    one viewer module.

    ``build_js`` concatenates every ``templates/viewer/*.js`` module into one
    classic (sloppy-mode) script, so all module top levels share a single
    scope. A duplicate top-level ``function`` is legal in sloppy mode and
    silently collapses to the last-concatenated definition, shipping a wrong
    bundle that the unit tests (which import the ES modules in separate scopes)
    and the boot smoke test (which only trips on duplicate ``const`` / ``let``
    / ``class``) cannot see. This guard turns that silent-wrong-bundle class
    into a build-time error naming both modules.

    ``file_texts`` is a list of ``(source_name, stripped_js)`` pairs - the
    already-stripped text is what actually lands in the bundle.
    """
    seen = {}
    for source_name, text in file_texts:
        for match in _JS_TOP_LEVEL_DECL_RE.finditer(text):
            name = match.group(1) or match.group(2) or match.group(3)
            line_no = text.count("\n", 0, match.start()) + 1
            where = f"{source_name}:{line_no}"
            if name in seen:
                raise RuntimeError(
                    f"Duplicate top-level name {name!r} in the concatenated "
                    f"viewer bundle: first at {seen[name]}, again at {where}. "
                    f"Every top-level function/const/let/var/class name must be "
                    f"globally unique across templates/viewer/*.js because the "
                    f"build concatenates them into one classic-script scope - a "
                    f"duplicate silently shadows (last-declared wins). Rename "
                    f"one of the declarations."
                )
            seen[name] = where


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

    stripped = []
    for js_file in ordered:
        source_name = (
            str(js_file.relative_to(PROJECT_DIR))
            if js_file.is_relative_to(PROJECT_DIR)
            else js_file.name
        )
        stripped.append(
            (
                source_name,
                _strip_module_syntax(
                    js_file.read_text(encoding="utf-8"),
                    source_name=source_name,
                ).strip(),
            )
        )

    _assert_unique_top_level_names(stripped)

    parts = []
    for (source_name, text), js_file in zip(stripped, ordered):
        parts.append(f"// --- {js_file.name} ---")
        parts.append(text)
    return "\n\n".join(parts) + "\n"


def _ensure_clean_dist() -> None:
    """Remove just the managed split/bundle outputs from ``dist/`` so a
    rebuild can't leave a stale ``data.json`` next to a fresh
    ``index.html``. Unrelated files (e.g. user-dropped screenshots,
    release notes) are preserved."""
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    for name in (*_SPLIT_OUTPUT_NAMES, _BUNDLE_OUTPUT_NAME, *_STATIC_ASSET_NAMES):
        target = DIST_DIR / name
        if target.exists():
            target.unlink()
    # Per-game data files have dynamic names (``data-<gameId>.json``); remove
    # any from a previous build so a renamed/removed game can't leave a stale
    # blob behind.
    for stale in DIST_DIR.glob("data-*.json"):
        stale.unlink()


def build_split(payload: dict) -> dict:
    """Write the canonical split-build outputs into ``dist/``.

    ``payload`` is the per-game-bundled dict produced by :func:`main`
    (``{games: {hades1: {...}, hades2: {...}}, defaultGame, gameLabels}``).

    The heavy per-game graphs are written as separate ``data-<gameId>.json``
    files and the entry-point ``data.json`` is a small meta document that lists
    them plus the cross-game UI hints. This lets the viewer load the active
    game first (unblocking interactivity) and stream the rest in the
    background, instead of shipping every game in one blocking payload.

    Returns a dict mapping output name -> file size in bytes, used by
    the caller for reporting and by ``build_bundle`` to inline the same
    artifacts without re-reading the source templates.
    """
    _ensure_clean_dist()

    css_data = build_css()
    js_data = build_js()

    games = payload.get("games", {})
    # Heavy per-game blobs, one file each.
    per_game_json = {
        gid: json.dumps(blob, separators=(",", ":")) for gid, blob in games.items()
    }
    # Small meta entry point: everything the viewer needs to render the toggle
    # and the cross-game duplicates view before (or without) the per-game blobs.
    meta = {
        "gameIds": list(games.keys()),
        "gameLabels": payload.get("gameLabels", {}),
        "defaultGame": payload.get("defaultGame"),
        "defaultDialogue": payload.get("defaultDialogue", {}),
        "duplicates": payload.get("duplicates", []),
    }
    meta_json = json.dumps(meta, separators=(",", ":"))

    # Cache-busting: a short content hash appended to the asset URLs so a
    # plain browser refresh always fetches a changed build instead of serving a
    # stale viewer.js / viewer.css / data file. The hash covers every artifact
    # (js, css, meta, and each per-game blob in a stable order), so any change
    # bumps the version. The token is exposed via the ``viewer-version`` meta
    # tag so the split-build data fetches (init.js) bust their own cache too.
    hash_src = js_data + css_data + meta_json + "".join(
        per_game_json[gid] for gid in sorted(per_game_json)
    )
    version = hashlib.sha256(hash_src.encode("utf-8")).hexdigest()[:10]
    # Content-Security-Policy for the hosted (web) build only - the offline
    # single-file bundle is opened via file://, where a 'self' policy misfires,
    # so the bundler path deliberately omits this. GitHub Pages can't set HTTP
    # headers, so it goes in a <meta>. 'unsafe-inline' is required by the
    # pre-paint inline scripts and the generated inline onclick/style handlers;
    # the policy still blocks external script loading, eval, plugins and <base>
    # hijacking. (frame-ancestors / X-Frame-Options aren't honoured via <meta>,
    # so framing can't be restricted here.)
    csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'none'"
    )
    index_html = (
        INDEX_TEMPLATE.read_text(encoding="utf-8")
        .replace('href="viewer.css"', f'href="viewer.css?v={version}"')
        .replace('src="viewer.js"', f'src="viewer.js?v={version}"')
        .replace(
            '<meta name="viewer-version" content="">',
            f'<meta http-equiv="Content-Security-Policy" content="{csp}">\n'
            f'    <meta name="viewer-version" content="{version}">',
        )
    )

    (DIST_DIR / "index.html").write_text(index_html, encoding="utf-8")
    (DIST_DIR / "viewer.js").write_text(js_data, encoding="utf-8")
    (DIST_DIR / "viewer.css").write_text(css_data, encoding="utf-8")
    (DIST_DIR / "data.json").write_text(meta_json, encoding="utf-8")
    for gid, blob_json in per_game_json.items():
        (DIST_DIR / f"data-{gid}.json").write_text(blob_json, encoding="utf-8")

    # Copy the per-game favicons verbatim (referenced by relative path in
    # the split build's index.html).
    for name in _STATIC_ASSET_NAMES:
        shutil.copyfile(STATIC_DIR / name, DIST_DIR / name)

    # Copy the self-hosted fonts into dist/fonts/ (referenced by fonts.css as
    # ``fonts/<name>.woff2`` relative to viewer.css). Copy per-file with
    # overwrite and prune only stale ``*.woff2`` - removing the whole directory
    # is lock-prone on Windows (an open browser tab or OneDrive sync can hold a
    # woff2 handle), and would fail the build for a cosmetic clean.
    dist_fonts = DIST_DIR / "fonts"
    if _FONTS_DIR.exists():
        dist_fonts.mkdir(parents=True, exist_ok=True)
        wanted = set()
        for font in sorted(_FONTS_DIR.glob("*.woff2")):
            shutil.copyfile(font, dist_fonts / font.name)
            wanted.add(font.name)
        for stale in dist_fonts.glob("*.woff2"):
            if stale.name not in wanted:
                stale.unlink()

    sizes = {name: (DIST_DIR / name).stat().st_size for name in _SPLIT_OUTPUT_NAMES}
    game_sizes = {
        gid: (DIST_DIR / f"data-{gid}.json").stat().st_size for gid in per_game_json
    }
    game_report = ", ".join(
        f"data-{gid}.json {size/1024:.0f} KB" for gid, size in game_sizes.items()
    )
    print(
        f"Split build -> dist/: "
        f"index.html {sizes['index.html']/1024:.1f} KB, "
        f"viewer.js {sizes['viewer.js']/1024:.1f} KB, "
        f"viewer.css {sizes['viewer.css']/1024:.1f} KB, "
        f"data.json (meta) {sizes['data.json']/1024:.0f} KB, "
        f"{game_report}"
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


def build_bundle(payload: dict) -> None:
    """Stitch the split outputs into a single ``dialogue_explorer.html``.

    Reads the viewer.js / viewer.css artifacts produced by :func:`build_split`
    and inlines them, along with the *full* multi-game ``payload`` (the split
    build's ``data.json`` is only a meta index now, so the bundle inlines every
    game's data instead), so the result opens directly from ``file://`` with no
    network fetches.
    """
    # Read the *template* (not dist/index.html, which build_split has
    # rewritten with cache-busting query strings) so the exact-match inlining
    # below still finds the un-versioned ``viewer.css`` / ``viewer.js`` refs.
    # A single-file bundle has nothing to cache-bust anyway.
    index_html = INDEX_TEMPLATE.read_text(encoding="utf-8")
    viewer_js = (DIST_DIR / "viewer.js").read_text(encoding="utf-8")
    viewer_css = (DIST_DIR / "viewer.css").read_text(encoding="utf-8")
    # The bundle ships every game inline (no background loading), so embed the
    # whole payload rather than the split build's meta-only data.json.
    json_text = json.dumps(payload, separators=(",", ":"))

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

    # Inline the per-game favicons as data URIs so the single-file bundle
    # stays self-contained (no sidecar .ico files needed to open it from
    # ``file://``). The viewer's ``updateFavicon`` reads the ``data-<game>``
    # attributes, so swapping these to data URIs keeps game-switching
    # working in the bundle exactly as in the split build.
    favicon_uris = {
        name: "data:image/x-icon;base64,"
        + base64.b64encode((STATIC_DIR / name).read_bytes()).decode("ascii")
        for name in _STATIC_ASSET_NAMES
    }
    bundled = bundled.replace('href="hades2.ico"', f'href="{favicon_uris["hades2.ico"]}"')
    bundled = bundled.replace('data-hades1="hades.ico"', f'data-hades1="{favicon_uris["hades.ico"]}"')
    bundled = bundled.replace('data-hades2="hades2.ico"', f'data-hades2="{favicon_uris["hades2.ico"]}"')

    # Inline the self-hosted fonts as data: URIs so the bundle needs no sidecar
    # fonts/ directory (the split build's ``url("fonts/<name>.woff2")`` refs
    # would 404 from file://). Mirrors the favicon inlining above.
    if _FONTS_DIR.exists():
        for font in sorted(_FONTS_DIR.glob("*.woff2")):
            data_uri = (
                "data:font/woff2;base64,"
                + base64.b64encode(font.read_bytes()).decode("ascii")
            )
            bundled = bundled.replace(f'url("fonts/{font.name}")', f'url({data_uri})')

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

    # Route every game through merge_graph_data, including the single-dataset
    # case, so they share the same post-processing (split_name_collisions +
    # dependents/alternates re-index). build_graph_data alone does not split
    # name collisions, so a one-source game would otherwise diverge from the
    # merged path. No game hits the single-source case today (H1/H2 both ship
    # many sources), but a future single-source game would behave consistently.
    if len(regular) > 1:
        print(f"  Merging {len(regular)} datasets for {game}...")
    graph_data = merge_graph_data(regular)

    for meta in metadata:
        for key, value in meta.items():
            graph_data[key] = value

    # Curated edge-case corrections, applied before every annotation step
    # so aggregates / audits see the corrected values.
    apply_manual_overrides(graph_data, game)

    # Fold the self-negative play-once idiom into the ``playOnce`` flag
    # before the aggregates / eligibility consumers read it.
    annotate_play_once(graph_data)

    # Resolve H2 choice-prompt cue text ids (e.g. ``Choice_NemesisBecomingCloser01``)
    # to their display text. A no-op for H1 (its prompts are resolved at
    # extraction and its ids aren't in the H2 map).
    annotate_choice_prompt_text(
        graph_data, HADES2_OFFER_TEXT_MAP if game == "hades2" else {}
    )

    annotate_known_unresolved(graph_data, game)
    annotate_blocked_textlines(graph_data)
    annotate_label_maps(graph_data, game)
    audit_section_keys(graph_data, game)
    annotate_speaker_aggregates(graph_data)

    return graph_data


def _compute_cross_game_duplicates(games_payload):
    """Find textline names that exist in both games.

    Returns a sorted list of dicts, one per duplicate name::

        {"name": "...", "hades1": {"owner": "...", "section": "..."},
                        "hades2": {"owner": "...", "section": "..."},
         "speaker": "..."}

    ``speaker`` is the friendly display name for the master-list buttons,
    resolved here so the duplicates view (which renders from the meta payload,
    before/without the per-game blobs) never falls back to the raw owner id.

    Returns an empty list when fewer than two games are loaded (the
    feature only makes sense with a cross-game comparison).
    """
    if len(games_payload) < 2:
        return []
    game_ids = sorted(games_payload.keys())
    if len(game_ids) != 2:
        return []
    g1, g2 = game_ids
    tl1 = games_payload[g1].get("textlines", {})
    tl2 = games_payload[g2].get("textlines", {})
    sp1 = games_payload[g1].get("speakers", {})
    sp2 = games_payload[g2].get("speakers", {})
    shared = sorted(set(tl1) & set(tl2))
    results = []
    for name in shared:
        entry = {"name": name}
        for gid, tls in ((g1, tl1), (g2, tl2)):
            tl = tls[name]
            entry[gid] = {
                "owner": tl.get("owner", ""),
                "section": tl.get("section", ""),
            }
        # Prefer the first game's speaker name as canonical, then the second,
        # then the raw owner id if neither game resolves a friendly name.
        o1 = entry[g1]["owner"]
        o2 = entry[g2]["owner"]
        entry["speaker"] = (
            sp1.get(o1, {}).get("name")
            or sp2.get(o2, {}).get("name")
            or o1
            or o2
        )
        results.append(entry)
    return results


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

    # Validate the configured featured dialogues exist so a typo surfaces
    # at build time rather than as a silently-blank home state.
    for _gid, _name in _DEFAULT_DIALOGUE.items():
        if _gid in games_payload and _name not in games_payload[_gid]["textlines"]:
            raise RuntimeError(
                f"_DEFAULT_DIALOGUE[{_gid!r}] = {_name!r} is not a textline "
                f"in that game's data. Fix the name in build_viewer.py."
            )

    # Cross-game duplicate detection: textline names that appear in
    # both games. These are surfaced in a dedicated viewer page so
    # modders can identify naming collisions when porting content.
    duplicates = _compute_cross_game_duplicates(games_payload)
    if duplicates:
        print(f"\nCross-game duplicates: {len(duplicates)} textline names appear in both games")

    # Final wire-up: a single payload with both games' graphs plus the
    # UI hints (default game + display labels) the viewer needs to
    # render the toggle. Per-game graphs keep the same shape they had
    # in the H1-only era, so all the existing per-game render code is
    # unchanged - the viewer just swaps which game's blob feeds its
    # let bindings on toggle.
    payload = {
        "games": games_payload,
        "defaultGame": _DEFAULT_GAME,
        "defaultDialogue": {
            g: n for g, n in _DEFAULT_DIALOGUE.items() if g in games_payload
        },
        "gameLabels": {gid: _GAME_LABELS[gid] for gid in games_payload},
        "duplicates": duplicates,
    }

    if args.mode in ("split", "all"):
        build_split(payload)

    if args.mode in ("bundle", "all"):
        if args.mode == "bundle":
            # Bundle-only run still needs the split outputs to stitch
            # from; refresh them so we don't bundle stale content.
            build_split(payload)
        build_bundle(payload)


if __name__ == "__main__":
    main()
