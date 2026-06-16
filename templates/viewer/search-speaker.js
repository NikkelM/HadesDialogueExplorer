// Speaker-based search ranking.
//
// Mirrors ``search-name.js`` but ranks speakers from the per-game
// ``speakers`` map (friendly name + internal id) instead of textlines.
// The dropdown's third results section (``#search-speakers-list``)
// renders the top matches and commits via ``navigateToSpeaker``.
//
// Kept simple: speakers are a finite-sized set (~65 H1 / ~89 H2) so we
// don't need an IDF index, a tier table, or any of the other
// per-textline ranking machinery. Tier comparison alone (start of
// friendly name beats start of id, beats word-boundary, beats
// substring) is enough to produce intuitive ordering for the few
// dozen names per game.

import { speakers } from './data.js';
import { passesSpeakerFilters } from './query-filters.js';
import { listCanonicalSpeakerIds, speakerGroupMembers } from './speaker-groups.js';

// Per-active-game cache: ``[{id, friendlyLower, idLower, tokens}]``.
// Rebuilt on every game switch via ``buildSpeakerIndex``. Stored as a
// flat array (not a Map) because every query has to iterate the whole
// list anyway.
let speakerIndex = [];

// Tokenise a friendly speaker name on whitespace + bracketed-suffix
// boundaries. ``"Megaera (Boss)"`` -> ``["megaera", "boss"]`` so a
// search for ``boss`` ranks Megaera (Boss) over an arbitrary other
// speaker that just happens to contain those letters. Empty / falsy
// returns an empty array.
export function tokeniseSpeakerLabel(label) {
    if (!label) return [];
    return label.toLowerCase().split(/[\s()/\-]+/).filter(t => t.length > 0);
}

// Tokenise a speaker internal id. ``"NPC_FurySister_01"`` ->
// ``["npc", "furysister", "01"]``. Splits on non-word characters
// only (NOT on PascalCase boundaries) so ``furysister`` stays a
// single token: the substring matcher handles ``fury`` /
// ``sister`` mid-typing.
export function tokeniseSpeakerId(id) {
    if (!id) return [];
    return id.toLowerCase().split(/[^a-z0-9]+/i).filter(t => t.length > 0);
}

// Build the per-active-game speaker search index. One entry per
// canonical group id (members with the same friendly name collapse;
// see ``speaker-groups.js`` for the rule). Every member id's tokens
// are folded into the same entry so a search for any member id
// (``HermesUpgradeRare``) still resolves to the same group as a
// search for the friendly name (``Hermes``).
export function buildSpeakerIndex() {
    speakerIndex = [];
    for (const id of listCanonicalSpeakerIds()) {
        const entry = speakers[id] || {};
        const friendly = entry.name || id;
        const friendlyLower = friendly.toLowerCase();
        const idLower = id.toLowerCase();
        const tokens = new Set([
            ...tokeniseSpeakerLabel(friendly),
            ...tokeniseSpeakerId(id),
        ]);
        // Also include every other member id's tokens so users can
        // type any of the underlying internal ids (or any of its
        // word-boundary tokens) and still hit the group's single
        // dropdown row.
        for (const mid of speakerGroupMembers(id)) {
            if (mid === id) continue;
            for (const t of tokeniseSpeakerId(mid)) tokens.add(t);
        }
        speakerIndex.push({ id, friendly, friendlyLower, idLower, tokens });
    }
}

// Tier ranking for one query token against one speaker. Lower is
// better; -1 means no match. Mirrors the textline tier shape so the
// ranker behaves predictably for users coming from the name search:
//
//   0 = token at start of friendly name
//   1 = token at start of internal id
//   2 = token at a word boundary in the friendly name
//   3 = token anywhere else in the friendly name
//   4 = token anywhere else in the internal id
export function rankSpeakerToken(token, speaker) {
    const t = token.toLowerCase();
    if (speaker.friendlyLower.startsWith(t)) return 0;
    if (speaker.idLower.startsWith(t)) return 1;
    if (speaker.tokens.has(t)) return 2;
    if (speaker.friendlyLower.includes(t)) return 3;
    if (speaker.idLower.includes(t)) return 4;
    return -1;
}

// Compute ranked speaker matches for a structured query. Honours the
// positive-token AND semantics, negative-token rejection, and the
// shared ``speaker:`` / ``-speaker:`` filter operators (so the
// filters work consistently across all three search sections).
// ``section:`` filters are intentionally NOT applied here - they
// scope to per-textline sections, not to speakers.
export function searchSpeakerMatches(query, limit) {
    const positive = (query && query.positive) || [];
    const negative = (query && query.negative) || [];
    const negativePhrases = (query && query.negativePhrases) || [];

    const ranked = [];
    for (const speaker of speakerIndex) {
        if (!passesSpeakerFilters(speaker.id, query)) continue;

        const negHay = `${speaker.friendlyLower}\n${speaker.idLower}`;
        let negHit = false;
        for (const t of negative) {
            if (t && negHay.includes(t)) { negHit = true; break; }
        }
        if (!negHit) {
            for (const p of negativePhrases) {
                if (p && negHay.includes(p)) { negHit = true; break; }
            }
        }
        if (negHit) continue;

        const tiers = [];
        let allMatched = true;
        for (const tok of positive) {
            const r = rankSpeakerToken(tok, speaker);
            if (r < 0) { allMatched = false; break; }
            tiers.push(r);
        }
        if (!allMatched) continue;
        // Filter-only queries (no positive tokens) pass every speaker
        // through with an empty tier tuple; the alphabetical
        // fall-through then orders them by id.
        ranked.push({ id: speaker.id, friendly: speaker.friendly, tiers });
    }

    ranked.sort((a, b) => {
        const len = a.tiers.length;
        for (let i = 0; i < len; i++) {
            const diff = a.tiers[i] - b.tiers[i];
            if (diff !== 0) return diff;
        }
        return a.id.localeCompare(b.id);
    });

    return ranked.slice(0, limit);
}
