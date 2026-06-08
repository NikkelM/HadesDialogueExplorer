# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Parses NPC dialogue data from Hades 1 (and Hades II - planned)
- Visualizes dialogue prerequisite chains as interactive trees
- Shows upstream prerequisites and downstream dependents
- Displays dialogue text with speaker attribution
- Highlights external/unresolved references
- Ships in two flavours: a split build for HTTP / GitHub Pages hosting
  (small cacheable files) and a single-file bundle for offline `file://`
  use

## Setup

1. Copy `config.example.toml` to `config.toml` in the repo root.
2. Edit `config.toml` to point `paths.hades1_scripts` at your local Hades
   install's `Scripts` directory (typical Steam path is shown in the
   example). `config.toml` is git-ignored so your local paths stay out
   of version control.

## Usage

```bash
# Step 1: Parse game files and generate JSON data
python generate_data.py

# Step 2: Build the HTML viewer from generated data
python build_viewer.py            # writes both split + bundle outputs (default)
python build_viewer.py --split    # split only (for GH Pages / local HTTP dev)
python build_viewer.py --bundle   # single-file only (for release artifacts)
```

All outputs land in `dist/`:

| File | Mode | Purpose |
| --- | --- | --- |
| `dist/index.html`            | split  | HTML shell |
| `dist/viewer.js`             | split  | Viewer code (loads `data.json` via fetch) |
| `dist/viewer.css`            | split  | Concatenated styles |
| `dist/data.json`             | split  | Merged graph data |
| `dist/dialogue_explorer.html` | bundle | Single self-contained file |

### Viewing the split build locally

Browsers block `fetch()` from `file://`, so the split build needs an
HTTP server. The bundled file does not. Any static server works; the
simplest:

```bash
python -m http.server 8000 --directory dist
# then open http://localhost:8000/
```

The bundled `dist/dialogue_explorer.html` can be opened by
double-clicking it (or via `file://`) - no server required.

### Requirements

- Python 3.9+
- Hades 1 installed locally (any path - configure it in `config.toml`)
- On Python < 3.11, `pip install -r requirements.txt` to get the TOML
  parser (`tomli`). On 3.11+ this is a no-op since `tomllib` is stdlib.

### Running tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The test suite covers the tokenizer, parser, semantic extractor, graph builder,
and an end-to-end integration test using a synthetic fixture.

### Linting the viewer JavaScript

`templates/viewer.js` is checked with ESLint (`no-undef` + `no-unused-vars`)
to catch the same class of typos and dead names that `pyflakes` catches on
the Python side. Node.js + npm are only needed for this linter; the viewer
itself ships as plain JavaScript with no build step beyond `build_viewer.py`.

```bash
npm install        # one-time, installs eslint into node_modules/ (git-ignored)
npm run lint
```

### Interacting with the viewer

- **Search**: Type a textline name in the search bar
- **Click** a tree node: expands/collapses children and shows details
- **Double-click** a tree node: navigates to it (refocuses the tree)
- **⤴ button**: appears on hover, navigates to that dialogue
- **Details panel**: shows dialogue text, requirements, and metadata
