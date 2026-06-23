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

import { namedRequirements, gameDataRefs } from './data.js';

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
    const l = (left === undefined || left === null) ? 0 : left;
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

const _MET = (status, reason) => ({ status, reason });

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
    const list = rec.IgnoreCurrentRun ? runs.slice(1, 1 + n) : runs.slice(0, n);
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
        return _MET('unknown', `Calls the game function ${rec.FunctionName}() - evaluated in-engine from live run / room / combat state a static save doesn\u2019t store.`);
    }
    if (rec.PathFromSource || rec.PathFromArgs) {
        return _MET('unknown', 'Read from the live speaker / call context, which a save file doesn\u2019t store.');
    }
    if (rec.SumPrevRuns !== undefined) {
        return evalSumPrevRuns(rec, root);
    }
    if (rec.SumPrevRooms !== undefined) {
        return _MET('unknown', 'Aggregates across rooms in the current run - only meaningful during an active run.');
    }

    const path = rec.Path || rec.PathTrue || rec.PathFalse || rec.PathEmpty || rec.PathNotEmpty;
    if (!Array.isArray(path) || path.length === 0) {
        return _MET('unknown', 'Unrecognised condition shape.');
    }
    const base = path[0];
    if (base !== 'GameState') {
        const why = base === 'CurrentRun' ? 'current-run state (only meaningful during an active run)'
            : base === 'AudioState' ? 'live audio state'
                : base === 'MapState' ? 'live room/map state'
                    : `${base} state`;
        return _MET('unknown', `Reads ${base}.* - ${why}, not resolved in this pass.`);
    }
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
        for (const rec of val) {
            const r = evalClause(rec, root);
            recStatuses.push(r.status);
            if (r.status === 'unknown' && !firstReason) firstReason = r.reason;
            if (r.status === 'unmet') firstReason = firstReason || null;
        }
        const st = combineAnd(recStatuses);
        clauses.push({ key, status: st, reason: st === 'unknown' ? firstReason : null });
        statuses.push(st);
    }
    return { status: combineAnd(statuses), clauses };
}

// Public: evaluate a textline's ``otherRequirements`` against a loaded save's
// pruned ``GameState`` slice. Returns { status, clauses } where ``status`` is
// 'met' | 'unmet' | 'unknown' and ``clauses`` lists each gate's verdict (with a
// reason for every 'unknown'). ``gameStateSlice`` is the persisted GameState
// (or null when no save is loaded -> everything 'unknown'); ``runs`` is the
// persisted runs slice (``[currentRun, ...recentHistory]``) for SumPrevRuns.
export function evaluateOtherRequirements(otherRequirements, gameStateSlice, runs = null, runsAgo = null) {
    if (!otherRequirements || Object.keys(otherRequirements).length === 0) {
        return { status: 'met', clauses: [] };
    }
    if (!gameStateSlice) {
        const clauses = Object.keys(otherRequirements)
            .filter(k => Array.isArray(otherRequirements[k]) || k.startsWith('NamedRequirements'))
            .map(key => ({ key, status: 'unknown', reason: 'No save loaded.' }));
        return { status: clauses.length ? 'unknown' : 'met', clauses };
    }
    return evalSet(otherRequirements, { GameState: gameStateSlice, _runs: runs, _runsAgo: runsAgo }, new Set());
}

// A nested "mask" of the exact GameState paths any clause in ``textlines``
// reads, so the save parser can persist a minimal slice instead of whole
// (often huge) GameState sub-tables. A mask node is either ``true`` (capture
// the value at this leaf), ``'*'`` (capture this whole sub-table - needed by
// UseLength / PathEmpty / PathNotEmpty, which count keys), or a nested object.
// SumPrevRuns/Rooms, FunctionName, CurrentRun/Audio/Map and PathFromSource are
// skipped - they aren't resolved in this pass. Recurses NamedRequirements*.
export function collectGameStatePaths(textlines, namedReqs) {
    const mask = {};
    const seenNamed = new Set();

    // Mark a leaf path (array under GameState, e.g. ['GameState','EnemyKills',
    // 'Hecate']) for capture. A ``'*'`` ancestor already covers it.
    const markLeaf = (pathArr) => {
        if (!Array.isArray(pathArr) || pathArr[0] !== 'GameState' || pathArr.length < 2) return;
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
    // Mark a whole sub-table (path array under GameState) for capture.
    const markWhole = (pathArr) => {
        if (!Array.isArray(pathArr) || pathArr[0] !== 'GameState' || pathArr.length < 2) return;
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
            // RequireQuestCount reads the whole GameState.QuestStatus table; the
            // other resolvable function (RequireRunsSinceTextLines) uses the
            // run-scoped runsAgo map, not the GameState slice.
            if (rec.FunctionName === 'RequireQuestCount') markWhole(['GameState', 'QuestStatus']);
            return;
        }
        if (rec.PathFromSource || rec.PathFromArgs) return;
        if (rec.SumPrevRuns !== undefined || rec.SumPrevRooms !== undefined) return;
        const boolPath = rec.PathTrue || rec.PathFalse;
        const emptyPath = rec.PathEmpty || rec.PathNotEmpty;
        if (boolPath) { markLeaf(boolPath); return; }
        if (emptyPath) { markWhole(emptyPath); return; }
        const path = rec.Path;
        if (!Array.isArray(path) || path[0] !== 'GameState') {
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

// Collect the run-relative leaf paths the ``SumPrevRuns`` clauses read, plus
// the maximum run count any of them looks back. Returns ``{ mask, maxRuns }``;
// the save parser prunes the current run + that many recent ``RunHistory``
// entries to ``mask``. ``SumPrevRuns`` paths are relative to each run object
// (e.g. ``["RoomsEntered","N_Boss01"]`` is ``run.RoomsEntered.N_Boss01``), not
// ``GameState``. ``TableValuesToCount`` members are appended as leaf paths.
export function collectRunPaths(textlines, namedReqs) {
    const mask = {};
    let maxRuns = 0;
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
        if (!rec || typeof rec !== 'object' || rec.SumPrevRuns === undefined) return;
        if (!Array.isArray(rec.Path)) return;
        if (typeof rec.SumPrevRuns === 'number') maxRuns = Math.max(maxRuns, rec.SumPrevRuns);
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
    return { mask, maxRuns };
}
