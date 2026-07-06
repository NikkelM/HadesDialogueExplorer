// Tests for grab-to-pan on the tree panels in
// ``templates/viewer/tree-drag-scroll.js``.
//
// A compact fake DOM captures the listeners the module registers and lets a
// test dispatch synthetic pointer / click events, then asserts the scroll
// offsets, the ``tree-panning`` class, and the click-suppression that keeps a
// pan from also navigating.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { initTreeDragScroll } from '../templates/viewer/tree-drag-scroll.js';

function makeClassList(initial) {
    const set = new Set(initial);
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, f) => { const w = f === undefined ? !set.has(c) : !!f; if (w) set.add(c); else set.delete(c); return w; },
    };
}

function makeEl(id) {
    // handlers keyed by "type" and "type:capture" so the capture-phase click
    // listener can be dispatched independently.
    const handlers = {};
    const el = {
        id,
        scrollLeft: 0,
        scrollTop: 0,
        scrollWidth: 2000,
        clientWidth: 400,
        scrollHeight: 3000,
        clientHeight: 500,
        classList: makeClassList([]),
        captured: null,
        addEventListener: (type, fn, capture) => {
            const key = capture ? `${type}:capture` : type;
            (handlers[key] = handlers[key] || []).push(fn);
        },
        setPointerCapture: (pid) => { el.captured = pid; },
        releasePointerCapture: () => { el.captured = null; },
        fire: (type, ev, capture) => {
            const key = capture ? `${type}:capture` : type;
            (handlers[key] || []).forEach((fn) => fn(ev));
        },
    };
    return el;
}

function pointer(type, { id = 1, x = 0, y = 0, button = 0, pointerType = 'mouse', target = null } = {}) {
    let defaultPrevented = false;
    return {
        type, pointerId: id, clientX: x, clientY: y, button, pointerType, target,
        preventDefault: () => { defaultPrevented = true; },
        get defaultPrevented() { return defaultPrevented; },
    };
}

// A fake event target whose ``closest(sel)`` matches any of the given selectors
// (used to exercise the #info-content eligibility-tree grab guard).
function targetIn(...selectors) {
    return { closest: (sel) => (selectors.includes(sel) ? {} : null) };
}

let up;
let down;
let info;

beforeEach(() => {
    up = makeEl('upstream-content');
    down = makeEl('downstream-content');
    info = makeEl('info-content');
    globalThis.document = {
        getElementById: (id) => (id === 'upstream-content' ? up : id === 'downstream-content' ? down : id === 'info-content' ? info : null),
    };
    // Minimal getSelection stub so the drag-start selection clear is exercised.
    globalThis.window = { getSelection: () => ({ removeAllRanges: () => {} }) };
});

test('dragging past the threshold pans on both axes and flags panning', () => {
    initTreeDragScroll();
    down.scrollLeft = 100;
    down.scrollTop = 50;
    down.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200 }));
    // Small move under the threshold: not yet a pan, no scroll change.
    down.fire('pointermove', pointer('pointermove', { x: 302, y: 201 }));
    assert.equal(down.classList.contains('tree-panning'), false);
    assert.equal(down.scrollLeft, 100);
    // Move past the threshold: becomes a pan; content follows the drag delta.
    down.fire('pointermove', pointer('pointermove', { x: 260, y: 170 }));
    assert.equal(down.classList.contains('tree-panning'), true);
    assert.equal(down.captured, 1);
    // dx = -40, dy = -30 -> scroll = start - delta.
    assert.equal(down.scrollLeft, 140);
    assert.equal(down.scrollTop, 80);
});

test('a real pan suppresses the click it would otherwise fire (once)', () => {
    initTreeDragScroll();
    down.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200 }));
    down.fire('pointermove', pointer('pointermove', { x: 250, y: 200 }));
    down.fire('pointerup', pointer('pointerup', { x: 250, y: 200 }));
    assert.equal(down.classList.contains('tree-panning'), false);
    assert.equal(down.captured, null);

    // The synthetic click right after the drag is swallowed...
    let stopped = 0;
    let prevented = 0;
    const clickEv = { stopImmediatePropagation: () => { stopped++; }, preventDefault: () => { prevented++; } };
    down.fire('click', clickEv, true);
    assert.equal(stopped, 1);
    assert.equal(prevented, 1);

    // ...but only that one: a later genuine click passes through untouched.
    let stopped2 = 0;
    down.fire('click', { stopImmediatePropagation: () => { stopped2++; }, preventDefault: () => {} }, true);
    assert.equal(stopped2, 0);
});

test('a press that never moves stays a normal click (no suppression)', () => {
    initTreeDragScroll();
    down.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200 }));
    down.fire('pointerup', pointer('pointerup', { x: 300, y: 200 }));
    let stopped = 0;
    down.fire('click', { stopImmediatePropagation: () => { stopped++; }, preventDefault: () => {} }, true);
    assert.equal(stopped, 0);
    assert.equal(down.classList.contains('tree-panning'), false);
});

test('non-left buttons and touch pointers are ignored (native scroll)', () => {
    initTreeDragScroll();
    // Right button.
    down.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200, button: 2 }));
    down.fire('pointermove', pointer('pointermove', { x: 200, y: 200 }));
    assert.equal(down.classList.contains('tree-panning'), false);
    // Touch pointer.
    down.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200, pointerType: 'touch' }));
    down.fire('pointermove', pointer('pointermove', { x: 200, y: 200, pointerType: 'touch' }));
    assert.equal(down.classList.contains('tree-panning'), false);
});

test('both tree panels are wired independently', () => {
    initTreeDragScroll();
    up.fire('pointerdown', pointer('pointerdown', { x: 100, y: 100 }));
    up.fire('pointermove', pointer('pointermove', { x: 60, y: 100 }));
    assert.equal(up.classList.contains('tree-panning'), true);
    assert.equal(up.scrollLeft, 40);
    // The other panel is unaffected.
    assert.equal(down.classList.contains('tree-panning'), false);
});

test('initTreeDragScroll no-ops without a document', () => {
    delete globalThis.document;
    assert.doesNotThrow(() => initTreeDragScroll());
});

test('#info-content pans only over the eligibility tree (Details text stays selectable)', () => {
    initTreeDragScroll();
    info.scrollLeft = 20;
    info.scrollTop = 10;
    // A grab on non-eligibility content (e.g. dialogue Details prose) is vetoed:
    // pointerdown records nothing, so a following move never pans.
    info.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200, target: targetIn('.textline-info') }));
    info.fire('pointermove', pointer('pointermove', { x: 240, y: 160 }));
    assert.equal(info.classList.contains('tree-panning'), false);
    assert.equal(info.scrollLeft, 20);
    assert.equal(info.scrollTop, 10);

    // A grab inside the eligibility tree pans as usual.
    info.fire('pointerdown', pointer('pointerdown', { x: 300, y: 200, target: targetIn('.eligibility-tree-container') }));
    info.fire('pointermove', pointer('pointermove', { x: 250, y: 170 }));
    assert.equal(info.classList.contains('tree-panning'), true);
    assert.equal(info.scrollLeft, 70); // 20 - (250-300)
    assert.equal(info.scrollTop, 40);  // 10 - (170-200)
});
