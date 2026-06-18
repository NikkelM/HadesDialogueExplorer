/**
 * "Permanently unobtainable" detection.
 *
 * A loaded save's played set only ever grows, so some dialogues can never
 * become eligible again once the player has locked themselves out:
 *   * a negative gate (RequiredFalse*) on a line that is already played - it
 *     can never be un-played (the mutually-exclusive _A / _B variant
 *     pattern); and
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
import { AND_REQ_TYPES, OR_REQ_TYPES, NEGATIVE_REQ_TYPES, COUNT_MIN_REQ_TYPES, requiredCount } from './requirements.js';

let _unobtainablePlayedSet = null;
let _unobtainableTextlines = null;
let _unobtainableCache = null;
let _playedChoiceByParent = null;

// Rebuild the per-save memo + "which choice variant did the player record
// for each parent" lookup whenever the played set (or the loaded data, e.g.
// after a game switch) changes.
function refreshUnobtainableCaches(playedSet) {
    if (_unobtainablePlayedSet === playedSet && _unobtainableTextlines === textlines) return;
    _unobtainablePlayedSet = playedSet;
    _unobtainableTextlines = textlines;
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

export function isUnobtainable(name, playedSet) {
    if (!playedSet || !textlines) return false;
    refreshUnobtainableCaches(playedSet);
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
        if (NEGATIVE_REQ_TYPES.has(reqType)) {
            // Must NOT have played these - but one already has, permanently.
            if (others.some(r => playedSet.has(r))) return true;
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

// Collect the *specific* locks that make ``rootName`` unobtainable, for the
// tracer to explain why. Returns a de-duplicated list of:
//   { kind: 'negative', blocker }                      - a must-not-have-played
//                                                        gate whose line has played
//   { kind: 'choice', parent, requiredChoice, taken }  - a required choice the
//                                                        player took differently
// Recurses through AND / OR / count / orBranch gates to the leaf cause, so a
// dialogue blocked via an unobtainable prerequisite reports the prerequisite's
// own lock rather than just "a prerequisite is locked".
export function unobtainableReasons(rootName, playedSet) {
    if (!playedSet || !textlines) return [];
    refreshUnobtainableCaches(playedSet);
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
        if (NEGATIVE_REQ_TYPES.has(reqType)) {
            for (const r of others) {
                if (playedSet.has(r)) reasons.push({ kind: 'negative', blocker: r });
            }
        } else if (AND_REQ_TYPES.has(reqType)) {
            for (const r of others) {
                if (!playedSet.has(r) && isUnobtainable(r, playedSet)) {
                    gatherReasons(r, playedSet, reasons, visited);
                }
            }
        } else if (OR_REQ_TYPES.has(reqType) || COUNT_MIN_REQ_TYPES.has(reqType)) {
            // An OR / count group locks the host only when too few options can
            // still be obtained; report the locked options' own causes.
            const locked = others.filter(r => !playedSet.has(r) && isUnobtainable(r, playedSet));
            const quota = COUNT_MIN_REQ_TYPES.has(reqType) ? requiredCount(reqHost, reqType) : 1;
            if (others.length - locked.length < quota) {
                for (const r of locked) gatherReasons(r, playedSet, reasons, visited);
            }
        }
    }
}
