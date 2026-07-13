// Privacy-respecting, aggregate usage analytics.
//
// A silent, fire-and-forget beacon that records *what content* people look
// at (which dialogues / speakers, whether the tracer or a save is used) so
// the maintainer can see usage trends and pick better defaults. It is
// deliberately invisible: no UI, no consent banner, and nothing here ever
// throws into the page - analytics must never degrade the viewer.
//
// What is (and isn't) collected:
//   - Aggregate COUNTS only, keyed by content: ``{type, game, id?}``.
//     Example: ``dialogue_view`` of ``Hades_0042`` under ``hades2``.
//   - NO cookies, NO persistent id, NO fingerprint, NO stored IP, NO PII,
//     NO cross-session linkage. A single ``sessionStorage`` flag (cleared when
//     the tab closes) dedups the once-per-visit counters; it is not an
//     identifier and never leaves the browser.
//   - The ``save_loaded`` event carries ONLY ``{type, game}`` - never the
//     save file, its name, or any progress. The "your save never leaves your
//     browser" promise stays literally true.
//
// Where it goes: a same-origin ``POST`` to ``api/event`` (relative, so it
// resolves to ``<deploy-root>/api/event``). On the hosted build a Cloudflare
// Worker on that route validates + counts it into D1; anywhere else (the
// offline ``file://`` bundle, a GitHub Pages preview, local dev) the request
// simply 404s or is skipped, which is harmless because sendBeacon is
// fire-and-forget. Because the target is same-origin, the existing
// ``connect-src 'self'`` CSP already permits it - no CSP change is needed.
//
// Event model:
//   session_start     once per tab visit (survives reloads; ratio denominator)
//   dialogue_view     each dialogue opened      (id = textline name)   total, debounced
//   speaker_view      each speaker view opened  (id = canonical speaker id) total, debounced
//   eligibility_view  the tracer opened for a dialogue (id = textline name) total, debounced
//   save_loaded       a save present (uploaded or restored from a prior visit) once per tab visit
//
// ``dialogue_view`` / ``speaker_view`` / ``eligibility_view`` are total-view
// counters (every open counts) with a short debounce that only collapses an
// *identical* event firing twice in quick succession (the hashchange can
// double-fire). ``session_start`` and ``save_loaded`` are per-tab-visit
// counters (deduped via a sessionStorage flag so an in-page reload does not
// re-count), so ``save_loaded`` divides cleanly by ``session_start`` to give
// the "share of visits that had a save" without any per-user identifier.
// A "visit" is one browser-tab session: it spans in-page navigation AND
// reloads, and ends when the tab is closed.
//
// First-visit exception: a brand-new visitor is auto-redirected from the bare
// home page to the build-time featured dialogue (navigation.js
// applyFirstVisitLanding). That single automatic landing is NOT counted as a
// ``dialogue_view`` - it is a default, not a choice - so ``initAnalytics`` is
// told to swallow it. Genuine later visits to that dialogue, including a shared
// deep link straight to it, still count normally.

import { parseUrlState } from './url.js';
import { getActiveGame } from './data.js';
import { canonicalIdForSpeakerName } from './speaker-groups.js';
import { getSaveProgress, getSaveGameId } from './save-parser.js';

// Same-origin, relative to the deployed app root (no leading slash so it
// works whether the app is hosted at a domain root or a sub-path). Resolves
// against the document base URL, which never carries the viewer's hash, so it
// is stable across every in-app navigation.
const ANALYTICS_ENDPOINT = 'api/event';

// Collapse an identical view event that repeats within this window (the
// hashchange event can fire twice for one navigation). Distinct views, or the
// same view revisited later, still each count.
const ANALYTICS_VIEW_DEBOUNCE_MS = 1000;

// Once-per-page-load guard for the session-scoped events (keyed ``type|game``).
// Once-per-tab-visit flags for ``session_start`` / ``save_loaded``. Persisted
// in ``sessionStorage`` so they survive an in-page reload (which re-boots the
// JS but keeps sessionStorage), making a "visit" a browser-tab session rather
// than a single page load; sessionStorage clears when the tab closes. Falls
// back to an in-memory Set (degrading to once-per-page-load) when
// sessionStorage is unavailable (private mode / blocked storage).
const _analyticsMemFlags = new Set();
const _ANALYTICS_FLAG_PREFIX = 'hde.a.';

// Last emitted view event + timestamp, for the debounce above.
let _analyticsLastViewKey = '';
let _analyticsLastViewAt = 0;

// Set true by ``initAnalytics`` once the environment passes the guards, so the
// registered listeners can early-out cheaply on a later opt-out edge case.
let _analyticsActive = false;

// One-shot guard for the automatic first-visit landing on the featured
// dialogue. When ``initAnalytics`` is told the boot performed that redirect
// (navigation.js applyFirstVisitLanding), it stores the landed dialogue id
// here. The first dialogue_view processed after init - the async ``hashchange``
// the redirect emits - reads and clears this guard; if the id matches, that one
// view is swallowed instead of counted. Clearing on the first view means a
// genuine later visit to the same dialogue can never be swallowed. Null the
// rest of the time.
let _analyticsSkipLandingDialogueId = null;

// Wire up the beacon. No-op (registers nothing) when analytics is disabled for
// this environment - the offline bundle or a Do-Not-Track browser - so those
// users never emit a single request. Safe to call exactly once, at the end of
// boot (see init.js), after navigation has registered its own hashchange /
// save-loaded listeners so this one runs last and reads already-applied state.
export function initAnalytics(opts) {
    if (!_analyticsEnabled()) return;
    _analyticsActive = true;

    // One session marker per tab visit (survives reloads via sessionStorage),
    // attributed to the landing game.
    _analyticsSendOnce('session_start', _analyticsGameFor(parseUrlState(_analyticsHash())));
    // A save restored from a previous visit (rehydrated into memory by
    // restoreSavedSave() before this runs) counts as a save being loaded, so
    // the "had a save" share reflects returning users too - not just fresh
    // uploads. Deduped once per visit alongside the active-upload path below.
    _analyticsCountSaveIfPresent();
    if (opts && opts.skipLandingView) {
        // First-ever visit: the boot redirected the bare home page to the
        // build-time featured dialogue and wrote it into the hash, which also
        // queues an async ``hashchange`` our listener below will receive. That
        // automatic landing is a default, not a user choice, so arm a one-shot
        // guard to swallow exactly that single ``dialogue_view`` rather than
        // let the featured dialogue out-count everything on new arrivals alone.
        _analyticsSkipLandingDialogueId = parseUrlState(_analyticsHash()).dialogue || null;
    } else {
        // Count the view the user actually landed on (a shared deep link, or a
        // returning visitor's restored hash); the bare home state emits nothing
        // beyond session_start.
        _analyticsTrackHash();
    }

    window.addEventListener('hashchange', _analyticsTrackHash);
    // Active upload: the save is parsed into memory before ``save-loaded`` is
    // dispatched, so the same presence check + once-per-visit dedup applies.
    window.addEventListener('save-loaded', _analyticsCountSaveIfPresent);
}

// Emit ``save_loaded`` (once per visit) when a save is currently loaded -
// whether it was just uploaded or restored from a prior visit. Keyed to the
// save's own game. Best-effort; never throws.
function _analyticsCountSaveIfPresent() {
    if (!_analyticsActive) return;
    try {
        if (!getSaveProgress()) return;
        const game = getSaveGameId() || _analyticsGameFor(parseUrlState(_analyticsHash()));
        _analyticsSendOnce('save_loaded', game);
    } catch {
        // Analytics is best-effort; swallow everything.
    }
}

// True only on a real http(s) origin with Do-Not-Track unset. The offline
// single-file bundle runs from ``file://`` and must stay completely silent;
// DNT is honoured as a courtesy even though the data is anonymous + aggregate.
function _analyticsEnabled() {
    try {
        const loc = window.location;
        if (!loc || !/^https?:$/.test(loc.protocol || '')) return false;
        return !_analyticsDntEnabled();
    } catch {
        return false;
    }
}

function _analyticsDntEnabled() {
    try {
        const nav = window.navigator || {};
        const dnt = nav.doNotTrack || window.doNotTrack || nav.msDoNotTrack;
        return dnt === '1' || dnt === 'yes';
    } catch {
        return false;
    }
}

function _analyticsHash() {
    try {
        return window.location.hash || '';
    } catch {
        return '';
    }
}

// The game an event belongs to: the hash's ``game=`` (always present on
// in-app navigations) with the active game as a fallback for hand-typed URLs
// that omit it. Unknown ids pass through - the Worker validates them.
function _analyticsGameFor(state) {
    return (state && state.game) || getActiveGame() || '';
}

// Map the current hash to an event and emit it. Wrapped so a malformed hash or
// a helper hiccup can never bubble into the page's hashchange handling.
function _analyticsTrackHash() {
    if (!_analyticsActive) return;
    try {
        const state = parseUrlState(_analyticsHash());
        const game = _analyticsGameFor(state);
        const view = (state.view || (state.dialogue ? 'dialogue' : '')).toLowerCase();
        if (view === 'speaker') {
            const ref = state.speaker;
            if (!ref) return;
            // Key by the stable canonical speaker id, not the friendly display
            // name (which localisation can change), so counts stay comparable
            // across builds. Falls back to the raw ref for unknown speakers.
            const id = canonicalIdForSpeakerName(ref) || ref;
            _analyticsTrackView('speaker_view', game, id);
        } else if (view === 'duplicates') {
            // Cross-game duplicates view: not tracked. Explicit branch so a
            // duplicates hash never falls through to a dialogue_view.
        } else if (view === 'eligibility') {
            // Per-dialogue tracer-open total (which dialogues get traced most).
            if (state.dialogue) _analyticsTrackView('eligibility_view', game, state.dialogue);
        } else if (state.dialogue) {
            // The first-visit landing guard is one-shot: it only ever applies to
            // the first dialogue_view processed after init (the async hashchange
            // the auto-redirect emits). Reading AND clearing it here means a
            // genuine later visit to the featured dialogue can never be swallowed.
            const skipId = _analyticsSkipLandingDialogueId;
            _analyticsSkipLandingDialogueId = null;
            if (skipId && state.dialogue === skipId) return;
            _analyticsTrackView('dialogue_view', game, state.dialogue);
        }
    } catch {
        // Analytics is best-effort; swallow everything.
    }
}

// A total-view counter with the short identical-repeat debounce.
function _analyticsTrackView(type, game, id) {
    const key = type + '|' + game + '|' + id;
    const now = Date.now();
    if (key === _analyticsLastViewKey && (now - _analyticsLastViewAt) < ANALYTICS_VIEW_DEBOUNCE_MS) {
        return;
    }
    _analyticsLastViewKey = key;
    _analyticsLastViewAt = now;
    _analyticsSend(type, game, id);
}

// A per-tab-visit counter: emitted at most once per ``type`` per visit (the
// flag lives in sessionStorage so a reload does not re-count), so its total
// across visits is a count of distinct tab visits.
function _analyticsSendOnce(type, game) {
    if (_analyticsSessionHas(type)) return;
    _analyticsSessionAdd(type);
    _analyticsSend(type, game, null);
}

function _analyticsSessionHas(key) {
    try {
        const ss = window.sessionStorage;
        if (ss && ss.getItem(_ANALYTICS_FLAG_PREFIX + key)) return true;
    } catch {
        // sessionStorage unavailable - fall back to the in-memory flag.
    }
    return _analyticsMemFlags.has(key);
}

function _analyticsSessionAdd(key) {
    _analyticsMemFlags.add(key);
    try {
        const ss = window.sessionStorage;
        if (ss) ss.setItem(_ANALYTICS_FLAG_PREFIX + key, '1');
    } catch {
        // sessionStorage unavailable - the in-memory flag still dedups within
        // this page load.
    }
}

// Fire-and-forget the beacon. Never throws; errors (offline, blocked, 404 on a
// non-Worker host) are ignored by design.
function _analyticsSend(type, game, id) {
    try {
        const payload = { type, game };
        if (id) payload.id = id;
        const body = JSON.stringify(payload);
        const nav = window.navigator;
        if (nav && typeof nav.sendBeacon === 'function') {
            nav.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: 'application/json' }));
        } else if (typeof fetch === 'function') {
            // ``keepalive`` lets the POST outlive an unloading page like
            // sendBeacon does; ``credentials: 'omit'`` keeps it cookieless.
            fetch(ANALYTICS_ENDPOINT, {
                method: 'POST',
                body,
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                credentials: 'omit',
            }).catch(() => {});
        }
    } catch {
        // Ignore - analytics must never surface an error to the user.
    }
}
