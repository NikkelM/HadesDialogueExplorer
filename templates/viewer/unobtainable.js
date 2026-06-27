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

import { textlines, namedRequirements, getActiveGame } from './data.js';
import { AND_REQ_TYPES, OR_REQ_TYPES, NEGATIVE_REQ_TYPES, COUNT_MIN_REQ_TYPES, COUNT_MAX_REQ_TYPES, REQ_TYPE_SCOPE, requiredCount, reqGroupStatus, reqGroupLocked, requirementSetStatus, namedRequirementHostStatus, isPlayOnceRef } from './requirements.js';
import { evaluateOtherRequirements, currentRunResolvable } from './gamestate-eval.js';
import { evaluateH1OtherReqPermanence, h1FieldPermanentlyUnmet } from './gamestate-eval-h1.js';
import { gameStateClausePermanence } from './permanent-state.js';

let _unobtainablePlayedSet = null;
let _unobtainableTextlines = null;
let _unobtainableRunsAgo = null;
// The save's persistent GameState slice, used to decide whether a non-textline
// gate reads permanent state (see ``permanent-state.js``). Null when the caller
// supplied no save context, in which case only textline-record locks apply.
let _unobtainableGameState = null;
let _unobtainableCache = null;
let _playedChoiceByParent = null;

// Rebuild the per-save memo + "which choice variant did the player record
// for each parent" lookup whenever the played set (or the loaded data, e.g.
// after a game switch, the run-count distances, or the GameState slice) changes.
function refreshUnobtainableCaches(playedSet, runsAgo, context = null) {
    const gameState = (context && context.gameState) || null;
    if (_unobtainablePlayedSet === playedSet && _unobtainableTextlines === textlines
        && _unobtainableRunsAgo === runsAgo && _unobtainableGameState === gameState) return;
    _unobtainablePlayedSet = playedSet;
    _unobtainableTextlines = textlines;
    _unobtainableRunsAgo = runsAgo;
    _unobtainableGameState = gameState;
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

// Whether a positive-queued operand could still be queued to play next at some
// future point: it must still be able to play at all (not a play-once line that
// already played, and not itself transitively unobtainable). A repeatable line
// can be re-queued even after playing; a play-once line that has played, or any
// line that can never play, can never be queued again.
function canStillBeQueued(ref, playedSet, stack) {
    if (isPlayOnceRef(ref) && playedSet.has(ref)) return false;
    return !unobtainableRec(ref, playedSet, stack);
}

export function isUnobtainable(name, playedSet, runsAgo = null, context = null) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet, runsAgo, context);
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

    // Retired line: `Skip = true` in the game data makes it permanently
    // unplayable - IsGameStateEligible rejects it before every other check
    // (even debug force-play), independent of save state.
    if (tl.skip) return true;

    // Choice-lock: a choice variant whose parent already recorded a
    // different option can never be obtained.
    if (tl.isSynthetic && tl.parentTextline) {
        const chosen = _playedChoiceByParent.get(tl.parentTextline);
        if (chosen && chosen.size > 0 && !chosen.has(name)) return true;
    }

    if (setPermanentlyUnmet(tl, name, playedSet, stack, new Set())) return true;

    // orBranches: eligibility needs at least one branch satisfiable.
    const branches = Array.isArray(tl.orBranches) ? tl.orBranches : [];
    if (branches.length > 0
        && branches.every(b => setPermanentlyUnmet(b, name, playedSet, stack, new Set()))) {
        return true;
    }
    return false;
}

// True if a whole requirement set (a textline or one orBranch - both carry
// ``requirements`` + ``otherRequirements`` + ``orBranches``) can never be
// satisfied as the save grows: its textline-record requirements are permanently
// unmet (``requirementSetUnobtainable``), OR one of its non-textline gates reads
// permanent state that can never satisfy it (a monotonic GameState gate already
// past the point of no return, or a named requirement that can never hold the
// way the host needs). ``namedStack`` guards named-requirement recursion.
function setPermanentlyUnmet(reqHost, hostName, playedSet, stack, namedStack) {
    if (requirementSetUnobtainable(reqHost, hostName, playedSet, stack)) return true;
    const other = (reqHost && reqHost.otherRequirements) || {};
    // Hades 1 flat "max" gates over monotonic counters (run counts, lifetime
    // resources, one-way weapon-aspect unlocks, cumulative interactions, ...)
    // become permanently unmet once their one-way counter is surpassed. A no-op
    // for H2, whose otherRequirements use array clauses / NamedRequirements
    // (handled by the loop below).
    if (evaluateH1OtherReqPermanence(other, _unobtainableGameState) === 'unmet') return true;
    for (const [key, val] of Object.entries(other)) {
        if (key === 'NamedRequirements') {
            // Must pass -> permanently unmet if any named set can never be met.
            if ((Array.isArray(val) ? val : []).some(n => namedSetPermanentlyUnmet(n, playedSet, namedStack))) return true;
        } else if (key === 'NamedRequirementsFalse') {
            // Must NOT pass -> permanently unmet if any named set is permanently
            // met (it can never become ineligible again).
            if ((Array.isArray(val) ? val : []).some(n => namedSetPermanentlyMet(n, playedSet, namedStack))) return true;
        } else if (Array.isArray(val)) {
            for (const rec of val) {
                if (gameStateClausePermanence(rec, _unobtainableGameState) === 'unmet') return true;
            }
        }
    }
    return false;
}

// True when a whole requirement set is satisfied now and can never become
// unsatisfied as the save grows: every textline-record requirement is a
// 'played'-scope positive already met (the played set only grows), every
// non-textline gate reads permanent state that is already satisfied, and - if
// the set carries orBranches - at least one branch is itself permanently met.
// Run / room / queued-scoped, negative, count-max and run-count fields, and any
// gate on live / resettable state, are never "permanently met" (they can change
// across runs), so a set carrying one is conservatively not permanent.
function setPermanentlyMet(reqHost, playedSet, namedStack) {
    if (!reqHost) return true; // an empty set is trivially (and permanently) met
    const requirements = reqHost.requirements || {};
    for (const [reqType, refs] of Object.entries(requirements)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string');
        if (others.length === 0) continue;
        if (REQ_TYPE_SCOPE[reqType] !== 'played') return false;
        if (AND_REQ_TYPES.has(reqType)) {
            if (!others.every(r => playedSet.has(r))) return false;
        } else if (OR_REQ_TYPES.has(reqType)) {
            if (!others.some(r => playedSet.has(r))) return false;
        } else if (COUNT_MIN_REQ_TYPES.has(reqType)) {
            if (others.filter(r => playedSet.has(r)).length < requiredCount(reqHost, reqType)) return false;
        } else {
            return false; // negative / count-max played gates aren't permanent-met
        }
    }
    const other = reqHost.otherRequirements || {};
    for (const [key, val] of Object.entries(other)) {
        if (key === 'NamedRequirements') {
            if (!(Array.isArray(val) ? val : []).every(n => namedSetPermanentlyMet(n, playedSet, namedStack))) return false;
        } else if (key === 'NamedRequirementsFalse') {
            if (!(Array.isArray(val) ? val : []).every(n => namedSetPermanentlyUnmet(n, playedSet, namedStack))) return false;
        } else if (key === 'NamedRequirementsCycle') {
            return false;
        } else if (Array.isArray(val)) {
            for (const rec of val) {
                if (gameStateClausePermanence(rec, _unobtainableGameState) !== 'met') return false;
            }
        }
    }
    const branches = Array.isArray(reqHost.orBranches) ? reqHost.orBranches : [];
    if (branches.length > 0 && !branches.some(b => setPermanentlyMet(b, playedSet, namedStack))) return false;
    return true;
}

// Named-requirement permanence wrappers, with a recursion guard against cyclic
// named references. An unresolved or cyclic name can't be confirmed permanent,
// so both return false (the conservative answer - no false unobtainability).
function namedSetPermanentlyMet(name, playedSet, namedStack) {
    if (namedStack.has(name)) return false;
    const def = namedRequirements[name];
    if (!def) return false;
    namedStack.add(name);
    const r = setPermanentlyMet(def, playedSet, namedStack);
    namedStack.delete(name);
    return r;
}
function namedSetPermanentlyUnmet(name, playedSet, namedStack) {
    if (namedStack.has(name)) return false;
    const def = namedRequirements[name];
    if (!def) return false;
    namedStack.add(name);
    const r = setPermanentlyUnmet(def, null, playedSet, new Set(), namedStack);
    namedStack.delete(name);
    return r;
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
        } else if (REQ_TYPE_SCOPE[reqType] === 'queued' && AND_REQ_TYPES.has(reqType)) {
            // Positive queued AND: every ref must be queued to play next. A ref
            // that can never be queued again (play-once + already played, or
            // itself unobtainable) locks the whole gate.
            if (others.some(r => !canStillBeQueued(r, playedSet, stack))) return true;
        } else if (REQ_TYPE_SCOPE[reqType] === 'queued' && OR_REQ_TYPES.has(reqType)) {
            // Positive queued OR: at least one ref must be queueable; locked only
            // when none of them can ever be queued again.
            if (others.length > 0 && others.every(r => !canStillBeQueued(r, playedSet, stack))) return true;
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
// is itself unobtainable, an OR group whose every option is unobtainable, a
// count-min group with too few still-obtainable options, or a positive queued
// group whose operand(s) can never be queued again (a play-once line that
// already played, or an unobtainable line), can never be satisfied as the
// played set grows. Returns ``false`` for field types where transitive
// obtainability doesn't apply (negatives, count-max, run-count - those are
// handled by ``reqGroupLocked``). ``count`` is the group's threshold;
// ``selfName`` ignores the host's self-references.
export function isGroupUnobtainable(reqType, refs, playedSet, runsAgo, count = 1, selfName = null) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet, runsAgo);
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    const stack = new Set();
    if (REQ_TYPE_SCOPE[reqType] === 'queued' && AND_REQ_TYPES.has(reqType)) {
        return others.some(r => !canStillBeQueued(r, playedSet, stack));
    }
    if (REQ_TYPE_SCOPE[reqType] === 'queued' && OR_REQ_TYPES.has(reqType)) {
        return others.length > 0 && others.every(r => !canStillBeQueued(r, playedSet, stack));
    }
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
    const gameId = getActiveGame();
    const resolveRun = currentRunResolvable(owner, ctx.saveInRun, gameId);
    const slices = {
        runs: ctx.runs,
        runsAgo: ctx.runsAgo,
        prevRun: ctx.prevRun,
        runHistory: ctx.runHistory,
        currentRun: resolveRun ? ctx.currentRun : null,
        rooms: resolveRun ? ctx.rooms : null,
        audioState: ctx.audioState,
    };
    const gateSt = evaluateOtherRequirements(branch && branch.otherRequirements, ctx.gameState, slices, gameId).status;
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

// Host-gate verdict for one NamedRequirements* reference, upgrading the plain
// met / unmet / unknown status (``namedRequirementHostStatus``) to
// 'unobtainable' when the host's gate on this name is permanently unsatisfiable:
//   - NamedRequirementsFalse (must NOT pass) when the named set is permanently
//     met (it can never become ineligible again), or
//   - NamedRequirements (must pass) when the named set is permanently unmet.
// Shared by the detail view and the tracer so the per-name dot reads the same.
export function namedRequirementHostVerdict(key, name, context, hostOwner) {
    const base = namedRequirementHostStatus(key, name, context, hostOwner);
    const played = (context instanceof Set) ? context : (context && context.played) || null;
    if (!played || !textlines) return base;
    const runsAgo = (context && context.runsAgo) || null;
    refreshUnobtainableCaches(played, runsAgo, context);
    if (key === 'NamedRequirementsFalse' && namedSetPermanentlyMet(name, played, new Set())) return 'unobtainable';
    if (key === 'NamedRequirements' && namedSetPermanentlyUnmet(name, played, new Set())) return 'unobtainable';
    return base;
}

// Combined host-gate verdict over every name in a NamedRequirements* set: the
// AND of the per-name verdicts, with 'unobtainable' (a permanent block) winning
// over a merely-current 'unmet'. The single source the detail view and tracer
// render as the group dot.
export function namedRequirementGroupVerdict(key, names, context, hostOwner) {
    const arr = (Array.isArray(names) ? names : []).map(
        n => namedRequirementHostVerdict(key, n, context, hostOwner));
    if (arr.includes('unobtainable')) return 'unobtainable';
    if (arr.includes('unmet')) return 'unmet';
    if (arr.includes('unknown')) return 'unknown';
    return 'met';
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
//   { kind: 'gamestate', field, value }                - a GameState gate over
//                                                        monotonic save progress
//                                                        already past the point
//                                                        it allows (H1 "max" or
//                                                        require-absence gate, or
//                                                        H2 PathFalse on a
//                                                        monotonic table) - can
//                                                        never recover
//   { kind: 'choice', parent, requiredChoice, taken }  - a required choice the
//                                                        player took differently
// Recurses through AND / OR / count / orBranch gates to the leaf cause, so a
// dialogue blocked via an unobtainable prerequisite reports the prerequisite's
// own lock rather than just "a prerequisite is locked". ``context`` carries the
// save's GameState slice so the monotonic-GameState gate locks can be explained.
export function unobtainableReasons(rootName, playedSet, runsAgo = null, context = null) {
    if (!playedSet || !textlines) return [];
    refreshUnobtainableCaches(playedSet, runsAgo, context);
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

    // This node is a retired (`Skip = true`) line - permanently unplayable
    // regardless of save state. The lock is structural, so report it and stop.
    if (tl.skip) {
        reasons.push({ kind: 'skip', replacement: tl.skipReplacement || null });
        return;
    }

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
    // GameState gates that read monotonic save progress already past the point
    // this dialogue needs - a one-way counter surpassed (H1 "max" gates) or a
    // write-once "must NOT have happened" record that already has (H1
    // RequiredFalse* / H2 PathFalse on a monotonic table). These can never
    // recover, so they're a leaf cause of an unobtainable dialogue.
    if (_unobtainableGameState) {
        const other = (reqHost && reqHost.otherRequirements) || {};
        for (const [field, val] of Object.entries(other)) {
            if (h1FieldPermanentlyUnmet(field, val, _unobtainableGameState, other)) {
                reasons.push({ kind: 'gamestate', field, value: val });
            } else if (Array.isArray(val)
                && val.some(rec => gameStateClausePermanence(rec, _unobtainableGameState) === 'unmet')) {
                reasons.push({ kind: 'gamestate', field, value: val });
            }
        }
    }
}
