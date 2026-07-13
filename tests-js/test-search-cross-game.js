// Tests for ``templates/viewer/search-cross-game.js``.
//
// The cross-game search surfaces matches from the OTHER (non-active)
// game. These tests load a two-game payload directly (the shared fixture
// is single-game) and assert the name/text matchers, capping, the
// name->text de-duplication, negative + filter handling, and the
// no-other-game fallback.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData, setActiveGame, getActiveGame, setActiveLang } from '../templates/viewer/data.js';
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

test('cross-game name search applies the concept-keyword tier to the other game', () => {
    // From the Hades view, "guardian" is a boss synonym that appears in no
    // H2 name, but the H2 Hecate lines live in a Boss* section, so the
    // keyword tier must still surface them cross-game.
    const res = searchCrossGameNames(_q(['guardian']), 6);
    assert.ok(res, 'expected a cross-game keyword result');
    assert.equal(res.gameId, 'hades2');
    const names = res.matches.map((m) => m.name);
    assert.ok(names.includes('HecateWeaponUpgrade01'));
    assert.ok(names.includes('HecateAboutMoros01'));
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

// --- localisation: cross-game results follow the active language ---

function localizedTwoGamePayload() {
    const p = twoGamePayload();
    // Give one H2 line a cue so its text can carry a translation.
    p.games.hades2.textlines.HecateAboutMoros01.dialogueLines[0].cue = 'Hecate_0001';
    p.languages = {
        hades1: [{ code: 'en', label: 'English' }, { code: 'ru', label: 'RU' }],
        hades2: [{ code: 'en', label: 'English' }, { code: 'ru', label: 'RU' }],
    };
    p.localization = {
        hades2: {
            ru: {
                text: { Hecate_0001: '\u041c\u043e\u0440\u043e\u0441 \u0431\u0434\u0438\u0442 \u043d\u0430\u0434 \u043d\u0430\u043c\u0438' }, // "Морос бдит над нами"
                speakers: { NPC_Hecate_01: { name: '\u0413\u0435\u043a\u0430\u0442\u0430' }, HecateUpgrade: { name: '\u0413\u0435\u043a\u0430\u0442\u0430' } }, // Геката
            },
        },
    };
    return p;
}

test('cross-game speaker search shows + matches the localised other-game name', () => {
    loadData(localizedTwoGamePayload());
    setActiveGame('hades1');
    setActiveLang('ru');
    // Matches the localised name and displays it...
    const byRu = searchCrossGameSpeakers(_q(['\u0433\u0435\u043a\u0430\u0442\u0430']), 6); // "геката"
    assert.ok(byRu, 'expected a cross-game result for the localised name');
    assert.equal(byRu.matches[0].friendly, '\u0413\u0435\u043a\u0430\u0442\u0430'); // Геката
    // ...and is still findable by the English name (English tokens kept).
    const byEn = searchCrossGameSpeakers(_q(['hecate']), 6);
    assert.ok(byEn);
    assert.equal(byEn.matches[0].friendly, '\u0413\u0435\u043a\u0430\u0442\u0430');
    setActiveLang('en');
    loadData(twoGamePayload());
});

test('cross-game name search localises the owner label', () => {
    loadData(localizedTwoGamePayload());
    setActiveGame('hades1');
    setActiveLang('ru');
    const res = searchCrossGameNames(_q(['hecate']), 6);
    assert.ok(res);
    const m = res.matches.find((x) => x.name === 'HecateWeaponUpgrade01');
    assert.equal(m.ownerLabel, '\u0413\u0435\u043a\u0430\u0442\u0430'); // Геката
    setActiveLang('en');
    loadData(twoGamePayload());
});

test('cross-game text search matches + snippets the active language', () => {
    loadData(localizedTwoGamePayload());
    setActiveGame('hades1');
    setActiveLang('ru');
    // Query the Russian word ("Морос") -> the translated line matches and the
    // snippet is the Russian text with the localised owner label.
    const res = searchCrossGameText(_q(['\u041c\u043e\u0440\u043e\u0441'.toLowerCase()]), new Set(), 6);
    assert.ok(res, 'expected a localised cross-game text match');
    const m = res.matches.find((x) => x.name === 'HecateAboutMoros01');
    assert.ok(m, 'expected the translated line to match its Russian word');
    assert.ok(/\u041c\u043e\u0440\u043e\u0441/.test(m.snippetHtml)); // snippet is Russian
    assert.equal(m.ownerLabel, '\u0413\u0435\u043a\u0430\u0442\u0430');
    // The English word no longer matches (index is the active language).
    assert.equal(searchCrossGameText(_q(['moros']), new Set(), 6), null);
    setActiveLang('en');
    loadData(twoGamePayload());
});

test('cross-game speaker search localises via a sibling when the canonical id lacks a translation', () => {
    // A group whose canonical (alphabetically-first) id has no translation but a
    // sibling does - like Melinoe (story-id untranslated, PlayerUnit translated).
    const p = twoGamePayload();
    p.games.hades2.speakers = { AaaHero_01: { name: 'Hero' }, ZzzHeroUpgrade: { name: 'Hero' } };
    p.languages = {
        hades1: [{ code: 'en', label: 'English' }, { code: 'ru', label: 'RU' }],
        hades2: [{ code: 'en', label: 'English' }, { code: 'ru', label: 'RU' }],
    };
    // Only the sibling (ZzzHeroUpgrade) carries the localised name.
    p.localization = { hades2: { ru: { text: {}, speakers: { ZzzHeroUpgrade: { name: '\u0413\u0435\u0440\u043e\u0439' } } } } }; // Герой
    loadData(p);
    setActiveGame('hades1');
    setActiveLang('ru');
    const res = searchCrossGameSpeakers(_q(['\u0433\u0435\u0440\u043e\u0439']), 6); // "герой"
    assert.ok(res, 'sibling translation should make the group findable + localised');
    assert.equal(res.matches[0].friendly, '\u0413\u0435\u0440\u043e\u0439'); // Герой
    setActiveLang('en');
    loadData(twoGamePayload());
});
