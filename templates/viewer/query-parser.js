// Search-bar query parser.
//
// Turns a raw input string into a structured query that the
// downstream name- and text-search engines can consume. Supports a
// small, fixed operator vocabulary:
//
//   "exact phrase"          - phrase must appear contiguous (text
//                             search only; for names every phrase
//                             token degenerates to a positive token).
//   -word / -"phrase"       - hard exclusion: candidates containing
//                             the word/phrase are dropped.
//   speaker:X               - restrict to textlines whose owner OR
//                             any per-line speaker matches X
//                             (substring, case-insensitive, matches
//                             both internal id and friendly name).
//   -speaker:X              - exclude candidates that match X under
//                             the same union semantics.
//   section:X               - restrict by section. Matches both the
//                             internal key (e.g.
//                             ``GiftTextLineSets``) and the friendly
//                             label (``Gift``) from
//                             ``sectionKeyLabels``.
//   -section:X              - exclude by section.
//   bare word               - positive token, feeds the existing
//                             IDF / tier ranking. Bare words from
//                             a phrase ALSO contribute as positive
//                             tokens so phrase matches benefit from
//                             the same ranking signal as their
//                             constituent words.
//
// Filter semantics:
//   - Multiple positive ``speaker:`` (or ``section:``) filters are
//     OR within the same key (matches any of them).
//   - Multiple negative filters are AND (excludes ALL of them).
//   - Filter values are lowercased; matching is substring.
//
// Tokenisation rules:
//   - Walks char-by-char so unmatched quotes degrade gracefully
//     (the open quote is consumed and the remaining tail is taken
//     verbatim as a single phrase ending at EOL).
//   - ``key:`` recognised only when ``key`` is one of the registered
//     filter keys; anything else (e.g. ``url:foo``) is parsed as
//     a literal bare token so the search bar never silently swallows
//     intent.
//   - ``key:""`` and ``key:`` (empty value) are ignored - they carry
//     no information.
//   - Lone ``-`` is treated as a literal bare token.

// Filter keys recognised by the parser. Anything else gets parsed
// as a literal bare token so the user always sees their input
// reflected in the dropdown.
const FILTER_KEYS = new Set(['speaker', 'section']);

// Empty-query sentinel. Re-used by callers so they don't have to
// repeat the empty-object boilerplate when the input is blank.
export function emptyQuery() {
    return {
        positive: [],
        negative: [],
        phrases: [],
        negativePhrases: [],
        speakers: [],
        negativeSpeakers: [],
        sections: [],
        negativeSections: [],
    };
}

// Walk the raw query string and emit a flat list of lexed atoms.
// Each atom is one of:
//   { negate: bool, key: 'speaker'|'section'|null, value: string,
//     phrase: bool }
//
// ``key`` is set when the atom is a filter (``speaker:X`` /
// ``section:X``); otherwise null. ``phrase`` distinguishes
// ``"my voice"`` (true) from a bare word (false) - filters with
// quoted values inherit ``phrase: false`` because the quoting is
// only used to allow whitespace inside the value, not to invoke
// phrase semantics.
function lex(raw) {
    const atoms = [];
    const text = raw || '';
    let i = 0;
    const len = text.length;

    while (i < len) {
        // Skip leading whitespace between atoms.
        while (i < len && /\s/.test(text[i])) i++;
        if (i >= len) break;

        // Detect leading negation.
        let negate = false;
        if (text[i] === '-' && i + 1 < len && !/\s/.test(text[i + 1])) {
            // ``-`` must be followed by a non-space character to be a
            // negation marker. Lone ``-`` falls through to the bare
            // token branch.
            negate = true;
            i++;
        }

        // Try to read a ``key:`` prefix. Only consume when the key
        // is registered AND a colon follows; otherwise rewind so the
        // characters get parsed as a normal token.
        let key = null;
        const saveI = i;
        let j = i;
        while (j < len && /[a-zA-Z]/.test(text[j])) j++;
        if (j > i && j < len && text[j] === ':') {
            const candidate = text.slice(i, j).toLowerCase();
            if (FILTER_KEYS.has(candidate)) {
                key = candidate;
                i = j + 1;
            }
        }
        if (!key) i = saveI;

        // Read the value: either a quoted phrase or a bare run of
        // non-whitespace characters. Closing quote may be missing -
        // the tail of the string is then taken verbatim, which keeps
        // the parser tolerant of mid-typing input.
        let value = '';
        let isPhrase = false;
        if (i < len && text[i] === '"') {
            isPhrase = true;
            i++;
            const start = i;
            while (i < len && text[i] !== '"') i++;
            value = text.slice(start, i);
            if (i < len && text[i] === '"') i++;
        } else {
            const start = i;
            while (i < len && !/\s/.test(text[i])) i++;
            value = text.slice(start, i);
        }

        // A lone ``-`` (negate=true, value='') is reinterpreted as a
        // literal bare token so the user's input is preserved.
        if (negate && value === '' && !key) {
            atoms.push({ negate: false, key: null, value: '-', phrase: false });
            continue;
        }

        // Empty filter values (``speaker:`` with nothing after) carry
        // no information - drop them silently.
        if (key && value === '') continue;

        // Empty quoted phrase (``""``) similarly carries nothing -
        // drop it so it doesn't pollute the structured query.
        if (!key && value === '' && isPhrase) continue;

        // Fallback for the rare case where the lexer skipped past a
        // negation marker but found nothing usable.
        if (value === '') continue;

        atoms.push({
            negate,
            key,
            value: value.toLowerCase(),
            phrase: isPhrase,
        });
    }
    return atoms;
}

// Public parser. Lexes the raw input and routes each atom into the
// right bucket of the structured query. Phrase contents are also
// pushed into ``positive`` so the existing IDF ranking has the same
// token signal whether the user quoted the phrase or not - the
// quoting only adds the hard contiguous-match filter on top.
export function parseQuery(raw) {
    const q = emptyQuery();
    const atoms = lex(raw);
    for (const a of atoms) {
        if (a.key === 'speaker') {
            (a.negate ? q.negativeSpeakers : q.speakers).push(a.value);
            continue;
        }
        if (a.key === 'section') {
            (a.negate ? q.negativeSections : q.sections).push(a.value);
            continue;
        }
        // No filter key - either a phrase or a bare token.
        if (a.phrase) {
            (a.negate ? q.negativePhrases : q.phrases).push(a.value);
            // Bare-word contents of the phrase ALSO drive ranking
            // when positive. Negative phrases do not contribute to
            // the negative-token list because the per-phrase
            // contiguous-match filter is strictly stronger than the
            // per-word filter would be (a candidate excluded by the
            // phrase isn't also excluded for containing any single
            // word of it).
            if (!a.negate) {
                for (const t of a.value.split(/\s+/)) {
                    if (t) q.positive.push(t);
                }
            }
        } else {
            (a.negate ? q.negative : q.positive).push(a.value);
        }
    }
    return q;
}

// Convenience: does the query carry any signal that the search
// engines should run? Used by ``search-ui.js`` to decide between
// "show nothing" and "run searches" when the user has typed e.g.
// only a stray hyphen.
export function isQueryEmpty(q) {
    return (
        q.positive.length === 0
        && q.phrases.length === 0
        && q.negative.length === 0
        && q.negativePhrases.length === 0
        && q.speakers.length === 0
        && q.negativeSpeakers.length === 0
        && q.sections.length === 0
        && q.negativeSections.length === 0
    );
}
