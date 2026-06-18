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
 * lockstep, and ``api.py`` derives its own sets from that same map.
 */

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
// otherRequirements[field].Count). The only count-based field that is
// evaluable from a save's played set; the others (RequiredMaxAny*,
// Min/MaxRunsSince*) depend on run counts the save doesn't carry.
export const COUNT_MIN_REQ_TYPES = new Set([
    'RequiredMinAnyTextLines',
]);

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
 * Return true if a single requirement set (a textline's base requirements,
 * or one H2 ``orBranches`` alternative) is satisfied by ``playedSet``.
 *
 * Per category: AND fields need all refs played, OR fields need at least
 * one, NEGATIVE fields need none, and COUNT_MIN fields need at least their
 * ``Count`` played (read from ``otherRequirements``). Run-count / cooldown
 * fields depend on run counts the save can't resolve and are treated as
 * satisfied (not listed in any of the four sets). ``name`` is the host
 * dialogue's own name, used to ignore the self-references a few play-once
 * gates carry.
 */
function requirementsSatisfied(requirements, otherRequirements, playedSet, name) {
    if (!requirements) return true;
    for (const [reqType, refs] of Object.entries(requirements)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== name);

        if (AND_REQ_TYPES.has(reqType)) {
            if (!others.every(r => playedSet.has(r))) return false;
        } else if (OR_REQ_TYPES.has(reqType)) {
            if (others.length > 0 && !others.some(r => playedSet.has(r))) return false;
        } else if (NEGATIVE_REQ_TYPES.has(reqType)) {
            if (others.some(r => playedSet.has(r))) return false;
        } else if (COUNT_MIN_REQ_TYPES.has(reqType)) {
            const playedCount = others.filter(r => playedSet.has(r)).length;
            if (playedCount < countFrom(otherRequirements, reqType)) return false;
        }
        // Other count / cooldown fields (RequiredMaxAny*, Min/MaxRunsSince*)
        // depend on run counts the save can't resolve - treated as satisfied.
    }
    return true;
}

/**
 * Return true if ``textlineData`` is *directly* eligible given ``playedSet``
 * (a Set of played textline names).
 *
 * Shallow by design: this answers "can this dialogue play right now", which
 * depends only on its immediate requirements - the transitive history is
 * handled separately by the eligibility tracer.
 *
 * A dialogue is directly eligible when its base requirements are satisfied
 * AND, if it carries H2 set-level ``orBranches`` (alternative requirement
 * sets), at least one branch is satisfied. ``name`` is the dialogue's own
 * name, used to ignore self-references.
 */
export function isDirectlySatisfied(textlineData, playedSet, name) {
    if (!textlineData) return true;
    if (!requirementsSatisfied(
        textlineData.requirements, textlineData.otherRequirements, playedSet, name)) {
        return false;
    }
    const branches = Array.isArray(textlineData.orBranches) ? textlineData.orBranches : [];
    if (branches.length > 0 && !branches.some(
        b => requirementsSatisfied(b.requirements, b.otherRequirements, playedSet, name))) {
        return false;
    }
    return true;
}
