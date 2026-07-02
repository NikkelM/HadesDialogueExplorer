// Tests for the pure divider-drag math in resize-panels.js
// (computeResizeGrow). The DOM wiring is thin; the math - preserving the
// two panels' combined grow while enforcing a per-panel minimum width - is
// the part worth pinning.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { computeResizeGrow } from '../templates/viewer/resize-panels.js';

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
