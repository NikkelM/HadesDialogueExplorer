// Search dropdown wiring: keystroke handling, debouncing, and result
// rendering. Synchronously updates the name-match list on every
// keystroke and debounces the text-content search behind a 120 ms
// timer so fast typing doesn't trigger N redundant scans. The raw
// input string is funnelled through ``parseQuery`` first so operators
// (``"phrase"``, ``-word``, ``speaker:X``, ``section:X``) are applied
// uniformly to both result sections.
//
// Sections are split into two persistent DOM containers
// (``#search-names-list`` and ``#search-text-list``) so an update to
// one side never wipes the other. While the text-search debounce is
// pending, the previous text matches stay visible - typing one extra
// character no longer flashes the text-match list out and back in.

import { textlines } from './data.js';
import { renderSpeakerHtml, renderSectionHtml, escapeHtml } from './utilities.js';
import { searchNameMatches } from './search-name.js';
import { searchTextLines, renderTextMatchHtml } from './search-text.js';
import { parseQuery, isQueryEmpty } from './query-parser.js';
import { navigateTo } from './navigation.js';

export function initSearch() {
    const searchInput = document.getElementById('search');
    const searchResults = document.getElementById('search-results');
    const namesHeader = document.getElementById('search-names-header');
    const namesList = document.getElementById('search-names-list');
    const textHeader = document.getElementById('search-text-header');
    const textList = document.getElementById('search-text-list');

    // Sequence counter used to discard stale debounced text-search
    // results when the user has already moved on to a newer query.
    let searchSeq = 0;
    let textSearchTimer = null;

    function hide() {
        searchResults.classList.remove('visible');
        namesList.innerHTML = '';
        textList.innerHTML = '';
        namesHeader.hidden = true;
        textHeader.hidden = true;
    }

    // Both section headers ("Name matches" / "Text matches") only
    // appear when both sections have content. With one section the
    // dropdown is unambiguous; with two the headers disambiguate
    // which engine produced which entry.
    function refreshHeadersAndVisibility() {
        const hasNames = namesList.children.length > 0;
        const hasText = textList.children.length > 0;
        const showBothHeaders = hasNames && hasText;
        namesHeader.hidden = !showBothHeaders;
        textHeader.hidden = !showBothHeaders;
        if (hasNames || hasText) {
            searchResults.classList.add('visible');
        } else {
            searchResults.classList.remove('visible');
        }
    }

    function renderNameSection(nameMatches) {
        const parts = [];
        for (const m of nameMatches) {
            const tl = textlines[m.name];
            parts.push(`<div class="search-item" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}<span class="npc">${renderSpeakerHtml(tl.owner)} \u00B7 ${renderSectionHtml(tl.section)}</span></div>`);
        }
        namesList.innerHTML = parts.join('');
    }

    function renderTextSection(query, textMatches) {
        const parts = [];
        for (const m of textMatches) {
            // ``renderTextMatchHtml`` highlights matched positive
            // tokens; phrase contents already live in
            // ``query.positive`` (seeded by the parser) so phrase
            // matches get highlighted without a separate code path.
            parts.push(renderTextMatchHtml(m, query.positive));
        }
        textList.innerHTML = parts.join('');
    }

    function clearTextSection() {
        textList.innerHTML = '';
    }

    function onInput() {
        const seq = ++searchSeq;
        clearTimeout(textSearchTimer);

        const raw = searchInput.value;
        const query = parseQuery(raw);
        if (isQueryEmpty(query)) { hide(); return; }

        // Name search runs synchronously so the dropdown updates on
        // every keystroke without perceptible lag. The text section
        // is intentionally left untouched here - it'll be refreshed
        // by the debounced text search below (or explicitly cleared
        // when the new query carries no usable text signal).
        const nameMatches = searchNameMatches(query, 30);
        renderNameSection(nameMatches);

        // Text content search is debounced because it scans every
        // dialogue line. A short delay coalesces fast keystrokes
        // without making the UI feel sluggish. Very short positive
        // signals (under 3 non-whitespace characters across positive
        // tokens + phrases) are skipped to avoid swamping the
        // dropdown with generic single-letter hits like ``a`` or
        // ``I``; ``I shall`` and similar still pass the gate.
        // Filter-only queries also short-circuit here - they carry
        // no text signal for the engine to rank or highlight.
        if (query.positive.length === 0 && query.phrases.length === 0) {
            clearTextSection();
            refreshHeadersAndVisibility();
            return;
        }
        let signalLen = 0;
        for (const t of query.positive) signalLen += t.length;
        for (const p of query.phrases) signalLen += p.replace(/\s+/g, '').length;
        if (signalLen < 3) {
            clearTextSection();
            refreshHeadersAndVisibility();
            return;
        }
        // Keep the previous text matches visible while the new
        // query computes - that's the whole point of the split-
        // section layout. ``refreshHeadersAndVisibility`` runs now
        // so the name update is visible even if the user pauses
        // before the debounce fires.
        refreshHeadersAndVisibility();
        const nameMatchNames = new Set(nameMatches.map(m => m.name));
        textSearchTimer = setTimeout(() => {
            if (seq !== searchSeq) return;
            const textMatches = searchTextLines(query, nameMatchNames, 30);
            renderTextSection(query, textMatches);
            refreshHeadersAndVisibility();
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
