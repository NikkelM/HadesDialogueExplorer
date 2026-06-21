// Guided onboarding tour engine (vanilla, dependency-free).
//
// ``startTour(steps, opts)`` runs a sequence of coachmark steps: a dim
// overlay + spotlight highlight over each step's target element, and a card
// with Back / Next / Skip plus a "Don't show tutorials again" opt-out.
// Works on desktop and mobile (the card becomes a bottom sheet on phones via
// styles/tour.css; positions are recomputed on resize / scroll).
//
// Persistence and the play-once gating live in ``tours.js`` - this module is
// just the player. A step is ``{ target, title, body }`` where ``target`` is
// a CSS selector, an element, a function returning one, or null/undefined for
// a centred no-target step (whole screen dimmed). A targeted step whose
// element is missing degrades to the centred presentation.

const _PAD = 6;        // spotlight padding around the target, px
const _GAP = 12;       // card gap from the viewport edge, px
// Card distance from the highlighted target. Larger than _GAP so the card
// clears the spotlight ring (which already extends ~_PAD beyond the target)
// and leaves a comfortable visible gap below / above the highlight.
const _CARD_GAP = 24;

let _active = false;
let _steps = [];
let _index = 0;
let _cb = {};
let _prevFocus = null;
// DOM refs for the current run.
let _overlay = null;
let _spotlight = null;
let _card = null;
let _titleEl = null;
let _textEl = null;
let _stepEl = null;
let _backBtn = null;
let _nextBtn = null;
// Tracks the current target's size so the spotlight follows content changes
// (e.g. expanding a tree row inside an interactive step).
let _resizeObs = null;

// True while a tour is on screen; used by the dispatcher to avoid stacking.
export function isTourActive() {
    return _active;
}

function _isPhone() {
    try {
        return window.matchMedia('(max-width: 599px)').matches;
    } catch {
        return false;
    }
}

// Nearest scrollable ancestor (the element that actually scrolls when this
// target is brought into view), or null when the window scrolls.
function _scrollParent(el) {
    let n = el.parentElement;
    while (n) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
        n = n.parentElement;
    }
    return null;
}

// Resolve a step target to a visible element, or null (selector miss,
// detached node, or zero-size element -> treat as a no-target step).
function _resolveTarget(t) {
    let el = null;
    if (typeof t === 'function') {
        try { el = t(); } catch { el = null; }
    } else if (typeof t === 'string') {
        el = document.querySelector(t);
    } else if (t && t.nodeType === 1) {
        el = t;
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return el;
}

function _buildDom() {
    _overlay = document.createElement('div');
    _overlay.className = 'tour-overlay';

    _spotlight = document.createElement('div');
    _spotlight.className = 'tour-spotlight';

    _card = document.createElement('div');
    _card.className = 'tour-card';
    _card.setAttribute('role', 'dialog');
    _card.setAttribute('aria-modal', 'true');
    _card.setAttribute('aria-labelledby', 'tour-card-title');

    _titleEl = document.createElement('h3');
    _titleEl.className = 'tour-card-title';
    _titleEl.id = 'tour-card-title';

    _textEl = document.createElement('p');
    _textEl.className = 'tour-card-text';

    const footer = document.createElement('div');
    footer.className = 'tour-card-footer';
    _stepEl = document.createElement('span');
    _stepEl.className = 'tour-card-step';
    const skipBtn = document.createElement('button');
    skipBtn.className = 'tour-btn tour-btn-skip';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', _skip);
    _backBtn = document.createElement('button');
    _backBtn.className = 'tour-btn tour-btn-back';
    _backBtn.type = 'button';
    _backBtn.textContent = 'Back';
    _backBtn.addEventListener('click', _back);
    _nextBtn = document.createElement('button');
    _nextBtn.className = 'tour-btn tour-btn-next';
    _nextBtn.type = 'button';
    _nextBtn.textContent = 'Next';
    _nextBtn.addEventListener('click', _next);
    footer.append(_stepEl, skipBtn, _backBtn, _nextBtn);

    const disable = document.createElement('button');
    disable.className = 'tour-disable';
    disable.type = 'button';
    disable.textContent = "Don't show tutorials again";
    disable.addEventListener('click', _disableAll);

    _card.append(_titleEl, _textEl, footer, disable);
    document.body.append(_overlay, _spotlight, _card);
}

// Place the spotlight over the target (or 0-size centred for no-target) and
// the card beside it (a bottom sheet on phones, where CSS owns placement).
function _position() {
    if (!_active) return;
    const el = _resolveTarget(_steps[_index].target);
    if (el) {
        const r = el.getBoundingClientRect();
        _spotlight.style.top = (r.top - _PAD) + 'px';
        _spotlight.style.left = (r.left - _PAD) + 'px';
        _spotlight.style.width = (r.width + _PAD * 2) + 'px';
        _spotlight.style.height = (r.height + _PAD * 2) + 'px';
        _placeCard(r);
    } else {
        // No target: dim everything, centre the card.
        _spotlight.style.top = '50%';
        _spotlight.style.left = '50%';
        _spotlight.style.width = '0px';
        _spotlight.style.height = '0px';
        _placeCard(null);
    }
}

function _placeCard(targetRect) {
    if (_isPhone()) {
        // Bottom sheet: styles/tour.css owns left/right/bottom; clear any
        // desktop inline placement so it can take over.
        _card.style.top = '';
        _card.style.left = '';
        return;
    }
    const c = _card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!targetRect) {
        _card.style.top = Math.max(_GAP, (vh - c.height) / 2) + 'px';
        _card.style.left = Math.max(_GAP, (vw - c.width) / 2) + 'px';
        return;
    }
    // Prefer below the target; flip above if it would overflow the bottom.
    let top = targetRect.bottom + _CARD_GAP;
    if (top + c.height + _GAP > vh) {
        const above = targetRect.top - c.height - _CARD_GAP;
        top = above >= _GAP ? above : Math.max(_GAP, vh - c.height - _GAP);
    }
    let left = targetRect.left + targetRect.width / 2 - c.width / 2;
    left = Math.max(_GAP, Math.min(left, vw - c.width - _GAP));
    _card.style.top = top + 'px';
    _card.style.left = left + 'px';
}

function _show(i) {
    _index = Math.max(0, Math.min(i, _steps.length - 1));
    const step = _steps[_index];
    // Interactive steps let the user reach the highlighted target (e.g. to
    // hover a badge for its tooltip); the overlay otherwise blocks the page
    // so a stray click can't navigate away mid-tour. ``blockNavigation`` keeps
    // interaction (expand/collapse, tooltips) but suppresses navigation to a
    // different dialogue, so an interactive step can't strand the tour.
    _overlay.style.pointerEvents = step.interactive ? 'none' : 'auto';
    document.body.classList.toggle('tour-no-nav', !!step.blockNavigation);
    _titleEl.textContent = step.title || '';
    _titleEl.style.display = step.title ? '' : 'none';
    _textEl.textContent = step.body || '';
    _stepEl.textContent = (_index + 1) + ' / ' + _steps.length;
    _backBtn.disabled = _index === 0;
    _nextBtn.textContent = _index === _steps.length - 1 ? 'Done' : 'Next';
    const el = _resolveTarget(step.target);
    if (el) {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        if (r.height > vh) {
            // Target taller than the viewport (e.g. a long dialogue list):
            // centring jumps to its middle. Scroll the *minimum* needed - if
            // its top is already on-screen with room for the card above it,
            // don't scroll at all. Only scroll up when the card wouldn't fit
            // above, or down when the section is mostly below the fold.
            const cardH = _card.getBoundingClientRect().height;
            const bandTop = cardH + 2 * _CARD_GAP;
            const minVisible = 140;
            let delta = 0;
            if (r.top < bandTop) delta = r.top - bandTop;
            else if (r.top > vh - minVisible) delta = r.top - Math.round(vh * 0.6);
            if (delta !== 0) {
                const sc = _scrollParent(el);
                if (sc) sc.scrollTop += delta;
                else window.scrollBy(0, delta);
            }
        } else {
            // Normal target: only scroll if it isn't already fully visible,
            // and then minimally ('nearest'), so a step whose target is
            // already on screen doesn't jump the page.
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }
    _observeTarget(el);
    _position();
    _nextBtn.focus();
}

// Watch the current target so the spotlight tracks size changes the user
// causes mid-step (e.g. expanding a tree row in an interactive step), not
// just window resize / scroll. Re-observes per step; cleared on _end.
function _observeTarget(el) {
    if (_resizeObs) {
        _resizeObs.disconnect();
        _resizeObs = null;
    }
    if (el && typeof ResizeObserver !== 'undefined') {
        _resizeObs = new ResizeObserver(() => _position());
        _resizeObs.observe(el);
    }
}

function _next() {
    if (_index >= _steps.length - 1) {
        const done = _cb.onDone;
        _end();
        if (done) done();
        return;
    }
    _show(_index + 1);
}

function _back() {
    if (_index > 0) _show(_index - 1);
}

function _skip() {
    const skip = _cb.onSkip;
    _end();
    if (skip) skip();
}

function _disableAll() {
    const disable = _cb.onDisableAll;
    _end();
    if (disable) disable();
}

// Keep focus inside the card (so Tab can't reach the dimmed page) and let
// Esc skip the tour.
function _onKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        _skip();
        return;
    }
    if (e.key !== 'Tab') return;
    const focusable = _card.querySelectorAll('button:not([disabled])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

function _end() {
    if (!_active) return;
    _active = false;
    document.body.classList.remove('tour-open');
    document.body.classList.remove('tour-no-nav');
    window.removeEventListener('resize', _position);
    window.removeEventListener('scroll', _position, true);
    document.removeEventListener('keydown', _onKeydown, true);
    if (_resizeObs) {
        _resizeObs.disconnect();
        _resizeObs = null;
    }
    for (const el of [_overlay, _spotlight, _card]) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    _overlay = _spotlight = _card = null;
    _titleEl = _textEl = _stepEl = _backBtn = _nextBtn = null;
    _steps = [];
    _cb = {};
    if (_prevFocus && typeof _prevFocus.focus === 'function') {
        try { _prevFocus.focus(); } catch { /* element gone */ }
    }
    _prevFocus = null;
}

// Start a tour. ``steps`` is a non-empty array of ``{ target, title, body }``.
// ``opts``: { onDone, onSkip, onDisableAll }. Returns false (no-op) if a tour
// is already running, the steps are empty, or the DOM is unavailable.
export function startTour(steps, opts = {}) {
    if (_active) return false;
    if (!Array.isArray(steps) || steps.length === 0) return false;
    if (typeof document === 'undefined' || !document.body) return false;
    _active = true;
    _steps = steps;
    _cb = opts || {};
    _prevFocus = document.activeElement;
    document.body.classList.add('tour-open');
    _buildDom();
    window.addEventListener('resize', _position);
    window.addEventListener('scroll', _position, true);
    document.addEventListener('keydown', _onKeydown, true);
    _show(0);
    return true;
}
