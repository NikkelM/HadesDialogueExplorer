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

// The requirement fields whose verdict can be determined from a save's
// played set. The save's TextLinesRecord is a *cumulative* "ever played"
// record: it carries no per-run / per-room scoping and no run counts. So
// only the global, history-wide fields are evaluable - the run-scoped
// (``*ThisRun`` / ``*LastRun`` / ``*ThisRoom``), queued (``*Queued*``)
// and run-count (``Min/MaxRunsSince*``, ``RequiredMaxAny*``) variants
// cannot be checked and get no satisfaction verdict in the tree.
export const SAVE_EVALUABLE_REQ_TYPES = new Set([
    'RequiredTextLines',
    'RequiredAnyTextLines',
    'RequiredAnyOtherTextLines',
    'RequiredFalseTextLines',
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
 * Verdict for a single requirement *group* in the dependency tree (one
 * requirement field plus the refs listed under it) against ``playedSet``.
 * Applies the per-category rules (AND / OR / negative / count-min) to a
 * single group in isolation so the tree can mark each group header.
 * Returns:
 *   'met'     - the group's condition is currently satisfied
 *   'unmet'   - the condition is not satisfied
 *   'unknown' - the field can't be resolved from a save (run-scoped,
 *               queued, or run-count - see ``SAVE_EVALUABLE_REQ_TYPES``),
 *               so no verdict is shown
 * ``count`` is the COUNT_MIN threshold (defaults to 1); ``selfName`` lets
 * the play-once self-references a few gates carry be ignored.
 */
export function reqGroupStatus(reqType, refs, playedSet, count = 1, selfName = null) {
    if (!playedSet) return 'unknown';
    // Only global, history-wide fields are determinable from a cumulative
    // played set; everything else (this-run / last-run / this-room /
    // queued / run-count) gets no verdict.
    if (!SAVE_EVALUABLE_REQ_TYPES.has(reqType)) return 'unknown';
    const others = (Array.isArray(refs) ? refs : [])
        .filter(r => typeof r === 'string' && r !== selfName);
    if (AND_REQ_TYPES.has(reqType)) {
        return others.every(r => playedSet.has(r)) ? 'met' : 'unmet';
    }
    if (OR_REQ_TYPES.has(reqType)) {
        if (others.length === 0) return 'met';
        return others.some(r => playedSet.has(r)) ? 'met' : 'unmet';
    }
    if (NEGATIVE_REQ_TYPES.has(reqType)) {
        return others.some(r => playedSet.has(r)) ? 'unmet' : 'met';
    }
    if (COUNT_MIN_REQ_TYPES.has(reqType)) {
        const playedCount = others.filter(r => playedSet.has(r)).length;
        return playedCount >= (count || 1) ? 'met' : 'unmet';
    }
    return 'unknown';
}

/**
 * Three-state verdict for a requirement *set* (a textline's base
 * requirements or one ``orBranches`` alternative) against ``playedSet``,
 * used for the OR branch / group headers. Honest about save-unverifiable
 * fields: returns
 *   'unmet'   - a save-evaluable field in the set is not satisfied
 *   'unknown' - no evaluable field failed but the set carries a field the
 *               save can't resolve (run-scoped / queued / run-count), so
 *               the overall verdict can't be confirmed
 *   'met'     - the set is empty/no-op, or every contributing field is
 *               save-evaluable and satisfied
 * ``name`` is the host dialogue's own name (self-references ignored).
 */
export function requirementSetStatus(requirements, otherRequirements, playedSet, name) {
    if (!playedSet) return 'unknown';
    let sawUnverifiable = false;
    for (const [reqType, refs] of Object.entries(requirements || {})) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== name);
        if (others.length === 0) continue;
        if (SAVE_EVALUABLE_REQ_TYPES.has(reqType)) {
            if (reqGroupStatus(reqType, refs, playedSet, countFrom(otherRequirements, reqType), name) === 'unmet') {
                return 'unmet';
            }
        } else {
            sawUnverifiable = true;
        }
    }
    return sawUnverifiable ? 'unknown' : 'met';
}

/**
 * Three-state direct eligibility for ``textlineData`` given ``playedSet``:
 *   'met'     - directly eligible now (all requirements confirmed satisfied)
 *   'unmet'   - a save-evaluable requirement is not satisfied
 *   'unknown' - every save-evaluable requirement is satisfied, but the
 *               dialogue also gates on something a save can't resolve
 *               (per-run / per-room / queued state, or run counts), so
 *               eligibility can't be confirmed either way
 *
 * Shallow by design: this answers "can this dialogue play right now",
 * which depends only on its immediate requirements - transitive history is
 * handled by the eligibility tracer. The dialogue's base requirement set
 * AND, if it carries H2 ``orBranches`` alternatives, the OR group (met
 * when any branch is met, unmet only when all are unmet, unknown
 * otherwise) must both hold. ``name`` is the dialogue's own name, used to
 * ignore self-references.
 */
export function directSatisfaction(textlineData, playedSet, name) {
    if (!textlineData) return 'met';
    if (!playedSet) return 'unknown';
    const base = requirementSetStatus(
        textlineData.requirements, textlineData.otherRequirements, playedSet, name);
    if (base === 'unmet') return 'unmet';
    let orStatus = 'met';
    const branches = Array.isArray(textlineData.orBranches) ? textlineData.orBranches : [];
    if (branches.length > 0) {
        let anyMet = false;
        let anyUnknown = false;
        for (const b of branches) {
            const st = requirementSetStatus(b.requirements, b.otherRequirements, playedSet, name);
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
