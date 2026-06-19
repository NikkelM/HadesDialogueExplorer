// Cross-game search.
//
// The active search engines (``search-name`` / ``search-text`` /
// ``search-speaker``) only ever see the active game - their indices are
// rebuilt per game on toggle. This module surfaces matches from the
// OTHER game so a user in the Hades view who types a Hades II-only name,
// line, or speaker still finds it, shown under clearly-labelled sections
// at the bottom of the dropdown (see ``search-ui.js``).
//
// Design: a lightweight, un-indexed query against ``games[otherId]``'s
// blob - no second IDF index is built (that would double the per-toggle
// rebuild cost). Results are capped to a handful, so even the text scan
// (which walks the other game's dialogue lines) stays cheap behind the
// existing keystroke debounce. The matching primitives are the same
// pure helpers the active engines use, so name/text match semantics
// stay consistent across games.
//
// Advanced ``speaker:`` / ``section:`` filter operators are NOT applied
// cross-game (they're an active-game affordance, and the filter helpers
// resolve labels against the active bindings); a filtered query simply
// shows no cross-game section.

import { games, gameIds, gameLabels, getActiveGame } from './data.js';
import { rankSearchToken } from './search-name.js';
import { findWordPositions, buildSnippetHtml, phraseExistsInLine, textlineHasNegativeContent } from './search-text.js';
import { tokeniseSpeakerLabel, tokeniseSpeakerId, rankSpeakerToken } from './search-speaker.js';

// The id of the game that is NOT currently active. The dataset ships
// exactly two games, so this is "the other one"; returns null when only
// one game is loaded (single-game fixtures) so callers can skip cleanly.
export function otherGameId(active = getActiveGame()) {
    if (!gameIds) return null;
    return gameIds.find((g) => g !== active) || null;
}

// True when the query carries any speaker:/section: filter clause. Such
// queries skip the cross-game section (see module header).
function hasFilterClauses(query) {
    return (query.speakers && query.speakers.length > 0)
        || (query.sections && query.sections.length > 0)
        || (query.negativeSpeakers && query.negativeSpeakers.length > 0)
        || (query.negativeSections && query.negativeSections.length > 0);
}

function ownerLabel(speakers, ownerId) {
    const entry = speakers[ownerId];
    return (entry && entry.name) ? entry.name : (ownerId || '');
}

function sectionLabel(sectionKeyLabels, key) {
    return sectionKeyLabels[key] || key || '';
}

// Negative substring exclusion against a textline's name + owner, mirror
// of the active name search's negative handling.
function nameNegativeHit(nameLower, ownerIdLower, ownerDisplayLower, negative, negativePhrases) {
    if (negative.length === 0 && negativePhrases.length === 0) return false;
    const hay = `${nameLower}\n${ownerIdLower}\n${ownerDisplayLower}`;
    for (const t of negative) {
        if (t && hay.includes(t)) return true;
    }
    for (const p of negativePhrases) {
        if (p && hay.includes(p)) return true;
    }
    return false;
}

// Rank the other game's textline NAMES for the query. Every positive
// token must match (same per-token tier ladder as the active name
// search, via the shared ``rankSearchToken``); candidates are ordered by
// summed tier then alphabetically. IDF weighting is intentionally
// skipped - this is a capped secondary section, not the primary ranked
// surface. Returns ``{ gameId, gameLabel, matches: [{name, ownerLabel,
// sectionLabel}] }`` or null when there is no other game, the query
// carries filters, or there is no positive signal.
export function searchCrossGameNames(query, limit) {
    const active = getActiveGame();
    const otherId = otherGameId(active);
    if (!otherId) return null;
    if (hasFilterClauses(query)) return null;

    const positive = (query && query.positive) || [];
    const negative = (query && query.negative) || [];
    const negativePhrases = (query && query.negativePhrases) || [];
    if (positive.length === 0) return null;

    const gd = games[otherId] || {};
    const textlines = gd.textlines || {};
    const speakers = gd.speakers || {};
    const sectionKeyLabels = gd.sectionKeyLabels || {};

    const ranked = [];
    for (const name of Object.keys(textlines)) {
        const tl = textlines[name];
        if (!tl) continue;
        const nameLower = name.toLowerCase();
        const ownerIdLower = (tl.owner || '').toLowerCase();
        const ownerDisplay = speakers[tl.owner] && speakers[tl.owner].name;
        const ownerDisplayLower = ownerDisplay ? ownerDisplay.toLowerCase() : '';

        if (nameNegativeHit(nameLower, ownerIdLower, ownerDisplayLower, negative, negativePhrases)) continue;

        let tierSum = 0;
        let allMatched = true;
        for (const tok of positive) {
            const r = rankSearchToken(tok, name, nameLower, ownerIdLower, ownerDisplayLower);
            if (r < 0) { allMatched = false; break; }
            tierSum += r;
        }
        if (!allMatched) continue;
        ranked.push({
            name,
            tier: tierSum,
            ownerLabel: ownerLabel(speakers, tl.owner),
            sectionLabel: sectionLabel(sectionKeyLabels, tl.section),
        });
    }
    if (ranked.length === 0) return null;
    ranked.sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name));
    return {
        gameId: otherId,
        gameLabel: gameLabels[otherId] || otherId,
        matches: ranked.slice(0, limit).map((m) => ({
            name: m.name,
            ownerLabel: m.ownerLabel,
            sectionLabel: m.sectionLabel,
        })),
    };
}

// Find the first dialogue line of ``tl`` on which every positive token
// occurs as a whole word and every phrase occurs contiguously. Returns
// ``{ snippetHtml }`` for that line (highlighted via the shared snippet
// builder) or null when no single line satisfies the query. Requiring
// all tokens on one line is slightly stricter than the active text
// engine (which ranks partial matches) but keeps this capped secondary
// section free of weak hits.
function firstLineSnippet(tl, positive, phrases) {
    const lines = tl.dialogueLines;
    if (!Array.isArray(lines)) return null;
    for (const line of lines) {
        if (!line || !line.text) continue;
        const lower = line.text.toLowerCase();
        const positionsByToken = positive.map((t) => findWordPositions(lower, t));
        if (positionsByToken.some((p) => p.length === 0)) continue;
        let phrasesOk = true;
        for (const p of phrases) {
            if (!phraseExistsInLine(lower, p)) { phrasesOk = false; break; }
        }
        if (!phrasesOk) continue;
        const anchor = positionsByToken[0][0];
        return { snippetHtml: buildSnippetHtml(line.text, positive, positionsByToken, anchor) };
    }
    return null;
}

// Scan the other game's dialogue lines for textlines matching the query
// (all positive tokens on a single line + all phrases, minus any
// negative-content textline). ``excludeNames`` skips names already shown
// in the cross-game NAME section so the dropdown stays free of
// duplicates. Capped at ``limit`` - the scan early-exits once the cap is
// reached. Returns ``{ gameId, gameLabel, matches: [{name, ownerLabel,
// sectionLabel, snippetHtml}] }`` or null when nothing matches.
export function searchCrossGameText(query, excludeNames, limit) {
    const active = getActiveGame();
    const otherId = otherGameId(active);
    if (!otherId) return null;
    if (hasFilterClauses(query)) return null;

    const positive = (query && query.positive) || [];
    const phrases = (query && query.phrases) || [];
    const negative = (query && query.negative) || [];
    const negativePhrases = (query && query.negativePhrases) || [];
    if (positive.length === 0 && phrases.length === 0) return null;

    const gd = games[otherId] || {};
    const textlines = gd.textlines || {};
    const speakers = gd.speakers || {};
    const sectionKeyLabels = gd.sectionKeyLabels || {};

    const matches = [];
    for (const name of Object.keys(textlines).sort()) {
        if (matches.length >= limit) break;
        if (excludeNames && excludeNames.has(name)) continue;
        const tl = textlines[name];
        if (!tl) continue;
        if (textlineHasNegativeContent(tl, negative, negativePhrases)) continue;
        const hit = firstLineSnippet(tl, positive, phrases);
        if (!hit) continue;
        matches.push({
            name,
            ownerLabel: ownerLabel(speakers, tl.owner),
            sectionLabel: sectionLabel(sectionKeyLabels, tl.section),
            snippetHtml: hit.snippetHtml,
        });
    }
    if (matches.length === 0) return null;
    return {
        gameId: otherId,
        gameLabel: gameLabels[otherId] || otherId,
        matches,
    };
}

// Build canonical speaker search entries for an arbitrary speakers map,
// mirroring speaker-groups.js: ids are bucketed by trimmed friendly name
// (empty names stay singletons) and the canonical id is the
// alphabetically-first member, so the dropdown shows one row per group
// (e.g. one "Hermes", not three). Every member id's tokens are folded
// into the group's token set so typing any member id still matches.
// Returns ``[{id, friendly, friendlyLower, idLower, tokens}]`` in the
// shape ``rankSpeakerToken`` expects.
function buildOtherSpeakerIndex(speakers) {
    const byName = new Map();
    const groups = [];
    for (const sid of Object.keys(speakers)) {
        const name = ((speakers[sid] && speakers[sid].name) || '').trim();
        if (!name) { groups.push([sid, [sid]]); continue; }
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(sid);
    }
    for (const [, members] of byName) {
        members.sort();
        groups.push([members[0], members]);
    }
    return groups.map(([canon, members]) => {
        const friendly = (speakers[canon] && speakers[canon].name) || canon;
        const tokens = new Set([...tokeniseSpeakerLabel(friendly), ...tokeniseSpeakerId(canon)]);
        for (const mid of members) {
            if (mid === canon) continue;
            for (const t of tokeniseSpeakerId(mid)) tokens.add(t);
        }
        return { id: canon, friendly, friendlyLower: friendly.toLowerCase(), idLower: canon.toLowerCase(), tokens };
    });
}

// Rank the other game's SPEAKERS for the query. Mirrors the active
// speaker search (every positive token must match via the shared
// ``rankSpeakerToken`` tier ladder; negative tokens reject) but over a
// freshly-built index of the other game's canonical speaker groups - the
// per-game set is tiny (~65-90 speakers) so an un-cached per-keystroke
// build is negligible. Returns ``{ gameId, gameLabel, matches: [{id,
// friendly}] }`` or null when there is no other game, the query carries
// filters, or there is no positive signal.
export function searchCrossGameSpeakers(query, limit) {
    const active = getActiveGame();
    const otherId = otherGameId(active);
    if (!otherId) return null;
    if (hasFilterClauses(query)) return null;

    const positive = (query && query.positive) || [];
    const negative = (query && query.negative) || [];
    const negativePhrases = (query && query.negativePhrases) || [];
    if (positive.length === 0) return null;

    const gd = games[otherId] || {};
    const index = buildOtherSpeakerIndex(gd.speakers || {});

    const ranked = [];
    for (const sp of index) {
        const negHay = `${sp.friendlyLower}\n${sp.idLower}`;
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
            const r = rankSpeakerToken(tok, sp);
            if (r < 0) { allMatched = false; break; }
            tiers.push(r);
        }
        if (!allMatched) continue;
        ranked.push({ id: sp.id, friendly: sp.friendly, tiers });
    }
    if (ranked.length === 0) return null;
    ranked.sort((a, b) => {
        const len = a.tiers.length;
        for (let i = 0; i < len; i++) {
            const diff = a.tiers[i] - b.tiers[i];
            if (diff !== 0) return diff;
        }
        return a.id.localeCompare(b.id);
    });
    return {
        gameId: otherId,
        gameLabel: gameLabels[otherId] || otherId,
        matches: ranked.slice(0, limit).map((m) => ({ id: m.id, friendly: m.friendly })),
    };
}

