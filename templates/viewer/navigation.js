// URL-hash navigation between viewer states. Selecting a textline
// updates all three panels (info, upstream, downstream) and pushes
// a canonical ``game=...&view=...&dialogue=...`` state into
// ``window.location.hash`` so the URL is shareable.
//
// The URL scheme itself - parsing, serialization, key order - lives
// in ``./url.js``. This module owns the DOM-facing side: choosing
// which view to render for a parsed state, syncing the search box,
// the hashchange listener that drives back/forward navigation, and
// the per-game data swap that fires when the URL's ``game`` key
// changes (toggle clicks and shared deep links both go through here).

import { renderInfo } from './info-panel.js';
import { renderUpstream, renderDownstream } from './tree-renderers.js';
import { renderSpeaker, canonicalisePriority, canonicaliseSort } from './speaker-view.js';
import { parseUrlState, serializeUrlState, urlStateKey } from './url.js';
import { setActiveGame, getActiveGame, resolveGame, speakers } from './data.js';
import { buildLinesIndex } from './search-text.js';
import { buildNameIndex } from './search-name.js';
import { buildSpeakerIndex } from './search-speaker.js';
import { canonicalSpeakerId, resetSpeakerGroups } from './speaker-groups.js';
import { initStats } from './stats.js';
import { renderGameToggle } from './game-toggle.js';

// Tracks the canonical serialization of the state currently
// reflected in ``window.location.hash`` so the ``hashchange``
// listener can skip the redundant re-render that fires when
// ``navigateToState`` itself sets the hash. Initialised to the
// literal canonical serialization of the empty state (``''``) so
// the first-load call to ``applyHashFromUrl`` with an empty hash
// short-circuits without redundantly clearing the placeholder
// panels. The literal is intentional - calling ``urlStateKey({})``
// here would TDZ on the ``const KEY_ORDER`` declaration in
// ``./url.js`` because the concatenated build script orders
// ``navigation.js`` before ``url.js`` and ``const`` (unlike
// ``function``) is not hoisted across the concatenated boundary.
export let urlSelection = '';

// Render the dialogue detail view (info + upstream + downstream
// panels) for the given textline. Pure render side-effect; does not
// touch the URL or the search box.
export function selectTextline(name) {
    renderInfo(name);
    renderUpstream(name);
    renderDownstream(name);
}

// Convenience entry point used by every inline ``onclick`` in the
// rendered HTML, the search dropdown, and the tree double-click
// handler. Always targets the dialogue detail view. New views (e.g.
// a speaker overview, the alternative visualizations) should call
// ``navigateToState`` directly with their own keys.
export function navigateTo(name) {
    navigateToState({ view: 'dialogue', dialogue: name });
}

// Convenience entry point for navigating to a speaker overview.
// Optional ``opts`` carry the filter / sort state so the same helper
// is used for both initial drill-in (no opts) and intra-view pivots
// (filter / sort chip clicks).
//
// Member ids are canonicalised to their group's canonical id before
// writing the URL so two different routes into the same group land on
// the same shareable URL (e.g. clicking either ``HermesUpgrade`` or
// ``NPC_Hermes_01`` lands on ``speaker=<canonical Hermes id>``).
export function navigateToSpeaker(speakerId, opts) {
    const canonical = canonicalSpeakerId(speakerId);
    const state = { view: 'speaker', speaker: canonical };
    if (opts && opts.priority) state.priority = opts.priority;
    if (opts && opts.sort) state.sort = opts.sort;
    navigateToState(state);
}

// Filter-chip click target. Preserves the active sort axis by reading
// it back off the current URL hash; pivots the priority filter.
export function filterSpeakerPriority(speakerId, priority) {
    const state = parseUrlState(window.location.hash);
    navigateToSpeaker(speakerId, {
        priority,
        sort: canonicaliseSort(state.sort),
    });
}

// Sort-chip click target. Mirror of ``filterSpeakerPriority``.
export function sortSpeakerTextlines(speakerId, sort) {
    const state = parseUrlState(window.location.hash);
    navigateToSpeaker(speakerId, {
        priority: canonicalisePriority(state.priority),
        sort,
    });
}

// Switch the viewer to a different game: swap every per-game data
// binding, rebuild the search indices against the new textlines,
// re-render the stats line, and refresh the toggle highlight. Does
// NOT touch the URL hash - the caller decides whether the switch
// flows through ``navigateToState`` (toggle click) or precedes it
// (deep-link load).
export function switchToGame(gameId) {
    setActiveGame(gameId);
    resetSpeakerGroups();
    buildLinesIndex();
    buildNameIndex();
    buildSpeakerIndex();
    initStats();
    renderGameToggle();
}

// Write ``state`` into the URL hash and refresh the panels to
// reflect it. Both the change-detection key and the
// ``window.location.hash`` assignment go through the same
// serializer so the resulting ``hashchange`` event is recognised
// as a self-write and skipped.
//
// Always emits the current ``game`` so the URL stays canonical
// even when the caller didn't think to set it (every
// non-toggle-click navigation - search, tree click, inline link -
// implicitly stays in the active game).
export function navigateToState(state) {
    const fullState = Object.assign({ game: getActiveGame() }, state || {});
    const requestedGame = fullState.game;
    if (requestedGame && requestedGame !== getActiveGame()) {
        switchToGame(requestedGame);
    }
    const serialized = serializeUrlState(fullState);
    urlSelection = serialized;
    window.location.hash = serialized;
    applyState(fullState);
}

// Read ``window.location.hash``, parse it under the key=value
// scheme, and sync the viewer to whatever it points to. Used on
// initial page load and on every browser back/forward.
//
// If the parsed state names a different game than the active one
// (browser back across a toggle, shared deep link into the other
// game), swap data bindings first so the rest of the state
// resolves against the right namespace.
export function applyHashFromUrl() {
    const state = parseUrlState(window.location.hash);
    const resolvedGame = resolveGame(state.game);
    state.game = resolvedGame;
    const key = urlStateKey(state);
    if (key === urlSelection) return;
    urlSelection = key;
    if (resolvedGame !== getActiveGame()) {
        switchToGame(resolvedGame);
    }
    applyState(state);
}

// Dispatch the parsed state to the appropriate view. Two views are
// implemented today:
//
//   - ``view=dialogue`` (default when ``dialogue=X`` is present, or
//     when an unknown view name is paired with a ``dialogue`` entity
//     so links pointing at not-yet-implemented views degrade
//     gracefully): renders the 3-panel dialogue detail view.
//   - ``view=speaker``: renders the single-panel speaker overview
//     into ``#info-content`` and hides the upstream / downstream
//     panels via the ``layout-speaker`` body class. Without a
//     ``speaker`` entity the view renders the empty-state placeholder
//     so the user can pick a speaker from the search bar.
//
// States that name no entity reset the viewer to its empty-state
// placeholders in the default dialogue layout.
function applyState(state) {
    const view = (state.view || (state.dialogue ? 'dialogue' : '')).toLowerCase();
    if (view === 'speaker') {
        applyLayoutMode('speaker');
        const speakerId = state.speaker || null;
        renderSpeaker(speakerId, {
            priority: canonicalisePriority(state.priority),
            sort: canonicaliseSort(state.sort),
        });
        // Reflect the active speaker in the search box so it
        // becomes a no-op edit affordance (the user can refine
        // from the same starting point).
        const searchInput = document.getElementById('search');
        if (searchInput) {
            const entry = speakerId ? speakers[speakerId] : null;
            const friendly = entry && entry.name && entry.name !== speakerId ? entry.name : (speakerId || '');
            searchInput.value = friendly;
        }
        return;
    }
    applyLayoutMode('dialogue');
    const name = state.dialogue || null;
    if (name) {
        selectTextline(name);
        document.getElementById('search').value = name;
    } else {
        clearSelection();
    }
}

// Toggle the body's layout class so CSS can swap between the
// 3-panel dialogue layout and the single-panel speaker layout.
// Also retitles the info-panel header so the surrounding chrome
// matches the active view; the original "Textline Details" string
// is restored on the way out.
function applyLayoutMode(mode) {
    const body = document.body;
    if (!body) return;
    const wantSpeaker = mode === 'speaker';
    body.classList.toggle('layout-speaker', wantSpeaker);
    body.classList.toggle('layout-dialogue', !wantSpeaker);
    const header = document.querySelector('#panel-info > h2');
    if (header) {
        header.textContent = wantSpeaker ? 'Speaker Overview' : 'Textline Details';
    }
}

// Restore each panel and the search box to the same empty state the
// page starts in (mirrors the placeholder markup in
// ``templates/index.html``). Called by ``applyState`` when the URL
// names no entity so the viewer matches its first-load appearance
// rather than holding onto a stale selection.
export function clearSelection() {
    document.getElementById('info-content').innerHTML =
        '<div class="empty-state">Select a textline to see its details</div>';
    document.getElementById('upstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see its prerequisites</div>';
    document.getElementById('downstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see what depends on it</div>';
    document.getElementById('search').value = '';
}
