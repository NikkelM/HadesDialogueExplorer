// Tests for ``detectH2Softlock`` in save-parser.js - the known Hades II
// story-softlock detector (Gigaros / HadesSpearPoints held without the
// ``ZagreusPastMeeting06`` story beat having played).

import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    detectH2Softlock,
    restoreSaveProgress,
    clearSaveProgress,
    SAVE_STORAGE_SCHEMA,
} from '../templates/viewer/save-parser.js';

const SAVE_KEY = 'hde.save';
const _store = new Map();
globalThis.localStorage = {
    getItem: k => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => { _store.set(k, String(v)); },
    removeItem: k => { _store.delete(k); },
};

// Seed a persisted save with the given gameId / played list / GameState slice,
// then restore it into the module's in-memory state (the same path a page
// reload takes).
function loadSave({ gameId = 'hades2', played = [], resources = null }) {
    const payload = {
        v: SAVE_STORAGE_SCHEMA,
        gameId,
        runs: 1,
        played,
    };
    if (resources) payload.gameState = { Resources: resources };
    _store.set(SAVE_KEY, JSON.stringify(payload));
    restoreSaveProgress();
}

beforeEach(() => {
    clearSaveProgress();
    _store.clear();
});

test('detectH2Softlock: true when Gigaros is held but ZagreusPastMeeting06 has not played', () => {
    loadSave({ gameId: 'hades2', played: ['SomeOtherLine01'], resources: { HadesSpearPoints: 1 } });
    assert.equal(detectH2Softlock(), true);
});

test('detectH2Softlock: false once ZagreusPastMeeting06 has played (normal progression)', () => {
    loadSave({ gameId: 'hades2', played: ['ZagreusPastMeeting06'], resources: { HadesSpearPoints: 1 } });
    assert.equal(detectH2Softlock(), false);
});

test('detectH2Softlock: false when the spear resource is absent or zero', () => {
    loadSave({ gameId: 'hades2', played: [], resources: { HadesSpearPoints: 0 } });
    assert.equal(detectH2Softlock(), false);
    loadSave({ gameId: 'hades2', played: [], resources: {} });
    assert.equal(detectH2Softlock(), false);
    loadSave({ gameId: 'hades2', played: [] });
    assert.equal(detectH2Softlock(), false);
});

test('detectH2Softlock: false for a Hades 1 save even with a matching-looking slice', () => {
    loadSave({ gameId: 'hades1', played: [], resources: { HadesSpearPoints: 5 } });
    assert.equal(detectH2Softlock(), false);
});

test('detectH2Softlock: false when no save is loaded', () => {
    assert.equal(detectH2Softlock(), false);
});
