// Unit tests for the permanent ("set-and-forget") GameState classifier
// (``permanent-state.js``). These cover the monotonic-path allowlist and the
// per-operator permanence verdict, in isolation from the unobtainability engine.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { isMonotonicUpPath, isMonotonicTablePath, gameStateClausePermanence } from '../templates/viewer/permanent-state.js';

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

    test('lifetime run-count caches are monotonic; the shrine-spend cache is not', () => {
        // Derived from the append-only RunHistory -> only grow.
        assert.equal(isMonotonicUpPath(['GameState', 'CompletedRunsCache']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'ClearedRunsCache']), true);
        // Per-surface / dream-dive clear counts and the highest-Fear-cleared
        // "high water mark" caches are one-way too.
        assert.equal(isMonotonicUpPath(['GameState', 'ClearedUnderworldRunsCache']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'ClearedSurfaceRunsCache']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'ClearedDreamRunsCache']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'HighestShrinePointClearUnderworldCache']), true);
        assert.equal(isMonotonicUpPath(['GameState', 'HighestShrinePointClearSurfaceCache']), true);
        // Tracks the current Oath-of-the-Unseen spend; ranking down lowers it.
        assert.equal(isMonotonicUpPath(['GameState', 'SpentShrinePointsCache']), false);
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

    test('an == comparison is permanently unmet once the counter grows past the target', () => {
        // Counter is 3. "== 3" is currently met (not permanently unmet) -> null.
        assert.equal(gameStateClausePermanence(
            { Comparison: '==', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 3 }, gs), null);
        // "== 2": the counter has already grown past 2 and never returns -> unmet.
        assert.equal(gameStateClausePermanence(
            { Comparison: '==', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 2 }, gs), 'unmet');
        // "== 5": still reachable as the counter climbs -> not permanent.
        assert.equal(gameStateClausePermanence(
            { Comparison: '==', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 5 }, gs), null);
        // ~= stays unstable (flips as the counter passes the target) -> null.
        assert.equal(gameStateClausePermanence(
            { Comparison: '~=', Path: ['GameState', 'EnemyKills', 'Cerberus'], Value: 2 }, gs), null);
    });

    test('a CountOf upper bound already exceeded over a monotonic table is permanently unmet', () => {
        // All five familiars unlocked: count is 5, so "< 5" can never hold again
        // (FamiliarsUnlocked only grows) -> the clause is permanently unmet.
        const fam = { FamiliarsUnlocked: { FrogFamiliar: true, RavenFamiliar: true, CatFamiliar: true, HoundFamiliar: true, PolecatFamiliar: true } };
        const list = ['FrogFamiliar', 'RavenFamiliar', 'CatFamiliar', 'HoundFamiliar', 'PolecatFamiliar'];
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 5 }, fam), 'unmet');
        // The lower-bound half of the same gate is already satisfied and stays so.
        assert.equal(gameStateClausePermanence(
            { Comparison: '>=', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 3 }, fam), 'met');
    });

    test('a CountOf still inside its range is not provably permanent', () => {
        // Four of five unlocked: count is 4, "< 5" holds now but a fifth unlock
        // would break it, so it is not yet permanent either way.
        const fam = { FamiliarsUnlocked: { FrogFamiliar: true, RavenFamiliar: true, CatFamiliar: true, HoundFamiliar: true } };
        const list = ['FrogFamiliar', 'RavenFamiliar', 'CatFamiliar', 'HoundFamiliar', 'PolecatFamiliar'];
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 5 }, fam), null);
    });

    test('a CountOf / SumOf with an unresolved <ref:...> list stays null', () => {
        const fam = { FamiliarsUnlocked: { FrogFamiliar: true } };
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', CountOf: '<ref:GameData.AllFamiliars>', Path: ['GameState', 'FamiliarsUnlocked'], Value: 5 }, fam), null);
    });

    test('a SumOf upper bound already exceeded over a monotonic counter table is permanently unmet', () => {
        const rooms = { RoomsEntered: { N_Boss01: 2, N_Boss02: 2 } };
        assert.equal(gameStateClausePermanence(
            { Comparison: '<', SumOf: ['N_Boss01', 'N_Boss02'], Path: ['GameState', 'RoomsEntered'], Value: 3 }, rooms), 'unmet');
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

    test('the cleared-with-weapons sets are one-way (a "must NOT have cleared with X" gate is unobtainable once cleared)', () => {
        // GameState.ClearedWithWeapons.<region> is a per-region set of weapons a
        // run has been cleared with - only ever appended to.
        const clearedI = { ClearedWithWeapons: { I: { WeaponDagger: true } } };
        // "must NOT have cleared Tartarus with the Sister Blades" - permanently
        // unmet once it has happened (e.g. ArtemisAboutDagger01).
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ClearedWithWeapons', 'I'], HasNone: ['WeaponDagger'] }, clearedI), 'unmet');
        // A weapon not yet used to clear that region -> the set may still gain it.
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'ClearedWithWeapons', 'I'], HasNone: ['WeaponAxe'] }, clearedI), null);
        // The flat Dream-Dive variant (no region nesting) is likewise one-way.
        const dream = { DreamRunClearedWithWeapons: { WeaponDagger: true, WeaponAxe: true } };
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'DreamRunClearedWithWeapons'], HasAll: ['WeaponDagger', 'WeaponAxe'] }, dream), 'met');
        assert.equal(gameStateClausePermanence(
            { Path: ['GameState', 'DreamRunClearedWithWeapons'], HasAll: ['WeaponDagger', 'WeaponTorch'] }, dream), null);
    });

    test('isMonotonicTablePath accepts the nested ClearedWithWeapons.<region> set', () => {
        assert.equal(isMonotonicTablePath(['GameState', 'ClearedWithWeapons', 'I']), true);
        assert.equal(isMonotonicTablePath(['GameState', 'DreamRunClearedWithWeapons']), true);
        // A generic table is only a set at depth 2, not 3.
        assert.equal(isMonotonicTablePath(['GameState', 'ExorcisedNames']), true);
        assert.equal(isMonotonicTablePath(['GameState', 'ExorcisedNames', 'Ghost_A']), false);
    });

    test('a "cleared below Fear N" / "fewer than N clears" gate is unobtainable once passed', () => {
        // Highest Fear cleared only rises: a "< 8" gate is unmet forever once you
        // have cleared Fear 8+ (SkellyAboutTrophyQuestProgress01_B); a ">= 8"
        // gate is still reachable (ArtemisAboutShrine01-style progress).
        const fear = { HighestShrinePointClearUnderworldCache: 8 };
        assert.equal(gameStateClausePermanence({ Comparison: '<', Path: ['GameState', 'HighestShrinePointClearUnderworldCache'], Value: 8 }, fear), 'unmet');
        assert.equal(gameStateClausePermanence({ Comparison: '<=', Path: ['GameState', 'HighestShrinePointClearUnderworldCache'], Value: 4 }, fear), 'unmet');
        assert.equal(gameStateClausePermanence({ Comparison: '>=', Path: ['GameState', 'HighestShrinePointClearUnderworldCache'], Value: 16 }, fear), null);
        // First-clear gates ("< 1 underworld clears") go unobtainable once cleared
        // (HermesAboutChronosPlan01 / ArtemisAboutApollo01).
        const cleared = { ClearedUnderworldRunsCache: 3 };
        assert.equal(gameStateClausePermanence({ Comparison: '<', Path: ['GameState', 'ClearedUnderworldRunsCache'], Value: 1 }, cleared), 'unmet');
        assert.equal(gameStateClausePermanence({ Comparison: '>=', Path: ['GameState', 'ClearedUnderworldRunsCache'], Value: 9 }, cleared), null);
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
