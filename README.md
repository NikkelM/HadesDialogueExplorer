# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Browse NPC dialogue from Hades 1 and Hades II
- Visualise prerequisite chains as interactive trees, with upstream prerequisites and downstream dependents in separate panels
- Read dialogue text with speaker attribution
- Switch between games from the header toggle
- Use the hosted viewer online, or download a single self-contained HTML file for offline use

## Using the viewer

- **Search** - type a textline name or dialogue text in the search bar.
  Use Up / Down + Enter to pick a result, or click it.
- **Click** a tree row - selects it (shows details in the side panel) and expands its children.
- **Click** the row's chevron (▶ / ▼) - toggles expand / collapse without changing the selection.
- **Double-click** a tree row - re-roots the panels on that textline.
- **Details panel** - shows dialogue text, requirements, and metadata.

## Development Setup

1. Copy `config.example.toml` to `config.toml` in the repo root.
2. Edit `config.toml` so `paths.hades1_scripts` and `paths.hades2_scripts` both point at the `Scripts` directory inside the respective game's install.
   Both keys are required; the generator validates that each path exists before parsing.
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
  The viewer source lives as ES modules under `templates/viewer/*.js`; `build_viewer.py` strips imports/exports and concatenates them into a single classic `dist/viewer.js`.
  ESLint (`no-undef` + `no-unused-vars`) checks both the viewer modules and the JS tests - run `npm run lint` before pushing viewer changes.
- Audits over silent skips: extractors / loaders should warn loudly when the game data shape diverges from the allowlists rather than dropping data on the floor.
- Tests: run `python -m pytest` (Python: extractors, parser, graph) and `npm test` (JS: viewer helpers, search ranking, render utilities) before pushing.
  New extractors need at least one fixture-driven Python test; new viewer helpers with non-trivial logic should get a JS test under `tests-js/`.

### Running tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The Python suite covers the tokenizer, parser, semantic extractors, graph builder, merge, audits, and an end-to-end integration test against a synthetic fixture.

```bash
npm install        # one-time, installs ESLint into node_modules/ (git-ignored)
npm test
```

The JavaScript suite runs under `node --test` (built into Node 18+, no extra dependencies) and covers the pure helpers in `templates/viewer/`: HTML render utilities, label formatters, name-based search ranking (per-token tiers + query-order-dominant sort), and text-content search (word-boundary matching, contiguous-phrase boost, partial-match fallback). Fixtures live in `tests-js/fixtures.js`.

### Linting the viewer JavaScript

```bash
npm install        # one-time, installs ESLint into node_modules/ (git-ignored)
npm run lint
```

Node.js + npm are needed for the linter and the JS test runner; the viewer itself ships as plain JavaScript (concatenated by `build_viewer.py`) with no separate JS build step.
