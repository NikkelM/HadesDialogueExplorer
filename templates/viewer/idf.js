// Inverse-document-frequency (IDF) utility for search ranking.
//
// Shared between the text-content search (``search-text.js``, scans
// dialogue lines) and the name-match search (``search-name.js``,
// scans textline names + owner labels). Both surfaces use the same
// smoothing formula so weights compare consistently when ranking
// across the two corpora.
//
// Smoothing formula:
//
//   weight(t) = log((M + 1) / (N + 1)) + 1
//
// where M = number of documents and N = number of documents
// containing token ``t``. The ``+1`` smoothing keeps the formula
// well-defined for absent tokens (lookup falls back to a "never seen"
// weight) and bounded for tokens that appear in every document
// (weight = 1.0). All weights are strictly positive so callers can
// multiply by them without special-casing stopwords.

// Compute the IDF map for a corpus of documents.
//
// ``documents`` is an iterable of opaque inputs - the caller supplies
// ``tokeniserFn(doc)`` to turn each document into the array of tokens
// that should count towards document frequency. Duplicates within a
// single document are collapsed (a token contributes 1 to its
// document-frequency regardless of how many times it appears in the
// same document) by passing the per-doc tokens through a ``Set``.
//
// Returns a ``Map`` from lowercased token to weight. Tokenisation is
// the caller's responsibility - the tokeniser is expected to return
// already-lowercased strings.
export function computeIdf(documents, tokeniserFn) {
    const docFreq = new Map();
    let total = 0;
    for (const doc of documents) {
        total++;
        const seen = new Set(tokeniserFn(doc));
        for (const t of seen) {
            docFreq.set(t, (docFreq.get(t) || 0) + 1);
        }
    }
    const idf = new Map();
    for (const [t, n] of docFreq) {
        idf.set(t, Math.log((total + 1) / (n + 1)) + 1);
    }
    return idf;
}

// Look up a token's IDF weight, falling back to neutral weight 1.0
// for tokens absent from the corpus. Used as a generic last-resort
// lookup; prefer :func:`candidateTokenWeight` at call sites where a
// per-candidate token list is available, since that gives prefix
// queries (mid-typing) a sensible weight derived from the actual
// matched corpus token instead of an arbitrary constant.
//
// Neutral fallback (rather than the smoothed-formula upper bound)
// keeps absent tokens from dominating weighted scores - in the
// search-ranking use case, "absent from IDF" almost always means
// "user is mid-typing a prefix of a token that IS in the corpus",
// not "user typed something genuinely rare".
export function idfWeight(idfMap, token) {
    const w = idfMap.get(token);
    if (w !== undefined) return w;
    return 1;
}

// Look up a query token's IDF weight in the context of a single
// candidate's tokens. If the query token is in the IDF map, returns
// its weight directly. Otherwise (prefix typing, e.g. ``zeu`` when
// the corpus only contains ``zeus``) scans ``candidateTokens`` for
// tokens that start with the query token and returns the maximum
// weight among them - preserving the "rare placement dominates"
// behaviour for partial-token queries. Falls back to neutral 1.0 if
// no candidate token prefix-matches either (e.g. mid-segment
// substring query).
export function candidateTokenWeight(idfMap, candidateTokens, queryToken) {
    const w = idfMap.get(queryToken);
    if (w !== undefined) return w;
    let best = -Infinity;
    for (const t of candidateTokens) {
        if (t.startsWith(queryToken)) {
            const tw = idfMap.get(t);
            if (tw !== undefined && tw > best) best = tw;
        }
    }
    return best > -Infinity ? best : 1;
}
