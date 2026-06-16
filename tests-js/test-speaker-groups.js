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
    speakerGroupMembers,
    listCanonicalSpeakerIds,
    getSpeakerGroupEntry,
    resetSpeakerGroups,
} from '../templates/viewer/speaker-groups.js';
import { loadData } from '../templates/viewer/data.js';

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
