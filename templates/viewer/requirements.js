/**
 * Requirement-type semantics for save-based eligibility checks.
 *
 * Hades textlines gate on several requirement fields with distinct
 * semantics. This module is the single source of truth the viewer uses to
 * decide whether a dialogue is directly eligible given a save's set of
 * played textlines, shared by the save-progress badge (``save-parser.js``)
 * and the eligibility tracer (``eligibility-view.js``) so the two can never
 * disagree.
 *
 * The field -> category split mirrors ``REQUIREMENT_BLOCKING_SEMANTICS`` in
 * ``src/extractors/textline_set.py`` (the generator-side source of truth);
 * ``tests/test_requirement_semantics_parity.py`` asserts the two stay in
 * lockstep.
 */

import { textlines, namedRequirements, getActiveGame } from './data.js';
import { evaluateOtherRequirements, buildOtherReqSlices } from './gamestate-eval.js';

// Three-state AND: unmet if either side is unmet; else unknown if either is
// unknown; else met. Used to fold the GameState (non-textline) verdict into the
// textline-requirement verdict.
function _combine3(a, b) {
    if (a === 'unmet' || b === 'unmet') return 'unmet';
    if (a === 'unknown' || b === 'unknown') return 'unknown';
    return 'met';
}

// Every listed line must have played.
export const AND_REQ_TYPES = new Set([
    'RequiredTextLines',
    'RequiredTextLinesThisRun',
    'RequiredTextLinesLastRun',
    'RequiredTextLinesThisRoom',
    'RequiredQueuedTextLines',
]);

// At least one listed line must have played.
export const OR_REQ_TYPES = new Set([
    'RequiredAnyTextLines',
    'RequiredAnyOtherTextLines',
    'RequiredAnyTextLinesThisRun',
    'RequiredAnyTextLinesLastRun',
    'RequiredAnyQueuedTextLines',
]);

// None of the listed lines may have played: a "must not have seen this"
// gate (mutually-exclusive alternates, play-once lines). A blocking
// condition, not a prerequisite.
export const NEGATIVE_REQ_TYPES = new Set([
    'RequiredFalseTextLines',
    'RequiredFalseQueuedTextLines',
    'RequiredFalseTextLinesThisRun',
    'RequiredFalseTextLinesLastRun',
    'RequiredFalseTextLinesThisRoom',
]);

// "At least Count of these listed lines must have played" (Count lives in
// otherRequirements[field].Count), counted against the global played set.
export const COUNT_MIN_REQ_TYPES = new Set([
    'RequiredMinAnyTextLines',
]);

// "At most Count of these listed lines must have played" - the symmetric
// global count-max gate (Hades 1 RunManager.lua: fails when the played count
// exceeds Count). Counted against the global played set, like COUNT_MIN.
export const COUNT_MAX_REQ_TYPES = new Set([
    'RequiredMaxAnyTextLines',
]);

// Run-count fields: "at least / at most Count runs since any of these last
// played". Evaluated against the recent-run sequence (``context.runsAgo``),
// not a single record, so they are handled specially in ``reqGroupStatus``.
export const RUNS_SINCE_REQ_TYPES = new Set([
    'MinRunsSinceAnyTextLines',
    'MaxRunsSinceAnyTextLines',
]);

// Which save record each requirement field is evaluated against:
//   'played'   - the global cumulative ``TextLinesRecord`` ("ever played")
//   'thisRun'  - ``CurrentRun.TextLinesRecord`` (+ hub) for the current run
//   'thisRoom' - ``CurrentRun.CurrentRoom.TextLinesRecord``
//   'queued'   - the queued-textline record (H1 only; see save-parser.js)
//   'lastRun'  - ``GameState.RunHistory[#RunHistory].TextLinesRecord``
// The run-count fields (``Min/MaxRunsSinceAnyTextLines``) aren't listed: they
// evaluate against the recent-run sequence (``context.runsAgo``) and are
// special-cased in ``reqGroupStatus``. The only field with no resolvable
// record at all is the unused ``RequiredTextLinesLastRun`` positive, which
// stays 'unknown'. A mapped field still needs its record present in the save
// context, otherwise it is 'unknown' (e.g. a save with no active run can't
// resolve ``*ThisRun``; ``lastRun`` is always present, empty when there is no
// prior run).
export const REQ_TYPE_SCOPE = {
    RequiredTextLines: 'played',
    RequiredAnyTextLines: 'played',
    RequiredAnyOtherTextLines: 'played',
    RequiredFalseTextLines: 'played',
    RequiredMinAnyTextLines: 'played',
    RequiredMaxAnyTextLines: 'played',
    RequiredTextLinesThisRun: 'thisRun',
    RequiredAnyTextLinesThisRun: 'thisRun',
    RequiredFalseTextLinesThisRun: 'thisRun',
    RequiredTextLinesThisRoom: 'thisRoom',
    RequiredFalseTextLinesThisRoom: 'thisRoom',
    RequiredQueuedTextLines: 'queued',
    RequiredAnyQueuedTextLines: 'queued',
    RequiredFalseQueuedTextLines: 'queued',
    RequiredAnyTextLinesLastRun: 'lastRun',
    RequiredFalseTextLinesLastRun: 'lastRun',
};

// Normalise an evaluation context: a bare Set is treated as the global
// played set (so the scoped records are unavailable -> their fields stay
// indeterminate), otherwise a ``{ played, thisRun, thisRoom, queued,
// lastRun }`` object is used as-is.
function _asContext(context) {
    return (context instanceof Set) ? { played: context } : (context || {});
}

// The save record a requirement field evaluates against, or undefined when
// the field isn't scope-mapped (e.g. run-count fields, handled separately)
// or the scoped record is missing from the context.
function _recordFor(context, reqType) {
    const scope = REQ_TYPE_SCOPE[reqType];
    if (!scope) return undefined;
    const set = context[scope];
    return (set instanceof Set) ? set : undefined;
}

/**
 * The ``Count`` parameter of a count-based requirement field (how many of
 * the listed lines must have played), read from an ``otherRequirements``
 * map. Defaults to 1 when absent.
 */
function countFrom(otherRequirements, reqType) {
    const meta = otherRequirements && otherRequirements[reqType];
    return meta && typeof meta.Count === 'number' ? meta.Count : 1;
}

/**
 * The ``Count`` parameter of a count-based requirement field on a textline
 * (read from its ``otherRequirements``). Defaults to 1 when absent.
 */
export function requiredCount(textlineData, reqType) {
    return countFrom(textlineData && textlineData.otherRequirements, reqType);
}

/**
 * Verdict for a run-count requirement (``Min/MaxRunsSinceAnyTextLines``)
 * against the recent-run sequence ``context.runsAgo`` (textline -> how many
 * runs ago it most recently played; 0 = current run). Mirrors the game's
 * per-ref loop (despite the "Any" in the name, every ref must pass):
 *   - MinRunsSince Count N: each ref must have last played at least N runs
 *     ago (or never) - unmet if any ref played fewer than N runs ago.
 *   - MaxRunsSince Count N: each ref's most recent play must be within N runs
 *     (never-played passes) - unmet if any ref last played more than N runs
 *     ago. A ref beyond the tracked depth that is still in the cumulative
 *     played set is treated as "too long ago" (the game keeps enough run
 *     history to resolve this; see ``RUNS_AGO_DEPTH``).
 * Returns 'unknown' only when no recent-run data is available at all.
 */
function runsSinceStatus(reqType, refs, ctx, count, selfName) {
    const runsAgo = ctx.runsAgo;
    if (!runsAgo || typeof runsAgo !== 'object') return 'unknown';
    const n = count || 1;
    const played = ctx.played instanceof Set ? ctx.played : null;
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    for (const r of others) {
        const ago = runsAgo[r];
        if (reqType === 'MinRunsSinceAnyTextLines') {
            if (typeof ago === 'number' && ago < n) return 'unmet';
        } else { // MaxRunsSinceAnyTextLines
            if (typeof ago === 'number') {
                if (ago > n) return 'unmet';
            } else if (played && played.has(r)) {
                // Played, but not within the tracked recent runs -> longer ago
                // than any run-count threshold -> too long ago.
                return 'unmet';
            }
        }
    }
    return 'met';
}

// Phrase for a runs-ago distance: 0 = the current run, 1 = "1 run ago",
// otherwise "N runs ago".
function runsAgoPhrase(ago) {
    if (ago === 0) return 'this run';
    return ago === 1 ? '1 run ago' : `${ago} runs ago`;
}

// "N run(s)", correctly pluralised.
function runsLabel(n) {
    return `${n} ${n === 1 ? 'run' : 'runs'}`;
}

// Whether a referenced textline is a play-once line (can play at most once
// across the whole save). Tolerates an unloaded ``textlines`` binding (unit
// tests that exercise the verdict logic without a dataset) by treating
// unknown lines as repeatable.
export function isPlayOnceRef(name) {
    return !!(textlines && textlines[name] && textlines[name].playOnce);
}

// A positive queued gate (``RequiredQueuedTextLines`` / ``RequiredAnyQueuedTextLines``)
// is satisfied only while the referenced line is *queued to play next* - the
// engine checks an active NPC's ``NextInteractLines.Name == ref``, which
// requires ``ref`` to still be eligible to play. A play-once ref that has
// already played can therefore NEVER be queued again, so an already-played
// play-once operand is a *permanent lock* here - the opposite of a
// "must have played" prerequisite, where a played operand satisfies the gate.
function queuedRefPermanentlyUnqueueable(ref, playedSet) {
    return isPlayOnceRef(ref) && playedSet instanceof Set && playedSet.has(ref);
}

/**
 * Per-ref breakdown of a run-count requirement (``Min/MaxRunsSinceAnyTextLines``)
 * against a save context, for the tree tooltips. Returns ``null`` when the
 * field isn't a run-count type or the save carries no recent-run sequence.
 * Otherwise:
 *   {
 *     status: 'met' | 'unmet',  // identical to runsSinceStatus, so the group
 *                               // verdict dot and its tooltip can't disagree
 *     count: <threshold N>,
 *     isMin: <boolean>,
 *     permanent: <boolean>,     // a play-once ref is now permanently out of a
 *                               // MaxRunsSince window -> the gate (and the
 *                               // dialogue) can never become eligible again
 *     refs: [{ name, ago, played, playOnce, ok, permanent, reason }],
 *   }
 * ``ago`` is the runs-ago distance (number) or ``null`` (not within the
 * tracked runs); ``played`` is whether the line is in the cumulative played
 * set; ``ok`` is whether this ref passes the gate; ``reason`` is a short
 * human phrase explaining why. A play-once line is described as having
 * "played" (not "last played"): it only ever plays once.
 */
export function runsSinceExplain(reqType, refs, context, count = 1, selfName = null) {
    if (!RUNS_SINCE_REQ_TYPES.has(reqType)) return null;
    const ctx = _asContext(context);
    const runsAgo = ctx.runsAgo;
    if (!runsAgo || typeof runsAgo !== 'object') return null;
    const n = count || 1;
    const played = ctx.played instanceof Set ? ctx.played : null;
    const isMin = reqType === 'MinRunsSinceAnyTextLines';
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    const refsOut = others.map(r => {
        const raw = runsAgo[r];
        const ago = typeof raw === 'number' ? raw : null;
        const everPlayed = ago !== null || !!(played && played.has(r));
        const playOnce = isPlayOnceRef(r);
        // A play-once line only plays a single time, so "last played" would
        // mislead - it just "played".
        const verb = playOnce ? 'played' : 'last played';
        const when = ago !== null ? runsAgoPhrase(ago) : 'longer ago than the tracked run history';
        let ok, reason, permanent = false;
        if (isMin) {
            if (!everPlayed) {
                ok = true;
                reason = 'never played, which counts as long enough ago';
            } else if (ago !== null && ago < n) {
                ok = false;
                reason = `${verb} ${when}, too recent (needs at least ${runsLabel(n)} since)`;
            } else {
                ok = true;
                reason = ago === null
                    ? `${verb} ${when}, which is long enough`
                    : `${verb} ${when}, at least ${runsLabel(n)} since`;
            }
        } else { // MaxRunsSinceAnyTextLines
            if (!everPlayed) {
                ok = true;
                reason = 'never played, which is within range';
            } else if (ago !== null && ago <= n) {
                ok = true;
                reason = `${verb} ${when}, within ${runsLabel(n)}`;
            } else {
                ok = false;
                reason = `${verb} ${when}, too long ago (needs at most ${runsLabel(n)} since)`;
                // A repeatable line can replay to re-enter the window; a
                // play-once line never can, so the gate is permanently lost.
                if (playOnce) {
                    permanent = true;
                    reason += ` - can only play once, so this gate can never be met again`;
                }
            }
        }
        return { name: r, ago, played: everPlayed, playOnce, ok, permanent, reason };
    });
    const status = refsOut.every(x => x.ok) ? 'met' : 'unmet';
    return { status, count: n, isMin, permanent: refsOut.some(x => x.permanent), refs: refsOut };
}

/**
 * Multi-line tooltip for a run-count requirement *group* header dot: a
 * summary line plus a per-ref breakdown (blocking refs first), capped so a
 * many-ref gate stays readable. Returns ``null`` for non-run-count fields or
 * when the save carries no recent-run data.
 */
export function runsSinceGroupTooltip(reqType, refs, context, count = 1, selfName = null) {
    const ex = runsSinceExplain(reqType, refs, context, count, selfName);
    if (!ex) return null;
    let head = ex.isMin
        ? (ex.status === 'met'
            ? `Satisfied by the save: every line was last played at least ${runsLabel(ex.count)} ago (or never).`
            : `Not satisfied: a line was played too recently (each needs at least ${runsLabel(ex.count)} since it last played).`)
        : (ex.status === 'met'
            ? `Satisfied by the save: every line last played within the last ${runsLabel(ex.count)} (or never).`
            : `Not satisfied: a line last played too long ago (each must have played within the last ${runsLabel(ex.count)}).`);
    if (ex.permanent) head += ' A play-once line is permanently out of range, so this can never become eligible again.';
    if (ex.refs.length === 0) return head;
    const sorted = ex.refs.slice().sort((a, b) => Number(a.ok) - Number(b.ok));
    const CAP = 8;
    const lines = sorted.slice(0, CAP)
        .map(r => `${r.ok ? '\u2713' : '\u2717'} ${r.name}: ${r.reason}`);
    if (sorted.length > CAP) lines.push(`+ ${sorted.length - CAP} more`);
    return [head, ...lines].join('\n');
}

/**
 * Tooltip clause for a single ref row under a run-count group: how many runs
 * back this line played and whether that satisfies or blocks the gate.
 * Returns ``null`` for non-run-count fields or with no recent-run data.
 */
export function runsSinceRefTooltip(reqType, refName, context, count = 1, selfName = null) {
    const ex = runsSinceExplain(reqType, [refName], context, count, selfName);
    if (!ex || ex.refs.length === 0) return null;
    const r = ex.refs[0];
    const reason = r.reason.charAt(0).toUpperCase() + r.reason.slice(1);
    // A permanent (play-once) lock already spells out the consequence in the
    // reason, so it needs no "blocks this gate" suffix.
    const suffix = r.ok ? ' - satisfies this run-count gate.'
        : r.permanent ? '.'
            : ' - blocks this run-count gate.';
    return `${reason}${suffix}`;
}

/**
 * Verdict for a single requirement *group* in the dependency tree (one
 * requirement field plus the refs listed under it) against ``context``.
 * Applies the per-category rules (AND / OR / negative / count-min /
 * count-max / runs-since) to a single group in isolation so the tree can
 * mark each group header. The group is evaluated against the save record its
 * field is scoped to (see ``REQ_TYPE_SCOPE``), or the recent-run sequence for
 * run-count fields. Returns:
 *   'met'     - the group's condition is currently satisfied
 *   'unmet'   - the condition is not satisfied
 *   'unknown' - the record is missing from the context, so no verdict
 * ``context`` is a save context (or a bare Set treated as the global played
 * set); ``count`` is the count threshold (defaults to 1); ``selfName`` lets
 * the play-once self-references a few gates carry be ignored.
 */
export function reqGroupStatus(reqType, refs, context, count = 1, selfName = null) {
    const ctx = _asContext(context);
    if (RUNS_SINCE_REQ_TYPES.has(reqType)) {
        return runsSinceStatus(reqType, refs, ctx, count, selfName);
    }
    const record = _recordFor(ctx, reqType);
    if (!record) return 'unknown';
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    if (AND_REQ_TYPES.has(reqType)) {
        return others.every(r => record.has(r)) ? 'met' : 'unmet';
    }
    if (OR_REQ_TYPES.has(reqType)) {
        if (others.length === 0) return 'met';
        return others.some(r => record.has(r)) ? 'met' : 'unmet';
    }
    if (NEGATIVE_REQ_TYPES.has(reqType)) {
        return others.some(r => record.has(r)) ? 'unmet' : 'met';
    }
    if (COUNT_MIN_REQ_TYPES.has(reqType)) {
        const playedCount = others.filter(r => record.has(r)).length;
        return playedCount >= (count || 1) ? 'met' : 'unmet';
    }
    if (COUNT_MAX_REQ_TYPES.has(reqType)) {
        const playedCount = others.filter(r => record.has(r)).length;
        return playedCount <= (count || 1) ? 'met' : 'unmet';
    }
    return 'unknown';
}

/**
 * Whether a single requirement *group* is a *permanent* lock against
 * ``context``: not merely unmet now, but impossible to ever satisfy as the
 * save's cumulative state grows. Mirrors the per-group permanent-lock cases
 * in ``unobtainable.js`` so a group dot and the dialogue's "unobtainable"
 * badge can never disagree:
 *   - ``MaxRunsSinceAnyTextLines`` with a play-once ref now past the window
 *     (it can never replay to re-enter range);
 *   - a positive queued gate (``RequiredQueuedTextLines`` /
 *     ``RequiredAnyQueuedTextLines``) whose play-once operand has already
 *     played (it can never be queued to play next again);
 *   - ``RequiredMaxAnyTextLines`` whose played count already exceeds the cap
 *     (the cumulative played set only grows); and
 *   - a global negative (``RequiredFalseTextLines``) on a line that has
 *     played (it can never be un-played).
 * The run-scoped negatives reset each run/room, so they are never permanent.
 * Returns ``false`` when the save can't resolve the group (no record/runsAgo).
 */
export function reqGroupLocked(reqType, refs, context, count = 1, selfName = null) {
    const ctx = _asContext(context);
    if (reqType === 'MaxRunsSinceAnyTextLines') {
        const ex = runsSinceExplain(reqType, refs, ctx, count, selfName);
        return !!(ex && ex.permanent);
    }
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    // Positive queued gate with a play-once operand that has already played: it
    // can never be queued again. AND ("all must be queued") is locked if ANY
    // operand is permanently unqueueable; OR ("any queued") is locked only if
    // EVERY operand is. Resolves against the cumulative played set.
    if (REQ_TYPE_SCOPE[reqType] === 'queued' && AND_REQ_TYPES.has(reqType)) {
        return others.some(r => queuedRefPermanentlyUnqueueable(r, ctx.played));
    }
    if (REQ_TYPE_SCOPE[reqType] === 'queued' && OR_REQ_TYPES.has(reqType)) {
        return others.length > 0 && others.every(r => queuedRefPermanentlyUnqueueable(r, ctx.played));
    }
    if (COUNT_MAX_REQ_TYPES.has(reqType)) {
        const record = _recordFor(ctx, reqType);
        return !!record && others.filter(r => record.has(r)).length > (count || 1);
    }
    if (NEGATIVE_REQ_TYPES.has(reqType) && REQ_TYPE_SCOPE[reqType] === 'played') {
        const record = _recordFor(ctx, reqType);
        return !!record && others.some(r => record.has(r));
    }
    return false;
}

// Human phrasing for each run-scoped record: how a referenced line reads
// when it is present in / absent from that scope's record, plus the
// "elsewhere" case (played somewhere in the save, just not in this scope) and
// a noun for tooltips.
const SCOPE_PHRASES = {
    thisRun: { present: 'played this run', absent: 'not played this run', elsewhere: 'played in the save, but not this run', noun: 'this run' },
    thisRoom: { present: 'played this room', absent: 'not played this room', elsewhere: 'played in the save, but not this room', noun: 'this room' },
    lastRun: { present: 'played last run', absent: 'not played last run', elsewhere: 'played in the save, but not last run', noun: 'the last run' },
    queued: { present: 'queued', absent: 'not queued', elsewhere: 'played in the save, but not queued', noun: 'the textline queue' },
};

/**
 * Per-ref breakdown of a *run-scoped* requirement gate - the ``*ThisRun`` /
 * ``*ThisRoom`` / ``*LastRun`` / ``*Queued`` positive (AND), any (OR) and
 * negative fields - against a save ``context``. These are situational gates
 * the global prerequisite chain doesn't walk: they resolve against the
 * run / room / last-run / queue records, not the cumulative played set.
 *
 * Returns ``null`` for a global-scope field (those are prerequisites or
 * permanent locks, handled elsewhere) or when the save carries no record for
 * the scope (so the gate stays indeterminate rather than reported as a
 * block). Otherwise ``{ status, scopeLabel, blockers }`` where ``blockers``
 * are the refs currently failing the gate, each ``{ name, reason }`` plus,
 * for a *positive* gate ref that has played somewhere in the save but not in
 * this scope, ``playedInSave: true`` and a ``tooltip`` - a near-miss the
 * tracer flags distinctly (it has played, just not where this gate needs). A
 * *queued* gate ref that is play-once and has already played is instead marked
 * ``permanent: true`` (with its own tooltip): it can never be queued again, so
 * the gate is permanently unsatisfiable rather than a recoverable near-miss.
 * ``status`` matches ``reqGroupStatus`` for the same field.
 */
export function scopedGateExplain(reqType, refs, context, selfName = null) {
    const scope = REQ_TYPE_SCOPE[reqType];
    const phrases = scope && SCOPE_PHRASES[scope];
    if (!phrases) return null; // global-scope or no run-scoped record for this field
    const ctx = _asContext(context);
    const record = ctx[scope];
    if (!(record instanceof Set)) return null; // unresolvable -> indeterminate, not a block
    const playedSet = ctx.played instanceof Set ? ctx.played : null;
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    // A positive-gate ref missing from the scope record: distinguish "played
    // in the save but not this scope" (a near-miss) from "never played". For a
    // *queued* gate the near-miss is permanent when the ref is play-once: a
    // play-once line that already played can never be queued to play next again.
    const positiveBlocker = (r) => {
        if (playedSet && playedSet.has(r)) {
            if (scope === 'queued' && isPlayOnceRef(r)) {
                return {
                    name: r,
                    reason: 'played - can never be queued again',
                    permanent: true,
                    tooltip: `${r} is a play-once line that has already played, so it can never be queued to play next again. This requirement can no longer be satisfied.`,
                };
            }
            return {
                name: r,
                reason: phrases.elsewhere,
                playedInSave: true,
                tooltip: `Played in your save, but not in ${phrases.noun}. This gate only counts a line played in ${phrases.noun}, so a save-wide play doesn\u2019t satisfy it.`,
            };
        }
        return { name: r, reason: phrases.absent };
    };
    let blockers;
    if (AND_REQ_TYPES.has(reqType)) {
        blockers = others.filter(r => !record.has(r)).map(positiveBlocker);
    } else if (OR_REQ_TYPES.has(reqType)) {
        blockers = others.some(r => record.has(r)) ? [] : others.map(positiveBlocker);
    } else if (NEGATIVE_REQ_TYPES.has(reqType)) {
        blockers = others.filter(r => record.has(r)).map(r => ({ name: r, reason: phrases.present }));
    } else {
        return null;
    }
    return { status: blockers.length === 0 ? 'met' : 'unmet', scopeLabel: phrases.noun, blockers };
}

/**
 * Three-state verdict for a requirement *set* (a textline's base
 * requirements or one ``orBranches`` alternative) against a save
 * ``context``, used for the OR branch / group headers. Honest about
 * unverifiable fields: returns
 *   'unmet'   - a resolvable field in the set is not satisfied
 *   'unknown' - no resolvable field failed but the set carries a field whose
 *               scoped record the context doesn't carry (the H2 textline
 *               queue, or a current-run record when no run is active), so
 *               the verdict can't be confirmed
 *   'met'     - the set is empty/no-op, or every contributing field is
 *               resolvable and satisfied
 * ``name`` is the host dialogue's own name (self-references ignored).
 */
export function requirementSetStatus(requirements, otherRequirements, context, name) {
    const ctx = _asContext(context);
    let sawUnverifiable = false;
    for (const [reqType, refs] of Object.entries(requirements || {})) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== name);
        if (others.length === 0) continue;
        const st = reqGroupStatus(reqType, refs, ctx, countFrom(otherRequirements, reqType), name);
        if (st === 'unmet') return 'unmet';
        if (st === 'unknown') sawUnverifiable = true;
    }
    return sawUnverifiable ? 'unknown' : 'met';
}

/**
 * Three-state direct eligibility for ``textlineData`` given a save
 * ``context``:
 *   'met'     - directly eligible now (all requirements confirmed satisfied)
 *   'unmet'   - a resolvable requirement is not satisfied
 *   'unknown' - every resolvable requirement is satisfied, but the dialogue
 *               also gates on something the save can't resolve (a run-scoped
 *               textline record the save doesn't carry, or a non-textline
 *               GameState condition that reads live run / room / session state)
 *
 * Combines the textline-record requirements (AND / OR / negative / count, via
 * ``requirementSetStatus``) with the non-textline GameState gates (the
 * ``otherRequirements`` Path / aggregation / named conditions, via
 * ``evaluateOtherRequirements`` against the save's persisted GameState slice).
 * The base requirement set AND, if the dialogue carries H2 ``orBranches``
 * alternatives, the OR group (met when any branch is met, unmet only when all
 * are unmet, unknown otherwise) must both hold. ``name`` ignores
 * self-references.
 */
export function directSatisfaction(textlineData, context, name) {
    if (!textlineData) return 'met';
    if (!context) return 'unknown';
    const ctx = _asContext(context);
    const gs = ctx.gameState;
    // CurrentRun.* / SumPrevRooms gates resolve only when this dialogue's
    // owner-context matches the loaded save type; the rest are always available.
    // ``buildOtherReqSlices`` bundles them for evaluateOtherRequirements.
    const gameId = getActiveGame();
    const slices = buildOtherReqSlices(ctx, textlineData.owner, gameId);
    const base = _combine3(
        requirementSetStatus(textlineData.requirements, textlineData.otherRequirements, ctx, name),
        evaluateOtherRequirements(textlineData.otherRequirements, gs, slices, gameId).status);
    if (base === 'unmet') return 'unmet';
    let orStatus = 'met';
    const branches = Array.isArray(textlineData.orBranches) ? textlineData.orBranches : [];
    if (branches.length > 0) {
        let anyMet = false;
        let anyUnknown = false;
        for (const b of branches) {
            const st = _combine3(
                requirementSetStatus(b.requirements, b.otherRequirements, ctx, name),
                evaluateOtherRequirements(b.otherRequirements, gs, slices, gameId).status);
            if (st === 'met') { anyMet = true; break; }
            if (st !== 'unmet') anyUnknown = true;
        }
        orStatus = anyMet ? 'met' : (anyUnknown ? 'unknown' : 'unmet');
    }
    if (orStatus === 'unmet') return 'unmet';
    return (base === 'unknown' || orStatus === 'unknown') ? 'unknown' : 'met';
}

/**
 * Boolean convenience wrapper: true only when ``directSatisfaction`` is a
 * confirmed 'met'. An 'unknown' verdict is not a confirmed yes.
 */
export function isDirectlySatisfied(textlineData, playedSet, name) {
    return directSatisfaction(textlineData, playedSet, name) === 'met';
}

// Three-state invert: met <-> unmet, unknown unchanged. Turns a named
// requirement's own eligibility into its host-gate contribution for the
// ``NamedRequirementsFalse`` operator (the host is blocked precisely when the
// named requirement IS eligible).
function _invert3(s) {
    return s === 'met' ? 'unmet' : s === 'unmet' ? 'met' : 'unknown';
}

/**
 * Host-gate status of one NamedRequirements* reference, evaluated as a full
 * requirement set (its textline records, GameState gates and OR branches)
 * against the save ``context`` - not the GameState-only view
 * ``evaluateOtherRequirements`` produces, which can't read textline records.
 * ``hostOwner`` supplies the run context (hub vs in-run) the named set's
 * CurrentRun gates resolve against, since a named requirement has no owner.
 *   - ``NamedRequirements``      (must pass)     -> the named set's own status
 *   - ``NamedRequirementsFalse`` (must NOT pass) -> inverted (host blocked when
 *                                                   the named set is eligible)
 *   - ``NamedRequirementsCycle`` / unresolved    -> 'unknown'
 */
export function namedRequirementHostStatus(key, name, context, hostOwner) {
    if (key === 'NamedRequirementsCycle') return 'unknown';
    const def = namedRequirements[name];
    if (!def) return 'unknown';
    const s = directSatisfaction({ ...def, owner: hostOwner }, context, null);
    return key === 'NamedRequirementsFalse' ? _invert3(s) : s;
}

/**
 * Combined host-gate status over every name in a NamedRequirements* set (all
 * must hold), so a group dot reads as the AND of its per-name dots.
 */
export function namedRequirementGroupStatus(key, names, context, hostOwner) {
    const arr = (Array.isArray(names) ? names : []).map(
        n => namedRequirementHostStatus(key, n, context, hostOwner));
    if (arr.includes('unmet')) return 'unmet';
    if (arr.includes('unknown')) return 'unknown';
    return 'met';
}
