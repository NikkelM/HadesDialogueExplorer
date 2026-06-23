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

import { getActiveGame, games } from './data.js';
import { collectGameStatePaths, pruneGameState, collectRunPaths } from './gamestate-eval.js';
import { directSatisfaction } from './requirements.js';
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

// The game ids a save may legitimately carry; a persisted save with anything
// else (tampered localStorage) is rejected so restore fails closed.
const _VALID_GAME_IDS = new Set(Object.values(_GAME_ID_MAP));

// --- LZ4 block decompressor (decompression only) ---

// Absolute cap on decompressed output. A real save (even 100% completion)
// decompresses to well under this; the ceiling stops a crafted "decompression
// bomb" block (long match-length extensions claiming a huge match) from
// growing the buffer without bound.
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

// ``initialSize`` is a starting capacity hint; the save format doesn't store
// the uncompressed size, so the output buffer is grown on demand if a save
// (e.g. a 100%-completion file) decompresses to more than the hint.
export function decompressLz4Block(input, initialSize) {
  let out = new Uint8Array(initialSize || 1 << 16);
  let ip = 0;
  let op = 0;

  function ensureCapacity(extra) {
    if (op + extra <= out.length) return;
    if (op + extra > MAX_DECOMPRESSED_BYTES) {
      throw new Error('decompressed save exceeds size limit');
    }
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
        if (ip >= input.length) return out.slice(0, op); // truncated stream
        b = input[ip++];
        literalLen += b;
      } while (b === 255);
    }

    // Copy literals. A valid block's final literal run ends exactly at the
    // input end; anything claiming more is truncated/corrupt, so copy only
    // what's there and stop rather than reading past the buffer (undefined
    // bytes would silently become 0).
    if (ip + literalLen > input.length) literalLen = input.length - ip;
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
        if (ip >= input.length) return out.slice(0, op); // truncated stream
        b = input[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4; // minimum match length is 4

    // Copy match (may overlap - byte-by-byte copy required). A back-reference
    // pointing before the start of the output is corrupt; stop cleanly instead
    // of reading out[negative] (which yields undefined -> 0).
    let matchPos = op - offset;
    if (matchPos < 0) break;
    ensureCapacity(matchLen);
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
    // A negative or out-of-range length means corrupt input; fail loudly
    // rather than slicing past the buffer (TextDecoder would silently return
    // whatever it could).
    if (len < 0 || pos + len > data.length) {
      throw new Error(`luabins string length out of range: ${len} at offset ${pos - 4}`);
    }
    const bytes = data.slice(pos, pos + len);
    pos += len;
    return new TextDecoder().decode(bytes);
  }

  // Nested-table depth ceiling: real Hades saves nest only a few levels;
  // a deep chain on corrupt input would otherwise recurse until the stack
  // blows. 64 is far beyond any genuine save.
  const MAX_DEPTH = 64;

  function readValue(type, depth) {
    switch (type) {
      case LUABINS_NIL: return null;
      case LUABINS_FALSE: return false;
      case LUABINS_TRUE: return true;
      case LUABINS_NUMBER: return readF64();
      case LUABINS_STRING: return readString();
      case LUABINS_TABLE: {
        if (depth >= MAX_DEPTH) throw new Error('luabins table nesting too deep');
        const arraySize = readI32();
        const hashSize = readI32();
        if (arraySize < 0 || hashSize < 0) {
          throw new Error(`luabins table size out of range: ${arraySize}/${hashSize}`);
        }
        const total = arraySize + hashSize;
        const table = {};
        for (let i = 0; i < total; i++) {
          const keyType = readU8();
          // Keys are assumed to be strings or numbers (true for all real Hades
          // saves); a table/boolean key would stringify via object coercion.
          const key = readValue(keyType, depth + 1);
          const valType = readU8();
          const val = readValue(valType, depth + 1);
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
    values.push(readValue(type, 0));
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

  // Detect the "Zagreus' Journey" mod (Hades Biomes), which ports Hades 1
  // content into a Hades II save - the marker is its CompletedRunsCache under
  // GameState. Only then does an H2 save carry meaningful Hades 1 progress.
  const gs = luaState.GameState;
  const hasBiomesMod = !!(gs && typeof gs === 'object'
    && ('ModsNikkelMHadesBiomesCompletedRunsCache' in gs));

  return { gameId, completedRuns, luaState, hasBiomesMod };
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

// Per-run / per-room / queued / last-run textline records, used to resolve
// the run-scoped requirement fields (``*ThisRun`` / ``*ThisRoom`` /
// ``*Queued`` / ``*LastRun``) the global cumulative record can't. Both games
// store the run/room records at the same ``CurrentRun.*`` paths and the
// last-run record at ``GameState.RunHistory[#RunHistory].TextLinesRecord``
// (the highest index - the current in-progress run lives in ``CurrentRun``
// and is not yet in ``RunHistory``); they differ only in where the global
// record lives (see ``extractPlayedSet``) and the queue - H1 keeps a
// top-level ``QueuedTextLines``, while H2 only persists a voice-line queue
// (``CurrentRun.Hero.QueuedVoiceLines``), a different namespace that never
// matches textline names, so H2's textline queue is treated as unavailable.
// ``thisRun`` / ``thisRoom`` / ``queued`` are ``null`` when the save doesn't
// carry them (e.g. no active run) so the evaluator falls back to
// "indeterminate"; ``lastRun`` is always a Set (empty = no completed run,
// which the game treats the same as an empty record) and ``runsAgo`` is
// always an object, so the *LastRun and run-count fields are always
// resolvable.
//
// ``runsAgo`` maps a textline name to how many runs ago it most recently
// played (0 = current run, 1 = last completed run, ...), built from the
// current run + RunHistory newest-first up to ``RUNS_AGO_DEPTH``. That depth
// covers the deepest run-count requirement (Hades 1 MaxRunsSince Count = 80;
// Hades II caps at 9 and only retains ~10 runs of TextLinesRecord anyway -
// SaveLogic.lua strips it beyond runsBack 10). Hades II strips older runs, so
// matching its post-load behaviour, a stripped run contributes nothing.
const RUNS_AGO_DEPTH = 100;

function extractSaveContext(parsed) {
  const { gameId, luaState } = parsed;
  const gs = luaState.GameState || {};
  const played = extractPlayedSet(parsed);

  let thisRun = null;
  let thisRoom = null;
  const cr = luaState.CurrentRun;
  if (cr && typeof cr === 'object') {
    thisRun = new Set(Object.keys(cr.TextLinesRecord || {}));
    for (const k of Object.keys(cr.HubTextLinesRecord || {})) thisRun.add(k);
    for (const v of choiceRecordVariants(cr.TextLinesChoiceRecord)) thisRun.add(v);
    const room = cr.CurrentRoom;
    if (room && typeof room === 'object') {
      thisRoom = new Set(Object.keys(room.TextLinesRecord || {}));
      for (const v of choiceRecordVariants(room.TextLinesChoiceRecord)) thisRoom.add(v);
    }
  }

  let queued = null;
  if (gameId === 'hades1') {
    queued = new Set(Object.keys(luaState.QueuedTextLines || {}));
  }

  // Recent runs newest-first: index 0 = current run (the game's run-count uses
  // the raw CurrentRun.TextLinesRecord, no hub), index 1 = last completed run
  // (RunHistory[#RunHistory]), and so on. Stops at the first stripped entry or
  // at RUNS_AGO_DEPTH.
  const recentRecords = [];
  const recordSet = (textLinesRecord, choiceRecord) => {
    const s = new Set(Object.keys(textLinesRecord || {}));
    for (const v of choiceRecordVariants(choiceRecord)) s.add(v);
    return s;
  };
  recentRecords.push(recordSet(cr && cr.TextLinesRecord, cr && cr.TextLinesChoiceRecord));
  const runHistory = gs.RunHistory;
  if (runHistory && typeof runHistory === 'object') {
    const keys = Object.keys(runHistory).map(Number)
      .filter(n => Number.isInteger(n) && n > 0).sort((a, b) => b - a);
    for (const k of keys) {
      if (recentRecords.length > RUNS_AGO_DEPTH) break;
      const e = runHistory[k];
      if (!e || typeof e !== 'object' || !e.TextLinesRecord) break; // stripped boundary
      recentRecords.push(recordSet(e.TextLinesRecord, e.TextLinesChoiceRecord));
    }
  }

  // *LastRun record = the run one back (empty when there is no prior run).
  const lastRun = recentRecords[1] || new Set();
  // runsAgo: textline -> smallest runs-ago index it appears in.
  const runsAgo = Object.create(null);
  for (let i = 0; i < recentRecords.length; i++) {
    for (const t of recentRecords[i]) {
      if (runsAgo[t] === undefined) runsAgo[t] = i;
    }
  }

  return {
    played, thisRun, thisRoom, queued, lastRun, runsAgo,
    gameState: extractGameStateSlice(gameId, gs),
    runs: extractRunsSlice(gameId, luaState),
  };
}

// Memoised mask of the GameState paths the H2 dialogue requirements reference
// (see ``collectGameStatePaths``). Keyed on the H2 data object so it rebuilds
// after a data swap. The H2 data is read from the registry directly (not the
// active-game binding) so the slice is correct even when an H2 save is loaded
// while Hades 1 is the active game.
let _gsMaskCache = null;
let _gsMaskFor = null;
function _h2GameStateMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_gsMaskFor !== h2) {
    _gsMaskFor = h2;
    _gsMaskCache = collectGameStatePaths(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _gsMaskCache;
}

// Memoised run-relative mask + look-back depth for the SumPrevRuns clauses.
let _runMaskCache = null;
let _runMaskFor = null;
function _h2RunMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_runMaskFor !== h2) {
    _runMaskFor = h2;
    _runMaskCache = collectRunPaths(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _runMaskCache;
}

// Build the minimal persisted GameState slice for an H2 save - just the paths
// the dialogue requirements actually read. Returns null for non-H2 saves (H1
// uses a different requirement model, not yet resolved against the save).
function extractGameStateSlice(gameId, gs) {
  if (gameId !== 'hades2') return null;
  const mask = _h2GameStateMask();
  if (!mask) return null;
  return pruneGameState(gs, mask);
}

// Build the per-run slice for SumPrevRuns: the current run plus the most recent
// ``maxRuns`` RunHistory entries (newest first), each pruned to the referenced
// run-relative leaves. Returns null for non-H2 saves or when nothing uses
// SumPrevRuns. ``runs[0]`` is the current run; ``runs[1..]`` are history.
function extractRunsSlice(gameId, luaState) {
  if (gameId !== 'hades2') return null;
  const spec = _h2RunMask();
  if (!spec || spec.maxRuns <= 0) return null;
  const { mask, maxRuns } = spec;
  const gs = luaState.GameState || {};
  const cr = (luaState.CurrentRun && typeof luaState.CurrentRun === 'object') ? luaState.CurrentRun : {};
  const rh = gs.RunHistory;
  // RunHistory is a 1-based Lua array (luabins yields an object with numeric
  // string keys); the highest index is the most recent completed run.
  const history = [];
  if (rh && typeof rh === 'object') {
    const indices = Object.keys(rh).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
    for (const i of indices.slice(0, maxRuns)) {
      const entry = rh[i];
      if (entry && typeof entry === 'object') history.push(pruneGameState(entry, mask));
    }
  }
  return [pruneGameState(cr, mask), ...history];
}

// --- Public API ---

let _saveProgress = null;
let _saveGameId = null;
let _saveRuns = null;
// Whether the loaded H2 save has the Zagreus' Journey mod (Hades Biomes); it
// ports Hades 1 content in, so such a save is also valid for Hades 1.
let _saveHasBiomesMod = false;
// Run-scoped records (each a Set, or null when the save doesn't carry it).
let _saveThisRun = null;
let _saveThisRoom = null;
let _saveQueued = null;
let _saveLastRun = null;
// textline -> runs-ago index (0 = current run); object, or null with no save.
let _saveRunsAgo = null;
// Minimal persisted GameState slice for resolving non-textline (GameState)
// requirements; null for non-H2 saves or when none is loaded.
let _saveGameState = null;
// Per-run slice (current run + recent RunHistory, newest first) for resolving
// SumPrevRuns requirements; null for non-H2 saves or when none is loaded.
let _saveRunsSlice = null;

export function getSaveProgress() { return _saveProgress; }
export function getSaveGameId() { return _saveGameId; }
export function getSaveRuns() { return _saveRuns; }
export function getSaveHasBiomesMod() { return _saveHasBiomesMod; }

// The full save context for requirement evaluation: the global played set
// plus the run-scoped records (each ``null`` when the save doesn't carry
// it). ``requirements.js`` picks the right record per requirement field.
export function getSaveContext() {
  return {
    played: _saveProgress,
    thisRun: _saveThisRun,
    thisRoom: _saveThisRoom,
    queued: _saveQueued,
    lastRun: _saveLastRun,
    runsAgo: _saveRunsAgo,
    gameState: _saveGameState,
    runs: _saveRunsSlice,
  };
}

export function clearSaveProgress() {
  _saveProgress = null;
  _saveGameId = null;
  _saveRuns = null;
  _saveHasBiomesMod = false;
  _saveThisRun = null;
  _saveThisRoom = null;
  _saveQueued = null;
  _saveLastRun = null;
  _saveGameState = null;
  _saveRunsSlice = null;
  _saveRunsAgo = null;
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
// v2 added the run-scoped records (thisRun / thisRoom / queued); v3 added the
// persisted GameState slice (for resolving non-textline requirements); v4 added
// the per-run slice (for resolving SumPrevRuns requirements). An older cache
// lacks these, so the bump forces a re-parse rather than silently leaving them
// unavailable.
const SAVE_STORAGE_SCHEMA = 4;

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
  const arr = (s) => (s instanceof Set ? [...s] : null);
  try {
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify({
      v: SAVE_STORAGE_SCHEMA,
      gameId: _saveGameId,
      runs: _saveRuns,
      biomesMod: _saveHasBiomesMod,
      filename: filename || null,
      played: [..._saveProgress],
      thisRun: arr(_saveThisRun),
      thisRoom: arr(_saveThisRoom),
      queued: arr(_saveQueued),
      lastRun: arr(_saveLastRun),
      runsAgo: _saveRunsAgo || null,
      gameState: _saveGameState || null,
      runs2: _saveRunsSlice || null,
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
      || typeof data.gameId !== 'string' || !_VALID_GAME_IDS.has(data.gameId)) {
    _removePersistedSave(store);
    return null;
  }

  _saveProgress = new Set(data.played);
  _saveGameId = data.gameId;
  _saveRuns = (typeof data.runs === 'number') ? data.runs : 0;
  _saveHasBiomesMod = !!data.biomesMod;
  const set = (a) => (Array.isArray(a) ? new Set(a) : null);
  _saveThisRun = set(data.thisRun);
  _saveThisRoom = set(data.thisRoom);
  _saveQueued = set(data.queued);
  _saveLastRun = set(data.lastRun);
  _saveRunsAgo = (data.runsAgo && typeof data.runsAgo === 'object') ? data.runsAgo : null;
  _saveGameState = (data.gameState && typeof data.gameState === 'object') ? data.gameState : null;
  _saveRunsSlice = Array.isArray(data.runs2) ? data.runs2 : null;
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
  const ctx = extractSaveContext(parsed);
  _saveProgress = ctx.played;
  _saveThisRun = ctx.thisRun;
  _saveThisRoom = ctx.thisRoom;
  _saveQueued = ctx.queued;
  _saveLastRun = ctx.lastRun;
  _saveRunsAgo = ctx.runsAgo;
  _saveGameState = ctx.gameState;
  _saveRunsSlice = ctx.runs;
  _saveGameId = parsed.gameId;
  _saveRuns = parsed.completedRuns;
  _saveHasBiomesMod = !!parsed.hasBiomesMod;
  return { gameId: parsed.gameId, completedRuns: parsed.completedRuns, count: _saveProgress.size };
}

export function isDialoguePlayed(name) {
  if (!_saveProgress) return null;
  return _saveProgress.has(name);
}

export function getDialogueStatus(name, textlineData) {
  if (!_saveProgress) return null;
  if (_saveProgress.has(name)) return 'played';
  // Respect per-type requirement semantics (AND / OR / negative) and the
  // record each field is scoped to (global / this-run / this-room / queued).
  const sat = directSatisfaction(textlineData, getSaveContext(), name);
  if (sat === 'met') return 'eligible';
  // A permanent structural lock (a required choice was taken differently,
  // or a mutually-exclusive line has played) is definitive, so it wins
  // over an unverifiable verdict.
  if (isUnobtainable(name, _saveProgress, _saveRunsAgo)) return 'unobtainable';
  // 'unknown' -> the dialogue gates on a run-scoped record this save doesn't
  // carry (the H2 textline queue, or a current-run record when no run is
  // active), so we can't say whether it's eligible or blocked: surface it as
  // indeterminate.
  return sat === 'unknown' ? 'indeterminate' : 'blocked';
}

export function validateSaveFilename(filename) {
  return /^Profile[1-4](_Temp)?\.sav$/i.test(filename);
}

export function saveMatchesActiveGame() {
  if (!_saveGameId) return false;
  if (_saveGameId === getActiveGame()) return true;
  // A Hades II save only covers Hades 1 when the Zagreus' Journey mod (Hades
  // Biomes) ported Hades 1 content into it; a vanilla H2 save does not.
  if (_saveGameId === 'hades2' && getActiveGame() === 'hades1') return _saveHasBiomesMod;
  return false;
}
