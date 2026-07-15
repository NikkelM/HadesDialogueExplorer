// Custom mouse-following tooltip system.
//
// Replaces the browser's native ``title`` attribute so the
// viewer can offer a tooltip surface with:
//
//   - consistent styling across browsers / OSes (the native ``title``
//     popup is OS-themed and visually clashes with the dark theme),
//   - no half-second show delay,
//   - explicit multi-line support (``\n`` honoured via CSS
//     ``white-space: pre-line``),
//   - cursor-following positioning that feels like a native popup,
//   - viewport-edge clamping so tooltips never clip off-screen.
//
// Activation contract: any element with a ``data-tooltip="..."``
// attribute gets the floating tooltip on hover. Both static HTML and
// dynamically-created elements work because the listeners are attached
// once at boot via event delegation on ``document``.
//
// The previous implementation used HTML ``title`` attributes; renderers
// were migrated wholesale to emit ``data-tooltip`` instead. CSS hover
// affordances (dotted underlines + help cursor) in
// ``styles/panels-tooltips.css`` use the matching ``[data-tooltip]``
// attribute selector so the visual hint follows the same single source
// of truth as the floating popup.

// Offsets from the cursor to the tooltip's top-left corner. Picked so
// the popup sits just below + right of the pointer like the native
// browser tooltip would, without obscuring the underlying element.
const OFFSET_X = 14;
const OFFSET_Y = 18;

// Padding from the viewport edge when the tooltip would otherwise
// overflow - flips to the opposite side of the cursor with this much
// gap so it never touches the window border.
const EDGE_MARGIN = 4;

let tooltipEl = null;
let currentTarget = null;
// Auto-hide timer for the touch path, and a timestamp guard so the
// synthetic mouse events a browser fires after a tap don't re-run the
// hover handlers (which would re-position the popup at the tap point).
let touchHideTimer = null;
let lastTouchTime = 0;
const TOUCH_GUARD_MS = 600;
const TOUCH_SHOW_MS = 3500;

// Walk up from ``node`` looking for an ancestor with ``[data-tooltip]``.
// ``mouseover`` / ``mousemove`` fire on inner descendants, so the
// nearest tooltip-bearing ancestor is what we want to attribute the
// hover to. Returns ``null`` for non-element nodes (text nodes during
// ``mouseout.relatedTarget`` transitions).
function findTooltipTarget(node) {
    if (!node || node.nodeType !== 1) return null;
    if (typeof node.closest !== 'function') return null;
    return node.closest('[data-tooltip]');
}

// True if a tap on ``node`` (or any ancestor) activates a control - an
// anchor / button / input, an inline ``onclick``, an ARIA widget role, or
// anything styled clickable (``cursor: pointer``, which is how this codebase
// marks its JS-wired rows). Used to suppress the touch tooltip on
// interactive triggers so it can never flash before the tap's own action
// (navigation / expand) runs.
function isInteractiveTap(node) {
    for (let el = node; el && el.nodeType === 1 && el !== document.body; el = el.parentElement) {
        const tag = el.tagName;
        if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
        if (el.hasAttribute('onclick')) return true;
        const role = el.getAttribute('role');
        if (role === 'button' || role === 'tab' || role === 'option') return true;
        if (getComputedStyle(el).cursor === 'pointer') return true;
    }
    return false;
}

// Glue bracket / brace / paren delimiters to their adjacent token with a
// non-breaking space, so a lone ``}`` / ``)`` / ``]`` (or ``{`` / ``(`` /
// ``[``) can never wrap onto a row of its own in the tooltip. The breakable
// ``, `` joins inside a list are left untouched, so long lists still wrap.
export function noOrphanDelims(text) {
    return text
        .replace(/([([{]) /g, '$1\u00A0')
        .replace(/ ([)\]}])/g, '\u00A0$1');
}

function showFor(target, clientX, clientY) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    // Suppress while a native ``<select>`` is focused - i.e. its dropdown is
    // open. The OS renders the option list over the trigger, and this
    // cursor-following popup would otherwise float on top of / just below the
    // open list (the ``focusin`` handler in ``initTooltip`` hides an
    // already-visible one the moment the dropdown opens; this guard stops
    // ``mousemove`` from re-showing it while the select stays focused).
    if (target.tagName === 'SELECT' && document.activeElement === target) return;
    currentTarget = target;
    tooltipEl.textContent = noOrphanDelims(text);
    tooltipEl.classList.add('visible');
    positionAt(clientX, clientY);
}

function hide() {
    if (!currentTarget) return;
    currentTarget = null;
    clearTimeout(touchHideTimer);
    tooltipEl.classList.remove('visible');
}

// Touch path: reveal the tooltip anchored above the tapped element (not at
// the finger, which would occlude it) and auto-dismiss. Only called for
// non-interactive triggers (the touchstart handler filters clickable ones
// out), so it never competes with a tap's own navigation / expand action.
function showForTouch(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    currentTarget = target;
    tooltipEl.textContent = noOrphanDelims(text);
    tooltipEl.classList.add('visible');
    positionAboveRect(target.getBoundingClientRect());
    clearTimeout(touchHideTimer);
    touchHideTimer = setTimeout(hide, TOUCH_SHOW_MS);
}

// Centre the tooltip over the trigger and sit it just above; drop below if
// there isn't room above. Clamped to the viewport horizontally.
function positionAboveRect(rect) {
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    const vw = window.innerWidth || 0;
    let x = rect.left + rect.width / 2 - tw / 2;
    if (vw) x = Math.max(EDGE_MARGIN, Math.min(x, vw - tw - EDGE_MARGIN));
    let y = rect.top - th - 8;
    if (y < EDGE_MARGIN) y = rect.bottom + 8;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
}

// Position the tooltip at the cursor + offset, flipping to the other
// side of the cursor if it would otherwise clip past the viewport
// edge. ``offsetWidth``/``offsetHeight`` are read AFTER the textContent
// is set so the measurement reflects the wrapped multi-line size.
function positionAt(clientX, clientY) {
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    const vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    let x = clientX + OFFSET_X;
    let y = clientY + OFFSET_Y;
    if (vw && x + tw + EDGE_MARGIN > vw) {
        x = Math.max(EDGE_MARGIN, clientX - OFFSET_X - tw);
    }
    if (vh && y + th + EDGE_MARGIN > vh) {
        y = Math.max(EDGE_MARGIN, clientY - OFFSET_Y - th);
    }
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
}

// Idempotent boot. ``init.js`` calls this once; re-entrant calls (e.g.
// from a future hot-reload path) are no-ops so a second tooltip
// element never gets appended to the body.
export function initTooltip() {
    if (tooltipEl) return;
    if (!document || !document.body || typeof document.createElement !== 'function') return;

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'custom-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);

    // ``mouseover`` bubbles, so a single delegated listener catches
    // hovers on every descendant. We only switch targets when the
    // ancestor with ``[data-tooltip]`` actually changes, so moving the
    // cursor among children of the same tooltip-bearing element doesn't
    // flicker the popup.
    document.addEventListener('mouseover', (e) => {
        if (Date.now() - lastTouchTime < TOUCH_GUARD_MS) return;
        const target = findTooltipTarget(e.target);
        if (!target) return;
        if (target !== currentTarget) {
            showFor(target, e.clientX, e.clientY);
        }
    });

    // ``mouseout`` fires for every nested element transition. Use
    // ``relatedTarget`` to detect "really left the target": only hide
    // when the cursor moves to an element that is NOT inside the
    // current tooltip target.
    document.addEventListener('mouseout', (e) => {
        if (Date.now() - lastTouchTime < TOUCH_GUARD_MS) return;
        if (!currentTarget) return;
        const next = e.relatedTarget;
        if (next && typeof currentTarget.contains === 'function' && currentTarget.contains(next)) {
            return;
        }
        hide();
    });

    // Cursor-follow: re-position on every move while the tooltip is
    // active. Also covers the case where mouseover never fired (rare,
    // but possible during fast cursor movement entering from outside
    // the window) by promoting to a new target if one is found.
    document.addEventListener('mousemove', (e) => {
        if (Date.now() - lastTouchTime < TOUCH_GUARD_MS) return;
        if (!currentTarget) return;
        const target = findTooltipTarget(e.target);
        if (target === currentTarget) {
            positionAt(e.clientX, e.clientY);
        } else if (target) {
            showFor(target, e.clientX, e.clientY);
        } else {
            hide();
        }
    });

    // Touch path: a tap on a non-interactive ``[data-tooltip]`` element
    // reveals its tooltip (the only way touch users can read it); a tap
    // elsewhere dismisses an open one. Interactive triggers are skipped so
    // the tooltip never flashes before their own tap action runs. ``passive``
    // so that action still fires.
    document.addEventListener('touchstart', (e) => {
        lastTouchTime = Date.now();
        const target = findTooltipTarget(e.target);
        if (!target || isInteractiveTap(e.target)) {
            if (currentTarget) hide();
            return;
        }
        showForTouch(target);
    }, { passive: true });

    // A scroll gesture (touchmove) drops a revealed tooltip - it's
    // position:fixed, so leaving it up while the content scrolls would
    // strand it away from its trigger.
    document.addEventListener('touchmove', () => {
        lastTouchTime = Date.now();
        if (currentTarget) hide();
    }, { passive: true });

    // Hide on scroll-wheel: the tooltip is ``position: fixed`` so it
    // stays put in viewport coordinates while the underlying element
    // shifts. Keeping it visible during a scroll looks broken because
    // the cursor-to-content alignment drifts.
    document.addEventListener('wheel', () => {
        if (currentTarget) hide();
    }, { passive: true });

    // Escape dismisses the popup even if the cursor still hovers the
    // trigger - matches the convention for transient overlays.
    document.addEventListener('keydown', (e) => {
        if (currentTarget && e.key === 'Escape') hide();
    });

    // Opening a native ``<select>`` focuses it; hide any visible tooltip so it
    // can't sit over the OS-rendered option list. ``showFor``'s matching guard
    // keeps it from re-appearing on ``mousemove`` while the select stays
    // focused (the dropdown is open). Closing the select blurs it, so hovering
    // the trigger again shows the tooltip as normal.
    document.addEventListener('focusin', (e) => {
        if (e.target && e.target.tagName === 'SELECT') hide();
    });
}
