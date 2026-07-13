// Tests for the first-visit landing gate in
// ``templates/viewer/navigation.js``.
//
// The full first-visit redirect routes through ``navigateToState`` (which
// renders into the live DOM), so only the DOM-free decision paths are
// pinned here: the gate must stay closed on return visits and must not
// fire (or consume the one-time flag) when the URL already points at an
// entity. The positive "land on the featured dialogue" path is exercised
// in the browser / boot-smoke surface.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Stub the two browser globals the gate reads. Set before the tests run;
// navigation.js (and its transitive imports) touch neither at module
// evaluation time, only inside functions.
const _store = new Map();
globalThis.localStorage = {
    getItem: k => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: k => { _store.delete(k); },
};
globalThis.window = { location: { hash: '' }, addEventListener() {} };

const { applyFirstVisitLanding, eligibilityRedirectTarget, restoreDetailPanelFocus } = await import('../templates/viewer/navigation.js');

beforeEach(() => {
    _store.clear();
    globalThis.window.location.hash = '';
});

test('applyFirstVisitLanding is a no-op on return visits (flag already set)', () => {
    _store.set('hde.visited', '1');
    assert.equal(applyFirstVisitLanding(), false);
});

test('applyFirstVisitLanding does not fire or consume the flag when the URL names an entity', () => {
    globalThis.window.location.hash = '#game=hades2&view=dialogue&dialogue=Foo';
    assert.equal(applyFirstVisitLanding(), false);
    // The flag stays unset so the landing can still fire the first time
    // the user reaches the bare home page.
    assert.equal(_store.get('hde.visited'), undefined);
});

test('applyFirstVisitLanding does not fire when the URL names a speaker view', () => {
    globalThis.window.location.hash = '#game=hades2&view=speaker&speaker=NPC_Hecate_01';
    assert.equal(applyFirstVisitLanding(), false);
    assert.equal(_store.get('hde.visited'), undefined);
});

test('eligibilityRedirectTarget stays on the tracer when the save is usable', () => {
    assert.equal(eligibilityRedirectTarget(true, 'Foo'), null);
    assert.equal(eligibilityRedirectTarget(true, null), null);
});

test('eligibilityRedirectTarget redirects to the active dialogue when the save is unusable', () => {
    assert.deepEqual(eligibilityRedirectTarget(false, 'Foo'), { view: 'dialogue', dialogue: 'Foo' });
});

test('eligibilityRedirectTarget falls back to the home state when no dialogue is active', () => {
    assert.deepEqual(eligibilityRedirectTarget(false, null), {});
});


// --- restoreDetailPanelFocus (WCAG 2.4.3 focus restoration) ---
// ``selectTextline``'s full path renders live tree DOM the unit tests can't
// stub, so the focus-restoration half is pinned here directly.

test('restoreDetailPanelFocus focuses the panel heading when focus was inside the panel', () => {
    let focused = null;
    const heading = {
        _attrs: {},
        hasAttribute(a) { return a in this._attrs; },
        setAttribute(a, v) { this._attrs[a] = v; },
        focus() { focused = this; },
    };
    globalThis.document = { getElementById: (id) => (id === 'panel-info-heading' ? heading : null) };
    try {
        assert.equal(restoreDetailPanelFocus(true), true);
        assert.equal(focused, heading, 'heading was focused');
        assert.equal(heading._attrs.tabindex, '-1', 'heading made programmatically focusable');
    } finally {
        delete globalThis.document;
    }
});

test('restoreDetailPanelFocus does nothing when focus was NOT inside the panel (tree/search)', () => {
    let focused = null;
    const heading = { hasAttribute: () => false, setAttribute() {}, focus() { focused = this; } };
    globalThis.document = { getElementById: () => heading };
    try {
        assert.equal(restoreDetailPanelFocus(false), false);
        assert.equal(focused, null, 'focus untouched for out-of-panel navigations');
    } finally {
        delete globalThis.document;
    }
});

test('restoreDetailPanelFocus is a no-op (no throw) when the heading is absent', () => {
    globalThis.document = { getElementById: () => null };
    try {
        assert.doesNotThrow(() => restoreDetailPanelFocus(true));
        assert.equal(restoreDetailPanelFocus(true), false);
    } finally {
        delete globalThis.document;
    }
});
