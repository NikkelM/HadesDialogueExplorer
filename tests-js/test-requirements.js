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
    requiredCount,
    AND_REQ_TYPES,
    OR_REQ_TYPES,
    NEGATIVE_REQ_TYPES,
    COUNT_MIN_REQ_TYPES,
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

test('run-count and cooldown fields are treated as satisfied (out of scope)', () => {
    assert.equal(COUNT_MIN_REQ_TYPES.has('MinRunsSinceAnyTextLines'), false);
    assert.equal(isDirectlySatisfied(tl({ MinRunsSinceAnyTextLines: ['A'] }), played()), true);
    assert.equal(isDirectlySatisfied(tl({ MaxRunsSinceAnyTextLines: ['A'] }), played()), true);
    assert.equal(isDirectlySatisfied(tl({ RequiredMaxAnyTextLines: ['A', 'B'] }), played()), true);
});

test('mixed AND + negative requirements', () => {
    const t = tl({ RequiredTextLines: ['A'], RequiredFalseTextLines: ['B'] });
    assert.equal(isDirectlySatisfied(t, played()), false);          // A not played yet
    assert.equal(isDirectlySatisfied(t, played('A')), true);        // A played, B not -> eligible
    assert.equal(isDirectlySatisfied(t, played('A', 'B')), false);  // B played -> negative violated
});

test('RequiredAnyTextLinesThisRun is recognised as an OR gate', () => {
    // Regression: this field was missing from the old OR set, so the gate
    // was silently dropped.
    assert.equal(OR_REQ_TYPES.has('RequiredAnyTextLinesThisRun'), true);
    const t = tl({ RequiredAnyTextLinesThisRun: ['A', 'B'] });
    assert.equal(isDirectlySatisfied(t, played()), false);
    assert.equal(isDirectlySatisfied(t, played('A')), true);
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
