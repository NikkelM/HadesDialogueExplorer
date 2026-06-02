# Hades Dialogue Explorer

Interactive browser-based tool for exploring NPC dialogue dependency graphs from Supergiant's Hades games.

## Features

- Parses NPC dialogue data from Hades 1 (and Hades II - planned)
- Visualizes dialogue prerequisite chains as interactive trees
- Shows upstream prerequisites and downstream dependents
- Displays dialogue text with speaker attribution
- Highlights external/unresolved references
- Single self-contained HTML output - no server needed

## Usage

```bash
# Step 1: Parse game files and generate JSON data
python generate_data.py

# Step 2: Build the HTML viewer from generated data
python build_viewer.py [output_path]
```

By default, outputs `dialogue_explorer.html` in the project root.

### Requirements

- Python 3.8+
- Hades 1 installed at the default Steam path

### Interacting with the viewer

- **Search**: Type a textline name in the search bar
- **Click** a tree node: expands/collapses children and shows details
- **Double-click** a tree node: navigates to it (refocuses the tree)
- **⤴ button**: appears on hover, navigates to that dialogue
- **Details panel**: shows dialogue text, requirements, and metadata
