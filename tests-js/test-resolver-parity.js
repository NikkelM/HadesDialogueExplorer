// Resolver coverage parity (issue: silent save-coverage degradation).
//
// The H2 save-eligibility evaluator (gamestate-eval.js) resolves a fixed set of
// ``FunctionName`` gates from the persisted save slice; any other FunctionName
// falls through to a 'unknown' (indeterminate) verdict because it reads live
// run / room / combat state a static save doesn't snapshot. That fall-through
// is silent - a NEW H2 FunctionName added by a game update (Hades II is in early
// access and still growing) would quietly shrink save coverage with nothing to
// flag it. These tests assert every FunctionName present in the BUILT data is
// classified: either save-resolved (``H2_RESOLVED_FUNCTION_NAMES``, the single
// source of truth exported from the evaluator) or on the intentionally-unknown
// allowlist here. A new gate then fails the suite until it is classified.
//
// H1 (Hades 1) is a finished game - its requirement vocabulary is frozen, so the
// "degrades as the game grows" risk this guards against is H2-specific.
//
// Skips when ``dist/data-hades2.json`` is absent so a fresh clone stays runnable
// (mirrors tests/hades1/test_other_req_types.py's data-driven completeness check).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { H2_RESOLVED_FUNCTION_NAMES } from '../templates/viewer/gamestate-eval.js';

const H2_DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'data-hades2.json');

// FunctionName gates deliberately left indeterminate: each reads live engine
// state a static save can't provide. Adding a resolver for one moves it OUT of
// here and INTO gamestate-eval.js's _H2_FUNCTION_EVALS.
const H2_INTENTIONALLY_UNKNOWN = new Set([
    'RequiredAlive',                    // live unit alive-state
    'RequiredBossPhase',                // live boss-encounter phase
    'RequiredRarityInRoom',             // live in-room boon rarity
    'RequiredTraitNameInRoom',          // live in-room trait presence
    'RequireAffordableGhostAdminItems', // live shop affordability
]);

function collectFunctionNames(textlines) {
    const found = new Set();
    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node && typeof node === 'object') {
            if (typeof node.FunctionName === 'string') found.add(node.FunctionName);
            for (const v of Object.values(node)) walk(v);
        }
    };
    for (const tl of Object.values(textlines || {})) walk(tl.otherRequirements || {});
    return found;
}

test('H2 resolver-parity: every FunctionName gate in the data is resolved or intentionally-unknown', (t) => {
    if (!existsSync(H2_DATA)) {
        t.skip('dist/data-hades2.json not present - run `python build_viewer.py` first');
        return;
    }
    const data = JSON.parse(readFileSync(H2_DATA, 'utf-8'));
    const present = collectFunctionNames(data.textlines);
    const classified = new Set([...H2_RESOLVED_FUNCTION_NAMES, ...H2_INTENTIONALLY_UNKNOWN]);
    const unclassified = [...present].filter((fn) => !classified.has(fn)).sort();
    assert.deepEqual(
        unclassified, [],
        `Unclassified H2 FunctionName gate(s): ${unclassified.join(', ')}. `
        + `Add a resolver in gamestate-eval.js (_H2_FUNCTION_EVALS), or if it reads `
        + `live engine state, add it to H2_INTENTIONALLY_UNKNOWN in this test.`,
    );
});

test('H2 resolver-parity: resolved set and intentionally-unknown allowlist are disjoint', () => {
    const overlap = [...H2_RESOLVED_FUNCTION_NAMES].filter((fn) => H2_INTENTIONALLY_UNKNOWN.has(fn)).sort();
    assert.deepEqual(overlap, [], `FunctionName(s) both resolved and allowlisted: ${overlap.join(', ')}`);
});

test('H2 resolver-parity: the intentionally-unknown allowlist has no dead entries', (t) => {
    if (!existsSync(H2_DATA)) {
        t.skip('dist/data-hades2.json not present');
        return;
    }
    const data = JSON.parse(readFileSync(H2_DATA, 'utf-8'));
    const present = collectFunctionNames(data.textlines);
    const dead = [...H2_INTENTIONALLY_UNKNOWN].filter((fn) => !present.has(fn)).sort();
    assert.deepEqual(
        dead, [],
        `H2_INTENTIONALLY_UNKNOWN entr(y/ies) no longer present in the data - prune: ${dead.join(', ')}`,
    );
});
