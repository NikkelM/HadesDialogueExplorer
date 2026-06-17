// Cross-game duplicate textline names view. Renders a filterable table
// showing every textline name that exists in both Hades 1 and Hades II.
// Primarily useful for modders porting content between games who need
// to identify naming collisions.
//
// URL: ``#view=duplicates&filter=<all|same|diff>&q=<search>``
//
// The data source is the top-level ``duplicates`` array populated by
// ``loadData``. Each entry carries ``{name, hades1: {owner, section},
// hades2: {owner, section}}``. The view is game-agnostic (it always
// shows both sides); clicking a name navigates to the textline detail
// in the currently active game (or whichever game owns it if only one
// side has it - though by definition both do).

import { duplicates, gameLabels, sectionKeyLabels } from './data.js';
import { escapeHtml, jsAttr } from './utilities.js';

// Filter values recognised by the URL ``filter`` key.
const FILTER_VALUES = ['all', 'same', 'diff'];

export function canonicaliseDuplicatesFilter(value) {
    return FILTER_VALUES.indexOf(value) >= 0 ? value : 'all';
}

// Render the full duplicates view into the given container element.
// ``opts.filter`` and ``opts.q`` are the URL-supplied filter + search
// strings (already canonicalised by the navigation layer).
//
// When ``opts._tableOnly`` is true, only the table and count badge are
// refreshed (the controls and search input stay intact in the DOM) so
// the input retains focus during live typing.
export function renderDuplicates(opts) {
    const container = document.getElementById('info-content');
    if (!container) return;

    const filter = canonicaliseDuplicatesFilter(opts && opts.filter);
    const query = ((opts && opts.q) || '').trim().toLowerCase();

    let items = duplicates || [];

    // Apply owner filter.
    if (filter === 'same') {
        items = items.filter(d => d.hades1.owner === d.hades2.owner);
    } else if (filter === 'diff') {
        items = items.filter(d => d.hades1.owner !== d.hades2.owner);
    }

    // Apply text search across name, owner, and section fields.
    if (query) {
        items = items.filter(d =>
            d.name.toLowerCase().includes(query)
            || d.hades1.owner.toLowerCase().includes(query)
            || d.hades2.owner.toLowerCase().includes(query)
            || d.hades1.section.toLowerCase().includes(query)
            || d.hades2.section.toLowerCase().includes(query)
        );
    }

    const totalCount = (duplicates || []).length;
    const h1Label = (gameLabels && gameLabels.hades1) || 'Hades';
    const h2Label = (gameLabels && gameLabels.hades2) || 'Hades II';

    // Fast path: only replace the table + count when the input is active.
    if (opts && opts._tableOnly) {
        const tableWrap = container.querySelector('.duplicates-table-wrap')
            || container.querySelector('.duplicates-empty');
        const countEl = container.querySelector('.duplicates-count');
        if (tableWrap) {
            const tmp = document.createElement('div');
            tmp.innerHTML = renderTable(items, h1Label, h2Label);
            tableWrap.replaceWith(tmp.firstElementChild || tmp.firstChild);
        }
        if (countEl) {
            countEl.textContent = items.length === totalCount
                ? `${totalCount}`
                : `${items.length} / ${totalCount}`;
        }
        return;
    }

    const headerHtml = `<header class="duplicates-header">`
        + `<h3>Duplicate dialogues</h3>`
        + `<p class="duplicates-subtitle">${totalCount} textline names appear in both ${escapeHtml(h1Label)} and ${escapeHtml(h2Label)}.</p>`
        + `</header>`;

    const controlsHtml = renderControls(filter, query, items.length, totalCount);
    const tableHtml = renderTable(items, h1Label, h2Label);

    container.innerHTML = `<div class="duplicates-view">`
        + headerHtml
        + controlsHtml
        + tableHtml
        + `</div>`;
}

function renderControls(filter, query, visibleCount, totalCount) {
    const chips = FILTER_VALUES.map(f => {
        const isActive = f === filter;
        const cls = `filter-chip${isActive ? ' is-active' : ''}`;
        const aria = isActive ? ' aria-pressed="true"' : ' aria-pressed="false"';
        const labels = { all: 'All', same: 'Same owner', diff: 'Different owner' };
        return `<button type="button" class="${cls}"${aria} `
            + `onclick="event.stopPropagation(); filterDuplicates(${jsAttr(f)})">`
            + `${escapeHtml(labels[f])}</button>`;
    }).join('');

    const countNote = visibleCount === totalCount
        ? `<span class="duplicates-count">${totalCount}</span>`
        : `<span class="duplicates-count">${visibleCount} / ${totalCount}</span>`;

    return `<div class="duplicates-controls">`
        + `<div class="duplicates-filter-row">${chips} ${countNote}</div>`
        + `<div class="duplicates-search-row">`
        + `<input type="text" class="duplicates-search" placeholder="Filter by name, owner, or section..." `
        + `value="${escapeHtml(query)}" oninput="searchDuplicates(this.value)" />`
        + `</div>`
        + `</div>`;
}

function renderTable(items, h1Label, h2Label) {
    if (items.length === 0) {
        return `<p class="muted duplicates-empty">No duplicates match the current filter.</p>`;
    }

    const sectionLabel = (key) => {
        return (sectionKeyLabels && sectionKeyLabels[key]) || key;
    };

    const rows = items.map(d => {
        const sameOwner = d.hades1.owner === d.hades2.owner;
        const rowCls = sameOwner ? '' : ' class="duplicates-diff-owner"';
        return `<tr${rowCls}>`
            + `<td><a class="textline-link" onclick="navigateTo(${jsAttr(d.name)})">${escapeHtml(d.name)}</a></td>`
            + `<td><code>${escapeHtml(d.hades1.owner)}</code></td>`
            + `<td>${escapeHtml(sectionLabel(d.hades1.section))}</td>`
            + `<td><code>${escapeHtml(d.hades2.owner)}</code></td>`
            + `<td>${escapeHtml(sectionLabel(d.hades2.section))}</td>`
            + `</tr>`;
    }).join('');

    return `<div class="duplicates-table-wrap"><table class="duplicates-table">`
        + `<thead><tr>`
        + `<th>Name</th>`
        + `<th>${escapeHtml(h1Label)} owner</th>`
        + `<th>${escapeHtml(h1Label)} section</th>`
        + `<th>${escapeHtml(h2Label)} owner</th>`
        + `<th>${escapeHtml(h2Label)} section</th>`
        + `</tr></thead>`
        + `<tbody>${rows}</tbody>`
        + `</table></div>`;
}

// Exported for unit tests.
export const _duplicatesInternals = {
    canonicaliseDuplicatesFilter,
    FILTER_VALUES,
};
