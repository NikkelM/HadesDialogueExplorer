// Name-based search ranking.
//
// Pure functions that turn a tokenised query into ordered matches
// against the dataset's textline names + owner labels. Used by
// ``search-ui.js`` for the synchronous-on-every-keystroke top
// section of the dropdown.

import { textlines, allNames, speakers } from './data.js';

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
//
// Aggregate ranking compares the per-token tiers lexicographically so
// earlier query tokens dominate later ones. For ``Zeus with aphrodite``
// this means ``ZeusWithAphrodite01`` (tiers 0,2,2) outranks
// ``AphroditeWithZeus01`` (tiers 2,2,0) - the token the user typed first
// is treated as the most important one to satisfy strongly.
export function rankSearchToken(token, nameOriginal, nameLower, ownerIdLower, ownerDisplayLower) {
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
    return -1;
}

// Compute the ranked name matches for a tokenised query. Extracted
// so text and name search can share the same tokeniser and so the
// search code path stays small enough to read at a glance.
export function searchNameMatches(tokens, limit) {
    const ranked = [];
    for (const n of allNames) {
        const tl = textlines[n];
        if (!tl) continue;
        const nameLower = n.toLowerCase();
        const ownerIdLower = tl.owner.toLowerCase();
        const ownerDisplay = speakers[tl.owner]?.name;
        const ownerDisplayLower = ownerDisplay ? ownerDisplay.toLowerCase() : '';

        const tierTuple = [];
        let allMatched = true;
        for (const token of tokens) {
            const r = rankSearchToken(token, n, nameLower, ownerIdLower, ownerDisplayLower);
            if (r < 0) { allMatched = false; break; }
            tierTuple.push(r);
        }
        if (allMatched) ranked.push({ name: n, tiers: tierTuple });
    }
    ranked.sort((a, b) => {
        const len = a.tiers.length;
        for (let i = 0; i < len; i++) {
            const diff = a.tiers[i] - b.tiers[i];
            if (diff !== 0) return diff;
        }
        return 0;
    });
    return ranked.slice(0, limit);
}
