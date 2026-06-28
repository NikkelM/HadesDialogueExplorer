// Tests for the tooltip text helper (tooltip.js): delimiter de-orphaning so a
// lone bracket / brace / paren never wraps onto its own row in a tooltip.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { noOrphanDelims } from '../templates/viewer/tooltip.js';

const NBSP = '\u00A0';

test('noOrphanDelims glues a trailing brace to the last token', () => {
    const input = 'PathTrue: { "CurrentRun", "Hero", "TraitDictionary", "CircleEnlargeTrait" }';
    const out = noOrphanDelims(input);
    // The space before the closing brace becomes non-breaking; the one after
    // the opening brace too.
    assert.ok(out.includes(`"CircleEnlargeTrait"${NBSP}}`), 'closing brace glued to last token');
    assert.ok(out.includes(`{${NBSP}"CurrentRun"`), 'opening brace glued to first token');
    // The internal list joins stay breakable (plain spaces).
    assert.ok(out.includes('"CurrentRun", "Hero"'), 'internal commas stay breakable');
});

test('noOrphanDelims handles parens and square brackets too', () => {
    assert.equal(noOrphanDelims('foo ( a, b )'), `foo (${NBSP}a, b${NBSP})`);
    assert.equal(noOrphanDelims('foo [ a, b ]'), `foo [${NBSP}a, b${NBSP}]`);
});

test('noOrphanDelims leaves text without delimiters unchanged', () => {
    const plain = 'GameState.ReachedTrueEnding is true';
    assert.equal(noOrphanDelims(plain), plain);
});
