// Tests for ``templates/viewer/search-cross-game.js``.
//
// The cross-game search surfaces matches from the OTHER (non-active)
// game. These tests load a two-game payload directly (the shared fixture
// is single-game) and assert the name/text matchers, capping, the
// name->text de-duplication, negative + filter handling, and the
// no-other-game fallback.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData, setActiveGame, getActiveGame } from '../templates/viewer/data.js';
import { emptyQuery } from '../templates/viewer/query-parser.js';
import {
    otherGameId,
    searchCrossGameNames,
    searchCrossGameText,
    searchCrossGameSpeakers,
} from '../templates/viewer/search-cross-game.js';

function _q(positive, extras = {}) {
    return { ...emptyQuery(), positive, ...extras };
}

// Minimal two-game payload: hades1 carries one Zeus textline, hades2
// several Hecate textlines (one of which shares the word "weapon"
// between its name and its dialogue line so the name->text exclusion
// can be exercised).
function twoGamePayload() {
    return {
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades', hades2: 'Hades II' },
        games: {
            hades1: {
                textlines: {
                    ZeusAboutOlympus01: {
                        owner: 'NPC_Zeus_01',
                        section: 'InteractTextLineSets',
                        dialogueLines: [{ speaker: 'NPC_Zeus_01', text: 'The heavens shine upon you.' }],
                    },
                },
                speakers: { NPC_Zeus_01: { name: 'Zeus' } },
                sectionKeyLabels: { InteractTextLineSets: 'Interact' },
            },
            hades2: {
                textlines: {
                    HecateWeaponUpgrade01: {
                        owner: 'NPC_Hecate_01',
                        section: 'BossPresentationTextLineSets',
                        dialogueLines: [{ speaker: 'NPC_Hecate_01', text: 'A certain incantation shall deepen your weapon mastery.' }],
                    },
                    HecateAboutMoros01: {
                        owner: 'NPC_Hecate_01',
                        section: 'BossPresentationTextLineSets',
                        dialogueLines: [{ speaker: 'NPC_Hecate_01', text: 'Moros watches over us all.' }],
                    },
                    HecateAboutChronos01: {
                        owner: 'NPC_Hecate_01',
                        section: 'BossPresentationTextLineSets',
                        dialogueLines: [{ speaker: 'NPC_Hecate_01', text: 'Time bends to his will.' }],
                    },
                },
                speakers: { NPC_Hecate_01: { name: 'Hecate' }, HecateUpgrade: { name: 'Hecate' } },
                sectionKeyLabels: { BossPresentationTextLineSets: 'Boss introduction' },
            },
        },
    };
}

beforeEach(() => {
    loadData(twoGamePayload());
    setActiveGame('hades1');
});

test('otherGameId returns the non-active game', () => {
    assert.equal(otherGameId('hades1'), 'hades2');
    setActiveGame('hades2');
    assert.equal(otherGameId('hades2'), 'hades1');
});

test('otherGameId defaults to the active game and is null when only one game is loaded', () => {
    assert.equal(getActiveGame(), 'hades1');
    assert.equal(otherGameId(), 'hades2');
    loadData({ textlines: {}, speakers: {} }); // single-game (auto-wrapped as hades1)
    assert.equal(otherGameId(), null);
});

test('cross-game name search finds the other game and resolves labels', () => {
    const res = searchCrossGameNames(_q(['hecate']), 6);
    assert.ok(res, 'expected a cross-game result');
    assert.equal(res.gameId, 'hades2');
    assert.equal(res.gameLabel, 'Hades II');
    const names = res.matches.map((m) => m.name);
    assert.ok(names.includes('HecateWeaponUpgrade01'));
    const m = res.matches.find((x) => x.name === 'HecateWeaponUpgrade01');
    assert.equal(m.ownerLabel, 'Hecate');
    assert.equal(m.sectionLabel, 'Boss introduction');
});

test('cross-game name search returns null when nothing in the other game matches', () => {
    assert.equal(searchCrossGameNames(_q(['zeus']), 6), null);
});

test('cross-game name search respects the result cap', () => {
    const res = searchCrossGameNames(_q(['hecate']), 2);
    assert.ok(res);
    assert.equal(res.matches.length, 2);
});

test('cross-game name search skips when the query carries filter clauses', () => {
    assert.equal(searchCrossGameNames(_q(['hecate'], { speakers: ['hecate'] }), 6), null);
    assert.equal(searchCrossGameNames(_q(['hecate'], { sections: ['boss'] }), 6), null);
});

test('cross-game name search applies negative exclusion against owner display', () => {
    // "weapon" matches the textline name; "-hecate" excludes it because
    // the owner display name is Hecate.
    assert.equal(searchCrossGameNames(_q(['weapon'], { negative: ['hecate'] }), 6), null);
});

test('cross-game text search finds a dialogue line and highlights the match', () => {
    const res = searchCrossGameText(_q(['incantation']), new Set(), 6);
    assert.ok(res, 'expected a cross-game text result');
    assert.equal(res.gameId, 'hades2');
    const m = res.matches.find((x) => x.name === 'HecateWeaponUpgrade01');
    assert.ok(m, 'expected the weapon-upgrade line');
    assert.match(m.snippetHtml, /<mark>incantation<\/mark>/);
    assert.equal(m.ownerLabel, 'Hecate');
});

test('cross-game text search excludes names already shown in the name section', () => {
    // "weapon" matches both the name and the dialogue line of
    // HecateWeaponUpgrade01; passing it via excludeNames drops it from
    // the text section so the dropdown shows no duplicate row.
    const all = searchCrossGameText(_q(['weapon']), new Set(), 6);
    assert.ok(all && all.matches.some((m) => m.name === 'HecateWeaponUpgrade01'));
    const excluded = searchCrossGameText(_q(['weapon']), new Set(['HecateWeaponUpgrade01']), 6);
    assert.equal(excluded, null);
});

test('cross-game text search requires all positive tokens on a single line', () => {
    // "incantation" and "moros" appear in DIFFERENT textlines, never on
    // the same line, so the all-tokens-on-one-line rule yields no match.
    assert.equal(searchCrossGameText(_q(['incantation', 'moros']), new Set(), 6), null);
});

test('cross-game search works in the other direction (hades2 active finds hades1)', () => {
    setActiveGame('hades2');
    const res = searchCrossGameNames(_q(['zeus']), 6);
    assert.ok(res);
    assert.equal(res.gameId, 'hades1');
    assert.equal(res.matches[0].name, 'ZeusAboutOlympus01');
});

test('cross-game speaker search finds the other game and collapses groups', () => {
    // NPC_Hecate_01 and HecateUpgrade share the friendly name "Hecate",
    // so they collapse into a single canonical row (alphabetically-first
    // member id wins the canonical slot).
    const res = searchCrossGameSpeakers(_q(['hecate']), 6);
    assert.ok(res, 'expected a cross-game speaker result');
    assert.equal(res.gameId, 'hades2');
    assert.equal(res.gameLabel, 'Hades II');
    assert.equal(res.matches.length, 1);
    assert.equal(res.matches[0].friendly, 'Hecate');
    assert.equal(res.matches[0].id, 'HecateUpgrade');
});

test('cross-game speaker search returns null when nothing matches or filters are present', () => {
    assert.equal(searchCrossGameSpeakers(_q(['zeus']), 6), null); // no Zeus speaker in hades2
    assert.equal(searchCrossGameSpeakers(_q(['hecate'], { speakers: ['hecate'] }), 6), null);
});

test('cross-game speaker search works in the other direction (hades2 active finds hades1)', () => {
    setActiveGame('hades2');
    const res = searchCrossGameSpeakers(_q(['zeus']), 6);
    assert.ok(res);
    assert.equal(res.gameId, 'hades1');
    assert.equal(res.matches[0].id, 'NPC_Zeus_01');
    assert.equal(res.matches[0].friendly, 'Zeus');
});
