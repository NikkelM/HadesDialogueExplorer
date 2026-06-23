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
    canonicaliseEligibility,
    toggleSpeakerSection,
    buildAdjacencyDetail,
    renderAdjacencyDetailRows,
} from '../templates/viewer/speaker-view.js';
import { loadData, getActiveGame } from '../templates/viewer/data.js';
import { resetSpeakerGroups } from '../templates/viewer/speaker-groups.js';
import { restoreSaveProgress, clearSaveProgress } from '../templates/viewer/save-parser.js';
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

// Minimal localStorage stub so the save-restore path
// (``restoreSaveProgress``) works under Node. The eligibility tests seed
// a save through it; every other test clears it in ``beforeEach``.
const _localStore = new Map();
globalThis.localStorage = {
    getItem: k => (_localStore.has(k) ? _localStore.get(k) : null),
    setItem: (k, v) => { _localStore.set(k, String(v)); },
    removeItem: k => { _localStore.delete(k); },
};

// Build a small dataset with three speakers wired up with the
// aggregate fields the Python pass emits. Keeps the inputs explicit so
// each assertion can be read against the seeded values directly.
function buildSpeakerFixture() {
    const base = buildFixtureData();
    return {
        ...base,
        textlines: {
            ...base.textlines,
            // Wire the Aphrodite -> Zeus requirement edge (and its mirror
            // dependents entry below) so the speaker view's canonical
            // adjacency re-derive reproduces the cross-speaker links the
            // adjacency tests exercise.
            AphroditeWithZeus01: {
                ...base.textlines.AphroditeWithZeus01,
                requirements: { RequiredTextLines: ['ZeusWithAphrodite01'] },
            },
        },
        dependents: {
            ...base.dependents,
            ZeusWithAphrodite01: ['AphroditeWithZeus01'],
        },
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
            },
            NPC_Aphrodite_01: {
                name: 'Aphrodite',
                description: 'Goddess of Love',
                ownedTextlines: ['AphroditeWithZeus01'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua'],
                sectionCounts: { GiftTextLineSets: 1 },
                priorityCounts: { super: 0, priority: 1, plain: 0 },
            },
            NPC_Orpheus_01: {
                name: 'Orpheus',
                description: 'Court Musician',
                ownedTextlines: ['OrpheusSingsAgain02'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua', 'DeathLoopData.lua'],
                sectionCounts: { InteractTextLineSets: 1 },
                priorityCounts: { super: 1, priority: 0, plain: 0 },
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
    clearSaveProgress();
    _localStore.clear();
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

test('canonicaliseEligibility passes the four save statuses through and defaults the rest to "all"', () => {
    assert.equal(canonicaliseEligibility('played'), 'played');
    assert.equal(canonicaliseEligibility('eligible'), 'eligible');
    assert.equal(canonicaliseEligibility('blocked'), 'blocked');
    assert.equal(canonicaliseEligibility('unobtainable'), 'unobtainable');
    assert.equal(canonicaliseEligibility('all'), 'all');
    assert.equal(canonicaliseEligibility(''), 'all');
    assert.equal(canonicaliseEligibility(null), 'all');
    assert.equal(canonicaliseEligibility(undefined), 'all');
    assert.equal(canonicaliseEligibility('nonsense'), 'all');
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
    // Downstream adjacency row shows Aphrodite (the dependent speaker in
    // the fixture) as a plain label - clicking only expands the row, it
    // no longer navigates to the speaker.
    assert.match(html, /speaker-adjacency-name">Aphrodite<\/span>/);
    assert.doesNotMatch(html, /navigateToSpeaker/);
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
    // Both lines live in the same section (Gift) and are play-once; the
    // priority-tier line (AphroditeWithZeus01) must sort before the
    // normal-tier one (ZeusWithAphrodite01).
    const fixture = buildSpeakerFixture();
    fixture.textlines.AphroditeWithZeus01.playOnce = true;
    fixture.textlines.ZeusWithAphrodite01.playOnce = true;
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

test('renderSpeaker on H1 unites play-once and repeatable into one NPC interaction section, repeatables last', () => {
    const fixture = buildSpeakerFixture();
    fixture.sectionKeyLabels = {
        ...fixture.sectionKeyLabels,
        InteractTextLineSets: 'NPC interaction',
        RepeatableTextLineSets: 'NPC interaction (repeatable)',
    };
    fixture.textlines.ZeusChat01 = { owner: 'NPC_Zeus_01', section: 'InteractTextLineSets', dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'normal' };
    fixture.textlines.ZeusChatRepeat01 = { owner: 'NPC_Zeus_01', section: 'RepeatableTextLineSets', dialogueLines: [], requirements: {} };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = ['ZeusChatRepeat01', 'ZeusChat01'];
    fixture.speakers.NPC_Zeus_01.sectionCounts = { InteractTextLineSets: 3, RepeatableTextLineSets: 4 };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // The repeatable interaction section folds into "NPC interaction"; no
    // separate "(repeatable)" group renders.
    const groupHeaders = html.match(/speaker-textline-group-header/g) || [];
    assert.equal(groupHeaders.length, 1);
    assert.match(html, />NPC interaction</);
    assert.doesNotMatch(html, /\(repeatable\)/);
    // Play-once line first, repeatable fallback after (mirrors H2).
    assert.ok(html.indexOf('ZeusChat01') < html.indexOf('ZeusChatRepeat01'),
        'play-once line precedes the repeatable line within the merged section');
    // Summary collapses to one "NPC interaction" row (3 + 4 = 7).
    const summary = html.slice(html.indexOf('speaker-section-list'));
    assert.match(summary, /NPC interaction<\/span>: <span class="speaker-count">7<\/span>/);
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

test('renderSpeaker section groups are collapsible and collapsed by default', () => {
    const html = render('NPC_Zeus_01', { priority: 'all' });
    // Group renders without the ``expanded`` modifier -> collapsed.
    assert.match(html, /<div class="speaker-textline-group">/);
    assert.doesNotMatch(html, /class="speaker-textline-group expanded"/);
    // Header toggles the group on click and carries a chevron affordance.
    assert.match(html, /speaker-textline-group-header" onclick="toggleSpeakerSection\(this, /);
    assert.match(html, /<span class="speaker-group-chevron">/);
});

test('renderSpeaker keeps an expanded section open across a re-render for the same speaker', () => {
    // A minimal header-element stub: ``toggleSpeakerSection`` flips the
    // ``expanded`` class on ``parentElement`` and records the section key.
    const fakeHeader = () => {
        const set = new Set();
        return { parentElement: { classList: {
            toggle(c) { if (set.has(c)) { set.delete(c); return false; } set.add(c); return true; },
        } } };
    };

    // Fresh render of Zeus: the Gift section is collapsed.
    let html = render('NPC_Zeus_01', { priority: 'all' });
    assert.doesNotMatch(html, /class="speaker-textline-group expanded"/);

    // User expands the Gift section.
    toggleSpeakerSection(fakeHeader(), 'GiftTextLineSets');

    // Re-render the SAME speaker (e.g. after a filter change): the section
    // stays expanded.
    html = render('NPC_Zeus_01', { priority: 'all' });
    assert.match(html, /class="speaker-textline-group expanded"/);

    // Navigating to a DIFFERENT speaker resets the expansion state.
    html = render('NPC_Aphrodite_01', { priority: 'all' });
    assert.doesNotMatch(html, /class="speaker-textline-group expanded"/);
});

test('renderSpeaker groups co-present mutually-exclusive alternates into one cluster', () => {
    const fixture = buildSpeakerFixture();
    fixture.alternates = {
        ZeusAlt01: ['ZeusAlt01_B'],
        ZeusAlt01_B: ['ZeusAlt01'],
    };
    fixture.textlines.ZeusAlt01 = { owner: 'NPC_Zeus_01', section: 'GiftTextLineSets', dialogueLines: [], requirements: {}, playOnce: true };
    fixture.textlines.ZeusAlt01_B = { owner: 'NPC_Zeus_01', section: 'GiftTextLineSets', dialogueLines: [], requirements: {}, playOnce: true };
    fixture.textlines.ZeusSolo01 = { owner: 'NPC_Zeus_01', section: 'GiftTextLineSets', dialogueLines: [], requirements: {}, playOnce: true };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = ['ZeusAlt01', 'ZeusAlt01_B', 'ZeusSolo01'];
    fixture.speakers.NPC_Zeus_01.sectionCounts = { GiftTextLineSets: 3 };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // Exactly one alternates cluster, labelled with the variant count (2).
    assert.equal((html.match(/class="speaker-alt-group"/g) || []).length, 1);
    assert.match(html, /speaker-alt-group-label">Alternates <span class="speaker-count">2<\/span>/);
    // All three lines still render as rows (two inside the cluster, one solo).
    assert.equal((html.match(/class="speaker-textline-row"/g) || []).length, 3);
    // The two variants live inside the cluster's nested list.
    const clusterStart = html.indexOf('speaker-alt-group-rows');
    const clusterEnd = html.indexOf('</ul>', clusterStart);
    const clusterHtml = html.slice(clusterStart, clusterEnd);
    assert.match(clusterHtml, /ZeusAlt01</);
    assert.match(clusterHtml, /ZeusAlt01_B</);
    assert.doesNotMatch(clusterHtml, /ZeusSolo01/);
});

test('renderSpeaker does not cluster a lone alternate whose sibling is absent', () => {
    const fixture = buildSpeakerFixture();
    fixture.alternates = { ZeusAlt01: ['ZeusAlt01_B'], ZeusAlt01_B: ['ZeusAlt01'] };
    fixture.textlines.ZeusAlt01 = { owner: 'NPC_Zeus_01', section: 'GiftTextLineSets', dialogueLines: [], requirements: {}, playOnce: true };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = ['ZeusAlt01'];
    fixture.speakers.NPC_Zeus_01.sectionCounts = { GiftTextLineSets: 1 };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });
    // Sibling not owned -> no cluster, just a normal row.
    assert.doesNotMatch(html, /speaker-alt-group/);
    assert.match(html, /ZeusAlt01</);
});

test('renderSpeaker on H1 merges the three god-boon-pickup sections into one group, ordered by priority', () => {
    const fixture = buildSpeakerFixture();
    fixture.sectionKeyLabels = {
        ...fixture.sectionKeyLabels,
        PickupTextLineSets: 'God boon pickup',
        PriorityPickupTextLineSets: 'God boon pickup',
        SuperPriorityPickupTextLineSets: 'God boon pickup',
    };
    fixture.textlines.ZeusPickupNormal01 = {
        owner: 'NPC_Zeus_01', section: 'PickupTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'normal',
    };
    fixture.textlines.ZeusPickupPriority01 = {
        owner: 'NPC_Zeus_01', section: 'PriorityPickupTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'priority',
    };
    fixture.textlines.ZeusPickupSuper01 = {
        owner: 'NPC_Zeus_01', section: 'SuperPriorityPickupTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'super',
    };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'ZeusPickupNormal01', 'ZeusPickupPriority01', 'ZeusPickupSuper01',
    ];
    fixture.speakers.NPC_Zeus_01.sectionCounts = {
        PickupTextLineSets: 1, PriorityPickupTextLineSets: 1, SuperPriorityPickupTextLineSets: 1,
    };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // The three priority variants collapse to a single grouped section.
    const groupHeaders = html.match(/speaker-textline-group-header/g) || [];
    assert.equal(groupHeaders.length, 1);
    assert.match(html, /God boon pickup/);
    // Within the merged group, super-priority plays first, then priority,
    // then the plain pickup line.
    const iSuper = html.indexOf('ZeusPickupSuper01');
    const iPriority = html.indexOf('ZeusPickupPriority01');
    const iNormal = html.indexOf('ZeusPickupNormal01');
    assert.ok(iSuper >= 0 && iPriority > iSuper && iNormal > iPriority,
        'merged pickup group orders super-priority -> priority -> normal');
});

test('renderSpeaker on H1 sections summary collapses the god-boon-pickup variants into one row', () => {
    const fixture = buildSpeakerFixture();
    fixture.sectionKeyLabels = {
        ...fixture.sectionKeyLabels,
        PickupTextLineSets: 'God boon pickup',
        PriorityPickupTextLineSets: 'God boon pickup',
        SuperPriorityPickupTextLineSets: 'God boon pickup',
    };
    fixture.speakers.NPC_Zeus_01.sectionCounts = {
        PickupTextLineSets: 10, PriorityPickupTextLineSets: 5, SuperPriorityPickupTextLineSets: 2,
    };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // One "God boon pickup" row in the Sections summary, summing all
    // three variants (10 + 5 + 2 = 17).
    const sections = html.slice(html.indexOf('speaker-section-list'));
    const pickupRows = sections.match(/God boon pickup/g) || [];
    assert.equal(pickupRows.length, 1);
    assert.match(sections, /God boon pickup<\/span>: <span class="speaker-count">17<\/span>/);
});

test('renderSpeaker on H1 merges the four boss-introduction sections into one group, ordered by priority', () => {
    const fixture = buildSpeakerFixture();
    fixture.sectionKeyLabels = {
        ...fixture.sectionKeyLabels,
        BossPresentationIntroTextLineSets: 'Boss introduction',
        BossPresentationPriorityIntroTextLineSets: 'Boss introduction',
        BossPresentationSuperPriorityIntroTextLineSets: 'Boss introduction',
        BossPresentationTextLineSets: 'Boss introduction',
    };
    fixture.textlines.BossLow01 = {
        owner: 'NPC_Zeus_01', section: 'BossPresentationTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'low',
    };
    fixture.textlines.BossNormal01 = {
        owner: 'NPC_Zeus_01', section: 'BossPresentationIntroTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'normal',
    };
    fixture.textlines.BossPriority01 = {
        owner: 'NPC_Zeus_01', section: 'BossPresentationPriorityIntroTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'priority',
    };
    fixture.textlines.BossSuper01 = {
        owner: 'NPC_Zeus_01', section: 'BossPresentationSuperPriorityIntroTextLineSets',
        dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'super',
    };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = [
        'BossLow01', 'BossNormal01', 'BossPriority01', 'BossSuper01',
    ];
    fixture.speakers.NPC_Zeus_01.sectionCounts = {
        BossPresentationIntroTextLineSets: 1,
        BossPresentationPriorityIntroTextLineSets: 1,
        BossPresentationSuperPriorityIntroTextLineSets: 1,
        BossPresentationTextLineSets: 1,
    };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // The four priority variants collapse to a single grouped section.
    const groupHeaders = html.match(/speaker-textline-group-header/g) || [];
    assert.equal(groupHeaders.length, 1);
    assert.match(html, /Boss introduction/);
    // Ordered super-priority -> priority -> normal -> low within the group.
    const iSuper = html.indexOf('BossSuper01');
    const iPriority = html.indexOf('BossPriority01');
    const iNormal = html.indexOf('BossNormal01');
    const iLow = html.indexOf('BossLow01');
    assert.ok(iSuper >= 0 && iPriority > iSuper && iNormal > iPriority && iLow > iNormal,
        'merged boss-intro group orders super -> priority -> normal -> low');
    // The Sections summary also collapses to one row (1 + 1 + 1 + 1 = 4).
    const sections = html.slice(html.indexOf('speaker-section-list'));
    assert.match(sections, /Boss introduction<\/span>: <span class="speaker-count">4<\/span>/);
});

test('renderSpeaker on H1 folds repeatable boss sections in and orders groups by encounter flow', () => {
    const fixture = buildSpeakerFixture();
    fixture.sectionKeyLabels = {
        ...fixture.sectionKeyLabels,
        BossPresentationIntroTextLineSets: 'Boss introduction',
        BossPresentationRepeatableTextLineSets: 'Boss introduction (repeatable)',
        BossPresentationNextStageTextLineSets: 'Boss phase transition',
        BossPresentationOutroTextLineSets: 'Boss outro',
        BossPresentationOutroRepeatableTextLineSets: 'Boss outro (repeatable)',
    };
    // Play-once intro/outro lines plus their repeatable fallback lines.
    fixture.textlines.BIntro01 = { owner: 'NPC_Zeus_01', section: 'BossPresentationIntroTextLineSets', dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'normal' };
    fixture.textlines.BIntroRep01 = { owner: 'NPC_Zeus_01', section: 'BossPresentationRepeatableTextLineSets', dialogueLines: [], requirements: {} };
    fixture.textlines.BPhase01 = { owner: 'NPC_Zeus_01', section: 'BossPresentationNextStageTextLineSets', dialogueLines: [], requirements: {}, playOnce: true };
    fixture.textlines.BOutro01 = { owner: 'NPC_Zeus_01', section: 'BossPresentationOutroTextLineSets', dialogueLines: [], requirements: {}, playOnce: true, narrativePrioritySectionTier: 'normal' };
    fixture.textlines.BOutroRep01 = { owner: 'NPC_Zeus_01', section: 'BossPresentationOutroRepeatableTextLineSets', dialogueLines: [], requirements: {} };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = ['BIntro01', 'BIntroRep01', 'BPhase01', 'BOutro01', 'BOutroRep01'];
    // Counts deliberately out of flow order to prove flow rank wins over
    // count-descending. After folding: intro = 2 + 5 = 7, phase = 1,
    // outro = 3 + 4 = 7.
    fixture.speakers.NPC_Zeus_01.sectionCounts = {
        BossPresentationRepeatableTextLineSets: 5,
        BossPresentationOutroRepeatableTextLineSets: 4,
        BossPresentationOutroTextLineSets: 3,
        BossPresentationIntroTextLineSets: 2,
        BossPresentationNextStageTextLineSets: 1,
    };
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', { priority: 'all' });

    // The two repeatable boss sections fold into introduction / outro, so
    // only three boss groups render and no "(repeatable)" label appears.
    const groupHeaders = html.match(/speaker-textline-group-header/g) || [];
    assert.equal(groupHeaders.length, 3);
    assert.doesNotMatch(html, /\(repeatable\)/);

    const flow = ['>Boss introduction</span>', '>Boss phase transition</span>', '>Boss outro</span>'];
    const assertOrdered = (slice, label) => {
        const idx = flow.map(s => slice.indexOf(s));
        for (let i = 0; i < idx.length; i++) {
            assert.ok(idx[i] >= 0, `${label}: "${flow[i]}" must render`);
            if (i > 0) assert.ok(idx[i] > idx[i - 1], `${label}: flow order violated at step ${i}`);
        }
    };
    // Sections summary card: flow order, with folded counts (7 / 1 / 7).
    const summaryStart = html.indexOf('speaker-section-list');
    const summary = html.slice(summaryStart, html.indexOf('</ul>', summaryStart));
    assertOrdered(summary, 'summary');
    assert.match(summary, /Boss introduction<\/span>: <span class="speaker-count">7<\/span>/);
    assert.match(summary, /Boss outro<\/span>: <span class="speaker-count">7<\/span>/);
    // Grouped textline list: same flow order, and within each merged
    // group the play-once line precedes the repeatable fallback.
    const list = html.slice(html.indexOf('speaker-textlines'));
    assertOrdered(list, 'list');
    assert.ok(list.indexOf('BIntro01') < list.indexOf('BIntroRep01'), 'play-once intro before repeatable intro');
    assert.ok(list.indexOf('BOutro01') < list.indexOf('BOutroRep01'), 'play-once outro before repeatable outro');
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

// --- eligibility (save-status) filter -----------------------------

// Build a fixture where one speaker owns three dialogues with
// deterministic save statuses and seed a matching save through the
// localStorage restore path:
//   - ``TestPlayed01``   is in the played set        -> 'played'
//   - ``TestEligible01`` has no requirements, unplayed -> 'eligible'
//   - ``TestBlocked01``  needs an unplayed line that
//                        is not itself unobtainable  -> 'blocked'
// The save is tagged with the fixture's own active game so
// ``saveMatchesActiveGame`` holds.
function loadEligibilityFixtureWithSave() {
    const base = buildFixtureData();
    const fixture = {
        ...base,
        textlines: {
            ...base.textlines,
            TestPlayed01: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', dialogueLines: [], requirements: {}, playOnce: true },
            TestEligible01: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', dialogueLines: [], requirements: {}, playOnce: true },
            TestBlocked01: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', dialogueLines: [], requirements: { RequiredTextLines: ['NeverPlayedLine'] }, playOnce: true },
        },
        speakers: {
            ...base.speakers,
            NPC_Test_01: {
                name: 'Tester',
                ownedTextlines: ['TestPlayed01', 'TestEligible01', 'TestBlocked01'],
                asSpeakerTextlines: [],
                sourceFiles: ['NPCData.lua'],
                sectionCounts: { InteractTextLineSets: 3 },
                priorityCounts: { super: 0, priority: 3, plain: 0 },
                adjacencyUpstream: {},
                adjacencyDownstream: {},
            },
        },
    };
    loadData(fixture);
    resetSpeakerGroups();
    // Schema mirrors ``SAVE_STORAGE_SCHEMA`` in save-parser.js (the games are
    // frozen, so this shape is stable). Seed the backing store directly;
    // ``restoreSaveProgress`` reads it through the stub above.
    _localStore.set('hde.save', JSON.stringify({
        v: 3, gameId: getActiveGame(), runs: 1, played: ['TestPlayed01'],
    }));
    restoreSaveProgress();
}

test('renderSpeaker shows per-row save badges when a matching save is loaded', () => {
    loadEligibilityFixtureWithSave();
    const html = render('NPC_Test_01', {});
    assert.match(html, /save-badge played/);
    assert.match(html, /save-badge eligible/);
    assert.match(html, /save-badge blocked/);
});

test('renderSpeaker shows the eligibility chips and save-progress summary with a save', () => {
    loadEligibilityFixtureWithSave();
    const html = render('NPC_Test_01', {});
    assert.match(html, /Eligibility:/);
    assert.match(html, /eligibility-chip-played/);
    // Live per-status counts: 1 played, 1 eligible, 1 blocked.
    assert.match(html, />Played: <span class="speaker-count">1<\/span>/);
    assert.match(html, />Blocked: <span class="speaker-count">1<\/span>/);
    assert.match(html, /Save progress/);
    // The summary row widens to four columns so the save cell aligns with
    // the other three rather than wrapping.
    assert.match(html, /speaker-summary-row-4/);
});

test('renderSpeaker eligibility filter narrows the list to one status', () => {
    loadEligibilityFixtureWithSave();
    const blockedOnly = render('NPC_Test_01', { eligibility: 'blocked' });
    assert.match(blockedOnly, /TestBlocked01/);
    assert.doesNotMatch(blockedOnly, /TestPlayed01/);
    assert.doesNotMatch(blockedOnly, /TestEligible01/);

    const playedOnly = render('NPC_Test_01', { eligibility: 'played' });
    assert.match(playedOnly, /TestPlayed01/);
    assert.doesNotMatch(playedOnly, /TestBlocked01/);
});

test('renderSpeaker disables filter/eligibility chips whose selection would be empty', () => {
    loadEligibilityFixtureWithSave();
    const html = render('NPC_Test_01', {});
    // All three dialogues are play-once, so the Repeatable chip is empty -
    // greyed out and carrying the disabled attribute.
    assert.match(
        html,
        /<button[^>]*class="priority-chip is-disabled"[^>]*disabled[^>]*>Repeatable: <span class="speaker-count">0<\/span>/,
    );
    // No dialogue is unobtainable, so that eligibility chip is empty too.
    assert.match(
        html,
        /<button[^>]*class="priority-chip eligibility-chip eligibility-chip-unobtainable is-disabled"[^>]*disabled[^>]*>Unobtainable: <span class="speaker-count">0<\/span>/,
    );
    // Non-empty chips stay enabled (no ``disabled`` attribute, no class).
    assert.match(
        html,
        /<button type="button" class="priority-chip" aria-pressed="false" onclick="[^"]*">Play-once: <span class="speaker-count">3<\/span>/,
    );
});

test('renderSpeaker chip counts and disabled state reflect the active eligibility filter', () => {
    loadEligibilityFixtureWithSave();
    // Pivoting the eligibility axis to 'blocked' (one play-once dialogue)
    // recounts the repeatability chips within that subset: Play-once -> 1,
    // Repeatable -> 0 (disabled).
    const html = render('NPC_Test_01', { eligibility: 'blocked' });
    assert.match(html, /class="priority-chip is-active"[^>]*>All: <span class="speaker-count">1<\/span>/);
    assert.match(html, /class="priority-chip"[^>]*>Play-once: <span class="speaker-count">1<\/span>/);
    assert.match(
        html,
        /class="priority-chip is-disabled"[^>]*disabled[^>]*>Repeatable: <span class="speaker-count">0<\/span>/,
    );
});

test('renderSpeaker hides eligibility chips, badges, and summary when no save is loaded', () => {
    // ``beforeEach`` cleared any save, so the speaker view renders without
    // save-derived chrome.
    const html = render('NPC_Zeus_01', {});
    assert.doesNotMatch(html, /Eligibility:/);
    assert.doesNotMatch(html, /save-badge/);
    assert.doesNotMatch(html, /Save progress/);
    // The summary row stays three columns without the save cell.
    assert.doesNotMatch(html, /speaker-summary-row-4/);
});

// --- cross-speaker dependency (adjacency) sections ----------------

test('renderAdjacency uses Depends on / Required by framing with the speaker name', () => {
    const html = render('NPC_Aphrodite_01', {});
    assert.match(html, /<h4>[\s\S]*?Depends on<\/h4>/);
    assert.match(html, /<h4>[\s\S]*?Required by<\/h4>/);
    // Sublabels name the speaker and explain the direction.
    assert.match(html, /Aphrodite's dialogues require lines from these speakers/);
    assert.match(html, /these speakers' dialogues require Aphrodite's lines/);
});

test('renderAdjacency rows are expandable with a count chip and an empty (lazy) detail list', () => {
    // Aphrodite depends on Zeus in the shared fixture.
    const html = render('NPC_Aphrodite_01', {});
    assert.match(html, /class="speaker-adjacency-item"[^>]*data-adj-dir="up"[^>]*data-adj-sid="NPC_Zeus_01"/);
    assert.match(html, /speaker-adjacency-row" onclick="toggleAdjacencyRow\(this\.parentElement\)"/);
    assert.match(html, /<span class="speaker-adjacency-chevron">/);
    // Order: name + id (in a fixed-width cell), then the count chip.
    assert.match(html, /speaker-adjacency-nameid">[\s\S]*?Zeus[\s\S]*?NPC_Zeus_01[\s\S]*?<\/span><span class="speaker-adjacency-count"/);
    // Count chip carries an explanatory tooltip; detail starts empty.
    assert.match(html, /class="speaker-adjacency-count" data-tooltip="1 of Aphrodite's dialogues require at least one of [^"]*Zeus[^"]*"/);
    assert.match(html, /<ul class="speaker-adjacency-detail"><\/ul>/);
    // The list reserves a fixed name column so count chips align.
    assert.match(html, /<ul class="speaker-adjacency-list" style="--adj-name-col: \d+ch">/);
});

test('renderAdjacency tags a self-reference row', () => {
    // Zeus owns a second gift line that requires another Zeus line (a
    // self edge) as well as the cross-speaker Aphrodite line, so the
    // canonical upstream re-derive yields both a self row and an
    // other-speaker row.
    const fixture = buildSpeakerFixture();
    fixture.textlines.ZeusGift02 = {
        owner: 'NPC_Zeus_01',
        section: 'GiftTextLineSets',
        playOnce: false,
        narrativePrioritySectionTier: 'normal',
        narrativePrioritySetLevel: null,
        dialogueLines: [],
        requirements: { RequiredTextLines: ['ZeusWithAphrodite01', 'AphroditeWithZeus01'] },
    };
    fixture.speakers.NPC_Zeus_01.ownedTextlines = ['ZeusWithAphrodite01', 'ZeusGift02'];
    loadData(fixture);
    resetSpeakerGroups();
    const html = render('NPC_Zeus_01', {});
    // The self row carries the "self" tag; the other row does not.
    assert.match(html, /data-adj-sid="NPC_Zeus_01"[\s\S]*?speaker-adjacency-self/);
});

test('buildAdjacencyDetail maps each edge to its dependent -> required links', () => {
    loadData({
        textlines: {
            A1: { owner: 'NPC_A_01', section: 'X', requirements: { RequiredTextLines: ['B1'] } },
            A2: { owner: 'NPC_A_01', section: 'X', requirements: { RequiredTextLines: ['B1', 'B2'] } },
            B1: { owner: 'NPC_B_01', section: 'X', requirements: {} },
            B2: { owner: 'NPC_B_01', section: 'X', requirements: {} },
            C1: { owner: 'NPC_C_01', section: 'X', requirements: { RequiredTextLines: ['A1'] } },
        },
        speakers: { NPC_A_01: { name: 'A' }, NPC_B_01: { name: 'B' }, NPC_C_01: { name: 'C' } },
        dependents: { B1: ['A1', 'A2'], B2: ['A2'], A1: ['C1'] },
    });
    resetSpeakerGroups();
    const { up, down } = buildAdjacencyDetail(['A1', 'A2']);
    // Upstream: A's dialogues that require B's lines (dependent -> required).
    const toB = up.get('NPC_B_01');
    assert.equal(toB.size, 2); // matches the adjacency count (distinct dependents)
    assert.deepEqual([...toB.get('A1')], ['B1']);
    assert.deepEqual([...toB.get('A2')].sort(), ['B1', 'B2']);
    // Downstream: C's dialogue requires A's line.
    assert.deepEqual([...down.get('NPC_C_01').get('C1')], ['A1']);
});

test('renderAdjacencyDetailRows renders clickable dependent -> required rows', () => {
    const linkMap = new Map([['A1', new Set(['B2', 'B1'])]]);
    const html = renderAdjacencyDetailRows(linkMap);
    assert.match(html, /speaker-adjacency-dep[^>]*onclick="[^"]*navigateTo\(&quot;A1&quot;\)/);
    assert.match(html, /navigateTo\(&quot;B1&quot;\)/);
    assert.match(html, /navigateTo\(&quot;B2&quot;\)/);
    // The depending dialogue is shown above an indented "requires" line.
    assert.match(html, /speaker-adjacency-req-label">requires</);
});

test('renderAdjacencyDetailRows handles an edge with no individual links', () => {
    assert.match(renderAdjacencyDetailRows(new Map()), /speaker-adjacency-detail-empty/);
    assert.match(renderAdjacencyDetailRows(undefined), /speaker-adjacency-detail-empty/);
});
