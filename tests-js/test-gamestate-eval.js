// Tests for the GameState requirement evaluator (gamestate-eval.js): the JS
// port of the engine's IsGameStateEligible array-clause rules. Synthetic
// GameState slices exercise each clause type plus the resolvable/unresolvable
// split and named-requirement recursion.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData } from '../templates/viewer/data.js';
import { evaluateOtherRequirements, collectGameStatePaths, pruneGameState, collectRunPaths } from '../templates/viewer/gamestate-eval.js';

// Named-requirement blocks + a GameData list so ref-counting and recursion can
// be exercised; loaded as the active game's bindings.
before(() => {
    loadData({
        textlines: {},
        speakers: {},
        gameDataRefs: { 'GameData.Trio': ['A', 'B', 'C'] },
        namedRequirements: {
            TrueEndingReached: { otherRequirements: { 'PathTrue:GameState.ReachedTrueEnding': [{ PathTrue: ['GameState', 'ReachedTrueEnding'] }] } },
            // a block that reads CurrentRun -> unknown
            MidRun: { otherRequirements: { 'PathTrue:CurrentRun.Cleared': [{ PathTrue: ['CurrentRun', 'Cleared'] }] } },
        },
    });
});

const evalReq = (other, gs) => evaluateOtherRequirements(other, gs).status;
const clause = (rec) => ({ 'K': [rec] });

test('Comparison: missing GameState path coerces to 0', () => {
    const rec = { Path: ['GameState', 'EnemyKills', 'Hecate'], Comparison: '>=', Value: 2 };
    assert.equal(evalReq(clause(rec), { EnemyKills: { Hecate: 3 } }), 'met');
    assert.equal(evalReq(clause(rec), { EnemyKills: { Hecate: 1 } }), 'unmet');
    assert.equal(evalReq(clause(rec), { EnemyKills: {} }), 'unmet'); // missing -> 0
    assert.equal(evalReq(clause(rec), {}), 'unmet');                  // missing table -> 0
});

test('PathTrue: passes only on a non-nil, non-false, non-zero value', () => {
    const rec = { PathTrue: ['GameState', 'ScreensViewed', 'Shrine'] };
    assert.equal(evalReq(clause(rec), { ScreensViewed: { Shrine: true } }), 'met');
    assert.equal(evalReq(clause(rec), { ScreensViewed: { Shrine: 0 } }), 'unmet'); // 0 fails PathTrue
    assert.equal(evalReq(clause(rec), { ScreensViewed: {} }), 'unmet');
});

test('PathFalse: passes only on nil/false (0 is truthy here, so it fails)', () => {
    const rec = { PathFalse: ['GameState', 'Flags', 'X'] };
    assert.equal(evalReq(clause(rec), { Flags: {} }), 'met');           // nil -> met
    assert.equal(evalReq(clause(rec), { Flags: { X: false } }), 'met');
    assert.equal(evalReq(clause(rec), { Flags: { X: true } }), 'unmet');
    assert.equal(evalReq(clause(rec), { Flags: { X: 0 } }), 'unmet');   // 0 is Lua-truthy
});

test('PathEmpty / PathNotEmpty test table emptiness (nil or zero keys)', () => {
    const empty = { PathEmpty: ['GameState', 'Gift'] };
    const notEmpty = { PathNotEmpty: ['GameState', 'Gift'] };
    assert.equal(evalReq(clause(empty), { }), 'met');                    // nil -> empty
    assert.equal(evalReq(clause(empty), { Gift: {} }), 'met');
    assert.equal(evalReq(clause(empty), { Gift: { a: 1 } }), 'unmet');
    assert.equal(evalReq(clause(notEmpty), { Gift: { a: 1 } }), 'met');
    assert.equal(evalReq(clause(notEmpty), { Gift: {} }), 'unmet');
});

test('HasAny / HasAll / HasNone over a resolved table', () => {
    const gs = { WeaponsUnlocked: { WeaponAxe: true, WeaponLob: true } };
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAny: ['WeaponAxe', 'WeaponNope'] }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAny: ['WeaponNope'] }), gs), 'unmet');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAll: ['WeaponAxe', 'WeaponLob'] }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAll: ['WeaponAxe', 'WeaponNope'] }), gs), 'unmet');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasNone: ['WeaponNope'] }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasNone: ['WeaponAxe'] }), gs), 'unmet');
});

test('HasAny / HasAll / HasNone resolve a GameData <ref> operand; missing ref -> unknown', () => {
    const gs = { WeaponsUnlocked: { A: true, B: true } };
    // <ref:GameData.Trio> -> ['A','B','C']: A,B present.
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAny: '<ref:GameData.Trio>' }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAll: '<ref:GameData.Trio>' }), gs), 'unmet'); // C missing
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasNone: '<ref:GameData.Trio>' }), gs), 'unmet'); // A present
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], HasAll: '<ref:GameData.Nope>' }), gs), 'unknown');
});

test('IsAny / IsNone over a resolved scalar', () => {
    const gs = { GamePhase: 6 };
    assert.equal(evalReq(clause({ Path: ['GameState', 'GamePhase'], IsAny: [5, 6] }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'GamePhase'], IsAny: [1, 2] }), gs), 'unmet');
    assert.equal(evalReq(clause({ Path: ['GameState', 'GamePhase'], IsNone: [1, 2] }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'GamePhase'], IsNone: [6] }), gs), 'unmet');
});

test('UseLength counts table keys, then compares', () => {
    const rec = { Path: ['GameState', 'GiftPresentation'], UseLength: true, Comparison: '>=', Value: 2 };
    assert.equal(evalReq(clause(rec), { GiftPresentation: { a: 1, b: 1, c: 1 } }), 'met');
    assert.equal(evalReq(clause(rec), { GiftPresentation: { a: 1 } }), 'unmet');
    assert.equal(evalReq(clause(rec), {}), 'unmet'); // nil -> length 0
});

test('CountOf counts present keys (literal list and GameData <ref>)', () => {
    const gs = { WeaponsUnlocked: { A: true, B: true } };
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], CountOf: ['A', 'B', 'C'], Comparison: '>=', Value: 2 }), gs), 'met');
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], CountOf: ['A', 'B', 'C'], Comparison: '>=', Value: 3 }), gs), 'unmet');
    // GameData ref resolves to ['A','B','C']: 2 present.
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], CountOf: '<ref:GameData.Trio>', Comparison: '==', Value: 2 }), gs), 'met');
    // Missing GameData ref -> unknown.
    assert.equal(evalReq(clause({ Path: ['GameState', 'WeaponsUnlocked'], CountOf: '<ref:GameData.Nope>', Comparison: '>=', Value: 1 }), gs), 'unknown');
});

test('SumOf sums values at listed keys, missing -> 0', () => {
    const rec = { Path: ['GameState', 'RoomsEntered'], SumOf: ['N_Boss01', 'N_Boss02'], Comparison: '>=', Value: 3 };
    assert.equal(evalReq(clause(rec), { RoomsEntered: { N_Boss01: 2, N_Boss02: 2 } }), 'met'); // 4
    assert.equal(evalReq(clause(rec), { RoomsEntered: { N_Boss01: 1 } }), 'unmet');            // 1
});

test('ValuePath compares against another GameState path (+ addition)', () => {
    const gs = { LastObjectiveFailedRun: { NemesisBet: 700 }, CompletedRunsCache: 709 };
    // NemesisBet < CompletedRunsCache - 5  =>  700 < 704  => met
    const rec = { Path: ['GameState', 'LastObjectiveFailedRun', 'NemesisBet'], Comparison: '<', ValuePath: ['GameState', 'CompletedRunsCache'], ValuePathAddition: -5 };
    assert.equal(evalReq(clause(rec), gs), 'met');
    assert.equal(evalReq(clause(rec), { LastObjectiveFailedRun: { NemesisBet: 706 }, CompletedRunsCache: 709 }), 'unmet'); // 706 < 704 false
});

test('a whole set ANDs its clauses (any unmet -> unmet; unknown only if no unmet)', () => {
    const gs = { ReachedTrueEnding: true, EnemyKills: { Hecate: 1 } };
    const other = {
        'PathTrue:GameState.ReachedTrueEnding': [{ PathTrue: ['GameState', 'ReachedTrueEnding'] }], // met
        'Path:GameState.EnemyKills.Hecate': [{ Path: ['GameState', 'EnemyKills', 'Hecate'], Comparison: '>=', Value: 2 }], // unmet
    };
    assert.equal(evaluateOtherRequirements(other, gs).status, 'unmet');
});

test('NamedRequirementsFalse: unmet when a named block is met (NOT semantics)', () => {
    const gs = { ReachedTrueEnding: true };
    assert.equal(evalReq({ NamedRequirementsFalse: ['TrueEndingReached'] }, gs), 'unmet');
    assert.equal(evalReq({ NamedRequirementsFalse: ['TrueEndingReached'] }, { ReachedTrueEnding: false }), 'met');
    // A named block reading CurrentRun can't be confirmed -> unknown.
    assert.equal(evalReq({ NamedRequirementsFalse: ['MidRun'] }, gs), 'unknown');
});

test('unresolvable clauses report unknown with a reason', () => {
    const cases = [
        { FunctionName: 'RequiredAlive', FunctionArgs: {} },
        { PathFromSource: true, PathTrue: ['WasRandomLoot'] },
        { Path: ['CurrentRun', 'RoomsEntered'], HasAny: ['O_Boss01'] },
        { Path: ['AudioState', 'AmbientTrackName'], IsAny: ['/Music/X'] },
        { Path: ['GameState', 'RoomsEntered'], SumPrevRuns: 4, TableValuesToCount: ['Q_Boss01'], Comparison: '>=', Value: 1 },
    ];
    for (const rec of cases) {
        const r = evaluateOtherRequirements(clause(rec), {});
        assert.equal(r.clauses[0].status, 'unknown', JSON.stringify(rec));
        assert.ok(r.clauses[0].reason && r.clauses[0].reason.length > 0, 'has a reason: ' + JSON.stringify(rec));
    }
});

test('empty set -> met; no save -> unknown', () => {
    assert.equal(evaluateOtherRequirements({}, {}).status, 'met');
    assert.equal(evaluateOtherRequirements(null, {}).status, 'met');
    const r = evaluateOtherRequirements({ 'PathTrue:GameState.X': [{ PathTrue: ['GameState', 'X'] }] }, null);
    assert.equal(r.status, 'unknown');
});

test('collectGameStatePaths + pruneGameState capture only referenced leaves', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'Path:GameState.EnemyKills.Hecate': [{ Path: ['GameState', 'EnemyKills', 'Hecate'], Comparison: '>=', Value: 2 }],
                'Path:GameState.WeaponsUnlocked': [{ Path: ['GameState', 'WeaponsUnlocked'], HasAny: ['WeaponAxe'] }],
                'Path:GameState.GiftPresentation': [{ Path: ['GameState', 'GiftPresentation'], UseLength: true, Comparison: '>=', Value: 1 }],
                'NamedRequirementsFalse': ['TrueEndingReached'],
                'FunctionName:RequiredAlive': [{ FunctionName: 'RequiredAlive' }], // skipped
                'Path:CurrentRun.Cleared': [{ Path: ['CurrentRun', 'Cleared'], Comparison: '>=', Value: 1 }], // skipped (not GameState)
            },
        },
    };
    const mask = collectGameStatePaths(textlines, {
        TrueEndingReached: { otherRequirements: { 'PathTrue:GameState.ReachedTrueEnding': [{ PathTrue: ['GameState', 'ReachedTrueEnding'] }] } },
    });
    // EnemyKills.Hecate is a leaf; WeaponsUnlocked.WeaponAxe a member leaf;
    // GiftPresentation a whole table (UseLength); ReachedTrueEnding via the
    // named block. CurrentRun / FunctionName excluded.
    assert.deepEqual(mask, {
        EnemyKills: { Hecate: true },
        WeaponsUnlocked: { WeaponAxe: true },
        GiftPresentation: '*',
        ReachedTrueEnding: true,
    });

    const fullGs = {
        EnemyKills: { Hecate: 3, Polyphemus: 9, ...Object.fromEntries(Array.from({ length: 400 }, (_, i) => ['E' + i, i])) },
        WeaponsUnlocked: { WeaponAxe: true, WeaponLob: true, WeaponTorch: true },
        GiftPresentation: { a: 1, b: 1 },
        ReachedTrueEnding: true,
        SpeechRecord: Object.fromEntries(Array.from({ length: 9999 }, (_, i) => ['c' + i, 1])), // huge, unreferenced
    };
    const slice = pruneGameState(fullGs, mask);
    assert.deepEqual(slice, {
        EnemyKills: { Hecate: 3 },             // only the referenced leaf
        WeaponsUnlocked: { WeaponAxe: true },  // only the referenced member
        GiftPresentation: { a: 1, b: 1 },      // whole (UseLength)
        ReachedTrueEnding: true,
    });
    // The slice still evaluates correctly: ReachedTrueEnding is true, so the
    // NamedRequirementsFalse(TrueEndingReached) gate is violated -> unmet.
    assert.equal(evaluateOtherRequirements(textlines.T1.otherRequirements, slice).status, 'unmet');
});

// --- SumPrevRuns: aggregation across the current run + recent RunHistory ---

// Evaluate a SumPrevRuns clause; ``runs`` is the persisted runs slice
// ([currentRun, ...history], each pruned to the referenced run-relative leaves).
const evalRuns = (rec, runs) => evaluateOtherRequirements(clause(rec), {}, runs).status;

test('SumPrevRuns numericSum: totals a run-relative path over N runs', () => {
    const rec = { Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 5 };
    const runs = [{ EnemyKills: { Hydra: 2 } }, { EnemyKills: { Hydra: 2 } }, { EnemyKills: { Hydra: 1 } }, { EnemyKills: { Hydra: 9 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // 2+2+1 = 5 (4th run outside window)
    assert.equal(evalRuns({ ...rec, Value: 6 }, runs), 'unmet');
});

test('SumPrevRuns IgnoreCurrentRun skips runs[0]', () => {
    const rec = { Path: ['RoomsEntered', 'N_Opening01'], SumPrevRuns: 2, Comparison: '>=', Value: 2, IgnoreCurrentRun: true };
    const runs = [{ RoomsEntered: { N_Opening01: 99 } }, { RoomsEntered: { N_Opening01: 1 } }, { RoomsEntered: { N_Opening01: 1 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // skips current (99), sums next two: 1+1
    assert.equal(evalRuns({ ...rec, Value: 3 }, runs), 'unmet');
});

test('SumPrevRuns CountPathTrue: counts runs where the path is non-nil', () => {
    const rec = { Path: ['TextLinesRecord', 'HecateWithArachne01'], SumPrevRuns: 3, Comparison: '>=', Value: 2, CountPathTrue: true };
    const runs = [{ TextLinesRecord: { HecateWithArachne01: true } }, { TextLinesRecord: {} }, { TextLinesRecord: { HecateWithArachne01: 1 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // 2 of 3 runs have it
    assert.equal(evalRuns({ ...rec, Value: 3 }, runs), 'unmet');
});

test('SumPrevRuns TableValuesToCount: counts listed keys present per run', () => {
    const rec = { Path: ['RoomsEntered'], SumPrevRuns: 2, Comparison: '>=', Value: 3, TableValuesToCount: ['Q_Boss01', 'Q_Boss02'] };
    const runs = [{ RoomsEntered: { Q_Boss01: 1, Q_Boss02: 1 } }, { RoomsEntered: { Q_Boss01: 1 } }, { RoomsEntered: { Q_Boss01: 1, Q_Boss02: 1 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // run0: 2, run1: 1 -> 3
    assert.equal(evalRuns({ ...rec, Value: 4 }, runs), 'unmet');
});

test('SumPrevRuns ValuesToCount: counts runs whose scalar value matches', () => {
    const rec = { Path: ['IsDreamRun'], SumPrevRuns: 3, Comparison: '>=', Value: 2, ValuesToCount: [true] };
    const runs = [{ IsDreamRun: true }, { IsDreamRun: false }, { IsDreamRun: true }];
    assert.equal(evalRuns(rec, runs), 'met');
    assert.equal(evalRuns({ ...rec, Value: 3 }, runs), 'unmet');
});

test('SumPrevRuns with no runs slice -> unknown', () => {
    const rec = { Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 1 };
    assert.equal(evalRuns(rec, null), 'unknown');
});

test('collectRunPaths: run-relative mask + max look-back depth', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'A': [{ Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 1 }],
                'B': [{ Path: ['RoomsEntered'], SumPrevRuns: 6, Comparison: '>=', Value: 1, TableValuesToCount: ['Q_Boss01', 'Q_Boss02'] }],
                'C': [{ Path: ['GameState', 'EnemyKills', 'Hecate'], Comparison: '>=', Value: 1 }], // not SumPrevRuns -> ignored
            },
        },
    };
    const { mask, maxRuns } = collectRunPaths(textlines, {});
    assert.equal(maxRuns, 6);
    assert.deepEqual(mask, {
        EnemyKills: { Hydra: true },
        RoomsEntered: { Q_Boss01: true, Q_Boss02: true },
    });
});
