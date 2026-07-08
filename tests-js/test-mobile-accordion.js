// Tests for the mobile dialogue-view accordion wiring in
// ``templates/viewer/mobile-accordion.js``.
//
// The module is DOM-driven (matchMedia + panel headings), so a compact fake
// DOM is installed on ``globalThis`` here - enough to exercise the default
// open/closed state, the click toggle, the ARIA reflection, and the
// mobile <-> desktop transition. ``node --test`` runs each test file in its own
// process, so these globals don't leak into the other suites.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { initMobileAccordion } from '../templates/viewer/mobile-accordion.js';

function makeClassList(initial) {
    const set = new Set(initial);
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c) => { if (set.has(c)) { set.delete(c); return false; } set.add(c); return true; },
    };
}

function makeH2() {
    const attrs = {};
    const handlers = {};
    return {
        attrs,
        setAttribute: (k, v) => { attrs[k] = String(v); },
        removeAttribute: (k) => { delete attrs[k]; },
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
        fire: (type, ev) => (handlers[type] || []).forEach((fn) => fn(ev || {})),
    };
}

function makeBody() {
    const props = {};
    return { style: { removeProperty: (k) => { delete props[k]; }, setProperty: (k, v) => { props[k] = v; }, _props: props } };
}

function makePanel(id, open) {
    const h2 = makeH2();
    const body = makeBody();
    return {
        id,
        classList: makeClassList(open ? ['panel', 'acc-open'] : ['panel']),
        querySelector: (sel) => (sel === 'h2' ? h2 : sel === '.panel-body' ? body : null),
        _h2: h2,
        _body: body,
    };
}

let panels;
let mqlMatches;
let mqlChange;

beforeEach(() => {
    panels = {
        'panel-info': makePanel('panel-info', true),
        'panel-upstream': makePanel('panel-upstream', false),
        'panel-downstream': makePanel('panel-downstream', false),
    };
    mqlMatches = true;
    mqlChange = null;
    globalThis.window = {
        matchMedia: (q) => ({
            media: q,
            get matches() { return mqlMatches; },
            addEventListener: (_type, fn) => { mqlChange = fn; },
        }),
    };
    globalThis.document = {
        getElementById: (id) => panels[id] || null,
    };
});

test('on mobile, Details starts expanded and the two trees start collapsed', () => {
    initMobileAccordion();
    assert.equal(panels['panel-info']._h2.getAttribute('aria-expanded'), 'true');
    assert.equal(panels['panel-upstream']._h2.getAttribute('aria-expanded'), 'false');
    assert.equal(panels['panel-downstream']._h2.getAttribute('aria-expanded'), 'false');
    // The headings expose themselves as toggle buttons for assistive tech.
    assert.equal(panels['panel-info']._h2.getAttribute('role'), 'button');
    assert.equal(panels['panel-info']._h2.getAttribute('tabindex'), '0');
});

test('clicking a collapsed panel header expands it (class + aria)', () => {
    initMobileAccordion();
    const up = panels['panel-upstream'];
    up._h2.fire('click');
    assert.equal(up.classList.contains('acc-open'), true);
    assert.equal(up._h2.getAttribute('aria-expanded'), 'true');
    // Clicking again collapses it back.
    up._h2.fire('click');
    assert.equal(up.classList.contains('acc-open'), false);
    assert.equal(up._h2.getAttribute('aria-expanded'), 'false');
});

test('Enter / Space on a header toggle it and prevent default scroll', () => {
    initMobileAccordion();
    const down = panels['panel-downstream'];
    let prevented = 0;
    down._h2.fire('keydown', { key: 'Enter', preventDefault: () => { prevented++; } });
    assert.equal(down.classList.contains('acc-open'), true);
    down._h2.fire('keydown', { key: ' ', preventDefault: () => { prevented++; } });
    assert.equal(down.classList.contains('acc-open'), false);
    assert.equal(prevented, 2);
});

test('desktop clicks are inert (the accordion CSS is mobile-only)', () => {
    mqlMatches = false;
    initMobileAccordion();
    const up = panels['panel-upstream'];
    up._h2.fire('click');
    // No accordion toggling off the mobile media query.
    assert.equal(up.classList.contains('acc-open'), false);
    // And the headings carry no accordion ARIA on desktop.
    assert.equal(panels['panel-info']._h2.getAttribute('role'), null);
    assert.equal(panels['panel-info']._h2.getAttribute('aria-expanded'), null);
});

test('switching from desktop to mobile syncs the heading ARIA', () => {
    mqlMatches = false;
    initMobileAccordion();
    assert.equal(panels['panel-info']._h2.getAttribute('role'), null);
    // Emulate a viewport crossing the breakpoint into mobile.
    mqlMatches = true;
    assert.ok(typeof mqlChange === 'function', 'a matchMedia change listener was registered');
    mqlChange();
    assert.equal(panels['panel-info']._h2.getAttribute('role'), 'button');
    assert.equal(panels['panel-info']._h2.getAttribute('aria-expanded'), 'true');
    assert.equal(panels['panel-upstream']._h2.getAttribute('aria-expanded'), 'false');
});
