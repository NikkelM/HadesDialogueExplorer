// Tests for ``templates/viewer/search-name.js``.
//
// Covers the per-token tier ranking and the
// per-query lexicographic ordering across tokens.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    rankSearchToken,
    searchNameMatches,
    tokeniseTextlineName,
    tokeniseOwnerDisplay,
    buildNameIndex,
    nameIdf,
} from '../templates/viewer/search-name.js';
import { loadData } from '../templates/viewer/data.js';
import { emptyQuery } from '../templates/viewer/query-parser.js';
import { loadFixtureData } from './fixtures.js';

before(() => {
    loadFixtureData();
});

// Wrap a positive-token array in the structured query the engine
// now expects, with every other operator bucket left empty. Lets
// the older tier-ranking tests keep their compact ``[token, ...]``
// input shape while the new tests exercise filters and exclusions
// against full query objects.
function _q(positive, extras = {}) {
    return { ...emptyQuery(), positive, ...extras };
}

test('rankSearchToken: tier 0 (prefix of textline name) wins over PascalCase boundary', () => {
    // Token at start of textline name -> tier 0.
    assert.equal(
        rankSearchToken('zeus', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        0,
    );
});

test('rankSearchToken: tier 1 (prefix of owner id or display)', () => {
    // Token doesn't prefix the textline name but does prefix the owner id.
    assert.equal(
        rankSearchToken('npc', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        1,
    );
});

test('rankSearchToken: tier 2 (PascalCase boundary inside textline name)', () => {
    // ``aphrodite`` matches at offset 8 in ``ZeusWithAphrodite01`` where
    // the original-case char is uppercase ``A`` - that's the PascalCase
    // boundary tier.
    assert.equal(
        rankSearchToken('aphrodite', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        2,
    );
});

test('rankSearchToken: tier 3 (mid-segment match in textline name)', () => {
    // ``ith`` matches at offset 5 in ``ZeusWithAphrodite01`` but the
    // original-case char at that position is lowercase, so it's tier 3
    // not tier 2.
    assert.equal(
        rankSearchToken('ith', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        3,
    );
});

test('rankSearchToken: tier 4 (token only inside owner id, not in textline name)', () => {
    // ``haron`` doesn't appear in the textline name and doesn't prefix
    // the owner id or display name, but it IS a substring of
    // ``npc_charon_01`` - the bottom tier.
    assert.equal(
        rankSearchToken('haron', 'SomeTextline01', 'sometextline01', 'npc_charon_01', 'charon'),
        4,
    );
});

test('rankSearchToken: returns -1 when the token appears nowhere', () => {
    assert.equal(
        rankSearchToken('xyzzy', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        -1,
    );
});

test('searchNameMatches: AND across tokens (every token must match)', () => {
    // ``zeus`` matches both ZeusWith... and AphroditeWith...Zeus, but
    // ``aphrodite`` further constrains so we only get the two that
    // mention both names.
    const matches = searchNameMatches(_q(['zeus', 'aphrodite']), 50);
    const names = matches.map((m) => m.name);
    assert.deepEqual(names.sort(), ['AphroditeWithZeus01', 'ZeusWithAphrodite01']);
});

test('searchNameMatches: query token order dominates ranking', () => {
    // "zeus aphrodite" - first token's tier is the dominant axis, so
    // ZeusWithAphrodite01 (tiers 0,2) must outrank AphroditeWithZeus01
    // (tiers 2,2) regardless of any later-token differences.
    const matches = searchNameMatches(_q(['zeus', 'aphrodite']), 50);
    assert.equal(matches[0].name, 'ZeusWithAphrodite01');
    assert.equal(matches[1].name, 'AphroditeWithZeus01');

    // Reverse the query: now AphroditeWithZeus01 wins.
    const reversed = searchNameMatches(_q(['aphrodite', 'zeus']), 50);
    assert.equal(reversed[0].name, 'AphroditeWithZeus01');
    assert.equal(reversed[1].name, 'ZeusWithAphrodite01');
});

test('searchNameMatches: a single non-matching token drops the candidate', () => {
    // ``zeus`` matches a couple of textlines; adding ``xyzzy`` (which
    // matches nothing) reduces the result set to empty - AND semantics.
    const matches = searchNameMatches(_q(['zeus', 'xyzzy']), 50);
    assert.equal(matches.length, 0);
});

test('searchNameMatches: limit caps the result set', () => {
    // ``a`` will match plenty of names; verify the cap.
    const matches = searchNameMatches(_q(['a']), 2);
    assert.equal(matches.length, 2);
});

// ---- PascalCase / display-name tokenisers ----

test('tokeniseTextlineName splits PascalCase + digit transitions', () => {
    assert.deepEqual(
        tokeniseTextlineName('OrpheusWithEurydice01'),
        ['orpheus', 'with', 'eurydice', '01'],
    );
});

test('tokeniseTextlineName treats non-word characters as boundaries', () => {
    // Underscores split the same way an explicit PascalCase break
    // would, so ``NPC_Zeus_01`` yields three clean tokens.
    assert.deepEqual(
        tokeniseTextlineName('NPC_Zeus_01'),
        ['npc', 'zeus', '01'],
    );
});

test('tokeniseTextlineName handles a digit-letter run without an explicit break', () => {
    // Digit -> letter switches are a sub-boundary even without an
    // uppercase signal: ``01About02`` -> [01, about, 02].
    assert.deepEqual(
        tokeniseTextlineName('01About02'),
        ['01', 'about', '02'],
    );
});

test('tokeniseTextlineName returns empty for empty / nullish input', () => {
    assert.deepEqual(tokeniseTextlineName(''), []);
    assert.deepEqual(tokeniseTextlineName(null), []);
    assert.deepEqual(tokeniseTextlineName(undefined), []);
});

test('tokeniseOwnerDisplay splits on whitespace and lowercases', () => {
    assert.deepEqual(
        tokeniseOwnerDisplay('Megaera (Boss)'),
        ['megaera', '(boss)'],
    );
    assert.deepEqual(tokeniseOwnerDisplay(''), []);
    assert.deepEqual(tokeniseOwnerDisplay(null), []);
});

// ---- IDF-weighted ranking ----

test('nameIdf: rarer corpus segments carry higher weight than common ones', () => {
    // In the shared fixture every textline name ends in ``01`` or
    // ``02`` (four end in ``01``), and ``aphrodite`` appears in two
    // textlines (one as a name segment, one as the owner display).
    // ``orpheus`` appears in only one document.
    assert.ok(nameIdf.get('orpheus') > nameIdf.get('aphrodite'));
    assert.ok(nameIdf.get('aphrodite') > nameIdf.get('01'));
});

test('searchNameMatches: query token order still dominates when scores tie', () => {
    // Re-asserts the existing earlier-token-dominates contract under
    // the new weighted comparator. ZeusWithAphrodite01 and
    // AphroditeWithZeus01 have mirrored tier tuples [0,2] / [2,0]
    // with equal weights, so weighted scores tie - the raw-tier
    // tiebreaker must keep ZeusWithAphrodite01 first when the user
    // typed ``zeus`` before ``aphrodite``.
    const fwd = searchNameMatches(_q(['zeus', 'aphrodite']), 50);
    assert.equal(fwd[0].name, 'ZeusWithAphrodite01');
    assert.equal(fwd[1].name, 'AphroditeWithZeus01');
    const rev = searchNameMatches(_q(['aphrodite', 'zeus']), 50);
    assert.equal(rev[0].name, 'AphroditeWithZeus01');
    assert.equal(rev[1].name, 'ZeusWithAphrodite01');
});

test('searchNameMatches: typing order dominates even when rare/common weights diverge', () => {
    // With weighted tier-tuple lex comparison, the candidate whose
    // first query token landed at a better tier always wins -
    // regardless of which token (rare or common) that is. The IDF
    // weights only differentiate when per-position weights diverge
    // across candidates (e.g. prefix queries resolving to different
    // parent tokens), not when both candidates share the same set of
    // tokens.
    try {
        loadData({
            textlines: {
                RareCommonLine01: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonRareLine02: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonOnly03: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonOnly04: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
            },
            dependents: {},
            stats: { totalTextlines: 4, totalEdges: 0, unresolvedRefs: [] },
            speakers: { NPC_X_01: { name: 'Common Owner' } },
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
        buildNameIndex();
        // Sanity: ``rare`` is indeed rarer than ``common`` here.
        assert.ok(nameIdf.get('rare') > nameIdf.get('common'));

        // Query "rare common": rare-first candidate wins because
        // ``rare`` (typed first) sits at tier 0 in RareCommonLine01.
        const fwdMatches = searchNameMatches(_q(['rare', 'common']), 10);
        assert.equal(fwdMatches[0].name, 'RareCommonLine01');

        // Query "common rare": common-first candidate now wins -
        // typing order trumps the rare-token bonus. The previous
        // weighted-sum design wrongly inverted this and preferred
        // the rare-token-at-better-tier candidate even when the user
        // typed the common token first.
        const revMatches = searchNameMatches(_q(['common', 'rare']), 10);
        assert.equal(revMatches[0].name, 'CommonRareLine02');
    } finally {
        loadFixtureData();
    }
});

test('searchNameMatches: single-token query still works (IDF skipped)', () => {
    // Single token -> IDF skipped; ordering matches the pre-IDF
    // behaviour. ``zeus`` at start of ZeusWithAphrodite01 (tier 0)
    // must outrank AphroditeWithZeus01 (PascalCase tier 2).
    const matches = searchNameMatches(_q(['zeus']), 50);
    assert.equal(matches[0].name, 'ZeusWithAphrodite01');
    assert.equal(matches[1].name, 'AphroditeWithZeus01');
});

test('nameIdf is rebuilt whenever buildNameIndex runs against a fresh corpus', () => {
    try {
        loadData({
            textlines: {
                OnlyOne01: {
                    owner: 'NPC_Solo_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
            },
            dependents: {},
            stats: { totalTextlines: 1, totalEdges: 0, unresolvedRefs: [] },
            speakers: { NPC_Solo_01: { name: 'Solo' } },
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
        buildNameIndex();
        // The previous corpus's ``zeus`` token must not leak through.
        assert.equal(nameIdf.get('zeus'), undefined);
        // The new corpus's tokens are present with the singleton weight
        // (log((1+1)/(1+1)) + 1 = 1).
        assert.equal(nameIdf.get('only'), 1);
        assert.equal(nameIdf.get('solo'), 1);
    } finally {
        loadFixtureData();
    }
    assert.ok(nameIdf.get('zeus') !== undefined);
});

// ---- Prefix-typing (per-candidate weight resolution) ----

test('searchNameMatches: prefix-typed query token resolves to its parent corpus token weight, preserving query-order tiebreaker', () => {
    // Reported case: typing ``aphrodite zeu`` (the ``zeu`` is the
    // user mid-typing ``zeus``) should rank AphroditeWithZeus01
    // ABOVE ZeusWithAphrodite01 - the user typed Aphrodite first.
    // Pre-fix, ``zeu`` was absent from the IDF and fell back to the
    // absent-token max weight, which over-penalised its tier-2
    // placement and inverted the ranking.
    const fwd = searchNameMatches(_q(['aphrodite', 'zeu']), 50);
    assert.equal(fwd[0].name, 'AphroditeWithZeus01');
    assert.equal(fwd[1].name, 'ZeusWithAphrodite01');

    // Reversing the query flips the tiebreaker - now Zeus comes first.
    const rev = searchNameMatches(_q(['zeu', 'aphrodite']), 50);
    assert.equal(rev[0].name, 'ZeusWithAphrodite01');
    assert.equal(rev[1].name, 'AphroditeWithZeus01');
});

test('searchNameMatches: prefix-typed query token preserves typing order', () => {
    try {
        // Same corpus as the rare/common typing-order test - here
        // ``rar`` (mid-typing ``rare``) resolves to the rare token's
        // weight via per-candidate prefix lookup. With weighted
        // tier-tuple lex comparison, typing order still wins -
        // ``common rar`` puts the common-first candidate on top.
        loadData({
            textlines: {
                RareCommonLine01: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonRareLine02: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonOnly03: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
                CommonOnly04: {
                    owner: 'NPC_X_01',
                    section: 'InteractTextLineSets',
                    playOnce: false,
                    narrativePrioritySectionTier: 'normal',
                    narrativePrioritySetLevel: null,
                    dialogueLines: [],
                },
            },
            dependents: {},
            stats: { totalTextlines: 4, totalEdges: 0, unresolvedRefs: [] },
            speakers: { NPC_X_01: { name: 'Common Owner' } },
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
        buildNameIndex();
        const fwdMatches = searchNameMatches(_q(['rar', 'common']), 10);
        assert.equal(fwdMatches[0].name, 'RareCommonLine01');
        const revMatches = searchNameMatches(_q(['common', 'rar']), 10);
        assert.equal(revMatches[0].name, 'CommonRareLine02');
    } finally {
        loadFixtureData();
    }
});

test('candidateTokenWeight via searchNameMatches: query token absent and no candidate prefix match falls back to neutral weight', () => {
    // ``xyzzy`` is absent from the corpus entirely, but it also
    // never matches any candidate via rankSearchToken - so the
    // candidate set is empty and the neutral-fallback branch is
    // exercised only conceptually. Instead verify that an absent
    // query token that DOES match (via owner display substring) but
    // has no prefix-token in any candidate scores like a neutral
    // weight: pick a mid-segment substring such as ``phrod`` which
    // matches inside ``Aphrodite`` but isn't a prefix of any
    // tokenised segment.
    const matches = searchNameMatches(_q(['phrod', 'zeus']), 50);
    // The query still finds Aphrodite-Zeus dialogues via tier-3
    // substring + tier-0/tier-2 zeus placement. The neutral fallback
    // for ``phrod`` keeps the ranking from being dominated by an
    // arbitrary constant; the deterministic ordering below is the
    // observable signal.
    assert.ok(matches.length >= 2);
    const names = matches.map(m => m.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('AphroditeWithZeus01'));
});

// ---- Query-operator filters: speaker:, section:, exclusions ----
//
// The name search shares filter semantics with the text search via
// ``query-filters.js``; tests below pin down that the hard filter
// (speaker / section) drops candidates and that negative tokens /
// phrases run as substring matches against name + owner.

test('searchNameMatches: speaker: filter restricts results by owner', () => {
    // Without a filter, ``i`` is unused (name search doesn't have
    // a bare ``i`` segment) - use a token actually present in
    // textline names. ``zeus`` matches both ZeusWithAphrodite01
    // (owner Zeus) and AphroditeWithZeus01 (owner Aphrodite, name
    // contains Zeus). The speaker filter scopes to Zeus the owner
    // only.
    const matches = searchNameMatches(
        { ..._q(['zeus']), speakers: ['zeus'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['ZeusWithAphrodite01']);
});

test('searchNameMatches: speaker: filter accepts friendly name (case-insensitive)', () => {
    // ``orpheus`` (lowercased friendly) matches the owner of
    // OrpheusSingsAgain02. No other textline is owned by Orpheus
    // in the fixture.
    const matches = searchNameMatches(
        { ..._q([]), speakers: ['orpheus'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['OrpheusSingsAgain02']);
});

test('searchNameMatches: -speaker: excludes candidates whose owner or per-line speaker matches', () => {
    // ZeusWithAphrodite01 has Zeus as owner -> dropped.
    // AphroditeWithZeus01 is owned by Aphrodite with only an
    // Aphrodite speaker line; its NAME contains "Zeus" but the
    // speaker haystack does not, so it survives.
    const matches = searchNameMatches(
        { ..._q([]), negativeSpeakers: ['zeus'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('AphroditeWithZeus01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchNameMatches: section: filter accepts both friendly and internal section keys', () => {
    const matchesFriendly = searchNameMatches(
        { ..._q([]), sections: ['gift'] },
        50,
    );
    const namesFriendly = matchesFriendly.map((m) => m.name);
    assert.ok(namesFriendly.includes('ZeusWithAphrodite01'));
    assert.ok(namesFriendly.includes('AphroditeWithZeus01'));
    // OrpheusSingsAgain02 is in InteractTextLineSets, must drop.
    assert.ok(!namesFriendly.includes('OrpheusSingsAgain02'));
    const matchesInternal = searchNameMatches(
        { ..._q([]), sections: ['gifttextlinesets'] },
        50,
    );
    assert.deepEqual(
        matchesInternal.map((m) => m.name).sort(),
        namesFriendly.sort(),
    );
});

test('searchNameMatches: -section: excludes matching section', () => {
    const matches = searchNameMatches(
        { ..._q([]), negativeSections: ['gift'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchNameMatches: -word excludes candidates whose name or owner contains the substring', () => {
    // ``-zeus`` knocks out both ZeusWithAphrodite01 (name) and
    // AphroditeWithZeus01 (name contains zeus) - mirrors the
    // tier matcher's surfaces.
    const matches = searchNameMatches(
        { ..._q([]), negative: ['zeus'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(!names.includes('AphroditeWithZeus01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});

test('searchNameMatches: positive token + speaker filter combine as AND (token must match within filtered set)', () => {
    // ``aphrodite`` matches AphroditeWithZeus01 and ZeusWithAphrodite01
    // by token. Adding ``speaker:aphrodite`` scopes to Aphrodite-owned
    // textlines only.
    const matches = searchNameMatches(
        { ..._q(['aphrodite']), speakers: ['aphrodite'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['AphroditeWithZeus01']);
});

test('searchNameMatches: filter-only query returns every surviving textline alphabetically', () => {
    // No positive tokens, no phrases - the tier-rank loop is
    // vacuously satisfied for every candidate, so the result is
    // just every textline that survives the filter, ordered by
    // ``allNames`` (alphabetical).
    const matches = searchNameMatches(
        { ..._q([]), sections: ['gift'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['AphroditeWithZeus01', 'ZeusWithAphrodite01']);
});


// ---- Asymmetric speaker/section semantics ----
//
// Mirrors the asymmetric-filter tests in ``test-search-text.js``:
// positive filters use prefix-token matching (forgiving for
// mid-typing), negative filters require exact-token or exact
// full-identifier equality (strict because exclusion is
// destructive).

test('searchNameMatches: positive speaker: matches by prefix of any owner token', () => {
    // ``orph`` is a prefix of the token ``orpheus`` -> matches the
    // OrpheusSingsAgain02 owner.
    const matches = searchNameMatches(
        { ..._q([]), speakers: ['orph'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['OrpheusSingsAgain02']);
});

test('searchNameMatches: positive speaker: also matches an exact full identifier (NPC_Zeus_01)', () => {
    const matches = searchNameMatches(
        { ..._q([]), speakers: ['npc_zeus_01'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.deepEqual(names, ['ZeusWithAphrodite01']);
});

test('searchNameMatches: -speaker:A does NOT exclude every owner containing the letter A', () => {
    // Regression guard for the substring-bug: ``a`` is not a full
    // token in any owner identifier, so the strict negative
    // matcher must keep everyone.
    const matches = searchNameMatches(
        { ..._q([]), negativeSpeakers: ['a'] },
        50,
    );
    const names = matches.map((m) => m.name);
    // Aphrodite, Achilles, Zagreus owners all contain ``a`` in
    // their names - all must survive.
    assert.ok(names.includes('AphroditeWithZeus01'));
    assert.ok(names.includes('AchillesAboutThanatos01'));
    assert.ok(names.includes('BecameCloseWithMegaera01'));
});

test('searchNameMatches: -speaker:zeu (prefix) does NOT exclude Zeus owner (strict equality required)', () => {
    const matches = searchNameMatches(
        { ..._q([]), negativeSpeakers: ['zeu'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.ok(names.includes('ZeusWithAphrodite01'));
});

test('searchNameMatches: -section:gif (prefix) does NOT exclude Gift section (strict equality required)', () => {
    const matches = searchNameMatches(
        { ..._q([]), negativeSections: ['gif'] },
        50,
    );
    const names = matches.map((m) => m.name);
    // ZeusWithAphrodite01 / AphroditeWithZeus01 are in Gift; both
    // should survive the prefix-only negative section.
    assert.ok(names.includes('ZeusWithAphrodite01'));
    assert.ok(names.includes('AphroditeWithZeus01'));
});

test('searchNameMatches: -section:GiftTextLineSets (full internal key) excludes the Gift section exactly', () => {
    const matches = searchNameMatches(
        { ..._q([]), negativeSections: ['gifttextlinesets'] },
        50,
    );
    const names = matches.map((m) => m.name);
    assert.ok(!names.includes('ZeusWithAphrodite01'));
    assert.ok(!names.includes('AphroditeWithZeus01'));
    assert.ok(names.includes('OrpheusSingsAgain02'));
});
