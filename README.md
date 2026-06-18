# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Browse NPC dialogue from Hades 1 and Hades II with full prerequisite chains
- Visualise upstream prerequisites and downstream dependents as interactive trees
- Read dialogue text with speaker attribution
- Upload save files to see dialogue progress (played/eligible/blocked)
- Eligibility tracer showing what's blocking a specific dialogue
- Detect and display mutually exclusive alternate dialogues (e.g. `_A`/`_B` variants)
- Cross-game duplicate detection for dialogues sharing names across both games
- Speaker overview with per-character stats and dialogue counts
- Switch between games from the header toggle
- Use the hosted viewer online, or download a single self-contained HTML file for offline use

## Using the viewer

- **Search** - type a textline name or dialogue text in the search bar.
  Use Up / Down + Enter to pick a result, or click it.
- **Click** a tree row - selects it (shows details in the side panel) and expands its children.
- **Click** the row's chevron (▶ / ▼) - toggles expand / collapse without changing the selection.
- **Double-click** a tree row - re-roots the panels on that textline.
- **Details panel** - shows dialogue text, requirements, and metadata.

### Save file upload

Upload a Hades or Hades II save file (`Profile1.sav` through `Profile4.sav`) to see dialogue progress directly in the viewer.
Once loaded, each dialogue gets a status badge:

- **Played** - already in the save's TextLinesRecord
- **Eligible** - all direct prerequisites are satisfied
- **Blocked** - one or more prerequisites are still unplayed (click the badge to open the eligibility tracer)

Hades II saves also validate against Hades 1 dialogues (for the [Zagreus' Journey](https://github.com/NikkelM/Hades-II-HadesBiomes) mod).

A loaded save is cached in your browser's local storage, so it is restored automatically when you reload the page.
The save is never uploaded anywhere; parsing happens entirely in-browser, and clearing the save (the × button) also removes the cache.

### Eligibility tracer

The eligibility tracer (accessible via the "Blocked" badge or the nav link when a save is loaded) shows what's preventing a dialogue from becoming eligible.
It displays a summary, a flat list of unplayed prerequisites sorted by play order, and a collapsible prerequisite tree.

The tracer respects the game's actual requirement semantics:

- **AND requirements** (`RequiredTextLines`, etc.) - all must be played
- **OR requirements** (`RequiredAnyTextLines`, etc.) - any one suffices
- **Count requirements** (`RequiredMinAnyTextLines`) - at least N of the listed lines must be played
- **Negative requirements** (`RequiredFalseTextLines`, etc.) - skipped (blocking conditions, not prerequisites)

## Eligibility API

A lightweight API for programmatic eligibility checks, intended for coding agents debugging dialogue progression.

### CLI mode

```bash
pip install -r requirements.txt   # includes the save-parser deps (lz4, luabins-py)
python api.py check <save_file> <dialogue_name> [--game hades1|hades2]
```

Example:

```bash
python api.py check "path/to/Profile1.sav" OrpheusSingsAgain02
```

### HTTP server mode

```bash
python api.py serve [--port 8081]
```

POST to `/eligibility` with either:

- **multipart/form-data** - fields: `save` (file), `dialogue` (string), `game` (optional)
- **application/json** - `{"savePath": "/path/to/Profile1.sav", "dialogue": "...", "game": "..."}`

### Response

```json
{
	"dialogue": "OrpheusSingsAgain02",
	"game": "hades1",
	"saveGame": "hades2",
	"completedRuns": 86,
	"status": "blocked",
	"totalPrereqs": 23,
	"playedPrereqs": 2,
	"unplayedPrereqs": 21,
	"unplayed": [
		{
			"name": "EurydiceFirstMeeting01_C",
			"owner": "NPC_Eurydice_01",
			"depth": 13,
			"reqTypes": ["RequiredTextLines"],
			"neededBy": ["EurydiceFirstMeeting01"]
		}
	],
	"tree": [
		{
			"name": "OrpheusTallTale05",
			"reqType": "RequiredTextLines",
			"played": false,
			"depth": 1,
			"children": []
		}
	]
}
```

| Field      | Description                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| `status`   | `played` (in save), `eligible` (all prereqs met), `blocked` (missing prereqs)  |
| `unplayed` | Flat list of unplayed prerequisites, sorted deepest-first (play order)         |
| `tree`     | Nested hierarchy; played nodes have no children                                |
| `game`     | Which game's data was used (auto-detected from dialogue name if not specified) |
| `saveGame` | Which game the save file belongs to                                            |

## Development Setup

1. Copy `config.example.toml` to `config.toml` in the repo root.
2. Edit `config.toml` so `paths.hades1_scripts` and `paths.hades2_scripts` both point at the `Scripts` directory inside the respective game's install.
   Both keys are required; the generator validates that each path exists before parsing.
   `config.toml` is git-ignored.
3. Install dependencies:

```bash
pip install -r requirements.txt
```

## Building locally

```bash
python generate_data.py            # parse Lua sources -> outputs/*.json
python build_viewer.py             # build viewer -> dist/ (split + bundle)
```

Useful build flags:

- `python build_viewer.py --split` - split build only (GH Pages / local HTTP)
- `python build_viewer.py --bundle` - single-file bundle only (release artefact)

Outputs in `dist/`:

| File                     | Mode   | Purpose                                   |
| ------------------------ | ------ | ----------------------------------------- |
| `index.html`             | split  | HTML shell                                |
| `viewer.js`              | split  | Viewer code (loads `data.json` via fetch) |
| `viewer.css`             | split  | Concatenated styles                       |
| `data.json`              | split  | Merged graph data                         |
| `dialogue_explorer.html` | bundle | Self-contained file (no server needed)    |

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

## Disclaimer

This tool was built with the assistance of generative AI.
All game content belongs to Supergiant Games.
