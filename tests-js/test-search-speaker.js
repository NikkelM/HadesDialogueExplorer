// Tests for the speaker-search ranking module in
// ``templates/viewer/search-speaker.js``. Exercises tokenisation, the
// per-token tier ranker, and the full ``searchSpeakerMatches`` ranker
// against a small fixture so the result-order invariants stay locked.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildSpeakerIndex,
    rankSpeakerToken,
    searchSpeakerMatches,
    tokeniseSpeakerLabel,
    tokeniseSpeakerId,
} from '../templates/viewer/search-speaker.js';
import { parseQuery } from '../templates/viewer/query-parser.js';
import { loadFixtureData } from './fixtures.js';
import { registerLocData, setActiveLang } from '../templates/viewer/data.js';
import { resetSpeakerGroups } from '../templates/viewer/speaker-groups.js';

before(loadFixtureData);

// --- tokenisation -------------------------------------------------

test('tokeniseSpeakerLabel splits on whitespace and bracketed-suffix boundaries', () => {
    assert.deepEqual(tokeniseSpeakerLabel('Megaera (Boss)'), ['megaera', 'boss']);
    assert.deepEqual(tokeniseSpeakerLabel('Lord Hades'), ['lord', 'hades']);
    // Slashes and hyphens count as boundaries (e.g. Chronos
    // (Reformed) / fake-name disambiguators).
    assert.deepEqual(tokeniseSpeakerLabel('Hades/Underworld'), ['hades', 'underworld']);
    assert.deepEqual(tokeniseSpeakerLabel(''), []);
    assert.deepEqual(tokeniseSpeakerLabel(null), []);
});

test('tokeniseSpeakerId splits on underscores / non-word characters but keeps PascalCase intact', () => {
    assert.deepEqual(tokeniseSpeakerId('NPC_Zeus_01'), ['npc', 'zeus', '01']);
    assert.deepEqual(tokeniseSpeakerId('NPC_FurySister_01'), ['npc', 'furysister', '01']);
    // No PascalCase splitting - the FurySister token stays whole so
    // the substring matcher handles ``fury`` mid-typing.
    assert.equal(tokeniseSpeakerId('NPC_FurySister_01').includes('fury'), false);
    assert.deepEqual(tokeniseSpeakerId(''), []);
});

// --- rankSpeakerToken ---------------------------------------------

test('rankSpeakerToken returns the canonical tier (0..4) and -1 on no match', () => {
    buildSpeakerIndex();
    const speaker = {
        id: 'NPC_FurySister_01',
        friendly: 'Megaera (Boss)',
        friendlyLower: 'megaera (boss)',
        idLower: 'npc_furysister_01',
        tokens: new Set(['megaera', 'boss', 'npc', 'furysister', '01']),
    };
    // Tier 0: prefix of friendly name.
    assert.equal(rankSpeakerToken('meg', speaker), 0);
    // Tier 1: prefix of internal id (skips friendly because the
    // friendly doesn't start with ``npc``).
    assert.equal(rankSpeakerToken('npc', speaker), 1);
    // Tier 2: matches a tokenised friendly word (boss is a token).
    assert.equal(rankSpeakerToken('boss', speaker), 2);
    // Tier 3: substring of friendly but neither a prefix nor a
    // standalone token (``ssss`` doesn't occur but ``aer`` does
    // mid-token).
    assert.equal(rankSpeakerToken('aer', speaker), 3);
    // Tier 4: substring of id only.
    assert.equal(rankSpeakerToken('sister', speaker), 4);
    // No match anywhere.
    assert.equal(rankSpeakerToken('xyzzy', speaker), -1);
});

// --- searchSpeakerMatches -----------------------------------------

test('searchSpeakerMatches ranks prefix-of-friendly above substring-of-id', () => {
    const matches = searchSpeakerMatches(parseQuery('zeus'), 10);
    // Zeus must come first - friendly name starts with the query
    // token; no other fixture speaker has a friendly starting with
    // ``zeus``.
    assert.equal(matches[0].id, 'NPC_Zeus_01');
});

test('searchSpeakerMatches respects positive-token AND semantics', () => {
    // No fixture speaker has both ``zeus`` and ``aphrodite`` in
    // any indexed identifier, so the conjunction returns no rows.
    const matches = searchSpeakerMatches(parseQuery('zeus aphrodite'), 10);
    assert.deepEqual(matches, []);
});

test('searchSpeakerMatches honours the limit argument', () => {
    // Bare ``npc`` matches every NPC_<name>_01 internal id in the
    // fixture - capping the limit must trim accordingly.
    const all = searchSpeakerMatches(parseQuery('npc'), 100);
    assert.ok(all.length >= 3, 'fixture should expose at least three NPC speakers');
    const limited = searchSpeakerMatches(parseQuery('npc'), 2);
    assert.equal(limited.length, 2);
});

test('searchSpeakerMatches honours -speaker negative filters via exact-token match', () => {
    // Positive ``npc`` returns multiple speakers; the negative
    // filter must drop the Zeus row by exact-token match.
    const positive = searchSpeakerMatches(parseQuery('npc'), 100);
    assert.ok(positive.some((m) => m.id === 'NPC_Zeus_01'));
    const filtered = searchSpeakerMatches(parseQuery('npc -speaker:zeus'), 100);
    assert.equal(filtered.some((m) => m.id === 'NPC_Zeus_01'), false);
    // Other speakers still survive.
    assert.ok(filtered.length > 0);
});

test('a speaker stays findable by its English name (and speaker: filter) under a non-English language', () => {
    loadFixtureData();
    // Rename Zeus in the live overlay to a non-Latin name so "zeus" is NOT a
    // substring of the localised label (guards against a false pass).
    registerLocData('hades1', 'de', { text: {}, speakers: { NPC_Zeus_01: { name: '\u0417\u0435\u0432\u0441' } } }); // Зевс
    setActiveLang('de');
    resetSpeakerGroups();
    buildSpeakerIndex();
    // The overlay is live (guards against a silent no-op false pass).
    const byLoc = searchSpeakerMatches(parseQuery('\u0417\u0435\u0432\u0441'), 5);
    assert.ok(byLoc.some((m) => m.id === 'NPC_Zeus_01'), 'expected to find Zeus by its localised name');
    // Regression: the English base tokens are folded, so Zeus stays findable by
    // its English name (and via the speaker: filter) under German.
    const byEn = searchSpeakerMatches(parseQuery('zeus'), 5);
    assert.ok(byEn.some((m) => m.id === 'NPC_Zeus_01'), 'Zeus must stay findable by its English name under German');
    const byFilter = searchSpeakerMatches(parseQuery('npc speaker:zeus'), 100);
    assert.ok(byFilter.some((m) => m.id === 'NPC_Zeus_01'), 'speaker:zeus must still match under German');
    setActiveLang('en'); // restore for later tests
    resetSpeakerGroups();
    buildSpeakerIndex();
});

test('searchSpeakerMatches passes a filter-only query through every speaker', () => {
    // No positive tokens; only a positive ``speaker:`` filter.
    // Every speaker matching the filter survives and the
    // result is sorted by id (the fall-through ordering).
    const matches = searchSpeakerMatches(parseQuery('speaker:zeus'), 100);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, 'NPC_Zeus_01');
});

test('searchSpeakerMatches drops speakers when a negative token hits friendly or id', () => {
    const matches = searchSpeakerMatches(parseQuery('npc -zeus'), 100);
    assert.equal(matches.some((m) => m.id === 'NPC_Zeus_01'), false);
});

test('searchSpeakerMatches returns one row per group of same-name speakers', async (t) => {
    // Load a tiny fixture with two same-name Hermes speakers + a
    // singleton, then reset the speaker-groups cache so the index
    // rebuild sees the new data. After the rebuild, searching for
    // ``hermes`` must surface exactly ONE row (the canonical id) -
    // not two - because the speaker-search index is keyed on the
    // canonical id per group.
    const { loadData } = await import('../templates/viewer/data.js');
    const { resetSpeakerGroups } = await import('../templates/viewer/speaker-groups.js');
    loadData({
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades' },
        games: {
            hades1: {
                speakers: {
                    NPC_Hermes_01: { name: 'Hermes', description: 'Courier' },
                    HermesUpgrade: { name: 'Hermes', description: '' },
                    NPC_Zeus_01: { name: 'Zeus', description: 'King' },
                },
                textlines: {},
                dependents: {},
                stats: {},
                knownUnresolved: {},
                reqTypeLabels: {},
                reqTypeTooltips: {},
                reqTypeLabelsDependents: {},
                reqTypeTooltipsDependents: {},
                reqTypeOrder: [],
                otherReqTypeLabels: {},
                sectionKeyLabels: {},
                gameDataRefs: {},
                choiceNames: {},
                metaUpgradeNames: {},
            },
        },
    });
    resetSpeakerGroups();
    buildSpeakerIndex();
    const hermesMatches = searchSpeakerMatches(parseQuery('hermes'), 100);
    assert.equal(hermesMatches.length, 1, 'collapsed Hermes group must surface a single row');
    // The surviving row is the canonical id (alphabetically first).
    assert.equal(hermesMatches[0].id, 'HermesUpgrade');

    // Searching by tokens from EITHER member id still resolves to
    // the same one canonical row. ``hermesupgrade`` is the canonical
    // id; ``npc hermes`` are word-boundary tokens from the
    // non-canonical member id - both must hit only the Hermes group
    // (not the Zeus singleton, which has ``npc`` but not ``hermes``).
    const byCanonical = searchSpeakerMatches(parseQuery('hermesupgrade'), 100);
    assert.equal(byCanonical.length, 1);
    assert.equal(byCanonical[0].id, 'HermesUpgrade');
    const byMemberTokens = searchSpeakerMatches(parseQuery('npc hermes'), 100);
    assert.equal(byMemberTokens.length, 1);
    assert.equal(byMemberTokens[0].id, 'HermesUpgrade');

    // Restore the shared fixture for downstream tests in case test
    // order changes; the original ``before`` ran loadFixtureData.
    const { loadFixtureData } = await import('./fixtures.js');
    loadFixtureData();
    t.diagnostic('fixture restored');
});
