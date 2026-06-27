// Tests for the play-order model (``computePlayAhead`` in play-order.js):
// which currently-eligible siblings rank ahead of a dialogue in its play
// context. H2 ranks by NarrativeData ordinal; H1 by priority tier within
// the merged section context.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData, getActiveGame } from '../templates/viewer/data.js';
import { restoreSaveProgress, getSaveContext } from '../templates/viewer/save-parser.js';
import { computePlayAhead, playRank } from '../templates/viewer/play-order.js';

// localStorage stub so the save-restore path works under Node.
const _store = new Map();
globalThis.localStorage = {
    getItem: k => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: k => { _store.delete(k); },
};

function seedSave(played) {
    _store.set('hde.save', JSON.stringify({
        v: 13, gameId: getActiveGame(), runs: 1, played,
    }));
    restoreSaveProgress();
    return getSaveContext();
}

// H2 textline: owner+section priority list via narrativePriorityOrdinal.
function h2tl(ordinal, extra = {}) {
    return {
        owner: 'NPC_X_01', section: 'InteractTextLineSets',
        requirements: {}, otherRequirements: {}, playOnce: true,
        narrativePriorityOrdinal: ordinal, ...extra,
    };
}

function loadH2() {
    loadData({
        defaultGame: 'hades2',
        games: {
            hades2: {
                speakers: { NPC_X_01: { name: 'X' } },
                textlines: {
                    A: h2tl(1),
                    B: h2tl(2),
                    D: h2tl(3),
                    // ordinal 1 but blocked by an unplayed prereq -> ineligible.
                    Blocked: h2tl(1, { requirements: { RequiredTextLines: ['NeverPlayed'] } }),
                    // earlier ordinal but a different section -> different context.
                    Other: { owner: 'NPC_X_01', section: 'GiftTextLineSets', requirements: {}, otherRequirements: {}, playOnce: true, narrativePriorityOrdinal: 1 },
                },
                dependents: {},
            },
        },
    });
}

test('H2: ahead lists eligible-unplayed siblings with a lower ordinal, sorted', () => {
    loadH2();
    const ctx = seedSave([]);
    const res = computePlayAhead('D', ctx);
    assert.ok(res);
    assert.deepEqual(res.ahead.map(a => a.name), ['A', 'B']);
    assert.ok(res.hasOrdinal);
});

test('H2: a played sibling drops out of the ahead count', () => {
    loadH2();
    const ctx = seedSave(['A']);
    const res = computePlayAhead('D', ctx);
    assert.deepEqual(res.ahead.map(a => a.name), ['B']);
});

test('H2: an ineligible (blocked) earlier sibling is excluded', () => {
    loadH2();
    const ctx = seedSave([]);
    const res = computePlayAhead('D', ctx);
    assert.ok(!res.ahead.some(a => a.name === 'Blocked'));
});

test('H2: a lower-ordinal sibling in a different section is excluded', () => {
    loadH2();
    const ctx = seedSave([]);
    const res = computePlayAhead('D', ctx);
    assert.ok(!res.ahead.some(a => a.name === 'Other'));
});

test('H2: the highest-priority eligible line has nothing ahead (plays next)', () => {
    loadH2();
    const ctx = seedSave([]);
    const res = computePlayAhead('A', ctx);
    assert.equal(res.ahead.length, 0);
});

test('H2: repeatable flag is surfaced per ahead entry', () => {
    loadData({
        defaultGame: 'hades2',
        games: {
            hades2: {
                speakers: { NPC_X_01: { name: 'X' } },
                textlines: {
                    Rep: h2tl(1, { playOnce: false }),
                    D: h2tl(2),
                },
                dependents: {},
            },
        },
    });
    const ctx = seedSave([]);
    const res = computePlayAhead('D', ctx);
    assert.deepEqual(res.ahead, [{ name: 'Rep', repeatable: true }]);
});

// H1 textline: tier comes from narrativePrioritySectionTier; the Pickup
// family section keys merge into one context.
function h1tl(section, tier) {
    return {
        owner: 'NPC_Y_01', section,
        requirements: {}, otherRequirements: {}, playOnce: true,
        ...(tier ? { narrativePrioritySectionTier: tier } : {}),
    };
}

test('H1: ahead lists eligible higher-tier siblings in the merged context', () => {
    loadData({
        textlines: {
            Sup: h1tl('SuperPriorityPickupTextLineSets', 'super'),
            Pri: h1tl('PriorityPickupTextLineSets', 'priority'),
            Norm: h1tl('PickupTextLineSets', null),       // the traced normal line
            NormSibling: h1tl('PickupTextLineSets', null), // same tier -> not ahead
        },
        speakers: { NPC_Y_01: { name: 'Y' } },
    });
    assert.equal(getActiveGame(), 'hades1');
    const ctx = seedSave([]);
    const res = computePlayAhead('Norm', ctx);
    assert.deepEqual(res.ahead.map(a => a.name), ['Sup', 'Pri']);
});

test('H1: a super-priority line has nothing ahead', () => {
    loadData({
        textlines: {
            Sup: h1tl('SuperPriorityPickupTextLineSets', 'super'),
            Pri: h1tl('PriorityPickupTextLineSets', 'priority'),
        },
        speakers: { NPC_Y_01: { name: 'Y' } },
    });
    const ctx = seedSave([]);
    const res = computePlayAhead('Sup', ctx);
    assert.equal(res.ahead.length, 0);
});

test('computePlayAhead returns null for an unknown / ownerless dialogue', () => {
    loadH2();
    const ctx = seedSave([]);
    assert.equal(computePlayAhead('NotARealLine', ctx), null);
});

test('playRank: H2 uses ordinal (rank-less last); H1 uses tier then repeatable', () => {
    assert.equal(playRank({ narrativePriorityOrdinal: 5 }, 'hades2'), 5);
    assert.equal(playRank({}, 'hades2'), Infinity);
    assert.equal(playRank({ playOnce: true, narrativePrioritySectionTier: 'super' }, 'hades1'), 0);
    assert.equal(playRank({ playOnce: true, narrativePrioritySectionTier: 'priority' }, 'hades1'), 1);
    assert.equal(playRank({ playOnce: true }, 'hades1'), 2);
    assert.equal(playRank({ playOnce: false }, 'hades1'), 4);
});
