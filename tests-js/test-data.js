// Tests for the per-game data layer in ``templates/viewer/data.js``.
//
// The viewer is strictly per-game: H1 and H2 are stored as two
// entirely separate datasets under ``games[gameId]`` and the
// per-binding ``let``s (``textlines``, ``speakers``, etc.) get
// swapped wholesale on toggle. These tests pin that swap behaviour
// so a future regression to cross-game leakage (the bug class that
// motivated the strict split) surfaces immediately.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import * as dataMod from '../templates/viewer/data.js';
const {
    loadData,
    setActiveGame,
    getActiveGame,
    resolveGame,
    getDefaultDialogue,
} = dataMod;

// Build a tiny per-game payload so tests can verify the binding
// swap without depending on the rest of the fixture surface.
function makeMultiGamePayload() {
    return {
        games: {
            hades1: {
                textlines: {
                    H1_Only: { owner: 'NPC_Zeus_01', section: 'GiftTextLineSets' },
                    HermesGift03: { owner: 'NPC_Hermes_01', section: 'GiftTextLineSets' },
                },
                dependents: { H1_Only: ['H1_Other'] },
                speakers: { NPC_Hermes_01: { name: 'Hermes' } },
                stats: { totalTextlines: 2, totalEdges: 1, unresolvedRefs: [] },
                reqTypeOrder: ['RequiredTextLines'],
            },
            hades2: {
                textlines: {
                    H2_Only: { owner: 'NPC_Hecate_01', section: 'GiftTextLineSets' },
                    HermesGift03: { owner: 'HermesUpgrade', section: 'BoughtTextLineSets' },
                },
                dependents: { H2_Only: ['H2_Other'] },
                speakers: { HermesUpgrade: { name: 'Hermes' } },
                stats: { totalTextlines: 2, totalEdges: 0, unresolvedRefs: [] },
                reqTypeOrder: ['RequiredAnyTextLines'],
            },
        },
        defaultGame: 'hades2',
        gameLabels: { hades1: 'Hades', hades2: 'Hades II' },
    };
}

test('loadData with multi-game payload activates the default game', () => {
    loadData(makeMultiGamePayload());
    assert.equal(getActiveGame(), 'hades2');
    assert.ok(dataMod.textlines.H2_Only, 'H2_Only should be present under hades2');
    assert.equal(dataMod.textlines.H1_Only, undefined, 'H1_Only must not leak into the active hades2 view');
});

test('getDefaultDialogue returns the active game\'s featured dialogue, validated against its data', () => {
    const payload = makeMultiGamePayload();
    payload.defaultDialogue = { hades2: 'H2_Only', hades1: 'NotARealName' };
    loadData(payload);
    // Active game is hades2; H2_Only exists -> returned.
    assert.equal(getDefaultDialogue(), 'H2_Only');
    // hades1's configured name isn't in its data -> null (no blank-home typo).
    setActiveGame('hades1');
    assert.equal(getDefaultDialogue(), null);
});

test('getDefaultDialogue returns null when no featured dialogue is configured', () => {
    loadData(makeMultiGamePayload());
    assert.equal(getDefaultDialogue(), null);
});

test('setActiveGame swaps every per-game binding wholesale', () => {
    loadData(makeMultiGamePayload());
    setActiveGame('hades1');
    assert.equal(getActiveGame(), 'hades1');
    assert.ok(dataMod.textlines.H1_Only, 'H1_Only should be present under hades1');
    assert.equal(dataMod.textlines.H2_Only, undefined, 'H2_Only must not leak into hades1');
    assert.deepEqual(dataMod.dependents, { H1_Only: ['H1_Other'] });
    assert.deepEqual(dataMod.reqTypeOrder, ['RequiredTextLines']);
    assert.deepEqual(dataMod.allNames, ['H1_Only', 'HermesGift03']);

    setActiveGame('hades2');
    assert.equal(getActiveGame(), 'hades2');
    assert.ok(dataMod.textlines.H2_Only);
    assert.equal(dataMod.textlines.H1_Only, undefined);
    assert.deepEqual(dataMod.dependents, { H2_Only: ['H2_Other'] });
    assert.deepEqual(dataMod.reqTypeOrder, ['RequiredAnyTextLines']);
});

test('HermesGift03 resolves to the active game, not the other', () => {
    loadData(makeMultiGamePayload());
    setActiveGame('hades1');
    assert.equal(dataMod.textlines.HermesGift03.section, 'GiftTextLineSets');
    assert.equal(dataMod.textlines.HermesGift03.owner, 'NPC_Hermes_01');

    setActiveGame('hades2');
    assert.equal(dataMod.textlines.HermesGift03.section, 'BoughtTextLineSets');
    assert.equal(dataMod.textlines.HermesGift03.owner, 'HermesUpgrade');
});

test('setActiveGame throws on an unknown game id', () => {
    loadData(makeMultiGamePayload());
    assert.throws(() => setActiveGame('hades3'), /Unknown game id/);
});

test('resolveGame falls back to the default for unknown ids', () => {
    loadData(makeMultiGamePayload());
    // Suppress the console.warn the resolver emits for invalid ids.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(resolveGame(undefined), 'hades2');
        assert.equal(resolveGame(null), 'hades2');
        assert.equal(resolveGame(''), 'hades2');
        assert.equal(resolveGame('hades3'), 'hades2');
        assert.equal(resolveGame('hades1'), 'hades1');
        assert.equal(resolveGame('hades2'), 'hades2');
    } finally {
        console.warn = origWarn;
    }
});

test('loadData with a flat single-game payload wraps under hades1', () => {
    // Legacy fixtures and unit tests pass flat ``{textlines, ...}`` payloads
    // without a ``games`` wrapper. The data layer auto-wraps so those
    // callers keep working unchanged.
    const flat = {
        textlines: { Foo: { owner: 'NPC_Bar_01', section: 'GiftTextLineSets' } },
        dependents: {},
        speakers: {},
        stats: { totalTextlines: 1, totalEdges: 0, unresolvedRefs: [] },
        reqTypeOrder: [],
    };
    loadData(flat);
    assert.equal(getActiveGame(), 'hades1');
    assert.ok(dataMod.textlines.Foo);
});
