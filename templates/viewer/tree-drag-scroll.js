// Grab-to-pan for the scrollable dependency / requirement tree views.
//
// Deep dependency chains scroll on both axes (horizontally to follow a chain,
// vertically through many rows). A left-button drag anywhere in a tree view
// now pans it, like grabbing a canvas, so the user doesn't have to reach for
// the thin scrollbar or a wheel.
//
// Applied to every scrollable TREE surface in the tool:
//   - the dialogue view's Prerequisites (#upstream-content) and Dependents
//     (#downstream-content) panels;
//   - the Eligibility Tracer's tree, which renders into the shared
//     #info-content panel. That same panel also shows the dialogue Details
//     (selectable prose) and the Speaker / Duplicates lists, so its pan is
//     gated to start only when the grab lands inside an
//     ``.eligibility-tree-container`` - text selection in the other views is
//     left untouched.
//
// Click vs. drag is disambiguated by a small movement threshold: a press that
// never moves stays a normal click (navigate to the row / expand a group),
// while a press that moves past the threshold becomes a pan - and the click
// that release would otherwise fire is swallowed, so dragging across a dialogue
// name or a toggle never also navigates or expands.
//
// Mouse only: ``pointerdown`` bails on touch / pen so those keep the browser's
// native momentum scrolling untouched (this is why no media-query gate is
// needed - a mouse pointer is a desktop-only input here).

// The always-pannable tree panels (their whole surface is a tree).
const PAN_CONTENT_IDS = ['upstream-content', 'downstream-content'];
// Pixels of movement before a press is treated as a pan rather than a click.
const DRAG_THRESHOLD = 5;

// #info-content is shared across views; only start a pan there when the grab is
// inside the eligibility tree, so Details / Speaker / Duplicates keep native
// text selection and list behaviour.
function eligibilityTreeGrab(el, e) {
    const t = e && e.target;
    return !!(t && typeof t.closest === 'function' && t.closest('.eligibility-tree-container'));
}

// Wire grab-to-pan on ``el``. ``canStart(el, event)`` optionally vetoes a pan at
// pointerdown (default: always allow); used to scope the shared #info-content
// panel to the eligibility tree only.
function wirePanel(el, canStart) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let suppressClick = false;

    el.addEventListener('pointerdown', (e) => {
        // Left mouse button only; touch / pen fall through to native scrolling.
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        // Optional per-panel veto (e.g. only the eligibility tree in #info-content).
        if (typeof canStart === 'function' && !canStart(el, e)) return;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = el.scrollLeft;
        startTop = el.scrollTop;
        dragging = false;
        // Deliberately no preventDefault / capture here: a press that never
        // moves must remain an ordinary click and keep normal focus behaviour.
    });

    el.addEventListener('pointermove', (e) => {
        if (pointerId === null || e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            dragging = true;
            el.classList.add('tree-panning');
            if (typeof el.setPointerCapture === 'function') {
                try { el.setPointerCapture(pointerId); } catch { /* stale id */ }
            }
            // Drop any text selection the initial press began before it grows
            // into a smeared highlight as we pan.
            const sel = (typeof window !== 'undefined' && typeof window.getSelection === 'function')
                ? window.getSelection()
                : null;
            if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
        }
        el.scrollLeft = startLeft - dx;
        el.scrollTop = startTop - dy;
        e.preventDefault();
    });

    const end = (e) => {
        if (pointerId === null) return;
        if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
        if (dragging) {
            // Cancel the click this release will otherwise synthesize. It fires
            // synchronously right after pointerup (before the 0ms timer), so the
            // capture-phase handler below consumes and clears the flag; the
            // timer is a safety net for the case no click follows.
            suppressClick = true;
            if (typeof setTimeout === 'function') setTimeout(() => { suppressClick = false; }, 0);
            el.classList.remove('tree-panning');
            if (typeof el.releasePointerCapture === 'function') {
                try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
            }
        }
        pointerId = null;
        dragging = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    // Capture phase so this runs before the row's inline ``onclick`` on the way
    // down to the target; stopImmediatePropagation + preventDefault keep a pan
    // from also triggering navigation / expansion.
    el.addEventListener('click', (e) => {
        if (!suppressClick) return;
        suppressClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
    }, true);

    // A pan should never start a native HTML drag (e.g. over selectable text).
    el.addEventListener('dragstart', (e) => { if (dragging) e.preventDefault(); });
}

// Wire grab-to-pan for every scrollable tree surface. Safe to call once at boot
// (all target elements are static in index.html); no-ops under the test DOM
// stub (no ``getElementById``).
export function initTreeDragScroll() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    // The dialogue Prerequisites / Dependents panels: whole surface is a tree.
    for (const id of PAN_CONTENT_IDS) {
        const el = document.getElementById(id);
        if (el && typeof el.addEventListener === 'function') wirePanel(el);
    }
    // The shared single-panel container, pannable only over the eligibility tree.
    const info = document.getElementById('info-content');
    if (info && typeof info.addEventListener === 'function') wirePanel(info, eligibilityTreeGrab);
}
