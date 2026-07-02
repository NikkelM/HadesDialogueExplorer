// Draggable dividers for the three dialogue-view column panels
// (#panel-info | #panel-upstream | #panel-downstream).
//
// The panels are ``flex: 1 1 0`` children of ``<main>``, so their widths are
// pure flex-grow ratios. Two resizer handles sit on the inter-panel borders;
// dragging one shifts width between its two adjacent panels (the third is
// untouched) by re-weighting their grow ratios, keeping their combined width
// constant. Ratios (not pixels) are stored so the split survives window
// resizes. A per-panel minimum width is enforced during the drag.
//
// Desktop + dialogue-view only: the CSS shows the handles and applies the grow
// ratios solely under ``@media (min-width: 1025px) body.layout-dialogue`` - on
// the stacked mobile layout (<= 1024px) and the single-panel speaker /
// duplicates / eligibility views the handles are ``display: none`` and the
// ratios are ignored, so those layouts are unaffected.

const STORAGE_KEY = 'hde:panelGrow';
// Minimum on-screen width (px) each panel can be dragged to, keyed by panel.
// The details/info panel gets a larger floor so its dialogue text and long
// requirement rows stay readable instead of overflowing when dragged narrow.
// Their sum (380+260+260 = 900) stays under the 1025px desktop floor, so all
// three always fit above their minimums.
const PANEL_MIN_PX = { info: 380, upstream: 260, downstream: 260 };
// Fallback minimum for the pure math helper when no per-panel value is given.
const MIN_PANEL_PX = 240;
// Keyboard nudge step (px of width shifted per Arrow press).
const KEY_STEP_PX = 24;

// Grow ratios, keyed by the panel's short name. Equal split by default.
let _grow = { info: 1, upstream: 1, downstream: 1 };

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Pure grow-ratio math for a divider drag, factored out for testing. Given the
// two adjacent panels' current widths (``wL`` / ``wR``) and grow ratios (``gL`` /
// ``gR``) and a desired left width ``targetLeftPx``, return the new
// ``{ left, right }`` grow ratios: their sum is preserved (so the third panel is
// unaffected) and the left/right panels are kept at least ``minL`` / ``minR``
// wide. Returns ``null`` when the pair can't hold both minimums or the inputs
// are degenerate.
export function computeResizeGrow(wL, wR, gL, gR, targetLeftPx, minL = MIN_PANEL_PX, minR = MIN_PANEL_PX) {
    const wSum = wL + wR;
    const gSum = gL + gR;
    if (!(wSum > 0) || !(gSum > 0)) return null;
    const maxL = wSum - minR;
    if (maxL < minL) return null;
    const newL = _clamp(targetLeftPx, minL, maxL);
    const left = (newL / wSum) * gSum;
    return { left, right: gSum - left };
}

function _loadGrow() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const g = JSON.parse(raw);
        const keys = ['info', 'upstream', 'downstream'];
        if (g && keys.every(k => typeof g[k] === 'number' && g[k] > 0)) {
            return { info: g.info, upstream: g.upstream, downstream: g.downstream };
        }
    } catch { /* corrupt / unavailable storage -> defaults */ }
    return null;
}

function _saveGrow() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_grow)); } catch { /* ignore */ }
}

// Push the ratios into CSS custom properties the desktop-dialogue rule reads.
function _applyGrow() {
    const s = document.body.style;
    s.setProperty('--grow-info', String(_grow.info));
    s.setProperty('--grow-upstream', String(_grow.upstream));
    s.setProperty('--grow-downstream', String(_grow.downstream));
}

// Re-weight ``leftKey`` / ``rightKey`` so the left panel becomes ``targetLeftPx``
// wide, holding their combined width + combined grow constant (so the third
// panel is unaffected). Clamps to the per-panel minimum. ``persist`` writes the
// result to storage (drag end / keyboard / reset; skipped mid-drag-move).
function _resizeTo(leftKey, rightKey, targetLeftPx) {
    const lEl = document.getElementById('panel-' + leftKey);
    const rEl = document.getElementById('panel-' + rightKey);
    if (!lEl || !rEl) return;
    const next = computeResizeGrow(
        lEl.getBoundingClientRect().width,
        rEl.getBoundingClientRect().width,
        _grow[leftKey], _grow[rightKey],
        targetLeftPx,
        PANEL_MIN_PX[leftKey], PANEL_MIN_PX[rightKey],
    );
    if (!next) return; // not enough room for both minimums
    _grow[leftKey] = next.left;
    _grow[rightKey] = next.right;
    _applyGrow();
}

function _wireResizer(el, leftKey, rightKey) {
    let dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        const lEl = document.getElementById('panel-' + leftKey);
        if (!lEl) return;
        // Target the left edge->pointer distance so the divider tracks the
        // cursor regardless of where in the handle the drag started.
        _resizeTo(leftKey, rightKey, e.clientX - lEl.getBoundingClientRect().left);
    };
    const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        el.classList.remove('dragging');
        document.body.classList.remove('resizing-panels');
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        _saveGrow();
    };

    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        el.classList.add('dragging');
        // Suppress text selection + force the col-resize cursor everywhere
        // while dragging (see .resizing-panels in panels.css).
        document.body.classList.add('resizing-panels');
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        e.preventDefault();
    });

    // Keyboard: Left/Right nudge the divider; Enter/double-click reset the split.
    el.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (dir) {
            const lEl = document.getElementById('panel-' + leftKey);
            if (!lEl) return;
            _resizeTo(leftKey, rightKey, lEl.getBoundingClientRect().width + dir * KEY_STEP_PX);
            _saveGrow();
            e.preventDefault();
        }
    });

    // Double-click a divider to reset all three panels to an equal split.
    el.addEventListener('dblclick', () => {
        _grow = { info: 1, upstream: 1, downstream: 1 };
        _applyGrow();
        _saveGrow();
    });
}

function _makeResizer(leftKey, rightKey) {
    const el = document.createElement('div');
    el.className = 'panel-resizer';
    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Resize the ${leftKey} and ${rightKey} panels (drag, or arrow keys; double-click to reset)`);
    el.dataset.tooltip = 'Drag to resize, double-click to reset';
    _wireResizer(el, leftKey, rightKey);
    return el;
}

// Insert the two divider handles between the three dialogue panels and apply
// any persisted split. Safe to call once at boot; a no-op when the panels are
// absent (a shell without the 3-panel main).
export function initResizePanels() {
    const main = document.querySelector('main');
    const upstream = document.getElementById('panel-upstream');
    const downstream = document.getElementById('panel-downstream');
    if (!main || !document.getElementById('panel-info') || !upstream || !downstream) return;
    const stored = _loadGrow();
    if (stored) _grow = stored;
    _applyGrow();
    main.insertBefore(_makeResizer('info', 'upstream'), upstream);
    main.insertBefore(_makeResizer('upstream', 'downstream'), downstream);
}
