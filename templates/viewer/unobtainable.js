/**
 * "Permanently unobtainable" detection.
 *
 * A loaded save's played set only ever grows, so some dialogues can never
 * become eligible again once the player has locked themselves out:
 *   * a global negative gate (RequiredFalseTextLines) on a line that is
 *     already played - it can never be un-played (the mutually-exclusive
 *     _A / _B variant pattern). The run-scoped / queued negative variants
 *     are transient (a fresh run clears them), so they are not locks;
 *   * a global count-max gate (RequiredMaxAnyTextLines) once more than its
 *     quota of the listed lines have played - the played set only grows, so
 *     the count can never drop back under the cap;
 *   * a MaxRunsSince gate on a play-once line that has slipped further back
 *     than the window - the line can never replay to reset the distance, so
 *     the "within N runs" condition is lost for good; and
 *   * a required choice variant <parent><ChoiceA> once the player recorded a
 *     different choice in <parent> (a choice dialogue records exactly one
 *     option, so the alternatives can never be obtained).
 * These propagate: a dialogue gated on an unobtainable line (AND, every
 * option of an OR / count group, or every orBranch alternative) is itself
 * unobtainable. ``isDirectlySatisfied`` answers "eligible right now"; this
 * answers "can this ever become eligible in this save".
 *
 * Shared by the save-progress status (``getDialogueStatus``) and the
 * eligibility tracer so every surface agrees. ``playedSet`` is passed in
 * (rather than read from the save module) to keep this dependency-free of
 * ``save-parser.js`` and unit-testable.
 */

import { textlines } from './data.js';
import { AND_REQ_TYPES, OR_REQ_TYPES, NEGATIVE_REQ_TYPES, COUNT_MIN_REQ_TYPES, COUNT_MAX_REQ_TYPES, REQ_TYPE_SCOPE, requiredCount, reqGroupStatus, reqGroupLocked, requirementSetStatus } from './requirements.js';
import { evaluateOtherRequirements, currentRunResolvable } from './gamestate-eval.js';

let _unobtainablePlayedSet = null;
let _unobtainableTextlines = null;
let _unobtainableRunsAgo = null;
let _unobtainableCache = null;
let _playedChoiceByParent = null;

// Rebuild the per-save memo + "which choice variant did the player record
// for each parent" lookup whenever the played set (or the loaded data, e.g.
// after a game switch, or the run-count distances) changes.
function refreshUnobtainableCaches(playedSet, runsAgo) {
    if (_unobtainablePlayedSet === playedSet && _unobtainableTextlines === textlines
        && _unobtainableRunsAgo === runsAgo) return;
    _unobtainablePlayedSet = playedSet;
    _unobtainableTextlines = textlines;
    _unobtainableRunsAgo = runsAgo;
    _unobtainableCache = new Map();
    _playedChoiceByParent = new Map();
    for (const name of playedSet) {
        const tl = textlines[name];
        if (tl && tl.isSynthetic && tl.parentTextline) {
            let set = _playedChoiceByParent.get(tl.parentTextline);
            if (!set) { set = new Set(); _playedChoiceByParent.set(tl.parentTextline, set); }
            set.add(name);
        }
    }
}

// True when a MaxRunsSince ref can never re-enter its "within N runs" window:
// it is play-once (so it can't replay to reset the distance) and its single
// play is already further back than N runs (or beyond the tracked run
// history). A repeatable line, or one that hasn't played, is recoverable.
function maxRunsPermanentlyOut(ref, n, playedSet) {
    const tl = textlines[ref];
    if (!tl || !tl.playOnce || !_unobtainableRunsAgo) return false;
    const ago = _unobtainableRunsAgo[ref];
    if (typeof ago === 'number') return ago > n;
    return playedSet.has(ref); // beyond the tracked depth, but played -> out forever
}

export function isUnobtainable(name, playedSet, runsAgo = null) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet, runsAgo);
    return unobtainableRec(name, playedSet, new Set());
}

function unobtainableRec(name, playedSet, stack) {
    if (playedSet.has(name)) return false;
    if (_unobtainableCache.has(name)) return _unobtainableCache.get(name);
    if (stack.has(name)) return false; // cycle - assume obtainable (safe under-claim)
    stack.add(name);
    const result = computeUnobtainable(name, playedSet, stack);
    stack.delete(name);
    _unobtainableCache.set(name, result);
    return result;
}

function computeUnobtainable(name, playedSet, stack) {
    const tl = textlines[name];
    if (!tl) return false; // unresolved ref - don't claim unobtainable

    // Choice-lock: a choice variant whose parent already recorded a
    // different option can never be obtained.
    if (tl.isSynthetic && tl.parentTextline) {
        const chosen = _playedChoiceByParent.get(tl.parentTextline);
        if (chosen && chosen.size > 0 && !chosen.has(name)) return true;
    }

    if (requirementSetUnobtainable(tl, name, playedSet, stack)) return true;

    // orBranches: eligibility needs at least one branch satisfiable.
    const branches = Array.isArray(tl.orBranches) ? tl.orBranches : [];
    if (branches.length > 0
        && branches.every(b => requirementSetUnobtainable(b, name, playedSet, stack))) {
        return true;
    }
    return false;
}

// True if a single requirement set (a textline, or one orBranch - both carry
// ``requirements`` + ``otherRequirements``) can never be satisfied as the
// played set grows.
function requirementSetUnobtainable(reqHost, hostName, playedSet, stack) {
    const requirements = (reqHost && reqHost.requirements) || {};
    for (const [reqType, refs] of Object.entries(requirements)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== hostName);
        if (NEGATIVE_REQ_TYPES.has(reqType) && REQ_TYPE_SCOPE[reqType] === 'played') {
            // Must NOT have played these (ever) - but one already has, and a
            // played line can never be un-played, so this is permanent. Only
            // the *global* negative (RequiredFalseTextLines) is a permanent
            // lock: the run-scoped / queued variants are transient (a future
            // run starts fresh), so a cumulative save can't call them locked.
            if (others.some(r => playedSet.has(r))) return true;
        } else if (COUNT_MAX_REQ_TYPES.has(reqType)) {
            // At most Count of these may have played. The cumulative played
            // set only grows, so once more than Count have played the cap can
            // never be satisfied again.
            if (others.filter(r => playedSet.has(r)).length > requiredCount(reqHost, reqType)) return true;
        } else if (reqType === 'MaxRunsSinceAnyTextLines') {
            // AND across refs (each must have last played within Count runs).
            // A play-once ref now past the window can never come back, so the
            // whole gate is permanently unsatisfiable.
            const n = requiredCount(reqHost, reqType);
            if (others.some(r => maxRunsPermanentlyOut(r, n, playedSet))) return true;
        } else if (AND_REQ_TYPES.has(reqType)) {
            if (others.some(r => !playedSet.has(r) && unobtainableRec(r, playedSet, stack))) return true;
        } else if (OR_REQ_TYPES.has(reqType)) {
            if (others.length > 0
                && others.every(r => !playedSet.has(r) && unobtainableRec(r, playedSet, stack))) {
                return true;
            }
        } else if (COUNT_MIN_REQ_TYPES.has(reqType)) {
            const quota = requiredCount(reqHost, reqType);
            const obtainable = others.filter(
                r => playedSet.has(r) || !unobtainableRec(r, playedSet, stack)).length;
            if (obtainable < quota) return true;
        }
    }
    return false;
}

// Whether a single requirement *group* (one reqType plus its refs) is
// permanently unsatisfiable because the refs themselves can never be
// obtained - the transitive sibling of ``reqGroupLocked`` (which covers
// only the *direct* permanent-lock cases). An AND group whose required line
// is itself unobtainable, an OR group whose every option is unobtainable, or
// a count-min group with too few still-obtainable options, can never be
// satisfied as the played set grows. Returns ``false`` for field types where
// transitive obtainability doesn't apply (negatives, count-max, run-count -
// those are handled by ``reqGroupLocked``). ``count`` is the group's
// threshold; ``selfName`` ignores the host's self-references.
export function isGroupUnobtainable(reqType, refs, playedSet, runsAgo, count = 1, selfName = null) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet, runsAgo);
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    const stack = new Set();
    if (AND_REQ_TYPES.has(reqType)) {
        return others.some(r => !playedSet.has(r) && unobtainableRec(r, playedSet, stack));
    }
    if (OR_REQ_TYPES.has(reqType)) {
        return others.length > 0
            && others.every(r => !playedSet.has(r) && unobtainableRec(r, playedSet, stack));
    }
    if (COUNT_MIN_REQ_TYPES.has(reqType)) {
        const obtainable = others.filter(
            r => playedSet.has(r) || !unobtainableRec(r, playedSet, stack)).length;
        return obtainable < (count || 1);
    }
    return false;
}

// Combined save verdict for one requirement group: the per-type met / unmet /
// unknown from ``reqGroupStatus``, upgraded to 'unobtainable' when the group is
// a permanent lock (``reqGroupLocked``) or transitively unobtainable (a
// required line that can never play - ``isGroupUnobtainable``). The single
// source the dependency tree and the detail panel both render as a group dot,
// so the two surfaces can't disagree. ``context`` is a save context (or a bare
// played Set); ``count`` is the group threshold; ``selfName`` ignores
// self-references.
export function requirementGroupVerdict(reqType, refs, context, count = 1, selfName = null) {
    let st = reqGroupStatus(reqType, refs, context, count, selfName);
    const played = (context instanceof Set) ? context : ((context && context.played) || null);
    const runsAgo = (context && context.runsAgo) || null;
    if (reqGroupLocked(reqType, refs, context, count, selfName)
        || isGroupUnobtainable(reqType, refs, played, runsAgo, count, selfName)) {
        st = 'unobtainable';
    }
    return st;
}

// Whether a whole requirement *set* (a textline or one ``orBranches``
// alternative - both carry ``requirements`` + ``otherRequirements``) is
// permanently unobtainable. Exposed wrapper over the internal recursive
// check so the dependency tree can mark an OR branch unobtainable.
export function isRequirementSetUnobtainable(reqHost, hostName, playedSet, runsAgo = null) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet, runsAgo);
    return requirementSetUnobtainable(reqHost, hostName, playedSet, new Set());
}

// Combined save verdict for one OR-branch (an ``orBranches`` alternative):
// 'unobtainable' when the branch can never be satisfied, else the AND of its
// textline-requirement verdict (``requirementSetStatus``) and its non-textline
// GameState-gate verdict (``evaluateOtherRequirements``). Shared by the
// dependency tree and the detail panel so per-branch dots agree.
export function orBranchVerdict(branch, context, name) {
    const ctx = (context instanceof Set) ? { played: context } : (context || {});
    if (ctx.played && isRequirementSetUnobtainable(branch, name, ctx.played, ctx.runsAgo)) {
        return 'unobtainable';
    }
    const textlineSt = requirementSetStatus(branch && branch.requirements, branch && branch.otherRequirements, ctx, name);
    // Resolve CurrentRun.* gates only when this dialogue's owner matches the
    // loaded save type (the branch belongs to the dialogue ``name``).
    const owner = (name && textlines[name]) ? textlines[name].owner : undefined;
    const resolveRun = currentRunResolvable(owner, ctx.saveInRun);
    const slices = {
        runs: ctx.runs,
        runsAgo: ctx.runsAgo,
        prevRun: ctx.prevRun,
        runHistory: ctx.runHistory,
        currentRun: resolveRun ? ctx.currentRun : null,
        rooms: resolveRun ? ctx.rooms : null,
    };
    const gateSt = evaluateOtherRequirements(branch && branch.otherRequirements, ctx.gameState, slices).status;
    if (textlineSt === 'unmet' || gateSt === 'unmet') return 'unmet';
    if (textlineSt === 'unknown' || gateSt === 'unknown') return 'unknown';
    return 'met';
}

// Combined verdict for a whole OR group (any-branch-satisfies): met if any
// branch is met, unobtainable if every branch is unobtainable, unmet if every
// branch is unmet, unknown otherwise.
export function orGroupVerdict(branches, context, name) {
    let anyUnknown = false;
    let allUnobtainable = true;
    for (const b of (Array.isArray(branches) ? branches : [])) {
        const st = orBranchVerdict(b, context, name);
        if (st === 'met') return 'met';
        if (st !== 'unobtainable') allUnobtainable = false;
        if (st !== 'unmet' && st !== 'unobtainable') anyUnknown = true;
    }
    return allUnobtainable ? 'unobtainable' : (anyUnknown ? 'unknown' : 'unmet');
}

// Collect the *specific* locks that make ``rootName`` unobtainable, for the
// tracer to explain why. Returns a de-duplicated list of:
//   { kind: 'negative', blocker, host }                - a must-not-have-played
//                                                        gate (on ``host``) whose
//                                                        line has played
//   { kind: 'maxany', blockers, count }                - a count-max gate with
//                                                        more than ``count`` lines played
//   { kind: 'runcount', blocker, count, ago }          - a MaxRunsSince gate on a
//                                                        play-once line now out of range
//   { kind: 'choice', parent, requiredChoice, taken }  - a required choice the
//                                                        player took differently
// Recurses through AND / OR / count / orBranch gates to the leaf cause, so a
// dialogue blocked via an unobtainable prerequisite reports the prerequisite's
// own lock rather than just "a prerequisite is locked".
export function unobtainableReasons(rootName, playedSet, runsAgo = null) {
    if (!playedSet || !textlines) return [];
    refreshUnobtainableCaches(playedSet, runsAgo);
    const reasons = [];
    gatherReasons(rootName, playedSet, reasons, new Set());
    const seen = new Set();
    return reasons.filter(r => {
        const key = JSON.stringify(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function gatherReasons(name, playedSet, reasons, visited) {
    if (visited.has(name) || playedSet.has(name)) return;
    visited.add(name);
    const tl = textlines[name];
    if (!tl) return;

    // This node is itself a locked choice variant.
    if (tl.isSynthetic && tl.parentTextline) {
        const chosen = _playedChoiceByParent.get(tl.parentTextline);
        if (chosen && chosen.size > 0 && !chosen.has(name)) {
            reasons.push({
                kind: 'choice',
                parent: tl.parentTextline,
                requiredChoice: tl.choiceText,
                taken: [...chosen].map(v => (textlines[v] && textlines[v].choiceText) || v),
            });
            return; // the lock is here; no need to recurse further
        }
    }

    gatherReqReasons(tl, name, playedSet, reasons, visited);

    const branches = Array.isArray(tl.orBranches) ? tl.orBranches : [];
    if (branches.length > 0
        && branches.every(b => requirementSetUnobtainable(b, name, playedSet, new Set()))) {
        for (const b of branches) gatherReqReasons(b, name, playedSet, reasons, visited);
    }
}

function gatherReqReasons(reqHost, hostName, playedSet, reasons, visited) {
    const requirements = (reqHost && reqHost.requirements) || {};
    for (const [reqType, refs] of Object.entries(requirements)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== hostName);
        if (NEGATIVE_REQ_TYPES.has(reqType) && REQ_TYPE_SCOPE[reqType] === 'played') {
            for (const r of others) {
                if (playedSet.has(r)) reasons.push({ kind: 'negative', blocker: r, host: hostName });
            }
        } else if (COUNT_MAX_REQ_TYPES.has(reqType)) {
            const max = requiredCount(reqHost, reqType);
            const playedRefs = others.filter(r => playedSet.has(r));
            if (playedRefs.length > max) reasons.push({ kind: 'maxany', blockers: playedRefs, count: max });
        } else if (reqType === 'MaxRunsSinceAnyTextLines') {
            const n = requiredCount(reqHost, reqType);
            for (const r of others) {
                if (maxRunsPermanentlyOut(r, n, playedSet)) {
                    const ago = _unobtainableRunsAgo ? _unobtainableRunsAgo[r] : undefined;
                    reasons.push({ kind: 'runcount', blocker: r, count: n, ago: typeof ago === 'number' ? ago : null });
                }
            }
        } else if (AND_REQ_TYPES.has(reqType)) {
            for (const r of others) {
                if (!playedSet.has(r) && unobtainableRec(r, playedSet, new Set())) {
                    gatherReasons(r, playedSet, reasons, visited);
                }
            }
        } else if (OR_REQ_TYPES.has(reqType) || COUNT_MIN_REQ_TYPES.has(reqType)) {
            // An OR / count group locks the host only when too few options can
            // still be obtained; report the locked options' own causes.
            const locked = others.filter(r => !playedSet.has(r) && unobtainableRec(r, playedSet, new Set()));
            const quota = COUNT_MIN_REQ_TYPES.has(reqType) ? requiredCount(reqHost, reqType) : 1;
            if (others.length - locked.length < quota) {
                for (const r of locked) gatherReasons(r, playedSet, reasons, visited);
            }
        }
    }
}
