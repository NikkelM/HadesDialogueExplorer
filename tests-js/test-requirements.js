// Tests for the shared requirement-semantics classifier in
// ``templates/viewer/requirements.js``.
//
// This is the single source of truth the save-progress badge and the
// eligibility tracer use to decide whether a dialogue is directly
// eligible given a save. The classifier must honour per-type semantics
// (AND / OR / negative) rather than treating every referenced line as a
// hard prerequisite.

import { test, describe, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    isDirectlySatisfied,
    directSatisfaction,
    requiredCount,
    reqGroupStatus,
    reqGroupLocked,
    requirementSetStatus,
    runsSinceExplain,
    runsSinceGroupTooltip,
    runsSinceRefTooltip,
    REQ_TYPE_SCOPE,
    AND_REQ_TYPES,
    OR_REQ_TYPES,
    NEGATIVE_REQ_TYPES,
} from '../templates/viewer/requirements.js';
import { loadData } from '../templates/viewer/data.js';

const tl = (requirements, otherRequirements) => ({ requirements, otherRequirements });
const played = (...names) => new Set(names);

test('a dialogue with no requirements is satisfied', () => {
    assert.equal(isDirectlySatisfied(tl(null), played()), true);
    assert.equal(isDirectlySatisfied(tl(undefined), played()), true);
    assert.equal(isDirectlySatisfied({}, played()), true);
});

test('AND: every referenced line must have played', () => {
    const t = tl({ RequiredTextLines: ['A', 'B'] });
    assert.equal(isDirectlySatisfied(t, played('A')), false);
    assert.equal(isDirectlySatisfied(t, played('A', 'B')), true);
});

test('OR: at least one referenced line suffices', () => {
    const t = tl({ RequiredAnyTextLines: ['A', 'B'] });
    assert.equal(isDirectlySatisfied(t, played()), false);
    assert.equal(isDirectlySatisfied(t, played('B')), true);
});

test('negative: satisfied while the forbidden line is unplayed, blocked once it plays', () => {
    const t = tl({ RequiredFalseTextLines: ['X'] });
    assert.equal(isDirectlySatisfied(t, played()), true);
    assert.equal(isDirectlySatisfied(t, played('X')), false);
});

test('a play-once self-referencing negative gate is eligible on an empty save', () => {
    // Regression: the old badge looped every ref and reported "blocked"
    // because the (unplayed) self-reference looked like a missing prereq.
    const t = tl({ RequiredFalseTextLines: ['Ending01'] });
    assert.equal(isDirectlySatisfied(t, played(), 'Ending01'), true);
});

test('count-min: needs at least Count of the listed lines played', () => {
    const t = tl(
        { RequiredMinAnyTextLines: ['A', 'B', 'C'] },
        { RequiredMinAnyTextLines: { Count: 2 } },
    );
    assert.equal(isDirectlySatisfied(t, played()), false);
    assert.equal(isDirectlySatisfied(t, played('A')), false);
    assert.equal(isDirectlySatisfied(t, played('A', 'B')), true);
});

test('count-min: defaults to a Count of 1 when otherRequirements is absent', () => {
    const t = tl({ RequiredMinAnyTextLines: ['A', 'B'] });
    assert.equal(requiredCount(t, 'RequiredMinAnyTextLines'), 1);
    assert.equal(isDirectlySatisfied(t, played()), false);
    assert.equal(isDirectlySatisfied(t, played('B')), true);
});

test('run-count fields are unknown without recent-run data; RequiredMaxAny resolves from the played set', () => {
    // A bare Set has no recent-run sequence (runsAgo), so run-count fields
    // can't be resolved -> indeterminate.
    assert.equal(directSatisfaction(tl({ MinRunsSinceAnyTextLines: ['A'] }), played()), 'unknown');
    assert.equal(directSatisfaction(tl({ MaxRunsSinceAnyTextLines: ['A'] }), played()), 'unknown');
    assert.equal(isDirectlySatisfied(tl({ MinRunsSinceAnyTextLines: ['A'] }), played()), false);
    // RequiredMaxAnyTextLines is a plain global count-max, resolvable from the
    // played set: "at most Count of these played".
    const tmax = tl({ RequiredMaxAnyTextLines: ['A', 'B', 'C'] }, { RequiredMaxAnyTextLines: { Count: 1 } });
    assert.equal(directSatisfaction(tmax, played('A')), 'met');          // 1 played <= 1
    assert.equal(directSatisfaction(tmax, played('A', 'B')), 'unmet');   // 2 played > 1
});

test('run-scoped fields also make a dialogue indeterminate', () => {
    // "must have played this run" / "must NOT have played this run" can't be
    // resolved from a cumulative save, even when the referenced line is (or
    // isn't) in the played set.
    assert.equal(directSatisfaction(tl({ RequiredTextLinesThisRun: ['A'] }), played('A')), 'unknown');
    assert.equal(directSatisfaction(tl({ RequiredFalseTextLinesThisRun: ['X'] }), played('X')), 'unknown');
    // A confirmed-failing global field still dominates an unverifiable one.
    assert.equal(
        directSatisfaction(tl({ RequiredTextLines: ['A'], RequiredFalseTextLinesThisRun: ['X'] }), played()),
        'unmet',
    );
});

test('mixed AND + negative requirements', () => {
    const t = tl({ RequiredTextLines: ['A'], RequiredFalseTextLines: ['B'] });
    assert.equal(isDirectlySatisfied(t, played()), false);          // A not played yet
    assert.equal(isDirectlySatisfied(t, played('A')), true);        // A played, B not -> eligible
    assert.equal(isDirectlySatisfied(t, played('A', 'B')), false);  // B played -> negative violated
});

test('RequiredAnyTextLinesThisRun is an OR gate scoped to the current run', () => {
    // It's still classified as an OR field (regression: it was once missing
    // from the OR set), and now scoped to the this-run record.
    assert.equal(OR_REQ_TYPES.has('RequiredAnyTextLinesThisRun'), true);
    assert.equal(REQ_TYPE_SCOPE.RequiredAnyTextLinesThisRun, 'thisRun');
    const t = tl({ RequiredAnyTextLinesThisRun: ['A', 'B'] });
    // With only the global played set (no this-run record) it can't be
    // resolved, regardless of the cumulative set -> indeterminate.
    assert.equal(directSatisfaction(t, played('A')), 'unknown');
    // Given a this-run record it resolves like any OR gate.
    assert.equal(directSatisfaction(t, { played: played(), thisRun: played('A') }), 'met');
    assert.equal(directSatisfaction(t, { played: played(), thisRun: played() }), 'unmet');
});

test('the category sets are disjoint and cover the expected fields', () => {
    assert.equal(AND_REQ_TYPES.has('RequiredTextLines'), true);
    assert.equal(OR_REQ_TYPES.has('RequiredAnyTextLines'), true);
    assert.equal(NEGATIVE_REQ_TYPES.has('RequiredFalseTextLines'), true);
    const intersect = (a, b) => [...a].some(x => b.has(x));
    assert.equal(intersect(AND_REQ_TYPES, OR_REQ_TYPES), false);
    assert.equal(intersect(AND_REQ_TYPES, NEGATIVE_REQ_TYPES), false);
    assert.equal(intersect(OR_REQ_TYPES, NEGATIVE_REQ_TYPES), false);
});

// --- H2 set-level orBranches (alternative requirement sets) ---
// A textline is eligible when its base requirements hold AND at least one
// orBranch is satisfied. Each branch is a full requirement set.

const withBranches = (requirements, orBranches, otherRequirements) =>
    ({ requirements, otherRequirements, orBranches });

test('orBranches: empty base, no branch satisfied -> blocked', () => {
    // Real shape (HadesAboutUltimateProgress02): eligible only via one of
    // two alternative branches; neither holds on an empty save.
    const t = withBranches({}, [
        { requirements: { RequiredFalseTextLines: ['Zag_2'], RequiredTextLines: ['Zag'] } },
        { requirements: { RequiredTextLines: ['Zag_3'] } },
    ]);
    assert.equal(isDirectlySatisfied(t, played()), false);
    assert.equal(isDirectlySatisfied(t, played('Zag')), true);   // branch 0 holds
    assert.equal(isDirectlySatisfied(t, played('Zag_3')), true); // branch 1 holds
    // branch 0's negative gate is violated once Zag_2 plays, but branch 1
    // still rescues eligibility.
    assert.equal(isDirectlySatisfied(t, played('Zag', 'Zag_2')), false);
    assert.equal(isDirectlySatisfied(t, played('Zag', 'Zag_2', 'Zag_3')), true);
});

test('orBranches: a branch with empty requirements is always satisfied', () => {
    // Real shape (ArachneAboutGods02): one branch gates on a non-textline
    // condition only, so its (textline) requirements are empty -> the OR is
    // trivially satisfied and the dialogue stays eligible.
    const t = withBranches({}, [
        { requirements: { RequiredTextLines: ['ArachneAboutGods01'] } },
        { requirements: {} },
    ]);
    assert.equal(isDirectlySatisfied(t, played()), true);
});

test('orBranches: a run-count-gated branch is indeterminate; a global branch still confirms', () => {
    // Real shape (NemesisAboutErisRelationship01): branch 0 pairs a run-count
    // field (unverifiable from a save) with two textlines; branch 1 is global.
    const t = withBranches({}, [
        {
            requirements: { MinRunsSinceAnyTextLines: ['Eris03', 'Nem01'], RequiredTextLines: ['Eris03', 'Nem01'] },
            otherRequirements: { MinRunsSinceAnyTextLines: { Count: 1 } },
        },
        { requirements: { RequiredTextLines: ['Eris03_B', 'Nem01_B'] } },
    ]);
    // Branch 0 half-met (Nem01 unplayed) and branch 1 unmet -> all unmet.
    assert.equal(directSatisfaction(t, played('Eris03')), 'unmet');
    // Branch 0's textlines are played but its run-count gate can't be
    // resolved, and branch 1 is unmet -> can't determine.
    assert.equal(directSatisfaction(t, played('Eris03', 'Nem01')), 'unknown');
    // Branch 1 (purely global) is fully satisfied -> confirmed eligible.
    assert.equal(directSatisfaction(t, played('Eris03_B', 'Nem01_B')), 'met');
    assert.equal(isDirectlySatisfied(t, played('Eris03_B', 'Nem01_B')), true);
});

test('orBranches: base requirements must hold too (AND of base + any branch)', () => {
    const t = withBranches({ RequiredTextLines: ['Base'] }, [
        { requirements: { RequiredTextLines: ['Alt'] } },
    ]);
    assert.equal(isDirectlySatisfied(t, played('Alt')), false);          // base missing
    assert.equal(isDirectlySatisfied(t, played('Base')), false);         // branch missing
    assert.equal(isDirectlySatisfied(t, played('Base', 'Alt')), true);   // both
});

test('orBranches: count-min in a branch reads the branch otherRequirements', () => {
    const t = withBranches({}, [
        {
            requirements: { RequiredMinAnyTextLines: ['A', 'B', 'C'] },
            otherRequirements: { RequiredMinAnyTextLines: { Count: 2 } },
        },
    ]);
    assert.equal(isDirectlySatisfied(t, played('A')), false);
    assert.equal(isDirectlySatisfied(t, played('A', 'B')), true);
});

// --- reqGroupStatus: per-group verdicts for the dependency-tree headers ---

test('reqGroupStatus AND: met only when every ref has played', () => {
    assert.equal(reqGroupStatus('RequiredTextLines', ['A', 'B'], played('A')), 'unmet');
    assert.equal(reqGroupStatus('RequiredTextLines', ['A', 'B'], played('A', 'B')), 'met');
});

test('reqGroupStatus OR: met when any ref has played; empty group is met', () => {
    assert.equal(reqGroupStatus('RequiredAnyTextLines', ['A', 'B'], played()), 'unmet');
    assert.equal(reqGroupStatus('RequiredAnyTextLines', ['A', 'B'], played('B')), 'met');
    assert.equal(reqGroupStatus('RequiredAnyTextLines', [], played()), 'met');
});

test('reqGroupStatus negative: met while forbidden lines stay unplayed', () => {
    assert.equal(reqGroupStatus('RequiredFalseTextLines', ['X'], played()), 'met');
    assert.equal(reqGroupStatus('RequiredFalseTextLines', ['X'], played('X')), 'unmet');
});

test('reqGroupStatus count-min: needs at least Count refs played', () => {
    assert.equal(reqGroupStatus('RequiredMinAnyTextLines', ['A', 'B', 'C'], played('A'), 2), 'unmet');
    assert.equal(reqGroupStatus('RequiredMinAnyTextLines', ['A', 'B', 'C'], played('A', 'B'), 2), 'met');
});

test('reqGroupStatus: RequiredMaxAny is a global count-max; run-count needs recent-run data', () => {
    // RequiredMaxAnyTextLines: "at most Count played" against the played set.
    assert.equal(reqGroupStatus('RequiredMaxAnyTextLines', ['A', 'B', 'C'], played('A'), 1), 'met');        // 1 <= 1
    assert.equal(reqGroupStatus('RequiredMaxAnyTextLines', ['A', 'B', 'C'], played('A', 'B'), 1), 'unmet');  // 2 > 1
    assert.equal(reqGroupStatus('RequiredMaxAnyTextLines', ['A', 'B', 'C'], played('A', 'B'), 2), 'met');    // 2 <= 2
    // Run-count fields need the recent-run sequence; a bare Set has none.
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], played()), 'unknown');
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], played()), 'unknown');
});

test('reqGroupStatus resolves run-count fields against the recent-run sequence (runsAgo)', () => {
    // runsAgo maps a textline to how many runs ago it last played (0 = current).
    // MinRunsSince Count 3: each ref must be at least 3 runs since last played.
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 1 } }, 3), 'unmet'); // 1 < 3 (too recent)
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 5 } }, 3), 'met');   // 5 >= 3
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], { played: played(), runsAgo: {} }, 3), 'met');           // never played -> met
    // MaxRunsSince Count 3: each ref's most recent play must be within 3 runs.
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 2 } }, 3), 'met');   // 2 <= 3
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 5 } }, 3), 'unmet'); // 5 > 3 (too long ago)
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], { played: played(), runsAgo: {} }, 3), 'met');           // never played -> met
    // MaxRunsSince: played but beyond the tracked depth (in the cumulative
    // played set, not in runsAgo) counts as too long ago.
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: {} }, 3), 'unmet');
});

test('runsSinceExplain breaks down each ref against the run-count threshold', () => {
    // Not a run-count field, or no recent-run sequence -> null.
    assert.equal(runsSinceExplain('RequiredTextLines', ['A'], { played: played('A') }), null);
    assert.equal(runsSinceExplain('MinRunsSinceAnyTextLines', ['A'], played('A')), null);

    // Min Count 3: 1-run-ago blocks (too recent), 5-runs-ago + never pass.
    const min = runsSinceExplain('MinRunsSinceAnyTextLines', ['Recent', 'Old', 'New'],
        { played: played('Recent', 'Old'), runsAgo: { Recent: 1, Old: 5 } }, 3);
    assert.equal(min.status, 'unmet');
    assert.equal(min.isMin, true);
    assert.equal(min.count, 3);
    const byName = Object.fromEntries(min.refs.map(r => [r.name, r]));
    assert.equal(byName.Recent.ok, false);
    assert.equal(byName.Recent.ago, 1);
    assert.match(byName.Recent.reason, /1 run ago.*too recent.*at least 3 runs/);
    assert.equal(byName.Old.ok, true);
    assert.match(byName.Old.reason, /5 runs ago/);
    assert.equal(byName.New.ok, true);          // never played
    assert.equal(byName.New.ago, null);
    assert.match(byName.New.reason, /never played/);

    // Max Count 3: within-range and never pass; too-long-ago and beyond-depth block.
    const max = runsSinceExplain('MaxRunsSinceAnyTextLines', ['Within', 'Far', 'Deep', 'New'],
        { played: played('Within', 'Far', 'Deep'), runsAgo: { Within: 2, Far: 5 } }, 3);
    assert.equal(max.status, 'unmet');
    const m = Object.fromEntries(max.refs.map(r => [r.name, r]));
    assert.equal(m.Within.ok, true);
    assert.match(m.Within.reason, /within 3 runs/);
    assert.equal(m.Far.ok, false);
    assert.match(m.Far.reason, /too long ago/);
    assert.equal(m.Deep.ok, false);             // played, beyond tracked depth
    assert.equal(m.Deep.ago, null);
    assert.match(m.Deep.reason, /tracked run history.*too long ago/);
    assert.equal(m.New.ok, true);               // never played -> within range

    // selfName is ignored (play-once self-references on the gate).
    const self = runsSinceExplain('MinRunsSinceAnyTextLines', ['Self'],
        { played: played('Self'), runsAgo: { Self: 1 } }, 3, 'Self');
    assert.equal(self.status, 'met');
    assert.equal(self.refs.length, 0);
});

test('runsSinceExplain.status always matches reqGroupStatus', () => {
    const cases = [
        ['MinRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 1 } }, 3],
        ['MinRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 5 } }, 3],
        ['MaxRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: { A: 5 } }, 3],
        ['MaxRunsSinceAnyTextLines', ['A'], { played: played('A'), runsAgo: {} }, 3],
        ['MaxRunsSinceAnyTextLines', ['A', 'B'], { played: played('A'), runsAgo: { A: 1, B: 2 } }, 3],
    ];
    for (const [type, refs, ctx, count] of cases) {
        assert.equal(runsSinceExplain(type, refs, ctx, count).status, reqGroupStatus(type, refs, ctx, count));
    }
});

test('runsSinceGroupTooltip summarises the group verdict with a per-ref breakdown', () => {
    assert.equal(runsSinceGroupTooltip('RequiredTextLines', ['A'], { played: played('A') }), null);

    const met = runsSinceGroupTooltip('MinRunsSinceAnyTextLines', ['A'],
        { played: played('A'), runsAgo: { A: 5 } }, 3);
    assert.match(met, /^Satisfied by the save: every line was last played at least 3 runs ago/);
    assert.match(met, /\u2713 A: last played 5 runs ago/);

    const unmet = runsSinceGroupTooltip('MinRunsSinceAnyTextLines', ['Recent', 'Old'],
        { played: played('Recent', 'Old'), runsAgo: { Recent: 1, Old: 9 } }, 3);
    assert.match(unmet, /^Not satisfied: a line was played too recently/);
    // Blocking ref is listed first, with a cross marker.
    const lines = unmet.split('\n');
    assert.match(lines[1], /\u2717 Recent:/);
    assert.match(lines[2], /\u2713 Old:/);

    // Many-ref gate caps the listing.
    const refs = Array.from({ length: 12 }, (_, i) => `L${i}`);
    const ra = Object.fromEntries(refs.map((n, i) => [n, i + 5]));
    const capped = runsSinceGroupTooltip('MinRunsSinceAnyTextLines', refs,
        { played: played(...refs), runsAgo: ra }, 3);
    assert.match(capped, /\+ 4 more/);
});

test('runsSinceRefTooltip explains a single ref row', () => {
    assert.equal(runsSinceRefTooltip('RequiredTextLines', 'A', { played: played('A') }), null);

    const blocks = runsSinceRefTooltip('MinRunsSinceAnyTextLines', 'A',
        { played: played('A'), runsAgo: { A: 2 } }, 8);
    assert.match(blocks, /^Last played 2 runs ago, too recent \(needs at least 8 runs since\) - blocks this run-count gate\.$/);

    const ok = runsSinceRefTooltip('MaxRunsSinceAnyTextLines', 'A',
        { played: played('A'), runsAgo: { A: 1 } }, 9);
    assert.match(ok, /satisfies this run-count gate\.$/);
});

test('reqGroupStatus resolves run-scoped fields against their matching record', () => {
    const ctx = (over) => ({ played: played(), thisRun: played(), thisRoom: played(), queued: played(), ...over });
    // this-run negative: met when the line isn't in the this-run record...
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRun', ['X'], ctx({ thisRun: played() })), 'met');
    // ...unmet once it is, even though the global cumulative set is empty here.
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRun', ['X'], ctx({ thisRun: played('X') })), 'unmet');
    // this-run positive AND resolves against the this-run record.
    assert.equal(reqGroupStatus('RequiredTextLinesThisRun', ['A'], ctx({ thisRun: played() })), 'unmet');
    assert.equal(reqGroupStatus('RequiredTextLinesThisRun', ['A'], ctx({ thisRun: played('A') })), 'met');
    // this-room + queued use their own records.
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRoom', ['X'], ctx({ thisRoom: played('X') })), 'unmet');
    assert.equal(reqGroupStatus('RequiredQueuedTextLines', ['A'], ctx({ queued: played('A') })), 'met');
});

test('reqGroupStatus is unknown when the scope record is missing or unresolvable', () => {
    // A bare Set is the global played set only, so run-scoped fields have no
    // record to check -> indeterminate.
    assert.equal(reqGroupStatus('RequiredTextLinesThisRun', ['A'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRun', ['X'], played('X')), 'unknown');
    assert.equal(reqGroupStatus('RequiredQueuedTextLines', ['A'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredAnyTextLinesLastRun', ['A'], played('A')), 'unknown');
    // Run-count fields need the recent-run sequence (runsAgo), which a full
    // record context still lacks.
    const full = { played: played('A'), thisRun: played('A'), thisRoom: played('A'), queued: played('A'), lastRun: played('A') };
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], full), 'unknown');
    assert.equal(reqGroupStatus('MaxRunsSinceAnyTextLines', ['A'], full), 'unknown');
});

test('reqGroupStatus resolves *LastRun against the last-run record', () => {
    // RunHistory[#].TextLinesRecord. An empty record (no prior run) makes the
    // OR positive unmet and the negative met, matching the game's behaviour.
    assert.equal(reqGroupStatus('RequiredAnyTextLinesLastRun', ['A', 'B'], { played: played(), lastRun: played('A') }), 'met');
    assert.equal(reqGroupStatus('RequiredAnyTextLinesLastRun', ['A', 'B'], { played: played(), lastRun: played() }), 'unmet');
    assert.equal(reqGroupStatus('RequiredFalseTextLinesLastRun', ['X'], { played: played(), lastRun: played('X') }), 'unmet');
    assert.equal(reqGroupStatus('RequiredFalseTextLinesLastRun', ['X'], { played: played(), lastRun: played() }), 'met');
});

test('REQ_TYPE_SCOPE maps each field to its save record (or none)', () => {
    assert.equal(REQ_TYPE_SCOPE.RequiredTextLines, 'played');
    assert.equal(REQ_TYPE_SCOPE.RequiredFalseTextLines, 'played');
    assert.equal(REQ_TYPE_SCOPE.RequiredTextLinesThisRun, 'thisRun');
    assert.equal(REQ_TYPE_SCOPE.RequiredFalseTextLinesThisRun, 'thisRun');
    assert.equal(REQ_TYPE_SCOPE.RequiredFalseTextLinesThisRoom, 'thisRoom');
    assert.equal(REQ_TYPE_SCOPE.RequiredQueuedTextLines, 'queued');
    assert.equal(REQ_TYPE_SCOPE.RequiredMinAnyTextLines, 'played');
    assert.equal(REQ_TYPE_SCOPE.RequiredMaxAnyTextLines, 'played');
    assert.equal(REQ_TYPE_SCOPE.RequiredAnyTextLinesLastRun, 'lastRun');
    assert.equal(REQ_TYPE_SCOPE.RequiredFalseTextLinesLastRun, 'lastRun');
    // Run-count fields aren't scoped to a single record (they use runsAgo),
    // and the unused RequiredTextLinesLastRun positive has no scope.
    for (const t of ['RequiredTextLinesLastRun',
        'MinRunsSinceAnyTextLines', 'MaxRunsSinceAnyTextLines']) {
        assert.equal(REQ_TYPE_SCOPE[t], undefined, t);
    }
});

test('reqGroupStatus: a null played set is unknown, and self-refs are ignored', () => {
    assert.equal(reqGroupStatus('RequiredTextLines', ['A'], null), 'unknown');
    // A play-once self-referencing negative gate is met on an empty save
    // once its own name is filtered out.
    assert.equal(reqGroupStatus('RequiredFalseTextLines', ['Ending01'], played(), 1, 'Ending01'), 'met');
});

test('reqGroupLocked: count-max overflow and a played global-negative are permanent locks', () => {
    // RequiredMaxAnyTextLines cap exceeded (played count > Count) -> permanent
    // (the cumulative played set only grows).
    assert.equal(reqGroupLocked('RequiredMaxAnyTextLines', ['A', 'B', 'C'], played('A', 'B'), 1), true);
    assert.equal(reqGroupLocked('RequiredMaxAnyTextLines', ['A', 'B', 'C'], played('A'), 1), false);
    // Global negative on an already-played line -> permanent (can't un-play).
    assert.equal(reqGroupLocked('RequiredFalseTextLines', ['X'], played('X')), true);
    assert.equal(reqGroupLocked('RequiredFalseTextLines', ['X'], played()), false);
    // Run-scoped negatives reset each run, so they are never permanent locks.
    assert.equal(reqGroupLocked('RequiredFalseTextLinesThisRun', ['X'], { played: played(), thisRun: played('X') }), false);
    // Ordinary satisfiable groups are not locked.
    assert.equal(reqGroupLocked('RequiredTextLines', ['A'], played()), false);
    assert.equal(reqGroupLocked('RequiredAnyTextLines', ['A', 'B'], played()), false);
    // No record to resolve against -> not claimed locked.
    assert.equal(reqGroupLocked('RequiredFalseTextLines', ['X'], null), false);
});

// --- requirementSetStatus: 3-state verdict for OR branches / sets ---

test('requirementSetStatus: empty set is met; all-evaluable-and-satisfied is met', () => {
    assert.equal(requirementSetStatus({}, {}, played()), 'met');
    assert.equal(requirementSetStatus({ RequiredTextLines: ['A'] }, {}, played('A')), 'met');
});

test('requirementSetStatus: a failing evaluable field makes the set unmet', () => {
    assert.equal(requirementSetStatus({ RequiredTextLines: ['A', 'B'] }, {}, played('A')), 'unmet');
});

test('requirementSetStatus: an unverifiable field yields unknown when nothing evaluable fails', () => {
    // RequiredTextLines satisfied, but the branch also carries a run-count
    // field the save can't resolve -> we can't confirm the whole set.
    const reqs = { RequiredTextLines: ['A'], MinRunsSinceAnyTextLines: ['B'] };
    assert.equal(requirementSetStatus(reqs, { MinRunsSinceAnyTextLines: { Count: 1 } }, played('A')), 'unknown');
    // A failing evaluable field still dominates (unmet beats unknown).
    assert.equal(requirementSetStatus(reqs, {}, played()), 'unmet');
    // A run-scoped field alone -> unknown.
    assert.equal(requirementSetStatus({ RequiredFalseTextLinesThisRun: ['X'] }, {}, played('X')), 'unknown');
});

test('requirementSetStatus: a null played set is unknown', () => {
    assert.equal(requirementSetStatus({ RequiredTextLines: ['A'] }, {}, null), 'unknown');
});

// Play-once wording + permanence. These need a loaded dataset (the play-once
// flag lives on the textline), so they run last in their own suite - loadData
// mutates the shared ``textlines`` binding the earlier repeatable-wording
// tests rely on being empty.
describe('run-count tooltips: play-once wording and permanence', () => {
    before(() => {
        loadData({
            textlines: {
                POnce: { owner: 'NPC_Test_01', requirements: {}, playOnce: true },
                Rep: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
    });

    test('a play-once ref is described as "played" (not "last played")', () => {
        const ctx = { played: new Set(['POnce', 'Rep']), runsAgo: { POnce: 5, Rep: 5 } };
        const ex = runsSinceExplain('MinRunsSinceAnyTextLines', ['POnce', 'Rep'], ctx, 3);
        const by = Object.fromEntries(ex.refs.map(r => [r.name, r]));
        assert.match(by.POnce.reason, /^played 5 runs ago/);   // play-once: no "last"
        assert.equal(by.POnce.playOnce, true);
        assert.match(by.Rep.reason, /^last played 5 runs ago/); // repeatable keeps "last played"
        assert.equal(by.Rep.playOnce, false);
    });

    test('a play-once ref past a MaxRunsSince window is permanent; a repeatable one is not', () => {
        const ctx = { played: new Set(['POnce', 'Rep']), runsAgo: { POnce: 5, Rep: 5 } };
        const ex = runsSinceExplain('MaxRunsSinceAnyTextLines', ['POnce', 'Rep'], ctx, 3);
        assert.equal(ex.status, 'unmet');
        assert.equal(ex.permanent, true);
        const by = Object.fromEntries(ex.refs.map(r => [r.name, r]));
        assert.equal(by.POnce.permanent, true);
        assert.match(by.POnce.reason, /played 5 runs ago.*too long ago.*can only play once/);
        assert.equal(by.Rep.permanent, false);
        assert.doesNotMatch(by.Rep.reason, /can only play once/);
    });

    test('a play-once ref played beyond the tracked depth is permanently out of a Max window', () => {
        // In the cumulative played set but not in runsAgo -> older than the
        // tracked run history -> a play-once line can never return.
        const ex = runsSinceExplain('MaxRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: {} }, 3);
        assert.equal(ex.permanent, true);
        assert.match(ex.refs[0].reason, /tracked run history.*can only play once/);
    });

    test('Min wording uses "played" for a play-once ref but is never permanent', () => {
        const ex = runsSinceExplain('MinRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: { POnce: 1 } }, 3);
        assert.equal(ex.permanent, false);
        assert.equal(ex.refs[0].permanent, false);
        assert.match(ex.refs[0].reason, /^played 1 run ago, too recent/);
    });

    test('reqGroupLocked: a play-once MaxRunsSince ref past its window locks the group', () => {
        // Play-once ref out of the window -> permanent lock.
        assert.equal(reqGroupLocked('MaxRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: { POnce: 5 } }, 3), true);
        // Beyond tracked depth (played, absent from runsAgo) -> still locked.
        assert.equal(reqGroupLocked('MaxRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: {} }, 3), true);
        // A repeatable ref can replay -> recoverable, not locked.
        assert.equal(reqGroupLocked('MaxRunsSinceAnyTextLines', ['Rep'],
            { played: new Set(['Rep']), runsAgo: { Rep: 5 } }, 3), false);
        // Within the window -> not locked.
        assert.equal(reqGroupLocked('MaxRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: { POnce: 1 } }, 3), false);
        // Min run-count gates are never permanent (time only helps).
        assert.equal(reqGroupLocked('MinRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: { POnce: 1 } }, 3), false);
    });

    test('runsSinceGroupTooltip flags a permanent play-once lock in the head', () => {
        const tip = runsSinceGroupTooltip('MaxRunsSinceAnyTextLines', ['POnce'],
            { played: new Set(['POnce']), runsAgo: { POnce: 5 } }, 3);
        assert.match(tip, /permanently out of range, so this can never become eligible again/);
        assert.match(tip, /\u2717 POnce: played 5 runs ago/);
    });

    test('runsSinceRefTooltip drops the generic suffix for a permanent play-once lock', () => {
        const rt = runsSinceRefTooltip('MaxRunsSinceAnyTextLines', 'POnce',
            { played: new Set(['POnce']), runsAgo: { POnce: 5 } }, 3);
        assert.match(rt, /^Played 5 runs ago.*can only play once, so this gate can never be met again\.$/);
        assert.doesNotMatch(rt, /blocks this run-count gate/);
    });
});
