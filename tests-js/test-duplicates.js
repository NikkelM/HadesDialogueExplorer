// Tests for the cross-game duplicates view and the duplicate badge on
// the textline detail panel.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderDuplicates, getSelectedDuplicateSpeaker, ALL_SPEAKERS } from '../templates/viewer/duplicates-view.js';
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

test('renderDuplicates shows an "All" entry first, active and default', () => {
    renderDuplicates({ q: '' });
    // The All pseudo-speaker is present, looks like any speaker item, and is
    // selected by default. Its count is the full duplicate total (one in the
    // fixture).
    assert.match(lastHtml, /<span class="duplicates-speaker-name">All<\/span><span class="duplicates-speaker-count">1<\/span>/);
    // Detail pane defaults to the "All speakers" view.
    assert.match(lastHtml, /duplicates-detail-title">All speakers</);
    // "All" is rendered before the real speaker (Zeus) in the master list.
    const allIdx = lastHtml.indexOf('>All<');
    assert.ok(allIdx >= 0 && allIdx < lastHtml.indexOf('>Zeus<'),
        'All entry must come before the first speaker');
});

// --- dup URL key (selected-speaker persistence) ---

test('renderDuplicates selects the speaker named by the dup option', () => {
    renderDuplicates({ q: '', dup: 'Zeus' });
    assert.equal(getSelectedDuplicateSpeaker(), 'Zeus');
    // Detail pane shows Zeus, not the "All speakers" default.
    assert.match(lastHtml, /duplicates-detail-title">Zeus</);
    assert.doesNotMatch(lastHtml, /duplicates-detail-title">All speakers</);
});

test('renderDuplicates resets to All when dup is absent (URL is authoritative)', () => {
    // Select Zeus first, then a full render with no dup must reset to All
    // so a reload of a bare ``#view=duplicates`` URL lands on All.
    renderDuplicates({ q: '', dup: 'Zeus' });
    assert.equal(getSelectedDuplicateSpeaker(), 'Zeus');
    renderDuplicates({ q: '' });
    assert.equal(getSelectedDuplicateSpeaker(), ALL_SPEAKERS);
    assert.match(lastHtml, /duplicates-detail-title">All speakers</);
});

test('renderDuplicates ignores an unknown dup, falling back to All', () => {
    renderDuplicates({ q: '', dup: 'Nonexistent Speaker' });
    // No such speaker owns a duplicate, so the detail pane falls back to All.
    assert.equal(getSelectedDuplicateSpeaker(), ALL_SPEAKERS);
    assert.match(lastHtml, /duplicates-detail-title">All speakers</);
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
