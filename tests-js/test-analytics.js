// Tests for the usage-analytics beacon in ``templates/viewer/analytics.js``.
//
// The module keeps private singleton state (per-visit sessionStorage flags with
// an in-memory fallback + the view debounce), so each test loads a FRESH module
// instance via a cache-busted dynamic import. The busted specifier only
// re-evaluates analytics.js; its static imports still resolve to the one shared
// ``data.js`` / ``speaker-groups.js`` / ``save-parser.js`` the helpers below
// populate, so canonicalisation + save detection work while every test starts
// from clean beacon state.

import { test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadFixtureData } from './fixtures.js';
import { restoreSaveProgress, clearSaveProgress, SAVE_STORAGE_SCHEMA } from '../templates/viewer/save-parser.js';

// Populate the shared dataset once so ``canonicalIdForSpeakerName`` can map a
// friendly name ('Zeus') back to its canonical id ('NPC_Zeus_01').
loadFixtureData();

let _modCounter = 0;
async function freshInitAnalytics() {
    const mod = await import('../templates/viewer/analytics.js?t=' + (++_modCounter));
    return mod.initAnalytics;
}

// A per-tab-visit sessionStorage stub (each tab has its own; survives reloads,
// cleared on tab close). Pass a shared one to two inits to simulate a reload.
function makeSessionStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}

// Seed the shared save-parser state with a restored save (as if rehydrated
// from a prior visit's localStorage), so getSaveProgress()/getSaveGameId()
// report a loaded save to analytics.
function seedSave(gameId, played) {
    const m = new Map([['hde.save', JSON.stringify({ v: SAVE_STORAGE_SCHEMA, gameId, runs: 0, played })]]);
    globalThis.localStorage = {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
    assert.ok(restoreSaveProgress(), 'seedSave: restore should succeed');
}

// A minimal ``window`` stub: records the listeners analytics registers, lets a
// test dispatch them, and captures every sendBeacon call.
function makeWindow({ protocol = 'https:', hash = '', dnt, winDnt, beacon = true, sessionStorage = makeSessionStorage() } = {}) {
    const handlers = {};
    const beacons = [];
    return {
        location: { protocol, hash },
        doNotTrack: winDnt,
        sessionStorage,
        navigator: {
            doNotTrack: dnt,
            sendBeacon: beacon ? (url, blob) => { beacons.push({ url, blob }); return true; } : undefined,
        },
        addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn({ type })); },
        setHash(h) { this.location.hash = h; },
        _beacons: beacons,
        _handlers: handlers,
    };
}

// Resolve every captured beacon body to a plain object.
async function readBeacons(win) {
    const out = [];
    for (const b of win._beacons) out.push({ url: b.url, body: JSON.parse(await b.blob.text()) });
    return out;
}

const _typed = (events, type) => events.filter((e) => e.body.type === type);

let _origDateNow;
let _origFetch;
beforeEach(() => {
    _origDateNow = Date.now;
    _origFetch = globalThis.fetch;
    clearSaveProgress();
});
afterEach(() => {
    Date.now = _origDateNow;
    if (_origFetch) globalThis.fetch = _origFetch; else delete globalThis.fetch;
    delete globalThis.window;
    clearSaveProgress();
    delete globalThis.localStorage;
});

// --- session_start -----------------------------------------------

test('emits session_start once on init, attributed to the landing game', async () => {
    const win = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    const events = await readBeacons(win);
    assert.equal(events.length, 1);
    assert.equal(events[0].url, 'api/event');
    assert.deepEqual(events[0].body, { type: 'session_start', game: 'hades2' });
});

test('session_start does not fire again on an in-tab reload (same sessionStorage)', async () => {
    const win = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    // Simulate a reload: a fresh JS module (so the in-memory flag is empty) in
    // the SAME tab (same sessionStorage). The persisted flag must suppress it.
    (await freshInitAnalytics())();
    assert.equal(_typed(await readBeacons(win), 'session_start').length, 1);
});

test('session_start fires again in a new tab (separate sessionStorage)', async () => {
    const win1 = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win1;
    (await freshInitAnalytics())();
    const win2 = makeWindow({ hash: '#game=hades2' }); // new tab -> fresh sessionStorage
    globalThis.window = win2;
    (await freshInitAnalytics())();
    assert.equal(_typed(await readBeacons(win1), 'session_start').length, 1);
    assert.equal(_typed(await readBeacons(win2), 'session_start').length, 1);
});

// --- dialogue_view -----------------------------------------------

test('counts a dialogue_view for a deep link and again on later navigation', async () => {
    const win = makeWindow({ hash: '#game=hades1&view=dialogue&dialogue=First01' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    win.setHash('#game=hades1&view=dialogue&dialogue=Second01');
    win.fire('hashchange');
    const views = _typed(await readBeacons(win), 'dialogue_view');
    assert.deepEqual(views.map((v) => v.body.id), ['First01', 'Second01']);
    assert.ok(views.every((v) => v.body.game === 'hades1'));
});

test('a bare "#dialogue=X" (no view key) still counts as a dialogue_view', async () => {
    const win = makeWindow({ hash: '#game=hades2&dialogue=Bare01' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    const views = _typed(await readBeacons(win), 'dialogue_view');
    assert.deepEqual(views.map((v) => v.body.id), ['Bare01']);
});

// --- first-visit landing exclusion -------------------------------

test('skipLandingView swallows the automatic first-visit featured-dialogue landing', async () => {
    // Post-redirect state: applyFirstVisitLanding has already written the
    // featured dialogue into the hash before analytics inits.
    const win = makeWindow({ hash: '#game=hades2&view=dialogue&dialogue=Featured01' });
    globalThis.window = win;
    (await freshInitAnalytics())({ skipLandingView: true });
    // The redirect's own async hashchange (hash is still the featured dialogue).
    win.fire('hashchange');
    const events = await readBeacons(win);
    assert.equal(_typed(events, 'session_start').length, 1);   // the visit still counts
    assert.equal(_typed(events, 'dialogue_view').length, 0);   // the default landing does not
});

test('after the swallowed landing, a genuine visit to the same dialogue still counts', async () => {
    let t = 1000; Date.now = () => t;
    const win = makeWindow({ hash: '#game=hades2&view=dialogue&dialogue=Featured01' });
    globalThis.window = win;
    (await freshInitAnalytics())({ skipLandingView: true });
    win.fire('hashchange');                                   // redirect hashchange -> swallowed
    t = 3000;                                                 // >1s later, real user navigation
    win.setHash('#game=hades2&view=dialogue&dialogue=Other01'); win.fire('hashchange');
    win.setHash('#game=hades2&view=dialogue&dialogue=Featured01'); win.fire('hashchange');
    const ids = _typed(await readBeacons(win), 'dialogue_view').map((e) => e.body.id);
    assert.deepEqual(ids, ['Other01', 'Featured01']);        // landing excluded, real visits counted
});

test('the landing guard is one-shot and keyed to the landed dialogue', async () => {
    let t = 1000; Date.now = () => t;
    const win = makeWindow({ hash: '#game=hades2&view=dialogue&dialogue=Featured01' });
    globalThis.window = win;
    (await freshInitAnalytics())({ skipLandingView: true });
    // A first hashchange to a DIFFERENT dialogue must not be swallowed, and it
    // clears the guard so a later visit to the featured dialogue also counts.
    win.setHash('#game=hades2&view=dialogue&dialogue=Other01'); win.fire('hashchange');
    t = 3000; win.setHash('#game=hades2&view=dialogue&dialogue=Featured01'); win.fire('hashchange');
    const ids = _typed(await readBeacons(win), 'dialogue_view').map((e) => e.body.id);
    assert.deepEqual(ids, ['Other01', 'Featured01']);
});

// --- speaker_view ------------------------------------------------

test('counts a speaker_view keyed by the canonical speaker id', async () => {
    const win = makeWindow();
    globalThis.window = win;
    (await freshInitAnalytics())();
    win.setHash('#game=hades1&view=speaker&speaker=Zeus');
    win.fire('hashchange');
    const sv = _typed(await readBeacons(win), 'speaker_view');
    assert.deepEqual(sv.map((e) => e.body), [{ type: 'speaker_view', game: 'hades1', id: 'NPC_Zeus_01' }]);
});

// --- session-scoped once-per-game events -------------------------

test('the cross-game duplicates view emits no analytics event', async () => {
    const win = makeWindow();
    globalThis.window = win;
    (await freshInitAnalytics())();
    win.setHash('#game=hades1&view=duplicates&dup=Hecate'); win.fire('hashchange');
    // Even with a stray dialogue key it must not fall through to dialogue_view.
    win.setHash('#game=hades1&view=duplicates&dialogue=Foo'); win.fire('hashchange');
    const events = await readBeacons(win);
    assert.equal(_typed(events, 'duplicates_open').length, 0);
    assert.equal(_typed(events, 'dialogue_view').length, 0);
});

test('eligibility view logs a per-dialogue eligibility_view (total), with no aggregate open', async () => {
    const win = makeWindow();
    globalThis.window = win;
    (await freshInitAnalytics())();
    win.setHash('#game=hades1&view=eligibility&dialogue=Foo'); win.fire('hashchange');
    win.setHash('#game=hades1&view=eligibility&dialogue=Bar'); win.fire('hashchange');
    win.setHash('#game=hades1&view=eligibility&dialogue=Foo'); win.fire('hashchange'); // re-open -> counts again
    const events = await readBeacons(win);
    // The tracer no longer emits a session-scoped aggregate event.
    assert.equal(_typed(events, 'eligibility_open').length, 0);
    // Per-dialogue is a total counter keyed by the dialogue name.
    assert.deepEqual(
        _typed(events, 'eligibility_view').map((e) => [e.body.game, e.body.id]),
        [['hades1', 'Foo'], ['hades1', 'Bar'], ['hades1', 'Foo']],
    );
});

test('a save restored from a prior visit counts as save_loaded on init', async () => {
    seedSave('hades2', ['X01']);
    const win = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    const sl = _typed(await readBeacons(win), 'save_loaded');
    assert.deepEqual(sl.map((e) => e.body.game), ['hades2']); // keyed to the save's game
    assert.ok(sl.every((e) => !('id' in e.body)));
});

test('save_loaded is emitted at most once per visit (restore + upload + reload)', async () => {
    seedSave('hades2', ['X01']);
    const win = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win;
    (await freshInitAnalytics())();   // restored save -> save_loaded
    win.fire('save-loaded');          // an active re-upload -> deduped
    (await freshInitAnalytics())();   // in-tab reload (same sessionStorage) -> deduped
    assert.equal(_typed(await readBeacons(win), 'save_loaded').length, 1);
});

test('no save present -> no save_loaded, even on a stray save-loaded event', async () => {
    clearSaveProgress();
    const win = makeWindow({ hash: '#game=hades2' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    win.fire('save-loaded'); // getSaveProgress() is null -> nothing sent
    assert.equal(_typed(await readBeacons(win), 'save_loaded').length, 0);
});

test('an active upload with no prior save emits save_loaded on the save-loaded event', async () => {
    const win = makeWindow({ hash: '#game=hades1' });
    globalThis.window = win;
    (await freshInitAnalytics())();   // no save yet
    assert.equal(_typed(await readBeacons(win), 'save_loaded').length, 0);
    seedSave('hades1', ['Y01']);      // user uploads -> save-parser now has a save
    win.fire('save-loaded');
    assert.deepEqual(_typed(await readBeacons(win), 'save_loaded').map((e) => e.body.game), ['hades1']);
});

// --- debounce ----------------------------------------------------

test('debounces an identical view repeated within 1s, but not distinct or later repeats', async () => {
    let t = 1000;
    Date.now = () => t;
    const win = makeWindow({ hash: '#game=hades1&view=dialogue&dialogue=Foo' });
    globalThis.window = win;
    (await freshInitAnalytics())();                // Foo @1000 -> count
    win.fire('hashchange');                        // Foo @1000, identical within window -> debounced
    t = 1500; win.setHash('#game=hades1&view=dialogue&dialogue=Bar'); win.fire('hashchange'); // Bar -> count
    t = 1500; win.setHash('#game=hades1&view=dialogue&dialogue=Foo'); win.fire('hashchange'); // key changed from Bar -> count
    t = 1500; win.fire('hashchange');              // Foo @1500 identical -> debounced
    t = 2600; win.fire('hashchange');              // Foo, >1s since last Foo -> count
    const ids = _typed(await readBeacons(win), 'dialogue_view').map((e) => e.body.id);
    assert.deepEqual(ids, ['Foo', 'Bar', 'Foo', 'Foo']);
});

// --- environment guards ------------------------------------------

test('stays completely silent from a file:// origin (offline bundle)', async () => {
    const win = makeWindow({ protocol: 'file:', hash: '#game=hades1&view=dialogue&dialogue=Foo' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    assert.equal(win._beacons.length, 0);
    // No listeners were registered either, so later navigation is silent too.
    win.setHash('#game=hades1&view=dialogue&dialogue=Bar'); win.fire('hashchange');
    assert.equal(win._beacons.length, 0);
});

test('honours navigator.doNotTrack = "1"', async () => {
    const win = makeWindow({ dnt: '1', hash: '#game=hades1&view=dialogue&dialogue=Foo' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    assert.equal(win._beacons.length, 0);
});

test('honours window.doNotTrack = "yes"', async () => {
    const win = makeWindow({ winDnt: 'yes', hash: '#game=hades1&view=dialogue&dialogue=Foo' });
    globalThis.window = win;
    (await freshInitAnalytics())();
    assert.equal(win._beacons.length, 0);
});

// --- transport fallback ------------------------------------------

test('falls back to fetch(keepalive) when sendBeacon is unavailable', async () => {
    const win = makeWindow({ beacon: false, hash: '#game=hades1&view=dialogue&dialogue=Foo' });
    globalThis.window = win;
    const calls = [];
    globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
    (await freshInitAnalytics())();
    assert.ok(calls.length >= 2); // session_start + dialogue_view
    assert.equal(calls[0].url, 'api/event');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.keepalive, true);
    assert.equal(calls[0].opts.credentials, 'omit');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { type: 'session_start', game: 'hades1' });
});
