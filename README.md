# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Parses NPC dialogue data from Hades 1 (and Hades II - planned)
- Visualizes dialogue prerequisite chains as interactive trees
- Shows upstream prerequisites and downstream dependents
- Displays dialogue text with speaker attribution
- Highlights external/unresolved references
- Single self-contained HTML output - no server needed

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
python build_viewer.py [output_path]
```

By default, outputs `dialogue_explorer.html` in the project root.

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

### Interacting with the viewer

- **Search**: Type a textline name in the search bar
- **Click** a tree node: expands/collapses children and shows details
- **Double-click** a tree node: navigates to it (refocuses the tree)
- **⤴ button**: appears on hover, navigates to that dialogue
- **Details panel**: shows dialogue text, requirements, and metadata
