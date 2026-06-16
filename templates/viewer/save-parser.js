/**
 * SGB1 save file parser for Hades / Hades II.
 *
 * Parses ProfileX.sav files entirely in-browser:
 *   1. SGB1 binary header (metadata)
 *   2. LZ4 block decompression (inline implementation, no dependencies)
 *   3. Luabins decoding (Supergiant's Lua serialisation format)
 *
 * Format documentation derived from TheNormalnij/Hades-SavesExtractor (MIT).
 */

import { getActiveGame } from './data.js';

// Game version constants
const GAME_VERSION_HADES1 = 0x10;
const GAME_VERSION_HADES2 = 0x11;
const GAME_VERSION_HADES2_PATCH11 = 0x12;

const _GAME_ID_MAP = {
  [GAME_VERSION_HADES1]: 'hades1',
  [GAME_VERSION_HADES2]: 'hades2',
  [GAME_VERSION_HADES2_PATCH11]: 'hades2',
};

// --- LZ4 block decompressor (decompression only) ---

function decompressLz4Block(input, uncompressedSize) {
  const out = new Uint8Array(uncompressedSize);
  let ip = 0;
  let op = 0;

  while (ip < input.length) {
    const token = input[ip++];
    let literalLen = (token >> 4) & 0x0F;
    let matchLen = token & 0x0F;

    // Literal length extension
    if (literalLen === 15) {
      let b;
      do {
        b = input[ip++];
        literalLen += b;
      } while (b === 255);
    }

    // Copy literals
    for (let i = 0; i < literalLen; i++) {
      out[op++] = input[ip++];
    }

    if (ip >= input.length) break;

    // Match offset (2 bytes LE)
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;

    if (offset === 0) break;

    // Match length extension
    if (matchLen === 15) {
      let b;
      do {
        b = input[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4; // minimum match length is 4

    // Copy match (may overlap - byte-by-byte copy required)
    let matchPos = op - offset;
    for (let i = 0; i < matchLen; i++) {
      out[op++] = out[matchPos++];
    }
  }

  return out.slice(0, op);
}

// --- Luabins decoder ---

const LUABINS_NIL = 45;    // '-'
const LUABINS_FALSE = 48;  // '0'
const LUABINS_TRUE = 49;   // '1'
const LUABINS_NUMBER = 78; // 'N'
const LUABINS_STRING = 83; // 'S'
const LUABINS_TABLE = 84;  // 'T'

function decodeLuabins(data) {
  let pos = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  function readU8() { return data[pos++]; }
  function readI32() { const v = view.getInt32(pos, true); pos += 4; return v; }
  function readF64() { const v = view.getFloat64(pos, true); pos += 8; return v; }
  function readString() {
    const len = readI32();
    const bytes = data.slice(pos, pos + len);
    pos += len;
    return new TextDecoder().decode(bytes);
  }

  function readValue(type) {
    switch (type) {
      case LUABINS_NIL: return null;
      case LUABINS_FALSE: return false;
      case LUABINS_TRUE: return true;
      case LUABINS_NUMBER: return readF64();
      case LUABINS_STRING: return readString();
      case LUABINS_TABLE: {
        const arraySize = readI32();
        const hashSize = readI32();
        const total = arraySize + hashSize;
        const table = {};
        for (let i = 0; i < total; i++) {
          const keyType = readU8();
          const key = readValue(keyType);
          const valType = readU8();
          const val = readValue(valType);
          table[key] = val;
        }
        return table;
      }
      default:
        throw new Error(`Unknown luabins type: ${type} at offset ${pos - 1}`);
    }
  }

  const count = readU8();
  const values = [];
  for (let i = 0; i < count; i++) {
    const type = readU8();
    values.push(readValue(type));
  }
  return values;
}

// --- SGB1 parser ---

function parseSGB1(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Magic check
  if (data[0] !== 0x53 || data[1] !== 0x47 || data[2] !== 0x42 || data[3] !== 0x31) {
    throw new Error('Not an SGB1 save file');
  }

  let pos = 4;
  pos += 4; // checksum (skip)
  const gameVersion = view.getUint16(pos, true); pos += 2;
  pos += 2; // saveFlags (skip)
  pos += 8; // timestamp (skip)

  // location string
  const locLen = view.getUint32(pos, true); pos += 4;
  pos += locLen;

  // completedRuns, accumulatedMetaPoints, activeShrinePoints
  const completedRuns = view.getUint32(pos, true); pos += 4;
  pos += 4; // accumulatedMetaPoints
  pos += 4; // activeShrinePoints

  // H2-only fields
  if (gameVersion === GAME_VERSION_HADES2 || gameVersion === GAME_VERSION_HADES2_PATCH11) {
    pos += 4; // metaUpgradeLevel
  }
  if (gameVersion === GAME_VERSION_HADES2_PATCH11) {
    pos += 4; // cosmeticsPoints
  }

  pos += 1; // easyMode
  pos += 1; // hardMode

  // notableLuaData: vec<string>
  const vecCount = view.getUint32(pos, true); pos += 4;
  for (let i = 0; i < vecCount; i++) {
    const slen = view.getUint32(pos, true); pos += 4 + slen;
  }

  // mapName, mapName2
  let slen = view.getUint32(pos, true); pos += 4 + slen;
  slen = view.getUint32(pos, true); pos += 4 + slen;

  // LZ4-compressed luabins payload
  const compressedLen = view.getUint32(pos, true); pos += 4;
  const compressed = data.slice(pos, pos + compressedLen);

  // Decompress (6 MB buffer should cover any save)
  const decompressed = decompressLz4Block(compressed, 6 * 1024 * 1024);

  // Decode luabins
  const luaValues = decodeLuabins(decompressed);
  const luaState = luaValues[0] || {};

  const gameId = _GAME_ID_MAP[gameVersion];
  if (!gameId) {
    throw new Error(`Unknown game version: 0x${gameVersion.toString(16)}`);
  }

  return { gameId, completedRuns, luaState };
}

// --- TextLinesRecord extraction ---

function extractTextLinesRecord(parsed) {
  const { gameId, luaState } = parsed;
  if (gameId === 'hades2') {
    const gs = luaState.GameState || {};
    return gs.TextLinesRecord || {};
  }
  // H1: top-level TextLinesRecord
  return luaState.TextLinesRecord || {};
}

// --- Public API ---

let _saveProgress = null;
let _saveGameId = null;
let _saveRuns = null;

export function getSaveProgress() { return _saveProgress; }
export function getSaveGameId() { return _saveGameId; }
export function getSaveRuns() { return _saveRuns; }

export function clearSaveProgress() {
  _saveProgress = null;
  _saveGameId = null;
  _saveRuns = null;
}

export function parseSaveFile(arrayBuffer) {
  const parsed = parseSGB1(arrayBuffer);
  const tlr = extractTextLinesRecord(parsed);
  _saveProgress = new Set(Object.keys(tlr));
  _saveGameId = parsed.gameId;
  _saveRuns = parsed.completedRuns;
  return { gameId: parsed.gameId, completedRuns: parsed.completedRuns, count: _saveProgress.size };
}

export function isDialoguePlayed(name) {
  if (!_saveProgress) return null;
  return _saveProgress.has(name);
}

export function getDialogueStatus(name, textlineData) {
  if (!_saveProgress) return null;
  if (_saveProgress.has(name)) return 'played';

  // Check if all requirements are met (eligible) or some are missing (blocked)
  const reqs = textlineData.requirements;
  if (!reqs) return 'eligible';

  for (const reqType of Object.keys(reqs)) {
    const entries = reqs[reqType];
    if (!Array.isArray(entries)) continue;
    for (const ref of entries) {
      if (typeof ref === 'string' && !_saveProgress.has(ref)) {
        return 'blocked';
      }
    }
  }
  return 'eligible';
}

export function validateSaveFilename(filename) {
  return /^Profile[1-4](_Temp)?\.sav$/i.test(filename);
}

export function saveMatchesActiveGame() {
  if (!_saveGameId) return false;
  // A Hades II save can contain Hades 1 dialogue names (via mods that
  // port H1 content into H2), so H2 saves are valid for both games.
  if (_saveGameId === 'hades2') return true;
  return _saveGameId === getActiveGame();
}
