// Onboarding tour dispatch + play-once persistence.
//
// Wraps the tour.js player with the gating the onboarding feature needs:
//   - global opt-out  (hde.tours.disabled)
//   - per-tour "seen" set  (hde.toursSeen)
// localStorage is used (not cookies) to match the rest of the viewer's
// client state (hde.save, hde.visited).
//
// The per-view / per-feature tours register their dispatch by calling
// ``maybeStartTour(id, steps, opts)`` from their own hook points (first
// visit, the applyState view dispatcher, the save-loaded event). The replay
// control (the floating "?" help button) clears the flags and re-runs the
// onboarding via a dispatcher the wiring registers with ``setReplayDispatcher``.

import { startTour, isTourActive } from './tour.js';

const _SEEN_KEY = 'hde.toursSeen';
const _DISABLED_KEY = 'hde.tours.disabled';

// localStorage is absent under Node (tests) and can throw in private mode;
// every access goes through this guard.
function _ls() {
    try {
        return (typeof localStorage !== 'undefined') ? localStorage : null;
    } catch {
        return null;
    }
}

export function toursDisabled() {
    const s = _ls();
    return !!s && s.getItem(_DISABLED_KEY) === '1';
}

export function setToursDisabled(disabled) {
    const s = _ls();
    if (!s) return;
    try {
        if (disabled) s.setItem(_DISABLED_KEY, '1');
        else s.removeItem(_DISABLED_KEY);
    } catch {
        // Storage unavailable - nothing to persist.
    }
}

function _seenSet() {
    const s = _ls();
    if (!s) return new Set();
    try {
        const v = JSON.parse(s.getItem(_SEEN_KEY) || '[]');
        return new Set(Array.isArray(v) ? v : []);
    } catch {
        return new Set();
    }
}

export function hasSeenTour(id) {
    return _seenSet().has(id);
}

function _markSeen(id) {
    const s = _ls();
    if (!s) return;
    const set = _seenSet();
    set.add(id);
    try {
        s.setItem(_SEEN_KEY, JSON.stringify([...set]));
    } catch {
        // Storage unavailable - the tour just re-offers next time.
    }
}

// Clear all onboarding state: every tour becomes unseen and the global
// opt-out is lifted. Used by the replay control.
export function resetTours() {
    const s = _ls();
    if (!s) return;
    try {
        s.removeItem(_SEEN_KEY);
        s.removeItem(_DISABLED_KEY);
    } catch {
        // Nothing to clear.
    }
}

// Wrap the caller's callbacks so finishing / skipping / opting out always
// records the tour as seen (and opting out also disables the rest).
function _wrapCallbacks(id, opts) {
    return {
        onDone() { _markSeen(id); if (opts.onDone) opts.onDone(); },
        onSkip() { _markSeen(id); if (opts.onSkip) opts.onSkip(); },
        onDisableAll() {
            setToursDisabled(true);
            _markSeen(id);
            if (opts.onDisableAll) opts.onDisableAll();
        },
    };
}

// Start a tour once. No-op (returns false) when tutorials are globally
// disabled, this tour was already seen, or another tour is on screen.
export function maybeStartTour(id, steps, opts = {}) {
    if (!id || !Array.isArray(steps) || steps.length === 0) return false;
    if (toursDisabled() || hasSeenTour(id) || isTourActive()) return false;
    return startTour(steps, _wrapCallbacks(id, opts));
}

// Force-start a tour regardless of the seen / disabled flags (the replay
// path). Still a no-op while another tour is running.
export function forceStartTour(id, steps, opts = {}) {
    if (!id || !Array.isArray(steps) || steps.length === 0 || isTourActive()) return false;
    return startTour(steps, _wrapCallbacks(id, opts));
}

// The wiring registers a dispatcher that knows which tour fits the current
// view, so the replay control can re-run the relevant onboarding after a
// reset. Null until a tour module registers one.
let _replayDispatch = null;

export function setReplayDispatcher(fn) {
    _replayDispatch = (typeof fn === 'function') ? fn : null;
}

// Replay control: forget everything, then re-dispatch onboarding for the
// current view (if a dispatcher has been registered).
export function replayTours() {
    if (isTourActive()) return;
    resetTours();
    if (_replayDispatch) _replayDispatch();
}
