// Keyboard navigation for the prerequisite / dependent trees.
//
// Each tree row (``.tree-label``) is a focusable ARIA tree item (see
// ``createNodeEl`` in tree.js). This delegated controller gives the two trees
// the standard tree-widget key behaviour:
//
//   Enter / Space  - select the row (load it into the details panel), matching
//                    a mouse click on the row name;
//   ArrowRight     - expand a collapsed row;
//   ArrowLeft      - collapse an expanded row;
//   ArrowUp / Down - move focus to the previous / next visible row.
//
// Expand / collapse reuse the row's own chevron handler (a synthetic click),
// so the tree's single source of truth for expansion stays in tree.js. The
// interleaved requirement-group headers are separate inline-onclick elements
// already made operable by keyboard-a11y.js.

import { renderInfo } from './info-panel.js';

// Visible rows (collapsed branches are display:none -> offsetParent null) in
// document order, for ArrowUp / ArrowDown movement.
function _visibleTreeRows(container) {
    return [...container.querySelectorAll('.tree-label')].filter((el) => el.offsetParent !== null);
}

function _moveTreeFocus(container, current, dir) {
    const rows = _visibleTreeRows(container);
    const i = rows.indexOf(current);
    if (i < 0) return;
    const next = rows[i + dir];
    if (next) next.focus();
}

function _onTreeKeydown(e) {
    const row = e.target.closest && e.target.closest('.tree-label');
    if (!row) return;
    const container = e.currentTarget;
    switch (e.key) {
        case 'Enter':
        case ' ':
        case 'Spacebar': {
            e.preventDefault();
            // Match the mouse row-select; suppressed during a tour step the
            // same way the click handler is (tour-no-nav).
            if (!document.body.classList.contains('tour-no-nav')) {
                const name = row.dataset.name;
                if (name) renderInfo(name);
            }
            break;
        }
        case 'ArrowRight':
            if (row.getAttribute('aria-expanded') === 'false') {
                e.preventDefault();
                const tg = row.querySelector('.toggle');
                if (tg) tg.click();
            }
            break;
        case 'ArrowLeft':
            if (row.getAttribute('aria-expanded') === 'true') {
                e.preventDefault();
                const tg = row.querySelector('.toggle');
                if (tg) tg.click();
            }
            break;
        case 'ArrowDown':
            e.preventDefault();
            _moveTreeFocus(container, row, 1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            _moveTreeFocus(container, row, -1);
            break;
        default:
            break;
    }
}

export function initTreeKeyboard() {
    if (typeof document === 'undefined') return;
    for (const id of ['upstream-content', 'downstream-content']) {
        const container = document.getElementById(id);
        // Delegated: the containers persist across re-renders (only their
        // innerHTML is replaced), so one listener covers every rebuilt tree.
        if (container) container.addEventListener('keydown', _onTreeKeydown);
    }
}
