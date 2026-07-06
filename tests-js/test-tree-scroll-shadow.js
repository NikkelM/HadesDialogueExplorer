// Tests for the desktop tree scroll-shadow wiring in
// ``templates/viewer/tree-scroll-shadow.js``.
//
// The visual fade is pure CSS; this module only decides WHEN each edge's fade
// shows by toggling the ``can-scroll-left`` / ``can-scroll-right`` classes on
// the panel from its scroll position. These tests drive the class logic with a
// compact fake DOM (no ResizeObserver / MutationObserver globals, so those
// branches stay inert) and check the wiring updates on scroll.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { updateTreeScrollShadow, initTreeScrollShadow } from '../templates/viewer/tree-scroll-shadow.js';

function makeClassList(initial) {
    const set = new Set(initial);
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, force) => {
            const want = force === undefined ? !set.has(c) : !!force;
            if (want) set.add(c); else set.delete(c);
            return want;
        },
    };
}

// A fake scroll container that knows its owning panel and lets a test set the
// scroll geometry directly.
function makeContent({ scrollWidth = 0, clientWidth = 0, scrollLeft = 0 } = {}) {
    const panel = { classList: makeClassList(['panel']) };
    const handlers = {};
    const content = {
        scrollWidth,
        clientWidth,
        scrollLeft,
        closest: (sel) => (sel === '.panel' ? panel : null),
        addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
        fire: (type) => (handlers[type] || []).forEach((fn) => fn({})),
        _panel: panel,
    };
    return content;
}

beforeEach(() => {
    delete globalThis.document;
});

test('overflow, scrolled to the start: only the right fade shows', () => {
    const c = makeContent({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    updateTreeScrollShadow(c);
    assert.equal(c._panel.classList.contains('can-scroll-left'), false);
    assert.equal(c._panel.classList.contains('can-scroll-right'), true);
});

test('overflow, scrolled to the end: only the left fade shows', () => {
    const c = makeContent({ scrollWidth: 800, clientWidth: 400, scrollLeft: 400 });
    updateTreeScrollShadow(c);
    assert.equal(c._panel.classList.contains('can-scroll-left'), true);
    assert.equal(c._panel.classList.contains('can-scroll-right'), false);
});

test('overflow, scrolled to the middle: both fades show', () => {
    const c = makeContent({ scrollWidth: 800, clientWidth: 400, scrollLeft: 150 });
    updateTreeScrollShadow(c);
    assert.equal(c._panel.classList.contains('can-scroll-left'), true);
    assert.equal(c._panel.classList.contains('can-scroll-right'), true);
});

test('no horizontal overflow: neither fade shows', () => {
    const c = makeContent({ scrollWidth: 380, clientWidth: 400, scrollLeft: 0 });
    updateTreeScrollShadow(c);
    assert.equal(c._panel.classList.contains('can-scroll-left'), false);
    assert.equal(c._panel.classList.contains('can-scroll-right'), false);
});

test('sub-pixel slack: a 0.5px remainder at the end clears the right fade', () => {
    const c = makeContent({ scrollWidth: 800.5, clientWidth: 400, scrollLeft: 400 });
    updateTreeScrollShadow(c);
    // max = 400.5, x = 400 -> x < max - 1 is false, so no lingering right fade.
    assert.equal(c._panel.classList.contains('can-scroll-right'), false);
});

test('missing panel is tolerated (no throw, no class changes)', () => {
    const c = makeContent({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    c.closest = () => null;
    assert.doesNotThrow(() => updateTreeScrollShadow(c));
});

test('initTreeScrollShadow wires each panel and updates on scroll', () => {
    const up = makeContent({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    const down = makeContent({ scrollWidth: 300, clientWidth: 400, scrollLeft: 0 });
    globalThis.document = {
        getElementById: (id) => (id === 'upstream-content' ? up : id === 'downstream-content' ? down : null),
    };

    initTreeScrollShadow();

    // Initial measure ran: up overflows (right fade), down does not.
    assert.equal(up._panel.classList.contains('can-scroll-right'), true);
    assert.equal(down._panel.classList.contains('can-scroll-right'), false);

    // Scrolling up to the end flips its fades.
    up.scrollLeft = 400;
    up.fire('scroll');
    assert.equal(up._panel.classList.contains('can-scroll-left'), true);
    assert.equal(up._panel.classList.contains('can-scroll-right'), false);
});

test('initTreeScrollShadow no-ops without a document', () => {
    assert.doesNotThrow(() => initTreeScrollShadow());
});
