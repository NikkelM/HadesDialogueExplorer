// Search dropdown wiring: keystroke handling, debouncing, and result
// rendering. Synchronously runs the name search on every keystroke
// and debounces the text-content search behind a 120 ms timer so
// fast typing doesn't trigger N redundant scans. The raw input
// string is funnelled through ``parseQuery`` first so operators
// (``"phrase"``, ``-word``, ``speaker:X``, ``section:X``) are
// applied uniformly to both result sections.

import { textlines } from './data.js';
import { renderSpeakerHtml, renderSectionHtml, escapeHtml } from './utilities.js';
import { searchNameMatches } from './search-name.js';
import { searchTextLines, renderTextMatchHtml } from './search-text.js';
import { parseQuery, isQueryEmpty } from './query-parser.js';
import { navigateTo } from './navigation.js';

export function initSearch() {
    const searchInput = document.getElementById('search');
    const searchResults = document.getElementById('search-results');

    // Sequence counter used to discard stale debounced text-search
    // results when the user has already moved on to a newer query.
    let searchSeq = 0;
    let textSearchTimer = null;

    function hide() { searchResults.classList.remove('visible'); }

    function renderResults(query, nameMatches, textMatches) {
        if (nameMatches.length === 0 && textMatches.length === 0) {
            hide();
            return;
        }
        const showHeaders = nameMatches.length > 0 && textMatches.length > 0;
        const parts = [];
        if (showHeaders) {
            parts.push(`<div class="search-section-header">Name matches</div>`);
        }
        for (const m of nameMatches) {
            const tl = textlines[m.name];
            parts.push(`<div class="search-item" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}<span class="npc">${renderSpeakerHtml(tl.owner)} \u00B7 ${renderSectionHtml(tl.section)}</span></div>`);
        }
        if (textMatches.length > 0) {
            if (showHeaders) {
                parts.push(`<div class="search-section-header">Text matches</div>`);
            }
            for (const m of textMatches) {
                // ``renderTextMatchHtml`` highlights matched positive
                // tokens; phrase contents already live in
                // ``query.positive`` (seeded by the parser) so phrase
                // matches get highlighted without a separate code path.
                parts.push(renderTextMatchHtml(m, query.positive));
            }
        }
        searchResults.innerHTML = parts.join('');
        searchResults.classList.add('visible');
    }

    function onInput() {
        const seq = ++searchSeq;
        clearTimeout(textSearchTimer);

        const raw = searchInput.value;
        const query = parseQuery(raw);
        if (isQueryEmpty(query)) { hide(); return; }

        // Name search runs synchronously so the dropdown updates on
        // every keystroke without perceptible lag.
        const nameMatches = searchNameMatches(query, 30);
        renderResults(query, nameMatches, []);

        // Text content search is debounced because it scans every
        // dialogue line. A short delay coalesces fast keystrokes
        // without making the UI feel sluggish. Very short positive
        // signals (under 3 non-whitespace characters across positive
        // tokens + phrases) are skipped to avoid swamping the
        // dropdown with generic single-letter hits like ``a`` or
        // ``I``; ``I shall`` and similar still pass the gate.
        // Filter-only queries also short-circuit here - they carry
        // no text signal for the engine to rank or highlight.
        if (query.positive.length === 0 && query.phrases.length === 0) return;
        let signalLen = 0;
        for (const t of query.positive) signalLen += t.length;
        for (const p of query.phrases) signalLen += p.replace(/\s+/g, '').length;
        if (signalLen < 3) return;
        const nameMatchNames = new Set(nameMatches.map(m => m.name));
        textSearchTimer = setTimeout(() => {
            if (seq !== searchSeq) return;
            const textMatches = searchTextLines(query, nameMatchNames, 30);
            renderResults(query, nameMatches, textMatches);
        }, 120);
    }

    searchInput.addEventListener('input', onInput);

    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (item) {
            navigateTo(item.dataset.name);
            hide();
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = searchResults.querySelector('.search-item');
            if (first) {
                navigateTo(first.dataset.name);
                hide();
            }
        }
        if (e.key === 'Escape') hide();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) hide();
    });
}
