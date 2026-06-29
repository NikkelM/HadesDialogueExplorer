// GameState requirement evaluator.
//
// Resolves a Hades II textline's non-textline requirements (the
// ``otherRequirements`` / engine ``GameStateRequirements`` table) against a
// loaded save's persistent ``GameState``. A direct JS port of the array-clause
// rules in the game's ``IsGameStateEligible`` (RequirementsLogic.lua), with the
// engine's exact nil / Lua-truthiness handling.
//
// Scope (Phase 1): clauses rooted at ``GameState.*`` (which the save stores
// wholesale) are resolved to a definite met / unmet. Everything the engine
// reads from somewhere a static save can't provide - the live speaker object
// (``PathFromSource`` / ``PathFromArgs``), the in-progress run / room / audio /
// map state (``CurrentRun.*`` / ``AudioState.*`` / ``MapState.*``,
// ``SumPrevRuns`` / ``SumPrevRooms``), named game functions (``FunctionName``),
// or RNG (``ChanceToPlay``) - is reported as ``unknown`` with a specific
// reason, never guessed. A missing ``GameState`` path resolves to 0 / false /
// empty exactly as the engine coerces it.
//
// Returns, for a whole requirement set, a three-state verdict (met / unmet /
// unknown) plus a per-clause breakdown the tracer renders as status dots.

import { namedRequirements, gameDataRefs, godTraitNames, restrictBoonChoiceTraitNames } from './data.js';
import { evaluateH1OtherRequirements, H1_OWNER_RUN_CONTEXT, h1FieldPermanentlyUnmet } from './gamestate-eval-h1.js';
import { gameStateClausePermanence } from './permanent-state.js';

// Lua truthiness: only nil and false are falsy. 0 and "" are TRUTHY. (The
// engine's PathTrue additionally rejects 0; that special case is handled at the
// PathTrue branch, not here.)
function luaTruthy(v) {
    return v !== undefined && v !== null && v !== false;
}

// pairs-style key count (game's TableLength), nil -> 0.
function tableLen(v) {
    return (v && typeof v === 'object') ? Object.keys(v).length : 0;
}

// IsEmpty: nil, or a table with zero keys.
function isEmptyTable(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false; // a scalar is not "empty" in the engine's table sense
}

// Resolve a list operand: either a literal array of keys, or a
// ``<ref:GameData.X>`` indirection into the shipped GameData lists. Returns null
// when a referenced list isn't in this build's data.
function resolveRefList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
        const m = /^<ref:(.+)>$/.exec(v);
        if (m) { const r = gameDataRefs[m[1]]; return Array.isArray(r) ? r : null; }
    }
    return null;
}

// Walk a path array from a base object, breaking (undefined) on the first nil
// hop - matching the engine, which stops descending at a nil sub-table.
function walkPath(base, path) {
    let v = base;
    for (const key of path) {
        if (v === undefined || v === null || typeof v !== 'object') return undefined;
        v = v[key];
        if (v === undefined) return undefined;
    }
    return v;
}

function compare(left, op, right) {
    // The engine compares ``(valueToCheck or 0)`` - Lua-falsy (nil / false)
    // coerces to 0; everything else (incl. 0, "") is compared as-is.
    const l = (left === undefined || left === null || left === false) ? 0 : left;
    switch (op) {
    case '==': case '=': return l === right;
    case '~=': case '!=': return l !== right;
    case '>=': return l >= right;
    case '>': return l > right;
    case '<=': return l <= right;
    case '<': return l < right;
    default: return false;
    }
}

const _MET = (status, reason, kind) => (kind ? { status, reason, kind } : { status, reason });
// Unknown verdict for a gate that the save *would* resolve if the other save
// type were loaded (a CurrentRun / SumPrevRooms / run-context FunctionName gate
// on a dialogue whose owner-context doesn't match the loaded save). Tagged so
// the tracer can group these and tell the user which save type to load.
const _WRONGSAVE = (reason) => ({ status: 'unknown', reason, kind: 'wrong-save-type' });

// Evaluate a ``SumPrevRuns`` clause: aggregate the run-relative ``Path`` over
// the last N runs (the current run plus recent ``RunHistory``, newest first),
// then compare. ``root._runs`` is the persisted runs slice (``[currentRun,
// ...history]``, each pruned to the referenced leaves). Modes mirror the
// engine: ``CountPathTrue`` counts runs where the path exists, ``TableValues
// ToCount`` counts listed keys present per run, ``ValuesToCount`` counts runs
// whose value matches, otherwise a numeric sum. ``IgnoreCurrentRun`` skips the
// current run. Returns 'unknown' when the save carries no runs slice.
function evalSumPrevRuns(rec, root) {
    const runs = root._runs;
    if (!Array.isArray(runs)) {
        return _MET('unknown', 'Aggregates across previous runs (RunHistory), which this save didn\u2019t carry.');
    }
    if (!Array.isArray(rec.Path) || !rec.Comparison) {
        return _MET('unknown', 'Unrecognised previous-runs aggregation.');
    }
    const n = rec.SumPrevRuns;
    // Engine loop: ``for runsBack = (IgnoreCurrentRun and 1 or 0), SumPrevRuns - 1``.
    // So the current run (index 0) plus history give ``n`` runs, but skipping the
    // current run yields only ``n - 1`` history runs (runsBack 1..n-1).
    const list = rec.IgnoreCurrentRun ? runs.slice(1, n) : runs.slice(0, n);
    let sum = 0;
    for (const run of list) {
        const v = walkPath(run, rec.Path);
        if (rec.CountPathTrue) {
            sum += (v !== undefined && v !== null) ? 1 : 0;
        } else if (Array.isArray(rec.TableValuesToCount)) {
            sum += rec.TableValuesToCount.filter(k => luaTruthy(v && v[k])).length;
        } else if (Array.isArray(rec.ValuesToCount)) {
            sum += rec.ValuesToCount.some(x => v === x) ? 1 : 0;
        } else {
            sum += (typeof v === 'number' ? v : 0);
        }
    }
    return _MET(compare(sum, rec.Comparison, rec.Value) ? 'met' : 'unmet');
}

// Evaluate a ``SumPrevRooms`` clause: aggregate the room-relative ``Path`` over
// the last N rooms of the current run (the current room plus recent
// ``RoomHistory``, newest first), then compare. ``root._rooms`` is the persisted
// room slice (``[currentRoom, ...history]``, each pruned to the referenced
// leaves). Unlike SumPrevRuns there is no ``IgnoreCurrentRoom`` - the engine
// always includes the current room (roomsBack starts at 0). Modes mirror the
// engine (CountPathTrue / TableValuesToCount / ValuesToCount / numeric sum).
// Returns 'unknown' when the save carries no room slice (e.g. a hub save, or a
// dialogue whose owner-context doesn't match the loaded save type).
function evalSumPrevRooms(rec, root) {
    const rooms = root._rooms;
    if (!Array.isArray(rooms)) {
        return _WRONGSAVE('Aggregates across rooms of the current run - load the matching in-run \u201C_Temp\u201D save to resolve it.');
    }
    if (!Array.isArray(rec.Path) || !rec.Comparison) {
        return _MET('unknown', 'Unrecognised previous-rooms aggregation.');
    }
    const list = rooms.slice(0, rec.SumPrevRooms);
    let sum = 0;
    for (const room of list) {
        const v = walkPath(room, rec.Path);
        if (rec.CountPathTrue) {
            sum += (v !== undefined && v !== null) ? 1 : 0;
        } else if (Array.isArray(rec.TableValuesToCount)) {
            sum += rec.TableValuesToCount.filter(k => luaTruthy(v && v[k])).length;
        } else if (Array.isArray(rec.ValuesToCount)) {
            sum += rec.ValuesToCount.some(x => v === x) ? 1 : 0;
        } else {
            sum += (typeof v === 'number' ? v : 0);
        }
    }
    return _MET(compare(sum, rec.Comparison, rec.Value) ? 'met' : 'unmet');
}

// Resolve a ``RequireRunsSinceTextLines`` / list operand to an array of textline
// names: a literal array, a ``<ref:GameData.X>`` indirection, or a single bare
// name string. Returns null when a referenced list isn't in this build's data.
function resolveTextLineList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
        const m = /^<ref:(.+)>$/.exec(v);
        if (m) { const r = gameDataRefs[m[1]]; return Array.isArray(r) ? r : null; }
        return [v];
    }
    return null;
}

// Evaluate ``RequireRunsSinceTextLines`` (RequirementsLogic.lua:1095): an AND
// over ``FunctionArgs.TextLines``; for each name, ``r`` = the fewest runs-ago it
// was played (``root._runsAgo[name]``; 0 = current run, 1 = last completed run,
// ...) or "never". The Min/Max window mirrors the engine's early-exit quirks:
//   both set  -> pass iff Min <= r <= Max; never-played PASSES (no early-exit).
//   Min only  -> pass iff r >= Min;        never-played PASSES.
//   Max only  -> pass iff r <  Max (Max exclusive); never-played FAILS.
function evalRunsSince(rec, root) {
    const runsAgo = root._runsAgo;
    if (!runsAgo) return _MET('unknown', 'Counts runs since a textline last played, which needs run history this save didn\u2019t carry.');
    const args = rec.FunctionArgs || {};
    const names = resolveTextLineList(args.TextLines);
    if (!names) return _MET('unknown', 'References a GameData textline list this build doesn\u2019t include.');
    const { Min: min, Max: max } = args;
    for (const name of names) {
        const r = runsAgo[name];
        const found = r !== undefined;
        let pass;
        if (min != null && max != null) pass = found ? (r >= min && r <= max) : true;
        else if (min != null) pass = found ? (r >= min) : true;
        else if (max != null) pass = found ? (r < max) : false;
        else pass = true;
        if (!pass) return _MET('unmet');
    }
    return _MET('met');
}

// Evaluate ``RequireQuestCount`` (RequirementsLogic.lua:992): count the entries
// in ``GameState.QuestStatus`` whose status string exactly equals
// ``FunctionArgs.Status`` (real data uses ``"CashedOut"`` = fully-claimed), then
// bound that count by the optional Min/Max. ``QuestStatus`` is a plain GameState
// sub-table fully preserved in the save; an absent table counts as 0.
function evalQuestCount(rec, root) {
    const gs = root.GameState;
    if (!gs) return _MET('unknown', 'No save loaded.');
    const args = rec.FunctionArgs || {};
    const qs = gs.QuestStatus;
    let n = 0;
    if (qs && typeof qs === 'object') {
        for (const k in qs) if (qs[k] === args.Status) n++;
    }
    if (args.Min != null && n < args.Min) return _MET('unmet');
    if (args.Max != null && n > args.Max) return _MET('unmet');
    return _MET('met');
}

// Static biome -> boss-difficulty encounter map (ShrineData.lua:125). Keyed by
// biome RoomSetName code; the dream-run branch of IsBossDifficultyShrineUpgrade
// Active reads the matching encounter's GameState cache.
const BOSS_DIFFICULTY_SHRINE_ENCOUNTER_BIOME_MAP = {
    F: { Encounter: 'BossHecate02' },
    G: { Encounter: 'BossScylla02' },
    H: { Encounter: 'BossInfestedCerberus02' },
    I: { Encounter: 'BossChronos02', OnlyRequireSeen: true },
    N: { Encounter: 'BossPolyphemus02' },
    O: { Encounter: 'BossEris02' },
    P: { Encounter: 'BossPrometheus02' },
    Q: { Encounter: 'BossTyphonHead02', OnlyRequireSeen: true },
};

// Evaluate ``IsBossDifficultyShrineUpgradeActive`` (ShrineLogic.lua:939): the
// boss-difficulty vow is active while its rank is at least the number of biomes
// entered this run. Reads ``GameState.ShrineUpgrades.BossDifficultyShrineUpgrade``
// (or ``CurrentRun.ShrineUpgradesCache.*`` with ``UseShrineUpgradesCache``) vs
// ``CurrentRun.EnteredBiomes``. The dream-run branch additionally gates on having
// seen / beaten the current biome's hard boss (GameState.Encounters*Cache). All
// from saved state; needs CurrentRun (owner/save-type gated).
function evalBossDifficulty(rec, root) {
    const cr = root.CurrentRun;
    const gs = root.GameState;
    if (!cr) return _WRONGSAVE('Checks the boss-difficulty vow against the current run - load the matching save type to resolve it.');
    const args = rec.FunctionArgs || {};
    const entered = cr.EnteredBiomes || 0;
    const rank = args.UseShrineUpgradesCache
        ? ((cr.ShrineUpgradesCache && cr.ShrineUpgradesCache.BossDifficultyShrineUpgrade) || 0)
        : ((gs && gs.ShrineUpgrades && gs.ShrineUpgrades.BossDifficultyShrineUpgrade) || 0);
    if (rank < entered) return _MET('unmet');
    if (cr.IsDreamRun && entered > 0) {
        const biome = Array.isArray(cr.BiomeVisitOrder) ? cr.BiomeVisitOrder[entered - 1] : (cr.BiomeVisitOrder || {})[entered];
        const map = BOSS_DIFFICULTY_SHRINE_ENCOUNTER_BIOME_MAP[biome];
        if (!map) return _MET('unknown', 'Dream-run boss-difficulty check for an unmapped biome.');
        const cache = map.OnlyRequireSeen ? (gs && gs.EncountersOccurredCache) : (gs && gs.EncountersCompletedCache);
        return _MET(luaTruthy(cache && cache[map.Encounter]) ? 'met' : 'unmet');
    }
    return _MET('met');
}

// Evaluate ``RequiredHealthFraction`` (RequirementsLogic.lua:890): compare the
// hero's current health fraction (``CurrentRun.Hero.Health / .MaxHealth``)
// against ``FunctionArgs.{Comparison,Value}``. Save-resolvable from CurrentRun.
function evalHealthFraction(rec, root) {
    const cr = root.CurrentRun;
    if (!cr) return _WRONGSAVE('Checks the hero\u2019s current-run health - load the matching save type to resolve it.');
    const hero = cr.Hero || {};
    const max = hero.MaxHealth;
    if (typeof hero.Health !== 'number' || typeof max !== 'number') {
        return _MET('unknown', 'The save didn\u2019t carry the hero\u2019s health for this run.');
    }
    const frac = hero.Health / max;
    const args = rec.FunctionArgs || {};
    return _MET(compare(frac, args.Comparison, args.Value) ? 'met' : 'unmet');
}

// ``Contains(list, value)`` (UtilityLogic.lua:789): true if ``value`` is one of
// the array's values. Returns a falsy (not strictly false) when value is nil -
// callers rely on ``!Contains(...)`` being true for a nil EndingRoomName.
function listContains(list, value) {
    if (value === undefined || value === null) return false;
    return Array.isArray(list) && list.includes(value);
}
// ``ContainsAnyKey(table, keys)`` (UtilityLogic.lua:431): true if any key is
// present with a truthy value in the table (a count >= 1 is truthy).
function containsAnyKey(table, keys) {
    if (!table || typeof table !== 'object') return false;
    return keys.some(k => luaTruthy(table[k]));
}

// Evaluate ``RequiredConsecutiveClearsOfRoom`` (RequirementsLogic.lua:766): the
// number of consecutive recent runs (current run seed + RunHistory newest-first)
// that entered one of ``args.Names`` and cleared it must be >= ``args.Count``.
// Non-visiting runs are skipped (transparent). Ported verbatim incl. the line-786
// quirk where the history loop uses the *current* run's BountyCleared. Reads
// CurrentRun (gated) + ``root._runHistory`` (recent runs, newest-first).
function evalConsecutiveClears(rec, root) {
    const cr = root.CurrentRun;
    if (!cr) return _WRONGSAVE('Counts consecutive cleared runs of a room - load the matching save type to resolve it.');
    const args = rec.FunctionArgs || {};
    const roomNames = Array.isArray(args.Names) ? args.Names : [args.Name];
    const history = Array.isArray(root._runHistory) ? root._runHistory : [];
    let streak = 0;
    if (containsAnyKey(cr.RoomCountCache, roomNames)) {
        if (luaTruthy(cr.Cleared) || luaTruthy(cr.BountyCleared) || !listContains(roomNames, cr.EndingRoomName)) streak += 1;
        else return _MET('unmet');
    }
    for (const run of history) { // newest-first
        if (run && run.RoomsEntered != null && run.EndingRoomName != null && containsAnyKey(run.RoomsEntered, roomNames)) {
            if (luaTruthy(run.Cleared) || luaTruthy(cr.BountyCleared) || !listContains(roomNames, run.EndingRoomName)) streak += 1;
            else break;
        }
    }
    return _MET(streak >= args.Count ? 'met' : 'unmet');
}

// Evaluate ``RequiredConsecutiveDeathsInRoom`` (RequirementsLogic.lua:729): the
// mirror of the clears check - count consecutive recent runs that entered the
// room and *died in it*. Uses each run's own BountyCleared (no quirk).
function evalConsecutiveDeaths(rec, root) {
    const cr = root.CurrentRun;
    if (!cr) return _WRONGSAVE('Counts consecutive deaths in a room - load the matching save type to resolve it.');
    const args = rec.FunctionArgs || {};
    const roomNames = Array.isArray(args.Names) ? args.Names : [args.Name];
    const history = Array.isArray(root._runHistory) ? root._runHistory : [];
    let streak = 0;
    if (containsAnyKey(cr.RoomCountCache, roomNames)) {
        if (!luaTruthy(cr.Cleared) && !luaTruthy(cr.BountyCleared) && listContains(roomNames, cr.EndingRoomName)) streak += 1;
        else return _MET('unmet');
    }
    for (const run of history) { // newest-first
        if (run && run.RoomsEntered != null && run.EndingRoomName != null && containsAnyKey(run.RoomsEntered, roomNames)) {
            if (!luaTruthy(run.Cleared) && !luaTruthy(run.BountyCleared) && listContains(roomNames, run.EndingRoomName)) streak += 1;
            else break;
        }
    }
    return _MET(streak >= args.Count ? 'met' : 'unmet');
}

// Iterate the hero's equipped traits from a CurrentRun slice. The
// luabins-decoded ``Hero.Traits`` is a 1-based Lua array, surfaced as
// either a JS array or an object with numeric-string keys; the save
// parser prunes each entry to ``{Name, Rarity, RestrictBoonChoices}``.
function heroTraitList(cr) {
    const traits = cr && cr.Hero && cr.Hero.Traits;
    if (!traits || typeof traits !== 'object') return [];
    return Array.isArray(traits) ? traits : Object.values(traits);
}

// Evaluate ``RequiredSellableGodTraits`` (RequirementsLogic.lua:1187):
// true iff the hero holds at least one *god* trait (IsGodTrait with
// ForShop) that also carries a ``Rarity``. ``godTraitNames`` is the
// pre-computed ForShop IsGodTrait set. Save-resolvable from CurrentRun.
function evalSellableGodTraits(rec, root) {
    const cr = root.CurrentRun;
    if (!cr) return _WRONGSAVE('Checks the hero\u2019s current-run boons - load the matching save type to resolve it.');
    const has = heroTraitList(cr).some(t =>
        t && godTraitNames.has(t.Name) && t.Rarity !== undefined && t.Rarity !== null && t.Rarity !== false);
    return _MET(has ? 'met' : 'unmet');
}

// Evaluate ``RequireUnrestrictedBoonChoices`` (RequirementsLogic.lua:869):
// false (restricted) iff any equipped trait defines ``RestrictBoonChoices``.
// The equipped instance carries the field (copied from the static def),
// with ``restrictBoonChoiceTraitNames`` as a by-name fallback.
// Save-resolvable from CurrentRun.
function evalUnrestrictedBoonChoices(rec, root) {
    const cr = root.CurrentRun;
    if (!cr) return _WRONGSAVE('Checks the hero\u2019s current-run boons - load the matching save type to resolve it.');
    const restricted = heroTraitList(cr).some(t =>
        t && ((t.RestrictBoonChoices !== undefined && t.RestrictBoonChoices !== null) || restrictBoonChoiceTraitNames.has(t.Name)));
    return _MET(restricted ? 'unmet' : 'met');
}

// AudioState.* (AmbientTrackName / MusicName) is the live audio snapshot the H2
// save persists at the top level. The track keeps playing until the player acts
// (audio does not fade out on its own), so the snapshot is the live track and an
// IsAny / IsNone membership test resolves to 'met' or 'unmet'. Only the absence
// of any AudioState slice (or an unrecognised shape) stays indeterminate.
function evalAudioState(rec, path, root) {
    if (!root.AudioState) return _MET('unknown', 'Reads AudioState.* - live audio state this save didn\u2019t carry.');
    // The saved ambient / music track keeps playing until the player acts (audio
    // does not fade out on its own), so the snapshot is the live track: a
    // membership test resolves to eligible or blocked, never indeterminate.
    const val = walkPath(root, path);
    if (rec.IsNone) return _MET((Array.isArray(rec.IsNone) ? rec.IsNone : []).some(v => val === v) ? 'unmet' : 'met');
    if (rec.IsAny) return _MET((Array.isArray(rec.IsAny) ? rec.IsAny : []).some(v => val === v) ? 'met' : 'unmet');
    return _MET('unknown', 'Unrecognised AudioState condition shape.');
}

// Evaluate a single clause record against ``root`` (the resolution base, an
// object exposing ``GameState`` and the runs slice ``_runs``). Returns
// { status, reason? }. ``status`` is 'met' | 'unmet' | 'unknown'; 'unknown'
// always carries a human reason.
function evalClause(rec, root) {
    if (!rec || typeof rec !== 'object') {
        return _MET('unknown', 'Unrecognised condition shape.');
    }
    if (rec.FunctionName) {
        if (rec.FunctionName === 'RequireRunsSinceTextLines') return evalRunsSince(rec, root);
        if (rec.FunctionName === 'RequireQuestCount') return evalQuestCount(rec, root);
        if (rec.FunctionName === 'IsBossDifficultyShrineUpgradeActive') return evalBossDifficulty(rec, root);
        if (rec.FunctionName === 'RequiredHealthFraction') return evalHealthFraction(rec, root);
        if (rec.FunctionName === 'RequiredConsecutiveClearsOfRoom') return evalConsecutiveClears(rec, root);
        if (rec.FunctionName === 'RequiredConsecutiveDeathsInRoom') return evalConsecutiveDeaths(rec, root);
        if (rec.FunctionName === 'RequiredSellableGodTraits') return evalSellableGodTraits(rec, root);
        if (rec.FunctionName === 'RequireUnrestrictedBoonChoices') return evalUnrestrictedBoonChoices(rec, root);
        return _MET('unknown', `Calls the game function ${rec.FunctionName}() - evaluated in-engine from live run / room / combat state a static save doesn\u2019t store.`);
    }
    if (rec.PathFromSource || rec.PathFromArgs) {
        return _MET('unknown', 'Read from the live speaker / call context, which a save file doesn\u2019t store.');
    }
    if (rec.SumPrevRuns !== undefined) {
        return evalSumPrevRuns(rec, root);
    }
    if (rec.SumPrevRooms !== undefined) {
        return evalSumPrevRooms(rec, root);
    }

    const path = rec.Path || rec.PathTrue || rec.PathFalse || rec.PathEmpty || rec.PathNotEmpty;
    if (!Array.isArray(path) || path.length === 0) {
        return _MET('unknown', 'Unrecognised condition shape.');
    }
    const base = path[0];
    if (base === 'AudioState') return evalAudioState(rec, path, root);
    if (base !== 'GameState' && base !== 'PrevRun') {
        // CurrentRun.* resolves from the persisted CurrentRun slice, but only
        // when the caller supplied one (the dialogue's owner matches the loaded
        // save type - see ``currentRunResolvable``). Otherwise it stays
        // indeterminate, like the other live-state roots. PrevRun.* (the last
        // completed run) always resolves from its slice when a save is loaded -
        // it isn't owner/save-type gated.
        if (base === 'CurrentRun' && root.CurrentRun) {
            // fall through to the shared resolver below (walkPath reads root.CurrentRun.*)
        } else if (base === 'CurrentRun') {
            return _WRONGSAVE('Reads CurrentRun.* - current-run state, load the matching save type to resolve it (an in-run \u201C_Temp\u201D save for run dialogue, a hub save for hub dialogue).');
        } else {
            const why = base === 'MapState' ? 'live room/map state' : `${base} state`;
            return _MET('unknown', `Reads ${base}.* - ${why}, not resolved in this pass.`);
        }
    }
    // ``PrevRun.*`` reads the persisted last-completed-run slice (null when the
    // save carries no completed run - walkPath then coerces to nil/0/false, which
    // matches the engine's nil ``PrevRun``).
    const val = walkPath(root, path);

    // Boolean / table-shape terminal operators.
    if (rec.PathTrue) return _MET((luaTruthy(val) && val !== 0) ? 'met' : 'unmet');
    if (rec.PathFalse) return _MET(!luaTruthy(val) ? 'met' : 'unmet');
    if (rec.PathEmpty) return _MET(isEmptyTable(val) ? 'met' : 'unmet');
    if (rec.PathNotEmpty) return _MET(!isEmptyTable(val) ? 'met' : 'unmet');

    // Set-membership operators over the resolved table. The operand may be a
    // literal key list or a ``<ref:GameData.X>`` indirection.
    if (rec.HasNone || rec.HasAny || rec.HasAll) {
        const list = resolveRefList(rec.HasNone || rec.HasAny || rec.HasAll);
        if (!list) return _MET('unknown', 'Tests a GameData list this build doesn\u2019t include.');
        if (rec.HasNone) return _MET(list.some(k => luaTruthy(val && val[k])) ? 'unmet' : 'met');
        if (rec.HasAny) return _MET((val != null && list.some(k => luaTruthy(val[k]))) ? 'met' : 'unmet');
        return _MET((val != null && list.every(k => luaTruthy(val[k]))) ? 'met' : 'unmet'); // HasAll
    }
    if (rec.IsNone) return _MET((Array.isArray(rec.IsNone) ? rec.IsNone : []).some(v => val === v) ? 'unmet' : 'met');
    if (rec.IsAny) return _MET((Array.isArray(rec.IsAny) ? rec.IsAny : []).some(v => val === v) ? 'met' : 'unmet');

    // Numeric comparison, with an optional aggregation over the resolved table.
    if (rec.Comparison) {
        let left = val;
        if (rec.UseLength) {
            left = tableLen(val);
        } else if (rec.CountOf !== undefined) {
            const list = resolveRefList(rec.CountOf);
            if (!list) return _MET('unknown', 'Counts a GameData list this build doesn\u2019t include.');
            left = list.filter(k => luaTruthy(val && val[k])).length;
        } else if (rec.SumOf !== undefined) {
            const list = resolveRefList(rec.SumOf) || rec.SumOf;
            left = (Array.isArray(list) ? list : []).reduce((s, k) => s + (((val && val[k]) || 0)), 0);
        }
        if (rec.Modulo !== undefined && left != null) left = left % rec.Modulo;

        let right = rec.Value;
        if (rec.ValuePath) {
            if (rec.ValuePath[0] !== 'GameState') {
                return _MET('unknown', `Compared against ${rec.ValuePath[0]}.*, not resolved in this pass.`);
            }
            let rv = walkPath(root, rec.ValuePath);
            rv = (rv === undefined || rv === null) ? 0 : rv;
            if (rec.ValuePathAddition !== undefined) rv += rec.ValuePathAddition;
            right = rv;
        }
        return _MET(compare(left, rec.Comparison, right) ? 'met' : 'unmet');
    }

    return _MET('unknown', 'Unrecognised condition shape.');
}

// AND-combine clause verdicts: any unmet -> unmet; else any unknown -> unknown;
// else met.
function combineAnd(statuses) {
    if (statuses.includes('unmet')) return 'unmet';
    if (statuses.includes('unknown')) return 'unknown';
    return 'met';
}

// Evaluate a named requirement set (a textline-shaped { otherRequirements }
// block) for the NamedRequirements* operators. ``stack`` guards against a
// cyclic named-requirement reference. Returns 'met' | 'unmet' | 'unknown'.
function evalNamedSet(name, root, stack) {
    if (stack.has(name)) return 'unknown';
    const def = namedRequirements[name];
    if (!def) return _METUnknownNamed();
    stack.add(name);
    const res = evalSet(def.otherRequirements || {}, root, stack);
    stack.delete(name);
    return res.status;
}
function _METUnknownNamed() { return 'unknown'; }

// Evaluate a whole requirement set's gate clauses. Returns
// { status, clauses: [{ key, status, reason }] }. ``stack`` carries the
// named-requirement recursion guard.
function evalSet(otherRequirements, root, stack) {
    const clauses = [];
    const statuses = [];
    for (const [key, val] of Object.entries(otherRequirements || {})) {
        if (key === 'NamedRequirements' || key === 'NamedRequirementsFalse') {
            const names = Array.isArray(val) ? val : [];
            const sub = names.map(n => evalNamedSet(n, root, stack));
            let st;
            if (key === 'NamedRequirements') {
                // AND: every named block must be met.
                st = combineAnd(sub);
            } else {
                // NamedRequirementsFalse - NOT(any named block eligible):
                // unmet if any named block is met; unknown if none met but any
                // can't be confirmed; else met.
                st = sub.includes('met') ? 'unmet' : (sub.includes('unknown') ? 'unknown' : 'met');
            }
            clauses.push({ key, status: st, reason: st === 'unknown' ? 'Depends on a named requirement block that can\u2019t be fully resolved from the save.' : null });
            statuses.push(st);
            continue;
        }
        if (!Array.isArray(val)) continue; // count-meta (e.g. { Count: n }) - not a gate
        // A keyed entry holds one or more clause records, all of which must hold.
        const recStatuses = [];
        let firstReason = null;
        let firstKind = null;
        for (const rec of val) {
            const r = evalClause(rec, root);
            recStatuses.push(r.status);
            if (r.status === 'unknown' && !firstReason) { firstReason = r.reason; firstKind = r.kind || null; }
            if (r.status === 'unmet') firstReason = firstReason || null;
        }
        const st = combineAnd(recStatuses);
        const clause = { key, status: st, reason: st === 'unknown' ? firstReason : null };
        if (st === 'unknown' && firstKind) clause.kind = firstKind;
        clauses.push(clause);
        statuses.push(st);
    }
    return { status: combineAnd(statuses), clauses };
}

// Public: evaluate a textline's ``otherRequirements`` against a loaded save's
// pruned ``GameState`` slice. Returns { status, clauses } where ``status`` is
// 'met' | 'unmet' | 'unknown' and ``clauses`` lists each gate's verdict (with a
// reason for every 'unknown'). ``gameStateSlice`` is the persisted GameState
// (or null when no save is loaded -> everything 'unknown'). ``slices`` bundles
// the optional run/room-scoped slices used by the aggregate / non-GameState
// roots: ``{ runs, runsAgo, currentRun, rooms, prevRun }`` (each null when the
// save doesn't carry it or the dialogue's owner-context doesn't match the save
// type). ``runs`` -> SumPrevRuns; ``rooms`` -> SumPrevRooms; ``runsAgo`` ->
// RequireRunsSinceTextLines; ``currentRun`` -> CurrentRun.*; ``prevRun`` ->
// PrevRun.* (the last completed run); ``runHistory`` -> the recent-runs slice for
// RequiredConsecutiveClearsOfRoom / RequiredConsecutiveDeathsInRoom.
export function evaluateOtherRequirements(otherRequirements, gameStateSlice, slices = {}, gameId) {
    if (!otherRequirements || Object.keys(otherRequirements).length === 0) {
        return { status: 'met', clauses: [] };
    }
    // Hades 1 uses a flat named-field requirement model (RequiredKills,
    // RequiredRoom, ...), evaluated by its own sibling module. Callers pass the
    // dialogue's game id; only 'hades1' takes the H1 path (omitted -> H2, the
    // legacy default used by the H2-shaped unit tests).
    if (gameId === 'hades1') {
        const ctx = gameStateSlice ? {
            gs: gameStateSlice,
            currentRun: (slices && slices.currentRun) || null,
            prevRun: (slices && slices.prevRun) || null,
            runHistory: (slices && slices.runHistory) || null,
        } : null;
        return evaluateH1OtherRequirements(otherRequirements, ctx);
    }
    if (!gameStateSlice) {
        const clauses = Object.keys(otherRequirements)
            .filter(k => Array.isArray(otherRequirements[k]) || k.startsWith('NamedRequirements'))
            .map(key => ({ key, status: 'unknown', reason: 'No save loaded.' }));
        return { status: clauses.length ? 'unknown' : 'met', clauses };
    }
    const { runs = null, runsAgo = null, currentRun = null, rooms = null, prevRun = null, runHistory = null, audioState = null } = slices || {};
    return evalSet(otherRequirements, { GameState: gameStateSlice, CurrentRun: currentRun, PrevRun: prevRun, AudioState: audioState, _runs: runs, _runsAgo: runsAgo, _rooms: rooms, _runHistory: runHistory }, new Set());
}

// Per-operand satisfaction for the H2 ``Path:<head>`` membership gates, so the
// detail panel can mark which items in a listed set the loaded save satisfies.
// Handles the membership records whose operands render as an explicit list:
// ``HasAny`` / ``HasAll`` (table contains the key), ``IsAny`` (scalar equals an
// option) and ``CountOf`` (table contains the key). A record whose resolved
// path is nil contributes nothing (indeterminate); ``<ref:...>`` list operands
// render as a single collapsed chip rather than individual items, so they fall
// through unmarked. Returns the union Set of satisfied operands across the
// gate's records, or null when the gate isn't a markable Path membership.
export function h2SatisfiedOperands(key, val, slices = {}) {
    if (typeof key !== 'string' || !key.startsWith('Path:') || !Array.isArray(val)) return null;
    // A "present member is good" set only: if any record makes presence work
    // *against* eligibility (a HasNone exclusion, or a count/sum upper bound the
    // members push you past, e.g. FamiliarsUnlocked "fewer than 5 of"), marking
    // the present members green would falsely read as progress, so mark nothing.
    const presenceIsBad = val.some(rec => rec && typeof rec === 'object'
        && (rec.HasNone
            || ((rec.CountOf !== undefined || rec.SumOf !== undefined)
                && (rec.Comparison === '<' || rec.Comparison === '<='))));
    if (presenceIsBad) return null;
    const { runs = null, runsAgo = null, currentRun = null, rooms = null, prevRun = null, runHistory = null, audioState = null } = slices || {};
    const root = { GameState: slices.gameState || slices.GameState || null, CurrentRun: currentRun, PrevRun: prevRun, AudioState: audioState, _runs: runs, _runsAgo: runsAgo, _rooms: rooms, _runHistory: runHistory };
    const met = new Set();
    let determinable = false;
    for (const rec of val) {
        if (!rec || typeof rec !== 'object' || !Array.isArray(rec.Path)) continue;
        const resolved = walkPath(root, rec.Path);
        const memberList = rec.HasAny || rec.HasAll || (rec.CountOf !== undefined ? rec.CountOf : null);
        if (memberList != null) {
            const list = resolveRefList(memberList);
            if (!Array.isArray(list)) continue; // <ref:...> collapses to one chip
            if (resolved == null || typeof resolved !== 'object') continue; // nil path: can't tell which are present
            determinable = true;
            for (const k of list) if (luaTruthy(resolved[k])) met.add(k);
        } else if (Array.isArray(rec.IsAny)) {
            if (resolved === undefined) continue;
            determinable = true;
            for (const v of rec.IsAny) if (resolved === v) met.add(v);
        }
    }
    return determinable ? met : null;
}


// Whether a single resolved gate (one ``otherRequirements`` key) is
// *permanently* unmet against the loaded save: it reads persistent save
// progress that only ever advances (a monotonic counter past its cap, or a
// write-once "must NOT have happened" record that already has), so it can never
// be satisfied again. Dispatches by game - H1 named-field gates via
// ``h1FieldPermanentlyUnmet``, H2 clause-array gates via
// ``gameStateClausePermanence`` (permanently unmet if ANY AND-clause is). The
// detail / eligibility / tracer views call this to upgrade a gate's dot from
// "blocked" to "unobtainable", matching the dialogue's overall verdict.
export function gateClausePermanentlyUnmet(key, otherRequirements, gameStateSlice, gameId) {
    if (!gameStateSlice || !otherRequirements) return false;
    const val = otherRequirements[key];
    if (val == null) return false;
    if (gameId === 'hades1') return h1FieldPermanentlyUnmet(key, val, gameStateSlice, otherRequirements);
    return Array.isArray(val) && val.some(rec => gameStateClausePermanence(rec, gameStateSlice) === 'unmet');
}

// Dialogue-trigger context per owner, used to decide whether a dialogue's
// ``CurrentRun.*`` gates can be resolved from a loaded save, and from which save
// type. A hub save (ProfileX.sav) and an in-run autosave (ProfileX_Temp.sav)
// both carry a ``CurrentRun`` table, but they mean different things:
//   * an in-run save's CurrentRun is the run the player is *currently* in;
//   * a hub save's CurrentRun is the run that *just ended* - the engine never
//     clears it back to nil on returning to the Crossroads (it is only nilled
//     transiently inside EndRun, immediately before StartNewRun rebuilds it), so
//     it persists as a full snapshot of the last descent.
//
// We therefore resolve CurrentRun.* gates only when the loaded save type matches
// the owner's trigger context: 'run' owners (boon gods, biome NPCs, bosses) need
// an in-run save; 'hub' owners (Crossroads / House speakers) read against a hub
// save, where "this run" correctly means "the run that just ended" - exactly the
// semantics Crossroads dialogue intends. 'both' owners resolve from either.
//
// Resolving a 'hub' owner's gates against a hub save is faithful, not a guess: the
// engine evaluates Crossroads dialogue eligibility against the very same persisted
// CurrentRun the save holds, so we read what the game reads. This is by design -
// hub lines routinely gate on the just-ended run, e.g. CurrentRun.Hero.IsDead
// (the Artemis hub songs / Nyx nightmare after a death; SeleneTrueEnding01 gates
// on NOT IsDead, i.e. a victorious return), CurrentRun.Cleared (Arachne's
// post-clear hub lines) and CurrentRun.RoomsEntered.<boss> ("you reached X this
// run"). The death-state values (Hero.IsDead / Health, and the trait tables
// ClearUpgrades empties on death) are not "stale" here - they are precisely the
// state the game gates on in the hub, so our verdict matches it.
//
// Why not also relax this for 'run' owners and resolve their gates against a hub
// save? Because a run owner's dialogue triggers *during a future descent*, which
// the game evaluates against that descent's live CurrentRun - state a hub save (a
// snapshot of the *previous* run) simply doesn't describe. The gates run dialogue
// leans on most would all answer about the wrong run: per-run boon pickups
// (UseRecord.<God>Upgrade), the current room (CurrentRoom.Name/RoomSetName) and
// biomes reached; and the death-wiped Hero.Traits / LastStands would read "no
// boon". So for run owners a hub save earns an honest "indeterminate" instead of
// a confidently-wrong verdict.
//
// Owners absent from this map don't gate on CurrentRun.* today; their gates stay
// indeterminate. Classification reviewed against the game's run lifecycle
// (RunLogic StartNewRun / EndRun, DeathLoopLogic, RoomLogic ClearUpgrades) and
// the Crossroads-vs-in-biome spawn split.
export const OWNER_RUN_CONTEXT = {
    // hub (12): Crossroads / House / flashback speakers
    NPC_Arachne_Home_01: 'hub', NPC_Artemis_01: 'hub', NPC_Dora_01: 'hub',
    NPC_Hecate_01: 'hub', NPC_Moros_01: 'hub', NPC_Nyx_01: 'hub',
    NPC_Selene_01: 'hub', NPC_Skelly_01: 'hub', NPC_Hecate_Story_01: 'hub',
    NPC_Eris_01: 'hub', NPC_Odysseus_01: 'hub',
    // run (39): boon gods, biome NPCs, story scenes, bosses
    AphroditeUpgrade: 'run', ApolloUpgrade: 'run', AresUpgrade: 'run',
    DemeterUpgrade: 'run', HephaestusUpgrade: 'run', HeraUpgrade: 'run',
    HermesUpgrade: 'run', HestiaUpgrade: 'run', PoseidonUpgrade: 'run',
    ZeusUpgrade: 'run', TrialUpgrade: 'run', SpellDrop: 'run',
    NPC_Artemis_Field_01: 'run', NPC_Hades_Field_01: 'run',
    NPC_Apollo_Story_01: 'run', NPC_Chronos_Story_01: 'run', NPC_Nyx_Story_01: 'run',
    NPC_Arachne_01: 'run', NPC_Athena_01: 'run', NPC_Chronos_01: 'run',
    NPC_Chronos_02: 'run', NPC_Circe_01: 'run', NPC_Dionysus_01: 'run',
    NPC_Echo_01: 'run', NPC_Hermes_01: 'run', NPC_Hypnos_DreamRun: 'run',
    NPC_Medea_01: 'run', NPC_Narcissus_01: 'run', NPC_Zagreus_Past_01: 'run',
    NPC_Heracles_01: 'run', Chronos: 'run', Eris: 'run', Hecate: 'run', Polyphemus: 'run',
    Prometheus: 'run', Scylla: 'run', Zagreus: 'run', InfestedCerberus: 'run', TyphonHead: 'run',
    // both (5): single owner that speaks in hub AND run
    NPC_Nemesis_01: 'both', NPC_Icarus_01: 'both', PlayerUnit: 'both', Speaker_Homer: 'both',
    NPC_Charon_01: 'both', 
};

// Whether a dialogue owned by ``owner`` can have its ``CurrentRun.*`` gates
// resolved from a loaded save of the given type. ``saveInRun`` is true for an
// in-run (_Temp) save, false for a hub save. ``both`` resolves either way;
// unlisted owners stay indeterminate.
export function currentRunResolvable(owner, saveInRun, gameId) {
    const map = (gameId === 'hades1') ? H1_OWNER_RUN_CONTEXT : OWNER_RUN_CONTEXT;
    const ctx = map[owner];
    if (ctx === 'both') return true;
    if (ctx === 'run') return saveInRun === true;
    if (ctx === 'hub') return saveInRun === false;
    return false;
}

// Build the run / room / audio slices bundle ``evaluateOtherRequirements``
// consumes, from a save context (``getSaveContext()``). CurrentRun.* and
// SumPrevRooms gates resolve only when the dialogue's owner-context matches the
// loaded save type (hub save vs in-run _Temp save), so currentRun and rooms are
// gated on ``currentRunResolvable``; the run-count, runs-since, prev-run,
// run-history and live-audio slices are always available. Single source of truth:
// a new save-slice field added here reaches every caller at once, so per-clause
// dots can't silently fall back to indeterminate when one call site is missed.
export function buildOtherReqSlices(ctx, owner, gameId) {
    const resolveRun = currentRunResolvable(owner, ctx.saveInRun, gameId);
    return {
        runs: ctx.runs,
        runsAgo: ctx.runsAgo,
        prevRun: ctx.prevRun,
        runHistory: ctx.runHistory,
        currentRun: resolveRun ? ctx.currentRun : null,
        rooms: resolveRun ? ctx.rooms : null,
        audioState: ctx.audioState,
    };
}

// A nested "mask" of the exact ``rootKey`` (``GameState`` or ``CurrentRun``)
// paths any clause in ``textlines`` reads, so the save parser can persist a
// minimal slice instead of whole (often huge) sub-tables. A mask node is either
// ``true`` (capture the value at this leaf), ``'*'`` (capture this whole
// sub-table - needed by UseLength / PathEmpty / PathNotEmpty, which count keys),
// or a nested object. SumPrevRuns/Rooms, FunctionName (except GameState
// QuestStatus), the non-``rootKey`` roots and PathFromSource are skipped.
// Recurses NamedRequirements*.
function collectRootedPaths(textlines, namedReqs, rootKey) {
    const mask = {};
    const seenNamed = new Set();

    // Mark a leaf path (array under ``rootKey``, e.g. ['GameState','EnemyKills',
    // 'Hecate']) for capture. A ``'*'`` ancestor already covers it.
    const markLeaf = (pathArr) => {
        if (!Array.isArray(pathArr) || pathArr[0] !== rootKey || pathArr.length < 2) return;
        let node = mask;
        for (let i = 1; i < pathArr.length - 1; i++) {
            const k = pathArr[i];
            if (typeof k !== 'string') return;
            if (node[k] === '*' || node[k] === true) return;
            if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
            node = node[k];
        }
        const last = pathArr[pathArr.length - 1];
        if (typeof last !== 'string') return;
        if (node[last] !== '*') node[last] = (typeof node[last] === 'object' && node[last] !== null) ? node[last] : true;
    };
    // Mark a whole sub-table (path array under ``rootKey``) for capture.
    const markWhole = (pathArr) => {
        if (!Array.isArray(pathArr) || pathArr[0] !== rootKey || pathArr.length < 2) return;
        let node = mask;
        for (let i = 1; i < pathArr.length - 1; i++) {
            const k = pathArr[i];
            if (typeof k !== 'string') return;
            if (node[k] === '*') return;
            if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
            node = node[k];
        }
        node[pathArr[pathArr.length - 1]] = '*';
    };

    const scanRec = (rec) => {
        if (!rec || typeof rec !== 'object') return;
        if (rec.FunctionName) {
            // The resolvable FunctionName gates read implicit (non-Path) state;
            // mark the fields each reads so the save parser captures them. Paths
            // are split by root: GameState fields under the GameState mask,
            // CurrentRun fields under the CurrentRun mask. RequireRunsSinceText
            // Lines uses the run-scoped runsAgo map, not a path slice.
            const fn = rec.FunctionName;
            if (rootKey === 'GameState') {
                if (fn === 'RequireQuestCount') markWhole(['GameState', 'QuestStatus']);
                if (fn === 'IsBossDifficultyShrineUpgradeActive') {
                    markLeaf(['GameState', 'ShrineUpgrades', 'BossDifficultyShrineUpgrade']);
                    markWhole(['GameState', 'EncountersOccurredCache']);
                    markWhole(['GameState', 'EncountersCompletedCache']);
                }
            } else if (rootKey === 'CurrentRun') {
                if (fn === 'IsBossDifficultyShrineUpgradeActive') {
                    markLeaf(['CurrentRun', 'EnteredBiomes']);
                    markLeaf(['CurrentRun', 'IsDreamRun']);
                    markLeaf(['CurrentRun', 'ShrineUpgradesCache', 'BossDifficultyShrineUpgrade']);
                    markWhole(['CurrentRun', 'BiomeVisitOrder']);
                }
                if (fn === 'RequiredHealthFraction') {
                    markLeaf(['CurrentRun', 'Hero', 'Health']);
                    markLeaf(['CurrentRun', 'Hero', 'MaxHealth']);
                }
                if (fn === 'RequiredSellableGodTraits' || fn === 'RequireUnrestrictedBoonChoices') {
                    // Capture the equipped-trait array; the save parser
                    // prunes each entry to Name/Rarity/RestrictBoonChoices.
                    markWhole(['CurrentRun', 'Hero', 'Traits']);
                }
                if (fn === 'RequiredConsecutiveClearsOfRoom' || fn === 'RequiredConsecutiveDeathsInRoom') {
                    // Seed reads CurrentRun.{RoomCountCache[room], Cleared,
                    // BountyCleared, EndingRoomName}.
                    const args = rec.FunctionArgs || {};
                    const rooms = Array.isArray(args.Names) ? args.Names : [args.Name];
                    for (const room of rooms) if (typeof room === 'string') markLeaf(['CurrentRun', 'RoomCountCache', room]);
                    markLeaf(['CurrentRun', 'Cleared']);
                    markLeaf(['CurrentRun', 'BountyCleared']);
                    markLeaf(['CurrentRun', 'EndingRoomName']);
                }
            }
            return;
        }
        if (rec.PathFromSource || rec.PathFromArgs) return;
        if (rec.SumPrevRuns !== undefined || rec.SumPrevRooms !== undefined) return;
        const boolPath = rec.PathTrue || rec.PathFalse;
        const emptyPath = rec.PathEmpty || rec.PathNotEmpty;
        if (boolPath) { markLeaf(boolPath); return; }
        if (emptyPath) { markWhole(emptyPath); return; }
        const path = rec.Path;
        if (!Array.isArray(path) || path[0] !== rootKey) {
            if (rec.ValuePath) markLeaf(rec.ValuePath);
            return;
        }
        if (rec.UseLength) {
            markWhole(path);
        } else if (rec.CountOf !== undefined || rec.SumOf !== undefined || rec.MaxOf !== undefined) {
            const list = resolveRefList(rec.CountOf !== undefined ? rec.CountOf
                : rec.SumOf !== undefined ? rec.SumOf : rec.MaxOf);
            if (list) for (const m of list) markLeaf([...path, m]);
            else markWhole(path); // unknown member list -> need the whole table
        } else if (rec.HasAny || rec.HasAll || rec.HasNone) {
            const list = resolveRefList(rec.HasAny || rec.HasAll || rec.HasNone);
            if (list) for (const m of list) markLeaf([...path, m]);
            else markWhole(path); // unknown member list -> need the whole table
        } else {
            // Comparison / IsAny / IsNone on a scalar leaf.
            markLeaf(path);
        }
        if (rec.ValuePath) markLeaf(rec.ValuePath);
    };
    const scanSet = (other) => {
        for (const [key, val] of Object.entries(other || {})) {
            if (key === 'NamedRequirements' || key === 'NamedRequirementsFalse') {
                for (const name of (Array.isArray(val) ? val : [])) {
                    if (seenNamed.has(name)) continue;
                    seenNamed.add(name);
                    const def = (namedReqs || {})[name];
                    if (def) scanSet(def.otherRequirements || {});
                }
                continue;
            }
            if (Array.isArray(val)) for (const rec of val) scanRec(rec);
        }
    };
    for (const name in textlines) {
        const t = textlines[name];
        if (!t) continue;
        scanSet(t.otherRequirements);
        if (Array.isArray(t.orBranches)) for (const b of t.orBranches) scanSet(b.otherRequirements);
    }
    return mask;
}

// The GameState leaf/sub-table mask (see ``collectRootedPaths``).
export function collectGameStatePaths(textlines, namedReqs) {
    return collectRootedPaths(textlines, namedReqs, 'GameState');
}

// The CurrentRun leaf/sub-table mask for resolving ``CurrentRun.*`` direct gates
// (e.g. ``CurrentRun.RoomsEntered.I_Boss01``). SumPrevRuns (run-relative, see
// ``collectRunPaths``) and SumPrevRooms (room-relative, deferred) are excluded.
export function collectCurrentRunPaths(textlines, namedReqs) {
    return collectRootedPaths(textlines, namedReqs, 'CurrentRun');
}

// The PrevRun leaf/sub-table mask for resolving ``PrevRun.*`` gates (the last
// completed run, e.g. ``PrevRun.Cleared`` / ``PrevRun.RoomsEntered.I_Boss01``).
// Sourced at save time from ``GameState.RunHistory[#RunHistory]``.
export function collectPrevRunPaths(textlines, namedReqs) {
    return collectRootedPaths(textlines, namedReqs, 'PrevRun');
}

// The per-RunHistory-entry mask + referenced room set for the consecutive
// clears / deaths checks. Each recent run is pruned to ``RoomsEntered`` (only the
// referenced room keys) + ``EndingRoomName`` / ``Cleared`` / ``BountyCleared``.
// Returns ``{ mask, rooms: string[] }`` (``rooms`` so the save parser can also
// prune CurrentRun.RoomCountCache, though that goes through the CurrentRun mask).
export function collectRunHistoryClearMask(textlines, namedReqs) {
    const rooms = new Set();
    const seenNamed = new Set();
    const scanRec = (rec) => {
        if (!rec || typeof rec !== 'object') return;
        if (rec.FunctionName !== 'RequiredConsecutiveClearsOfRoom' && rec.FunctionName !== 'RequiredConsecutiveDeathsInRoom') return;
        const args = rec.FunctionArgs || {};
        for (const r of (Array.isArray(args.Names) ? args.Names : [args.Name])) if (typeof r === 'string') rooms.add(r);
    };
    const scanSet = (other) => {
        for (const [key, val] of Object.entries(other || {})) {
            if (key === 'NamedRequirements' || key === 'NamedRequirementsFalse') {
                for (const name of (Array.isArray(val) ? val : [])) {
                    if (seenNamed.has(name)) continue;
                    seenNamed.add(name);
                    const def = (namedReqs || {})[name];
                    if (def) scanSet(def.otherRequirements || {});
                }
                continue;
            }
            if (Array.isArray(val)) for (const rec of val) scanRec(rec);
        }
    };
    for (const name in textlines) {
        const t = textlines[name];
        if (!t) continue;
        scanSet(t.otherRequirements);
        if (Array.isArray(t.orBranches)) for (const b of t.orBranches) scanSet(b.otherRequirements);
    }
    if (rooms.size === 0) return { mask: {}, rooms: [] };
    const roomMask = {};
    for (const r of rooms) roomMask[r] = true;
    return { mask: { RoomsEntered: roomMask, EndingRoomName: true, Cleared: true, BountyCleared: true }, rooms: [...rooms] };
}

// Build the minimal GameState slice from a full ``gs`` table and a ``mask`` (see
// ``collectGameStatePaths``). Captures only masked leaves / sub-tables; absent
// paths are simply omitted (the evaluator treats a missing path as 0/false).
export function pruneGameState(gs, mask) {
    if (!gs || typeof gs !== 'object') return {};
    const out = {};
    for (const [key, spec] of Object.entries(mask)) {
        if (!(key in gs)) continue;
        if (spec === '*' || spec === true) {
            out[key] = gs[key];
        } else if (spec && typeof spec === 'object') {
            const child = pruneGameState(gs[key], spec);
            if (child && (typeof child !== 'object' || Object.keys(child).length > 0)) out[key] = child;
            else if (gs[key] !== undefined && (typeof gs[key] !== 'object')) out[key] = gs[key];
        }
    }
    return out;
}

// Collect the run/room-relative leaf paths an aggregate clause (``SumPrevRuns``
// or ``SumPrevRooms``, selected by ``sumKey``) reads, plus the maximum look-back
// count. Returns ``{ mask, max }``; the save parser prunes that many recent
// run/room objects to ``mask``. The Path is relative to each run/room object
// (e.g. ``["UseRecord","ZeusUpgrade"]`` is ``room.UseRecord.ZeusUpgrade``), not
// ``GameState``. ``TableValuesToCount`` members are appended as leaf paths.
function collectAggregatePaths(textlines, namedReqs, sumKey) {
    const mask = {};
    let max = 0;
    const seenNamed = new Set();
    const markLeaf = (pathArr) => {
        if (!Array.isArray(pathArr) || pathArr.length === 0) return;
        let node = mask;
        for (let i = 0; i < pathArr.length - 1; i++) {
            const k = pathArr[i];
            if (typeof k !== 'string') return;
            if (node[k] === true) return;
            if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
            node = node[k];
        }
        const last = pathArr[pathArr.length - 1];
        if (typeof last !== 'string') return;
        if (node[last] !== true && (typeof node[last] !== 'object' || node[last] === null)) node[last] = true;
        else if (typeof node[last] === 'object') node[last] = true; // a deeper leaf subsumes
    };
    const scanRec = (rec) => {
        if (!rec || typeof rec !== 'object' || rec[sumKey] === undefined) return;
        if (!Array.isArray(rec.Path)) return;
        if (typeof rec[sumKey] === 'number') max = Math.max(max, rec[sumKey]);
        if (Array.isArray(rec.TableValuesToCount)) {
            for (const m of rec.TableValuesToCount) markLeaf([...rec.Path, m]);
        } else {
            markLeaf(rec.Path);
        }
    };
    const scanSet = (other) => {
        for (const [key, val] of Object.entries(other || {})) {
            if (key === 'NamedRequirements' || key === 'NamedRequirementsFalse') {
                for (const name of (Array.isArray(val) ? val : [])) {
                    if (seenNamed.has(name)) continue;
                    seenNamed.add(name);
                    const def = (namedReqs || {})[name];
                    if (def) scanSet(def.otherRequirements || {});
                }
                continue;
            }
            if (Array.isArray(val)) for (const rec of val) scanRec(rec);
        }
    };
    for (const name in textlines) {
        const t = textlines[name];
        if (!t) continue;
        scanSet(t.otherRequirements);
        if (Array.isArray(t.orBranches)) for (const b of t.orBranches) scanSet(b.otherRequirements);
    }
    return { mask, max };
}

// The run-relative mask + max look-back for ``SumPrevRuns``. Returns
// ``{ mask, maxRuns }``.
export function collectRunPaths(textlines, namedReqs) {
    const { mask, max } = collectAggregatePaths(textlines, namedReqs, 'SumPrevRuns');
    return { mask, maxRuns: max };
}

// The room-relative mask + max look-back for ``SumPrevRooms``. Returns
// ``{ mask, maxRooms }``.
export function collectRoomPaths(textlines, namedReqs) {
    const { mask, max } = collectAggregatePaths(textlines, namedReqs, 'SumPrevRooms');
    return { mask, maxRooms: max };
}
