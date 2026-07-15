// Tests for the display-only speaker grouping helpers in
// ``templates/viewer/speaker-groups.js``. The collapse merges
// speaker entries whose trimmed friendly ``name`` is identical
// (Hermes 3-way, Hecate 2-way, etc) into a single aggregate
// entry for the speaker view + search dropdown, without
// touching the underlying ``textlines`` ownership map.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    canonicalSpeakerId,
    canonicalIdForSpeakerName,
    englishSpeakerName,
    speakerGroupMembers,
    listCanonicalSpeakerIds,
    getSpeakerGroupEntry,
    resetSpeakerGroups,
    resetSpeakerGroupEntries,
    similarSpeakers,
    forEachUpstreamRef,
} from '../templates/viewer/speaker-groups.js';
import { loadData, setActiveLang, registerLocData, speakers } from '../templates/viewer/data.js';

// Two same-named Hermes speakers + a singleton Zeus + a Hecate
// pair where one carries the "(Boss)" disambiguator so they MUST
// stay distinct. Textlines + dependents are wired so the
// adjacency re-derive has something to chew on with the
// cross-group double-reference shape we care about.
function buildGroupFixture() {
    return {
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades' },
        games: {
            hades1: {
                speakers: {
                    NPC_Hermes_01: {
                        name: 'Hermes',
                        description: 'Courier of the Gods',
                        ownedTextlines: ['HermesCourier01'],
                        asSpeakerTextlines: ['HermesGifted01'],
                        sourceFiles: ['NPCData.lua'],
                        sectionCounts: { InteractTextLineSets: 1 },
                        priorityCounts: { super: 0, priority: 1, plain: 0 },
                    },
                    HermesUpgrade: {
                        name: 'Hermes',
                        description: '',
                        ownedTextlines: ['HermesGifted01'],
                        asSpeakerTextlines: [],
                        sourceFiles: ['LootData.lua'],
                        sectionCounts: { GiftTextLineSets: 1 },
                        priorityCounts: { super: 1, priority: 0, plain: 0 },
                    },
                    NPC_Zeus_01: {
                        name: 'Zeus',
                        description: 'King of the Olympians',
                        ownedTextlines: ['ZeusGifted01'],
                        asSpeakerTextlines: [],
                        sourceFiles: ['NPCData.lua'],
                        sectionCounts: { GiftTextLineSets: 1 },
                        priorityCounts: { super: 0, priority: 0, plain: 1 },
                    },
                    ZeusUpgrade: {
                        name: 'Zeus',
                        description: '',
                        ownedTextlines: ['ZeusUpgrade01'],
                        asSpeakerTextlines: [],
                        sourceFiles: ['LootData.lua'],
                        sectionCounts: { GiftTextLineSets: 1 },
                        priorityCounts: { super: 0, priority: 1, plain: 0 },
                    },
                    UnnamedUpgrade: {
                        name: '',
                        description: '',
                        ownedTextlines: [],
                        asSpeakerTextlines: [],
                        sourceFiles: ['LootData.lua'],
                        sectionCounts: {},
                        priorityCounts: { super: 0, priority: 0, plain: 0 },
                    },
                    NPC_Hecate_01: {
                        name: 'Hecate',
                        description: 'Goddess of Witchcraft',
                        ownedTextlines: ['HecateMeeting01'],
                        asSpeakerTextlines: [],
                        sourceFiles: ['NPCData.lua'],
                        sectionCounts: { InteractTextLineSets: 1 },
                        priorityCounts: { super: 0, priority: 0, plain: 1 },
                    },
                    'NPC_HecateBoss_01': {
                        name: 'Hecate (Boss)',
                        description: 'Boss form',
                        ownedTextlines: ['HecateBossIntro01'],
                        asSpeakerTextlines: [],
                        sourceFiles: ['EnemyData.lua'],
                        sectionCounts: { BossIntroTextLineSets: 1 },
                        priorityCounts: { super: 0, priority: 0, plain: 1 },
                    },
                },
                textlines: {
                    HermesCourier01: {
                        owner: 'NPC_Hermes_01',
                        // Same Hermes textline gates on both Zeus members -
                        // adjacency re-derive must count this as exactly 1
                        // edge from Hermes -> Zeus group (not 2).
                        requirements: {
                            RequiredTextLines: ['ZeusGifted01'],
                            RequiredAnyTextLines: ['ZeusUpgrade01'],
                        },
                    },
                    HermesGifted01: {
                        owner: 'HermesUpgrade',
                        requirements: {},
                    },
                    ZeusGifted01: {
                        owner: 'NPC_Zeus_01',
                        requirements: {},
                    },
                    ZeusUpgrade01: {
                        owner: 'ZeusUpgrade',
                        requirements: {},
                    },
                    HecateMeeting01: {
                        owner: 'NPC_Hecate_01',
                        requirements: {},
                    },
                    HecateBossIntro01: {
                        owner: 'NPC_HecateBoss_01',
                        requirements: {},
                    },
                },
                dependents: {
                    ZeusGifted01: ['HermesCourier01'],
                    ZeusUpgrade01: ['HermesCourier01'],
                },
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
    };
}

beforeEach(() => {
    loadData(buildGroupFixture());
    resetSpeakerGroups();
});

test('canonicalSpeakerId picks the alphabetically-first member', () => {
    // HermesUpgrade < NPC_Hermes_01 alphabetically.
    assert.equal(canonicalSpeakerId('NPC_Hermes_01'), 'HermesUpgrade');
    assert.equal(canonicalSpeakerId('HermesUpgrade'), 'HermesUpgrade');
    // NPC_Zeus_01 < ZeusUpgrade alphabetically.
    assert.equal(canonicalSpeakerId('ZeusUpgrade'), 'NPC_Zeus_01');
    assert.equal(canonicalSpeakerId('NPC_Zeus_01'), 'NPC_Zeus_01');
});

test('canonicalSpeakerId passes singletons through unchanged', () => {
    assert.equal(canonicalSpeakerId('NPC_Hecate_01'), 'NPC_Hecate_01');
    // "(Boss)" disambiguator keeps Hecate (Boss) in its own bucket.
    assert.equal(canonicalSpeakerId('NPC_HecateBoss_01'), 'NPC_HecateBoss_01');
});

test('canonicalSpeakerId returns unknown ids unchanged (no throw)', () => {
    assert.equal(canonicalSpeakerId('NPC_NotARealSpeaker_99'), 'NPC_NotARealSpeaker_99');
    assert.equal(canonicalSpeakerId(''), '');
    assert.equal(canonicalSpeakerId(null), null);
});

test('canonicalIdForSpeakerName resolves a friendly name to its canonical id', () => {
    // The friendly name (as carried in the URL hash) maps to the group's
    // canonical id - the alphabetically-first member for multi-id groups.
    assert.equal(canonicalIdForSpeakerName('Hermes'), 'HermesUpgrade');
    assert.equal(canonicalIdForSpeakerName('Zeus'), 'NPC_Zeus_01');
    assert.equal(canonicalIdForSpeakerName('Hecate'), 'NPC_Hecate_01');
    // The "(Boss)" disambiguator is part of the name, so it resolves separately.
    assert.equal(canonicalIdForSpeakerName('Hecate (Boss)'), 'NPC_HecateBoss_01');
});

test('canonicalIdForSpeakerName returns null for unknown / empty names', () => {
    assert.equal(canonicalIdForSpeakerName('Not A Speaker'), null);
    assert.equal(canonicalIdForSpeakerName(''), null);
    assert.equal(canonicalIdForSpeakerName(null), null);
});

test('englishSpeakerName maps an id to its group\'s English friendly name', () => {
    // Any member id resolves to the group's canonical English name.
    assert.equal(englishSpeakerName('NPC_Hermes_01'), 'Hermes');
    assert.equal(englishSpeakerName('HermesUpgrade'), 'Hermes');
    assert.equal(englishSpeakerName('NPC_HecateBoss_01'), 'Hecate (Boss)');
    // A nameless speaker (empty friendly label) has no URL-facing name.
    assert.equal(englishSpeakerName('UnnamedUpgrade'), null);
    assert.equal(englishSpeakerName(''), null);
});

test('speaker id<->name mapping is language-neutral (URL hash unaffected by localisation)', () => {
    // A German overlay renames the Hermes group in the live ``speakers`` map...
    registerLocData('hades1', 'de', {
        text: {},
        speakers: {
            NPC_Hermes_01: { name: 'Hermes-DE' },
            HermesUpgrade: { name: 'Hermes-DE' },
        },
    });
    setActiveLang('de');
    resetSpeakerGroups(); // rebuild while German is active - must still key off English
    // The overlay IS live (guards against a false pass if it silently no-ops).
    assert.equal(speakers.NPC_Hermes_01.name, 'Hermes-DE');
    // ...but the hash-facing mapping must not follow the translation: the name
    // navigation.js writes into the URL stays English, and the English name
    // still resolves back - so a shared link is identical in every language.
    assert.equal(englishSpeakerName('NPC_Hermes_01'), 'Hermes');
    assert.equal(englishSpeakerName('HermesUpgrade'), 'Hermes');
    assert.equal(canonicalIdForSpeakerName('Hermes'), 'HermesUpgrade');
    // The localised name must NOT resolve - it never appears in a URL.
    assert.equal(canonicalIdForSpeakerName('Hermes-DE'), null);
    setActiveLang('en'); // restore for later tests
});

test('empty friendly names never group (each stays a singleton)', () => {
    assert.equal(canonicalSpeakerId('UnnamedUpgrade'), 'UnnamedUpgrade');
    assert.deepEqual(speakerGroupMembers('UnnamedUpgrade'), ['UnnamedUpgrade']);
});

test('speakerGroupMembers returns sorted members for grouped + singleton ids', () => {
    assert.deepEqual(speakerGroupMembers('NPC_Hermes_01'), ['HermesUpgrade', 'NPC_Hermes_01']);
    assert.deepEqual(speakerGroupMembers('HermesUpgrade'), ['HermesUpgrade', 'NPC_Hermes_01']);
    assert.deepEqual(speakerGroupMembers('NPC_HecateBoss_01'), ['NPC_HecateBoss_01']);
});

test('listCanonicalSpeakerIds emits one row per group (no duplicates)', () => {
    const canonicals = listCanonicalSpeakerIds();
    // 7 raw speakers - Hermes and Zeus each collapse a pair, so 5
    // canonical rows total.
    assert.equal(canonicals.length, 5);
    assert.ok(canonicals.includes('HermesUpgrade'));
    assert.ok(!canonicals.includes('NPC_Hermes_01'),
        'Non-canonical members must not appear in the canonical list');
    assert.ok(canonicals.includes('NPC_Zeus_01'));
    assert.ok(!canonicals.includes('ZeusUpgrade'),
        'Non-canonical members must not appear in the canonical list');
    assert.ok(canonicals.includes('NPC_Hecate_01'));
    assert.ok(canonicals.includes('NPC_HecateBoss_01'),
        'Hecate (Boss) is a distinct friendly name and must stay listed');
});

test('getSpeakerGroupEntry merges owned/as-speaker, subtracting group-owned', () => {
    const entry = getSpeakerGroupEntry('HermesUpgrade');
    assert.equal(entry.name, 'Hermes');
    // Hermes group owns BOTH HermesCourier01 (NPC_Hermes_01) AND
    // HermesGifted01 (HermesUpgrade). HermesGifted01 was listed as
    // NPC_Hermes_01's "as-speaker" (cue speaker), so after the
    // collapse it's now group-owned and drops out of as-speaker.
    assert.deepEqual(entry.ownedTextlines, ['HermesCourier01', 'HermesGifted01']);
    assert.deepEqual(entry.asSpeakerTextlines, []);
});

test('getSpeakerGroupEntry sums section/priority counts across members', () => {
    const entry = getSpeakerGroupEntry('HermesUpgrade');
    assert.deepEqual(entry.sectionCounts, {
        InteractTextLineSets: 1,
        GiftTextLineSets: 1,
    });
    assert.deepEqual(entry.priorityCounts, { super: 1, priority: 1, plain: 0 });
});

test('getSpeakerGroupEntry adjacency upstream collapses to one count per dest group', () => {
    const entry = getSpeakerGroupEntry('HermesUpgrade');
    // HermesCourier01 references BOTH ZeusGifted01 (NPC_Zeus_01) AND
    // ZeusUpgrade01 (ZeusUpgrade). Both are in the same Zeus group
    // (canonical NPC_Zeus_01), so the re-derive must dedup to a
    // single edge from the Hermes group to the Zeus group.
    assert.equal(entry.adjacencyUpstream.NPC_Zeus_01, 1);
    assert.equal(entry.adjacencyUpstream.ZeusUpgrade, undefined);
});

test('getSpeakerGroupEntry adjacency upstream includes orBranch references', () => {
    // A Hecate textline references a Zeus line ONLY via an H2 orBranch (no flat
    // requirement); the group upstream re-derive must still count the Hecate ->
    // Zeus edge, matching the detail list (buildAdjacencyDetail, which shares the
    // forEachUpstreamRef scanner) and the prerequisite tree - otherwise the
    // count chip would disagree with its own expanded detail.
    const fixture = buildGroupFixture();
    fixture.games.hades1.textlines.HecateMeeting01 = {
        owner: 'NPC_Hecate_01',
        requirements: {},
        orBranches: [{ requirements: { RequiredTextLines: ['ZeusGifted01'] } }],
    };
    loadData(fixture);
    resetSpeakerGroups();
    const entry = getSpeakerGroupEntry('NPC_Hecate_01');
    assert.equal(entry.adjacencyUpstream.NPC_Zeus_01, 1);
});

test('forEachUpstreamRef yields flat requirement AND orBranch refs, skips non-arrays', () => {
    // The shared scanner that both the count re-derive and the detail builder
    // use. It must surface refs from the flat requirements and from every
    // orBranch requirement set, and tolerate a missing/empty textline.
    const tl = {
        requirements: { RequiredTextLines: ['Flat1', 'Flat2'], Count: 3 },
        orBranches: [
            { requirements: { RequiredTextLines: ['Or1'] } },
            null,
            { requirements: {} },
            { requirements: { RequiredAnyTextLines: ['Or2', 'Or3'] } },
        ],
    };
    const seen = [];
    forEachUpstreamRef(tl, (ref) => seen.push(ref));
    // ``Count: 3`` is a non-array field and must be ignored, not iterated.
    assert.deepEqual(seen.sort(), ['Flat1', 'Flat2', 'Or1', 'Or2', 'Or3']);
    // A missing textline is a no-op (no throw).
    let n = 0;
    forEachUpstreamRef(null, () => { n += 1; });
    assert.equal(n, 0);
});

test('getSpeakerGroupEntry adjacency downstream maps deps through canonical', () => {
    // Zeus group owns ZeusGifted01 + ZeusUpgrade01, both depended on
    // by the same Hermes-group textline (HermesCourier01). After the
    // collapse, the Zeus group's downstream points at the Hermes
    // group exactly once.
    const zeus = getSpeakerGroupEntry('NPC_Zeus_01');
    assert.equal(zeus.adjacencyDownstream.HermesUpgrade, 1);
    assert.equal(zeus.adjacencyDownstream.NPC_Hermes_01, undefined);
});

test('singleton groups still carry _members + _canonicalId', () => {
    const hecate = getSpeakerGroupEntry('NPC_Hecate_01');
    assert.equal(hecate._canonicalId, 'NPC_Hecate_01');
    assert.deepEqual(hecate._members, ['NPC_Hecate_01']);
});

test('multi-member groups expose all member ids via _members', () => {
    const entry = getSpeakerGroupEntry('HermesUpgrade');
    assert.equal(entry._canonicalId, 'HermesUpgrade');
    assert.deepEqual(entry._members, ['HermesUpgrade', 'NPC_Hermes_01']);
});

test('resetSpeakerGroupEntries re-derives the speaker-view name in the active language', () => {
    registerLocData('hades1', 'de', {
        text: {},
        speakers: {
            NPC_Hermes_01: { name: 'Hermes-DE', description: 'Bote-DE' },
            HermesUpgrade: { name: 'Hermes-DE' },
        },
    });
    // The aggregated speaker-view entry bakes in the (localised) display name.
    assert.equal(getSpeakerGroupEntry('HermesUpgrade').name, 'Hermes');
    // Switching language updates the overlay, but the entry stays cached...
    setActiveLang('de');
    assert.equal(getSpeakerGroupEntry('HermesUpgrade').name, 'Hermes');
    // ...until the entry cache is cleared, then it re-derives in the new
    // language while the language-neutral grouping stays intact.
    resetSpeakerGroupEntries();
    assert.equal(getSpeakerGroupEntry('HermesUpgrade').name, 'Hermes-DE');
    assert.equal(canonicalIdForSpeakerName('Hermes'), 'HermesUpgrade');
    setActiveLang('en');
    resetSpeakerGroupEntries();
});

test('resetSpeakerGroups invalidates cached groups after a data swap', () => {
    // First call seeds the cache against the buildGroupFixture data.
    const before = listCanonicalSpeakerIds();
    assert.equal(before.length, 5);
    // Swap to a single-speaker dataset and reset; cache must rebuild
    // against the new speakers map.
    loadData({
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades' },
        games: {
            hades1: {
                speakers: { OnlySpeaker: { name: 'Alone' } },
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
    assert.deepEqual(listCanonicalSpeakerIds(), ['OnlySpeaker']);
});

test('getSpeakerGroupEntry returns null for an unknown speaker id', () => {
    assert.equal(getSpeakerGroupEntry('NPC_NotARealSpeaker_99'), null);
});

test('similarSpeakers links different versions of the same character by base name', () => {
    // "Hecate" and "Hecate (Boss)" share the base "Hecate", so each lists
    // the other (by canonical id + friendly name).
    assert.deepEqual(similarSpeakers('NPC_Hecate_01'), [
        { id: 'NPC_HecateBoss_01', name: 'Hecate (Boss)' },
    ]);
    assert.deepEqual(similarSpeakers('NPC_HecateBoss_01'), [
        { id: 'NPC_Hecate_01', name: 'Hecate' },
    ]);
});

test('similarSpeakers resolves a non-canonical member id to its group', () => {
    // HermesUpgrade is canonical, NPC_Hermes_01 is a member; Hermes has no
    // other version, so either id yields an empty list (not itself).
    assert.deepEqual(similarSpeakers('NPC_Hermes_01'), []);
    assert.deepEqual(similarSpeakers('HermesUpgrade'), []);
});

test('similarSpeakers returns empty for a speaker with no variants', () => {
    assert.deepEqual(similarSpeakers('NPC_Zeus_01'), []);
});

test('similarSpeakers returns empty for unknown / empty ids (no throw)', () => {
    assert.deepEqual(similarSpeakers('NPC_NotReal_99'), []);
    assert.deepEqual(similarSpeakers(''), []);
    assert.deepEqual(similarSpeakers(null), []);
});

test('similarSpeakers does NOT cross-link letterless placeholder names', () => {
    // "? ? ?" placeholders carry the real identity in the parenthetical,
    // so they are different characters and must not link to one another.
    loadData({
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades' },
        games: {
            hades1: {
                speakers: {
                    NPC_Mystery_A: { name: '? ? ? (Alecto)' },
                    NPC_Mystery_C: { name: '? ? ? (Chaos)' },
                    NPC_Real_Eris: { name: 'Eris' },
                    NPC_Real_ErisBoss: { name: 'Eris (Boss)' },
                },
                textlines: {}, dependents: {}, stats: {}, knownUnresolved: {},
                reqTypeLabels: {}, reqTypeTooltips: {}, reqTypeLabelsDependents: {},
                reqTypeTooltipsDependents: {}, reqTypeOrder: [], otherReqTypeLabels: {},
                sectionKeyLabels: {}, gameDataRefs: {}, choiceNames: {}, metaUpgradeNames: {},
            },
        },
    });
    resetSpeakerGroups();
    // Placeholders never cross-link, even though they share the "? ? ?" base.
    assert.deepEqual(similarSpeakers('NPC_Mystery_A'), []);
    assert.deepEqual(similarSpeakers('NPC_Mystery_C'), []);
    // Real characters with a letter base still link normally.
    assert.deepEqual(similarSpeakers('NPC_Real_Eris'), [
        { id: 'NPC_Real_ErisBoss', name: 'Eris (Boss)' },
    ]);
});

test('similarSpeakers stays language-neutral (non-Latin localised names still cross-link)', () => {
    // A Greek overlay renames both Hecate versions to a non-Latin script. Keyed
    // off the localised name with a Latin-only letter check, the "Other
    // versions" list would vanish; keyed off the English base it survives, shown
    // with the Greek name. (Regression: user reported this for Eris in Greek.)
    registerLocData('hades1', 'el', {
        text: {},
        speakers: {
            NPC_Hecate_01: { name: '\u0395\u03ba\u03ac\u03c4\u03b7' },              // Εκάτη
            NPC_HecateBoss_01: { name: '\u0395\u03ba\u03ac\u03c4\u03b7 (Boss)' },   // Εκάτη (Boss)
        },
    });
    setActiveLang('el');
    assert.deepEqual(similarSpeakers('NPC_Hecate_01'), [
        { id: 'NPC_HecateBoss_01', name: '\u0395\u03ba\u03ac\u03c4\u03b7 (Boss)' },
    ]);
    setActiveLang('en');
});
