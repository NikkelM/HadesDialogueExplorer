// Tests for ``templates/viewer/search-text.js``.
//
// Covers the word-boundary token matcher, the contiguous-phrase
// detector, and the top-level multi-token text search (issue #22).
// The fixture seeds three textlines whose dialogue includes the
// phrases "I knew you", "I think he's", and "I think he'd" so we can
// exercise the contiguous-run boost and the partial-match fallback.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    _isWordCharCode,
    findWordPositions,
    findContiguousPhrasePosition,
    searchTextLines,
    buildSnippetHtml,
} from '../templates/viewer/search-text.js';
import { loadFixtureData } from './fixtures.js';

before(() => {
    loadFixtureData();
});

test('_isWordCharCode covers a-z, A-Z, 0-9 and rejects whitespace and punctuation', () => {
    assert.equal(_isWordCharCode('a'.charCodeAt(0)), true);
    assert.equal(_isWordCharCode('Z'.charCodeAt(0)), true);
    assert.equal(_isWordCharCode('5'.charCodeAt(0)), true);
    assert.equal(_isWordCharCode(' '.charCodeAt(0)), false);
    assert.equal(_isWordCharCode("'".charCodeAt(0)), false);
    assert.equal(_isWordCharCode('.'.charCodeAt(0)), false);
    assert.equal(_isWordCharCode('-'.charCodeAt(0)), false);
});

test('findWordPositions matches whole-word tokens only, not substrings', () => {
    // ``i`` should match the standalone "I" but NOT the ``i`` inside
    // "think", "him", or other words with adjacent letters.
    const text = "i think i know".toLowerCase();
    const positions = findWordPositions(text, 'i');
    // Expected: pos 0 ("i think"), pos 8 ("i know"). NOT inside
    // "think" at pos 4.
    assert.deepEqual(positions, [0, 8]);
});

test('findWordPositions handles boundary cases (token at very start and very end)', () => {
    assert.deepEqual(findWordPositions('a', 'a'), [0]);
    assert.deepEqual(findWordPositions('end-of-line a', 'a'), [12]);
    assert.deepEqual(findWordPositions('a end-of-line', 'a'), [0]);
});

test('findWordPositions returns empty for an empty token', () => {
    assert.deepEqual(findWordPositions('whatever', ''), []);
});

test('findContiguousPhrasePosition matches adjacent tokens separated only by non-word chars', () => {
    const text = "i knew you would seek me out".toLowerCase();
    const phraseTokens = ['i', 'knew', 'you'];
    const firstPositions = findWordPositions(text, 'i');
    assert.equal(
        findContiguousPhrasePosition(text, phraseTokens, firstPositions),
        0,
    );
});

test('findContiguousPhrasePosition returns -1 when the phrase is broken by an intermediate word', () => {
    const text = "i barely knew you back then".toLowerCase();
    const phraseTokens = ['i', 'knew', 'you'];
    const firstPositions = findWordPositions(text, 'i');
    assert.equal(
        findContiguousPhrasePosition(text, phraseTokens, firstPositions),
        -1,
    );
});

test('findContiguousPhrasePosition with a single token returns the first position', () => {
    const text = "i think i know".toLowerCase();
    const firstPositions = findWordPositions(text, 'i');
    assert.equal(
        findContiguousPhrasePosition(text, ['i'], firstPositions),
        0,
    );
});

test('searchTextLines: ranks textlines that match all tokens above those that match a subset', () => {
    // "i knew you" matches ZeusWithAphrodite01 (line: "I knew you would seek me out...").
    const matches = searchTextLines(['i', 'knew', 'you'], new Set(), 50);
    assert.ok(matches.length >= 1);
    const top = matches[0];
    assert.equal(top.entry.name, 'ZeusWithAphrodite01');
    assert.equal(top.matchedCount, 3);
    // The full phrase is contiguous, so runLength must equal the
    // query length (3).
    assert.equal(top.runLength, 3);
});

test('searchTextLines: partial-match fallback (issue #22) - "i think fdfsdfsdfs" still returns matches', () => {
    // No textline contains ``fdfsdfsdfs``, but "i think" matches three
    // dialogues. Result must be non-empty and prioritise the lines
    // where the most query tokens are present.
    const matches = searchTextLines(['i', 'think', 'fdfsdfsdfs'], new Set(), 50);
    assert.ok(matches.length >= 1);
    // Top match should have matchedCount == 2 (both "i" and "think"
    // present) and runLength == 2 (the two tokens are contiguous).
    assert.equal(matches[0].matchedCount, 2);
    assert.equal(matches[0].runLength, 2);
    // AchillesAboutThanatos01 contains "I think he'd" - one of the
    // valid matches called out in the issue.
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('AchillesAboutThanatos01'));
});

test('searchTextLines: excludeNames skips already-shown textlines', () => {
    const without = searchTextLines(['i', 'think'], new Set(), 50);
    const withExclude = searchTextLines(
        ['i', 'think'],
        new Set(['AchillesAboutThanatos01']),
        50,
    );
    assert.equal(without.length - withExclude.length, 1);
    const excludedNames = withExclude.map((m) => m.entry.name);
    assert.ok(!excludedNames.includes('AchillesAboutThanatos01'));
});

test('searchTextLines: word-boundary search does NOT match "i" inside "his", "this", or "think"', () => {
    // The "MysteriousVoice01" line contains the letters "i" in "whisper"
    // and "in" but no standalone "I" word - so a lone "i" query must
    // not surface this textline.
    const matches = searchTextLines(['i'], new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('MysteriousVoice01'));
});

test('searchTextLines: returns at most one entry per textline (first-matching-line per name)', () => {
    // ZeusWithAphrodite01 has TWO dialogue lines that contain "i"
    // (one with "I knew you", one with "I think"). The search must
    // collapse to a single match per textline.
    const matches = searchTextLines(['i'], new Set(), 50);
    const zeusCount = matches.filter((m) => m.entry.name === 'ZeusWithAphrodite01').length;
    assert.equal(zeusCount, 1);
});

test('searchTextLines: limit caps result count', () => {
    const matches = searchTextLines(['i'], new Set(), 1);
    assert.equal(matches.length, 1);
});

test('buildSnippetHtml: wraps matched tokens in <mark> and escapes surrounding text', () => {
    const html = buildSnippetHtml(
        'A & B contain the word foo together.',
        ['foo'],
        [[23]],
        23,
    );
    assert.ok(html.includes('<mark>foo</mark>'));
    assert.ok(html.includes('A &amp; B'));
});

test('buildSnippetHtml: prepends / appends ellipsis when the window is clipped', () => {
    // 400-char string so the snippet window (~60 before / 140 after)
    // sits squarely inside it.
    const long = 'x'.repeat(150) + 'TARGET' + 'y'.repeat(150);
    const targetPos = 150;
    const html = buildSnippetHtml(long, ['target'], [[targetPos]], targetPos);
    assert.ok(html.startsWith('\u2026'));
    assert.ok(html.endsWith('\u2026'));
    assert.ok(html.includes('<mark>TARGET</mark>'));
});

test('buildSnippetHtml: no matches -> escaped text unchanged', () => {
    const html = buildSnippetHtml('plain & simple', ['foo'], [[]], -1);
    assert.equal(html, 'plain &amp; simple');
});
