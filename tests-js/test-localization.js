// Tests for the dialogue-localisation layer in ``templates/viewer/data.js``:
// the language manifest, the active-language overlay onto ``locText`` /
// ``locSpeakers`` / ``speakers``, English fallback + untranslated detection,
// the lazy-load registry, and per-game reconciliation on a game switch.

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    loadData, setActiveGame, setActiveLang, getActiveLang, isLocalized,
    getAvailableLanguages, localizeText, isUntranslated,
    setLocLoader, ensureLangLoaded, registerLocData, isLangLoaded, getLocData,
    speakers, locText,
} from '../templates/viewer/data.js';

function buildPayload() {
    return {
        games: {
            hades1: {
                textlines: { A: { dialogueLines: [{ speaker: 'NPC_Hades_01', text: 'Go.', cue: 'Hades_0001' }] } },
                speakers: { NPC_Hades_01: { name: 'Hades', description: 'God of the Dead' } },
                stats: { totalTextlines: 1, totalEdges: 0, unresolvedRefs: [] },
            },
            hades2: {
                textlines: { B: { dialogueLines: [{ speaker: 'NPC_Hades_01', text: 'Hi.', cue: 'MelHades_0001' }] } },
                speakers: { NPC_Hades_01: { name: 'Hades', description: 'Prisoner of Time' } },
                stats: { totalTextlines: 1, totalEdges: 0, unresolvedRefs: [] },
            },
        },
        gameIds: ['hades1', 'hades2'],
        gameLabels: { hades1: 'Hades', hades2: 'Hades II' },
        defaultGame: 'hades1',
        languages: {
            hades1: [{ code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }],
            hades2: [{ code: 'en', label: 'English' }, { code: 'de', label: 'Deutsch' }, { code: 'ja', label: 'JA' }],
        },
        // Bundle-style inline localisation: hades1/de only. hades2 langs are
        // intentionally omitted so the lazy-load path can be exercised.
        localization: {
            hades1: {
                de: {
                    text: { Hades_0001: 'Geh.' },
                    speakers: { NPC_Hades_01: { name: 'Hades-DE', description: 'Gott der Toten' } },
                },
            },
        },
    };
}

beforeEach(() => {
    setLocLoader(null);
    loadData(buildPayload());
});

test('manifest is per-game and English is the default active language', () => {
    setActiveGame('hades1');
    assert.equal(getActiveLang(), 'en');
    assert.equal(isLocalized(), false);
    assert.deepEqual(getAvailableLanguages().map((l) => l.code), ['en', 'de']);
    setActiveGame('hades2');
    assert.deepEqual(getAvailableLanguages().map((l) => l.code), ['en', 'de', 'ja']);
});

test('activating a language overlays text and speaker maps', () => {
    setActiveGame('hades1');
    setActiveLang('de');
    assert.equal(isLocalized(), true);
    assert.equal(localizeText('Hades_0001', 'Go.'), 'Geh.');
    // Speaker name + description overlaid so every ``speakers[id].name`` reader
    // localises for free.
    assert.equal(speakers.NPC_Hades_01.name, 'Hades-DE');
    assert.equal(speakers.NPC_Hades_01.description, 'Gott der Toten');
    assert.equal(locText.Hades_0001, 'Geh.');
});

test('English fallback for untranslated ids and restore on switch back', () => {
    setActiveGame('hades1');
    setActiveLang('de');
    // An id with no translation falls back to the English text and is flagged.
    assert.equal(localizeText('Missing_9999', 'English line'), 'English line');
    assert.equal(isUntranslated('Missing_9999'), true);
    assert.equal(isUntranslated('Hades_0001'), false);
    // No id at all (inline narration) counts as untranslated.
    assert.equal(isUntranslated(null), true);
    // Back to English: fallback everywhere, base speaker restored.
    setActiveLang('en');
    assert.equal(isUntranslated('Missing_9999'), false);
    assert.equal(localizeText('Hades_0001', 'Go.'), 'Go.');
    assert.equal(speakers.NPC_Hades_01.name, 'Hades');
});

test('an empty-string translation falls back to English and is flagged untranslated', () => {
    setActiveGame('hades1');
    // Some shipped subtitles clean to an empty string in a given language.
    registerLocData('hades1', 'de', {
        text: { Hades_0001: 'Geh.', Blank_0001: '' },
        speakers: {},
    });
    setActiveLang('de');
    // A non-empty translation is used as-is...
    assert.equal(localizeText('Hades_0001', 'Go.'), 'Geh.');
    assert.equal(isUntranslated('Hades_0001'), false);
    // ...but an empty translation must NOT render blank: it falls back to the
    // English text and is flagged so the EN marker shows.
    assert.equal(localizeText('Blank_0001', 'English blank-fallback'), 'English blank-fallback');
    assert.equal(isUntranslated('Blank_0001'), true);
});

test('lazy loads a language map via the registered loader', async () => {
    setActiveGame('hades2');
    let requested = null;
    setLocLoader((game, lang) => {
        requested = `${game}:${lang}`;
        registerLocData(game, lang, {
            text: { MelHades_0001: 'Hallo.' },
            speakers: { NPC_Hades_01: { name: 'Hades-DE2' } },
        });
        return Promise.resolve();
    });
    assert.equal(isLangLoaded('hades2', 'de'), false);
    const ok = await ensureLangLoaded('hades2', 'de');
    assert.equal(ok, true);
    assert.equal(requested, 'hades2:de');
    setActiveLang('de');
    assert.equal(localizeText('MelHades_0001', 'Hi.'), 'Hallo.');
    assert.equal(speakers.NPC_Hades_01.name, 'Hades-DE2');
});

test('registerLocData for the active game+lang applies immediately', () => {
    setActiveGame('hades2');
    setActiveLang('de'); // not loaded yet -> overlay is English
    assert.equal(speakers.NPC_Hades_01.name, 'Hades');
    registerLocData('hades2', 'de', {
        text: { MelHades_0001: 'Hallo.' },
        speakers: { NPC_Hades_01: { name: 'Hades-DE2' } },
    });
    // Auto-applied because it is the active game+language.
    assert.equal(speakers.NPC_Hades_01.name, 'Hades-DE2');
    assert.equal(localizeText('MelHades_0001', 'Hi.'), 'Hallo.');
});

test('English needs no loader (always "loaded")', () => {
    setActiveGame('hades1');
    assert.equal(isLangLoaded('hades1', 'en'), true);
    assert.equal(isLangLoaded('hades2', 'ja'), false);
});

test('getLocData exposes a registered map and it survives loadData\'s reset via the payload', () => {
    // ``loadData`` runs ``_resetLocalizations`` then re-registers any map in the
    // payload's ``localization`` key. Boot relies on this to carry a language it
    // preloaded before ``loadData`` (the split build) so the reset does not drop
    // it and force a redundant re-fetch + English-then-swap flash.
    setActiveGame('hades1');
    const blob = getLocData('hades1', 'de');
    assert.ok(blob && blob.text && blob.text.Hades_0001 === 'Geh.');
    // English has no blob (inline default); an unregistered game+lang is null.
    assert.equal(getLocData('hades1', 'en'), null);
    assert.equal(getLocData('hades2', 'de'), null);
});

test('game switch re-applies the overlay for the newly active game', () => {
    setActiveGame('hades1');
    setActiveLang('de');
    assert.equal(speakers.NPC_Hades_01.name, 'Hades-DE');
    // Switching to hades2 (whose de map is not loaded) reverts to English until
    // its map arrives - no stale hades1 overlay leaks across.
    setActiveGame('hades2');
    assert.equal(speakers.NPC_Hades_01.name, 'Hades');
    assert.equal(localizeText('MelHades_0001', 'Hi.'), 'Hi.');
});
