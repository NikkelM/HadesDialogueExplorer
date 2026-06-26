// Unit tests for the permanent ("set-and-forget") GameState classifier
// (``permanent-state.js``). These cover the monotonic-path allowlist and the
// per-operator permanence verdict, in isolation from the unobtainability engine.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { isMonotonicUpPath, gameStateClausePermanence } from '../templates/viewer/permanent-state.js';

describe('isMonotonicUpPath', () => {
    test('a write-once GameState flag is monotonic', () => {
        assert.equal(isMonotonicUpPath(['GameState', 'ReachedTrueEnding']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'TyphonDefeatedWithStormStop']), true);
    });

    test('an append-only sub-table entry is monotonic', () => {
        assert.equal(isMonotonicUpPath(['GameState', 'EnemyKills', 'Cerberus']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'Flags', 'SomeFlag']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'WorldUpgradesAdded', 'WorldUpgradeFoo']), true);
    });

    test('MetaUpgradeState is monotonic only at its Unlocked leaf', () => {
        assert.equal(isMonotonicUpPath(['GameState', 'MetaUpgradeState', 'ChaosArcana', 'Unlocked']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'MetaUpgradeState', 'ChaosArcana', 'Equipped']), false);
    });

    test('cosmetic WorldUpgrades entries are not one-way', () => {
        assert.equal(isMonotonicUpPath(['GameState', 'WorldUpgradesAdded', 'Cosmetic_Wall_01']), false);
    });

    test('unknown / resettable / CurrentRun paths are not monotonic', () => {
        assert.equal(isMonotonicUpPath(['GameState', 'LastDreamRunCleared']), false);
        assert.equal(isMonotonicUpPath(['GameState', 'ActiveShrineBounty']), false);
        assert.equal(isMonotonicUpPath(['CurrentRun', 'Foo']), false);
        assert.equal(isMonotonicUpPath(['GameState']), false);
        assert.equal(isMonotonicUpPath(null), false);
    });
});

describe('gameStateClausePermanence', () => {
    const gs = { ReachedTrueEnding: true, EnemyKills: { Cerberus: 3 }, RoomCountCache: { N1: 12 } };

    test('PathTrue on a monotonic path already truthy is permanently met', () => {
        assert.equal(gameStateClausePermanence({ PathTrue: ['GameState', 'ReachedTrueEnding'] }, gs), 'met');
    });

    test('PathTrue on a monotonic path still falsy is not provably permanent', () => {
        assert.equal(gameStateClausePermanence({ PathTrue: ['GameState', 'TyphonDefeatedWithStormStop'] }, gs), null);
    });

    test('PathFalse on a monotonic path already truthy is permanently unmet', () => {
        assert.equal(gameStateClausePermanence({ PathFalse: ['GameState', 'ReachedTrueEnding'] }, gs), 'unmet');
    });

    test('PathFalse on a monotonic path still falsy is not provably permanent', () => {
        assert.equal(gameStateClausePermanence({ PathFalse: ['GameState', 'TyphonDefeatedWithStormStop'] }, gs), null);
    });

    test('a clause on a non-monotonic path is never permanent', () => {
        assert.equal(gameStateClausePermanence({ PathTrue: ['GameState', 'ActiveShrineBounty'] }, gs), null);
        assert.equal(gameStateClausePermanence({ PathFalse: ['CurrentRun', 'Foo'] }, gs), null);
    });

    test('a >= comparison already satisfied on a monotonic counter is permanently met', () => {
        assert.equal(gameStateClausePermanence(
            { Comparison: '>=', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 3 }, gs), 'met');
        // Not yet reached -> can still grow into range, so not permanent.
        assert.equal(gameStateClausePermanence(
            { Comparison: '>=', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 9 }, gs), null);
    });

    test('a < comparison already false on a monotonic counter is permanently unmet', () => {
        // 3 is not < 3, and the counter only grows, so it can never become < 3.
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 3 }, gs), 'unmet');
        // 3 < 9 is true now, but growth can push it out of range -> not permanent.
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 9 }, gs), null);
    });

    test('equality comparisons are unstable as the counter grows -> null', () => {
        assert.equal(gameStateClausePermanence(
            { Comparison: '==', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 3 }, gs), null);
    });

    test('a comparison against another live value or with Modulo is never permanent', () => {
        assert.equal(gameStateClausePermanence(
            { Comparison: '>=', Path: ['GameState', 'EnemyKills', 'Cerberus'], ValuePath: ['GameState', 'X'], Value: 1 }, gs), null);
        assert.equal(gameStateClausePermanence(
            { Comparison: '>=', Path: ['GameState', 'EnemyKills', 'Cerberus'], Modulo: 2, Value: 0 }, gs), null);
    });

    test('HasAll / HasNone set-membership over a monotonic table', () => {
        const setGs = { ExorcisedNames: { Ghost_A: true, Ghost_B: true } };
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ExorcisedNames'], HasAll: ['Ghost_A', 'Ghost_B'] }, setGs), 'met');
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ExorcisedNames'], HasAny: ['Ghost_A'] }, setGs), 'met');
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ExorcisedNames'], HasNone: ['Ghost_A'] }, setGs), 'unmet');
        // A member not yet present -> the set may still gain it, so not permanent.
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ExorcisedNames'], HasAll: ['Ghost_A', 'Ghost_C'] }, setGs), null);
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ExorcisedNames'], HasAny: ['Ghost_C'] }, setGs), null);
    });

    test('a Has* over cosmetic WorldUpgrades entries is not provably permanent', () => {
        const wu = { WorldUpgradesAdded: { Cosmetic_Wall_01: true, WorldUpgradeFoo: true } };
        // Cosmetics can be removed -> can't claim permanence.
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'WorldUpgradesAdded'], HasAny: ['Cosmetic_Wall_01'] }, wu), null);
        // A non-cosmetic world upgrade is append-only -> permanent.
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'WorldUpgradesAdded'], HasAny: ['WorldUpgradeFoo'] }, wu), 'met');
    });

    test('a FunctionName / PathFromSource / SumPrev clause is never permanent', () => {
        assert.equal(gameStateClausePermanence({ FunctionName: 'IsThing', PathTrue: ['GameState', 'ReachedTrueEnding'] }, gs), null);
        assert.equal(gameStateClausePermanence({ PathFromSource: ['Foo'] }, gs), null);
        assert.equal(gameStateClausePermanence({ SumPrevRuns: ['GameState', 'X'], Comparison: '>=', Value: 1 }, gs), null);
    });

    test('a missing rec or slice yields null', () => {
        assert.equal(gameStateClausePermanence(null, gs), null);
        assert.equal(gameStateClausePermanence({ PathTrue: ['GameState', 'ReachedTrueEnding'] }, null), null);
    });
});
