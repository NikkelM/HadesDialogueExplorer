// Text-content search engine.
//
// Scans the flattened dialogue-line index for word-boundary token
// matches, ranks by an IDF-weighted score then longest contiguous
// phrase, and renders highlighted snippets for the dropdown's lower
// section. Used by ``search-ui.js`` behind a 120 ms debounce because
// it touches every dialogue line.

import { textlines, allNames, choiceNames } from './data.js';
import { renderSpeakerHtml, renderSectionHtml, escapeHtml } from './utilities.js';
import { computeIdf, idfWeight } from './idf.js';

// Flattened index of every dialogue line for fast text-content search.
// Each entry: ``{name, lineIdx, speaker, textOriginal, textLower,
// isChoiceOption?}``. ``isChoiceOption`` is set for synthetic entries
// pushed for each player-facing choice button label so a search for
// "Lament" / "Go to Her" / etc. surfaces the parent prompt textline
// even though those words only appear on the button, not in the
// prompt text. Populated by :func:`buildLinesIndex` once during
// ``init()``.
export let linesIndex;

// Token -> IDF weight, computed over ``linesIndex`` once per
// rebuild. Used to weight multi-token query matches so a line
// containing a rare token outranks a line that only matches common
// ones for the same query. Kept module-level (rather than re-derived
// per keystroke) so per-keystroke ranking stays O(query-tokens
// * lines).
export let linesIdf;

// Tokenise a dialogue-line string into the same word units that the
// search matcher considers - runs of alphanumerics (per
// ``_isWordCharCode``), lowercased. Shared between IDF building and
// any future caller that needs the corpus tokenisation contract.
export function tokeniseLineText(textLower) {
    const tokens = [];
    const total = textLower.length;
    let start = -1;
    for (let i = 0; i < total; i++) {
        if (_isWordCharCode(textLower.charCodeAt(i))) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            tokens.push(textLower.slice(start, i));
            start = -1;
        }
    }
    if (start >= 0) tokens.push(textLower.slice(start));
    return tokens;
}

// Build the flat per-line search index from the loaded dataset.
// Called once during ``init()``. Storing the lowercased text once
// up-front avoids re-lowercasing on every keystroke. The IDF map is
// rebuilt alongside the index so the two always reflect the same
// corpus snapshot - a single export point keeps callers from
// accidentally consulting a stale weight map.
//
// For ``kind === 'choicePrompt'`` lines we also push one synthetic
// entry per choice option, using the friendly label from
// ``choiceNames`` (fallback: the raw internal id when no friendly
// label is registered). Those entries share the parent prompt's
// ``name`` / ``lineIdx`` so click-through still lands on the prompt
// row, and carry ``isChoiceOption: true`` so the renderer can
// substitute the speaker label with a ``Choice option:`` marker
// (the option has no real speaker - it's a player-facing button).
export function buildLinesIndex() {
    const out = [];
    for (const name of allNames) {
        const tl = textlines[name];
        if (!tl) continue;
        const lines = tl.dialogueLines;
        if (!lines || lines.length === 0) continue;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            if (line.text) {
                out.push({
                    name,
                    lineIdx: i,
                    speaker: line.speaker || '',
                    textOriginal: line.text,
                    textLower: line.text.toLowerCase(),
                });
            }
            if (line.kind === 'choicePrompt' && Array.isArray(line.choices)) {
                for (const c of line.choices) {
                    if (!c || !c.internal) continue;
                    const friendly = choiceNames[c.internal] || c.internal;
                    if (!friendly) continue;
                    out.push({
                        name,
                        lineIdx: i,
                        speaker: '',
                        isChoiceOption: true,
                        textOriginal: friendly,
                        textLower: friendly.toLowerCase(),
                    });
                }
            }
        }
    }
    linesIndex = out;
    linesIdf = computeIdf(out, (entry) => tokeniseLineText(entry.textLower));
}

// Test whether a character code is alphanumeric (a-z, A-Z, 0-9).
// Used to detect word boundaries for the text-content search so that
// ``I`` matches the word ``I`` (and ``I`` in ``I'm``, where ``'`` is
// non-word) but not the letter ``i`` inside ``his``.
export function _isWordCharCode(code) {
    return (code >= 97 && code <= 122)
        || (code >= 65 && code <= 90)
        || (code >= 48 && code <= 57);
}

// Find every position where ``token`` appears as a whole word in
// ``textLower``. A position qualifies when neither the character
// immediately before nor immediately after is alphanumeric.
export function findWordPositions(textLower, token) {
    const positions = [];
    const tlen = token.length;
    if (tlen === 0) return positions;
    const total = textLower.length;
    let i = 0;
    while ((i = textLower.indexOf(token, i)) !== -1) {
        const beforeOk = i === 0 || !_isWordCharCode(textLower.charCodeAt(i - 1));
        const after = i + tlen;
        const afterOk = after >= total || !_isWordCharCode(textLower.charCodeAt(after));
        if (beforeOk && afterOk) positions.push(i);
        i += 1;
    }
    return positions;
}

// Check whether ``phraseTokens`` occur as a contiguous phrase starting
// at any of the supplied first-token positions. Adjacent tokens must
// be separated by at least one non-word character (whitespace,
// punctuation) - no other words may sit between them. Returns the
// start position of the first match, or -1 if no occurrence is found.
//
// Note: ``firstTokenPositions`` are expected to be ``findWordPositions``
// hits for ``phraseTokens[0]`` so the leading word-boundary check is
// already satisfied.
export function findContiguousPhrasePosition(textLower, phraseTokens, firstTokenPositions) {
    if (phraseTokens.length === 0) return -1;
    if (phraseTokens.length === 1) {
        return firstTokenPositions.length > 0 ? firstTokenPositions[0] : -1;
    }
    const total = textLower.length;
    for (const startPos of firstTokenPositions) {
        let cursor = startPos + phraseTokens[0].length;
        let ok = true;
        for (let j = 1; j < phraseTokens.length; j++) {
            // Skip the non-word characters separating adjacent tokens.
            while (cursor < total && !_isWordCharCode(textLower.charCodeAt(cursor))) cursor++;
            if (cursor >= total) { ok = false; break; }
            const tj = phraseTokens[j];
            if (!textLower.startsWith(tj, cursor)) { ok = false; break; }
            const after = cursor + tj.length;
            if (after < total && _isWordCharCode(textLower.charCodeAt(after))) { ok = false; break; }
            cursor = after;
        }
        if (ok) return startPos;
    }
    return -1;
}

// Scan the dialogue-line index for entries where at LEAST ONE search
// token appears as a whole word within the SAME line. Rank by the
// IDF-weighted sum of matched-token contributions (rare tokens
// dominate), then by the length of the longest contiguous run of
// query tokens (in original query order) that appears as a phrase in
// the line. A full-query run beats a partial run, which beats
// fully-scattered tokens. Ties preserve alphabetical order from
// ``allNames``. Returns at most ``limit`` matches, one per textline
// (the first matching line). ``excludeNames`` skips textlines
// already represented in the name-match section so the dropdown
// stays free of duplicates.
//
// Partial matching means a query like ``I think fdfsdfsdfs`` still
// surfaces lines containing ``I think`` even though the third token
// does not exist anywhere; lines that match all tokens always
// outrank lines that match a subset of the same query (every IDF
// weight is positive, so each additional matched token strictly
// increases the score).
//
// Stopword-only queries (every token is high-frequency) fall out of
// the weighted ranking the same way the old flat ranking would have
// resolved them - all tokens carry similar small weights, so the
// weighted sum's ordering collapses back to count order. No special
// fallback branch is needed.
//
// Single-token queries skip IDF entirely: there is only one possible
// weight, so the ordering relative to the existing scan order
// (alphabetical via ``allNames``) is preserved by scoring every
// match as 1.
export function searchTextLines(tokens, excludeNames, limit) {
    const N = tokens.length;
    const useIdf = N > 1 && linesIdf;
    const ranked = [];
    const seen = new Set();
    for (const entry of linesIndex) {
        if (excludeNames.has(entry.name)) continue;
        if (seen.has(entry.name)) continue;

        const positionsByToken = new Array(N);
        let matchedCount = 0;
        let score = 0;
        let firstMatchAnchor = -1;
        for (let i = 0; i < N; i++) {
            const positions = findWordPositions(entry.textLower, tokens[i]);
            positionsByToken[i] = positions;
            if (positions.length > 0) {
                matchedCount++;
                score += useIdf ? idfWeight(linesIdf, tokens[i]) : 1;
                if (firstMatchAnchor < 0) firstMatchAnchor = positions[0];
            }
        }
        if (matchedCount === 0) continue;

        // Find longest contiguous run. Subsequences whose first token
        // has no occurrences (or whose middle tokens are absent) are
        // naturally skipped by ``findContiguousPhrasePosition``
        // returning -1, so this loop handles partial matches without
        // any extra bookkeeping.
        let runLength = 1;
        let runAnchor = firstMatchAnchor;
        outer: for (let len = N; len >= 2; len--) {
            for (let start = 0; start + len <= N; start++) {
                const pos = findContiguousPhrasePosition(
                    entry.textLower,
                    tokens.slice(start, start + len),
                    positionsByToken[start],
                );
                if (pos >= 0) {
                    runLength = len;
                    runAnchor = pos;
                    break outer;
                }
            }
        }

        // Count adjacent query-token pairs that appear as a phrase
        // somewhere in the line. Two disjoint 2-runs (``[i think]
        // ... [and Eurydice]`` for query ``i think and eurydice``)
        // count as 2 pairs; a single 3-run (``[i think and]`` with
        // ``eurydice`` scattered) also counts as 2 pairs. The
        // ``runLength`` axis below then differentiates those - one
        // contiguous run of length K is preferred over disjoint runs
        // summing to the same pair count, since longer runs convey
        // more shared context.
        let adjacentPairs = 0;
        for (let i = 0; i + 1 < N; i++) {
            if (positionsByToken[i].length === 0 || positionsByToken[i + 1].length === 0) continue;
            const pos = findContiguousPhrasePosition(
                entry.textLower,
                [tokens[i], tokens[i + 1]],
                positionsByToken[i],
            );
            if (pos >= 0) adjacentPairs++;
        }

        seen.add(entry.name);
        ranked.push({ entry, matchedCount, score, adjacentPairs, runLength, runAnchor, positionsByToken });
    }

    // Stable sort: higher weighted score first, then more adjacent
    // query-token pairs matched as phrases, then longer single
    // contiguous runs, then alphabetical from the allNames-ordered
    // scan above.
    ranked.sort((a, b) => {
        const ds = b.score - a.score;
        if (ds !== 0) return ds;
        const dp = b.adjacentPairs - a.adjacentPairs;
        if (dp !== 0) return dp;
        return b.runLength - a.runLength;
    });
    return ranked.slice(0, limit);
}

// Render a single text-match dropdown row, including a highlighted
// snippet of the matched line. Click navigation reuses the standard
// ``data-name`` attribute consumed by ``initSearch``'s click handler.
// Choice-option entries (synthetic per-button rows pushed by
// :func:`buildLinesIndex` for ``choicePrompt`` lines) have no real
// speaker - the snippet is the player-facing button label - so the
// speaker prefix is swapped for a ``Choice option:`` marker.
export function renderTextMatchHtml(match, tokens) {
    const entry = match.entry;
    const tl = textlines[entry.name];
    const snippetHtml = buildSnippetHtml(
        entry.textOriginal,
        tokens,
        match.positionsByToken,
        match.runAnchor,
    );
    const prefixHtml = entry.isChoiceOption
        ? `<span class="snippet-choice-label">Choice option:</span>`
        : `<span class="snippet-speaker">${renderSpeakerHtml(entry.speaker)}:</span>`;
    return `<div class="search-item search-item-text" data-name="${escapeHtml(entry.name)}"><div class="search-item-head">${escapeHtml(entry.name)}<span class="npc">${renderSpeakerHtml(tl.owner)} \u00B7 ${renderSectionHtml(tl.section)}</span></div><div class="search-snippet">${prefixHtml} ${snippetHtml}</div></div>`;
}

// Build the highlighted-snippet HTML for a single matched dialogue
// line. Every word-boundary occurrence of every token visible within
// the snippet window is wrapped in ``<mark>``. The window is
// anchored ~60 chars before ``anchorPos`` (the start of the longest
// contiguous run when one exists, otherwise the first token match)
// and extends ~140 chars after.
export function buildSnippetHtml(textOriginal, tokens, positionsByToken, anchorPos) {
    const matches = [];
    for (let i = 0; i < tokens.length; i++) {
        const tlen = tokens[i].length;
        for (const pos of positionsByToken[i]) {
            matches.push({ start: pos, end: pos + tlen });
        }
    }
    if (matches.length === 0) return escapeHtml(textOriginal);
    matches.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const m of matches) {
        const last = merged[merged.length - 1];
        if (last && m.start <= last.end) {
            last.end = Math.max(last.end, m.end);
        } else {
            merged.push({ start: m.start, end: m.end });
        }
    }
    const SNIPPET_BEFORE = 60;
    const SNIPPET_AFTER = 140;
    const anchor = (typeof anchorPos === 'number' && anchorPos >= 0)
        ? anchorPos
        : merged[0].start;
    const winStart = Math.max(0, anchor - SNIPPET_BEFORE);
    const winEnd = Math.min(textOriginal.length, anchor + SNIPPET_AFTER);

    let html = '';
    let cursor = winStart;
    for (const m of merged) {
        if (m.start >= winEnd) break;
        if (m.end <= winStart) continue;
        const segStart = Math.max(m.start, winStart);
        const segEnd = Math.min(m.end, winEnd);
        if (segStart > cursor) {
            html += escapeHtml(textOriginal.slice(cursor, segStart));
        }
        html += `<mark>${escapeHtml(textOriginal.slice(segStart, segEnd))}</mark>`;
        cursor = segEnd;
    }
    if (cursor < winEnd) {
        html += escapeHtml(textOriginal.slice(cursor, winEnd));
    }
    if (winStart > 0) html = '\u2026' + html;
    if (winEnd < textOriginal.length) html = html + '\u2026';
    return html;
}
