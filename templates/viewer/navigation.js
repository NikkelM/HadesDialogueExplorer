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
import { maybeStartHomeTour } from './tour-home.js';
import { maybeStartSpeakerTour } from './tour-speaker.js';
import { maybeStartDuplicatesTour } from './tour-duplicates.js';
import { maybeStartEligibilityTour } from './tour-eligibility.js';
import { renderUpstream, renderDownstream } from './tree-renderers.js';
import { renderSpeaker, canonicalisePriority, canonicaliseEligibility } from './speaker-view.js';
import { renderDuplicates, ALL_SPEAKERS, getSelectedDuplicateSpeaker } from './duplicates-view.js';
import { renderEligibility } from './eligibility-view.js';
import { parseUrlState, serializeUrlState, urlStateKey } from './url.js';
import { setActiveGame, getActiveGame, resolveGame, speakers, getDefaultDialogue, games } from './data.js';
import { buildLinesIndex } from './search-text.js';
import { buildNameIndex } from './search-name.js';
import { buildSpeakerIndex } from './search-speaker.js';
import { canonicalSpeakerId, resetSpeakerGroups } from './speaker-groups.js';
import { renderGameToggle, updateFavicon } from './game-toggle.js';
import { refreshSaveStatus } from './save-upload.js';
import { getSaveProgress, saveMatchesActiveGame, getSaveGameId } from './save-parser.js';

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

// Navigate to the eligibility tracer view for a given dialogue (the in-panel
// "Trace eligibility" button, the clickable status pill, and eligibility search
// results all pass an explicit name).
export function navigateToEligibility(dialogueName) {
    navigateToState({ view: 'eligibility', dialogue: dialogueName || null });
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
    // Carries the live speaker selection (read after the re-render, so a
    // selection the new filter dropped is reflected) so typing never
    // clobbers the ``dup`` key.
    if (_dupSearchTimer !== null) clearTimeout(_dupSearchTimer);
    _dupSearchTimer = setTimeout(() => {
        _dupSearchTimer = null;
        const fullState = { game: getActiveGame(), view: 'duplicates' };
        if (query) fullState.q = query;
        const selected = getSelectedDuplicateSpeaker();
        if (selected !== ALL_SPEAKERS) fullState.dup = selected;
        const serialized = serializeUrlState(fullState);
        urlSelection = serialized;
        window.location.hash = serialized;
    }, 300);
}

// Select a speaker in the duplicates master list. Persists the selection
// in the ``dup`` URL key (omitted for the "All" pseudo-speaker so default
// URLs stay clean) and refreshes the detail pane via a table-only render
// so the master-list scroll position and the live search input are kept.
// Wired to the speaker buttons via an inline ``onclick`` handler. Sets the
// ``urlSelection`` guard so the resulting ``hashchange`` doesn't trigger a
// redundant full re-render.
export function selectDuplicateSpeaker(name) {
    const input = document.querySelector('.duplicates-search');
    const q = input ? input.value : '';
    const state = { game: getActiveGame(), view: 'duplicates' };
    if (q) state.q = q;
    if (name !== ALL_SPEAKERS) state.dup = name;
    const serialized = serializeUrlState(state);
    urlSelection = serialized;
    window.location.hash = serialized;
    renderDuplicates({ q, dup: name, _bodyOnly: true });
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
    renderGameToggle();
    updateFavicon(gameId);
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
    // During a tour step flagged ``blockNavigation`` the engine sets this
    // class so the user can expand/collapse rows and read tooltips without a
    // click navigating to a different dialogue and stranding the tour.
    if (typeof document !== 'undefined' && document.body
        && document.body.classList.contains('tour-no-nav')) {
        return;
    }
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

// --- First-visit landing -------------------------------------------
//
// On a user's very first arrival at the home state (no ``hde.visited``
// flag AND an empty URL hash), land on the build-time featured dialogue
// (see ``getDefaultDialogue``) instead of a blank panel, routing through
// ``navigateToState`` so the URL hash reflects where we are. The flag is
// then recorded so every later empty-hash visit shows the genuine "no
// dialogue" home state - the user can always navigate back to a blank
// view. A first visit that deep-links straight to an entity does NOT
// consume the flag, so the landing still fires the first time they reach
// the bare home page. The onboarding tour is intended to hook into this
// same first-visit branch (gated by the same flag).
const _VISITED_KEY = 'hde.visited';

function _hasVisited() {
    try {
        return typeof localStorage !== 'undefined'
            && localStorage.getItem(_VISITED_KEY) === '1';
    } catch {
        return false;
    }
}

function _markVisited() {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(_VISITED_KEY, '1');
        }
    } catch {
        // Storage unavailable (private mode, disabled): treat every visit
        // as a return visit so we never get stuck re-landing.
    }
}

// Returns true when it performed the first-visit redirect (so the caller
// can let the resulting hash drive the render and skip the normal apply).
// No-op (false) on return visits, when the URL already names an entity,
// or when no featured dialogue is configured for the active game.
export function applyFirstVisitLanding() {
    if (_hasVisited()) return false;
    const state = parseUrlState(window.location.hash);
    if (state.dialogue || state.speaker || state.view || state.q) return false;
    _markVisited();
    const featured = getDefaultDialogue();
    if (!featured) return false;
    navigateToState({ view: 'dialogue', dialogue: featured });
    return true;
}

// Decide where to send a visitor who lands on the eligibility view with no
// usable save for the active game - a reload after localStorage was cleared,
// a hand-typed URL, or an external link. Returns the named dialogue's detail
// view if one is active, otherwise the home state; null when the save is
// usable and the tracer should render. Pure (no save/DOM reads) so the
// decision is unit-testable; the caller owns the navigateToState redirect.
export function eligibilityRedirectTarget(hasUsableSave, dialogue) {
    if (hasUsableSave) return null;
    return dialogue ? { view: 'dialogue', dialogue } : {};
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
        // Onboarding: first time a speaker overview actually renders, offer
        // the speaker tour (no-op on later visits / when opted out).
        if (speakerId) maybeStartSpeakerTour();
        return;
    }
    if (view === 'duplicates') {
        applyLayoutMode('duplicates');
        renderDuplicates({
            q: state.q || '',
            dup: state.dup || '',
        });
        const searchInput = document.getElementById('search');
        if (searchInput) searchInput.value = '';
        // Onboarding: first time the duplicates view renders, offer its tour.
        maybeStartDuplicatesTour();
        return;
    }
    if (view === 'eligibility') {
        const redirect = eligibilityRedirectTarget(
            !!getSaveProgress() && saveMatchesActiveGame(), state.dialogue || null);
        if (redirect) {
            navigateToState(redirect);
            return;
        }
        applyLayoutMode('eligibility');
        const name = state.dialogue || null;
        renderEligibility(name);
        const searchInput = document.getElementById('search');
        if (searchInput) searchInput.value = name || '';
        // Onboarding: first time the tracer renders for a dialogue (the save is
        // guaranteed usable here, else the redirect above fired), offer its tour.
        if (name) maybeStartEligibilityTour();
        return;
    }
    applyLayoutMode('dialogue');
    const name = state.dialogue || null;
    if (name) {
        selectTextline(name);
        document.getElementById('search').value = name;
        // Onboarding: first time a dialogue detail renders, offer the home
        // tour - covers both the first-visit landing and a deep link to a
        // specific dialogue. Runs on the open dialogue, not a forced default.
        maybeStartHomeTour();
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
// save file is loaded).
export function forceRefresh() {
    urlSelection = '';
    applyHashFromUrl();
}

// On a freshly loaded save, switch the active game to the one the save
// belongs to so its progress shows immediately - a user may load a Hades 1
// save while the viewer is on its default Hades II view. Returns true if it
// switched (so the caller can skip a redundant refresh); no-op when the save
// already matches the active game.
//
// Unlike the game-toggle (which keeps the current entity so a cross-game
// duplicate stays put), this is a side effect of loading a save, so it must
// not strand the user on a now-broken view: textline / speaker names are not
// shared across games, so a carried-over ``dialogue`` / ``speaker`` usually
// doesn't resolve in the save's game. Carry the entity over only when it
// actually exists in the target game; otherwise land on that game's clean
// home. The cross-game duplicates view (no per-game entity) is always kept.
export function syncActiveGameToSave() {
    const saveGame = getSaveGameId();
    if (!saveGame || saveGame === getActiveGame()) return false;
    const prev = parseUrlState(window.location.hash);
    const targetData = (games && games[saveGame]) || {};
    const target = { game: saveGame };
    if (prev.view === 'duplicates') {
        target.view = 'duplicates';
        if (prev.dup) target.dup = prev.dup;
        if (prev.q) target.q = prev.q;
    } else if (prev.speaker && targetData.speakers && targetData.speakers[prev.speaker]) {
        target.view = 'speaker';
        target.speaker = prev.speaker;
        if (prev.priority) target.priority = prev.priority;
        if (prev.eligibility) target.eligibility = prev.eligibility;
    } else if (prev.dialogue && targetData.textlines && targetData.textlines[prev.dialogue]) {
        // Keep dialogue + eligibility views (both keyed on a real textline).
        target.view = (prev.view === 'eligibility') ? 'eligibility' : 'dialogue';
        target.dialogue = prev.dialogue;
    }
    navigateToState(target);
    return true;
}
