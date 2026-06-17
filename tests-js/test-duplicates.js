// Tests for the cross-game duplicates view and the duplicate badge on
// the textline detail panel.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderDuplicates } from '../templates/viewer/duplicates-view.js';
import { renderInfo, resetDuplicateNameSet } from '../templates/viewer/info-panel.js';
import { loadData } from '../templates/viewer/data.js';

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

function buildDuplicatesFixture() {
    return {
        games: {
            hades1: {
                textlines: {
                    SharedDialogue01: {
                        owner: 'ZeusUpgrade',
                        section: 'PriorityPickupTextLineSets',
                        dialogueLines: [],
                        requirements: {},
                    },
                    OnlyH1Dialogue: {
                        owner: 'NPC_Hades_01',
                        section: 'InteractTextLineSets',
                        dialogueLines: [],
                        requirements: {},
                    },
                },
                speakers: {
                    ZeusUpgrade: { name: 'Zeus', ownedTextlines: ['SharedDialogue01'] },
                    NPC_Hades_01: { name: 'Hades', ownedTextlines: ['OnlyH1Dialogue'] },
                },
                dependents: {},
                stats: {},
                reqTypeLabels: {},
                reqTypeEdgeLabels: {},
                reqTypeTooltips: {},
                reqTypeOrder: [],
                sectionKeyLabels: { PriorityPickupTextLineSets: 'Priority boon pickup' },
            },
            hades2: {
                textlines: {
                    SharedDialogue01: {
                        owner: 'ZeusUpgrade',
                        section: 'InteractTextLineSets',
                        dialogueLines: [],
                        requirements: {},
                    },
                    OnlyH2Dialogue: {
                        owner: 'NPC_Zeus_Story_01',
                        section: 'InteractTextLineSets',
                        dialogueLines: [],
                        requirements: {},
                    },
                },
                speakers: {
                    ZeusUpgrade: { name: 'Zeus', ownedTextlines: ['SharedDialogue01'] },
                    NPC_Zeus_Story_01: { name: 'Zeus', ownedTextlines: ['OnlyH2Dialogue'] },
                },
                dependents: {},
                stats: {},
                reqTypeLabels: {},
                reqTypeEdgeLabels: {},
                reqTypeTooltips: {},
                reqTypeOrder: [],
                sectionKeyLabels: { InteractTextLineSets: 'NPC interaction' },
            },
        },
        gameLabels: { hades1: 'Hades', hades2: 'Hades II' },
        defaultGame: 'hades1',
        duplicates: [
            {
                name: 'SharedDialogue01',
                hades1: { owner: 'ZeusUpgrade', section: 'PriorityPickupTextLineSets' },
                hades2: { owner: 'ZeusUpgrade', section: 'InteractTextLineSets' },
            },
        ],
    };
}

before(() => {
    loadData(buildDuplicatesFixture());
    resetDuplicateNameSet();
});

beforeEach(() => {
    lastHtml = '';
});

// --- renderDuplicates ---

test('renderDuplicates shows master-detail view with the shared textline', () => {
    renderDuplicates({ q: '' });
    assert.match(lastHtml, /SharedDialogue01/);
    assert.match(lastHtml, /Zeus/);
    assert.match(lastHtml, /duplicates-md/);
    assert.match(lastHtml, /duplicates-speaker-item/);
    assert.match(lastHtml, /duplicates-detail/);
});

test('renderDuplicates text search filters by name', () => {
    renderDuplicates({ q: 'shared' });
    assert.match(lastHtml, /SharedDialogue01/);
    renderDuplicates({ q: 'nonexistent' });
    assert.match(lastHtml, /duplicates-empty/);
});

test('renderDuplicates text search filters by speaker name', () => {
    renderDuplicates({ q: 'zeus' });
    assert.match(lastHtml, /SharedDialogue01/);
});

// --- cross-game badge on textline detail ---

test('renderInfo shows cross-game badge for a duplicate textline', () => {
    renderInfo('SharedDialogue01');
    assert.match(lastHtml, /cross-game-badge/);
    assert.match(lastHtml, /Hades II/);
});

test('renderInfo does NOT show cross-game badge for a non-duplicate textline', () => {
    renderInfo('OnlyH1Dialogue');
    assert.doesNotMatch(lastHtml, /cross-game-badge/);
});
