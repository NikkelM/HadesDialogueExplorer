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
// Each panel can also be COLLAPSED to a thin vertical rail: via a ``>>`` button
// in its header, or by dragging its divider well past the minimum width. A
// collapsed panel shows a clickable rail with its name written vertically;
// clicking re-expands it. At least one panel always stays open (you can collapse
// at most two of the three). Collapsed state persists alongside the split.
//
// Desktop + dialogue-view only: the CSS shows the handles, rails and grow ratios
// solely under ``@media (min-width: 1025px) body.layout-dialogue`` - on the
// stacked mobile layout (<= 1024px) and the single-panel speaker / duplicates /
// eligibility views those are inert, so those layouts are unaffected.

const STORAGE_KEY = 'hde:panelGrow';
const BASE_KEY = 'hde:panelGrowBase';
const COLLAPSE_KEY = 'hde:panelCollapsed';
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
// How far past a panel's minimum width the divider must be dragged before the
// panel snaps closed (collapses to a rail).
const COLLAPSE_SLOP_PX = 48;
// The three panels in DOM order, plus the short label each shows on its rail.
const PANEL_ORDER = ['info', 'upstream', 'downstream'];
const PANEL_LABELS = { info: 'Details', upstream: 'Prerequisites', downstream: 'Dependents' };
// Chevrons point the way the panel travels when the button is pressed: details
// collapses to the left edge, dependents to the right edge, and prerequisites
// toward dependents (right); expanding points the opposite way.
const COLLAPSE_ICON = { info: '\u00AB', upstream: '\u00BB', downstream: '\u00BB' };
const EXPAND_ICON = { info: '\u00BB', upstream: '\u00AB', downstream: '\u00AB' };
// When a column collapses its freed width goes to ONE neighbour - the side it
// moves away from (ABSORB) - while the other neighbour keeps its exact width
// (KEEP). Details/dependents sit at an edge and feed prerequisites; prerequisites
// travels toward dependents and feeds details, leaving dependents untouched.
const COLLAPSE_ABSORB = { info: 'upstream', upstream: 'info', downstream: 'upstream' };
const COLLAPSE_KEEP = { info: 'downstream', upstream: 'downstream', downstream: 'info' };

// Displayed grow ratios, keyed by panel - what CSS actually renders.
let _grow = { info: 1, upstream: 1, downstream: 1 };
// Canonical all-open distribution. Collapsing never mutates this, so however
// the columns are collapsed and re-expanded, a full expand always derives back
// to it (dragging while all three are open is what updates it).
let _baseGrow = { info: 1, upstream: 1, downstream: 1 };
// Collapsed flags, keyed by panel. At least one panel is always kept open.
let _collapsed = { info: false, upstream: false, downstream: false };
// Resizer handles + the keys they sit between, so a handle can be hidden when
// either adjacent panel collapses. Populated by initResizePanels.
const _resizers = [];
// Header collapse buttons keyed by panel, so the last open panel's button can
// be disabled (you can never collapse all three).
const _collapseBtns = {};

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

// Pure decision for drag-to-collapse: given the divider's target left width and
// the pair's combined width + per-side minimums, return which side ('left' /
// 'right') the drag has pulled far enough past its minimum to snap closed, or
// null. Factored out for testing.
export function collapseTargetForDrag(targetLeftPx, wSum, minL, minR, slop = COLLAPSE_SLOP_PX) {
    if (targetLeftPx < minL - slop) return 'left';
    if (targetLeftPx > wSum - minR + slop) return 'right';
    return null;
}

// Pure split for a collapse: the two open panels share ``freeSpace`` px; pin the
// KEEP panel at ``wKeep`` (its pre-collapse width) and give the rest to the
// absorbing panel, honouring both minimum widths. Returns grow ratios (px
// magnitudes; flex-basis is 0 so the ratio is what matters). Factored out for
// testing.
export function computeAbsorbSplit(wKeep, freeSpace, minKeep, minAbsorb) {
    const maxKeep = Math.max(minKeep, freeSpace - minAbsorb);
    const keep = _clamp(wKeep, minKeep, maxKeep);
    return { keep, absorb: Math.max(freeSpace - keep, minAbsorb) };
}

// The chevron a collapsed panel's rail shows: it points toward the nearest open
// panel (so when two columns are collapsed side by side both rails point the
// same way, toward the remaining open one). With open panels on both sides it
// falls back to the panel's default expand direction. Factored out for testing.
export function expandChevronFor(key, collapsed) {
    const i = PANEL_ORDER.indexOf(key);
    const leftOpen = PANEL_ORDER.slice(0, i).some(k => !collapsed[k]);
    const rightOpen = PANEL_ORDER.slice(i + 1).some(k => !collapsed[k]);
    if (leftOpen && !rightOpen) return '\u00AB'; // <<
    if (rightOpen && !leftOpen) return '\u00BB'; // >>
    return EXPAND_ICON[key];
}

// The chevron an open panel's collapse button shows: it points the way the panel
// will travel when collapsed - which is the opposite of where its rail will then
// point (the rail points at the remaining open panel). So with a side column
// already collapsed, the still-open middle (prerequisites) points toward that
// closed side. Factored out for testing.
export function collapseChevronFor(key, collapsed) {
    const afterCollapse = { ...collapsed, [key]: true };
    return expandChevronFor(key, afterCollapse) === '\u00AB' ? '\u00BB' : '\u00AB';
}

// Derive the displayed grow ratios from the canonical all-open ``base`` and the
// current collapsed set. Fully open -> base unchanged (so a full expand always
// returns to the base split). With one column collapsed, its base share folds
// into its absorbing neighbour (the other open panel keeps its base share); with
// two collapsed the lone open panel fills the row. Factored out for testing.
export function deriveDisplayGrow(base, collapsed) {
    const g = { ...base };
    const openCount = PANEL_ORDER.filter(k => !collapsed[k]).length;
    if (openCount >= 3 || openCount <= 1) return g;
    for (const k of PANEL_ORDER) {
        if (!collapsed[k]) continue;
        const absorb = COLLAPSE_ABSORB[k];
        if (!collapsed[absorb]) g[absorb] = base[absorb] + base[k];
    }
    return g;
}

function _readGrow(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const g = JSON.parse(raw);
        const keys = ['info', 'upstream', 'downstream'];
        if (g && keys.every(k => typeof g[k] === 'number' && g[k] > 0)) {
            return { info: g.info, upstream: g.upstream, downstream: g.downstream };
        }
    } catch { /* corrupt / unavailable storage -> defaults */ }
    return null;
}

// Persist both the displayed split (read by the pre-paint script) and the
// canonical base split (read on boot to derive collapsed layouts).
function _saveGrow() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_grow));
        localStorage.setItem(BASE_KEY, JSON.stringify(_baseGrow));
    } catch { /* ignore */ }
}

function _loadCollapsed() {
    try {
        const raw = localStorage.getItem(COLLAPSE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (c && PANEL_ORDER.every(k => typeof c[k] === 'boolean')) {
            // Never restore an all-collapsed state - at least one column must
            // stay open (guards against corruption / a stale key).
            if (PANEL_ORDER.every(k => c[k])) return null;
            return { info: c.info, upstream: c.upstream, downstream: c.downstream };
        }
    } catch { /* corrupt / unavailable storage -> defaults */ }
    return null;
}

function _saveCollapsed() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(_collapsed)); } catch { /* ignore */ }
}

function _expandedCount() { return PANEL_ORDER.filter(k => !_collapsed[k]).length; }

// A panel can be collapsed only if it's currently open and it isn't the last
// open one (you can collapse at most two of the three).
function _canCollapse(key) { return !_collapsed[key] && _expandedCount() > 1; }

// Push the ratios into CSS custom properties the desktop-dialogue rule reads.
function _applyGrow() {
    const s = document.body.style;
    s.setProperty('--grow-info', String(_grow.info));
    s.setProperty('--grow-upstream', String(_grow.upstream));
    s.setProperty('--grow-downstream', String(_grow.downstream));
}

// Reflect the collapsed flags onto the DOM: toggle each panel's ``collapsed``
// class (the CSS turns it into a rail), hide any resizer whose neighbour is
// collapsed, and disable the sole open panel's collapse button so it can never
// be closed.
function _applyCollapsed() {
    for (const key of PANEL_ORDER) {
        const panel = document.getElementById('panel-' + key);
        if (!panel) continue;
        panel.classList.toggle('collapsed', _collapsed[key]);
        // Hide the body directly too (not just via the CSS ``> .panel-body``
        // rule): the tree panels' scroll container was still rendering a
        // scrollbar through the rail, so pin its display from JS with
        // ``!important`` where nothing can out-specify it.
        const body = panel.querySelector('.panel-body');
        if (body) {
            if (_collapsed[key]) body.style.setProperty('display', 'none', 'important');
            else body.style.removeProperty('display');
        }
    }
    for (const r of _resizers) {
        const hide = _collapsed[r.leftKey] || _collapsed[r.rightKey];
        r.el.classList.toggle('panel-resizer-hidden', hide);
        r.el.setAttribute('tabindex', hide ? '-1' : '0');
    }
    const lastOpen = _expandedCount() === 1;
    for (const key of PANEL_ORDER) {
        const btn = _collapseBtns[key];
        if (btn) {
            btn.disabled = lastOpen && !_collapsed[key];
            // Point the collapse chevron the way this panel will travel (toward
            // an already-collapsed side when there is one).
            btn.textContent = collapseChevronFor(key, _collapsed);
        }
        // Point each rail's chevron at the nearest open panel (updates as the
        // set of collapsed columns changes).
        const iconEl = document.querySelector('#panel-' + key + ' .panel-rail-icon');
        if (iconEl) iconEl.textContent = expandChevronFor(key, _collapsed);
    }
}

// Collapse / expand ``key``, guarding that at least one panel stays open, then
// persist and move focus to the sensible surviving control (the rail when
// collapsing, the header button when expanding).
function _setCollapsed(key, value) {
    if (_collapsed[key] === value) return;
    if (value && _expandedCount() <= 1) return;
    if (value) _collapseInto(key);
    else _expandFrom(key);
    _saveCollapsed();
    _saveGrow();
    if (value) {
        const rail = document.querySelector('#panel-' + key + ' .panel-rail');
        if (rail) rail.focus();
    } else if (_collapseBtns[key]) {
        _collapseBtns[key].focus();
    }
}

// Collapse ``key`` and hand its freed width to one neighbour only (COLLAPSE_ABSORB),
// pinning the other neighbour (COLLAPSE_KEEP) at its exact pre-collapse width.
// This adjusts only the displayed grow; the base split is left untouched so a
// later full expand still returns to it. When a second panel collapses (leaving
// a single open one) the lone panel just fills the row, so pinning is skipped.
function _collapseInto(key) {
    const keepKey = COLLAPSE_KEEP[key];
    const absorbKey = COLLAPSE_ABSORB[key];
    const keepEl = document.getElementById('panel-' + keepKey);
    // Keep neighbour's width, measured before the collapse changes the layout.
    const wKeep = keepEl ? keepEl.getBoundingClientRect().width : 0;

    _collapsed[key] = true;
    _applyCollapsed();
    _recompute();

    // Exact-pin the keep panel to its pre-collapse width. freeSpace is the two
    // open panels' combined width after the collapse (independent of how they
    // currently split it).
    const absorbEl = document.getElementById('panel-' + absorbKey);
    if (_expandedCount() === 2 && keepEl && absorbEl) {
        const freeSpace = keepEl.getBoundingClientRect().width + absorbEl.getBoundingClientRect().width;
        const split = computeAbsorbSplit(wKeep, freeSpace, PANEL_MIN_PX[keepKey], PANEL_MIN_PX[absorbKey]);
        _grow[keepKey] = split.keep;
        _grow[absorbKey] = split.absorb;
        _applyGrow();
    }
}

// Re-open ``key`` and re-derive the displayed split from the untouched base, so
// expanding never re-introduces a stale mid-collapse width - a full expand lands
// exactly back on the base distribution.
function _expandFrom(key) {
    _collapsed[key] = false;
    _applyCollapsed();
    _recompute();
}

// Push the base split through the collapse rule into the displayed grow.
function _recompute() {
    _grow = deriveDisplayGrow(_baseGrow, _collapsed);
    _applyGrow();
}

// Re-weight ``leftKey`` / ``rightKey`` so the left panel becomes ``targetLeftPx``
// wide, holding their combined width + combined grow constant (so the third
// panel is unaffected). Clamps to the per-panel minimum. When all three panels
// are open the drag also updates the canonical base split so it persists.
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
    if (_expandedCount() === 3) {
        _baseGrow[leftKey] = next.left;
        _baseGrow[rightKey] = next.right;
    }
    _applyGrow();
}

function _wireResizer(el, leftKey, rightKey) {
    let dragging = false;

    const stopDrag = () => {
        dragging = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        el.classList.remove('dragging');
        document.body.classList.remove('resizing-panels');
    };

    const onMove = (e) => {
        if (!dragging) return;
        const lEl = document.getElementById('panel-' + leftKey);
        const rEl = document.getElementById('panel-' + rightKey);
        if (!lEl || !rEl) return;
        // Target the left edge->pointer distance so the divider tracks the
        // cursor regardless of where in the handle the drag started.
        const target = e.clientX - lEl.getBoundingClientRect().left;
        const wSum = lEl.getBoundingClientRect().width + rEl.getBoundingClientRect().width;
        // Dragged well past a panel's minimum -> snap it closed and end the drag.
        const snap = collapseTargetForDrag(target, wSum, PANEL_MIN_PX[leftKey], PANEL_MIN_PX[rightKey]);
        if (snap === 'left' && _canCollapse(leftKey)) { stopDrag(); _setCollapsed(leftKey, true); return; }
        if (snap === 'right' && _canCollapse(rightKey)) { stopDrag(); _setCollapsed(rightKey, true); return; }
        _resizeTo(leftKey, rightKey, target);
    };
    const onUp = (e) => {
        if (!dragging) return;
        stopDrag();
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

    // Double-click a divider to reset: all three panels open, equal split.
    el.addEventListener('dblclick', () => {
        _baseGrow = { info: 1, upstream: 1, downstream: 1 };
        _collapsed = { info: false, upstream: false, downstream: false };
        _applyCollapsed();
        _recompute();
        _saveGrow();
        _saveCollapsed();
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

// A collapse button placed over each panel's header; its chevron points the
// way the panel collapses.
function _makeCollapseBtn(key) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-collapse-btn';
    btn.innerHTML = COLLAPSE_ICON[key];
    btn.setAttribute('aria-label', `Collapse the ${PANEL_LABELS[key]} panel`);
    btn.dataset.tooltip = 'Collapse this column';
    btn.addEventListener('click', () => _setCollapsed(key, true));
    return btn;
}

// The thin rail shown in place of a collapsed panel: a full-height button with
// the panel's name written vertically; clicking it re-expands the panel. Its
// chevron points the way the panel will expand.
function _makeRail(key) {
    const rail = document.createElement('button');
    rail.type = 'button';
    rail.className = 'panel-rail';
    rail.setAttribute('aria-label', `Expand the ${PANEL_LABELS[key]} panel`);
    rail.dataset.tooltip = 'Expand this column';
    rail.innerHTML = `<span class="panel-rail-icon" aria-hidden="true">${EXPAND_ICON[key]}</span>`
        + `<span class="panel-rail-label">${PANEL_LABELS[key]}</span>`;
    rail.addEventListener('click', () => _setCollapsed(key, false));
    return rail;
}

// Insert the two divider handles between the three dialogue panels, add each
// panel's collapse button + rail, and apply any persisted split / collapsed
// state. Safe to call once at boot; a no-op when the panels are absent (a shell
// without the 3-panel main).
export function initResizePanels() {
    const main = document.querySelector('main');
    const upstream = document.getElementById('panel-upstream');
    const downstream = document.getElementById('panel-downstream');
    if (!main || !document.getElementById('panel-info') || !upstream || !downstream) return;

    // Load the persisted split: the displayed grow (exact last state, also used
    // by the pre-paint script) and the canonical base it derives from. Older
    // storage without a base key falls back to the displayed split.
    const storedDisplay = _readGrow(STORAGE_KEY);
    const storedBase = _readGrow(BASE_KEY);
    if (storedDisplay) _grow = storedDisplay;
    _baseGrow = storedBase || { ..._grow };
    _applyGrow();

    const r1 = _makeResizer('info', 'upstream');
    const r2 = _makeResizer('upstream', 'downstream');
    _resizers.push({ el: r1, leftKey: 'info', rightKey: 'upstream' });
    _resizers.push({ el: r2, leftKey: 'upstream', rightKey: 'downstream' });
    main.insertBefore(r1, upstream);
    main.insertBefore(r2, downstream);

    for (const key of PANEL_ORDER) {
        const panel = document.getElementById('panel-' + key);
        if (!panel) continue;
        // Append the button to the PANEL, not its <h2>: the info panel's heading
        // text is reset via ``textContent`` on navigation (navigation.js), which
        // would wipe a child button. Absolute positioning (panels.css) floats it
        // over the header's top-right corner.
        const btn = _makeCollapseBtn(key);
        _collapseBtns[key] = btn;
        panel.appendChild(btn);
        panel.appendChild(_makeRail(key));
    }

    const storedCollapsed = _loadCollapsed();
    if (storedCollapsed) _collapsed = storedCollapsed;
    _applyCollapsed();
}
