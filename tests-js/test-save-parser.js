// Tests for the in-browser save parser (save-parser.js):
//   * ``decompressLz4Block`` - the inline LZ4 block decompressor, focusing
//     on the output-buffer growth path (the save format doesn't store the
//     uncompressed size, so the buffer starts from a hint and must grow
//     without truncating or corrupting output when a block exceeds it).
//   * ``parseSaveFile`` - the full SGB1 -> LZ4 -> luabins -> TextLinesRecord
//     decode path, exercised via a synthetic round-trip (encode a payload,
//     frame it as an SGB1 save, parse it back). A synthetic fixture keeps
//     the test deterministic and avoids committing a real Profile*.sav
//     (which would expose actual play progress); the encode side mirrors
//     the documented format the decoder reads.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    decompressLz4Block,
    parseSaveFile,
    isDialoguePlayed,
    getDialogueStatus,
    getSaveProgress,
    getSaveGameId,
    getSaveRuns,
    clearSaveProgress,
    persistSaveProgress,
    restoreSaveProgress,
    clearPersistedSave,
    extractH1GameStateSlice,
    extractH1CurrentRunSlice,
    extractH1PrevRunSlice,
    getSaveInRun,
    validateSaveFilename,
    getSaveContext,
} from '../templates/viewer/save-parser.js';
import { loadData, registerGameData, registerDataFingerprints } from '../templates/viewer/data.js';

// Build an LZ4 block of `n` literal bytes (0,1,2,... mod 256), no matches.
function literalBlock(n) {
    const bytes = [];
    let lit = n;
    if (lit < 15) {
        bytes.push(lit << 4);
    } else {
        bytes.push(0xF0); // literalLen nibble = 15 -> needs extension
        lit -= 15;
        while (lit >= 255) { bytes.push(255); lit -= 255; }
        bytes.push(lit);
    }
    for (let i = 0; i < n; i++) bytes.push(i & 0xFF);
    return new Uint8Array(bytes);
}

function expectedLiterals(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = i & 0xFF;
    return out;
}

test('decompresses a small literal block within the initial buffer', () => {
    const out = decompressLz4Block(literalBlock(5), 1024);
    assert.deepEqual([...out], [...expectedLiterals(5)]);
});

test('grows the buffer when output exceeds the initial size (literal path)', () => {
    // 4000 literal bytes but only a 16-byte initial buffer -> must grow.
    const out = decompressLz4Block(literalBlock(4000), 16);
    assert.equal(out.length, 4000);
    assert.deepEqual([...out], [...expectedLiterals(4000)]);
});

test('grows the buffer in the match-copy path', () => {
    // 2 literals "AB" then a back-reference producing "ABABAB" (6 bytes),
    // with a 2-byte initial buffer so the match copy forces growth.
    // token: literalLen=2, matchLen nibble=0 (+4); offset=2 (LE).
    const block = new Uint8Array([0x20, 0x41, 0x42, 0x02, 0x00]);
    const out = decompressLz4Block(block, 2);
    assert.equal(String.fromCharCode(...out), 'ABABAB');
});

test('handles a block exactly at the initial capacity boundary', () => {
    const out = decompressLz4Block(literalBlock(14), 14);
    assert.equal(out.length, 14);
    assert.deepEqual([...out], [...expectedLiterals(14)]);
});


// --- Synthetic SGB1 save builder (encode side of the round-trip) ---
//
// These mirror the decode logic in save-parser.js so a save can be built
// in-memory and parsed back. Luabins values are tagged the same way the
// decoder expects ('-' nil, '0' false, '1' true, 'N' f64, 'S' string,
// 'T' table); the luabins payload is wrapped in an all-literals LZ4 block
// (a valid block the decompressor reads back verbatim) and framed in the
// SGB1 header layout parseSGB1 walks.

const GAME_VERSION_HADES1 = 0x10;
const GAME_VERSION_HADES2 = 0x11;
const GAME_VERSION_HADES2_PATCH11 = 0x12;

function pushU32(bytes, n) {
    bytes.push(n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF);
}

function pushString(bytes, s) {
    const enc = new TextEncoder().encode(s);
    pushU32(bytes, enc.length);
    for (const b of enc) bytes.push(b);
}

// Encode a JS value as a tagged luabins value (type byte + payload),
// matching readValue() in save-parser.js. Objects become hash-only tables.
function encodeLuabinsValue(bytes, value) {
    if (value === null) { bytes.push(45); return; }
    if (value === true) { bytes.push(49); return; }
    if (value === false) { bytes.push(48); return; }
    if (typeof value === 'number') {
        bytes.push(78); // 'N'
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, value, true);
        for (const b of new Uint8Array(buf)) bytes.push(b);
        return;
    }
    if (typeof value === 'string') {
        bytes.push(83); // 'S'
        pushString(bytes, value);
        return;
    }
    bytes.push(84); // 'T'
    const keys = Object.keys(value);
    pushU32(bytes, 0);            // arraySize
    pushU32(bytes, keys.length);  // hashSize
    for (const k of keys) {
        encodeLuabinsValue(bytes, k);
        encodeLuabinsValue(bytes, value[k]);
    }
}

// Top-level luabins blob: a u8 value count followed by each tagged value.
function encodeLuabins(values) {
    const bytes = [values.length & 0xFF];
    for (const v of values) encodeLuabinsValue(bytes, v);
    return bytes;
}

// Wrap arbitrary bytes in a single all-literals LZ4 block (matchLen nibble
// 0, no back-reference) - the decompressor copies the literals then stops
// at end-of-input.
function lz4LiteralBlock(payload) {
    const bytes = [];
    let lit = payload.length;
    if (lit < 15) {
        bytes.push(lit << 4);
    } else {
        bytes.push(0xF0);
        lit -= 15;
        while (lit >= 255) { bytes.push(255); lit -= 255; }
        bytes.push(lit);
    }
    for (const b of payload) bytes.push(b);
    return bytes;
}

function buildSGB1({ gameVersion, completedRuns = 0, luaState }) {
    const block = lz4LiteralBlock(encodeLuabins([luaState]));
    const bytes = [];
    bytes.push(0x53, 0x47, 0x42, 0x31);   // "SGB1"
    pushU32(bytes, 0);                     // checksum
    bytes.push(gameVersion & 0xFF, (gameVersion >> 8) & 0xFF); // u16 version
    bytes.push(0, 0);                      // saveFlags
    for (let i = 0; i < 8; i++) bytes.push(0); // timestamp
    pushU32(bytes, 0);                     // location string length (none)
    pushU32(bytes, completedRuns);
    pushU32(bytes, 0);                     // accumulatedMetaPoints
    pushU32(bytes, 0);                     // activeShrinePoints
    if (gameVersion === GAME_VERSION_HADES2 || gameVersion === GAME_VERSION_HADES2_PATCH11) {
        pushU32(bytes, 0);                 // metaUpgradeLevel (H2)
    }
    if (gameVersion === GAME_VERSION_HADES2_PATCH11) {
        pushU32(bytes, 0);                 // cosmeticsPoints (H2 patch 11)
    }
    bytes.push(0);                         // easyMode
    bytes.push(0);                         // hardMode
    pushU32(bytes, 0);                     // notableLuaData vec count
    pushU32(bytes, 0);                     // mapName length
    pushU32(bytes, 0);                     // mapName2 length
    pushU32(bytes, block.length);          // compressed payload length
    for (const b of block) bytes.push(b);
    return new Uint8Array(bytes).buffer;
}


// --- parseSaveFile round-trip ---

test('parses a Hades 1 save: gameId, runs and played-line set', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        completedRuns: 42,
        luaState: { TextLinesRecord: { AphroditeAboutLove01: true, ZeusFirstPickUp01: true } },
    });
    const result = parseSaveFile(buf);
    assert.equal(result.gameId, 'hades1');
    assert.equal(result.completedRuns, 42);
    assert.equal(result.count, 2);
    assert.equal(getSaveGameId(), 'hades1');
    assert.equal(getSaveRuns(), 42);
    assert.equal(isDialoguePlayed('AphroditeAboutLove01'), true);
    assert.equal(isDialoguePlayed('ZeusFirstPickUp01'), true);
    assert.equal(isDialoguePlayed('NeverPlayed01'), false);
    assert.deepEqual(
        [...getSaveProgress()].sort(),
        ['AphroditeAboutLove01', 'ZeusFirstPickUp01'],
    );
});

test('parses a Hades 2 save: TextLinesRecord nested under GameState', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        completedRuns: 7,
        luaState: { GameState: { TextLinesRecord: { ArtemisHubFirstMeeting01: true } } },
    });
    const result = parseSaveFile(buf);
    assert.equal(result.gameId, 'hades2');
    assert.equal(result.completedRuns, 7);
    assert.equal(result.count, 1);
    assert.equal(isDialoguePlayed('ArtemisHubFirstMeeting01'), true);
});

test('parses a Hades 2 patch-11 save (extra cosmeticsPoints header field)', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES2_PATCH11,
        completedRuns: 3,
        luaState: { GameState: { TextLinesRecord: { MoodWhenMet01: true } } },
    });
    const result = parseSaveFile(buf);
    assert.equal(result.gameId, 'hades2');
    assert.equal(result.completedRuns, 3);
    assert.equal(result.count, 1);
});

// --- hub vs in-run classification (from contents, not filename) ---

test('validateSaveFilename accepts any .sav name, rejects the rest', () => {
    // Canonical and custom-renamed names are all accepted.
    for (const ok of ['Profile1.sav', 'Profile2_Temp.sav', 'Profile1 Something else.sav',
        'Profile2_Temp Testing thing.sav', 'my run.SAV', 'backup.sav']) {
        assert.equal(validateSaveFilename(ok), true, ok);
    }
    for (const bad of ['notasave.txt', 'Profile1.sav.bak', 'save', '', null, undefined]) {
        assert.equal(validateSaveFilename(bad), false, String(bad));
    }
});

test('detectInRun: Hades 1 hub vs in-run save read from contents', () => {
    const parse = (luaState) => { clearSaveProgress(); parseSaveFile(buildSGB1({ gameVersion: GAME_VERSION_HADES1, luaState })); return getSaveInRun(); };
    // Hub markers -> hub save (false), even with no filename.
    assert.equal(parse({ CurrentRun: { Hero: { IsDead: true } } }), false);   // death-flagged hero
    assert.equal(parse({ CurrentDeathAreaRoom: { Name: 'DeathArea' } }), false); // in the House
    assert.equal(parse({ GameState: { LocationName: 'Location_Home' } }), false); // boot/transition fallback
    // No hub marker -> in-run save (true).
    assert.equal(parse({ CurrentRun: { Hero: { IsDead: false }, CurrentRoom: { Name: 'A_Combat01' } }, GameState: { LocationName: 'Location_BiomeA' } }), true);
    assert.equal(parse({ CurrentRun: {} }), true);
});

test('detectInRun: Hades 2 hub vs in-run save read from contents', () => {
    const parse = (luaState) => { clearSaveProgress(); parseSaveFile(buildSGB1({ gameVersion: GAME_VERSION_HADES2, luaState })); return getSaveInRun(); };
    // Hub markers -> hub save (false).
    assert.equal(parse({ CurrentHubRoom: { Name: 'Hub_Main' } }), false);
    assert.equal(parse({ GameState: { LocationName: 'Location_Home' } }), false);
    // No hub marker -> in-run save (true). H1's IsDead marker must NOT leak into H2.
    assert.equal(parse({ GameState: { LocationName: 'Location_BiomeF' } }), true);
    assert.equal(parse({ CurrentRun: { Hero: { IsDead: true } }, GameState: {} }), true);
});

test('rejects a buffer without the SGB1 magic', () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]).buffer;
    assert.throws(() => parseSaveFile(bad), /Not an SGB1 save file/);
});

test('rejects an unknown game version', () => {
    const buf = buildSGB1({
        gameVersion: 0x99,
        luaState: { TextLinesRecord: {} },
    });
    assert.throws(() => parseSaveFile(buf), /Unknown game version/);
});

test('an empty TextLinesRecord yields an empty played set', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: {} },
    });
    assert.equal(parseSaveFile(buf).count, 0);
    assert.equal(isDialoguePlayed('Anything01'), false);
});

test('getDialogueStatus reflects the parsed save: played / eligible / blocked', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Done01: true } },
    });
    parseSaveFile(buf);
    // Already in the record -> played (requirements irrelevant).
    assert.equal(getDialogueStatus('Done01', { requirements: {} }), 'played');
    // Not played, prerequisite satisfied -> eligible.
    assert.equal(
        getDialogueStatus('Next01', { requirements: { RequiredTextLines: ['Done01'] } }),
        'eligible',
    );
    // Not played, prerequisite missing -> blocked.
    assert.equal(
        getDialogueStatus('Later01', { requirements: { RequiredTextLines: ['Missing01'] } }),
        'blocked',
    );
});

test('folds H2 TextLinesChoiceRecord into the played set as synthetic variants', () => {
    clearSaveProgress();
    const buf = buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        luaState: {
            GameState: {
                TextLinesRecord: { ErisBecomingCloser01: true },
                TextLinesChoiceRecord: { ErisBecomingCloser01: 'Choice_ErisAccept' },
            },
        },
    });
    const result = parseSaveFile(buf);
    // The parent line plus its <parent><ChoiceText> synthetic variant.
    assert.equal(result.count, 2);
    assert.equal(isDialoguePlayed('ErisBecomingCloser01'), true);
    assert.equal(isDialoguePlayed('ErisBecomingCloser01Choice_ErisAccept'), true);
    // A choice-gated dialogue then evaluates as eligible.
    assert.equal(
        getDialogueStatus('ErisBossAboutBecomingCloser01', {
            requirements: { RequiredAnyTextLines: ['ErisBecomingCloser01Choice_ErisAccept'] },
        }),
        'eligible',
    );
});

test('getDialogueStatus reports a chosen-differently choice variant as unobtainable, not eligible', () => {
    clearSaveProgress();
    // The player reached choice dialogue P and recorded Choice_B. The sibling
    // variant PChoice_A can never be obtained, even though its only requirement
    // (parent P played) is satisfied - so directSatisfaction reads 'met'. The
    // structural lock must win over that 'eligible' verdict.
    const variantA = {
        owner: 'NPC_Test_01',
        requirements: { RequiredTextLines: ['P'] },
        isSynthetic: true, parentTextline: 'P', choiceText: 'Choice_A',
    };
    loadData({
        textlines: {
            P: { owner: 'NPC_Test_01', requirements: {} },
            PChoice_A: variantA,
            PChoice_B: {
                owner: 'NPC_Test_01', requirements: { RequiredTextLines: ['P'] },
                isSynthetic: true, parentTextline: 'P', choiceText: 'Choice_B',
            },
        },
    });
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        luaState: {
            GameState: {
                TextLinesRecord: { P: true },
                TextLinesChoiceRecord: { P: 'Choice_B' },
            },
        },
    }));
    assert.equal(getDialogueStatus('PChoice_A', variantA), 'unobtainable');
    clearSaveProgress();
});

test('clearSaveProgress resets the parsed state', () => {
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { X01: true } },
    }));
    clearSaveProgress();
    assert.equal(getSaveProgress(), null);
    assert.equal(getSaveGameId(), null);
    assert.equal(getSaveRuns(), null);
    // With no save loaded, status queries return null (unknown).
    assert.equal(isDialoguePlayed('X01'), null);
    assert.equal(getDialogueStatus('X01', { requirements: {} }), null);
});

test('getDialogueStatus reports a permanently-locked dialogue as unobtainable', () => {
    clearSaveProgress();
    // ``Locked`` must NOT have played ``Foe``; once ``Foe`` is played it can
    // never become eligible again (the mutually-exclusive pattern).
    const locked = { owner: 'NPC_Test_01', requirements: { RequiredFalseTextLines: ['Foe'] } };
    loadData({ textlines: { Locked: locked, Foe: { owner: 'NPC_Test_01', requirements: {} } } });
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true } },
    }));
    assert.equal(getDialogueStatus('Locked', locked), 'unobtainable');
    clearSaveProgress();
});

test('getDialogueStatus reports indeterminate (not blocked/unobtainable) for save-unverifiable gates', () => {
    clearSaveProgress();
    const scopedNeg = { owner: 'NPC_Test_01', requirements: { RequiredFalseTextLinesThisRun: ['Foe'] } };
    const scopedMix = { owner: 'NPC_Test_01', requirements: { RequiredTextLines: ['Foe'], RequiredFalseTextLinesThisRun: ['Foe'] } };
    loadData({
        textlines: {
            ScopedNeg: scopedNeg, ScopedMix: scopedMix,
            Foe: { owner: 'NPC_Test_01', requirements: {} },
        },
    });
    // No CurrentRun in this save -> the this-run record is unavailable, so a
    // run-scoped gate can't be resolved.
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true } },
    }));
    // Foe is in the cumulative save, but "this run" scoping is unavailable, so
    // a run-scoped negative is indeterminate - NOT a permanent lock (that
    // distinction is reserved for the global RequiredFalseTextLines).
    assert.equal(getDialogueStatus('ScopedNeg', scopedNeg), 'indeterminate');
    // Global requirement satisfied + a run-scoped gate remaining -> can't tell.
    assert.equal(getDialogueStatus('ScopedMix', scopedMix), 'indeterminate');
    clearSaveProgress();
});

test('getDialogueStatus resolves *ThisRun / *ThisRoom gates against the CurrentRun records', () => {
    clearSaveProgress();
    const runNeg = { owner: 'NPC_Test_01', requirements: { RequiredFalseTextLinesThisRun: ['Foe'] } };
    const runPos = { owner: 'NPC_Test_01', requirements: { RequiredTextLinesThisRun: ['Foe'] } };
    const roomNeg = { owner: 'NPC_Test_01', requirements: { RequiredFalseTextLinesThisRoom: ['Foe'] } };
    loadData({
        textlines: {
            RunNeg: runNeg, RunPos: runPos, RoomNeg: roomNeg,
            Foe: { owner: 'NPC_Test_01', requirements: {} },
        },
    });
    // Foe is in the global record but NOT this run/room -> the scoped gates
    // resolve against the (empty) CurrentRun records.
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true }, CurrentRun: { TextLinesRecord: {}, CurrentRoom: { TextLinesRecord: {} } } },
    }));
    assert.equal(getDialogueStatus('RunNeg', runNeg), 'eligible');  // not played this run -> "must not" met
    assert.equal(getDialogueStatus('RunPos', runPos), 'blocked');   // not played this run -> "must" unmet
    assert.equal(getDialogueStatus('RoomNeg', roomNeg), 'eligible'); // not played this room -> "must not" met
    // Now Foe IS played this run and this room -> the verdicts flip.
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true }, CurrentRun: { TextLinesRecord: { Foe: true }, CurrentRoom: { TextLinesRecord: { Foe: true } } } },
    }));
    assert.equal(getDialogueStatus('RunNeg', runNeg), 'blocked');   // played this run -> "must not" unmet
    assert.equal(getDialogueStatus('RunPos', runPos), 'eligible');  // played this run -> "must" met
    assert.equal(getDialogueStatus('RoomNeg', roomNeg), 'blocked'); // played this room -> "must not" unmet
    clearSaveProgress();
});

test('getDialogueStatus resolves *LastRun gates against GameState.RunHistory[#]', () => {
    clearSaveProgress();
    const lastNeg = { owner: 'NPC_Test_01', requirements: { RequiredFalseTextLinesLastRun: ['Foe'] } };
    const lastAny = { owner: 'NPC_Test_01', requirements: { RequiredAnyTextLinesLastRun: ['Foe'] } };
    loadData({ textlines: { LastNeg: lastNeg, LastAny: lastAny, Foe: { owner: 'NPC_Test_01', requirements: {} } } });
    // Last run = the highest RunHistory index. Here run 2 (the latest) played
    // Foe; run 1 did not.
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: {}, GameState: { RunHistory: { 1: { TextLinesRecord: {} }, 2: { TextLinesRecord: { Foe: true } } } } },
    }));
    assert.equal(getDialogueStatus('LastNeg', lastNeg), 'blocked');  // Foe played last run -> "must not" unmet
    assert.equal(getDialogueStatus('LastAny', lastAny), 'eligible'); // Foe played last run -> "any" met
    // Foe only in an OLDER run (run 1), not the last (run 2) -> verdicts flip.
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: {}, GameState: { RunHistory: { 1: { TextLinesRecord: { Foe: true } }, 2: { TextLinesRecord: {} } } } },
    }));
    assert.equal(getDialogueStatus('LastNeg', lastNeg), 'eligible'); // not in last run -> "must not" met
    assert.equal(getDialogueStatus('LastAny', lastAny), 'blocked');  // not in last run -> "any" unmet
    // No completed runs at all -> empty last-run record (the game treats a
    // missing prior run the same way: the negative passes, the OR fails).
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: {}, GameState: { RunHistory: {} } },
    }));
    assert.equal(getDialogueStatus('LastNeg', lastNeg), 'eligible');
    assert.equal(getDialogueStatus('LastAny', lastAny), 'blocked');
    clearSaveProgress();
});

test('getDialogueStatus resolves run-count gates via the RunHistory recent-run sequence', () => {
    clearSaveProgress();
    const minGate = { owner: 'NPC_Test_01', requirements: { MinRunsSinceAnyTextLines: ['Foe'] }, otherRequirements: { MinRunsSinceAnyTextLines: { Count: 3 } } };
    const maxGate = { owner: 'NPC_Test_01', requirements: { MaxRunsSinceAnyTextLines: ['Foe'] }, otherRequirements: { MaxRunsSinceAnyTextLines: { Count: 3 } } };
    loadData({ textlines: { MinGate: minGate, MaxGate: maxGate, Foe: { owner: 'NPC_Test_01', requirements: {} } } });
    // Foe last played 1 run ago (RunHistory[2] = last completed run; no active run).
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true }, GameState: { RunHistory: { 1: { TextLinesRecord: {} }, 2: { TextLinesRecord: { Foe: true } } } } },
    }));
    assert.equal(getDialogueStatus('MinGate', minGate), 'blocked');  // 1 run ago < 3 -> too recent
    assert.equal(getDialogueStatus('MaxGate', maxGate), 'eligible'); // 1 run ago <= 3 -> within
    // Foe last played 6 runs ago (only the oldest of 6 completed runs had it).
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { Foe: true }, GameState: { RunHistory: {
            1: { TextLinesRecord: { Foe: true } }, 2: { TextLinesRecord: {} }, 3: { TextLinesRecord: {} },
            4: { TextLinesRecord: {} }, 5: { TextLinesRecord: {} }, 6: { TextLinesRecord: {} },
        } } },
    }));
    assert.equal(getDialogueStatus('MinGate', minGate), 'eligible'); // 6 runs ago >= 3 -> met
    assert.equal(getDialogueStatus('MaxGate', maxGate), 'blocked');  // 6 runs ago > 3 -> too long ago
    clearSaveProgress();
});


// save-parser.js caches the derived save state so it survives a reload.
// Node has no localStorage, so these tests install a minimal in-memory
// stand-in on ``globalThis`` and remove it afterwards. The parser reads
// ``localStorage`` through a guarded accessor, so the absence of this
// mock must degrade to a silent no-op rather than throwing.

function installMockLocalStorage() {
    const map = new Map();
    const mock = {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        clear: () => { map.clear(); },
        _map: map,
    };
    globalThis.localStorage = mock;
    return mock;
}

function uninstallMockLocalStorage() {
    delete globalThis.localStorage;
}

test('persist then restore round-trips the derived save state', () => {
    const store = installMockLocalStorage();
    try {
        clearSaveProgress();
        parseSaveFile(buildSGB1({
            gameVersion: GAME_VERSION_HADES2,
            completedRuns: 9,
            luaState: { GameState: { TextLinesRecord: { LineA01: true, LineB01: true } } },
        }));
        assert.equal(persistSaveProgress('Profile2.sav'), true);
        assert.ok(store.getItem('hde.save'), 'cache entry should be written');

        // Wipe the in-memory state, then restore from the cache.
        clearSaveProgress();
        assert.equal(getSaveProgress(), null);

        const summary = restoreSaveProgress();
        assert.equal(summary.gameId, 'hades2');
        assert.equal(summary.completedRuns, 9);
        assert.equal(summary.count, 2);
        assert.equal(summary.filename, 'Profile2.sav');
        assert.equal(getSaveGameId(), 'hades2');
        assert.equal(getSaveRuns(), 9);
        assert.equal(isDialoguePlayed('LineA01'), true);
        assert.equal(isDialoguePlayed('LineB01'), true);
        assert.equal(isDialoguePlayed('NeverPlayed01'), false);
    } finally {
        clearSaveProgress();
        uninstallMockLocalStorage();
    }
});

test('clearPersistedSave removes the cached entry', () => {
    const store = installMockLocalStorage();
    try {
        parseSaveFile(buildSGB1({
            gameVersion: GAME_VERSION_HADES1,
            luaState: { TextLinesRecord: { X01: true } },
        }));
        persistSaveProgress('Profile1.sav');
        assert.ok(store.getItem('hde.save'));
        clearPersistedSave();
        assert.equal(store.getItem('hde.save'), null);
        assert.equal(restoreSaveProgress(), null);
    } finally {
        clearSaveProgress();
        uninstallMockLocalStorage();
    }
});

test('restoreSaveProgress drops a schema-mismatched cache and returns null', () => {
    const store = installMockLocalStorage();
    try {
        store.setItem('hde.save', JSON.stringify({
            v: 999, gameId: 'hades2', runs: 1, played: ['Old01'],
        }));
        assert.equal(restoreSaveProgress(), null);
        // The stale entry is purged so it isn't retried on every load.
        assert.equal(store.getItem('hde.save'), null);
    } finally {
        clearSaveProgress();
        uninstallMockLocalStorage();
    }
});

test('restoreSaveProgress drops a corrupt (unparseable) cache and returns null', () => {
    const store = installMockLocalStorage();
    try {
        store.setItem('hde.save', '{not valid json');
        assert.equal(restoreSaveProgress(), null);
        assert.equal(store.getItem('hde.save'), null);
    } finally {
        clearSaveProgress();
        uninstallMockLocalStorage();
    }
});

test('restoreSaveProgress rejects a tampered gameId and returns null', () => {
    const store = installMockLocalStorage();
    try {
        store.setItem('hde.save', JSON.stringify({
            v: 15, gameId: 'hades3', runs: 1, played: ['Old01'],
        }));
        assert.equal(restoreSaveProgress(), null);
        // The invalid entry is purged so restore fails closed.
        assert.equal(store.getItem('hde.save'), null);
    } finally {
        clearSaveProgress();
        uninstallMockLocalStorage();
    }
});

test('persist stamps the build data fingerprint and restore accepts a match', () => {
    const store = installMockLocalStorage();
    registerDataFingerprints({ hades2: 'fp-abc123' });
    try {
        clearSaveProgress();
        parseSaveFile(buildSGB1({
            gameVersion: GAME_VERSION_HADES2,
            completedRuns: 2,
            luaState: { GameState: { TextLinesRecord: { LineA01: true } } },
        }));
        assert.equal(persistSaveProgress('P.sav'), true);
        const cached = JSON.parse(store.getItem('hde.save'));
        assert.equal(cached.dataFingerprint, 'fp-abc123', 'persist stamps the current fingerprint');
        clearSaveProgress();
        assert.ok(restoreSaveProgress(), 'a matching fingerprint restores');
        assert.equal(getSaveGameId(), 'hades2');
    } finally {
        clearSaveProgress();
        registerDataFingerprints({});
        uninstallMockLocalStorage();
    }
});

test('restoreSaveProgress drops a cache whose data fingerprint no longer matches the build', () => {
    const store = installMockLocalStorage();
    registerDataFingerprints({ hades2: 'fp-OLD' });
    try {
        clearSaveProgress();
        parseSaveFile(buildSGB1({
            gameVersion: GAME_VERSION_HADES2,
            luaState: { GameState: { TextLinesRecord: { LineA01: true } } },
        }));
        persistSaveProgress('P.sav'); // stamped with fp-OLD
        clearSaveProgress();
        // A data-only rebuild bumps the fingerprint without bumping the schema.
        registerDataFingerprints({ hades2: 'fp-NEW' });
        assert.equal(restoreSaveProgress(), null, 'mismatched fingerprint -> drop');
        assert.equal(store.getItem('hde.save'), null, 'stale cache purged');
    } finally {
        clearSaveProgress();
        registerDataFingerprints({});
        uninstallMockLocalStorage();
    }
});

test('restoreSaveProgress keeps a cache when the build ships no fingerprint (best-effort)', () => {
    installMockLocalStorage();
    registerDataFingerprints({ hades2: 'fp-abc' });
    try {
        clearSaveProgress();
        parseSaveFile(buildSGB1({
            gameVersion: GAME_VERSION_HADES2,
            luaState: { GameState: { TextLinesRecord: { LineA01: true } } },
        }));
        persistSaveProgress('P.sav'); // stamped fp-abc
        clearSaveProgress();
        // Current build exposes no fingerprint for the game (bundle / test).
        registerDataFingerprints({});
        assert.ok(restoreSaveProgress(), 'no expected fingerprint -> check skipped');
        assert.equal(getSaveGameId(), 'hades2');
    } finally {
        clearSaveProgress();
        registerDataFingerprints({});
        uninstallMockLocalStorage();
    }
});

// --- Hades 1 save-slice extraction ---
// The H1 evaluator reads a pruned slice of the raw save. These tests cover the
// pruning shape: copying referenced top-level GameState keys, reducing
// RunHistory / RoomHistory to the per-run fields the aggregates need, and the
// PrevRun = newest-completed-run derivation.

test('extractH1GameStateSlice copies referenced keys and prunes RunHistory', () => {
    const slice = extractH1GameStateSlice({
        EnemyKills: { Harpy: 3 },
        Flags: { SeenIntro: true },
        SomeIrrelevantHugeTable: { a: 1, b: 2 },
        RunHistory: {
            1: { Cleared: true, WeaponsCache: { Sword: true }, GameplayTime: 1200, RunDepthCache: 60, EasyModeLevel: 3, Junk: 'drop-me' },
            2: { Cleared: false, WeaponsCache: {} },
        },
    });
    assert.deepEqual(slice.EnemyKills, { Harpy: 3 });
    assert.deepEqual(slice.Flags, { SeenIntro: true });
    // Unreferenced top-level keys are dropped.
    assert.equal('SomeIrrelevantHugeTable' in slice, false);
    // RunHistory is pruned to the run-count + best-clear-time fields.
    assert.deepEqual(slice.RunHistory['1'], { Cleared: true, WeaponsCache: { Sword: true }, GameplayTime: 1200, RunDepthCache: 60, EasyModeLevel: 3 });
    assert.deepEqual(slice.RunHistory['2'], { Cleared: false, WeaponsCache: {} });
});

test('extractH1GameStateSlice returns null for a non-object GameState', () => {
    assert.equal(extractH1GameStateSlice(null), null);
    assert.equal(extractH1GameStateSlice(undefined), null);
});

test('extractH1GameStateSlice captures top-level SpeechRecord / CodexStatus pruned to referenced names', () => {
    // The H1 codex / speech gates read top-level globals (siblings of GameState,
    // not under it). Loading data whose textlines reference specific codex
    // entries, speech cues, and RequiredCodexEntriesMin builds the prune mask.
    loadData({
        textlines: {
            Codex01: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: { RequiredCodexEntry: { EntryName: 'NPC_Achilles_01', EntryIndex: 3 } } },
            Min01: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: { RequiredCodexEntriesMin: 50 } },
            Played01: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: { RequiredPlayed: 'CueA' } },
            FalsePlayed01: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: { RequiredFalsePlayed: ['CueB', 'CueC'] } },
        },
    });
    const luaState = {
        SpeechRecord: { CueA: true, CueB: true, Unreferenced: true },
        CodexStatus: {
            Chapter1: {
                NPC_Achilles_01: { 1: { Unlocked: true }, 2: { Unlocked: true }, 3: { Unlocked: true }, New: false },
                NPC_Other: { 1: { Unlocked: true } },
            },
        },
    };
    const slice = extractH1GameStateSlice({ EnemyKills: { Harpy: 1 } }, luaState);
    // Only referenced + truthy cues are kept.
    assert.deepEqual(slice.SpeechRecord, { CueA: true, CueB: true });
    // Codex pruned to the referenced entry, flattened to {u, viewed}.
    assert.deepEqual(slice.Codex, { NPC_Achilles_01: { u: 3, viewed: true } });
    // RequiredCodexEntriesMin was referenced, so the total is counted.
    assert.equal(slice.CodexUnlockedTotal, 2);
    clearSaveProgress();
});

test('extractH1GameStateSlice omits the global captures when no luaState is given', () => {
    const slice = extractH1GameStateSlice({ EnemyKills: { Harpy: 1 } });
    assert.equal('SpeechRecord' in slice, false);
    assert.equal('Codex' in slice, false);
    assert.equal('CodexUnlockedTotal' in slice, false);
});

test('a biomes-mod H2 save retains Hades 1 enemy-kill fields the H2 mask would prune', () => {
    clearSaveProgress();
    // Register an H2 dataset whose requirements never reference EnemyKills, so
    // the H2 GameState mask prunes EnemyKills entirely from a vanilla H2 save.
    loadData({ textlines: { H1Line: { owner: 'NPC_Test_01', requirements: {} } } });
    registerGameData('hades2', { textlines: { H2Line: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: {} } }, namedRequirements: {} });

    // Control: a vanilla H2 save (no biomes marker) -> EnemyKills is pruned away
    // (a ported Hades 1 enemy name would read 0).
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        luaState: { GameState: { EnemyKills: { Theseus: 3, Chronos: 9 } } },
    }));
    assert.equal(getSaveContext().gameState.EnemyKills, undefined);

    // Biomes-mod save: the mod marker is present, so the Hades 1 GameState slice
    // is merged in, restoring EnemyKills keyed by the Hades 1 enemy name.
    clearSaveProgress();
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        luaState: {
            GameState: {
                ModsNikkelMHadesBiomesCompletedRunsCache: 12,
                EnemyKills: { Theseus: 3, Chronos: 9 },
            },
        },
    }));
    const gs = getSaveContext().gameState;
    assert.equal(gs.EnemyKills.Theseus, 3);
    // The ported run-count cache is still carried through as before.
    assert.equal(gs.ModsNikkelMHadesBiomesCompletedRunsCache, 12);
    clearSaveProgress();
});

test('a biomes-mod H2 save carries flat per-run EnemyKills into the current/prev-run slices', () => {
    clearSaveProgress();
    loadData({ textlines: { H1Line: { owner: 'NPC_Test_01', requirements: {} } } });
    registerGameData('hades2', { textlines: { H2Line: { owner: 'NPC_Test_01', requirements: {}, otherRequirements: {} } }, namedRequirements: {} });
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES2,
        luaState: {
            GameState: {
                ModsNikkelMHadesBiomesCompletedRunsCache: 5,
                // Newest RunHistory entry (index 2) is the "last run".
                RunHistory: { 1: { EnemyKills: { Theseus: 1 } }, 2: { EnemyKills: { Harpy2: 3 } } },
            },
            CurrentRun: { EnemyKills: { Harpy: 2 } },
        },
    }));
    const ctx = getSaveContext();
    // "This run" kills come from the flat CurrentRun.EnemyKills.
    assert.equal(ctx.currentRun.EnemyKills.Harpy, 2);
    // "Last run" kills come from the newest RunHistory entry's flat EnemyKills.
    assert.equal(ctx.prevRun.EnemyKills.Harpy2, 3);
    clearSaveProgress();
});

test('extractH1CurrentRunSlice prunes Hero / CurrentRoom / RoomHistory', () => {
    const slice = extractH1CurrentRunSlice({
        CurrentRun: {
            Cleared: true,
            SpeechRecord: ['LineA'],
            IgnoredKey: 'drop-me',
            CurrentRoom: { Name: 'A_Combat01', RoomSetName: 'Tartarus', VoiceLinesPlayed: ['L1'], Junk: 1 },
            Hero: { Health: 30, MaxHealth: 50, Weapons: { Sword: true }, SecretField: 9 },
            CaughtFish: { TartarusFish: 1 },
            ConsumableRecord: { RoomRewardConsolationPrize: 2 },
            RoomHistory: {
                1: { Kills: { Harpy: 2 }, Name: 'A_Combat01', UsedAssist: true, Junk: 'x' },
                2: { Kills: { Slime: 1 }, Name: 'A_Combat02' },
            },
        },
    });
    assert.equal(slice.Cleared, true);
    assert.deepEqual(slice.SpeechRecord, ['LineA']);
    assert.equal('IgnoredKey' in slice, false);
    // CurrentRoom pruned to the read fields.
    assert.equal(slice.CurrentRoom.Name, 'A_Combat01');
    assert.deepEqual(slice.CurrentRoom.VoiceLinesPlayed, ['L1']);
    assert.equal('Junk' in slice.CurrentRoom, false);
    // Hero pruned to the read fields.
    assert.equal(slice.Hero.Health, 30);
    assert.deepEqual(slice.Hero.Weapons, { Sword: true });
    assert.equal('SecretField' in slice.Hero, false);
    // Per-run record tables carried wholesale.
    assert.deepEqual(slice.CaughtFish, { TartarusFish: 1 });
    assert.deepEqual(slice.ConsumableRecord, { RoomRewardConsolationPrize: 2 });
    // CurrentRun RoomHistory pruned to {Kills, Name, UsedAssist}.
    assert.deepEqual(slice.RoomHistory['1'], { Kills: { Harpy: 2 }, Name: 'A_Combat01', UsedAssist: true });
    assert.deepEqual(slice.RoomHistory['2'], { Kills: { Slime: 1 }, Name: 'A_Combat02' });
});

test('extractH1CurrentRunSlice returns null when there is no current run', () => {
    assert.equal(extractH1CurrentRunSlice({}), null);
    assert.equal(extractH1CurrentRunSlice(null), null);
});

test('extractH1PrevRunSlice reads the newest RunHistory entry', () => {
    const slice = extractH1PrevRunSlice({
        GameState: {
            RunHistory: {
                1: { Cleared: false, RoomCountCache: { A: 1 }, RoomHistory: { 1: { Kills: { X: 1 } } } },
                3: { Cleared: true, RoomCountCache: { B: 2 }, RoomHistory: { 1: { Kills: { Y: 3 }, Junk: 1 } } },
                2: { Cleared: false },
            },
        },
    });
    // Highest index (3) is the most recent completed run.
    assert.equal(slice.Cleared, true);
    assert.deepEqual(slice.RoomCountCache, { B: 2 });
    assert.deepEqual(slice.RoomHistory['1'], { Kills: { Y: 3 } });
});

test('extractH1PrevRunSlice returns an empty object with no completed runs', () => {
    assert.deepEqual(extractH1PrevRunSlice({ GameState: {} }), {});
    assert.deepEqual(extractH1PrevRunSlice({}), {});
});

// --- LZ4 corrupt-input hardening ---
// A user's .sav is the only untrusted input; the decompressor must fail
// cleanly (no infinite loop, no throw, no out-of-bounds read) on malformed
// blocks rather than returning silent garbage. The upload path catches a
// throw and shows "Parse error", but these decode-level guards keep a
// corrupt block from producing undefined-as-0 bytes.

test('decompressLz4Block stops cleanly on a back-reference before the buffer start', () => {
    // token=0x00 (no literals, min match), then an offset of 5 while nothing
    // has been output yet -> matchPos would be negative.
    const block = new Uint8Array([0x00, 0x05, 0x00]);
    let out;
    assert.doesNotThrow(() => { out = decompressLz4Block(block, 16); });
    assert.equal(out.length, 0);
});

test('decompressLz4Block stops cleanly on a truncated length extension', () => {
    // literalLen nibble = 15 signals an extension byte that never arrives.
    const block = new Uint8Array([0xF0]);
    let out;
    assert.doesNotThrow(() => { out = decompressLz4Block(block, 16); });
    assert.equal(out.length, 0);
});

test('decompressLz4Block copies only the available bytes of a truncated literal run', () => {
    // token claims 5 literals but only 2 bytes follow.
    const block = new Uint8Array([0x50, 0xAA, 0xBB]);
    const out = decompressLz4Block(block, 16);
    assert.deepEqual(Array.from(out), [0xAA, 0xBB]);
});

test('decompressLz4Block rejects a decompression bomb (oversized match length)', () => {
    // One literal to seed the window, then a match whose length-extension
    // bytes claim ~280 MB - past the absolute output cap.
    const ext = 1_100_000;
    const block = new Uint8Array(4 + ext + 1);
    block[0] = 0x1F;              // 1 literal, match-length nibble = 15 (extends)
    block[1] = 0xAA;             // the literal
    block[2] = 0x01;             // match offset LE = 1
    block[3] = 0x00;
    block.fill(0xFF, 4, 4 + ext); // 0xFF extension bytes each add 255 to matchLen
    block[4 + ext] = 0x00;        // terminator
    assert.throws(() => decompressLz4Block(block, 16), /size limit/);
});

test('persistence is a silent no-op when localStorage is unavailable', () => {
    uninstallMockLocalStorage(); // ensure absent
    clearSaveProgress();
    parseSaveFile(buildSGB1({
        gameVersion: GAME_VERSION_HADES1,
        luaState: { TextLinesRecord: { X01: true } },
    }));
    // None of these may throw without a storage backend.
    assert.equal(persistSaveProgress('Profile1.sav'), false);
    assert.equal(restoreSaveProgress(), null);
    assert.doesNotThrow(() => clearPersistedSave());
    clearSaveProgress();
});

