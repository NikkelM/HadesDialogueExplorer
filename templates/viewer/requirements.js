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

/**
 * Return true if every *direct* requirement of ``textlineData`` is
 * satisfied by ``playedSet`` (a Set of played textline names).
 *
 * Shallow by design: this answers "can this dialogue play right now",
 * which depends only on its immediate requirements - the transitive
 * history is handled separately by the eligibility tracer.
 *
 * Per category: AND fields need all refs played, OR fields need at least
 * one, NEGATIVE fields need none. Count/cooldown fields
 * (``RequiredMin/MaxAny*``, ``Min/MaxRunsSince*``) depend on run counts
 * the save can't resolve and are treated as satisfied, matching the
 * tracer's documented scope. ``name`` is the dialogue's own name, used to
 * ignore the self-references a few play-once gates carry.
 */
export function isDirectlySatisfied(textlineData, playedSet, name) {
    const reqs = textlineData && textlineData.requirements;
    if (!reqs) return true;

    for (const [reqType, refs] of Object.entries(reqs)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== name);

        if (AND_REQ_TYPES.has(reqType)) {
            if (!others.every(r => playedSet.has(r))) return false;
        } else if (OR_REQ_TYPES.has(reqType)) {
            if (others.length > 0 && !others.some(r => playedSet.has(r))) return false;
        } else if (NEGATIVE_REQ_TYPES.has(reqType)) {
            if (others.some(r => playedSet.has(r))) return false;
        }
        // Count-based / cooldown fields: not evaluable from the played set
        // alone - treated as satisfied (see module docstring).
    }
    return true;
}
