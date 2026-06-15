// Tests for ``templates/viewer/search-text.js``.
//
// Covers the word-boundary token matcher, the contiguous-phrase
// detector, and the top-level multi-token text search.
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
    buildLinesIndex,
    tokeniseLineText,
    linesIdf,
    linesIndex,
    renderTextMatchHtml,
} from '../templates/viewer/search-text.js';
import { loadData, textlines } from '../templates/viewer/data.js';
import { emptyQuery } from '../templates/viewer/query-parser.js';
import { loadFixtureData, buildFixtureData } from './fixtures.js';

before(() => {
    loadFixtureData();
});

// Wrap a positive-token array in the structured query the engine
// now expects, with every other operator bucket left empty. Lets
// the older ranking tests keep their compact ``[token, ...]`` input
// shape while the new tests exercise filters and exclusions against
// full query objects.
function _q(positive, extras = {}) {
    return { ...emptyQuery(), positive, ...extras };
}

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
    const matches = searchTextLines(_q(['i', 'knew', 'you']), new Set(), 50);
    assert.ok(matches.length >= 1);
    const top = matches[0];
    assert.equal(top.entry.name, 'ZeusWithAphrodite01');
    assert.equal(top.matchedCount, 3);
    // The full phrase is contiguous, so runLength must equal the
    // query length (3).
    assert.equal(top.runLength, 3);
});

test('searchTextLines: partial-match fallback - "i think fdfsdfsdfs" still returns matches', () => {
    // No textline contains ``fdfsdfsdfs``, but "i think" matches three
    // dialogues. Result must be non-empty and prioritise the lines
    // where the most query tokens are present.
    const matches = searchTextLines(_q(['i', 'think', 'fdfsdfsdfs']), new Set(), 50);
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
    const without = searchTextLines(_q(['i', 'think']), new Set(), 50);
    const withExclude = searchTextLines(
        _q(['i', 'think']),
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
    const matches = searchTextLines(_q(['i']), new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('MysteriousVoice01'));
});

test('searchTextLines: returns at most one entry per textline (first-matching-line per name)', () => {
    // ZeusWithAphrodite01 has TWO dialogue lines that contain "i"
    // (one with "I knew you", one with "I think"). The search must
    // collapse to a single match per textline.
    const matches = searchTextLines(_q(['i']), new Set(), 50);
    const zeusCount = matches.filter((m) => m.entry.name === 'ZeusWithAphrodite01').length;
    assert.equal(zeusCount, 1);
});

test('searchTextLines: limit caps result count', () => {
    const matches = searchTextLines(_q(['i']), new Set(), 1);
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

// ---- IDF-weighted ranking ----

test('tokeniseLineText splits on non-word characters and keeps alphanumerics', () => {
    const tokens = tokeniseLineText("i think he's joking, about it!");
    assert.deepEqual(tokens, ['i', 'think', 'he', 's', 'joking', 'about', 'it']);
});

test('linesIdf: rare tokens carry strictly higher weight than common ones', () => {
    // ``i`` shows up in four of the six dialogue lines in the fixture,
    // ``knew`` only in one - the IDF weight must reflect that
    // ordering so the ranker has a rare-vs-common signal to act on.
    assert.ok(linesIdf.get('knew') > linesIdf.get('i'));
    // Every weight is strictly positive so multi-token sums never
    // collapse to zero, preserving the all-matches-beats-subset
    // promise.
    assert.ok(linesIdf.get('i') > 0);
});

test('searchTextLines: rare-token match outranks common-only match when matchedCount ties', () => {
    // Query ``i think knew``: three textlines match exactly two of the
    // tokens, but ZeusWithAphrodite01 is the only one whose pair
    // includes the rare ``knew``. The old matchedCount-only sort fell
    // back to alphabetical (AchillesAboutThanatos01 first); the IDF
    // ranker must surface ZeusWithAphrodite01 instead because
    // ``knew``'s weight dominates the common-token pairs.
    const matches = searchTextLines(_q(['i', 'think', 'knew']), new Set(), 50);
    assert.equal(matches[0].entry.name, 'ZeusWithAphrodite01');
    assert.equal(matches[0].matchedCount, 2);
    // Sanity: the next results still match the same count but with
    // common-only token pairs, scoring lower than the rare-anchored top.
    assert.ok(matches[1].matchedCount === 2);
    assert.ok(matches[1].score < matches[0].score);
});

test('searchTextLines: all-matches still beats subset-matches with IDF weighting', () => {
    // The IDF formula is strictly positive, so a line matching every
    // query token always scores higher than any line matching a
    // proper subset of the same query. Regression guard against an
    // implementation that could be tempted to subtract a per-line
    // penalty or otherwise let subset-matches overtake full-matches.
    const matches = searchTextLines(_q(['i', 'knew', 'you']), new Set(), 50);
    assert.equal(matches[0].entry.name, 'ZeusWithAphrodite01');
    assert.equal(matches[0].matchedCount, 3);
});

test('searchTextLines: stopword-only query degenerates to count-style ordering', () => {
    // Every token is high-frequency in this corpus, so weights are
    // similar; the line that matches all three still ranks first
    // (AchillesAboutThanatos01 contains ``i``, ``think``, and ``you``)
    // because more matches => higher weighted sum even when each
    // weight is small. No special fallback branch needed.
    const matches = searchTextLines(_q(['i', 'think', 'you']), new Set(), 50);
    assert.equal(matches[0].entry.name, 'AchillesAboutThanatos01');
    assert.equal(matches[0].matchedCount, 3);
});

test('searchTextLines: single-token query skips IDF and preserves alphabetical ordering', () => {
    // With only one token there is nothing to rank against, so every
    // matching line scores the same (1) and the sort falls back to
    // the alphabetical scan order from ``allNames``. First match must
    // therefore be the alphabetically first textline that contains
    // ``i`` as a word boundary - AchillesAboutThanatos01.
    const matches = searchTextLines(_q(['i']), new Set(), 50);
    assert.equal(matches[0].entry.name, 'AchillesAboutThanatos01');
    // Every result scores 1 (single-token, IDF skipped).
    for (const m of matches) {
        assert.equal(m.score, 1);
    }
});

test('linesIdf is rebuilt whenever buildLinesIndex runs against a fresh corpus', () => {
    // Reload with a tiny single-document corpus so the IDF map is
    // forced to recompute. After the rebuild the only token in the
    // new corpus carries the singleton weight; tokens from the
    // previous fixture must not leak through.
    loadData({
        textlines: {
            Tiny01: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'normal',
                narrativePrioritySetLevel: null,
                dialogueLines: [{ speaker: 'NPC_X_01', text: 'unique-word.' }],
            },
        },
        dependents: {},
        stats: { totalTextlines: 1, totalEdges: 0, unresolvedRefs: [] },
        speakers: {},
        knownUnresolvedRefs: {},
        unresolvedCategoryLabels: {},
        unresolvedCategoryDescriptions: {},
        unresolvedRefBlocks: {},
        reqTypeLabels: {},
        reqTypeEdgeLabels: {},
        reqTypeTooltips: {},
        reqTypeOrder: [],
        sectionKeyLabels: {},
    });
    buildLinesIndex();
    assert.equal(linesIdf.get('unique'), Math.log(2 / 2) + 1); // log(1)+1 = 1
    assert.equal(linesIdf.get('word'), 1);
    assert.equal(linesIdf.get('knew'), undefined);

    // Restore the shared fixture so subsequent tests in the file see
    // the baseline corpus.
    loadFixtureData();
    assert.ok(linesIdf.get('knew') !== undefined);
});

// Reset to the shared fixture so the smoke-test suite (which runs
// after this file) sees a known state regardless of which test ran
// last.

test('searchTextLines: candidate with more adjacent query-token pairs ranks above one with fewer', () => {
    // Both lines contain every query token (same weighted score) and
    // both have at most a single 2-run (same ``runLength``). The
    // ``adjacentPairs`` tiebreaker is what differentiates them - the
    // line that hits ``i think`` AND ``and Eurydice`` as separate
    // 2-runs deserves to rank above the one that only has ``i think``.
    loadData({
        textlines: {
            LineSingleFragment01: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'normal',
                narrativePrioritySetLevel: null,
                dialogueLines: [
                    { speaker: 'NPC_X_01', text: "I think Eurydice should know, and that is final." },
                ],
            },
            LineTwoFragments02: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'normal',
                narrativePrioritySetLevel: null,
                dialogueLines: [
                    { speaker: 'NPC_X_01', text: "I think it is decided - we shall send a chorus and Eurydice will follow." },
                ],
            },
        },
        dependents: {},
        stats: { totalTextlines: 2, totalEdges: 0, unresolvedRefs: [] },
        speakers: { NPC_X_01: { name: 'X' } },
        knownUnresolvedRefs: {},
        unresolvedCategoryLabels: {},
        unresolvedCategoryDescriptions: {},
        unresolvedRefBlocks: {},
        reqTypeLabels: {},
        reqTypeEdgeLabels: {},
        reqTypeTooltips: {},
        reqTypeOrder: [],
        sectionKeyLabels: {},
    });
    buildLinesIndex();

    const matches = searchTextLines(_q(['i', 'think', 'and', 'eurydice']), new Set(), 10);
    // Sanity: both lines matched all four query tokens.
    assert.equal(matches.length, 2);
    assert.equal(matches[0].matchedCount, 4);
    assert.equal(matches[1].matchedCount, 4);
    // The two-fragment line wins: two adjacent pairs (``i think`` +
    // ``and Eurydice``) vs the single-fragment line's one pair
    // (``i think`` only).
    assert.equal(matches[0].entry.name, 'LineTwoFragments02');
    assert.equal(matches[0].adjacentPairs, 2);
    assert.equal(matches[1].entry.name, 'LineSingleFragment01');
    assert.equal(matches[1].adjacentPairs, 1);

    loadFixtureData();
});

test('teardown: restore shared fixture', () => {
    loadData(buildFixtureData());
    buildLinesIndex();
});

// ---- Choice-option indexing (issue #77) ----
//
// ``buildLinesIndex`` pushes one synthetic entry per choice option for
// every ``kind === 'choicePrompt'`` dialogue line, so a search for the
// player-facing button label ("Lament", "Go to Her", ...) surfaces
// the parent prompt textline even when those words never appear in
// the prompt text itself. The fixture's ``BecameCloseWithMegaera01``
// textline carries three options: two with friendly labels in
// ``choiceNames`` and one intentionally absent so the
// fallback-to-internal-id path has a dedicated case.

test('buildLinesIndex: pushes synthetic entries for each choice option', () => {
    // Three choices on BecameCloseWithMegaera01 -> three synthetic
    // ``isChoiceOption`` entries, one per option.
    const choiceEntries = linesIndex.filter(
        (e) => e.name === 'BecameCloseWithMegaera01' && e.isChoiceOption,
    );
    assert.equal(choiceEntries.length, 3);
    // Plus the prompt's own text entry (the regular line with
    // ``text: "Be with Megaera? (Follow your heart.)"``).
    const promptEntries = linesIndex.filter(
        (e) => e.name === 'BecameCloseWithMegaera01' && !e.isChoiceOption,
    );
    assert.equal(promptEntries.length, 1);
    assert.equal(promptEntries[0].textOriginal, 'Be with Megaera? (Follow your heart.)');
});

test('buildLinesIndex: choice-option entries use friendly label from choiceNames', () => {
    const labels = linesIndex
        .filter((e) => e.name === 'BecameCloseWithMegaera01' && e.isChoiceOption)
        .map((e) => e.textOriginal);
    assert.ok(labels.includes('Go to Her'));
    assert.ok(labels.includes('Back Off'));
});

test('buildLinesIndex: choice-option entries fall back to internal id when no friendly label', () => {
    // ``Meg_UnknownInternalOnly`` has no entry in ``choiceNames``,
    // so the raw internal id is used as the indexed text - keeping
    // the option searchable even before its label is hand-curated.
    const labels = linesIndex
        .filter((e) => e.name === 'BecameCloseWithMegaera01' && e.isChoiceOption)
        .map((e) => e.textOriginal);
    assert.ok(labels.includes('Meg_UnknownInternalOnly'));
});

test('buildLinesIndex: choice-option entries share parent name and prompt lineIdx', () => {
    // Click-through must land on the parent prompt textline, not on
    // a synthetic name - the entry carries the parent's ``name``
    // verbatim. ``lineIdx`` points at the prompt line so any
    // snippet-anchoring logic can locate the correct dialogue row.
    const promptIdx = textlines.BecameCloseWithMegaera01.dialogueLines.findIndex(
        (l) => l && l.kind === 'choicePrompt',
    );
    assert.ok(promptIdx >= 0);
    const choiceEntries = linesIndex.filter(
        (e) => e.name === 'BecameCloseWithMegaera01' && e.isChoiceOption,
    );
    for (const e of choiceEntries) {
        assert.equal(e.name, 'BecameCloseWithMegaera01');
        assert.equal(e.lineIdx, promptIdx);
        assert.equal(e.speaker, '');
    }
});

test('searchTextLines: surfaces choicePrompt textline via choice-option label search', () => {
    // "Go to Her" / "Back Off" / "Lament" appear nowhere in any
    // dialogue text in the fixture - they ONLY exist as choice
    // option labels. The search must still find the parent prompt
    // textline because ``buildLinesIndex`` pushed synthetic entries
    // for each option.
    const matches = searchTextLines(_q(['go', 'to', 'her']), new Set(), 50);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].entry.name, 'BecameCloseWithMegaera01');
    assert.equal(matches[0].entry.isChoiceOption, true);
});

test('searchTextLines: choice-option search returns one row per parent textline (dedup)', () => {
    // Both "Go to Her" and "Back Off" match the query ``back her``
    // via different choice options on the same parent textline.
    // The seen-set dedup must collapse the result to a single row
    // per parent (the first-iterated entry wins - here, the prompt
    // text entry doesn't match ``back her``, so the first matching
    // synthetic choice entry surfaces).
    const matches = searchTextLines(_q(['back', 'her']), new Set(), 50);
    const becameClose = matches.filter((m) => m.entry.name === 'BecameCloseWithMegaera01');
    assert.equal(becameClose.length, 1);
});

test('searchTextLines: regular dialogue text wins over choice-option match on the same parent', () => {
    // The prompt's own text contains "with". For query "with", BOTH
    // the regular prompt entry AND the choice-option entries are
    // candidates, but ``buildLinesIndex`` pushes the regular entry
    // before the choice entries for the same line, so the dedup
    // ``seen`` set keeps the regular (non-choice) entry. Asserts
    // we prefer "real" dialogue over a synthetic choice label when
    // both match.
    const matches = searchTextLines(_q(['with']), new Set(), 50);
    const becameClose = matches.find((m) => m.entry.name === 'BecameCloseWithMegaera01');
    assert.ok(becameClose);
    assert.notEqual(becameClose.entry.isChoiceOption, true);
});

test('searchTextLines: internal-id fallback is searchable for unmapped options', () => {
    // ``Meg_UnknownInternalOnly`` has no friendly label, so the
    // raw internal id is the indexed text. Searching for a unique
    // fragment of the id surfaces the parent textline.
    const matches = searchTextLines(_q(['unknowninternalonly']), new Set(), 50);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0].entry.name, 'BecameCloseWithMegaera01');
    assert.equal(matches[0].entry.isChoiceOption, true);
    assert.equal(matches[0].entry.textOriginal, 'Meg_UnknownInternalOnly');
});

test('renderTextMatchHtml: choice-option entry renders the "Choice option:" marker, not a speaker prefix', () => {
    const matches = searchTextLines(_q(['go', 'to', 'her']), new Set(), 50);
    assert.ok(matches.length >= 1);
    const html = renderTextMatchHtml(matches[0], ['go', 'to', 'her']);
    // The synthetic prefix replaces the speaker label entirely - no
    // ``snippet-speaker`` element should appear for a choice-option
    // row.
    assert.ok(html.includes('snippet-choice-label'));
    assert.ok(html.includes('Choice option:'));
    assert.ok(!html.includes('snippet-speaker'));
});

test('renderTextMatchHtml: regular dialogue match still renders the speaker prefix', () => {
    // Regression guard: a normal (non-choice) match must keep the
    // existing speaker-label rendering. The Achilles textline has
    // no friendly speaker description but does carry a name, so the
    // speaker prefix surfaces with that label.
    const matches = searchTextLines(_q(['i', 'think']), new Set(), 50);
    const achilles = matches.find((m) => m.entry.name === 'AchillesAboutThanatos01');
    assert.ok(achilles);
    const html = renderTextMatchHtml(achilles, ['i', 'think']);
    assert.ok(html.includes('snippet-speaker'));
    assert.ok(!html.includes('snippet-choice-label'));
    assert.ok(!html.includes('Choice option:'));
});

// ---- Query-operator filters: phrases, exclusions, speaker:, section: ----
//
// The structured-query plumbing lets the search bar express hard
// filters that the older bare-token interface couldn't. Tests below
// pin down the contract: every operator is a HARD reject (no
// ranking workaround), filters apply uniformly to choicePrompt
// synthetic entries via their parent textline, and back-compat
// behaviour is preserved when an operator class is absent.

test('searchTextLines: phrase filter requires contiguous match (drops candidates that have only scattered tokens)', () => {
    // ``i knew you`` matches ZeusWithAphrodite01 contiguously
    // ("I knew you would seek me out..."). Other textlines contain
    // ``i`` and ``you`` separately - those must be dropped by the
    // hard phrase filter.
    const q = { ..._q([]), phrases: ['i knew you'], positive: ['i', 'knew', 'you'] };
    const matches = searchTextLines(q, new Set(), 50);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].entry.name, 'ZeusWithAphrodite01');
});

test('searchTextLines: phrase filter rejects when tokens are present but not contiguous', () => {
    // No textline in the fixture contains the literal phrase
    // ``think knew`` even though both words appear in
    // ZeusWithAphrodite01 (on different lines, and in the wrong
    // order within the second line). The phrase filter is strict
    // about per-line contiguity.
    const q = { ..._q([]), phrases: ['think knew'], positive: ['think', 'knew'] };
    const matches = searchTextLines(q, new Set(), 50);
    assert.equal(matches.length, 0);
});

test('searchTextLines: -word excludes candidates whose line contains the word', () => {
    // Three textlines contain ``i think`` - excluding the one with
    // ``joking`` removes only ZeusWithAphrodite01's matching line.
    // Note: the per-textline dedup already collapses to one entry
    // per name, and ZeusWithAphrodite01's matching line is the
    // ``I think he's joking about it.`` one (the ``i knew`` line
    // doesn't contain ``think``), so the exclusion strips that
    // textline entirely.
    const q = { ..._q(['i', 'think']), negative: ['joking'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
    assert.ok(names.includes('AchillesAboutThanatos01'));
});

test('searchTextLines: -word exclusion respects word boundaries (does not match substrings)', () => {
    // ``-his`` must NOT reject candidates whose line contains
    // ``this`` - same word-boundary semantics as positive
    // matching. The fixture has no line containing ``this``
    // anyway, but the principle matters for future fixtures.
    const q = { ..._q(['i', 'think']), negative: ['his'] };
    const matches = searchTextLines(q, new Set(), 50);
    // Achilles line is "I think he'd want you to know." - ``he'd``
    // tokenises as ``he`` + ``d``; ``his`` is not a whole word
    // anywhere, so the line must survive.
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('AchillesAboutThanatos01'));
});

test('searchTextLines: -"phrase" excludes any textline whose lines contain the contiguous phrase', () => {
    // ZeusWithAphrodite01 contains ``i knew you`` on its first
    // line. Excluding the phrase removes the whole textline,
    // including its ``i think he's joking`` line. AchillesAboutThanatos01
    // and OrpheusSingsAgain02 don't contain the phrase, so they
    // survive.
    const q = { ..._q(['i', 'think']), negativePhrases: ['i knew you'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('AchillesAboutThanatos01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: -"phrase" with no contiguous hit anywhere keeps the textline', () => {
    // ``i think knew`` is never contiguous in any line; the
    // negative phrase has no effect and ZeusWithAphrodite01 still
    // ranks via its positive token matches on ``i think``.
    const q = { ..._q(['i', 'think']), negativePhrases: ['i think knew'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: speaker: filter restricts results by owner', () => {
    // ``speaker:Zeus`` matches the owner of ZeusWithAphrodite01;
    // other textlines drop out even though they contain the
    // positive token ``i``.
    const q = { ..._q(['i']), speakers: ['zeus'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.deepEqual(names, ['ZeusWithAphrodite01']);
});

test('searchTextLines: speaker: filter also matches per-line speakers (not just owner)', () => {
    // ZeusWithAphrodite01 is owned by Zeus, but its second line
    // is spoken by Zagreus. A ``speaker:Zagreus`` filter must
    // include this textline too via the per-line-speaker arm of
    // the speakerHaystack.
    const q = { ..._q(['i']), speakers: ['zagreus'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: speaker: filter is case-insensitive and matches friendly OR internal id', () => {
    // Both the internal id full form (``NPC_Orpheus_01`` lowercased)
    // and the friendly name (``Orpheus``) point at the same textline.
    // The internal-id arm exercises the exact-full-identifier match;
    // the friendly arm exercises the prefix-token match against the
    // ``orpheus`` token.
    const matchesByInternal = searchTextLines(
        { ..._q(['voice']), speakers: ['npc_orpheus_01'] },
        new Set(),
        50,
    );
    const matchesByFriendly = searchTextLines(
        { ..._q(['voice']), speakers: ['orpheus'] },
        new Set(),
        50,
    );
    assert.ok(matchesByInternal.some((m) => m.entry.name === 'OrpheusSingsAgain02'));
    assert.ok(matchesByFriendly.some((m) => m.entry.name === 'OrpheusSingsAgain02'));
});

test('searchTextLines: multiple speaker: filters apply as OR (any matches qualifies)', () => {
    // Both Zeus and Orpheus own a textline containing positive
    // token ``i``. Listing both speakers ORs them - results
    // include textlines for either owner.
    const q = { ..._q(['i']), speakers: ['zeus', 'orpheus'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: -speaker: filter excludes candidates with matching speaker', () => {
    // ``-speaker:Zagreus`` removes ZeusWithAphrodite01 (Zagreus
    // speaks on its second line) AND BecameCloseWithMegaera01
    // (owner Zagreus), but keeps Aphrodite / Orpheus / Achilles /
    // MysteriousVoice textlines.
    const q = { ..._q(['i']), negativeSpeakers: ['zagreus'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(!names.includes('BecameCloseWithMegaera01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: section: filter accepts the friendly label', () => {
    const q = { ..._q(['i']), sections: ['interact'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('OrpheusSingsAgain02'));
    assert.ok(names.includes('AchillesAboutThanatos01'));
    // Gift-section textline must be dropped.
    assert.ok(!names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: section: filter also accepts the internal section key', () => {
    const q = { ..._q(['i']), sections: ['interacttextlinesets'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('OrpheusSingsAgain02'));
    assert.ok(!names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: -section: filter excludes matching section', () => {
    const q = { ..._q(['i']), negativeSections: ['interact'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(!names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: choicePrompt entries respect speaker: filter via parent textline owner', () => {
    // BecameCloseWithMegaera01 is owned by Zagreus and contains
    // a choicePrompt. ``speaker:Zagreus`` keeps the synthetic
    // choice-option entries; ``speaker:Orpheus`` drops them even
    // though the choice labels match the positive token.
    const matchesByZag = searchTextLines(
        { ..._q(['her']), speakers: ['zagreus'] },
        new Set(),
        50,
    );
    assert.ok(matchesByZag.some((m) => m.entry.name === 'BecameCloseWithMegaera01'));
    const matchesByOrpheus = searchTextLines(
        { ..._q(['her']), speakers: ['orpheus'] },
        new Set(),
        50,
    );
    assert.ok(!matchesByOrpheus.some((m) => m.entry.name === 'BecameCloseWithMegaera01'));
});

test('searchTextLines: filter-only query (no positive tokens / phrases) returns nothing for text search', () => {
    // Text search owns ranking + highlighting of dialogue lines;
    // without any positive signal there's nothing to rank or mark
    // up, so it stays out of the dropdown's text-match section.
    // The name-match section is what carries filter-only queries.
    const q = { ..._q([]), speakers: ['zeus'] };
    const matches = searchTextLines(q, new Set(), 50);
    assert.equal(matches.length, 0);
});

test('searchTextLines: combined positive + phrase + speaker + negative still returns the intersection', () => {
    // ``"my voice" speaker:Orpheus -hated`` should keep
    // OrpheusSingsAgain02 ("I think I've found my voice again, at
    // last.") because Orpheus is the owner, the phrase matches
    // contiguously, and ``hated`` is not in the line.
    const q = {
        ..._q([]),
        positive: ['my', 'voice'],
        phrases: ['my voice'],
        speakers: ['orpheus'],
        negative: ['hated'],
    };
    const matches = searchTextLines(q, new Set(), 50);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].entry.name, 'OrpheusSingsAgain02');
});

// ---- Asymmetric filter semantics: prefix-token positive, exact-token negative ----
//
// Substring matching turned ``-speaker:A`` into a corpus-wiping
// accident (every name containing the letter 'a' got excluded).
// The fix is asymmetric: positive filters still tolerate partial
// input via prefix-token matching, but negative filters require
// exact equality against a token or a full identifier so the
// destructive operator stays precise.

test('searchTextLines: positive speaker: matches by prefix of any token', () => {
    // ``orph`` is a prefix of the token ``orpheus`` in
    // OrpheusSingsAgain02's owner haystack. Forgiving prefix
    // semantics let the user filter without typing the full name.
    const q = { ..._q(['voice']), speakers: ['orph'] };
    const matches = searchTextLines(q, new Set(), 50);
    assert.ok(matches.some((m) => m.entry.name === 'OrpheusSingsAgain02'));
});

test('searchTextLines: positive speaker: also matches an exact full identifier (e.g. NPC_Zeus_01)', () => {
    // ``NPC_Zeus_01`` doesn't tokenise into a single token but
    // the whole lowercased id matches via the full-identifier arm.
    const q = { ..._q(['knew']), speakers: ['npc_zeus_01'] };
    const matches = searchTextLines(q, new Set(), 50);
    assert.ok(matches.some((m) => m.entry.name === 'ZeusWithAphrodite01'));
});

test('searchTextLines: negative -speaker:A does NOT exclude names just containing the letter A', () => {
    // Regression guard for the substring-matching bug: a single
    // letter as a negative filter must match no tokens (none of
    // the fixture's tokens are literally ``a``), so all candidates
    // survive.
    const q = { ..._q(['you']), negativeSpeakers: ['a'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    // ZeusWithAphrodite01 ("you would seek me out"),
    // AphroditeWithZeus01 ("see you again"), AchillesAboutThanatos01
    // ("want you to know") all carry an 'a' in their owner names -
    // all must survive under the strict-token rule.
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('AphroditeWithZeus01'));
    assert.ok(names.includes('AchillesAboutThanatos01'));
});

test('searchTextLines: negative -speaker:zeu (prefix) also does NOT exclude Zeus (strict equality required)', () => {
    // Exclusion is strict: a prefix that doesn't equal a full
    // token must not trigger removal. Users wanting to drop Zeus
    // need ``-speaker:zeus`` or ``-speaker:NPC_Zeus_01``.
    const q = { ..._q(['knew']), negativeSpeakers: ['zeu'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: negative -speaker:zeus (exact token) excludes Zeus', () => {
    const q = { ..._q(['knew']), negativeSpeakers: ['zeus'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: negative -speaker:NPC_Zeus_01 (full identifier) also excludes Zeus', () => {
    const q = { ..._q(['knew']), negativeSpeakers: ['npc_zeus_01'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: positive section:gif matches Gift via prefix-token', () => {
    const q = { ..._q(['knew']), sections: ['gif'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(!names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: negative -section:gif (prefix only) does NOT exclude Gift (strict equality required)', () => {
    const q = { ..._q(['knew']), negativeSections: ['gif'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
});

test('searchTextLines: negative -section:Gift (exact token) excludes Gift', () => {
    const q = { ..._q(['voice']), negativeSections: ['gift'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchTextLines: negative -section:GiftTextLineSets (full internal key) also excludes Gift', () => {
    const q = { ..._q(['knew']), negativeSections: ['gifttextlinesets'] };
    const matches = searchTextLines(q, new Set(), 50);
    const names = matches.map((m) => m.entry.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
});
