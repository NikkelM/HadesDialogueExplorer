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
import { isDirectlySatisfied } from './requirements.js';
import { isUnobtainable } from './unobtainable.js';

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

// ``initialSize`` is a starting capacity hint; the save format doesn't store
// the uncompressed size, so the output buffer is grown on demand if a save
// (e.g. a 100%-completion file) decompresses to more than the hint.
export function decompressLz4Block(input, initialSize) {
  let out = new Uint8Array(initialSize || 1 << 16);
  let ip = 0;
  let op = 0;

  function ensureCapacity(extra) {
    if (op + extra <= out.length) return;
    let cap = out.length || 1;
    while (cap < op + extra) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(out);
    out = grown;
  }

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
    ensureCapacity(literalLen);
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
    ensureCapacity(matchLen);
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

  // Decompress (6 MB initial buffer; grows if a save exceeds it)
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

// --- Played-set extraction ---

// H2 records the option picked in a choice dialogue under
// ``GameState.TextLinesChoiceRecord.<parent> = "<ChoiceText>"`` rather
// than writing a ``<parent><ChoiceText>`` entry into TextLinesRecord the
// way H1 does. Re-derive those synthetic choice-variant names (the same
// ones ``build_synthetic_variants`` emits) so choice-gated dialogues
// evaluate against the names the dependency graph uses.
function choiceRecordVariants(choiceRecord) {
  const variants = new Set();
  if (!choiceRecord || typeof choiceRecord !== 'object') return variants;
  for (const [parent, choice] of Object.entries(choiceRecord)) {
    const choices = Array.isArray(choice) ? choice : [choice];
    for (const c of choices) {
      if (typeof c === 'string' && c) variants.add(parent + c);
    }
  }
  return variants;
}

function extractPlayedSet(parsed) {
  const { gameId, luaState } = parsed;
  if (gameId === 'hades2') {
    const gs = luaState.GameState || {};
    const played = new Set(Object.keys(gs.TextLinesRecord || {}));
    for (const v of choiceRecordVariants(gs.TextLinesChoiceRecord)) played.add(v);
    return played;
  }
  // H1: top-level TextLinesRecord (choices already recorded inline)
  return new Set(Object.keys(luaState.TextLinesRecord || {}));
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

// --- Local persistence ---
//
// The loaded save is cached client-side so it survives a page reload. We
// store the *derived* state (played-line names + gameId + runs), not the
// raw save bytes: the games are frozen so dialogue names never change,
// and all downstream eligibility is recomputed from the dialogue graph at
// render time, so the cached set stays correct. ``SAVE_STORAGE_SCHEMA``
// invalidates the cache if this derived shape ever changes.
//
// localStorage is used rather than a cookie: the played set (up to
// ~150 KB) far exceeds the ~4 KB cookie limit, and a cookie would be sent
// on every request once this is a hosted webapp. localStorage is
// same-origin, survives reloads/restarts, and keeps the save fully
// client-side (it never reaches a server).
const SAVE_STORAGE_KEY = 'hde.save';
const SAVE_STORAGE_SCHEMA = 1;

// Safe accessor: localStorage is absent under Node (tests) and can throw
// on access in sandboxed iframes or when storage is disabled.
function _saveStore() {
  try {
    return (typeof localStorage !== 'undefined') ? localStorage : null;
  } catch {
    return null;
  }
}

function _removePersistedSave(store) {
  try { store.removeItem(SAVE_STORAGE_KEY); } catch { /* ignore */ }
}

// Persist the current in-memory save state. ``filename`` is retained for
// future use (it is not displayed today). No-op and returns false when
// there is nothing loaded, storage is unavailable, or the quota is hit -
// the in-memory session keeps working regardless.
export function persistSaveProgress(filename) {
  const store = _saveStore();
  if (!store || !_saveProgress) return false;
  try {
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify({
      v: SAVE_STORAGE_SCHEMA,
      gameId: _saveGameId,
      runs: _saveRuns,
      filename: filename || null,
      played: [..._saveProgress],
    }));
    return true;
  } catch {
    return false;
  }
}

// Re-hydrate the in-memory save state from a previously persisted cache.
// Returns a summary ``{ gameId, completedRuns, count, filename }`` on
// success, or null when there is no (valid) cache. Corrupt or
// schema-mismatched payloads are dropped.
export function restoreSaveProgress() {
  const store = _saveStore();
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(SAVE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    _removePersistedSave(store);
    return null;
  }

  if (!data || data.v !== SAVE_STORAGE_SCHEMA || !Array.isArray(data.played)
      || typeof data.gameId !== 'string') {
    _removePersistedSave(store);
    return null;
  }

  _saveProgress = new Set(data.played);
  _saveGameId = data.gameId;
  _saveRuns = (typeof data.runs === 'number') ? data.runs : 0;
  return {
    gameId: _saveGameId,
    completedRuns: _saveRuns,
    count: _saveProgress.size,
    filename: data.filename || null,
  };
}

// Remove the persisted cache (called when the user clears the save).
export function clearPersistedSave() {
  const store = _saveStore();
  if (store) _removePersistedSave(store);
}

export function parseSaveFile(arrayBuffer) {
  const parsed = parseSGB1(arrayBuffer);
  _saveProgress = extractPlayedSet(parsed);
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
  // Respect per-type requirement semantics (AND / OR / negative) rather
  // than treating every referenced line as a hard prerequisite.
  if (isDirectlySatisfied(textlineData, _saveProgress, name)) return 'eligible';
  // Blocked - but distinguish a *permanently* unobtainable dialogue (a
  // required choice was taken differently, or a mutually-exclusive line has
  // played) from one that can still be unlocked by playing more.
  return isUnobtainable(name, _saveProgress) ? 'unobtainable' : 'blocked';
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
