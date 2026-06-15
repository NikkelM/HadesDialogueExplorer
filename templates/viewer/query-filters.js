// Shared filter predicates for the search engines.
//
// Both ``search-name.js`` and ``search-text.js`` need to apply the
// structured query's ``speaker:`` / ``section:`` filter sets to
// candidate textlines. The predicates live here so the matching
// semantics stay identical between the two engines - any change to
// what "speaker matches" means automatically applies to both result
// sections in the dropdown.
//
// Match semantics (asymmetric on purpose):
//   - Positive filters (``speaker:X`` / ``section:X``) match if X
//     is a PREFIX of any haystack token (or equals any full
//     identifier). Forgiving for mid-typing input - ``speaker:meg``
//     finds Megaera, ``section:gif`` finds Gift.
//   - Negative filters (``-speaker:X`` / ``-section:X``) match only
//     on EXACT equality against a token or full identifier. Strict
//     because exclusion is destructive: substring or prefix would
//     turn ``-speaker:A`` into a corpus-wiping accident.
//
// Filter values are already lowercased by the parser, so token
// comparisons stay case-insensitive without re-lowercasing per
// call.

import { speakers, sectionKeyLabels } from './data.js';

// Split an identifier string into lowercase tokens for matching.
// Boundaries are whitespace, underscore, and parens - enough to
// cover both internal ids (``NPC_Zeus_01`` -> ``["npc", "zeus",
// "01"]``) and friendly names with optional disambiguator suffix
// (``"Hecate (Boss)"`` -> ``["hecate", "boss"]``).
function tokeniseIdentifier(s) {
    if (!s) return [];
    return s.toLowerCase().split(/[\s_()]+/).filter((t) => t.length > 0);
}

// Build a list of ``{full, tokens}`` records for every identifier
// the speaker filter should consider against a textline:
//   - Owner internal id and friendly name.
//   - Every distinct per-line speaker (internal id + friendly).
//
// Each record carries the full lowercased identifier alongside its
// tokens so the exact-match branch of the matcher can accept e.g.
// ``-speaker:NPC_Zeus_01`` even though that string doesn't split
// into a single token. Per-call construction is fine - the engines
// already cache the result per textline across all query atoms.
function speakerIdentifiers(tl) {
    if (!tl) return [];
    const out = [];
    const seenFull = new Set();
    const push = (s) => {
        if (!s) return;
        const full = s.toLowerCase();
        if (seenFull.has(full)) return;
        seenFull.add(full);
        out.push({ full, tokens: tokeniseIdentifier(s) });
    };
    if (tl.owner) {
        push(tl.owner);
        const friendly = speakers[tl.owner] && speakers[tl.owner].name;
        if (friendly) push(friendly);
    }
    if (Array.isArray(tl.dialogueLines)) {
        for (const line of tl.dialogueLines) {
            if (!line || !line.speaker) continue;
            push(line.speaker);
            const friendly = speakers[line.speaker] && speakers[line.speaker].name;
            if (friendly) push(friendly);
        }
    }
    return out;
}

// Same shape for the section filter. Two identifiers: the internal
// section key (``GiftTextLineSets``) and the friendly label
// (``Gift``). Tokens on a CamelCase internal key split into one
// token (``gifttextlinesets``) - that's intentional, because we
// want ``-section:GiftTextLineSets`` to match exactly without also
// matching ``-section:Gift`` against the internal key. Friendly
// label tokens cover the natural-language match.
function sectionIdentifiers(tl) {
    if (!tl || !tl.section) return [];
    const out = [];
    const seenFull = new Set();
    const push = (s) => {
        if (!s) return;
        const full = s.toLowerCase();
        if (seenFull.has(full)) return;
        seenFull.add(full);
        out.push({ full, tokens: tokeniseIdentifier(s) });
    };
    push(tl.section);
    const label = sectionKeyLabels[tl.section];
    if (label) push(label);
    return out;
}

// Positive-filter predicate: returns true if ``filterValue`` is a
// prefix of any token in any identifier, OR equals any identifier's
// full lowercased form. Empty filter value never matches (defensive
// - the parser drops empties before reaching here).
function positiveMatches(idents, filterValue) {
    if (!filterValue) return false;
    for (const id of idents) {
        if (id.full === filterValue) return true;
        for (const t of id.tokens) {
            if (t.startsWith(filterValue)) return true;
        }
    }
    return false;
}

// Negative-filter predicate: strict equality. Matches only when
// ``filterValue`` EQUALS a token OR equals a full identifier. No
// prefix/substring forgiveness because exclusion is destructive
// (``-speaker:A`` would wipe most of the corpus under substring or
// prefix semantics).
function negativeMatches(idents, filterValue) {
    if (!filterValue) return false;
    for (const id of idents) {
        if (id.full === filterValue) return true;
        for (const t of id.tokens) {
            if (t === filterValue) return true;
        }
    }
    return false;
}

// Composite predicate built once per query. Returns true when the
// textline survives every filter clause:
//   - ``speakers`` (positive): the textline must match AT LEAST ONE
//     of the filter values under positive semantics (OR).
//   - ``negativeSpeakers``: the textline must match NONE of the
//     filter values under negative semantics (AND).
//   - ``sections`` / ``negativeSections``: same shape against the
//     section identifiers.
//
// Empty arrays short-circuit to "pass".
export function passesTextlineFilters(tl, query) {
    if (!tl) return false;
    if (query.speakers.length || query.negativeSpeakers.length) {
        const idents = speakerIdentifiers(tl);
        if (query.speakers.length && !query.speakers.some((v) => positiveMatches(idents, v))) return false;
        if (query.negativeSpeakers.some((v) => negativeMatches(idents, v))) return false;
    }
    if (query.sections.length || query.negativeSections.length) {
        const idents = sectionIdentifiers(tl);
        if (query.sections.length && !query.sections.some((v) => positiveMatches(idents, v))) return false;
        if (query.negativeSections.some((v) => negativeMatches(idents, v))) return false;
    }
    return true;
}
