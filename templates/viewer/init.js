// Boot + init orchestration. ``build_viewer.py`` pins this file to the
// end of the concatenated script so the ``boot()`` call at the bottom
// is the final top-level statement, executing after every top-level
// ``let`` declaration in the other modules has been initialised.

import { loadData, resolveGame } from './data.js';
import { switchToGame, applyHashFromUrl, forceRefresh } from './navigation.js';
import { initSearch } from './search-ui.js';
import { initInfoPanel } from './info-panel.js';
import { initTooltip } from './tooltip.js';
import { initGameToggle } from './game-toggle.js';
import { initSaveUpload } from './save-upload.js';
import { parseUrlState } from './url.js';

function init(data) {
    loadData(data);
    // Resolve the initial game from the URL hash before building any
    // game-specific state. Deep links carry ``game=`` so a shared URL
    // lands the user in the right game's namespace; anything else
    // falls back to the build-time default game.
    const initialState = parseUrlState(window.location.hash);
    const initialGame = resolveGame(initialState.game);
    switchToGame(initialGame);
    initSearch();
    initInfoPanel();
    initTooltip();
    initGameToggle();
    initSaveUpload();
    applyHashFromUrl();
    window.addEventListener('hashchange', applyHashFromUrl);
    // Re-render current view when a save file is loaded or cleared
    window.addEventListener('save-loaded', forceRefresh);
    window.addEventListener('save-cleared', forceRefresh);
}

// Render a load error into the stable #app-error mount instead of
// blowing away the page chrome, so the search bar and panel headers
// remain visible while the user reads the message.
function showLoadError(err) {
    const mount = document.getElementById('app-error');
    const msg = (err && err.message) ? err.message : String(err);
    if (mount) {
        mount.hidden = false;
        mount.textContent = 'Failed to load dialogue data: ' + msg;
    } else {
        // Fallback: prepend to body if the mount is missing (e.g.
        // someone customised the shell and removed the placeholder).
        const fallback = document.createElement('div');
        fallback.style.cssText = 'padding:1em;margin:1em;background:#3a1414;color:#f8b;border:1px solid #a44;border-radius:6px';
        fallback.textContent = 'Failed to load dialogue data: ' + msg;
        document.body.insertBefore(fallback, document.body.firstChild);
    }
}

// Dual-mode boot:
//   1. Bundled single-file: data is inlined as
//      ``<script type="application/json" id="viewer-data">``; we read
//      its textContent and JSON.parse it. Works from ``file://``.
//   2. Split build: no inline element, so fetch ``data.json``. Requires
//      an HTTP server (local dev or GH Pages).
// Wrapped in an async function so a synchronous JSON.parse throw is
// caught by the same try/catch as a network failure.
async function boot() {
    try {
        const inline = document.getElementById('viewer-data');
        let data;
        if (inline) {
            data = JSON.parse(inline.textContent);
        } else {
            const r = await fetch('data.json');
            if (!r.ok) {
                throw new Error('HTTP ' + r.status + ' fetching data.json');
            }
            data = await r.json();
        }
        init(data);
    } catch (err) {
        console.error('Viewer boot failed:', err);
        showLoadError(err);
    }
}

boot();
