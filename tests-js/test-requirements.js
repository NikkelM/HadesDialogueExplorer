// Tests for the shared requirement-semantics classifier in
// ``templates/viewer/requirements.js``.
//
// This is the single source of truth the save-progress badge and the
// eligibility tracer use to decide whether a dialogue is directly
// eligible given a save. The classifier must honour per-type semantics
// (AND / OR / negative) rather than treating every referenced line as a
// hard prerequisite.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    isDirectlySatisfied,
    directSatisfaction,
    requiredCount,
    reqGroupStatus,
    requirementSetStatus,
    AND_REQ_TYPES,
    OR_REQ_TYPES,
    NEGATIVE_REQ_TYPES,
    COUNT_MIN_REQ_TYPES,
    SAVE_EVALUABLE_REQ_TYPES,
} from '../templates/viewer/requirements.js';

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

test('run-count and cooldown fields make a dialogue indeterminate (can\u2019t determine)', () => {
    // The save can't resolve run counts, so a dialogue gated only on a
    // run-count field is neither confirmed eligible nor blocked - it's
    // 'unknown' (surfaced as the "indeterminate" save status).
    assert.equal(COUNT_MIN_REQ_TYPES.has('MinRunsSinceAnyTextLines'), false);
    assert.equal(directSatisfaction(tl({ MinRunsSinceAnyTextLines: ['A'] }), played()), 'unknown');
    assert.equal(directSatisfaction(tl({ MaxRunsSinceAnyTextLines: ['A'] }), played()), 'unknown');
    assert.equal(directSatisfaction(tl({ RequiredMaxAnyTextLines: ['A', 'B'] }), played()), 'unknown');
    // The boolean wrapper reports these as not-a-confirmed-yes.
    assert.equal(isDirectlySatisfied(tl({ MinRunsSinceAnyTextLines: ['A'] }), played()), false);
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

test('RequiredAnyTextLinesThisRun is an OR gate but unverifiable from a save', () => {
    // It's still classified as an OR field (regression: it was once missing
    // from the OR set)...
    assert.equal(OR_REQ_TYPES.has('RequiredAnyTextLinesThisRun'), true);
    // ...but it's run-scoped, so a save can't confirm it: the dialogue is
    // indeterminate no matter what the cumulative played set contains.
    assert.equal(SAVE_EVALUABLE_REQ_TYPES.has('RequiredAnyTextLinesThisRun'), false);
    const t = tl({ RequiredAnyTextLinesThisRun: ['A', 'B'] });
    assert.equal(directSatisfaction(t, played()), 'unknown');
    assert.equal(directSatisfaction(t, played('A')), 'unknown');
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

test('reqGroupStatus: run-count / cooldown fields are unknown (no verdict)', () => {
    assert.equal(reqGroupStatus('MinRunsSinceAnyTextLines', ['A'], played()), 'unknown');
    assert.equal(reqGroupStatus('RequiredMaxAnyTextLines', ['A', 'B'], played('A')), 'unknown');
});

test('reqGroupStatus: run-scoped and queued fields are unknown (a cumulative save can\u2019t resolve them)', () => {
    // The save's played set is a global "ever played" record, so per-run /
    // per-room / queued scoping can't be checked - no verdict, regardless
    // of whether the referenced line is in the played set.
    assert.equal(reqGroupStatus('RequiredTextLinesThisRun', ['A'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredTextLinesLastRun', ['A'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRun', ['X'], played('X')), 'unknown');
    assert.equal(reqGroupStatus('RequiredFalseTextLinesThisRun', ['X'], played()), 'unknown');
    assert.equal(reqGroupStatus('RequiredAnyTextLinesLastRun', ['A', 'B'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredQueuedTextLines', ['A'], played('A')), 'unknown');
    assert.equal(reqGroupStatus('RequiredFalseQueuedTextLines', ['X'], played('X')), 'unknown');
});

test('SAVE_EVALUABLE_REQ_TYPES covers exactly the global fields', () => {
    for (const t of ['RequiredTextLines', 'RequiredAnyTextLines', 'RequiredAnyOtherTextLines',
        'RequiredFalseTextLines', 'RequiredMinAnyTextLines']) {
        assert.equal(SAVE_EVALUABLE_REQ_TYPES.has(t), true, t);
    }
    for (const t of ['RequiredTextLinesThisRun', 'RequiredFalseTextLinesThisRun',
        'RequiredAnyTextLinesLastRun', 'RequiredQueuedTextLines', 'MinRunsSinceAnyTextLines',
        'RequiredMaxAnyTextLines']) {
        assert.equal(SAVE_EVALUABLE_REQ_TYPES.has(t), false, t);
    }
});

test('reqGroupStatus: a null played set is unknown, and self-refs are ignored', () => {
    assert.equal(reqGroupStatus('RequiredTextLines', ['A'], null), 'unknown');
    // A play-once self-referencing negative gate is met on an empty save
    // once its own name is filtered out.
    assert.equal(reqGroupStatus('RequiredFalseTextLines', ['Ending01'], played(), 1, 'Ending01'), 'met');
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
