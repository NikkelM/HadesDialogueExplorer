// Tests for the pure helper(s) exported by ``search-ui.js``.
//
// The DOM-touching parts of the search dropdown live behind
// :func:`initSearch` and are exercised manually in the browser plus
// the boot-time smoke test. The wrap arithmetic for arrow-key
// navigation is the one piece of logic that warrants targeted unit
// coverage because off-by-one bugs at the boundaries (empty list,
// wrap forward, wrap backward, single-row list, no current
// selection) are subtle and silent.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { advanceActiveIndex } from '../templates/viewer/search-ui.js';

test('advanceActiveIndex: empty list returns -1 regardless of direction', () => {
    assert.equal(advanceActiveIndex(-1, 0, 1), -1);
    assert.equal(advanceActiveIndex(-1, 0, -1), -1);
    // Defensive: a stale ``currentIndex`` against an emptied list
    // must not return a positive number.
    assert.equal(advanceActiveIndex(3, 0, 1), -1);
});

test('advanceActiveIndex: no current selection moves to the first row on ArrowDown', () => {
    assert.equal(advanceActiveIndex(-1, 5, 1), 0);
});

test('advanceActiveIndex: no current selection moves to the last row on ArrowUp', () => {
    // Symmetric to ArrowDown -> 0; arrow-up from "nothing" lands
    // on the last row so the user can step backwards into the
    // dropdown without first cycling all the way through.
    assert.equal(advanceActiveIndex(-1, 5, -1), 4);
});

test('advanceActiveIndex: ArrowDown advances by one within bounds', () => {
    assert.equal(advanceActiveIndex(0, 5, 1), 1);
    assert.equal(advanceActiveIndex(2, 5, 1), 3);
    assert.equal(advanceActiveIndex(3, 5, 1), 4);
});

test('advanceActiveIndex: ArrowUp decrements by one within bounds', () => {
    assert.equal(advanceActiveIndex(4, 5, -1), 3);
    assert.equal(advanceActiveIndex(2, 5, -1), 1);
    assert.equal(advanceActiveIndex(1, 5, -1), 0);
});

test('advanceActiveIndex: ArrowDown wraps from the last row back to the first', () => {
    assert.equal(advanceActiveIndex(4, 5, 1), 0);
});

test('advanceActiveIndex: ArrowUp wraps from the first row to the last', () => {
    assert.equal(advanceActiveIndex(0, 5, -1), 4);
});

test('advanceActiveIndex: single-row list wraps to itself in both directions', () => {
    // With just one option, both arrow keys must keep the user
    // pointing at the single available row rather than landing on
    // an invalid index.
    assert.equal(advanceActiveIndex(0, 1, 1), 0);
    assert.equal(advanceActiveIndex(0, 1, -1), 0);
    assert.equal(advanceActiveIndex(-1, 1, 1), 0);
    assert.equal(advanceActiveIndex(-1, 1, -1), 0);
});
