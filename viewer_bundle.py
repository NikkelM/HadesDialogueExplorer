"""Assemble the viewer's ES-module sources into a single classic browser
script (``dist/viewer.js``) and build its Source Map.

Sources under ``templates/viewer/`` use ES module syntax purely so ESLint can
validate cross-file references; the deployed artifact is one concatenated
classic script because the offline bundle runs from ``file://`` where browsers
block ES module imports. Split out of ``build_viewer.py`` so this stripping /
assembly / source-map logic is a cohesive, independently testable unit.

Public API: :func:`build_js`, :func:`assemble_viewer_js`, :func:`build_source_map`.
"""
import difflib
import json
import re
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
VIEWER_JS_DIR = PROJECT_DIR / "templates" / "viewer"


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
    return assemble_viewer_js()[0]


def _ordered_viewer_js_files() -> list:
    """The viewer JS modules in concatenation order: alphabetical with
    ``init.js`` pinned last (see :func:`build_js` for why the boot call must
    come after every declaration)."""
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
    return other_files + init_files


def _strip_export_prefix_line(line: str) -> str:
    """Apply the single-line ``export `` prefix strip to one line (the same
    transform :data:`_JS_EXPORT_RE` applies across the whole module). Used to
    normalise raw lines when aligning them to the stripped output."""
    return _JS_EXPORT_RE.sub(r"\1", line)


def _stripped_line_to_raw(raw_text: str, stripped_text: str) -> list:
    """Map each line of a module's stripped output back to its 0-based line in
    the raw source.

    ``_strip_module_syntax`` only deletes whole ``import`` lines and removes
    ``export `` prefixes in place, so the stripped lines are a pure subsequence
    of the raw lines after export-normalisation. A ``difflib`` alignment over
    those two line lists therefore recovers an exact stripped->raw line map
    (used to build the source map)."""
    raw_norm = [_strip_export_prefix_line(ln) for ln in raw_text.split("\n")]
    stripped_lines = stripped_text.split("\n")
    mapping = [None] * len(stripped_lines)
    sm = difflib.SequenceMatcher(a=raw_norm, b=stripped_lines, autojunk=False)
    for tag, a1, a2, b1, b2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(b2 - b1):
                mapping[b1 + k] = a1 + k
    return mapping


def assemble_viewer_js():
    """Concatenate the viewer modules and record per-line provenance.

    Returns ``(js_text, blocks)`` where each block is
    ``{"source_name", "raw_text", "text_line_start", "line_to_raw"}``:

    * ``source_name`` - repo-relative path used as the source-map ``sources``
      entry (and keyed to ``raw_text`` for ``sourcesContent``).
    * ``text_line_start`` - 0-based line index in ``js_text`` where this
      module's stripped body begins (after its ``// --- name ---`` header).
    * ``line_to_raw`` - per body line, the 0-based raw source line it came
      from (or ``None`` for a line the alignment couldn't place).

    The concatenation is byte-identical to the historical ``"\\n\\n".join``
    assembly (asserted in :func:`build_source_map`), so adding the source map
    never changes the shipped ``viewer.js`` bytes.
    """
    ordered = _ordered_viewer_js_files()
    prepared = []
    for js_file in ordered:
        source_name = (
            js_file.relative_to(PROJECT_DIR).as_posix()
            if js_file.is_relative_to(PROJECT_DIR)
            else js_file.name
        )
        raw_text = js_file.read_text(encoding="utf-8")
        stripped = _strip_module_syntax(raw_text, source_name=source_name)
        text = stripped.strip()
        prepared.append((js_file, source_name, raw_text, stripped, text))

    _assert_unique_top_level_names([(sn, text) for _f, sn, _r, _s, text in prepared])

    out_lines = []
    blocks = []
    for idx, (js_file, source_name, raw_text, stripped, text) in enumerate(prepared):
        if idx > 0:
            out_lines.append("")  # blank separator (the historical "\n\n" join)
        out_lines.append(f"// --- {js_file.name} ---")
        out_lines.append("")  # blank line between header and body
        text_line_start = len(out_lines)

        stripped_to_raw = _stripped_line_to_raw(raw_text, stripped)
        # ``.strip()`` drops leading whitespace-only lines; the first body line
        # is stripped line ``lead``. Body line i == stripped line (lead + i).
        lead = len(stripped) - len(stripped.lstrip("\n"))
        lead = stripped[:lead].count("\n")
        line_to_raw = []
        for i in range(len(text.split("\n"))):
            si = lead + i
            line_to_raw.append(stripped_to_raw[si] if si < len(stripped_to_raw) else None)

        out_lines.extend(text.split("\n"))
        blocks.append({
            "source_name": source_name,
            "raw_text": raw_text,
            "text_line_start": text_line_start,
            "line_to_raw": line_to_raw,
        })

    js_text = "\n".join(out_lines) + "\n"
    return js_text, blocks


# Base64 alphabet for source-map VLQ segments (RFC-style; not standard base64
# padding).
_VLQ_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def _vlq_encode(value: int) -> str:
    """Base64 VLQ-encode a signed integer (Source Map v3 ``mappings`` field)."""
    vlq = (-value << 1) | 1 if value < 0 else value << 1
    out = ""
    while True:
        digit = vlq & 0x1F
        vlq >>= 5
        if vlq:
            digit |= 0x20
        out += _VLQ_B64[digit]
        if not vlq:
            break
    return out


def build_source_map(js_text: str, blocks: list, source_file: str) -> str:
    """Build a Source Map v3 JSON string for the concatenated ``viewer.js``.

    Maps each generated body line back to its original
    ``templates/viewer/<module>.js`` line (column 0 - line granularity is what
    browser stack traces report), and inlines each module's source via
    ``sourcesContent`` so the map resolves regardless of how the host serves the
    original files. ``js_text`` / ``blocks`` come from :func:`assemble_viewer_js`.
    """
    sources = [b["source_name"] for b in blocks]
    sources_content = [b["raw_text"] for b in blocks]
    total_lines = js_text.count("\n")  # generated lines (trailing "\n" terminates the last)

    # Per generated line: (source_index, source_line) or None (unmapped).
    per_line = [None] * (total_lines + 1)
    for src_idx, block in enumerate(blocks):
        start = block["text_line_start"]
        for i, raw_line in enumerate(block["line_to_raw"]):
            if raw_line is not None and start + i < len(per_line):
                per_line[start + i] = (src_idx, raw_line)

    segments = []
    prev_src, prev_src_line = 0, 0
    for mapping in per_line:
        if mapping is None:
            segments.append("")
            continue
        src_idx, src_line = mapping
        seg = (
            _vlq_encode(0)  # generated column (line-level: always 0)
            + _vlq_encode(src_idx - prev_src)
            + _vlq_encode(src_line - prev_src_line)
            + _vlq_encode(0)  # source column
        )
        segments.append(seg)
        prev_src, prev_src_line = src_idx, src_line

    return json.dumps({
        "version": 3,
        "file": source_file,
        "sourceRoot": "",
        "sources": sources,
        "sourcesContent": sources_content,
        "names": [],
        "mappings": ";".join(segments),
    }, separators=(",", ":"))
