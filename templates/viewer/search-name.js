// Name-based search ranking.
//
// Pure functions that turn a tokenised query into ordered matches
// against the dataset's textline names + owner labels. Used by
// ``search-ui.js`` for the synchronous-on-every-keystroke top
// section of the dropdown.

import { textlines, allNames, speakers, getBaseSpeakers } from './data.js';
import { computeIdf, candidateTokenWeight } from './idf.js';
import { passesTextlineFilters } from './query-filters.js';
import { computeDialogueKeywords, keywordSetMatches } from './search-keywords.js';

// Token -> IDF weight, computed over the name corpus (textline names
// tokenised on PascalCase / digit transitions, owner display names
// tokenised on whitespace). Rebuilt by :func:`buildNameIndex` on each
// dataset load so the weights always reflect the live corpus.
export let nameIdf;

// Per-candidate token list, keyed by textline name. Stored alongside
// the IDF map so :func:`searchNameMatches` can prefix-resolve
// mid-typing query tokens (``zeu`` -> ``zeus``) against the actual
// tokens present on each candidate, rather than guessing.
let nameTokens;

// Per-candidate name-only PascalCase segments (no owner tokens),
// keyed by textline name. Used for the gappy token-subsequence
// fallback so a query that skips a middle segment
// (``hadesaboutrenovations`` -> ``HadesAboutUnderworldRenovations01``)
// still finds the dialogue, anchored to the start of the name.
let nameSegments;

// Per-candidate concept keyword set (e.g. {romance, relationship, ...}),
// keyed by textline name. Derived from the dialogue's section + name by
// :mod:`search-keywords`; powers the lowest-tier "buzzword" match so
// ``eris romance`` surfaces ``ErisBecomingCloser01`` even though the name
// contains neither the word "romance" nor "relationship". Names with no
// concept keywords are omitted from the map (so the common case is a cheap
// miss).
let nameKeywords;

// Split a textline name (PascalCase identifier) into its constituent
// segments. Boundaries are:
//   - Non-word -> word transition (e.g. ``_`` between segments).
//   - lower-or-digit -> upper transition (PascalCase break:
//     ``OrpheusWith`` -> ``Orpheus``, ``With``).
//   - letter <-> digit transition (``Eurydice01`` -> ``Eurydice``,
//     ``01``).
// Returns lowercased tokens so callers can compare without further
// case folding. Empty / falsy input returns an empty array.
export function tokeniseTextlineName(name) {
    const tokens = [];
    if (!name) return tokens;
    const charType = (c) => {
        if (c >= 65 && c <= 90) return 'U';   // A-Z
        if (c >= 97 && c <= 122) return 'L';  // a-z
        if (c >= 48 && c <= 57) return 'D';   // 0-9
        return 'X';                            // anything else
    };
    let start = -1;
    let prevType = 'X';
    for (let i = 0; i < name.length; i++) {
        const t = charType(name.charCodeAt(i));
        if (t === 'X') {
            if (start >= 0) {
                tokens.push(name.slice(start, i).toLowerCase());
                start = -1;
            }
        } else if (start < 0) {
            start = i;
        } else {
            const subBoundary =
                ((prevType === 'L' || prevType === 'D') && t === 'U') ||
                (prevType === 'L' && t === 'D') ||
                (prevType === 'D' && (t === 'L' || t === 'U'));
            if (subBoundary) {
                tokens.push(name.slice(start, i).toLowerCase());
                start = i;
            }
        }
        prevType = t;
    }
    if (start >= 0) tokens.push(name.slice(start).toLowerCase());
    return tokens;
}

// Split an owner display name (e.g. ``"Megaera (Boss)"``) on
// whitespace. The variant suffix in parentheses stays attached to
// the preceding token; the IDF formula then treats e.g. ``(boss)`` as
// its own rare segment, which is fine because the matcher does a
// substring check rather than an exact-token check, so the weight
// just biases ranking without affecting recall.
export function tokeniseOwnerDisplay(display) {
    if (!display) return [];
    return display.toLowerCase().split(/\s+/).filter(t => t.length > 0);
}

// Rebuild the name-corpus IDF map from the currently-loaded dataset.
// One document per textline: tokens combine PascalCase segments from
// the textline name with whitespace segments from the owner display
// name. Owner ids are deliberately NOT included in the corpus -
// they're cryptic (``NPC_FurySister_01``) and would otherwise dilute
// the per-token document-frequency signal with synthetic noise.
// Called from ``init.js`` after ``loadData`` and from
// ``loadFixtureData`` in tests.
export function buildNameIndex() {
    const docs = [];
    nameTokens = new Map();
    nameSegments = new Map();
    nameKeywords = new Map();
    const base = getBaseSpeakers();
    for (const name of allNames) {
        const tl = textlines[name];
        if (!tl) continue;
        const tokens = tokeniseTextlineName(name);
        nameSegments.set(name, tokens.slice());
        const ownerDisplay = speakers[tl.owner] && speakers[tl.owner].name;
        if (ownerDisplay) {
            for (const t of tokeniseOwnerDisplay(ownerDisplay)) tokens.push(t);
        }
        // English base owner name too, so a name search still finds a textline
        // by its owner's English name under a non-English UI (``speakers`` is the
        // localised overlay). Deduped by the Set-of-tokens the caller builds.
        const ownerBase = base[tl.owner] && base[tl.owner].name;
        if (ownerBase && ownerBase !== ownerDisplay) {
            for (const t of tokeniseOwnerDisplay(ownerBase)) tokens.push(t);
        }
        nameTokens.set(name, tokens);
        const keywords = computeDialogueKeywords(name, tl.section);
        if (keywords.size > 0) nameKeywords.set(name, keywords);
        docs.push(tokens);
    }
    nameIdf = computeIdf(docs, (d) => d);
}

// Whether ``query`` can be formed from the candidate's name
// ``segments``: the query must begin with the first segment (so a
// match always shares the dialogue's leading word, keeping this loose
// fallback precise), after which the remaining segments may be matched
// in ANY order, each consumed whole, with the final query fragment
// allowed to be a prefix of an unused segment (mid-typing). Unused
// segments may be skipped entirely. e.g. for
// ``['hades','about','underworld','renovations','01']`` it matches
// both ``hadesaboutrenovations`` (in order, ``underworld`` skipped)
// and ``hadesrenovationsabout`` (``renovations`` and ``about``
// reordered).
export function gappyTokenSubsequence(query, segments) {
    if (!query || !segments || segments.length === 0) return false;
    const first = segments[0];
    if (!query.startsWith(first)) return false;
    return matchSegmentsAnyOrder(query.slice(first.length), segments.slice(1));
}

// Recursive helper for :func:`gappyTokenSubsequence`. True when ``rem``
// can be consumed by concatenating whole segments from ``segs`` in any
// order, or when it is a (non-empty) prefix of an as-yet-unused
// segment. Segment counts per name are tiny so the backtracking cost
// is negligible.
function matchSegmentsAnyOrder(rem, segs) {
    if (rem.length === 0) return true;
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (!seg) continue;
        if (rem.startsWith(seg)) {
            const next = segs.slice(0, i).concat(segs.slice(i + 1));
            if (matchSegmentsAnyOrder(rem.slice(seg.length), next)) return true;
        } else if (seg.startsWith(rem)) {
            return true;
        }
    }
    return false;
}

// Rank a single search token against one candidate textline. Lower is
// better; -1 means no match. Tiers:
//
//   0 = token at start of textline name
//   1 = token at start of owner display name or internal id
//       (broad sweep of "all dialogue from <NPC>")
//   2 = token at a PascalCase word boundary in the textline name
//       (e.g. ``Eurydice`` inside ``OrpheusWithEurydice01``)
//   3 = token anywhere else in the textline name (mid-segment)
//   4 = token anywhere in the owner display name or internal id
//   5 = gappy start-anchored token-subsequence over the name's
//       segments, skipping a middle segment (only when ``nameSegs``
//       is supplied - i.e. single-token queries). A pure recall
//       fallback, ranked below every contiguous match.
//   6 = concept keyword ("buzzword") match: the token matches one of
//       the dialogue's derived keyword terms (e.g. ``romance`` ->
//       ``ErisBecomingCloser01``). The lowest tier, so a semantic hit
//       never outranks a literal name / owner match. Only fires when
//       ``keywordSet`` is supplied and the token is 3+ characters.
//
// Kept pure (tier only, no IDF weighting) so per-token tier logic
// stays unit-testable in isolation. Weighting happens in
// :func:`searchNameMatches`.
export function rankSearchToken(token, nameOriginal, nameLower, ownerIdLower, ownerDisplayLower, nameSegs, keywordSet) {
    if (nameLower.startsWith(token)) return 0;
    if (ownerIdLower.startsWith(token)) return 1;
    if (ownerDisplayLower && ownerDisplayLower.startsWith(token)) return 1;
    // PascalCase boundary: scan for any match position where the
    // original-case character is uppercase. Position 0 is also a
    // boundary but is already covered by the `startsWith` check above.
    let i = 0;
    while ((i = nameLower.indexOf(token, i)) !== -1) {
        if (i > 0) {
            const c = nameOriginal.charCodeAt(i);
            if (c >= 65 && c <= 90) return 2;
        }
        i++;
    }
    if (nameLower.includes(token)) return 3;
    if (ownerIdLower.includes(token)) return 4;
    if (ownerDisplayLower && ownerDisplayLower.includes(token)) return 4;
    if (nameSegs && gappyTokenSubsequence(token, nameSegs)) return 5;
    if (keywordSet && keywordSetMatches(keywordSet, token)) return 6;
    return -1;
}

// Compute the ranked name matches for a structured query.
//
// The query carries:
//   - ``positive`` tokens: must ALL match per the existing tier
//     ranking (a missing token disqualifies the candidate). Phrase
//     contents already live in this list (the parser seeds them)
//     so phrase queries get the same ranking signal as their
//     individual words.
//   - ``negative`` tokens / ``negativePhrases``: any substring hit
//     against the candidate name / owner id / owner display name
//     disqualifies the candidate. Negatives are applied as raw
//     lowercased substring matches (no PascalCase / word-boundary
//     awareness) because the name search itself is substring-based.
//   - ``speakers`` / ``sections`` (positive + negative): hard
//     textline filters shared with the text search engine via
//     ``passesTextlineFilters``.
//
// Ranking axes, in priority order:
//   1. Weighted tier tuple, compared lexicographically. Each entry
//      is ``tier_i * candidate_weight_i`` - the candidate-specific
//      IDF weight for the i-th query token (via per-candidate prefix
//      resolution so mid-typing queries like ``zeu`` resolve to the
//      weight of the actual matched corpus token ``zeus``). Lex
//      comparison from position 0 onwards preserves
//      "earlier-typed-token-dominates": the rank is driven first by
//      where the user's first query token landed, then by the
//      second, and so on - the same priority order the user
//      conveyed by typing the tokens in that sequence. Multiplying
//      tier by weight only changes the comparison when per-candidate
//      weights diverge for the same query position (e.g. prefix
//      ``z`` matching ``Zeus`` in one candidate and ``Zagreus`` in
//      another); in that edge case the candidate where the rare
//      parent token sits at the better tier wins.
//   2. Alphabetical fall-through via the ``allNames`` scan order.
//
// Single-token queries skip IDF entirely (a single weighted entry
// reduces to plain tier comparison either way) so per-keystroke
// results stay deterministic while the user is still typing the
// first segment.
//
// Filter-only queries (no positive tokens, no phrases) still run
// the scan - all candidates pass the per-token tier check
// vacuously and tier weights collapse to identical zero-length
// tuples, so the result is just every textline that survives the
// filters, alphabetically. That gives users a useful "list every
// Zeus textline" search without forcing a dummy keyword.
export function searchNameMatches(query, limit) {
    const positive = (query && query.positive) || [];
    const negative = (query && query.negative) || [];
    const negativePhrases = (query && query.negativePhrases) || [];
    const useIdf = positive.length > 1 && nameIdf;

    const ranked = [];
    for (const n of allNames) {
        const tl = textlines[n];
        if (!tl) continue;
        if (!passesTextlineFilters(tl, query)) continue;

        const nameLower = n.toLowerCase();
        const ownerIdLower = tl.owner.toLowerCase();
        const ownerDisplay = speakers[tl.owner] && speakers[tl.owner].name;
        const ownerDisplayLower = ownerDisplay ? ownerDisplay.toLowerCase() : '';

        // Combined haystack for negative substring matching. Mirrors
        // the surfaces the positive tier matcher already considers,
        // so ``-zeus`` excludes every candidate the user can SEE Zeus
        // referenced on (name or owner).
        let negHit = false;
        if (negative.length || negativePhrases.length) {
            const negHay = nameLower + '\n' + ownerIdLower + '\n' + ownerDisplayLower;
            for (const t of negative) {
                if (t && negHay.includes(t)) { negHit = true; break; }
            }
            if (!negHit) {
                for (const p of negativePhrases) {
                    if (p && negHay.includes(p)) { negHit = true; break; }
                }
            }
        }
        if (negHit) continue;

        const candidateTokens = (nameTokens && nameTokens.get(n)) || [];
        const keywordSet = (nameKeywords && nameKeywords.get(n)) || null;
        // Gappy subsequence recall only applies to single-token queries
        // (a concatenated string like ``hadesaboutrenovations``); multi
        // token queries already bridge gaps via per-token PascalCase
        // boundary matching, so leaving segments unset keeps them strict.
        const nameSegs = positive.length === 1
            ? (nameSegments && nameSegments.get(n)) || null
            : null;

        const weightedTiers = [];
        let allMatched = true;
        for (let i = 0; i < positive.length; i++) {
            const r = rankSearchToken(positive[i], n, nameLower, ownerIdLower, ownerDisplayLower, nameSegs, keywordSet);
            if (r < 0) { allMatched = false; break; }
            const w = useIdf
                ? candidateTokenWeight(nameIdf, candidateTokens, positive[i])
                : 1;
            weightedTiers.push(r * w);
        }
        if (allMatched) ranked.push({ name: n, weightedTiers });
    }
    ranked.sort((a, b) => {
        const len = a.weightedTiers.length;
        for (let i = 0; i < len; i++) {
            const diff = a.weightedTiers[i] - b.weightedTiers[i];
            if (diff !== 0) return diff;
        }
        return 0;
    });
    return ranked.slice(0, limit);
}
