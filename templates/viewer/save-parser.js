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
import { collectGameStatePaths, pruneGameState, collectRunPaths, collectCurrentRunPaths, collectRoomPaths, collectPrevRunPaths, collectRunHistoryClearMask } from './gamestate-eval.js';
import { H1_GAMESTATE_SLICE_KEYS, H1_CURRENTRUN_SLICE_KEYS, collectH1GlobalRefs } from './gamestate-eval-h1.js';
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
    gameState: extractGameStateSlice(gameId, gs, luaState),
    runs: extractRunsSlice(gameId, luaState),
    currentRun: extractCurrentRunSlice(gameId, luaState),
    rooms: extractRoomsSlice(gameId, luaState),
    prevRun: extractPrevRunSlice(gameId, luaState),
    runHistory: extractRunHistorySlice(gameId, luaState),
    audioState: extractAudioStateSlice(gameId, luaState),
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

// Memoised room-relative mask + look-back depth for the SumPrevRooms clauses.
let _roomMaskCache = null;
let _roomMaskFor = null;
function _h2RoomMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_roomMaskFor !== h2) {
    _roomMaskFor = h2;
    _roomMaskCache = collectRoomPaths(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _roomMaskCache;
}

// Memoised CurrentRun mask for resolving ``CurrentRun.*`` direct gates.
let _crMaskCache = null;
let _crMaskFor = null;
function _h2CurrentRunMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_crMaskFor !== h2) {
    _crMaskFor = h2;
    _crMaskCache = collectCurrentRunPaths(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _crMaskCache;
}

// Memoised PrevRun mask for resolving ``PrevRun.*`` (last-completed-run) gates.
let _prevRunMaskCache = null;
let _prevRunMaskFor = null;
function _h2PrevRunMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_prevRunMaskFor !== h2) {
    _prevRunMaskFor = h2;
    _prevRunMaskCache = collectPrevRunPaths(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _prevRunMaskCache;
}

// Memoised RunHistory clear-fields mask for the consecutive clears/deaths checks.
let _runHistMaskCache = null;
let _runHistMaskFor = null;
function _h2RunHistoryClearMask() {
  const h2 = games && games.hades2;
  if (!h2) return null;
  if (_runHistMaskFor !== h2) {
    _runHistMaskFor = h2;
    _runHistMaskCache = collectRunHistoryClearMask(h2.textlines || {}, h2.namedRequirements || {});
  }
  return _runHistMaskCache;
}

// Build the minimal persisted GameState slice for an H2 save - just the paths
// the dialogue requirements actually read. Returns null for non-H2 saves (H1
// uses a different requirement model, not yet resolved against the save).
function extractGameStateSlice(gameId, gs, luaState) {
  if (gameId === 'hades1') return extractH1GameStateSlice(gs, luaState);
  if (gameId !== 'hades2') return null;
  const mask = _h2GameStateMask();
  if (!mask) return null;
  const slice = pruneGameState(gs, mask);
  // Zagreus' Journey (Hades Biomes) ports Hades 1 content into an H2 save and
  // tracks the ported Hades 1 completed / cleared run counts in these cache
  // keys (RunLogic.lua). Carry them through - they sit outside the H2
  // requirement mask - so inspecting a Hades 1 dialogue against a modded H2
  // save resolves its completed / cleared run-count gates from the ported
  // progress rather than this save's (Melinoe's) RunHistory.
  if (gs && typeof gs === 'object' && slice && typeof slice === 'object') {
    for (const k of ['ModsNikkelMHadesBiomesCompletedRunsCache', 'ModsNikkelMHadesBiomesClearedRunsCache']) {
      if (typeof gs[k] === 'number') slice[k] = gs[k];
    }
    // The mod also records the ported Hades 1 progress in the SAME GameState
    // fields Hades 1 uses - EnemyKills / NPCInteractions / ItemInteractions /
    // WeaponKills / ... keyed by Hades 1 enemy / NPC / item names. The H2
    // requirement mask never references those keys, so ``pruneGameState`` drops
    // them, leaving ported Hades 1 dialogues (e.g. ``RequiredKills {Theseus}``)
    // reading 0 against a save that actually has ``EnemyKills.Theseus``. When
    // the mod marker is present, merge the Hades 1 GameState slice in so those
    // gates resolve. Both slices derive from the same raw GameState, so the
    // union never overwrites a value - it only restores the Hades-1-keyed leaves
    // the H2 mask pruned away.
    if ('ModsNikkelMHadesBiomesCompletedRunsCache' in gs) {
      const h1slice = extractH1GameStateSlice(gs, luaState);
      if (h1slice && typeof h1slice === 'object') _mergeGameStateSlice(slice, h1slice);
    }
  }
  return slice;
}

// Recursively union ``extra`` into ``target`` without overwriting existing
// leaves: recurse into shared plain-object subtrees, otherwise add keys missing
// from ``target``. Used to fold the Hades 1 GameState slice into a biomes-mod H2
// slice; both derive from the same raw GameState, so wherever a key exists in
// both the values are identical and keeping ``target``'s is a no-op.
function _mergeGameStateSlice(target, extra) {
  for (const [k, v] of Object.entries(extra)) {
    const tv = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v)
        && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      _mergeGameStateSlice(tv, v);
    } else if (!(k in target)) {
      target[k] = v;
    }
  }
}

// Whether a parsed H2 ``luaState`` carries the Zagreus' Journey (Hades Biomes)
// mod marker under GameState. Gates the merges that fold the Hades 1 per-run
// slices into the H2 slices so ported Hades 1 dialogues resolve their H1-keyed
// per-run gates (e.g. RequiredKillsThisRun / RequiredKillsLastRun).
function _luaHasBiomes(luaState) {
  const gs = luaState && luaState.GameState;
  return !!(gs && typeof gs === 'object' && ('ModsNikkelMHadesBiomesCompletedRunsCache' in gs));
}

// Memoised set of the top-level Hades 1 globals (codex entries / speech cues)
// the dialogue requirements reference, so the H1 slice can prune them. Keyed on
// the H1 data object so it rebuilds after a data swap.
let _h1RefsCache = null;
let _h1RefsFor = null;
function _h1GlobalRefs() {
  const h1 = games && games.hades1;
  if (!h1) return null;
  if (_h1RefsFor !== h1) {
    _h1RefsFor = h1;
    _h1RefsCache = collectH1GlobalRefs(h1.textlines || {});
  }
  return _h1RefsCache;
}

// Max consecutive unlocked page index (from page 1) of a CodexStatus entry node
// ``{1:{Unlocked},2:{Unlocked},...,New,Amount}``. The codex gate needs pages
// 1..N all unlocked, so the consecutive depth is what it compares against.
function _codexEntryDepth(entry) {
  let u = 0;
  while (entry[u + 1] && entry[u + 1].Unlocked) u += 1;
  return u;
}

// Prune the top-level ``CodexStatus`` global to just the referenced entry names,
// flattened to ``{ entryName: { u: unlockedDepth, viewed: !New } }``. The entry
// name is matched across all chapters (the engine's HasCodexEntryBeenFound does
// the same), so the dialogue data needn't know which chapter an entry lives in.
function pruneCodexStatus(cs, entryNames) {
  const out = {};
  for (const chapter of Object.values(cs)) {
    if (!chapter || typeof chapter !== 'object') continue;
    for (const name of entryNames) {
      if (name in out) continue;
      const e = chapter[name];
      if (e && typeof e === 'object') out[name] = { u: _codexEntryDepth(e), viewed: !e.New };
    }
  }
  return out;
}

// CalcNumCodexEntriesUnlocked port (CodexScripts.lua:1115): count entries whose
// first page is unlocked, across every chapter. The engine drives this off the
// static ``Codex`` layout; iterating ``CodexStatus`` gives the same count in
// practice (it is only ever populated for valid entries during play).
function countCodexUnlocked(cs) {
  let n = 0;
  for (const chapter of Object.values(cs)) {
    if (!chapter || typeof chapter !== 'object') continue;
    for (const e of Object.values(chapter)) {
      if (e && typeof e === 'object' && e[1] && e[1].Unlocked) n += 1;
    }
  }
  return n;
}

// Hades 1 GameState slice: copy the top-level keys the H1 evaluator reads
// (H1_GAMESTATE_SLICE_KEYS) wholesale, plus a RunHistory pruned to the per-run
// fields the run-count aggregates and best-clear-time gate need ({Cleared,
// WeaponsCache, GameplayTime, RunDepthCache, EasyModeLevel}). Missing keys
// stay absent and the evaluator coerces them to nil/0/false as the engine does.
// ``luaState`` (the whole save root) is optional; when given, the top-level
// globals the requirements read (SpeechRecord / CodexStatus) are captured too,
// pruned to the referenced cues / entries (see _h1GlobalRefs).
export function extractH1GameStateSlice(gs, luaState) {
  if (!gs || typeof gs !== 'object') return null;
  const slice = {};
  for (const key of H1_GAMESTATE_SLICE_KEYS) {
    const v = gs[key];
    if (v !== undefined) slice[key] = v;
  }
  const rh = gs.RunHistory;
  if (rh && typeof rh === 'object') {
    // Rooms a consecutive-clears/deaths gate references, so each run's
    // RoomCountCache can be pruned to just these (the gates only read
    // RoomCountCache[Name] for their own room).
    const dataRefs = _h1GlobalRefs();
    const rooms = (dataRefs && dataRefs.consecutiveRoomNames) || null;
    const pruned = {};
    for (const [k, run] of Object.entries(rh)) {
      if (!/^\d+$/.test(k) || !run || typeof run !== 'object') continue;
      const e = {};
      if (run.Cleared !== undefined) e.Cleared = run.Cleared;
      if (run.WeaponsCache !== undefined) e.WeaponsCache = run.WeaponsCache;
      if (run.GameplayTime !== undefined) e.GameplayTime = run.GameplayTime;
      if (run.RunDepthCache !== undefined) e.RunDepthCache = run.RunDepthCache;
      if (run.EasyModeLevel !== undefined) e.EasyModeLevel = run.EasyModeLevel;
      // Squelched-Hermes run-distance gates (Min/MaxRunsSinceSquelchedHermes).
      if (run.SquelchedHermes !== undefined) e.SquelchedHermes = run.SquelchedHermes;
      if (run.SquelchedHermesPermanently !== undefined) e.SquelchedHermesPermanently = run.SquelchedHermesPermanently;
      // Consecutive-clears / consecutive-deaths gates.
      if (run.EndingRoomName !== undefined) e.EndingRoomName = run.EndingRoomName;
      if (rooms && rooms.size && run.RoomCountCache && typeof run.RoomCountCache === 'object') {
        const rcc = {};
        for (const name of rooms) if (run.RoomCountCache[name] !== undefined) rcc[name] = run.RoomCountCache[name];
        if (Object.keys(rcc).length) e.RoomCountCache = rcc;
      }
      pruned[k] = e;
    }
    slice.RunHistory = pruned;
  }
  // Top-level globals (siblings of GameState, not under it) the requirements read.
  const refs = (luaState && typeof luaState === 'object') ? _h1GlobalRefs() : null;
  if (refs) {
    const sr = luaState.SpeechRecord;
    if (sr && typeof sr === 'object') {
      const cues = {};
      for (const cue of refs.speechCues) if (sr[cue]) cues[cue] = true;
      slice.SpeechRecord = cues;
    }
    const cs = luaState.CodexStatus;
    if (cs && typeof cs === 'object') {
      slice.Codex = pruneCodexStatus(cs, refs.codexEntries);
      if (refs.needsCodexTotal) slice.CodexUnlockedTotal = countCodexUnlocked(cs);
    }
  }
  // Death-context globals (set at death in DeathLoop.lua; siblings of GameState,
  // present in hub saves), read by RequiredLastKilledByUnits /
  // RequiredLastKilledByWeaponNames for death-quip / NPC death-reaction lines.
  if (luaState && typeof luaState === 'object') {
    if (typeof luaState.LastKilledByUnitName === 'string') slice.LastKilledByUnitName = luaState.LastKilledByUnitName;
    if (typeof luaState.LastKilledByWeaponName === 'string') slice.LastKilledByWeaponName = luaState.LastKilledByWeaponName;
  }
  return slice;
}

// The top-level ``AudioState`` table is the live audio snapshot the H2 save
// persists. Only two scalar leaves are read by dialogue gates
// (AudioState.AmbientTrackName / AudioState.MusicName); capture just those.
// H2 only; null when the save carries neither.
function extractAudioStateSlice(gameId, luaState) {
  if (gameId !== 'hades2') return null;
  const as = luaState && luaState.AudioState;
  if (!as || typeof as !== 'object') return null;
  const slice = {};
  if (typeof as.AmbientTrackName === 'string') slice.AmbientTrackName = as.AmbientTrackName;
  if (typeof as.MusicName === 'string') slice.MusicName = as.MusicName;
  return Object.keys(slice).length ? slice : null;
}

// Build the minimal persisted ``CurrentRun`` slice (the live-run snapshot in the
// save), pruned to the ``CurrentRun.*`` leaves the dialogue requirements read.
// Whether these resolve for a given dialogue depends on its owner's context vs
// the save type (see ``currentRunResolvable``); the slice itself is captured
// regardless. Returns null for non-H2 saves or when nothing uses CurrentRun.*.
function extractCurrentRunSlice(gameId, luaState) {
  if (gameId === 'hades1') return extractH1CurrentRunSlice(luaState);
  if (gameId !== 'hades2') return null;
  const mask = _h2CurrentRunMask();
  let slice = null;
  if (mask && Object.keys(mask).length > 0) {
    const cr = (luaState.CurrentRun && typeof luaState.CurrentRun === 'object') ? luaState.CurrentRun : {};
    slice = pruneGameState(cr, mask);
    // The hero's equipped-trait array (captured wholesale by the mask for
    // the god-trait / boon-choice gates) is large - each instance is a
    // deep copy of its full static trait def. Prune each to just the
    // fields the evaluators read so the persisted slice stays small.
    if (slice.Hero && slice.Hero.Traits && typeof slice.Hero.Traits === 'object') {
      slice.Hero.Traits = pruneHeroTraits(slice.Hero.Traits);
    }
  }
  // Biomes-mod save: fold in the Hades 1 CurrentRun slice so ported H1
  // "...ThisRun" gates (e.g. RequiredKillsThisRun, read from the flat
  // CurrentRun.EnemyKills) resolve - the H2 requirement mask never references
  // those H1-keyed fields, so they'd otherwise be pruned. See
  // extractGameStateSlice for the rationale.
  if (_luaHasBiomes(luaState)) {
    const h1cr = extractH1CurrentRunSlice(luaState);
    if (h1cr && typeof h1cr === 'object') {
      if (slice) _mergeGameStateSlice(slice, h1cr);
      else slice = h1cr;
    }
  }
  return slice;
}

// Hades 1 CurrentRun slice: the live-run snapshot the H1 evaluator reads, pruned
// to the referenced fields (CurrentRoom / Hero / per-run caches), keeping the
// persisted slice small. Captured regardless of save type; whether a given
// dialogue's CurrentRun.* gates resolve depends on its owner-context.
export function extractH1CurrentRunSlice(luaState) {
  const cr = (luaState && luaState.CurrentRun && typeof luaState.CurrentRun === 'object') ? luaState.CurrentRun : null;
  if (!cr) return null;
  const slice = {};
  for (const key of H1_CURRENTRUN_SLICE_KEYS) {
    if (cr[key] !== undefined) slice[key] = cr[key];
  }
  const room = cr.CurrentRoom;
  if (room && typeof room === 'object') {
    slice.CurrentRoom = {
      Name: room.Name,
      RoomSetName: room.RoomSetName,
      NumExits: room.NumExits,
      VoiceLinesPlayed: room.VoiceLinesPlayed,
    };
    if (room.Encounter && typeof room.Encounter === 'object') {
      slice.CurrentRoom.Encounter = { Name: room.Encounter.Name };
    }
  }
  const hero = cr.Hero;
  if (hero && typeof hero === 'object') {
    slice.Hero = {
      IsDead: hero.IsDead,
      Health: hero.Health,
      MaxHealth: hero.MaxHealth,
      Weapons: hero.Weapons,
      LastStands: hero.LastStands,
    };
    if (hero.Traits && typeof hero.Traits === 'object') slice.Hero.Traits = pruneHeroTraits(hero.Traits);
  }
  // ``CurrentDeathAreaRoom`` is a top-level global (which House room the player
  // is in), not a CurrentRun field - carry its Name in so the dead-hero room
  // gates (``RequiredRoom`` etc.) resolve against the House room rather than the
  // biome room the run ended in.
  const deathArea = luaState.CurrentDeathAreaRoom;
  if (deathArea && typeof deathArea === 'object' && deathArea.Name != null) {
    slice.CurrentDeathAreaRoom = { Name: deathArea.Name };
  }
  slice.RoomHistory = _h1PruneCurrentRunRooms(cr.RoomHistory);
  // Hades II runs keep a flat run-level EnemyKills aggregate that the Hades
  // Biomes evaluator reads for kills-this-run gates (more complete than
  // RoomHistory, which omits the in-progress room). Vanilla Hades 1 runs have no
  // such field, so this is absent there and the RoomHistory[].Kills sum is used.
  if (cr.EnemyKills && typeof cr.EnemyKills === 'object') slice.EnemyKills = cr.EnemyKills;
  return slice;
}

// Prune the live run's RoomHistory to the per-room fields the CurrentRun
// evaluators read: ``Kills`` (kills-this-run aggregate) plus ``Name`` /
// ``UsedAssist`` (RequiredUsedAssistInRoomThisRun). Distinct from
// ``_h1PruneRunKills`` (used for completed runs, which only need Kills).
function _h1PruneCurrentRunRooms(roomHistory) {
  const out = {};
  if (roomHistory && typeof roomHistory === 'object') {
    for (const [k, room] of Object.entries(roomHistory)) {
      if (!/^\d+$/.test(k) || !room || typeof room !== 'object') continue;
      const pruned = {};
      if (room.Kills !== undefined) pruned.Kills = room.Kills;
      if (room.Name !== undefined) pruned.Name = room.Name;
      if (room.UsedAssist !== undefined) pruned.UsedAssist = room.UsedAssist;
      out[k] = pruned;
    }
  }
  return out;
}

// Prune a run's RoomHistory to per-room ``{Kills}`` (the only field the H1
// kills-this-run / kills-last-run aggregates read).
function _h1PruneRunKills(roomHistory) {
  const out = {};
  if (roomHistory && typeof roomHistory === 'object') {
    for (const [k, room] of Object.entries(roomHistory)) {
      if (!/^\d+$/.test(k) || !room || typeof room !== 'object') continue;
      if (room.Kills !== undefined) out[k] = { Kills: room.Kills };
    }
  }
  return out;
}

// Reduce a hero ``Traits`` table (a 1-based Lua array surfaced as an
// array or numeric-keyed object) to a compact array of
// ``{Name, Rarity, RestrictBoonChoices}`` - the only fields the
// god-trait / unrestricted-boon evaluators inspect.
function pruneHeroTraits(traits) {
  const entries = Array.isArray(traits) ? traits : Object.values(traits);
  const out = [];
  for (const t of entries) {
    if (!t || typeof t !== 'object') continue;
    const pruned = { Name: t.Name };
    if (t.Rarity !== undefined) pruned.Rarity = t.Rarity;
    if (t.RestrictBoonChoices !== undefined) pruned.RestrictBoonChoices = t.RestrictBoonChoices;
    out.push(pruned);
  }
  return out;
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

// Build the per-room slice for SumPrevRooms: the current room plus the most
// recent ``maxRooms`` CurrentRun.RoomHistory entries (newest first), each pruned
// to the referenced room-relative leaves. Returns null for non-H2 saves or when
// nothing uses SumPrevRooms. ``rooms[0]`` is the current room; ``rooms[1..]`` are
// history. The fields the requirements actually read (``UseRecord.*``,
// ``Encounter.*``, ``EncountersOccurredCache``) are in the engine's room save
// whitelist, so they survive on every persisted history room - which is exactly
// the data the game itself evaluates SumPrevRooms against after loading the save.
function extractRoomsSlice(gameId, luaState) {
  if (gameId !== 'hades2') return null;
  const spec = _h2RoomMask();
  if (!spec || spec.maxRooms <= 0) return null;
  const { mask, maxRooms } = spec;
  const cr = (luaState.CurrentRun && typeof luaState.CurrentRun === 'object') ? luaState.CurrentRun : {};
  const currentRoom = (cr.CurrentRoom && typeof cr.CurrentRoom === 'object') ? cr.CurrentRoom : {};
  const rh = cr.RoomHistory;
  // RoomHistory is a 1-based Lua array; the highest index is the room most
  // recently left. The window covers the current room + up to maxRooms-1 history
  // rooms, newest first.
  const history = [];
  if (rh && typeof rh === 'object') {
    const indices = Object.keys(rh).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
    for (const i of indices.slice(0, maxRooms - 1)) {
      const entry = rh[i];
      if (entry && typeof entry === 'object') history.push(pruneGameState(entry, mask));
    }
  }
  return [pruneGameState(currentRoom, mask), ...history];
}

// Build the PrevRun slice for ``PrevRun.*`` gates: the engine's ``PrevRun`` (the
// last completed run) is exactly ``GameState.RunHistory[#RunHistory]`` (EndRun
// archives the finished run there and sets ``PrevRun`` to it). It isn't a
// separate top-level save key, so we read the newest RunHistory entry, pruned to
// the referenced PrevRun.* leaves. Returns null for non-H2 saves or when nothing
// uses PrevRun.*; an empty object when there is no completed run yet (first run).
function extractPrevRunSlice(gameId, luaState) {
  if (gameId === 'hades1') return extractH1PrevRunSlice(luaState);
  if (gameId !== 'hades2') return null;
  const mask = _h2PrevRunMask();
  let slice = null;
  if (mask && Object.keys(mask).length > 0) {
    const gs = luaState.GameState || {};
    const rh = gs.RunHistory;
    if (!rh || typeof rh !== 'object') {
      slice = {};
    } else {
      const indices = Object.keys(rh).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
      const last = indices.length ? rh[indices[0]] : null;
      slice = (last && typeof last === 'object') ? pruneGameState(last, mask) : {};
    }
  }
  // Biomes-mod save: fold in the Hades 1 PrevRun slice so ported H1 "...LastRun"
  // gates (RequiredKillsLastRun, read from the flat RunHistory[last].EnemyKills)
  // resolve. Only the single most recent run is resolved (which for a modded
  // save is the last modded run, well inside the ~10-run window the game keeps
  // EnemyKills for).
  if (_luaHasBiomes(luaState)) {
    const h1pr = extractH1PrevRunSlice(luaState);
    if (h1pr && typeof h1pr === 'object') {
      if (slice) _mergeGameStateSlice(slice, h1pr);
      else slice = h1pr;
    }
  }
  return slice;
}

// Hades 1 PrevRun slice = the newest RunHistory entry (the last completed run),
// pruned to the fields the *LastRun gates read ({Cleared, RoomCountCache,
// RoomHistory[].Kills}). Empty object when there is no completed run yet.
export function extractH1PrevRunSlice(luaState) {
  const gs = (luaState && luaState.GameState) || {};
  const rh = gs.RunHistory;
  if (!rh || typeof rh !== 'object') return {};
  const indices = Object.keys(rh).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
  const last = indices.length ? rh[indices[0]] : null;
  if (!last || typeof last !== 'object') return {};
  const out = {
    Cleared: last.Cleared,
    RoomCountCache: last.RoomCountCache,
    RoomHistory: _h1PruneRunKills(last.RoomHistory),
  };
  // Hades II runs keep a flat run-level EnemyKills aggregate, and archived runs
  // keep ONLY this (their per-room RoomHistory is stripped); capture it so the
  // kills-last-run gate resolves. Vanilla Hades 1 runs have no such field.
  if (last.EnemyKills && typeof last.EnemyKills === 'object') out.EnemyKills = last.EnemyKills;
  return out;
}

// How many recent RunHistory entries to retain for the consecutive clears /
// deaths checks. The engine's args.Count is asserted < 10; non-room-visiting
// runs are skipped, so a streak can look back further - but the save only keeps
// these fields (RoomsEntered etc.) for the recent runs anyway, so a generous
// window past the retained depth costs nothing.
const RUN_HISTORY_CLEAR_DEPTH = 30;

// Build the recent-runs slice for RequiredConsecutiveClears/DeathsInRoom: the
// most recent RunHistory entries (newest first), each pruned to the referenced
// room keys + EndingRoomName / Cleared / BountyCleared. Returns null for non-H2
// saves or when nothing uses those checks.
function extractRunHistorySlice(gameId, luaState) {
  if (gameId !== 'hades2') return null;
  const spec = _h2RunHistoryClearMask();
  if (!spec || !spec.rooms || spec.rooms.length === 0) return null;
  const gs = luaState.GameState || {};
  const rh = gs.RunHistory;
  if (!rh || typeof rh !== 'object') return [];
  const indices = Object.keys(rh).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => b - a);
  const out = [];
  for (const i of indices.slice(0, RUN_HISTORY_CLEAR_DEPTH)) {
    const entry = rh[i];
    if (entry && typeof entry === 'object') out.push(pruneGameState(entry, spec.mask));
  }
  return out;
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
// Per-room slice (current room + recent RoomHistory, newest first) for resolving
// SumPrevRooms requirements; null for non-H2 saves or when none is loaded.
let _saveRoomsSlice = null;
// Minimal persisted CurrentRun slice for resolving ``CurrentRun.*`` direct
// gates; null for non-H2 saves or when none is loaded.
let _saveCurrentRun = null;
// Minimal persisted PrevRun slice (last completed run = RunHistory[#RH]) for
// resolving ``PrevRun.*`` gates; null for non-H2 saves or when none is loaded.
let _savePrevRun = null;
// Recent-runs slice (RunHistory newest-first, pruned to the clear fields) for
// resolving RequiredConsecutiveClears/DeathsInRoom; null when none is loaded.
let _saveRunHistory = null;
// Whether the loaded save is an in-run save (true) or a hub save (false),
// classified from the save contents (see ``detectInRun``). Decides which
// owners' CurrentRun.* gates resolve (see ``currentRunResolvable``). null when
// no save is loaded (or the state was unreadable).
let _saveInRun = null;
// Minimal persisted AudioState slice (AmbientTrackName / MusicName) for resolving
// H2 AudioState.* gates; null for non-H2 saves or when none is loaded.
let _saveAudioState = null;

export function getSaveProgress() { return _saveProgress; }
export function getSaveGameId() { return _saveGameId; }
export function getSaveRuns() { return _saveRuns; }
export function getSaveHasBiomesMod() { return _saveHasBiomesMod; }
// true = in-run save, false = hub save, null = unknown / none loaded.
export function getSaveInRun() { return _saveInRun; }

// Detect the known Hades II story-softlock state: the player holds Gigaros (the
// ``HadesSpearPoints`` inventory resource, granted on picking up Hades' spear
// during the Zagreus dream sequence) WITHOUT having played
// ``ZagreusPastMeeting06`` - the meeting that legitimately drives that stretch
// of the story. This mismatch only arises when a mod grants resources ahead of
// the story, and it can soft-lock further progress. Reads the already-parsed
// slice + played set, so it works after both a fresh load and a restore.
export function detectH2Softlock() {
  if (_saveGameId !== 'hades2') return false;
  if (!_saveProgress || _saveProgress.has('ZagreusPastMeeting06')) return false;
  const res = _saveGameState && _saveGameState.Resources;
  const pts = res && res.HadesSpearPoints;
  return typeof pts === 'number' && pts > 0;
}

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
    currentRun: _saveCurrentRun,
    rooms: _saveRoomsSlice,
    prevRun: _savePrevRun,
    runHistory: _saveRunHistory,
    saveInRun: _saveInRun,
    audioState: _saveAudioState,
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
  _saveCurrentRun = null;
  _saveRoomsSlice = null;
  _savePrevRun = null;
  _saveRunHistory = null;
  _saveInRun = null;
  _saveRunsAgo = null;
  _saveAudioState = null;
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
// the per-run slice (for resolving SumPrevRuns requirements); v5 widened the
// GameState slice to include QuestStatus (for RequireQuestCount); v6 added the
// CurrentRun slice + in-run flag (for resolving CurrentRun.* gates); v7 added the
// per-room slice (for resolving SumPrevRooms gates); v8 added the PrevRun slice
// (last completed run, for resolving PrevRun.* gates); v9 widened the GameState +
// CurrentRun slices with the fields the resolvable FunctionName gates read
// (ShrineUpgrades / Encounters caches / Hero health / EnteredBiomes / ...); v10
// added the recent-runs slice (for RequiredConsecutiveClears/DeathsInRoom); v11
// added the hero equipped-trait slice (for RequiredSellableGodTraits /
// RequireUnrestrictedBoonChoices). v12 added the Hades 1 GameState / CurrentRun /
// PrevRun slices (for resolving H1 named-field requirements). v13 added
// MetaUpgradesSelected + EncountersOccurredCache to the H1 slices (for the
// active-Mirror-upgrade and RequiredEncounterThisRun gates). An older cache
// lacks these, so the bump forces a re-parse rather than silently leaving them
// unavailable. v14 added the SpeechRecord / Codex globals + Resources /
// SpentMetaPointsCache / LastInteractedWeaponUpgrade to the H1 slice (codex /
// speech / meta-point / weapon-aspect gates). v15 widened the H1 RunHistory
// prune with GameplayTime / RunDepthCache / EasyModeLevel (best-clear-time gate).
// v16 added the H1 CurrentRun RoomHistory prune ({Name, Kills, UsedAssist}) for
// the used-assist-in-room gate. v17 added KeepsakeChambers to the H1 GameState
// slice (for the RequiresMaxKeepsake keepsake-mastery gate). v18 added the H1
// LastKilledByUnitName / LastKilledByWeaponName death globals to the H1 GameState
// slice and the H2 top-level AudioState slice (AmbientTrackName / MusicName).
// v19 carried the Zagreus' Journey (Hades Biomes) ported completed / cleared
// run-count caches into the H2 GameState slice, so H1 run-count gates resolve
// from a modded H2 save; an older cache lacks them, so the bump forces a re-parse.
// v20 added CurrentEmployeeOfTheMonth to the H1 GameState slice (so the Lounge
// employee-of-the-month RequiredValues / RequiredFalseValues gates resolve and
// show the save's actual employee); an older cache lacks it.
// v21 added ObjectivesCompleted / LastObjectiveCompletedRun / LastObjectiveFailedRun
// to the H1 GameState slice so the newly-surfaced ObjectivesCompleted /
// ObjectiveCompletedLastOffer gates resolve against a save; an older cache lacks them.
// v22 extended the H1 slices for the run-history gates: SquelchedHermes /
// SquelchedHermesPermanently / EndingRoomName / RoomCountCache (pruned to the
// referenced rooms) on each RunHistory entry, and EndingRoomName / SquelchedHermes /
// SquelchedHermesPermanently on the currentRun, so ConsecutiveClearsOfRoom /
// ConsecutiveDeathsInRoom / Min/MaxRunsSinceSquelchedHermes resolve.
export const SAVE_STORAGE_SCHEMA = 22;

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
      currentRun: _saveCurrentRun || null,
      rooms: _saveRoomsSlice || null,
      prevRun: _savePrevRun || null,
      runHistory: _saveRunHistory || null,
      inRun: _saveInRun,
      audioState: _saveAudioState || null,
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
  _saveCurrentRun = (data.currentRun && typeof data.currentRun === 'object') ? data.currentRun : null;
  _saveRoomsSlice = Array.isArray(data.rooms) ? data.rooms : null;
  _savePrevRun = (data.prevRun && typeof data.prevRun === 'object') ? data.prevRun : null;
  _saveRunHistory = Array.isArray(data.runHistory) ? data.runHistory : null;
  _saveInRun = (typeof data.inRun === 'boolean') ? data.inRun : null;
  _saveAudioState = (data.audioState && typeof data.audioState === 'object') ? data.audioState : null;
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

// Whether a successfully-parsed save is an in-run autosave (true) or a hub save
// (false), decided from the save CONTENTS rather than its filename, so a
// custom-renamed ``.sav`` still classifies correctly. A hub save carries a
// game-specific "in the hub" marker that an in-run save never does:
//   * Hades II: the top-level ``CurrentHubRoom`` global (set on hub load, nil
//     during a run).
//   * Hades 1: there is no ``CurrentHubRoom``; the hub (House of Hades) sets the
//     top-level ``CurrentDeathAreaRoom`` global, and the hero is flagged
//     ``CurrentRun.Hero.IsDead`` the instant the run ends - the latter also
//     covers the death-moment hub save, taken before ``CurrentDeathAreaRoom``
//     is repopulated.
// ``GameState.LocationName === 'Location_Home'`` is a shared fallback for the
// rare boot / transition-window save where the primary hub global has not been
// (re)populated yet. Verified against both games' Lua save whitelists and their
// hub-load / StartOver write sites. Returns true (in-run) / false (hub), or
// null when there is no usable Lua state.
function detectInRun(gameId, luaState) {
  if (!luaState || typeof luaState !== 'object') return null;
  const gs = (luaState.GameState && typeof luaState.GameState === 'object') ? luaState.GameState : {};
  const cr = (luaState.CurrentRun && typeof luaState.CurrentRun === 'object') ? luaState.CurrentRun : null;
  const atHubLocation = gs.LocationName === 'Location_Home';
  let inHub;
  if (gameId === 'hades1') {
    const heroDead = !!(cr && cr.Hero && cr.Hero.IsDead);
    inHub = heroDead || !!luaState.CurrentDeathAreaRoom || atHubLocation;
  } else {
    inHub = !!luaState.CurrentHubRoom || atHubLocation;
  }
  return !inHub;
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
  _saveCurrentRun = ctx.currentRun;
  _saveRoomsSlice = ctx.rooms;
  _savePrevRun = ctx.prevRun;
  _saveRunHistory = ctx.runHistory;
  _saveAudioState = ctx.audioState;
  // Hub vs in-run is read from the save contents (see ``detectInRun``), not the
  // filename, so custom-renamed saves still classify correctly. It decides which
  // owners' CurrentRun.* gates resolve. Null (no usable state) -> indeterminate.
  _saveInRun = detectInRun(parsed.gameId, parsed.luaState);
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
  // A permanent structural lock (a required choice was taken differently, or a
  // mutually-exclusive line has played) is definitive, so it is checked first.
  // It must come BEFORE the 'eligible' verdict: a choice variant whose sibling
  // was chosen can still have its inherited requirements satisfied (so
  // directSatisfaction reads 'met') yet can never be obtained - checking
  // eligibility first would mislabel it 'eligible'. This keeps the badge in
  // lockstep with the eligibility tracer, which reports the same lock.
  if (isUnobtainable(name, _saveProgress, _saveRunsAgo, getSaveContext())) return 'unobtainable';
  // Respect per-type requirement semantics (AND / OR / negative) and the
  // record each field is scoped to (global / this-run / this-room / queued).
  const sat = directSatisfaction(textlineData, getSaveContext(), name);
  if (sat === 'met') return 'eligible';
  // 'unknown' -> the dialogue gates on a run-scoped record this save doesn't
  // carry (the H2 textline queue, or a current-run record when no run is
  // active), so we can't say whether it's eligible or blocked: surface it as
  // indeterminate.
  return sat === 'unknown' ? 'indeterminate' : 'blocked';
}

// Accept any ``.sav`` file: players and modders may rename their profiles
// (e.g. ``Profile1 Something.sav``), so the name is only a coarse gate - the
// real validation is whether ``parseSaveFile`` decodes it as an SGB1 save of a
// known game (it throws otherwise, surfaced as a parse error). Hub-vs-run is
// then decided from the save contents (see ``detectInRun``), not the name.
export function validateSaveFilename(filename) {
  return typeof filename === 'string' && /\.sav$/i.test(filename);
}

// ``activeGameId`` defaults to the loaded active game, but callers that run
// before the game data is registered (the early boot save pill) pass the
// game id explicitly, since ``getActiveGame()`` is still null then.
export function saveMatchesActiveGame(activeGameId) {
  if (!_saveGameId) return false;
  const active = activeGameId || getActiveGame();
  if (_saveGameId === active) return true;
  // A Hades II save only covers Hades 1 when the Zagreus' Journey mod (Hades
  // Biomes) ported Hades 1 content into it; a vanilla H2 save does not.
  if (_saveGameId === 'hades2' && active === 'hades1') return _saveHasBiomesMod;
  return false;
}
