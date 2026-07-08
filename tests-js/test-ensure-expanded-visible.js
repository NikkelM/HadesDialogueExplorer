// Tests for ``ensureExpandedContentVisible`` in ``templates/viewer/tree.js``.
//
// On expand, the enclosing panel-body must scroll so the CLICKED row's left
// edge lands at the column's left content edge (just inside the panel's left
// padding), rather than jumping to the far right. A tiny fake DOM drives the
// geometry so the computed target scrollLeft can be asserted exactly.

import { test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { ensureExpandedContentVisible } from '../templates/viewer/tree.js';

const PAD_LEFT = 16;

// Fake panel-body with a fixed viewport-left and a captured scrollTo target.
function makePanelBody({ left = 0, scrollLeft = 0 } = {}) {
    const calls = [];
    return {
        scrollLeft,
        getBoundingClientRect: () => ({ left }),
        scrollTo: (opts) => calls.push(opts),
        _calls: calls,
    };
}

// Fake row whose ``closest('.panel-body')`` yields ``panelBody`` and whose
// left edge is at viewport x ``rowLeft``.
function makeRow(rowLeft, panelBody) {
    return {
        closest: (sel) => (sel === '.panel-body' ? panelBody : null),
        getBoundingClientRect: () => ({ left: rowLeft }),
    };
}

beforeEach(() => {
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.getComputedStyle = () => ({ paddingLeft: `${PAD_LEFT}px` });
});

afterEach(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.getComputedStyle;
});

test('nested row scrolls so its left edge aligns to the content start', () => {
    const pb = makePanelBody({ left: 0, scrollLeft: 0 });
    // Row sits 200px into the panel; target = scrollLeft + rowLeft - padding.
    ensureExpandedContentVisible(makeRow(200, pb));
    assert.equal(pb._calls.length, 1);
    assert.equal(pb._calls[0].left, 200 - PAD_LEFT);
    assert.equal(pb._calls[0].behavior, 'smooth');
});

test('top-level row (already at the content start) scrolls to 0', () => {
    const pb = makePanelBody({ left: 0, scrollLeft: 0 });
    // A top-level row sits exactly at the padding edge.
    ensureExpandedContentVisible(makeRow(PAD_LEFT, pb));
    assert.equal(pb._calls[0].left, 0);
});

test('a row already aligned while scrolled keeps its position (idempotent)', () => {
    // Panel scrolled 184px; the row is visually at the padding edge already.
    const pb = makePanelBody({ left: 0, scrollLeft: 184 });
    ensureExpandedContentVisible(makeRow(PAD_LEFT, pb));
    assert.equal(pb._calls[0].left, 184);
});

test('target never goes negative', () => {
    const pb = makePanelBody({ left: 0, scrollLeft: 0 });
    // Row left of the padding edge (e.g. sub-pixel) must clamp at 0, not scroll left.
    ensureExpandedContentVisible(makeRow(4, pb));
    assert.equal(pb._calls[0].left, 0);
});

test('accounts for a non-zero panel-body viewport offset', () => {
    // Panel starts at viewport x=500 (third column); row at x=760.
    const pb = makePanelBody({ left: 500, scrollLeft: 30 });
    ensureExpandedContentVisible(makeRow(760, pb));
    // rowLeft(relative) = 760 - 500 = 260; target = 30 + 260 - 16 = 274.
    assert.equal(pb._calls[0].left, 274);
});

test('no-ops for a null row or a row outside any panel-body', () => {
    assert.doesNotThrow(() => ensureExpandedContentVisible(null));
    const orphan = { closest: () => null, getBoundingClientRect: () => ({ left: 0 }) };
    assert.doesNotThrow(() => ensureExpandedContentVisible(orphan));
});
