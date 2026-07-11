# Hades Dialogue Explorer

A browser-based tool for exploring the NPC dialogue dependency graphs from Supergiant's Hades and Hades II.

Almost every line an NPC speaks sits behind a set of prerequisites - other dialogues you need to have had, boss encounters you have seen, or any other type of situation that has occurred before.
This tool visualizes those requirements and lets you walk the graph: what unlocks a line, what that line unlocks in turn, and - once you load your save - exactly what's still standing between you and hearing it.

You can use the hosted viewer at [https://nikkelm.dev/HadesDialogueExplorer](https://nikkelm.dev/HadesDialogueExplorer/), or [download a single self-contained HTML file](https://github.com/NikkelM/HadesDialogueExplorer/releases/latest/download/dialogue_explorer.html) from the [latest release](https://github.com/NikkelM/HadesDialogueExplorer/releases/latest) for offline use.

## What it does

- Browse NPC dialogue from both Hades and Hades II, with full prerequisite chains.
- Walk upstream prerequisites and downstream dependents as interactive trees.
- Read all dialogue texts across both games.
- Load a save file to see your progress, then trace exactly what's blocking any given dialogue.
- Spot mutually exclusive alternates - where only one can ever play in a save - and what differentiates them.
- View dialogues that share an internal name across both games, and check out how they differ.
- Get a per-speaker overview with dialogue counts, cross-references and save state statistics.

## Using the viewer

- **Search** - type a textline name or some dialogue text in the search bar to find matching dialogues in either game.
- **Click** a tree row - selects it (details show in the side panel) and expands its children.
- **Click** the row's chevron (▶ / ▼) - toggles expand / collapse without changing the selection.
- **Double-click** a tree row - re-roots the panels on that textline, so you can explore outward from anywhere.
- **Details panel** - shows the dialogue text, requirements, and metadata (owner, play priority and more).

### Save file upload

Upload a Hades or Hades II save file (`ProfileX.sav` for a hub save or `ProfileX_Temp.sav` for an in-run save) to see your progress directly in the viewer.
Each dialogue then gets a status badge:

- **Played** - already played in your save.
- **Eligible** - everything it needs is satisfied, so it can play.
- **Blocked** - at least one requirement isn't met yet (click the badge to open the tracer).
- **Unobtainable** - permanently locked in this save; for example because an alternate dialogue or a dialogue that must not have played have played already.
- **Indeterminate** - the tool does not have enough information to determine eligibility - this dialogue may or may not be eligible at the moment.

Hades II saves also validate against Hades dialogues if you've played the [Zagreus' Journey](https://thunderstore.io/c/hades-ii/p/NikkelM/Zagreus_Journey/) mod with the save.

Your save is parsed entirely in your browser and never uploaded anywhere.

### Eligibility tracer

The tracer - reachable from an eligibility badge, or the button in the page header once a save is loaded - shows what's keeping a dialogue from becoming eligible.
You get a summary, a flat list of the unplayed prerequisites in suggested play order, a collapsible prerequisite tree, and any non-dialogue conditions checked against your save.

Beyond the textline chain, the tracer also resolves any non-dialogue gates a line carries - game-state flags, unlocks, run modifiers, and more - against your save wherever the save holds the answer.
Some conditions can only be settled from the right kind of save: a few depend on within-run state and need an in-run save, while others read hub progress and need a save in the House of Hades (Hades) or the Crossroads (Hades II).

## Development setup

1. Copy `config.example.toml` to `config.toml` in the repo root.
2. Point `paths.hades1_scripts` and `paths.hades2_scripts` at the `Scripts` directory inside each game's install.
   Both keys are required, and the generator checks each path exists before it parses anything.
   `config.toml` is git-ignored.
3. Install the dependencies:

```bash
pip install -r requirements.txt
```

The only runtime dependency is `tomli`, in case your Python is older than 3.11 - on 3.11+ nothing is installed.

## Building locally

The build is two steps: parse the Lua into JSON, then turn that JSON into the viewer.

```bash
python generate_data.py
python build_viewer.py
```

`build_viewer.py` takes a flag if you only want one flavour:

- `python build_viewer.py --split` - the split build only, for (local) HTTP.
- `python build_viewer.py --bundle` - the single-file bundle only.

If no flag is provided, both are built.

Outputs in `dist/`:

| File                       | Build  | Purpose                                               |
| -------------------------- | ------ | ----------------------------------------------------- |
| `index.html`               | split  | HTML shell                                            |
| `viewer.js`                | split  | Viewer code                                           |
| `viewer.css`               | split  | Concatenated styles                                   |
| `data.json`                | split  | Shared metadata and index                             |
| `data-hades1.json`         | split  | Hades graph data, fetched when the game is active     |
| `data-hades2.json`         | split  | Hades II graph data, fetched when the game is active  |
| `dialogue_explorer.html`   | bundle | Self-contained single file, no server needed          |

### Viewing the split build locally

Browsers block `fetch()` from `file://`, so the split build needs a static HTTP server.
The bundled file doesn't - you can open it straight from disk.

```bash
npm run serve   # -> http://localhost:8765 (python -m http.server 8765 --directory dist)
```

## Disclaimer

The in-browser save file parser is derived from [TheNormalnij](https://github.com/TheNormalnij)'s [Hades-SavesExtractor](https://github.com/TheNormalnij/Hades-SavesExtractor) project, which is distributed under the MIT licence.

This tool was built with the assistance of generative AI.
All game content belongs to Supergiant Games.
