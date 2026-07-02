// Tests for the pure divider-drag math in resize-panels.js
// (computeResizeGrow). The DOM wiring is thin; the math - preserving the
// two panels' combined grow while enforcing a per-panel minimum width - is
// the part worth pinning.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { computeResizeGrow, collapseTargetForDrag, computeAbsorbSplit, expandChevronFor, collapseChevronFor, deriveDisplayGrow, resolveResizerPair } from '../templates/viewer/resize-panels.js';

const LAQUO = '\u00AB'; // <<
const RAQUO = '\u00BB'; // >>

describe('computeResizeGrow', () => {
    test('shifts grow toward the target width, preserving the pair sum', () => {
        // Two equal 400px panels, grow 1 + 1. Drag the divider to make the
        // left 500px: it should take 500/800 of the combined grow (2).
        const r = computeResizeGrow(400, 400, 1, 1, 500, 240);
        assert.ok(Math.abs(r.left - 1.25) < 1e-9, `left=${r.left}`);
        assert.ok(Math.abs(r.right - 0.75) < 1e-9, `right=${r.right}`);
        // Sum preserved so the third panel is untouched.
        assert.ok(Math.abs((r.left + r.right) - 2) < 1e-9);
    });

    test('clamps the left panel to the minimum width', () => {
        // Target below the min -> left pinned at minPx (100 of 800).
        const r = computeResizeGrow(400, 400, 1, 1, 50, 100);
        assert.ok(Math.abs(r.left - (100 / 800) * 2) < 1e-9, `left=${r.left}`);
        assert.ok(Math.abs((r.left + r.right) - 2) < 1e-9);
    });

    test('clamps the right panel to the minimum width', () => {
        // Target beyond (sum - minR) -> left pinned so the right keeps its min.
        const r = computeResizeGrow(400, 400, 1, 1, 780, 100, 100);
        assert.ok(Math.abs(r.left - (700 / 800) * 2) < 1e-9, `left=${r.left}`);
    });

    test('honours asymmetric left/right minimums', () => {
        // Larger left min (380) than right (260): dragging the left below 380
        // pins it at 380, and dragging it up leaves the right no smaller than
        // 260 (max left = 800 - 260 = 540).
        const lo = computeResizeGrow(400, 400, 1, 1, 50, 380, 260);
        assert.ok(Math.abs(lo.left - (380 / 800) * 2) < 1e-9, `left=${lo.left}`);
        const hi = computeResizeGrow(400, 400, 1, 1, 780, 380, 260);
        assert.ok(Math.abs(hi.left - (540 / 800) * 2) < 1e-9, `left=${hi.left}`);
    });

    test('returns null when the asymmetric minimums cannot both fit', () => {
        // 600px combined, 380 + 260 = 640 needed -> impossible.
        assert.equal(computeResizeGrow(300, 300, 1, 1, 300, 380, 260), null);
    });

    test('preserves an uneven combined grow', () => {
        // Combined grow 3 (2 + 1) over 900px; target left 300 -> 300/900 * 3 = 1.
        const r = computeResizeGrow(600, 300, 2, 1, 300, 240);
        assert.ok(Math.abs(r.left - 1) < 1e-9, `left=${r.left}`);
        assert.ok(Math.abs(r.right - 2) < 1e-9, `right=${r.right}`);
    });

    test('returns null when the pair cannot hold both minimums', () => {
        // 400px combined, 240 min each -> 480 needed, impossible.
        assert.equal(computeResizeGrow(200, 200, 1, 1, 100, 240), null);
    });

    test('returns null on degenerate inputs', () => {
        assert.equal(computeResizeGrow(0, 0, 1, 1, 100, 10), null);
        assert.equal(computeResizeGrow(400, 400, 0, 0, 100, 10), null);
    });
});

describe('collapseTargetForDrag', () => {
    // 800px pair, left min 380, right min 260, slop 48.
    test('no collapse within the normal drag range', () => {
        assert.equal(collapseTargetForDrag(400, 800, 380, 260, 48), null);
        // Just past the left min but within the slop -> still no snap.
        assert.equal(collapseTargetForDrag(340, 800, 380, 260, 48), null);
        // Just short of the right min + slop -> still no snap.
        assert.equal(collapseTargetForDrag(560, 800, 380, 260, 48), null);
    });

    test('snaps the left panel when dragged far past its min', () => {
        // target < 380 - 48 = 332.
        assert.equal(collapseTargetForDrag(300, 800, 380, 260, 48), 'left');
    });

    test('snaps the right panel when dragged far past its min', () => {
        // target > 800 - 260 + 48 = 588.
        assert.equal(collapseTargetForDrag(600, 800, 380, 260, 48), 'right');
    });
});

describe('computeAbsorbSplit', () => {
    test('pins the keep panel and gives the rest to the absorber', () => {
        // 1200px shared, keep pinned at 300 -> absorber gets the other 900.
        const r = computeAbsorbSplit(300, 1200, 260, 260);
        assert.equal(r.keep, 300);
        assert.equal(r.absorb, 900);
        assert.equal(r.keep + r.absorb, 1200);
    });

    test('never shrinks the keep panel below its minimum', () => {
        const r = computeAbsorbSplit(100, 1200, 260, 260);
        assert.equal(r.keep, 260);
        assert.equal(r.absorb, 940);
    });

    test('never starves the absorber below its minimum', () => {
        // keep wants 1100 but the absorber must retain 260 -> keep capped at 940.
        const r = computeAbsorbSplit(1100, 1200, 260, 260);
        assert.equal(r.keep, 940);
        assert.equal(r.absorb, 260);
    });
});

describe('expandChevronFor', () => {
    const none = { info: false, upstream: false, downstream: false };

    test('single collapse uses the default expand direction', () => {
        assert.equal(expandChevronFor('info', { ...none, info: true }), RAQUO);
        assert.equal(expandChevronFor('upstream', { ...none, upstream: true }), LAQUO);
        assert.equal(expandChevronFor('downstream', { ...none, downstream: true }), LAQUO);
    });

    test('prerequisites points right when details is also collapsed', () => {
        // info + upstream collapsed, dependents open on the right -> both rails
        // point right (info default is already >>).
        const c = { info: true, upstream: true, downstream: false };
        assert.equal(expandChevronFor('upstream', c), RAQUO);
        assert.equal(expandChevronFor('info', c), RAQUO);
    });

    test('prerequisites stays left when dependents is also collapsed', () => {
        // upstream + downstream collapsed, details open on the left -> both left.
        const c = { info: false, upstream: true, downstream: true };
        assert.equal(expandChevronFor('upstream', c), LAQUO);
        assert.equal(expandChevronFor('downstream', c), LAQUO);
    });

    test('outer columns point toward a collapsed-middle open panel', () => {
        // info + downstream collapsed, prerequisites open in the middle.
        const c = { info: true, upstream: false, downstream: true };
        assert.equal(expandChevronFor('info', c), RAQUO);
        assert.equal(expandChevronFor('downstream', c), LAQUO);
    });
});

describe('collapseChevronFor', () => {
    const none = { info: false, upstream: false, downstream: false };

    test('default travel with all panels open', () => {
        assert.equal(collapseChevronFor('info', none), LAQUO);        // to left edge
        assert.equal(collapseChevronFor('upstream', none), RAQUO);    // toward dependents
        assert.equal(collapseChevronFor('downstream', none), RAQUO);  // to right edge
    });

    test('prerequisites points left toward an already-collapsed details', () => {
        assert.equal(collapseChevronFor('upstream', { ...none, info: true }), LAQUO);
    });

    test('prerequisites points right toward an already-collapsed dependents', () => {
        assert.equal(collapseChevronFor('upstream', { ...none, downstream: true }), RAQUO);
    });

    test('edge columns always collapse to their own edge', () => {
        assert.equal(collapseChevronFor('info', { ...none, downstream: true }), LAQUO);
        assert.equal(collapseChevronFor('downstream', { ...none, info: true }), RAQUO);
    });
});

describe('deriveDisplayGrow', () => {
    const base = { info: 2, upstream: 3, downstream: 4 };
    const open = { info: false, upstream: false, downstream: false };

    test('all open returns the base split unchanged', () => {
        assert.deepEqual(deriveDisplayGrow(base, open), base);
    });

    test('a collapsed column folds its base share into its absorbing neighbour', () => {
        // info -> upstream, downstream kept.
        assert.deepEqual(deriveDisplayGrow(base, { ...open, info: true }),
            { info: 2, upstream: 5, downstream: 4 });
        // upstream -> info, downstream kept.
        assert.deepEqual(deriveDisplayGrow(base, { ...open, upstream: true }),
            { info: 5, upstream: 3, downstream: 4 });
        // downstream -> upstream, info kept.
        assert.deepEqual(deriveDisplayGrow(base, { ...open, downstream: true }),
            { info: 2, upstream: 7, downstream: 4 });
    });

    test('two collapsed leaves the base untouched (lone panel fills)', () => {
        assert.deepEqual(deriveDisplayGrow(base, { info: true, upstream: true, downstream: false }), base);
    });

    test('a full expand always returns exactly to base', () => {
        // Collapsing then expanding is a pure function of the collapsed set, so
        // the fully-open result is base regardless of the path taken.
        assert.deepEqual(deriveDisplayGrow(base, open), base);
    });
});

describe('resolveResizerPair', () => {
    const none = { info: false, upstream: false, downstream: false };

    test('no collapse: each resizer keeps its own pair', () => {
        assert.deepEqual(resolveResizerPair('info', 'upstream', none), { left: 'info', right: 'upstream' });
        assert.deepEqual(resolveResizerPair('upstream', 'downstream', none), { left: 'upstream', right: 'downstream' });
    });

    test('collapsed middle: both handles resolve to details<->dependents', () => {
        const c = { ...none, upstream: true };
        assert.deepEqual(resolveResizerPair('info', 'upstream', c), { left: 'info', right: 'downstream' });
        assert.deepEqual(resolveResizerPair('upstream', 'downstream', c), { left: 'info', right: 'downstream' });
    });

    test('collapsed edge: the handle touching it has no pair', () => {
        // info collapsed -> the info|upstream handle has no open panel to its left.
        assert.equal(resolveResizerPair('info', 'upstream', { ...none, info: true }), null);
        // downstream collapsed -> the upstream|downstream handle has none to its right.
        assert.equal(resolveResizerPair('upstream', 'downstream', { ...none, downstream: true }), null);
    });

    test('two collapsed: no resolvable pair (one panel open)', () => {
        const c = { info: true, upstream: true, downstream: false };
        assert.equal(resolveResizerPair('info', 'upstream', c), null);
        assert.equal(resolveResizerPair('upstream', 'downstream', c), null);
    });
});
