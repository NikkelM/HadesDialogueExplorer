// Test fixtures for the viewer modules.
//
// The viewer's pure functions read from module-level lets declared in
// ``templates/viewer/data.js`` and populated by ``loadData(DATA)``.
// Tests import this helper and call ``loadFixtureData()`` in a
// ``before`` hook so every test sees a known baseline of textlines,
// speakers, requirement-type labels, and tooltips.
//
// The fixture is intentionally a superset shared across test files:
// each test looks up the specific names it needs. Tests that require
// a different state (e.g. exercising the ``Internal name:`` fallback
// when no friendly label exists) can call ``loadData`` with their own
// minimal DATA at the top of the test - the module-level lets are
// reassigned in place.

import { loadData } from '../templates/viewer/data.js';
import { buildLinesIndex } from '../templates/viewer/search-text.js';
import { buildNameIndex } from '../templates/viewer/search-name.js';

// Minimal but representative dataset:
//   - Several NPCs with friendly labels.
//   - Pairs whose names collide in interesting ways for ranking
//     (``ZeusWithAphrodite01`` vs ``AphroditeWithZeus01``).
//   - One textline with no friendly speaker name (covers the fallback
//     branch in ``renderSpeakerHtml`` / ``displayName``).
//   - Several dialogue lines exercising case, word boundaries, and
//     contiguous-phrase detection.
//   - Both PlayOnce and Repeatable variants for badge tests.
//   - All three priority section tiers plus a normal default, and
//     both set-level priorities, for badge tests.
//   - A requirement type with a tooltip and ones without, for
//     ``reqTypeTitleText`` tests.
export function buildFixtureData() {
    return {
        textlines: {
            ZeusWithAphrodite01: {
                owner: 'NPC_Zeus_01',
                section: 'GiftTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'normal',
                narrativePrioritySetLevel: null,
                dialogueLines: [
                    { speaker: 'NPC_Zeus_01', text: "I knew you would seek me out, mortal." },
                    { speaker: 'Zagreus', text: "I think he's joking about it." },
                ],
            },
            AphroditeWithZeus01: {
                owner: 'NPC_Aphrodite_01',
                section: 'GiftTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'priority',
                narrativePrioritySetLevel: 'priority',
                dialogueLines: [
                    { speaker: 'NPC_Aphrodite_01', text: "Oh, my little godling - so good to see you again." },
                ],
            },
            OrpheusSingsAgain02: {
                owner: 'NPC_Orpheus_01',
                section: 'InteractTextLineSets',
                playOnce: true,
                narrativePrioritySectionTier: 'super',
                narrativePrioritySetLevel: 'super',
                dialogueLines: [
                    { speaker: 'NPC_Orpheus_01', text: "I think I've found my voice again, at last." },
                ],
            },
            AchillesAboutThanatos01: {
                owner: 'NPC_Achilles_01',
                section: 'InteractTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'low',
                narrativePrioritySetLevel: null,
                dialogueLines: [
                    { speaker: 'NPC_Achilles_01', text: "I think he'd want you to know." },
                ],
            },
            MysteriousVoice01: {
                owner: 'NPC_Unknown_01',
                section: 'InteractTextLineSets',
                playOnce: false,
                narrativePrioritySectionTier: 'normal',
                narrativePrioritySetLevel: null,
                dialogueLines: [
                    { speaker: 'NPC_Unknown_01', text: 'A whisper in the dark.' },
                ],
            },
        },
        dependents: {},
        stats: { totalTextlines: 5, totalEdges: 0, unresolvedRefs: [] },
        speakers: {
            NPC_Zeus_01:      { name: 'Zeus',      description: 'King of the Olympians' },
            NPC_Aphrodite_01: { name: 'Aphrodite', description: 'Goddess of Love' },
            NPC_Orpheus_01:   { name: 'Orpheus',   description: 'Court Musician' },
            // NPC_Achilles_01 intentionally has only a name (no
            // description) so tests can exercise the "friendly name
            // only, no description" branch.
            NPC_Achilles_01:  { name: 'Achilles' },
        },
        knownUnresolvedRefs: {},
        unresolvedCategoryLabels: {},
        unresolvedCategoryDescriptions: {},
        unresolvedRefBlocks: {},
        reqTypeLabels: {
            RequiredTextLines: 'Required (ALL)',
            RequiredAnyTextLines: 'Required (ANY)',
            RequiredFalseTextLines: 'Not played (NONE)',
        },
        reqTypeEdgeLabels: {
            RequiredTextLines: 'ALL',
            RequiredAnyTextLines: 'ANY',
            RequiredFalseTextLines: 'NONE',
        },
        reqTypeTooltips: {
            RequiredTextLines:
                'This dialogue is only eligible if EVERY listed textline has been played at some point in a save.',
            // RequiredAnyTextLines and RequiredFalseTextLines deliberately
            // have no tooltip entry so tests can exercise the "header-only"
            // branch of reqTypeTitleText.
        },
        reqTypeOrder: [
            'RequiredTextLines',
            'RequiredAnyTextLines',
            'RequiredFalseTextLines',
        ],
        sectionKeyLabels: {
            GiftTextLineSets: 'Gift',
            InteractTextLineSets: 'Interact',
        },
    };
}

// Reset the viewer's module-level state to the shared fixture and
// rebuild the search indices. Call from a ``before`` (or per-test
// ``beforeEach``) hook.
export function loadFixtureData() {
    loadData(buildFixtureData());
    buildLinesIndex();
    buildNameIndex();
}
