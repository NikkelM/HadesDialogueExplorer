// Tests for the softlock-warning modal's open/close lifecycle (softlock-warning.js).
//
// Focus: the ``_open`` guard must RESET when the modal closes, so a second
// softlocked save loaded later in the same session can re-open the warning
// (previously ``_open`` stuck true after the first dismiss, suppressing it).

import { test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

// Minimal DOM stub covering exactly what ``showSoftlockWarning`` touches:
// createElement, appendChild/remove (parentNode tracking), addEventListener,
// a memoising querySelector, and focus(). Element ``click()`` fires listeners.
function makeEl() {
    const el = {
        className: '', innerHTML: '', parentNode: null,
        _attrs: {}, _children: [], _listeners: {}, _q: {},
        setAttribute(k, v) { this._attrs[k] = v; },
        appendChild(c) { this._children.push(c); c.parentNode = this; return c; },
        remove() {
            if (this.parentNode) {
                this.parentNode._children = this.parentNode._children.filter((x) => x !== this);
                this.parentNode = null;
            }
        },
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        removeEventListener() {},
        querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl()); },
        focus() {},
        click() { (this._listeners.click || []).forEach((fn) => fn({ target: this, preventDefault() {} })); },
    };
    return el;
}

let body;
function installDom() {
    body = makeEl();
    globalThis.document = {
        body,
        createElement: () => makeEl(),
        addEventListener() {},
        removeEventListener() {},
    };
}

const { showSoftlockWarning } = await import('../templates/viewer/softlock-warning.js');

beforeEach(() => {
    installDom();
});

// The ``_open`` guard is module-level state, so dismiss any modal an earlier
// test left open (resetting ``_open``) to keep the tests isolated.
afterEach(() => {
    const overlay = body._children.find((c) => c.className === 'softlock-overlay');
    if (overlay) overlay._children[0].querySelector('.softlock-dismiss').click();
});

function overlayCount() {
    return body._children.filter((c) => c.className === 'softlock-overlay').length;
}

test('showSoftlockWarning mounts a single overlay', () => {
    showSoftlockWarning();
    assert.equal(overlayCount(), 1);
});

test('a second call while open does not stack a duplicate overlay', () => {
    showSoftlockWarning();
    showSoftlockWarning();
    assert.equal(overlayCount(), 1);
});

test('after dismiss, a later softlocked save re-opens the warning (the _open guard resets)', () => {
    // Save A: show, then dismiss.
    showSoftlockWarning();
    assert.equal(overlayCount(), 1);
    const overlay = body._children.find((c) => c.className === 'softlock-overlay');
    const dismiss = overlay._children[0].querySelector('.softlock-dismiss');
    dismiss.click(); // -> close()
    assert.equal(overlayCount(), 0);

    // Save B (same session): the warning must be able to open again.
    showSoftlockWarning();
    assert.equal(overlayCount(), 1);
});
