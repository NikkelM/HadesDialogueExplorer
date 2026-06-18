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
} from '../templates/viewer/save-parser.js';
import { loadData } from '../templates/viewer/data.js';

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
