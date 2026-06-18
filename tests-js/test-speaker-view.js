// Tests for the speaker overview view renderer in
// ``templates/viewer/speaker-view.js``. Covers the URL canonicalisers
// for the two view-specific keys (``priority`` filter + ``sort`` axis)
// plus the ``renderSpeaker`` output across the three sort axes and the
// priority filter buckets.
//
// ``renderSpeaker`` writes its HTML into
// ``document.getElementById('info-content').innerHTML``, so a minimal
// DOM stub (same shape as ``test-info-panel.js``) is installed on
// ``globalThis`` here. Each test captures the most recent rendered
// markup off the ``lastHtml`` module-level let via the ``render``
// helper.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    renderSpeaker,
    canonicalisePriority,
    canonicaliseSort,
} from '../templates/viewer/speaker-view.js';
import { loadData } from '../templates/viewer/data.js';
import { resetSpeakerGroups } from '../templates/viewer/speaker-groups.js';
import { buildFixtureData, loadFixtureData } from './fixtures.js';

let lastHtml = '';

globalThis.document = {
    getElementById(id) {
        if (id === 'info-content') {
            return {
                set innerHTML(v) { lastHtml = v; },
                get innerHTML() { return lastHtml; },
            };
        }
        return null;
    },
};

// Build a small dataset with three speakers wired up with the
// aggregate fields the Python pass emits. Keeps the inputs explicit so
// each assertion can be read against the seeded values directly.
function buildSpeakerFixture() {
    const base = buildFixtureData();
    return {
        ...base,
        speakers: {
            ...base.speakers,
            NPC_Zeus_01: {
                name: 'Zeus',
                description: 'King of the Olympians',
                ownedTextlines: ['ZeusWithAphrodite01'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua'],
                sectionCounts: { GiftTextLineSets: 1 },
                priorityCounts: { super: 0, priority: 0, plain: 1 },
                adjacencyUpstream: {},
                adjacencyDownstream: { NPC_Aphrodite_01: 1 },
            },
            NPC_Aphrodite_01: {
                name: 'Aphrodite',
                description: 'Goddess of Love',
                ownedTextlines: ['AphroditeWithZeus01'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua'],
                sectionCounts: { GiftTextLineSets: 1 },
                priorityCounts: { super: 0, priority: 1, plain: 0 },
                adjacencyUpstream: { NPC_Zeus_01: 1 },
                adjacencyDownstream: {},
            },
            NPC_Orpheus_01: {
                name: 'Orpheus',
                description: 'Court Musician',
                ownedTextlines: ['OrpheusSingsAgain02'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua', 'DeathLoopData.lua'],
                sectionCounts: { InteractTextLineSets: 1 },
                priorityCounts: { super: 1, priority: 0, plain: 0 },
                adjacencyUpstream: {},
                adjacencyDownstream: {},
            },
        },
    };
}

// Wrap renderSpeaker so the call's captured HTML comes back via the
// return value - lets each test read the markup like a normal pure
// function and reset the buffer in one place.
function render(speakerId, opts) {
    lastHtml = '';
    renderSpeaker(speakerId, opts);
    return lastHtml;
}

before(loadFixtureData);
beforeEach(() => {
    loadData(buildSpeakerFixture());
    resetSpeakerGroups();
    lastHtml = '';
});

// --- canonicalisers -----------------------------------------------

test('canonicalisePriority maps known values through and defaults unknowns to "all"', () => {
    assert.equal(canonicalisePriority('all'), 'all');
    assert.equal(canonicalisePriority('super'), 'super');
    assert.equal(canonicalisePriority('priority'), 'priority');
    assert.equal(canonicalisePriority('plain'), 'plain');
    // Garbage input round-trips to the default so a malformed URL
    // never strands the view.
    assert.equal(canonicalisePriority(''), 'all');
    assert.equal(canonicalisePriority(null), 'all');
    assert.equal(canonicalisePriority(undefined), 'all');
    assert.equal(canonicalisePriority('nonsense'), 'all');
});

test('canonicaliseSort maps known values through and defaults unknowns to "section"', () => {
    assert.equal(canonicaliseSort('section'), 'section');
    assert.equal(canonicaliseSort('tier'), 'tier');
    assert.equal(canonicaliseSort('name'), 'name');
    assert.equal(canonicaliseSort(''), 'section');
    assert.equal(canonicaliseSort(null), 'section');
    assert.equal(canonicaliseSort(undefined), 'section');
    assert.equal(canonicaliseSort('alphabetic'), 'section');
});

// --- renderSpeaker -------------------------------------------------

test('renderSpeaker emits an unknown-speaker banner for an unregistered id', () => {
    const html = render('NPC_NotARealSpeaker_99', { priority: 'all', sort: 'section' });
    assert.match(html, /speaker-overview-missing/);
    assert.match(html, /Unknown speaker/);
    assert.match(html, /NPC_NotARealSpeaker_99/);
});

test('renderSpeaker renders header, summary counts, adjacency, and the textline list', () => {
    const html = render('NPC_Zeus_01', { priority: 'all', sort: 'section' });

    // Friendly name + internal id appear in the header strip.
    assert.match(html, /Zeus/);
    assert.match(html, /NPC_Zeus_01/);
    // Owned + guest-speaker totals.
    assert.match(html, /Owned/);
    assert.match(html, /As guest speaker/);
    // The single owned textline appears as a clickable link.
    assert.match(html, /navigateTo\(&quot;ZeusWithAphrodite01&quot;\)/);
    // Downstream adjacency row links to Aphrodite (the dependent
    // speaker in the fixture) via the speaker-jump handler.
    assert.match(html, /navigateToSpeaker\(&quot;NPC_Aphrodite_01&quot;\)/);
});

test('renderSpeaker multi-member group header lists every member id', () => {
    // Two Hermes-named speakers should collapse into one group; the
    // header lists both internal ids under the friendly name.
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Hermes_01 = {
        name: 'Hermes',
        description: 'Courier of the Gods',
        ownedTextlines: ['HermesCourier01'],
        asSpeakerTextlines: [],
        sourceFiles: ['NPCData.lua'],
        sectionCounts: { InteractTextLineSets: 1 },
        priorityCounts: { super: 0, priority: 0, plain: 1 },
    };
    fixture.speakers.HermesUpgrade = {
        name: 'Hermes',
        description: '',
        ownedTextlines: ['HermesGifted01'],
        asSpeakerTextlines: [],
        sourceFiles: ['LootData.lua'],
        sectionCounts: { GiftTextLineSets: 1 },
        priorityCounts: { super: 1, priority: 0, plain: 0 },
    };
    fixture.textlines.HermesCourier01 = {
        owner: 'NPC_Hermes_01',
        section: 'InteractTextLineSets',
        dialogueLines: [],
        requirements: {},
    };
    fixture.textlines.HermesGifted01 = {
        owner: 'HermesUpgrade',
        section: 'GiftTextLineSets',
        dialogueLines: [],
        requirements: {},
    };
    loadData(fixture);
    resetSpeakerGroups();
    // Drill into either member id - same canonical group.
    const html = render('NPC_Hermes_01', { priority: 'all', sort: 'section' });
    // The friendly name appears once as the h3 title.
    assert.match(html, /<h3>Hermes<\/h3>/);
    // The multi-member id row lists both internal ids with the
    // "Internal ids (2):" prefix and a code chip per id.
    assert.match(html, /Internal ids \(2\)/);
    assert.match(html, /<code>HermesUpgrade<\/code>/);
    assert.match(html, /<code>NPC_Hermes_01<\/code>/);
    // Both owned textlines surface in the textline list.
    assert.match(html, /HermesCourier01/);
    assert.match(html, /HermesGifted01/);
});

test('renderSpeaker drilling into a non-canonical member id resolves to the same group', () => {
    // Same fixture as above; drill in via the canonical (alphabetically
    // first) member instead and verify the rendered HTML is identical
    // to the non-canonical entry point.
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Hermes_01 = {
        name: 'Hermes',
        description: 'Courier',
        ownedTextlines: ['HermesCourier01'],
        asSpeakerTextlines: [],
        sourceFiles: ['NPCData.lua'],
        sectionCounts: {},
        priorityCounts: { super: 0, priority: 0, plain: 1 },
    };
    fixture.speakers.HermesUpgrade = {
        name: 'Hermes',
        description: '',
        ownedTextlines: ['HermesGifted01'],
        asSpeakerTextlines: [],
        sourceFiles: ['LootData.lua'],
        sectionCounts: {},
        priorityCounts: { super: 0, priority: 0, plain: 1 },
    };
    fixture.textlines.HermesCourier01 = {
        owner: 'NPC_Hermes_01', section: 'InteractTextLineSets', dialogueLines: [], requirements: {},
    };
    fixture.textlines.HermesGifted01 = {
        owner: 'HermesUpgrade', section: 'GiftTextLineSets', dialogueLines: [], requirements: {},
    };
    loadData(fixture);
    resetSpeakerGroups();
    const viaMember = render('NPC_Hermes_01', { priority: 'all', sort: 'section' });
    const viaCanonical = render('HermesUpgrade', { priority: 'all', sort: 'section' });
    assert.equal(viaMember, viaCanonical);
});

test('renderSpeaker priority chips reflect the active filter via is-active', () => {
    const html = render('NPC_Aphrodite_01', { priority: 'priority', sort: 'section' });
    assert.match(
        html,
        /<button[^>]*class="priority-chip is-active"[^>]*aria-pressed="true"[^>]*>Priority/,
    );
    // The other chips are inactive.
    assert.match(
        html,
        /<button[^>]*class="priority-chip"[^>]*aria-pressed="false"[^>]*>All/,
    );
});

test('renderSpeaker priority filter drops textlines that fall outside the bucket', () => {
    // Zeus's only owned textline is in the ``plain`` bucket so the
    // ``super`` filter empties the list.
    const html = render('NPC_Zeus_01', { priority: 'super', sort: 'section' });
    assert.match(html, /speaker-textlines-empty/);
    assert.match(html, /No textlines match the current filter/);
    // The textline-row link must NOT appear because the row was
    // filtered out.
    assert.equal(html.includes('class="textline-link"'), false);
});

test('renderSpeaker priority="priority" keeps super textlines visible (OR semantics)', () => {
    // Orpheus's single textline is ``super``; filtering on
    // ``priority`` (= super OR priority) must keep it visible.
    const html = render('NPC_Orpheus_01', { priority: 'priority', sort: 'section' });
    assert.match(html, /navigateTo\(&quot;OrpheusSingsAgain02&quot;\)/);
    assert.doesNotMatch(html, /speaker-textlines-empty/);
});

test('renderSpeaker sort="tier" groups by Super/Priority/Plain headers', () => {
    // Pull all three speakers into a single owned list by reseating
    // ownership on one speaker - exercises the tier-grouping branch
    // with one row per bucket.
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'OrpheusSingsAgain02',     // super
        'AphroditeWithZeus01',     // priority
        'ZeusWithAphrodite01',     // plain
    ];
    fixture.speakers.NPC_Zeus_01.priorityCounts = { super: 1, priority: 1, plain: 1 };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all', sort: 'tier' });

    // All three tier headers appear, in canonical super -> priority
    // -> plain order.
    const superIdx = html.indexOf('speaker-tier-super');
    const priorityIdx = html.indexOf('speaker-tier-priority');
    const plainIdx = html.indexOf('speaker-tier-plain');
    assert.ok(superIdx >= 0 && priorityIdx > superIdx && plainIdx > priorityIdx,
        'Tier headers must render in super -> priority -> plain order');
});

test('renderSpeaker sort="name" renders a flat alphabetical list (no section/tier headers)', () => {
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'OrpheusSingsAgain02',
        'AphroditeWithZeus01',
        'ZeusWithAphrodite01',
    ];
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all', sort: 'name' });

    // No grouping wrappers (sort=name renders a single flat ul).
    assert.doesNotMatch(html, /speaker-textline-group/);
    // Alphabetical order: Aphrodite -> Orpheus -> Zeus.
    const aIdx = html.indexOf('AphroditeWithZeus01');
    const oIdx = html.indexOf('OrpheusSingsAgain02');
    const zIdx = html.indexOf('ZeusWithAphrodite01');
    assert.ok(aIdx >= 0 && oIdx > aIdx && zIdx > oIdx,
        'sort=name should produce alphabetical order');
});

test('renderSpeaker active sort chip carries is-active + aria-pressed', () => {
    const html = render('NPC_Zeus_01', { priority: 'all', sort: 'tier' });
    assert.match(html, /<button[^>]*class="sort-chip is-active"[^>]*aria-pressed="true"[^>]*>Tier/);
    assert.match(html, /<button[^>]*class="sort-chip"[^>]*aria-pressed="false"[^>]*>Section/);
});

// --- per-game priority scheme -------------------------------------

// Build a minimal H2 dataset. H2's filter dimension is repeatability:
// dialogues are play-once or repeatable (the ``playOnce`` flag). Within a
// section they play in narrative-rank order (``narrativePriorityOrdinal``),
// rank 1 first, with rank-less repeatables sorting last.
function loadH2Fixture() {
    const speakers = {
        NPC_Hermes_01: {
            name: 'Hermes',
            description: 'Courier of the Gods',
            // Listed out of rank order so the section sort has work to do.
            ownedTextlines: ['HermesAbout02', 'HermesAbout01', 'HermesRepeatable01'],
            asSpeakerTextlines: [],
            sourceFiles: ['NPCData_Hermes.lua'],
            sectionCounts: { InteractTextLineSets: 3 },
            // Ordinal-based priorityCounts are ignored on H2 now (the
            // chips count play-once vs repeatable client-side), but the
            // field is kept to mirror the real data shape.
            priorityCounts: { super: 0, priority: 2, plain: 1 },
            adjacencyUpstream: {},
            adjacencyDownstream: {},
        },
    };
    const textlines = {
        HermesAbout02: {
            owner: 'NPC_Hermes_01',
            section: 'InteractTextLineSets',
            dialogueLines: [],
            requirements: {},
            playOnce: true,
            narrativePriorityOrdinal: 2,
            narrativePrioritySectionSize: 2,
        },
        HermesAbout01: {
            owner: 'NPC_Hermes_01',
            section: 'InteractTextLineSets',
            dialogueLines: [],
            requirements: {},
            playOnce: true,
            narrativePriorityOrdinal: 1,
            narrativePrioritySectionSize: 2,
        },
        HermesRepeatable01: {
            owner: 'NPC_Hermes_01',
            section: 'InteractTextLineSets',
            dialogueLines: [],
            requirements: {},
        },
    };
    loadData({
        games: {
            hades2: {
                textlines,
                speakers,
                dependents: {},
                stats: {},
                knownUnresolved: {},
                reqTypeLabels: {},
                reqTypeEdgeLabels: {},
                reqTypeTooltips: {},
                reqTypeOrder: [],
                sectionKeyLabels: { InteractTextLineSets: 'Interact dialogue' },
            },
        },
        gameLabels: { hades2: 'Hades II' },
        defaultGame: 'hades2',
    });
    resetSpeakerGroups();
}

test('canonicalisePriority("super", "hades2") collapses to "all" since H2 has no super bucket', () => {
    assert.equal(canonicalisePriority('super', 'hades2'), 'all');
    assert.equal(canonicalisePriority('priority', 'hades2'), 'priority');
    assert.equal(canonicalisePriority('plain', 'hades2'), 'plain');
    assert.equal(canonicalisePriority('all', 'hades2'), 'all');
    // H1 scheme still accepts super when the game arg is explicit.
    assert.equal(canonicalisePriority('super', 'hades1'), 'super');
});

test('renderSpeaker on H2 renders three chips (All / Play-once / Repeatable), no Super chip', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'all', sort: 'section' });
    // Three chips render; the labels are the H2 repeatability vocabulary,
    // with play-once/repeatable counts derived client-side.
    assert.match(html, /<button[^>]*class="priority-chip is-active"[^>]*>All: <span class="speaker-count">3<\/span>/);
    assert.match(html, /<button[^>]*class="priority-chip"[^>]*>Play-once: <span class="speaker-count">2<\/span>/);
    assert.match(html, /<button[^>]*class="priority-chip"[^>]*>Repeatable: <span class="speaker-count">1<\/span>/);
    // No "Super-priority" chip / label on H2, and the old vocabulary is gone.
    assert.doesNotMatch(html, /Super-priority/);
    assert.doesNotMatch(html, />Ranked:/);
    assert.doesNotMatch(html, />Unranked:/);
    // Exactly three priority chips total.
    const chipMatches = html.match(/class="priority-chip[^"]*"/g) || [];
    assert.equal(chipMatches.length, 3);
});

test('renderSpeaker on H2 tier-sort headers use Play-once / Repeatable', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'all', sort: 'tier' });
    // Tier-sort groups by the same repeatability dimension as the filter.
    assert.match(html, /speaker-tier-header speaker-tier-priority[^>]*>Play-once/);
    assert.match(html, /speaker-tier-header speaker-tier-plain[^>]*>Repeatable/);
    // Should not surface the old ranked/unranked or H1 wording.
    assert.doesNotMatch(html, />Ranked </);
    assert.doesNotMatch(html, />Unranked </);
});

test('renderSpeaker on H2 Play-once filter shows only play-once dialogues', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'priority', sort: 'section' });
    assert.match(html, /HermesAbout01/);
    assert.match(html, /HermesAbout02/);
    assert.doesNotMatch(html, /HermesRepeatable01/);
});

test('renderSpeaker on H2 Repeatable filter shows only repeatable dialogues', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'plain', sort: 'section' });
    assert.match(html, /HermesRepeatable01/);
    assert.doesNotMatch(html, /HermesAbout0/);
});

test('renderSpeaker on H2 section-sort orders by narrative rank, repeatables last', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'all', sort: 'section' });
    const iRank1 = html.indexOf('HermesAbout01');
    const iRank2 = html.indexOf('HermesAbout02');
    const iRepeat = html.indexOf('HermesRepeatable01');
    assert.ok(iRank1 >= 0 && iRank2 >= 0 && iRepeat >= 0, 'all rows render');
    assert.ok(iRank1 < iRank2, 'rank 1 sorts before rank 2');
    assert.ok(iRank2 < iRepeat, 'ranked dialogues sort before the rank-less repeatable');
});

test('renderSpeaker on H2 priority=super filter collapses to all (URL-safety)', () => {
    // When ``super`` is passed against the H2 scheme it canonicalises
    // to ``all``, so the textline list shows every row rather than an
    // empty state. This is the URL-safety contract: a stale ``super``
    // bucket from a copy-pasted H1 URL must not strand a H2 viewer.
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'super', sort: 'section' });
    assert.match(html, /HermesAbout01/);
    assert.match(html, /HermesRepeatable01/);
    // The All chip is the active one (since super collapses to all).
    assert.match(html, /<button[^>]*class="priority-chip is-active"[^>]*>All:/);
});
