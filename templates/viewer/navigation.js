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
import { renderSpeaker, canonicalisePriority, canonicaliseEligibility } from './speaker-view.js';
import { renderDuplicates } from './duplicates-view.js';
import { renderEligibility } from './eligibility-view.js';
import { parseUrlState, serializeUrlState, urlStateKey } from './url.js';
import { setActiveGame, getActiveGame, resolveGame, speakers } from './data.js';
import { buildLinesIndex } from './search-text.js';
import { buildNameIndex } from './search-name.js';
import { buildSpeakerIndex } from './search-speaker.js';
import { canonicalSpeakerId, resetSpeakerGroups } from './speaker-groups.js';
import { initStats } from './stats.js';
import { renderGameToggle } from './game-toggle.js';
import { refreshSaveStatus } from './save-upload.js';

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
// Optional ``opts`` carry the filter state so the same helper is used
// for both initial drill-in (no opts) and intra-view pivots (filter
// chip clicks).
//
// Member ids are canonicalised to their group's canonical id before
// writing the URL so two different routes into the same group land on
// the same shareable URL (e.g. clicking either ``HermesUpgrade`` or
// ``NPC_Hermes_01`` lands on ``speaker=<canonical Hermes id>``).
export function navigateToSpeaker(speakerId, opts) {
    const canonical = canonicalSpeakerId(speakerId);
    const state = { view: 'speaker', speaker: canonical };
    if (opts && opts.priority) state.priority = opts.priority;
    if (opts && opts.eligibility) state.eligibility = opts.eligibility;
    navigateToState(state);
}

// Filter-chip click targets. Each pivots one filter axis while preserving
// the other (read back off the current URL hash) so the repeatability and
// eligibility filters compose instead of clobbering each other.
export function filterSpeakerPriority(speakerId, priority) {
    const state = parseUrlState(window.location.hash);
    navigateToSpeaker(speakerId, { priority, eligibility: state.eligibility });
}

export function filterSpeakerEligibility(speakerId, eligibility) {
    const state = parseUrlState(window.location.hash);
    navigateToSpeaker(speakerId, { priority: state.priority, eligibility });
}

// Navigate to the cross-game duplicates view. Preserves existing
// query state when called without arguments.
export function navigateToDuplicates(opts) {
    const state = { view: 'duplicates' };
    if (opts && opts.q) state.q = opts.q;
    navigateToState(state);
}

// Navigate to the eligibility tracer view for a given dialogue. When
// invoked without an explicit name (the header "Eligibility tracer"
// button), fall back to the dialogue currently shown in the URL so the
// tracer opens on the dialogue the user is already looking at; on views
// with no current dialogue (speaker / duplicates) it opens empty.
export function navigateToEligibility(dialogueName) {
    const name = dialogueName || parseUrlState(window.location.hash).dialogue || null;
    navigateToState({ view: 'eligibility', dialogue: name });
}

// Search input handler for the duplicates view. Performs an immediate
// table-only re-render (so the input retains focus) and debounces the
// URL hash update so the URL stays bookmarkable once typing stops.
let _dupSearchTimer = null;
export function searchDuplicates(query) {
    // Immediate re-render: table-only path preserves the input element.
    renderDuplicates({ q: query, _bodyOnly: true });

    // Debounced URL sync (300ms after last keystroke). Only updates
    // the hash without re-rendering - the view is already current.
    if (_dupSearchTimer !== null) clearTimeout(_dupSearchTimer);
    _dupSearchTimer = setTimeout(() => {
        _dupSearchTimer = null;
        const fullState = { game: getActiveGame(), view: 'duplicates', q: query };
        const serialized = serializeUrlState(fullState);
        urlSelection = serialized;
        window.location.hash = serialized;
    }, 300);
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
    refreshSaveStatus();
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

// Dispatch the parsed state to the appropriate view. Three views are
// implemented:
//
//   - ``view=dialogue`` (default when ``dialogue=X`` is present, or
//     when an unknown view name is paired with a ``dialogue`` entity
//     so links pointing at not-yet-implemented views degrade
//     gracefully): renders the 3-panel dialogue detail view.
//   - ``view=speaker``: renders the single-panel speaker overview
//     into ``#info-content`` and hides the upstream / downstream
//     panels via the ``layout-speaker`` body class.
//   - ``view=duplicates``: renders the cross-game duplicates table
//     into the single-panel layout.
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
            eligibility: canonicaliseEligibility(state.eligibility),
        });
        const searchInput = document.getElementById('search');
        if (searchInput) {
            const entry = speakerId ? speakers[speakerId] : null;
            const friendly = entry && entry.name && entry.name !== speakerId ? entry.name : (speakerId || '');
            searchInput.value = friendly;
        }
        return;
    }
    if (view === 'duplicates') {
        applyLayoutMode('duplicates');
        renderDuplicates({
            q: state.q || '',
        });
        const searchInput = document.getElementById('search');
        if (searchInput) searchInput.value = '';
        return;
    }
    if (view === 'eligibility') {
        applyLayoutMode('eligibility');
        const name = state.dialogue || null;
        renderEligibility(name);
        const searchInput = document.getElementById('search');
        if (searchInput) searchInput.value = name || '';
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
// 3-panel dialogue layout, single-panel speaker layout, and
// single-panel duplicates layout. Also retitles the info-panel
// header so the surrounding chrome matches the active view.
function applyLayoutMode(mode) {
    const body = document.body;
    if (!body) return;
    const wantSpeaker = mode === 'speaker';
    const wantDuplicates = mode === 'duplicates';
    const wantEligibility = mode === 'eligibility';
    const wantSinglePanel = wantSpeaker || wantDuplicates || wantEligibility;
    body.classList.toggle('layout-speaker', wantSinglePanel);
    body.classList.toggle('layout-dialogue', !wantSinglePanel);
    const header = document.getElementById('panel-info-heading');
    if (header) {
        if (wantEligibility) header.textContent = 'Eligibility Tracer';
        else if (wantDuplicates) header.textContent = 'Cross-game Duplicates';
        else if (wantSpeaker) header.textContent = 'Speaker Overview';
        else header.textContent = 'Textline Details';
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

// Force a full re-render of the current view (bypasses the dedup key).
// Used when the rendering context changes without a URL change (e.g. a
// save file is loaded/cleared).
export function forceRefresh() {
    urlSelection = '';
    applyHashFromUrl();
}
