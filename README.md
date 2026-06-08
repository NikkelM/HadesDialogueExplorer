# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Browse NPC dialogue from Hades 1
- Visualise prerequisite chains as interactive trees, with upstream prerequisites and downstream dependents in separate panels
- Read dialogue text with speaker attribution
- Use the hosted viewer online, or download a single self-contained HTML file for offline use

## Using the viewer

- **Search** - type a textline name in the search bar
- **Click** a tree node - expands/collapses children and shows details
- **Double-click** a tree node - navigates to it (refocuses the tree)
- **⤴ button** - appears on hover, navigates to that dialogue
- **Details panel** - shows dialogue text, requirements, and metadata

## Development Setup

1. Copy `config.example.toml` to `config.toml` in the repo root.
2. Edit `config.toml` so `paths.hades1_scripts` points at your local Hades install's `Scripts` directory.
   `config.toml` is git-ignored.
3. On Python < 3.11, `pip install -r requirements.txt` for the TOML parser (`tomli`).
   On 3.11+ this is a no-op.

## Building locally

```bash
python generate_data.py            # parse Lua sources -> outputs/*.json
python build_viewer.py             # build viewer -> dist/ (split + bundle)
```

Useful build flags:

- `python build_viewer.py --split` - split build only (GH Pages / local HTTP)
- `python build_viewer.py --bundle` - single-file bundle only (release artefact)

Outputs in `dist/`:

| File | Mode | Purpose |
| --- | --- | --- |
| `index.html`            | split  | HTML shell |
| `viewer.js`             | split  | Viewer code (loads `data.json` via fetch) |
| `viewer.css`            | split  | Concatenated styles |
| `data.json`             | split  | Merged graph data |
| `dialogue_explorer.html` | bundle | Self-contained file (no server needed) |

### Viewing the split build locally

Browsers block `fetch()` from `file://`, so the split build needs a static HTTP server.
The bundled file does not.
Use this command to start a local server:

```bash
python -m http.server 8000 --directory dist
# then open http://localhost:8000/
```

## Contributing

### Adding a new data source

The pipeline reads its inputs from the `HADES1_SOURCES` list in `generate_data.py`.
Each entry is `(output_json_name, source_label, lua_filename, extractor_function)`.
To add a new Lua source:

1. Write `src/extractors/hades1/<name>_data.py` with an `extract_<name>(parsed, source_label, source_file, game_data_lists)` function.
   It returns `{owner_name: {"source": label, ...sections}}`.
   Use the shared `extract_textline_sections` helper for the textline parts so audits and `GameData.X` reference resolution work uniformly.
2. Re-export the function from `src/extractors/hades1/__init__.py`.
3. Add the entry to `HADES1_SOURCES` in `generate_data.py`.
4. If the source uses new textline-bearing section keys, add them to `HADES1_TEXTLINE_SECTION_KEYS` in `section_keys.py`.
   The generator surfaces unknown section-shaped keys as warnings; missing allowlist entries are caught the same way.
5. Add a fixture-based test under `tests/hades1/` mirroring an existing extractor test.
   Drop a minimal Lua fixture in `tests/hades1/fixtures/`.

### Conventions

- Python: small modules with module docstrings explaining intent and any non-obvious invariants.
  Public functions get docstrings; private helpers get comments where the why isn't obvious from the code.
- JavaScript: same docstring discipline.
  `templates/viewer.js` is checked by ESLint (`no-undef` + `no-unused-vars`) - run `npm run lint` before pushing viewer changes.
- Audits over silent skips: extractors / loaders should warn loudly when the game data shape diverges from the allowlists rather than dropping data on the floor.
- Tests: run `python -m pytest` before pushing.
  New extractors need at least one fixture-driven test.

### Running tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The suite covers the tokenizer, parser, semantic extractors, graph builder, merge, audits, and an end-to-end integration test against a synthetic fixture.

### Linting the viewer JavaScript

```bash
npm install        # one-time, installs ESLint into node_modules/ (git-ignored)
npm run lint
```

Node.js + npm are only needed for this linter; the viewer itself ships as plain JavaScript with no build step beyond `build_viewer.py`.
