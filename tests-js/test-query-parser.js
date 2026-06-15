// Tests for ``templates/viewer/query-parser.js``.
//
// The parser is the single entry point between the raw search-bar
// input and the structured query consumed by the name/text search
// engines. Every operator the UI advertises has to survive a round
// trip through these tests, including the back-compat behaviour for
// bare word input (which must produce the same positive-token list
// as the old ``q.split(/\s+/)`` approach did).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseQuery, emptyQuery, isQueryEmpty } from '../templates/viewer/query-parser.js';

test('emptyQuery returns a fully populated structured query with empty arrays', () => {
    const q = emptyQuery();
    assert.deepEqual(q.positive, []);
    assert.deepEqual(q.negative, []);
    assert.deepEqual(q.phrases, []);
    assert.deepEqual(q.negativePhrases, []);
    assert.deepEqual(q.speakers, []);
    assert.deepEqual(q.negativeSpeakers, []);
    assert.deepEqual(q.sections, []);
    assert.deepEqual(q.negativeSections, []);
});

test('isQueryEmpty: true for blank input, false as soon as anything is present', () => {
    assert.equal(isQueryEmpty(parseQuery('')), true);
    assert.equal(isQueryEmpty(parseQuery('   ')), true);
    assert.equal(isQueryEmpty(parseQuery('hello')), false);
    assert.equal(isQueryEmpty(parseQuery('-hello')), false);
    assert.equal(isQueryEmpty(parseQuery('speaker:zeus')), false);
    assert.equal(isQueryEmpty(parseQuery('""')), true);
});

test('parseQuery: bare words become lowercase positive tokens (back-compat)', () => {
    // Back-compat: the existing search bar split on whitespace and
    // lowercased; the parser must preserve that token list as
    // ``positive`` so name and text search keep working unchanged.
    const q = parseQuery('I Knew You');
    assert.deepEqual(q.positive, ['i', 'knew', 'you']);
    assert.deepEqual(q.negative, []);
    assert.deepEqual(q.phrases, []);
});

test('parseQuery: trims surrounding whitespace and collapses runs', () => {
    const q = parseQuery('   i   think    ');
    assert.deepEqual(q.positive, ['i', 'think']);
});

test('parseQuery: "exact phrase" becomes a phrase entry AND seeds positive tokens', () => {
    // Phrase contents drive ranking (so a quoted phrase ranks at
    // least as well as the same words typed bare) on top of the
    // contiguous-match filter.
    const q = parseQuery('"my voice"');
    assert.deepEqual(q.phrases, ['my voice']);
    assert.deepEqual(q.positive, ['my', 'voice']);
});

test('parseQuery: phrase with surrounding words mixes phrase + bare tokens', () => {
    const q = parseQuery('orpheus "my voice" again');
    assert.deepEqual(q.phrases, ['my voice']);
    assert.deepEqual(q.positive, ['orpheus', 'my', 'voice', 'again']);
});

test('parseQuery: -word becomes a negative token, not a positive one', () => {
    const q = parseQuery('chronos -hecate');
    assert.deepEqual(q.positive, ['chronos']);
    assert.deepEqual(q.negative, ['hecate']);
});

test('parseQuery: -"phrase" becomes a negativePhrase, not negativeTokens', () => {
    // The per-phrase exclusion filter is strictly stronger than the
    // per-word exclusion - candidates that contain individual words
    // of the phrase but NOT the contiguous phrase still qualify.
    const q = parseQuery('-"old friend"');
    assert.deepEqual(q.negativePhrases, ['old friend']);
    assert.deepEqual(q.negative, []);
    assert.deepEqual(q.positive, []);
});

test('parseQuery: speaker:X registers a positive speaker filter, lowercased', () => {
    const q = parseQuery('speaker:Zeus');
    assert.deepEqual(q.speakers, ['zeus']);
    assert.deepEqual(q.negativeSpeakers, []);
    assert.deepEqual(q.positive, []);
});

test('parseQuery: -speaker:X registers a negative speaker filter', () => {
    const q = parseQuery('-speaker:Zagreus');
    assert.deepEqual(q.negativeSpeakers, ['zagreus']);
    assert.deepEqual(q.speakers, []);
});

test('parseQuery: speaker:"Quoted Value" preserves the value verbatim (lowercased), no phrase semantics', () => {
    // Quoting only allows whitespace inside a filter value; it does
    // NOT promote the value to a phrase. The value lands in the
    // ``speakers`` list and is NOT pushed into ``phrases``.
    const q = parseQuery('speaker:"Zeus (Boss)"');
    assert.deepEqual(q.speakers, ['zeus (boss)']);
    assert.deepEqual(q.phrases, []);
});

test('parseQuery: multiple speaker: filters land in the speakers array in order (OR semantics live in the engine)', () => {
    const q = parseQuery('speaker:Zeus speaker:Meg');
    assert.deepEqual(q.speakers, ['zeus', 'meg']);
});

test('parseQuery: section:Gift and section:GiftTextLineSets both pass through as filter values', () => {
    const q = parseQuery('section:Gift section:InteractTextLineSets');
    assert.deepEqual(q.sections, ['gift', 'interacttextlinesets']);
});

test('parseQuery: -section:Gift registers a negative section filter', () => {
    const q = parseQuery('-section:Gift');
    assert.deepEqual(q.negativeSections, ['gift']);
});

test('parseQuery: unknown key prefixes are parsed as literal bare tokens', () => {
    // ``url:foo`` is not a registered filter, so the colon stays
    // attached and the whole atom becomes one positive token. This
    // keeps the user from silently losing intent when they mistype
    // a filter name or paste in content with colons.
    const q = parseQuery('url:foo bar');
    assert.deepEqual(q.positive, ['url:foo', 'bar']);
    assert.deepEqual(q.speakers, []);
});

test('parseQuery: lone - is treated as a literal token, not a dangling negation', () => {
    const q = parseQuery('what - this');
    assert.deepEqual(q.positive, ['what', '-', 'this']);
});

test('parseQuery: -- before a word still flags negation on the remaining "-word"', () => {
    // ``--foo`` -> negate consumes the first ``-`` and the value
    // becomes ``-foo``. Treating the leading dash this way is
    // consistent with how DuckDuckGo handles the token and keeps
    // the parser simple (single-pass, no lookahead beyond the
    // first character).
    const q = parseQuery('--foo');
    assert.deepEqual(q.negative, ['-foo']);
    assert.deepEqual(q.positive, []);
});

test('parseQuery: empty filter value is dropped (speaker: alone carries no signal)', () => {
    const q = parseQuery('speaker:');
    assert.deepEqual(q.speakers, []);
    assert.deepEqual(q.positive, []);
});

test('parseQuery: empty quoted filter value is dropped', () => {
    const q = parseQuery('speaker:""');
    assert.deepEqual(q.speakers, []);
});

test('parseQuery: empty quoted phrase is dropped', () => {
    const q = parseQuery('"" hello');
    assert.deepEqual(q.phrases, []);
    assert.deepEqual(q.positive, ['hello']);
});

test('parseQuery: unmatched opening quote consumes the rest of the input as a phrase', () => {
    // Tolerant of mid-typing input: the user hits the open quote
    // then keeps typing. The parser eats the tail rather than
    // throwing or producing nothing, so search keeps responding to
    // every keystroke.
    const q = parseQuery('hello "my voice');
    assert.deepEqual(q.positive, ['hello', 'my', 'voice']);
    assert.deepEqual(q.phrases, ['my voice']);
});

test('parseQuery: kitchen sink combines every operator class', () => {
    const q = parseQuery('"my voice" orpheus -hated speaker:Orpheus -section:Gift again');
    assert.deepEqual(q.phrases, ['my voice']);
    // Positive: phrase contents (my, voice) + bare words (orpheus, again).
    assert.deepEqual(q.positive, ['my', 'voice', 'orpheus', 'again']);
    assert.deepEqual(q.negative, ['hated']);
    assert.deepEqual(q.speakers, ['orpheus']);
    assert.deepEqual(q.negativeSpeakers, []);
    assert.deepEqual(q.sections, []);
    assert.deepEqual(q.negativeSections, ['gift']);
});

test('parseQuery: filter keys are case-insensitive (Speaker:X parses as speaker)', () => {
    const q = parseQuery('Speaker:Zeus SECTION:Gift');
    assert.deepEqual(q.speakers, ['zeus']);
    assert.deepEqual(q.sections, ['gift']);
});

test('parseQuery: multiple phrases each get their own entry', () => {
    const q = parseQuery('"my voice" "at last"');
    assert.deepEqual(q.phrases, ['my voice', 'at last']);
});

test('parseQuery: -speaker: with empty value is dropped (no negation registered)', () => {
    // The empty-filter rule applies to negative filters too -
    // ``-speaker:`` carries no information and shouldn't ghost-add
    // a negation entry.
    const q = parseQuery('-speaker: hello');
    assert.deepEqual(q.negativeSpeakers, []);
    assert.deepEqual(q.positive, ['hello']);
});
