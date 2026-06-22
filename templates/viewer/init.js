// Boot + init orchestration. ``build_viewer.py`` pins this file to the
// end of the concatenated script so the ``boot()`` call at the bottom
// is the final top-level statement, executing after every top-level
// ``let`` declaration in the other modules has been initialised.

import { loadData, resolveGame, registerGameData, setGameLoader, preloadGame } from './data.js';
import { switchToGame, applyHashFromUrl, forceRefresh, applyFirstVisitLanding, syncActiveGameToSave } from './navigation.js';
import { initSearch } from './search-ui.js';
import { initInfoPanel } from './info-panel.js';
import { initTooltip } from './tooltip.js';
import { initGameToggle } from './game-toggle.js';
import { initSaveUpload, restoreSavedSave } from './save-upload.js';
import { initKeyboardA11y } from './keyboard-a11y.js';
import { initTreeKeyboard } from './tree-keyboard.js';
import { replayTours, setReplayDispatcher } from './tours.js';
import { startHomeTourReplay } from './tour-home.js';
import { startSpeakerTourReplay } from './tour-speaker.js';
import { startDuplicatesTourReplay } from './tour-duplicates.js';
import { startEligibilityTourReplay } from './tour-eligibility.js';
import { maybeStartSaveCallout } from './tour-callouts.js';
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
    // Make inline-onclick controls keyboard-operable (focusable + Enter/Space).
    // Set up before the first render so the controls it draws are covered too.
    initKeyboardA11y();
    // Arrow-key / Enter navigation for the prerequisite & dependent trees.
    initTreeKeyboard();
    // Re-hydrate a cached save before the first render so its badges show
    // immediately (indistinguishable from a freshly loaded save).
    restoreSavedSave();
    // First-ever visit to the bare home page lands on the featured
    // dialogue (and writes it into the URL); return visits fall through
    // to the normal hash apply, which shows the genuine empty state.
    if (!applyFirstVisitLanding()) {
        applyHashFromUrl();
    }
    window.addEventListener('hashchange', applyHashFromUrl);
    // On a freshly loaded save, switch to the save's game (so its progress is
    // visible right away); that switch re-renders, so only fall back to a
    // plain refresh when the save already matches the active game.
    window.addEventListener('save-loaded', () => {
        if (!syncActiveGameToSave()) forceRefresh();
    });
    // Onboarding: offer the save callout after the re-render above has drawn
    // the status badges (this listener is registered after forceRefresh, so it
    // runs second on the same event).
    window.addEventListener('save-loaded', maybeStartSaveCallout);
    // The floating "?" control re-runs the onboarding tours on demand.
    const tourHelp = document.getElementById('tour-help');
    if (tourHelp) {
        tourHelp.addEventListener('click', replayTours);
    }
    // Onboarding: the replay control re-runs the tour matching the current
    // view. The per-view tours auto-start (once) from their own render hooks
    // in applyState, so first-time visitors are covered whether they land on
    // the bare page or arrive via a deep link.
    setReplayDispatcher(() => {
        const view = (parseUrlState(window.location.hash).view || '').toLowerCase();
        if (view === 'speaker') startSpeakerTourReplay();
        else if (view === 'duplicates') startDuplicatesTourReplay();
        else if (view === 'eligibility') startEligibilityTourReplay();
        else startHomeTourReplay();
    });
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
//   1. Bundled single-file: every game's data is inlined as
//      ``<script type="application/json" id="viewer-data">``; we read its
//      textContent and JSON.parse it. Works from ``file://``.
//   2. Split build: the entry point ``data.json`` is a small meta document
//      (game ids, labels, default game/dialogue, cross-game duplicates) that
//      lists the per-game data files. We fetch the meta, then the active
//      game's ``data-<id>.json`` to unblock interactivity, then stream the
//      remaining game(s) in the background so a later toggle never re-blocks.
//      Requires an HTTP server (local dev or GH Pages).
// Wrapped in an async function so a synchronous JSON.parse throw is caught by
// the same try/catch as a network failure.
async function boot() {
    try {
        const inline = document.getElementById('viewer-data');
        if (inline) {
            init(JSON.parse(inline.textContent));
            return;
        }
        // Match the cache-busting version on the asset URLs (set by
        // build_viewer.py via the viewer-version meta tag) so stale data files
        // are never served after a rebuild.
        const verMeta = document.querySelector('meta[name="viewer-version"]');
        const v = verMeta && verMeta.content ? '?v=' + encodeURIComponent(verMeta.content) : '';
        const fetchJson = async (file) => {
            const r = await fetch(file + v);
            if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + file);
            return r.json();
        };
        // Register how to (re)fetch a game's blob so both the background preload
        // below and any on-demand retry (e.g. a toggle after a failed preload)
        // go through the same fetch + cache-busting.
        setGameLoader((gid) => fetchJson(_gameFile(gid)).then((blob) => registerGameData(gid, blob)));

        const meta = await fetchJson('data.json');
        // Decide which game to load first from the URL (shared deep links land
        // in the right game), else the build-time default.
        const want = parseUrlState(window.location.hash).game;
        const ids = Array.isArray(meta.gameIds) ? meta.gameIds : [];
        const initialGame = (want && ids.includes(want)) ? want : meta.defaultGame;

        const initialBlob = await fetchJson(_gameFile(initialGame));
        init({
            games: { [initialGame]: initialBlob },
            gameIds: meta.gameIds,
            gameLabels: meta.gameLabels,
            defaultGame: meta.defaultGame,
            defaultDialogue: meta.defaultDialogue,
            duplicates: meta.duplicates,
        });

        // Background-load the remaining game(s) so switching is instant. The
        // in-flight promise is tracked in data.js so a toggle / cross-game link
        // that fires during the window awaits it (see ``ensureGameLoaded``). A
        // failed preload is non-fatal: the active game stays usable, and the
        // load is retried on demand when the user actually switches to that game
        // (navigation surfaces a message if the retry also fails).
        for (const gid of ids) {
            if (gid === initialGame) continue;
            preloadGame(gid).then((ok) => {
                if (!ok) console.warn('Background load of ' + gid + ' failed; will retry on demand');
            });
        }
    } catch (err) {
        console.error('Viewer boot failed:', err);
        showLoadError(err);
    }
}

// Per-game data file name in the split build (paired with the meta data.json).
function _gameFile(gameId) {
    return 'data-' + gameId + '.json';
}

boot();
