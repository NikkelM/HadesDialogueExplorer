// Tests for the URL parameter scheme defined in
// ``templates/viewer/url.js``.
//
// These functions are pure (no DOM, no fetch) so they run unmodified
// under ``node --test``; no fixture/loadData call is needed.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    parseUrlState,
    serializeUrlState,
    urlStateKey,
} from '../templates/viewer/url.js';

// --- parseUrlState ------------------------------------------------

test('parseUrlState returns {} for an empty / missing hash', () => {
    assert.deepEqual(parseUrlState(''), {});
    assert.deepEqual(parseUrlState('#'), {});
    assert.deepEqual(parseUrlState(undefined), {});
    assert.deepEqual(parseUrlState(null), {});
});

test('parseUrlState reads a single key=value pair with leading #', () => {
    assert.deepEqual(parseUrlState('#dialogue=Foo'), { dialogue: 'Foo' });
});

test('parseUrlState reads a single key=value pair without leading #', () => {
    assert.deepEqual(parseUrlState('dialogue=Foo'), { dialogue: 'Foo' });
});

test('parseUrlState reads multiple ampersand-separated pairs', () => {
    assert.deepEqual(
        parseUrlState('#view=dialogue&dialogue=OrpheusSingsAgain02'),
        { view: 'dialogue', dialogue: 'OrpheusSingsAgain02' },
    );
});

test('parseUrlState URL-decodes both keys and values', () => {
    assert.deepEqual(
        parseUrlState('#view=dialogue&dialogue=Foo%20Bar'),
        { view: 'dialogue', dialogue: 'Foo Bar' },
    );
    assert.deepEqual(
        parseUrlState('#a%26b=c%26d'),
        { 'a&b': 'c&d' },
    );
});

test('parseUrlState preserves unknown keys for forward compatibility', () => {
    assert.deepEqual(
        parseUrlState('#view=speaker&speaker=Megaera&priority=super'),
        { view: 'speaker', speaker: 'Megaera', priority: 'super' },
    );
});

test('parseUrlState drops empty values so callers can probe directly', () => {
    assert.deepEqual(
        parseUrlState('#view=&dialogue=Foo'),
        { dialogue: 'Foo' },
    );
    assert.deepEqual(parseUrlState('#dialogue='), {});
});

test('parseUrlState skips stray flag-style entries without `=`', () => {
    assert.deepEqual(
        parseUrlState('#foo&dialogue=Bar'),
        { dialogue: 'Bar' },
    );
});

test('parseUrlState recovers from malformed percent-escapes', () => {
    // ``%ZZ`` is not a valid escape; decodeURIComponent throws and the
    // helper falls back to the raw text so the user still sees
    // something meaningful instead of an empty panel.
    assert.deepEqual(
        parseUrlState('#dialogue=Foo%ZZ'),
        { dialogue: 'Foo%ZZ' },
    );
});

test('parseUrlState ignores empty pairs from doubled ampersands', () => {
    assert.deepEqual(
        parseUrlState('#view=dialogue&&dialogue=Foo'),
        { view: 'dialogue', dialogue: 'Foo' },
    );
});

// --- serializeUrlState --------------------------------------------

test('serializeUrlState returns empty string for empty / nullish input', () => {
    assert.equal(serializeUrlState({}), '');
    assert.equal(serializeUrlState(null), '');
    assert.equal(serializeUrlState(undefined), '');
});

test('serializeUrlState writes known keys in canonical order', () => {
    // Even though the input puts ``dialogue`` first, the output keeps
    // the canonical ``game, view, dialogue, speaker`` order so the URL
    // is stable across renders.
    assert.equal(
        serializeUrlState({ dialogue: 'Foo', view: 'dialogue' }),
        'view=dialogue&dialogue=Foo',
    );
});

test('serializeUrlState emits game first in canonical order', () => {
    // The viewer is strictly per-game and the game id bounds the
    // namespace every other key resolves against, so ``game`` is
    // pinned to the front of the URL regardless of insertion order.
    assert.equal(
        serializeUrlState({ dialogue: 'Foo', view: 'dialogue', game: 'hades2' }),
        'game=hades2&view=dialogue&dialogue=Foo',
    );
    assert.equal(
        serializeUrlState({ speaker: 'Megaera', game: 'hades1' }),
        'game=hades1&speaker=Megaera',
    );
});

test('serializeUrlState URL-encodes values with special characters', () => {
    assert.equal(
        serializeUrlState({ view: 'dialogue', dialogue: 'Foo Bar' }),
        'view=dialogue&dialogue=Foo%20Bar',
    );
    assert.equal(
        serializeUrlState({ dialogue: 'A&B' }),
        'dialogue=A%26B',
    );
});

test('serializeUrlState drops empty / nullish values', () => {
    assert.equal(
        serializeUrlState({ view: '', dialogue: 'Foo' }),
        'dialogue=Foo',
    );
    assert.equal(
        serializeUrlState({ view: 'dialogue', dialogue: null }),
        'view=dialogue',
    );
    assert.equal(
        serializeUrlState({ view: 'dialogue', dialogue: undefined }),
        'view=dialogue',
    );
});

test('serializeUrlState emits unknown keys after the canonical ones', () => {
    assert.equal(
        serializeUrlState({ view: 'dialogue', dialogue: 'Foo', extra: 'x' }),
        'view=dialogue&dialogue=Foo&extra=x',
    );
});

test('serializeUrlState round-trips through parseUrlState', () => {
    const original = { view: 'speaker', speaker: 'Megaera', priority: 'super' };
    const serialized = serializeUrlState(original);
    assert.deepEqual(parseUrlState('#' + serialized), original);
});

test('parseUrlState reads the game key alongside dialogue', () => {
    assert.deepEqual(
        parseUrlState('#game=hades2&view=dialogue&dialogue=HermesGift03'),
        { game: 'hades2', view: 'dialogue', dialogue: 'HermesGift03' },
    );
});

test('serializeUrlState round-trips with game key in canonical position', () => {
    const original = { game: 'hades1', view: 'dialogue', dialogue: 'HermesGift03' };
    const serialized = serializeUrlState(original);
    assert.equal(serialized, 'game=hades1&view=dialogue&dialogue=HermesGift03');
    assert.deepEqual(parseUrlState('#' + serialized), original);
});

// --- urlStateKey --------------------------------------------------

test('urlStateKey is order-independent', () => {
    assert.equal(
        urlStateKey({ view: 'dialogue', dialogue: 'Foo' }),
        urlStateKey({ dialogue: 'Foo', view: 'dialogue' }),
    );
});

test('urlStateKey returns the empty string for empty / nullish state', () => {
    assert.equal(urlStateKey({}), '');
    assert.equal(urlStateKey(null), '');
    assert.equal(urlStateKey(undefined), '');
});

test('urlStateKey distinguishes different states', () => {
    assert.notEqual(
        urlStateKey({ view: 'dialogue', dialogue: 'Foo' }),
        urlStateKey({ view: 'dialogue', dialogue: 'Bar' }),
    );
});
