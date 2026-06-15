// Search dropdown wiring: keystroke handling, debouncing, keyboard
// navigation, ARIA combobox semantics, and result rendering.
// Synchronously updates the name-match list on every keystroke and
// debounces the text-content search behind a 120 ms timer so fast
// typing doesn't trigger N redundant scans. The raw input string is
// funnelled through ``parseQuery`` first so operators (``"phrase"``,
// ``-word``, ``speaker:X``, ``section:X``) are applied uniformly to
// both result sections.
//
// Sections are split into two persistent DOM containers
// (``#search-names-list`` and ``#search-text-list``) so an update to
// one side never wipes the other. While the text-search debounce is
// pending, the previous text matches stay visible - typing one extra
// character no longer flashes the text-match list out and back in.
//
// Keyboard navigation tracks the active option by DOM id rather than
// by index, so the highlighted row survives debounced text-section
// refreshes. The input behaves as an ARIA 1.2 combobox with
// ``aria-controls`` pointing at ``#search-results`` (a listbox);
// each row carries ``role="option"`` with a stable id and the input
// mirrors the active row via ``aria-activedescendant``.

import { textlines } from './data.js';
import { renderSpeakerHtml, renderSectionHtml, escapeHtml } from './utilities.js';
import { searchNameMatches } from './search-name.js';
import { searchTextLines, renderTextMatchHtml } from './search-text.js';
import { parseQuery, isQueryEmpty } from './query-parser.js';
import { navigateTo } from './navigation.js';

// Pure arithmetic helper for arrow-key navigation. Returns the next
// active index given the current one (-1 if nothing is active yet),
// the total number of options, and a direction (+1 for ArrowDown,
// -1 for ArrowUp). Wraps at both ends. With an empty list returns
// -1 unconditionally. Exported for unit testing - keeps the wrap
// arithmetic out of the DOM-mutating code path.
export function advanceActiveIndex(currentIndex, total, direction) {
    if (total === 0) return -1;
    if (currentIndex < 0) return direction > 0 ? 0 : total - 1;
    const next = currentIndex + direction;
    if (next < 0) return total - 1;
    if (next >= total) return 0;
    return next;
}

// Per-section id prefix. Keeping the prefixes distinct guarantees a
// row in the name section never collides with a same-named row in
// the text section (which can happen briefly during debounced
// text-search refresh, before the new text matches re-dedup against
// the latest name matches). ARIA ``aria-activedescendant`` resolves
// to a single element id; duplicates would resolve arbitrarily.
function optionId(section, name) {
    return `search-opt-${section}-${name}`;
}

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

    // DOM id of the currently-highlighted option, or null. Tracked
    // as an id (not an index) so the active row survives section
    // refreshes - after a re-render we just look the id up again
    // and either re-apply the highlight or clear it cleanly when the
    // row is gone.
    let activeOptionId = null;

    function getOptions() {
        return searchResults.querySelectorAll('.search-item');
    }

    function clearActive() {
        activeOptionId = null;
        for (const opt of getOptions()) {
            opt.classList.remove('is-active');
            opt.setAttribute('aria-selected', 'false');
        }
        searchInput.removeAttribute('aria-activedescendant');
    }

    function setActive(id) {
        activeOptionId = id || null;
        let found = false;
        for (const opt of getOptions()) {
            const isMatch = opt.id === id;
            opt.classList.toggle('is-active', isMatch);
            opt.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            if (isMatch) found = true;
        }
        if (found && id) {
            searchInput.setAttribute('aria-activedescendant', id);
        } else {
            activeOptionId = null;
            searchInput.removeAttribute('aria-activedescendant');
        }
    }

    // Re-apply the active highlight after a section re-render. If the
    // tracked id is still in the DOM, restore its class +
    // aria-selected; otherwise drop the tracking and clear ARIA so
    // the input stops pointing at a vanished id.
    function reapplyActive() {
        if (!activeOptionId) {
            searchInput.removeAttribute('aria-activedescendant');
            return;
        }
        const target = searchResults.querySelector(`#${CSS.escape(activeOptionId)}`);
        if (target) {
            setActive(activeOptionId);
        } else {
            clearActive();
        }
    }

    function hide() {
        searchResults.classList.remove('visible');
        searchResults.classList.remove('kbd-mode');
        namesList.innerHTML = '';
        textList.innerHTML = '';
        namesHeader.hidden = true;
        textHeader.hidden = true;
        clearActive();
        searchInput.setAttribute('aria-expanded', 'false');
    }

    // Both section headers ("Name matches" / "Text matches") only
    // appear when both sections have content. With one section the
    // dropdown is unambiguous; with two the headers disambiguate
    // which engine produced which entry. ARIA ``aria-expanded`` on
    // the input mirrors the dropdown's visibility so screen readers
    // know when the listbox is open.
    function refreshHeadersAndVisibility() {
        const hasNames = namesList.children.length > 0;
        const hasText = textList.children.length > 0;
        const showBothHeaders = hasNames && hasText;
        namesHeader.hidden = !showBothHeaders;
        textHeader.hidden = !showBothHeaders;
        const visible = hasNames || hasText;
        searchResults.classList.toggle('visible', visible);
        searchInput.setAttribute('aria-expanded', visible ? 'true' : 'false');
        reapplyActive();
    }

    function renderNameSection(nameMatches) {
        const parts = [];
        for (const m of nameMatches) {
            const tl = textlines[m.name];
            const id = optionId('name', m.name);
            parts.push(`<div class="search-item" role="option" id="${escapeHtml(id)}" aria-selected="false" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}<span class="npc">${renderSpeakerHtml(tl.owner)} \u00B7 ${renderSectionHtml(tl.section)}</span></div>`);
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
            // The helper sets ``role="option"`` + a stable id +
            // ``aria-selected="false"`` so the row joins the
            // combobox's listbox without further wiring here.
            parts.push(renderTextMatchHtml(m, query.positive, optionId('text', m.entry.name)));
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

    function commitOption(target) {
        if (!target) return;
        navigateTo(target.dataset.name);
        hide();
    }

    searchInput.addEventListener('input', onInput);

    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (item) commitOption(item);
    });

    // Mouseover (not mouseenter) bubbles, so a single listener on
    // the container catches hover transitions across all rows. Sync
    // the keyboard pointer to the hovered row so Enter commits to
    // what the user is visually focused on regardless of input
    // method. Mousemove also runs the same sync (in addition to
    // dropping ``kbd-mode``) so an intra-row mouse nudge after
    // arrow-key nav transfers the keyboard pointer to the row
    // under the cursor - without it, the cursor row would gain a
    // :hover highlight while the keyboard-active row stayed
    // highlighted, leaving two rows visibly selected.
    function syncActiveToPointer(e) {
        const item = e.target.closest('.search-item');
        if (item && item.id && item.id !== activeOptionId) {
            setActive(item.id);
        }
    }

    searchResults.addEventListener('mouseover', syncActiveToPointer);

    // Mousemove is the canonical signal that the user is driving
    // the dropdown with the pointer again - drop the
    // keyboard-mode suppression so :hover regains its visual
    // priority on the row under the cursor, AND sync the keyboard
    // pointer to that row (mouseover alone doesn't fire if the
    // cursor was already sitting on a row when arrow keys were
    // pressed).
    searchResults.addEventListener('mousemove', (e) => {
        searchResults.classList.remove('kbd-mode');
        syncActiveToPointer(e);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const opts = getOptions();
            if (opts.length === 0) return;
            e.preventDefault();
            // Mark keyboard mode BEFORE highlighting the new row so
            // the CSS suppression of :hover takes effect on the
            // same frame the new active row appears. Any subsequent
            // mousemove drops the mode again.
            searchResults.classList.add('kbd-mode');
            let currentIdx = -1;
            if (activeOptionId) {
                for (let i = 0; i < opts.length; i++) {
                    if (opts[i].id === activeOptionId) { currentIdx = i; break; }
                }
            }
            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const nextIdx = advanceActiveIndex(currentIdx, opts.length, direction);
            setActive(opts[nextIdx].id);
            // ``scrollIntoView`` with ``block: 'nearest'`` only
            // scrolls when the row is outside the visible area, so
            // arrow-key movement within the visible window stays
            // jitter-free.
            opts[nextIdx].scrollIntoView({ block: 'nearest' });
            return;
        }
        if (e.key === 'Enter') {
            const opts = getOptions();
            if (opts.length === 0) return;
            let target = null;
            if (activeOptionId) {
                target = searchResults.querySelector(`#${CSS.escape(activeOptionId)}`);
            }
            // Fallback preserves the historical behaviour of "Enter
            // commits to the first match" when the user hasn't
            // navigated explicitly.
            if (!target) target = opts[0];
            commitOption(target);
            return;
        }
        if (e.key === 'Escape') hide();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) hide();
    });
}
