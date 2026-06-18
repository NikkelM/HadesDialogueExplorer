// Tests for the speaker overview view renderer in
// ``templates/viewer/speaker-view.js``. Covers the ``priority``
// (repeatability) filter canonicaliser plus the ``renderSpeaker``
// output: section grouping, within-section play-order sort, and the
// Play-once / Repeatable filter buckets across both games.
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

test('canonicalisePriority maps known buckets through and defaults unknowns to "all"', () => {
    assert.equal(canonicalisePriority('all'), 'all');
    assert.equal(canonicalisePriority('priority'), 'priority');
    assert.equal(canonicalisePriority('plain'), 'plain');
    // ``super`` is not part of the repeatability scheme, so a stale
    // pre-rework URL collapses to the default rather than stranding the
    // view.
    assert.equal(canonicalisePriority('super'), 'all');
    // Garbage input round-trips to the default too.
    assert.equal(canonicalisePriority(''), 'all');
    assert.equal(canonicalisePriority(null), 'all');
    assert.equal(canonicalisePriority(undefined), 'all');
    assert.equal(canonicalisePriority('nonsense'), 'all');
});

// --- renderSpeaker -------------------------------------------------

test('renderSpeaker emits an unknown-speaker banner for an unregistered id', () => {
    const html = render('NPC_NotARealSpeaker_99', { priority: 'all' });
    assert.match(html, /speaker-overview-missing/);
    assert.match(html, /Unknown speaker/);
    assert.match(html, /NPC_NotARealSpeaker_99/);
});

test('renderSpeaker renders header, summary counts, adjacency, and the textline list', () => {
    const html = render('NPC_Zeus_01', { priority: 'all' });

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
    const html = render('NPC_Hermes_01', { priority: 'all' });
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
    const viaMember = render('NPC_Hermes_01', { priority: 'all' });
    const viaCanonical = render('HermesUpgrade', { priority: 'all' });
    assert.equal(viaMember, viaCanonical);
});

test('renderSpeaker priority chips reflect the active filter via is-active', () => {
    const html = render('NPC_Aphrodite_01', { priority: 'priority' });
    assert.match(
        html,
        /<button[^>]*class="priority-chip is-active"[^>]*aria-pressed="true"[^>]*>Play-once/,
    );
    // The other chips are inactive.
    assert.match(
        html,
        /<button[^>]*class="priority-chip"[^>]*aria-pressed="false"[^>]*>All/,
    );
});

test('renderSpeaker on H1 renders three repeatability chips (All / Play-once / Repeatable)', () => {
    const fixture = buildSpeakerFixture();
    // One play-once (Orpheus) + one repeatable (Zeus) line.
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'OrpheusSingsAgain02',  // playOnce: true
        'ZeusWithAphrodite01',  // playOnce: false
    ];
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });
    assert.match(html, /<button[^>]*class="priority-chip is-active"[^>]*>All: <span class="speaker-count">2<\/span>/);
    assert.match(html, /<button[^>]*class="priority-chip"[^>]*>Play-once: <span class="speaker-count">1<\/span>/);
    assert.match(html, /<button[^>]*class="priority-chip"[^>]*>Repeatable: <span class="speaker-count">1<\/span>/);
    // The legacy H1 tier vocabulary is gone.
    assert.doesNotMatch(html, /Super-priority:/);
    assert.doesNotMatch(html, />Priority:/);
    assert.doesNotMatch(html, />Plain:/);
    const chipMatches = html.match(/class="priority-chip[^"]*"/g) || [];
    assert.equal(chipMatches.length, 3);
});

test('renderSpeaker repeatability filter drops textlines that fall outside the bucket', () => {
    // Zeus's only owned textline is repeatable, so the Play-once
    // (``priority``) filter empties the list.
    const html = render('NPC_Zeus_01', { priority: 'priority' });
    assert.match(html, /speaker-textlines-empty/);
    assert.match(html, /No textlines match the current filter/);
    // The textline-row link must NOT appear because the row was
    // filtered out.
    assert.equal(html.includes('class="textline-link"'), false);
});

test('renderSpeaker Play-once filter keeps a play-once textline visible', () => {
    // Orpheus's single textline is play-once; the Play-once filter keeps it.
    const html = render('NPC_Orpheus_01', { priority: 'priority' });
    assert.match(html, /navigateTo\(&quot;OrpheusSingsAgain02&quot;\)/);
    assert.doesNotMatch(html, /speaker-textlines-empty/);
});

test('renderSpeaker on H1 orders within a section by narrative-priority tier', () => {
    // Both lines live in the same section (Gift); the priority-tier line
    // (AphroditeWithZeus01) must sort before the normal-tier one
    // (ZeusWithAphrodite01).
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'ZeusWithAphrodite01',   // tier: normal
        'AphroditeWithZeus01',   // tier: priority
    ];
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });
    const iPriority = html.indexOf('AphroditeWithZeus01');
    const iNormal = html.indexOf('ZeusWithAphrodite01');
    assert.ok(iPriority >= 0 && iNormal >= 0, 'both rows render');
    assert.ok(iPriority < iNormal, 'priority-tier line sorts before the normal-tier line');
});

test('renderSpeaker exposes only a Filter control - no Group/Sort control', () => {
    const fixture = buildSpeakerFixture();
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'OrpheusSingsAgain02',
        'AphroditeWithZeus01',
        'ZeusWithAphrodite01',
    ];
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // The controls strip is just the repeatability filter now.
    assert.match(html, /Filter:/);
    assert.doesNotMatch(html, /Group by:/);
    assert.doesNotMatch(html, /Sort by:/);
    assert.doesNotMatch(html, /class="sort-chip/);
    // Dialogues are always section-grouped.
    assert.match(html, /speaker-textline-group/);
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

test('canonicalisePriority collapses the legacy "super" bucket to "all"', () => {
    // The repeatability scheme is uniform across games and has no
    // ``super`` bucket, so a stale ``super`` from a pre-rework URL
    // collapses to ``all`` on both games.
    assert.equal(canonicalisePriority('super'), 'all');
    assert.equal(canonicalisePriority('priority'), 'priority');
    assert.equal(canonicalisePriority('plain'), 'plain');
    assert.equal(canonicalisePriority('all'), 'all');
});

test('renderSpeaker on H2 renders three chips (All / Play-once / Repeatable), no Super chip', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'all' });
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

test('renderSpeaker on H2 Play-once filter shows only play-once dialogues', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'priority' });
    assert.match(html, /HermesAbout01/);
    assert.match(html, /HermesAbout02/);
    assert.doesNotMatch(html, /HermesRepeatable01/);
});

test('renderSpeaker on H2 Repeatable filter shows only repeatable dialogues', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'plain' });
    assert.match(html, /HermesRepeatable01/);
    assert.doesNotMatch(html, /HermesAbout0/);
});

test('renderSpeaker on H2 orders within a section by narrative rank, repeatables last', () => {
    loadH2Fixture();
    const html = render('NPC_Hermes_01', { priority: 'all' });
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
    const html = render('NPC_Hermes_01', { priority: 'super' });
    assert.match(html, /HermesAbout01/);
    assert.match(html, /HermesRepeatable01/);
    // The All chip is the active one (since super collapses to all).
    assert.match(html, /<button[^>]*class="priority-chip is-active"[^>]*>All:/);
});
