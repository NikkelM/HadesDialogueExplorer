// Cross-game duplicate textline names view. A master-detail layout:
// the left pane lists every speaker that owns shared textline names,
// the right pane shows the selected speaker's shared dialogues, each
// with a link into either game's view.
//
// URL: ``#view=duplicates&dup=<speaker>&q=<search>``

import { duplicates, games, gameLabels } from './data.js';
import { escapeHtml, jsAttr } from './utilities.js';

// Sentinel master-list entry that shows every speaker's shared dialogues at
// once. Keyed with a control char so it can never collide with a real
// speaker name; rendered as "All". First in the list and the default.
// Exported so the navigation layer can map it to "omit the ``dup`` URL key".
export const ALL_SPEAKERS = '\u0000all';

// Speaker currently shown in the detail pane. Persists across
// re-renders (search typing, game switches) so the selection sticks
// for as long as it survives the active filter. Defaults to
// ``ALL_SPEAKERS`` (every shared dialogue).
let selectedSpeaker = ALL_SPEAKERS;

// Resolve the friendly speaker name for a duplicate entry, using the
// Hades 1 speaker name as the canonical display name.
function speakerName(d) {
    const h1Speakers = games && games.hades1 && games.hades1.speakers;
    const entry = h1Speakers && h1Speakers[d.hades1.owner];
    return (entry && entry.name) || d.hades1.owner;
}

// Render the full duplicates view into the given container element.
// ``opts.q`` is the URL-supplied search string. ``opts.dup`` is the
// URL-supplied selected speaker (a display name; absent / empty means the
// "All" pseudo-speaker).
//
// When ``opts._bodyOnly`` is true, only the master-detail body is
// refreshed (the search input stays intact in the DOM) so the input
// retains focus during live typing.
export function renderDuplicates(opts) {
    const container = document.getElementById('info-content');
    if (!container) return;

    const query = ((opts && opts.q) || '').trim().toLowerCase();

    // Resolve the detail-pane selection from the incoming options. A full
    // render treats the URL as authoritative: an explicit ``dup`` selects
    // that speaker, its absence resets to "All". A body-only render (live
    // search typing) only changes the selection when ``dup`` is passed
    // explicitly (a speaker-chip click), otherwise the current selection
    // is preserved so typing never clears the detail pane.
    if (opts && opts._bodyOnly) {
        if (opts.dup !== undefined) selectedSpeaker = opts.dup || ALL_SPEAKERS;
    } else {
        selectedSpeaker = (opts && opts.dup) ? opts.dup : ALL_SPEAKERS;
    }

    let items = duplicates || [];

    if (query) {
        items = items.filter(d =>
            d.name.toLowerCase().includes(query)
            || speakerName(d).toLowerCase().includes(query)
        );
    }

    const totalCount = (duplicates || []).length;
    const h1Label = (gameLabels && gameLabels.hades1) || 'Hades';
    const h2Label = (gameLabels && gameLabels.hades2) || 'Hades II';

    // Fast path: only replace the master-detail body when the input is
    // active, preserving the live search element and its focus.
    if (opts && opts._bodyOnly) {
        const bodyEl = container.querySelector('.duplicates-md')
            || container.querySelector('.duplicates-empty');
        if (bodyEl) {
            const tmp = document.createElement('div');
            tmp.innerHTML = renderBody(items, h1Label, h2Label);
            bodyEl.replaceWith(tmp.firstElementChild || tmp.firstChild);
        }
        return;
    }

    const headerHtml = `<header class="duplicates-header">`
        + `<h3>Duplicate dialogues</h3>`
        + `<p class="duplicates-subtitle">${totalCount} textline names appear in both ${escapeHtml(h1Label)} and ${escapeHtml(h2Label)}.</p>`
        + `</header>`;

    const controlsHtml = `<div class="duplicates-controls">`
        + `<input type="text" class="duplicates-search" placeholder="Filter by name or speaker..." `
        + `value="${escapeHtml(query)}" oninput="searchDuplicates(this.value)" />`
        + `</div>`;

    container.innerHTML = `<div class="duplicates-view">`
        + headerHtml
        + controlsHtml
        + renderBody(items, h1Label, h2Label)
        + `</div>`;
}

// Build the master-detail body (or the empty-state message). Groups the
// filtered duplicates by speaker, resolves the active selection, and
// renders the speaker list beside the selected speaker's dialogues.
function renderBody(items, h1Label, h2Label) {
    if (items.length === 0) {
        return `<p class="muted duplicates-empty">No duplicates match the current search.</p>`;
    }

    const groups = new Map();
    for (const d of items) {
        const name = speakerName(d);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(d);
    }
    const speakers = [...groups.keys()].sort((a, b) => a.localeCompare(b));

    // Keep the current selection if it survived the filter, otherwise
    // fall back to the "All" pseudo-speaker (the default).
    if (selectedSpeaker !== ALL_SPEAKERS && !groups.has(selectedSpeaker)) {
        selectedSpeaker = ALL_SPEAKERS;
    }

    // "All" entry first, then each speaker. The All count is the full
    // filtered total; per-speaker counts are their group size.
    const allActive = selectedSpeaker === ALL_SPEAKERS ? ' is-active' : '';
    const allItem = `<button type="button" class="duplicates-speaker-item${allActive}" onclick="selectDuplicateSpeaker(${jsAttr(ALL_SPEAKERS)})">`
        + `<span class="duplicates-speaker-name">All</span>`
        + `<span class="duplicates-speaker-count">${items.length}</span>`
        + `</button>`;
    const speakerList = allItem + speakers.map(name => {
        const active = name === selectedSpeaker ? ' is-active' : '';
        return `<button type="button" class="duplicates-speaker-item${active}" onclick="selectDuplicateSpeaker(${jsAttr(name)})">`
            + `<span class="duplicates-speaker-name">${escapeHtml(name)}</span>`
            + `<span class="duplicates-speaker-count">${groups.get(name).length}</span>`
            + `</button>`;
    }).join('');

    const showingAll = selectedSpeaker === ALL_SPEAKERS;
    const dupes = showingAll ? items : (groups.get(selectedSpeaker) || []);
    const detailTitle = showingAll ? 'All speakers' : selectedSpeaker;
    const entries = dupes.map(d => renderEntry(d, h1Label, h2Label)).join('');
    // Size the name column to the longest name across all duplicates
    // (monospace, one ``ch`` per character) so the game pills start at
    // the same point for every speaker rather than shifting on switch.
    const nameCols = (duplicates || []).reduce((m, d) => Math.max(m, d.name.length), 0);

    return `<div class="duplicates-md">`
        + `<div class="duplicates-speakers">${speakerList}</div>`
        + `<div class="duplicates-detail">`
        + `<h4 class="duplicates-detail-title">${escapeHtml(detailTitle)}</h4>`
        + `<div class="duplicates-detail-list" style="--dup-name-col: ${nameCols}ch">${entries}</div>`
        + `</div>`
        + `</div>`;
}

function renderEntry(d, h1Label, h2Label) {
    return `<div class="duplicates-entry">`
        + `<span class="duplicates-name">${escapeHtml(d.name)}</span>`
        + `<a class="duplicates-game-link" onclick="navigateToState({game:'hades1', view:'dialogue', dialogue:${jsAttr(d.name)}})" data-tooltip="Open in ${escapeHtml(h1Label)}">${escapeHtml(h1Label)}</a>`
        + `<a class="duplicates-game-link" onclick="navigateToState({game:'hades2', view:'dialogue', dialogue:${jsAttr(d.name)}})" data-tooltip="Open in ${escapeHtml(h2Label)}">${escapeHtml(h2Label)}</a>`
        + `</div>`;
}

// Current detail-pane speaker, or the ``ALL_SPEAKERS`` sentinel when the
// "All" pseudo-speaker is active. Read by the navigation layer to keep the
// ``dup`` URL key in sync with the live selection - e.g. so search typing
// preserves (or, when the filter drops the selected speaker, correctly
// clears) the selected speaker in the URL.
export function getSelectedDuplicateSpeaker() {
    return selectedSpeaker;
}
