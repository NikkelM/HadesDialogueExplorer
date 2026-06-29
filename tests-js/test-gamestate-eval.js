// Tests for the GameState requirement evaluator (gamestate-eval.js): the JS
// port of the engine's IsGameStateEligible array-clause rules. Synthetic
// GameState slices exercise each clause type plus the resolvable/unresolvable
// split and named-requirement recursion.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData } from '../templates/viewer/data.js';
import { evaluateOtherRequirements, collectGameStatePaths, pruneGameState, collectRunPaths, collectCurrentRunPaths, collectRoomPaths, collectPrevRunPaths, collectRunHistoryClearMask, currentRunResolvable, OWNER_RUN_CONTEXT, gateClausePermanentlyUnmet, h2OperandMarks } from '../templates/viewer/gamestate-eval.js';

// Named-requirement blocks + a GameData list so ref-counting and recursion can
// be exercised; loaded as the active game's bindings.
before(() => {
    loadData({
        textlines: {},
        speakers: {},
        gameDataRefs: {
            'GameData.Trio': ['A', 'B', 'C'],
            // A table stored nested under a parent key, with the broken flat
            // self-ref alias that shadows it (see ScreenData.Shrine.BountyOrder).
            'ScreenData.Shrine': { BountyOrder: ['BountyA', 'BountyB'] },
            'ScreenData.Shrine.BountyOrder': '<ref:ScreenData.Shrine.BountyOrder>',
            // A mixed Lua table (named fields + array part normalised to _array),
            // referenced by index - the engine iterates the array part (a GhostAdmin
            // item category), so the member list is that ``_array``.
            'ScreenData.GhostAdmin.ItemCategories': [{ Name: 'Cat1', _array: ['UpgradeA', 'UpgradeB'] }],
        },
        godTraitNames: ['ZeusManaBoltBoon', 'AthenaBoon'],
        restrictBoonChoiceTraitNames: ['ChaosRestrictBoonCurse'],
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

test('HasAll over a nested ref alias resolves via the parent table (not indeterminate)', () => {
    // ``<ref:ScreenData.Shrine.BountyOrder>`` has a broken flat self-ref alias, so
    // the list must be resolved from the nested ``ScreenData.Shrine`` parent. The
    // gate should evaluate met/unmet rather than 'unknown'.
    const rec = { Path: ['GameState', 'ShrineBountiesCompleted'], HasAll: '<ref:ScreenData.Shrine.BountyOrder>' };
    assert.equal(evalReq(clause(rec), { ShrineBountiesCompleted: { BountyA: true, BountyB: true } }), 'met');
    assert.equal(evalReq(clause(rec), { ShrineBountiesCompleted: { BountyA: true } }), 'unmet');
});

test('CountOf over a mixed-table ref (ItemCategories[N]) resolves via its _array part', () => {
    // ``<ref:ScreenData.GhostAdmin.ItemCategories[1]>`` indexes a list whose entry
    // is a named+array table; the engine counts over its array part.
    const rec = { Path: ['GameState', 'WorldUpgrades'], Comparison: '>=', CountOf: '<ref:ScreenData.GhostAdmin.ItemCategories[1]>', Value: 1 };
    assert.equal(evalReq(clause(rec), { WorldUpgrades: { UpgradeA: true } }), 'met'); // 1 of [A,B] >= 1
    assert.equal(evalReq(clause(rec), { WorldUpgrades: {} }), 'unmet'); // 0 >= 1
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

test('AudioState: resolves to eligible or blocked from the saved track snapshot', () => {
    const rec = { Path: ['AudioState', 'AmbientTrackName'], IsAny: ['/Music/ArtemisSong_MC', '/Music/IrisEndThemeCrossroads_MC'] };
    const evalAS = (audioState) => evaluateOtherRequirements(clause(rec), {}, { audioState }).clauses[0];
    // Saved snapshot matches one of the gating tracks -> met.
    assert.equal(evalAS({ AmbientTrackName: '/Music/ArtemisSong_MC' }).status, 'met');
    // Saved snapshot is a different track -> blocked (unmet): the track keeps
    // playing until the player acts, so the snapshot is the live track.
    assert.equal(evalAS({ AmbientTrackName: '/Music/SomethingElse_MC' }).status, 'unmet');
    // IsNone (must NOT be playing one of these) inverts the verdict.
    const recNone = { Path: ['AudioState', 'MusicName'], IsNone: ['/Music/Scylla_MC'] };
    const evalNone = (audioState) => evaluateOtherRequirements(clause(recNone), {}, { audioState }).clauses[0];
    assert.equal(evalNone({ MusicName: '/Music/Scylla_MC' }).status, 'unmet');
    assert.equal(evalNone({ MusicName: '/Music/Other_MC' }).status, 'met');
    // No AudioState carried by the save -> indeterminate with a reason.
    const none = evaluateOtherRequirements(clause(rec), {}).clauses[0];
    assert.equal(none.status, 'unknown');
    assert.ok(none.reason && none.reason.length > 0);
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
const evalRuns = (rec, runs) => evaluateOtherRequirements(clause(rec), {}, { runs }).status;

test('SumPrevRuns numericSum: totals a run-relative path over N runs', () => {
    const rec = { Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 5 };
    const runs = [{ EnemyKills: { Hydra: 2 } }, { EnemyKills: { Hydra: 2 } }, { EnemyKills: { Hydra: 1 } }, { EnemyKills: { Hydra: 9 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // 2+2+1 = 5 (4th run outside window)
    assert.equal(evalRuns({ ...rec, Value: 6 }, runs), 'unmet');
});

test('SumPrevRuns IgnoreCurrentRun skips runs[0] and spans n-1 history runs', () => {
    // Engine loops runsBack = 1 .. SumPrevRuns-1, so IgnoreCurrentRun with
    // SumPrevRuns:3 sums exactly the two newest history runs (runs[1], runs[2]),
    // skipping the current run (runs[0]) and anything older (runs[3]).
    const rec = { Path: ['RoomsEntered', 'N_Opening01'], SumPrevRuns: 3, Comparison: '>=', Value: 2, IgnoreCurrentRun: true };
    const runs = [{ RoomsEntered: { N_Opening01: 99 } }, { RoomsEntered: { N_Opening01: 1 } }, { RoomsEntered: { N_Opening01: 1 } }, { RoomsEntered: { N_Opening01: 99 } }];
    assert.equal(evalRuns(rec, runs), 'met');   // skips current (99) and runs[3]; sums 1+1
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

// --- SumPrevRooms: aggregation across the current room + recent RoomHistory ---

// Evaluate a SumPrevRooms clause; ``rooms`` is the persisted room slice
// ([currentRoom, ...history], each pruned to the referenced room-relative
// leaves). Passed as the 6th evaluateOtherRequirements arg.
const evalRooms = (rec, rooms) => evaluateOtherRequirements(clause(rec), {}, { rooms }).status;

test('SumPrevRooms numericSum: totals a room-relative path over N rooms (incl current)', () => {
    const rec = { Path: ['UseRecord', 'InspectPoint'], SumPrevRooms: 3, Comparison: '>=', Value: 2 };
    const rooms = [{ UseRecord: { InspectPoint: 1 } }, { UseRecord: { InspectPoint: 1 } }, { UseRecord: {} }, { UseRecord: { InspectPoint: 5 } }];
    assert.equal(evalRooms(rec, rooms), 'met');   // 1+1+0 = 2 (4th room outside window)
    assert.equal(evalRooms({ ...rec, Value: 3 }, rooms), 'unmet');
});

test('SumPrevRooms always includes the current room (no IgnoreCurrentRoom)', () => {
    // "<= 0 boon picks across the last 6 rooms" - the boon-god gate shape.
    const rec = { Path: ['UseRecord', 'ZeusUpgrade'], SumPrevRooms: 6, Comparison: '<=', Value: 0 };
    assert.equal(evalRooms(rec, [{ UseRecord: {} }, { UseRecord: {} }]), 'met');
    assert.equal(evalRooms(rec, [{ UseRecord: { ZeusUpgrade: 1 } }, { UseRecord: {} }]), 'unmet'); // current room counts
});

test('SumPrevRooms ValuesToCount / TableValuesToCount / CountPathTrue modes', () => {
    const vc = { Path: ['Encounter', 'NemesisShopping'], SumPrevRooms: 12, Comparison: '<=', Value: 0, ValuesToCount: [true] };
    assert.equal(evalRooms(vc, [{ Encounter: {} }, { Encounter: { NemesisShopping: false } }]), 'met');
    assert.equal(evalRooms(vc, [{ Encounter: { NemesisShopping: true } }]), 'unmet');
    const tc = { Path: ['UseRecord'], SumPrevRooms: 2, Comparison: '>=', Value: 2, TableValuesToCount: ['A', 'B'] };
    assert.equal(evalRooms(tc, [{ UseRecord: { A: 1, B: 1 } }, { UseRecord: {} }]), 'met'); // 2 in current room
    const cp = { Path: ['EncountersOccurredCache'], SumPrevRooms: 3, Comparison: '>=', Value: 2, CountPathTrue: true };
    assert.equal(evalRooms(cp, [{ EncountersOccurredCache: {} }, {}, { EncountersOccurredCache: {} }]), 'met'); // 2 rooms have the table
});

test('SumPrevRooms with no room slice -> unknown', () => {
    const rec = { Path: ['UseRecord', 'InspectPoint'], SumPrevRooms: 3, Comparison: '>=', Value: 1 };
    const r = evaluateOtherRequirements(clause(rec), {}, {});
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /rooms of the current run/i);
});

test('collectRoomPaths: room-relative mask + max look-back depth', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'A': [{ Path: ['UseRecord', 'ZeusUpgrade'], SumPrevRooms: 6, Comparison: '<=', Value: 0 }],
                'B': [{ Path: ['UseRecord'], SumPrevRooms: 99, Comparison: '>=', Value: 1, TableValuesToCount: ['InspectPoint'] }],
                'C': [{ Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 1 }], // SumPrevRuns -> ignored
            },
        },
    };
    const { mask, maxRooms } = collectRoomPaths(textlines, {});
    assert.equal(maxRooms, 99);
    assert.deepEqual(mask, { UseRecord: { ZeusUpgrade: true, InspectPoint: true } });
});

// --- FunctionName gates: RequireRunsSinceTextLines + RequireQuestCount ---

// Evaluate a FunctionName clause. ``gs`` is the GameState slice (must be
// truthy for the evaluator to run), ``runsAgo`` the textline -> runs-ago map.
const evalFn = (rec, gs, runsAgo) => evaluateOtherRequirements(clause(rec), gs || {}, { runsAgo }).status;

test('RequireRunsSinceTextLines Min only: played recently enough, never-played passes', () => {
    const rec = { FunctionName: 'RequireRunsSinceTextLines', FunctionArgs: { Min: 3, TextLines: ['L1'] } };
    assert.equal(evalFn(rec, {}, { L1: 3 }), 'met');   // r=3 >= 3
    assert.equal(evalFn(rec, {}, { L1: 4 }), 'met');   // r=4 >= 3
    assert.equal(evalFn(rec, {}, { L1: 2 }), 'unmet'); // r=2 < 3
    assert.equal(evalFn(rec, {}, {}), 'met');          // never played -> pass (Min only)
});

test('RequireRunsSinceTextLines Max only: Max is exclusive, never-played fails', () => {
    const rec = { FunctionName: 'RequireRunsSinceTextLines', FunctionArgs: { Max: 3, TextLines: ['L1'] } };
    assert.equal(evalFn(rec, {}, { L1: 0 }), 'met');   // r<3
    assert.equal(evalFn(rec, {}, { L1: 2 }), 'met');   // r=2 < 3
    assert.equal(evalFn(rec, {}, { L1: 3 }), 'unmet'); // r=3 not < 3 (Max exclusive)
    assert.equal(evalFn(rec, {}, {}), 'unmet');        // never played -> fail (Max only)
});

test('RequireRunsSinceTextLines both bounds: inclusive window, never-played passes', () => {
    const rec = { FunctionName: 'RequireRunsSinceTextLines', FunctionArgs: { Min: 2, Max: 4, TextLines: ['L1'] } };
    assert.equal(evalFn(rec, {}, { L1: 2 }), 'met');   // Min<=r<=Max
    assert.equal(evalFn(rec, {}, { L1: 4 }), 'met');   // Max inclusive
    assert.equal(evalFn(rec, {}, { L1: 1 }), 'unmet'); // below Min
    assert.equal(evalFn(rec, {}, { L1: 5 }), 'unmet'); // above Max
    assert.equal(evalFn(rec, {}, {}), 'met');          // never played -> pass (both set)
});

test('RequireRunsSinceTextLines: AND across names, ref + unknown ref', () => {
    // Trio = ['A','B','C'] (loaded in before()); all must satisfy Min.
    const rec = { FunctionName: 'RequireRunsSinceTextLines', FunctionArgs: { Min: 1, TextLines: '<ref:GameData.Trio>' } };
    assert.equal(evalFn(rec, {}, { A: 1, B: 2, C: 5 }), 'met');
    assert.equal(evalFn(rec, {}, { A: 1, B: 0, C: 5 }), 'unmet'); // B too recent
    const missing = { FunctionName: 'RequireRunsSinceTextLines', FunctionArgs: { Min: 1, TextLines: '<ref:GameData.Nope>' } };
    assert.equal(evalFn(missing, {}, { A: 1 }), 'unknown');       // list not in build
    assert.equal(evalFn(rec, {}, null), 'unknown');               // no run history
});

test('RequireQuestCount: counts GameState.QuestStatus entries matching Status', () => {
    const qs = { Q1: 'CashedOut', Q2: 'CashedOut', Q3: 'Complete', Q4: 'Unlocked' };
    const max = { FunctionName: 'RequireQuestCount', FunctionArgs: { Status: 'CashedOut', Max: 6 } };
    assert.equal(evalFn(max, { QuestStatus: qs }), 'met');   // 2 cashed out <= 6
    const min3 = { FunctionName: 'RequireQuestCount', FunctionArgs: { Status: 'CashedOut', Min: 3 } };
    assert.equal(evalFn(min3, { QuestStatus: qs }), 'unmet'); // only 2 cashed out
    const min2 = { FunctionName: 'RequireQuestCount', FunctionArgs: { Status: 'CashedOut', Min: 2 } };
    assert.equal(evalFn(min2, { QuestStatus: qs }), 'met');
    assert.equal(evalFn(min2, { QuestStatus: {} }), 'unmet'); // none -> 0 < 2
    assert.equal(evalFn(min2, {}), 'unmet');                  // absent table -> 0
});

test('collectGameStatePaths captures QuestStatus for RequireQuestCount', () => {
    const textlines = {
        T1: { otherRequirements: { 'FunctionName:RequireQuestCount': [{ FunctionName: 'RequireQuestCount', FunctionArgs: { Status: 'CashedOut', Min: 1 } }] } },
    };
    const mask = collectGameStatePaths(textlines, {});
    assert.deepEqual(mask, { QuestStatus: '*' });
});

// --- CurrentRun/GameState-reading FunctionName gates ---

// Evaluate a FunctionName clause that reads CurrentRun (and maybe GameState).
// ``gs`` is the GameState slice, ``cr`` the CurrentRun slice (null -> the gate
// is indeterminate, matching an owner/save-type mismatch).
const evalFnCr = (rec, gs, cr) => evaluateOtherRequirements(clause(rec), gs || {}, { currentRun: cr }).status;

test('RequiredHealthFraction: compares Hero.Health / MaxHealth', () => {
    const rec = { FunctionName: 'RequiredHealthFraction', FunctionArgs: { Comparison: '<=', Value: 0.5 } };
    assert.equal(evalFnCr(rec, {}, { Hero: { Health: 40, MaxHealth: 100 } }), 'met');   // 0.4 <= 0.5
    assert.equal(evalFnCr(rec, {}, { Hero: { Health: 80, MaxHealth: 100 } }), 'unmet');  // 0.8 !<= 0.5
    assert.equal(evalFnCr(rec, {}, null), 'unknown');                                    // no CurrentRun -> indeterminate
    assert.equal(evalFnCr(rec, {}, { Hero: {} }), 'unknown');                            // health not carried
});

// --- Hero equipped-trait gates: RequiredSellableGodTraits + RequireUnrestrictedBoonChoices ---

test('RequiredSellableGodTraits: hero holds a god trait carrying a Rarity', () => {
    const rec = { FunctionName: 'RequiredSellableGodTraits' };
    const cr = (traits) => ({ Hero: { Traits: traits } });
    // god trait with a rarity -> met
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'ZeusManaBoltBoon', Rarity: 'Common' }])), 'met');
    // god trait without a rarity -> unmet
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'ZeusManaBoltBoon' }])), 'unmet');
    // non-god trait with a rarity (e.g. a meta upgrade) -> unmet
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'StartingGoldMetaUpgrade', Rarity: 'Epic' }])), 'unmet');
    // mix: one qualifying god trait is enough -> met
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'StartingGoldMetaUpgrade', Rarity: 'Epic' }, { Name: 'AthenaBoon', Rarity: 'Rare' }])), 'met');
    // numeric-keyed-object array form (1-based Lua array) -> met
    assert.equal(evalFnCr(rec, {}, cr({ '1': { Name: 'ZeusManaBoltBoon', Rarity: 'Common' } })), 'met');
    assert.equal(evalFnCr(rec, {}, cr([])), 'unmet');     // no traits -> unmet
    assert.equal(evalFnCr(rec, {}, null), 'unknown');     // no CurrentRun -> indeterminate
});

test('RequireUnrestrictedBoonChoices: restricted iff a trait sets RestrictBoonChoices', () => {
    const rec = { FunctionName: 'RequireUnrestrictedBoonChoices' };
    const cr = (traits) => ({ Hero: { Traits: traits } });
    // no restricting trait -> met (unrestricted)
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'ZeusManaBoltBoon', Rarity: 'Common' }])), 'met');
    // equipped instance carries RestrictBoonChoices -> unmet (restricted)
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'ChaosRestrictBoonCurse', RestrictBoonChoices: true }])), 'unmet');
    // by-name fallback when the instance didn't carry the field -> unmet
    assert.equal(evalFnCr(rec, {}, cr([{ Name: 'ChaosRestrictBoonCurse' }])), 'unmet');
    assert.equal(evalFnCr(rec, {}, cr([])), 'met');       // no traits -> unrestricted
    assert.equal(evalFnCr(rec, {}, null), 'unknown');     // no CurrentRun -> indeterminate
});

test('collectCurrentRunPaths captures Hero.Traits for the equipped-trait gates', () => {
    const textlines = {
        T1: { otherRequirements: { 'FunctionName:RequiredSellableGodTraits': [{ FunctionName: 'RequiredSellableGodTraits' }] } },
        T2: { otherRequirements: { 'FunctionName:RequireUnrestrictedBoonChoices': [{ FunctionName: 'RequireUnrestrictedBoonChoices' }] } },
    };
    const mask = collectCurrentRunPaths(textlines, {});
    assert.equal(mask.Hero.Traits, '*');
});

test('IsBossDifficultyShrineUpgradeActive: rank vs EnteredBiomes (common path)', () => {
    const rec = { FunctionName: 'IsBossDifficultyShrineUpgradeActive', FunctionArgs: {} };
    const gs = { ShrineUpgrades: { BossDifficultyShrineUpgrade: 3 } };
    assert.equal(evalFnCr(rec, gs, { EnteredBiomes: 2 }), 'met');    // rank 3 >= 2
    assert.equal(evalFnCr(rec, gs, { EnteredBiomes: 4 }), 'unmet');  // rank 3 < 4
    assert.equal(evalFnCr(rec, { ShrineUpgrades: {} }, { EnteredBiomes: 1 }), 'unmet'); // rank 0 < 1
    assert.equal(evalFnCr(rec, gs, null), 'unknown');               // no CurrentRun -> indeterminate
    // UseShrineUpgradesCache reads the run snapshot instead of GameState.
    const cacheRec = { FunctionName: 'IsBossDifficultyShrineUpgradeActive', FunctionArgs: { UseShrineUpgradesCache: true } };
    assert.equal(evalFnCr(cacheRec, {}, { EnteredBiomes: 2, ShrineUpgradesCache: { BossDifficultyShrineUpgrade: 2 } }), 'met');
});

test('IsBossDifficultyShrineUpgradeActive: dream-run branch reads the encounter cache', () => {
    // Dream run in biome I (Chronos, OnlyRequireSeen) -> EncountersOccurredCache.
    const rec = { FunctionName: 'IsBossDifficultyShrineUpgradeActive', FunctionArgs: {} };
    const cr = { EnteredBiomes: 1, IsDreamRun: true, BiomeVisitOrder: ['I'] };
    const gs = { ShrineUpgrades: { BossDifficultyShrineUpgrade: 1 } };
    assert.equal(evalFnCr(rec, { ...gs, EncountersOccurredCache: { BossChronos02: 1 } }, cr), 'met');
    assert.equal(evalFnCr(rec, { ...gs, EncountersOccurredCache: {} }, cr), 'unmet');
    // Biome F (Hecate, requires completed) -> EncountersCompletedCache.
    const crF = { EnteredBiomes: 1, IsDreamRun: true, BiomeVisitOrder: ['F'] };
    assert.equal(evalFnCr(rec, { ...gs, EncountersCompletedCache: { BossHecate02: 2 } }, crF), 'met');
    assert.equal(evalFnCr(rec, { ...gs, EncountersCompletedCache: {} }, crF), 'unmet');
});

test('collectGameStatePaths + collectCurrentRunPaths capture FunctionName-implied fields', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'FunctionName:IsBossDifficultyShrineUpgradeActive': [{ FunctionName: 'IsBossDifficultyShrineUpgradeActive', FunctionArgs: {} }],
                'FunctionName:RequiredHealthFraction': [{ FunctionName: 'RequiredHealthFraction', FunctionArgs: { Comparison: '<=', Value: 0.5 } }],
            },
        },
    };
    assert.deepEqual(collectGameStatePaths(textlines, {}), {
        ShrineUpgrades: { BossDifficultyShrineUpgrade: true },
        EncountersOccurredCache: '*',
        EncountersCompletedCache: '*',
    });
    assert.deepEqual(collectCurrentRunPaths(textlines, {}), {
        EnteredBiomes: true,
        IsDreamRun: true,
        ShrineUpgradesCache: { BossDifficultyShrineUpgrade: true },
        BiomeVisitOrder: '*',
        Hero: { Health: true, MaxHealth: true },
    });
});

// --- RequiredConsecutiveClearsOfRoom / RequiredConsecutiveDeathsInRoom ---

// Evaluate a consecutive-clears/deaths clause: ``cr`` is the CurrentRun seed
// slice, ``history`` the recent-runs slice (newest-first).
const evalConsec = (rec, cr, history) => evaluateOtherRequirements(clause(rec), {}, { currentRun: cr, runHistory: history }).status;

test('RequiredConsecutiveClearsOfRoom: counts consecutive cleared runs (current + history)', () => {
    const rec = { FunctionName: 'RequiredConsecutiveClearsOfRoom', FunctionArgs: { Count: 3, Names: ['O_Boss01', 'O_Boss02'] } };
    const cr = { RoomCountCache: { O_Boss01: 1 }, Cleared: true };
    // current cleared + 2 history runs that entered & cleared the room -> streak 3.
    const hist = [
        { RoomsEntered: { O_Boss01: 1 }, EndingRoomName: 'O_Reward01', Cleared: true },
        { RoomsEntered: { O_Boss02: 1 }, EndingRoomName: 'O_Reward02', Cleared: true },
        { RoomsEntered: { X: 1 }, EndingRoomName: 'X', Cleared: true }, // didn't enter target -> skipped (transparent)
    ];
    assert.equal(evalConsec(rec, cr, hist), 'met');
    assert.equal(evalConsec({ ...rec, FunctionArgs: { Count: 4, Names: ['O_Boss01', 'O_Boss02'] } }, cr, hist), 'unmet');
});

test('RequiredConsecutiveClearsOfRoom: dying in the room this run breaks the streak (seed)', () => {
    const rec = { FunctionName: 'RequiredConsecutiveClearsOfRoom', FunctionArgs: { Count: 1, Names: ['O_Boss01'] } };
    // entered the room this run, not cleared/bountied, and ended in it -> 0, unmet.
    const cr = { RoomCountCache: { O_Boss01: 1 }, Cleared: false, EndingRoomName: 'O_Boss01' };
    assert.equal(evalConsec(rec, cr, []), 'unmet');
    // no CurrentRun slice -> indeterminate (wrong save type).
    assert.equal(evaluateOtherRequirements(clause(rec), {}, { runHistory: [] }).clauses[0].kind, 'wrong-save-type');
});

test('RequiredConsecutiveDeathsInRoom: counts consecutive deaths in the room', () => {
    const rec = { FunctionName: 'RequiredConsecutiveDeathsInRoom', FunctionArgs: { Count: 2, Name: 'P_Boss01' } };
    const cr = { RoomCountCache: { P_Boss01: 1 }, Cleared: false, BountyCleared: false, EndingRoomName: 'P_Boss01' };
    const hist = [{ RoomsEntered: { P_Boss01: 1 }, EndingRoomName: 'P_Boss01', Cleared: false, BountyCleared: false }];
    assert.equal(evalConsec(rec, cr, hist), 'met');   // died this run + last run = 2
    // cleared last run -> streak breaks at 1 -> unmet.
    assert.equal(evalConsec(rec, cr, [{ RoomsEntered: { P_Boss01: 1 }, EndingRoomName: 'P_Reward', Cleared: true }]), 'unmet');
});

test('collectRunHistoryClearMask: gathers referenced rooms + clear-field mask', () => {
    const textlines = {
        T1: { otherRequirements: { 'FunctionName:RequiredConsecutiveClearsOfRoom': [{ FunctionName: 'RequiredConsecutiveClearsOfRoom', FunctionArgs: { Count: 3, Names: ['O_Boss01', 'O_Boss02'] } }] } },
        T2: { otherRequirements: { 'FunctionName:RequiredConsecutiveDeathsInRoom': [{ FunctionName: 'RequiredConsecutiveDeathsInRoom', FunctionArgs: { Count: 1, Name: 'P_Boss01' } }] } },
    };
    const { mask, rooms } = collectRunHistoryClearMask(textlines, {});
    assert.deepEqual(rooms.sort(), ['O_Boss01', 'O_Boss02', 'P_Boss01']);
    assert.deepEqual(mask, {
        RoomsEntered: { O_Boss01: true, O_Boss02: true, P_Boss01: true },
        EndingRoomName: true, Cleared: true, BountyCleared: true,
    });
    // CurrentRun mask also captures the seed fields (RoomCountCache members + flags).
    assert.deepEqual(collectCurrentRunPaths(textlines, {}), {
        RoomCountCache: { O_Boss01: true, O_Boss02: true, P_Boss01: true },
        Cleared: true, BountyCleared: true, EndingRoomName: true,
    });
});

// --- CurrentRun.* direct gates (5th arg = the persisted CurrentRun slice) ---

// Evaluate a clause that reads CurrentRun.*; ``cr`` is the CurrentRun slice
// (null = not resolvable for this dialogue -> indeterminate). A non-null
// GameState slice ({}) is passed so the evaluator runs (no-save short-circuit).
const evalCr = (rec, cr) => evaluateOtherRequirements(clause(rec), {}, { currentRun: cr }).status;

test('CurrentRun.* resolves from the slice when provided', () => {
    const rec = { Path: ['CurrentRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 };
    assert.equal(evalCr(rec, { RoomsEntered: { I_Boss01: 1 } }), 'met');
    assert.equal(evalCr(rec, { RoomsEntered: { I_Boss01: 0 } }), 'unmet');
    assert.equal(evalCr(rec, { RoomsEntered: {} }), 'unmet');   // missing -> 0
    assert.equal(evalCr(rec, {}), 'unmet');                     // missing table -> 0
});

test('CurrentRun.* is indeterminate when no slice is supplied (owner/save mismatch)', () => {
    const rec = { Path: ['CurrentRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 };
    const r = evaluateOtherRequirements(clause(rec), {}, {});
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /current-run state/i);
    // Tagged so the tracer can group it as "needs the other save type".
    assert.equal(r.clauses[0].kind, 'wrong-save-type');
    // SumPrevRooms + the run-context FunctionNames carry the same tag.
    const spr = evaluateOtherRequirements(clause({ Path: ['UseRecord', 'X'], SumPrevRooms: 6, Comparison: '<=', Value: 0 }), {}, {});
    assert.equal(spr.clauses[0].kind, 'wrong-save-type');
    const hf = evaluateOtherRequirements(clause({ FunctionName: 'RequiredHealthFraction', FunctionArgs: { Comparison: '<=', Value: 0.5 } }), {}, {});
    assert.equal(hf.clauses[0].kind, 'wrong-save-type');
    // A genuinely-unresolvable gate (live state) is NOT tagged wrong-save-type.
    const live = evaluateOtherRequirements(clause({ FunctionName: 'RequiredAlive', FunctionArgs: { Ids: [1] } }), {}, {});
    assert.equal(live.clauses[0].kind, undefined);
});

test('CurrentRun.* honours PathTrue / PathFalse / membership operators', () => {
    assert.equal(evalCr({ PathTrue: ['CurrentRun', 'IsDreamRun'] }, { IsDreamRun: true }), 'met');
    assert.equal(evalCr({ PathTrue: ['CurrentRun', 'IsDreamRun'] }, { IsDreamRun: false }), 'unmet');
    assert.equal(evalCr({ PathFalse: ['CurrentRun', 'Cleared'] }, {}), 'met');   // nil -> false-ish
    const hasAny = { Path: ['CurrentRun', 'RoomsEntered'], HasAny: ['O_Boss01', 'O_Boss02'] };
    assert.equal(evalCr(hasAny, { RoomsEntered: { O_Boss01: 1 } }), 'met');
    assert.equal(evalCr(hasAny, { RoomsEntered: { X: 1 } }), 'unmet');
});

test('h2OperandMarks marks the present members of a Path HasAny/IsAny gate green', () => {
    const slices = { gameState: {}, currentRun: { RoomsEntered: { O_Boss01: 1, O_Boss03: 1 } } };
    const hasAny = [{ Path: ['CurrentRun', 'RoomsEntered'], HasAny: ['O_Boss01', 'O_Boss02', 'O_Boss03'] }];
    const m = h2OperandMarks('Path:CurrentRun.RoomsEntered', hasAny, slices);
    assert.deepEqual([...m.flat.green].sort(), ['O_Boss01', 'O_Boss03']);
    assert.deepEqual([...m.flat.red], []);
    // IsAny: the scalar at the path equals one of the options.
    const isAny = [{ Path: ['CurrentRun', 'CurrentRoom', 'RoomSetName'], IsAny: ['G', 'H'] }];
    const slices2 = { gameState: {}, currentRun: { CurrentRoom: { RoomSetName: 'G' } } };
    assert.deepEqual([...h2OperandMarks('Path:CurrentRun.CurrentRoom.RoomSetName', isAny, slices2).flat.green], ['G']);
    // A nil path is indeterminate -> null (so nothing gets marked).
    assert.equal(h2OperandMarks('Path:CurrentRun.RoomsEntered', hasAny, { gameState: {}, currentRun: null }), null);
    // Non-Path keys aren't markable here.
    assert.equal(h2OperandMarks('NamedRequirements', ['X'], slices), null);
});

test('h2OperandMarks colours present members by clause sense (green helps, red hurts)', () => {
    const list = ['FrogFamiliar', 'RavenFamiliar', 'CatFamiliar', 'HoundFamiliar', 'PolecatFamiliar'];
    const slices = { gameState: { FamiliarsUnlocked: { FrogFamiliar: true, RavenFamiliar: true, CatFamiliar: true, HoundFamiliar: true, PolecatFamiliar: true } } };
    // A 3-4 range gate (>=3 AND <5): each clause renders its own operand list,
    // so the >= record marks present members green and the < record marks them red.
    const range = [
        { Comparison: '>=', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 3 },
        { Comparison: '<', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 5 },
    ];
    const m = h2OperandMarks('Path:GameState.FamiliarsUnlocked', range, slices);
    assert.equal(m.recs.length, 2);
    assert.deepEqual([...m.recs[0].green].sort(), [...list].sort());
    assert.deepEqual([...m.recs[0].red], []);
    assert.equal(m.recs[0].total, 5); // aggregate: 5 of the set are unlocked
    assert.equal(m.recs[0].totalMet, true); // 5 >= 3
    assert.deepEqual([...m.recs[1].red].sort(), [...list].sort());
    assert.deepEqual([...m.recs[1].green], []);
    assert.equal(m.recs[1].total, 5);
    assert.equal(m.recs[1].totalMet, false); // 5 < 5 is false
    // A HasNone exclusion marks present members red (presence is bad).
    const none = [{ Path: ['GameState', 'FamiliarsUnlocked'], HasNone: ['FrogFamiliar'] }];
    const mn = h2OperandMarks('Path:GameState.FamiliarsUnlocked', none, slices);
    assert.deepEqual([...mn.flat.red], ['FrogFamiliar']);
    assert.deepEqual([...mn.flat.green], []);
    // A pure lower bound marks the present members green.
    const lower = [{ Comparison: '>=', CountOf: list, Path: ['GameState', 'FamiliarsUnlocked'], Value: 3 }];
    assert.deepEqual([...h2OperandMarks('Path:GameState.FamiliarsUnlocked', lower, slices).flat.green].sort(), [...list].sort());
});

test('h2OperandMarks captures per-operand SumOf/CountOf tallies from the save', () => {
    // SumOf over a numeric counter table: every operand carries its numeric value,
    // and an absent entry contributes 0.
    const sum = [{ Comparison: '>=', SumOf: ['N_Boss01', 'N_Boss02', 'N_Boss03'], Path: ['GameState', 'RoomsEntered'], Value: 3 }];
    const slices = { gameState: { RoomsEntered: { N_Boss01: 2, N_Boss02: 1 } } };
    const m = h2OperandMarks('Path:GameState.RoomsEntered', sum, slices);
    assert.equal(m.recs[0].counts.get('N_Boss01'), 2);
    assert.equal(m.recs[0].counts.get('N_Boss02'), 1);
    assert.equal(m.recs[0].counts.get('N_Boss03'), 0); // absent -> 0 contribution
    assert.equal(m.flat.counts.get('N_Boss01'), 2);
    // CountOf over a boolean unlock table has no meaningful per-entry number ->
    // no tally (the colour conveys presence).
    const famList = ['FrogFamiliar', 'RavenFamiliar'];
    const cnt = [{ Comparison: '>=', CountOf: famList, Path: ['GameState', 'FamiliarsUnlocked'], Value: 1 }];
    const fam = h2OperandMarks('Path:GameState.FamiliarsUnlocked', cnt, { gameState: { FamiliarsUnlocked: { FrogFamiliar: true } } });
    assert.equal(fam.recs[0].counts, null);
});

test('h2OperandMarks captures the save value of a plain scalar comparison gate', () => {
    // A bare numeric comparison against a literal value -> the path's save value.
    const rec = [{ Comparison: '>=', Path: ['GameState', 'UseRecord', 'NPC_Dora_01'], Value: 5 }];
    const m = h2OperandMarks('Path:GameState.UseRecord.NPC_Dora_01', rec, { gameState: { UseRecord: { NPC_Dora_01: 7 } } });
    assert.equal(m.recs[0].scalarValue, 7);
    assert.equal(m.recs[0].scalarMet, true); // 7 >= 5
    // Below the threshold -> not met (renders red).
    const below = h2OperandMarks('Path:GameState.UseRecord.NPC_Dora_01', rec, { gameState: { UseRecord: { NPC_Dora_01: 3 } } });
    assert.equal(below.recs[0].scalarMet, false); // 3 >= 5 is false
    // A settings path (ConfigOptionCache) is skipped - not progress.
    const cfg = [{ Comparison: '>', Path: ['ConfigOptionCache', 'MusicVolume'], Value: 0.1 }];
    assert.equal(h2OperandMarks('Path:ConfigOptionCache.MusicVolume', cfg, { gameState: {} }), null);
    // A value-to-value comparison (ValuePath) now shows the left path's value,
    // with met computed against the resolved right-hand value.
    const vp = [{ Comparison: '>=', Path: ['GameState', 'A'], ValuePath: ['GameState', 'B'] }];
    const vpm = h2OperandMarks('Path:GameState.A', vp, { gameState: { A: 3, B: 1 } });
    assert.equal(vpm.recs[0].scalarValue, 3);
    assert.equal(vpm.recs[0].scalarMet, true); // 3 >= 1 (value of B)
    // A path that resolves to nil (e.g. wrong save type) -> no value, null.
    assert.equal(h2OperandMarks('Path:GameState.UseRecord.NPC_Dora_01', rec, { gameState: {} }), null);
});

test('h2OperandMarks counts the entries of a UseLength gate', () => {
    // UseLength compares a table's key count to the threshold.
    const rec = [{ Comparison: '>=', UseLength: true, Path: ['GameState', 'GiftPresentation'], Value: 22 }];
    const m = h2OperandMarks('Path:GameState.GiftPresentation', rec, { gameState: { GiftPresentation: { a: 1, b: 1, c: 1 } } });
    assert.equal(m.recs[0].scalarValue, 3);
    assert.equal(m.recs[0].scalarMet, false); // 3 >= 22 is false
    // An absent GameState table is a real 0 (loaded slice, key just missing).
    const empty = h2OperandMarks('Path:GameState.GiftPresentation', rec, { gameState: {} });
    assert.equal(empty.recs[0].scalarValue, 0);
    // A CurrentRun UseLength on a hub save (no current-run slice) -> indeterminate.
    const cr = [{ Comparison: '<=', UseLength: true, Path: ['CurrentRun', 'Hero', 'LastStands'], Value: 1 }];
    assert.equal(h2OperandMarks('Path:CurrentRun.Hero.LastStands', cr, { gameState: {}, currentRun: null }), null);
});

test('h2OperandMarks sums a SumPrevRooms aggregate over the room slices', () => {
    const rec = [{ Comparison: '<=', Path: ['UseRecord', 'AphroditeUpgrade'], SumPrevRooms: 3, Value: 0 }];
    const slices = { gameState: {}, rooms: [{ UseRecord: { AphroditeUpgrade: 1 } }, { UseRecord: {} }, { UseRecord: { AphroditeUpgrade: 2 } }] };
    const m = h2OperandMarks('Path:UseRecord.AphroditeUpgrade', rec, slices);
    assert.equal(m.recs[0].scalarValue, 3); // 1 + 0 + 2 across the last 3 rooms
    assert.equal(m.recs[0].scalarMet, false); // 3 <= 0 is false
    // No room slice (hub save / wrong owner context) -> indeterminate, no tally.
    assert.equal(h2OperandMarks('Path:UseRecord.AphroditeUpgrade', rec, { gameState: {}, rooms: null }), null);
});

test('collectCurrentRunPaths captures CurrentRun leaves, ignores GameState/SumPrev', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'A': [{ Path: ['CurrentRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 }],
                'B': [{ Path: ['CurrentRun', 'RoomsEntered'], HasAny: ['O_Boss01', 'O_Boss02'] }],
                'C': [{ Path: ['GameState', 'EnemyKills', 'Hecate'], Comparison: '>=', Value: 1 }],   // GameState -> ignored
                'D': [{ Path: ['EnemyKills', 'Hydra'], SumPrevRuns: 3, Comparison: '>=', Value: 1 }], // SumPrevRuns -> ignored
            },
        },
    };
    // HasAny without a ref list (literal array) marks member leaves.
    const mask = collectCurrentRunPaths(textlines, {});
    assert.deepEqual(mask, {
        RoomsEntered: { I_Boss01: true, O_Boss01: true, O_Boss02: true },
    });
});

test('currentRunResolvable: hub/run/both/unlisted policy vs save type', () => {
    // hub owner: resolves only in a hub save (saveInRun false).
    assert.equal(currentRunResolvable('NPC_Hecate_01', false), true);
    assert.equal(currentRunResolvable('NPC_Hecate_01', true), false);
    // run owner: resolves only in an in-run (_Temp) save.
    assert.equal(currentRunResolvable('AphroditeUpgrade', true), true);
    assert.equal(currentRunResolvable('AphroditeUpgrade', false), false);
    // both owner: resolves either way.
    assert.equal(currentRunResolvable('NPC_Nemesis_01', true), true);
    assert.equal(currentRunResolvable('NPC_Nemesis_01', false), true);
    // unlisted owner / unknown save type: never resolvable.
    assert.equal(currentRunResolvable('NPC_DoesNotExist', true), false);
    assert.equal(currentRunResolvable('NPC_Hecate_01', null), false);
    // sanity on the map sizes.
    const vals = Object.values(OWNER_RUN_CONTEXT);
    assert.equal(vals.filter(v => v === 'hub').length, 11);
    assert.equal(vals.filter(v => v === 'run').length, 39);
    assert.equal(vals.filter(v => v === 'both').length, 5);
});

// --- PrevRun.* (last completed run = RunHistory[#RunHistory], ungated) ---

// Evaluate a clause reading PrevRun.*; ``pr`` is the persisted PrevRun slice.
const evalPr = (rec, pr) => evaluateOtherRequirements(clause(rec), {}, { prevRun: pr }).status;

test('PrevRun.* resolves from the slice (Comparison / PathTrue / PathFalse / membership)', () => {
    assert.equal(evalPr({ Path: ['PrevRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 }, { RoomsEntered: { I_Boss01: 1 } }), 'met');
    assert.equal(evalPr({ Path: ['PrevRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 }, { RoomsEntered: {} }), 'unmet');
    assert.equal(evalPr({ PathTrue: ['PrevRun', 'Cleared'] }, { Cleared: true }), 'met');
    assert.equal(evalPr({ PathFalse: ['PrevRun', 'Cleared'] }, { Cleared: true }), 'unmet');
    const hasAny = { Path: ['PrevRun', 'BiomesReached'], HasAny: ['F', 'N'] };
    assert.equal(evalPr(hasAny, { BiomesReached: { F: true } }), 'met');
    assert.equal(evalPr(hasAny, { BiomesReached: { Tartarus: true } }), 'unmet');
});

test('PrevRun.* with no completed run (empty/null slice) coerces to nil/0/false', () => {
    // An empty PrevRun slice (first run, never completed) is still resolved - not
    // indeterminate: missing path -> 0 / false, matching the engine's nil PrevRun.
    assert.equal(evalPr({ PathTrue: ['PrevRun', 'Cleared'] }, {}), 'unmet');     // nil -> not true
    assert.equal(evalPr({ PathFalse: ['PrevRun', 'Cleared'] }, {}), 'met');      // nil -> false-ish
    assert.equal(evalPr({ Path: ['PrevRun', 'RoomCountCache'], Comparison: '>=', Value: 1 }, null), 'unmet'); // null slice -> 0
});

test('collectPrevRunPaths captures PrevRun leaves only', () => {
    const textlines = {
        T1: {
            otherRequirements: {
                'A': [{ PathTrue: ['PrevRun', 'Cleared'] }],
                'B': [{ Path: ['PrevRun', 'RoomsEntered', 'I_Boss01'], Comparison: '>=', Value: 1 }],
                'C': [{ Path: ['PrevRun', 'BiomesReached'], HasAny: ['F', 'N'] }],
                'D': [{ Path: ['CurrentRun', 'Cleared'], PathTrue: ['CurrentRun', 'Cleared'] }], // CurrentRun -> ignored
            },
        },
    };
    const mask = collectPrevRunPaths(textlines, {});
    assert.deepEqual(mask, {
        Cleared: true,
        RoomsEntered: { I_Boss01: true },
        BiomesReached: { F: true, N: true },
    });
});

test('gateClausePermanentlyUnmet: H2 PathFalse on a monotonic table already set -> permanently unmet', () => {
    // The user's example: a "must NOT have entered room X" gate over RoomsEntered
    // (write-once) can never recover once X is on record, so the per-gate dot
    // should upgrade from blocked to unobtainable.
    const other = { 'PathFalse:GameState.RoomsEntered.Q_Intro': [{ PathFalse: ['GameState', 'RoomsEntered', 'Q_Intro'] }] };
    const key = 'PathFalse:GameState.RoomsEntered.Q_Intro';
    assert.equal(gateClausePermanentlyUnmet(key, other, { RoomsEntered: { Q_Intro: true } }, 'hades2'), true);
    assert.equal(gateClausePermanentlyUnmet(key, other, { RoomsEntered: {} }, 'hades2'), false); // not yet entered -> still recoverable
});

test('gateClausePermanentlyUnmet: H2 PathFalse on a WorldUpgrades unlock already set -> permanently unmet', () => {
    const other = { 'PathFalse:GameState.WorldUpgrades.WorldUpgradeForcedChaosGate': [{ PathFalse: ['GameState', 'WorldUpgrades', 'WorldUpgradeForcedChaosGate'] }] };
    const key = 'PathFalse:GameState.WorldUpgrades.WorldUpgradeForcedChaosGate';
    assert.equal(gateClausePermanentlyUnmet(key, other, { WorldUpgrades: { WorldUpgradeForcedChaosGate: true } }, 'hades2'), true);
    assert.equal(gateClausePermanentlyUnmet(key, other, { WorldUpgrades: {} }, 'hades2'), false);
});

test('gateClausePermanentlyUnmet: resettable / live H2 paths are never permanent', () => {
    // A PathFalse over a non-monotonic table (e.g. a per-run flag) can flip back,
    // so it stays blocked - never unobtainable.
    const other = { 'PathTrue:CurrentRun.Cleared': [{ PathTrue: ['CurrentRun', 'Cleared'] }] };
    assert.equal(gateClausePermanentlyUnmet('PathTrue:CurrentRun.Cleared', other, { Cleared: true }, 'hades2'), false);
    // No save / no value -> not permanent.
    assert.equal(gateClausePermanentlyUnmet('K', { K: [{ PathFalse: ['GameState', 'RoomsEntered', 'X'] }] }, null, 'hades2'), false);
    assert.equal(gateClausePermanentlyUnmet('Missing', other, { Cleared: true }, 'hades2'), false);
});
