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
import { parseUrlState, serializeUrlState, urlStateKey } from './url.js';
import { setActiveGame, getActiveGame, resolveGame } from './data.js';
import { buildLinesIndex } from './search-text.js';
import { buildNameIndex } from './search-name.js';
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

// Switch the viewer to a different game: swap every per-game data
// binding, rebuild the search indices against the new textlines,
// re-render the stats line, and refresh the toggle highlight. Does
// NOT touch the URL hash - the caller decides whether the switch
// flows through ``navigateToState`` (toggle click) or precedes it
// (deep-link load).
export function switchToGame(gameId) {
    setActiveGame(gameId);
    buildLinesIndex();
    buildNameIndex();
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

// Dispatch the parsed state to the appropriate view. Today only the
// dialogue detail view is implemented, so any state that names a
// ``dialogue`` entity is routed there - including states with an
// unknown ``view`` value, so links pointing at not-yet-implemented
// views (e.g. ``view=graph``) degrade gracefully to the default
// view for the same entity. States that name no entity reset the
// viewer to its empty-state placeholders.
function applyState(state) {
    const name = state.dialogue || null;
    if (name) {
        selectTextline(name);
        document.getElementById('search').value = name;
    } else {
        clearSelection();
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
