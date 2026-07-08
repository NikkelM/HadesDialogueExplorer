# Social share image (`static/og-image.png`)

The 1200x630 Open Graph / Twitter card for the Hades Dialogue Explorer. It is
built the same way as the nikkelm.dev site card
([`NikkelM.github.io/scripts/og-image.html`](https://github.com/NikkelM/NikkelM.github.io)):
an **HTML file rendered to PNG with headless Chrome**, sharing its dotted-grid
background, IBM Plex fonts and palette.

The one twist here is a real screenshot of the tool: the card embeds a capture
of the "Textline details" panel for an example dialogue (with a save loaded, so
the eligibility dots show) inside a CSS browser frame.

## Files

| File | Role |
| --- | --- |
| `og-image.html` | The card itself - all text, palette, layout and the browser frame. **This is the main thing to edit.** |
| `panel.png` | The embedded tool screenshot (committed). Only needs regenerating when you change the example dialogue/save. |
| `capture-panel.mjs` | Regenerates `panel.png` over the DevTools Protocol. |
| `generate.ps1` | One-shot: capture the panel + render the card. |

## Regenerate

Prerequisites: Google Chrome, Node >= 22, and (for the panel capture) the built
viewer served locally - `py build_viewer.py` then serve `dist/` at
`http://localhost:8000`.

```powershell
# Everything (capture panel + render card):
.\scripts\social-card\generate.ps1 -Save "C:\Users\<you>\Saved Games\Hades II\Profile3.sav"

# A different example dialogue:
.\scripts\social-card\generate.ps1 -Save <save.sav> -Dialogue HecateFirstMeeting -Game hades2

# Only re-render the card (after editing og-image.html) - no browser save needed:
.\scripts\social-card\generate.ps1 -Save <save.sav> -SkipCapture
```

Then copy it into `dist/` by rebuilding: `py build_viewer.py`
(`build_viewer.py` ships `static/og-image.png` in the split build and references
it from the `og:image` / `twitter:image` meta tags).

## Just tweak the text / layout

Edit `og-image.html` (it is plain HTML/CSS) and re-render - no capture needed:

```powershell
.\scripts\social-card\generate.ps1 -Save <any .sav> -SkipCapture
```

Or run headless Chrome yourself. **Use absolute paths** - Chrome treats a bare
filename as a hostname:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --headless=new --disable-gpu --window-size=1200,630 `
  --allow-file-access-from-files --virtual-time-budget=3000 `
  --user-data-dir=$env:TEMP\hde-card `
  --screenshot=<repo>\static\og-image.png `
  <repo>\scripts\social-card\og-image.html
```

`--allow-file-access-from-files` lets the rendered page load the local
`panel.png`; `--virtual-time-budget` gives the Google Fonts time to load.

## The example dialogue

`OdysseusBathHouse03` is used because, against a well-progressed save, it is
**eligible** with an all-green requirement breakdown (four satisfied "must have
played" prerequisites plus met "other requirements") - a compact showcase of the
dependency graph + save analysis. `capture-panel.mjs` applies a few card-only
tweaks before the shot (truncates the dialogue to one line + `...`, expands the
requirement sections, hides the dot-key legend and closing voicelines, keeps long
"other requirements" clauses on one line, and insets the priority badges); none
of these change the live viewer.
