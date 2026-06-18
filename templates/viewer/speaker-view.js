// Speaker overview view. Renders a single speaker's full catalogue:
// header, summary counts, cross-speaker adjacency tables, and a
// filtered, section-grouped textline list. Hosted by the same
// ``#info-content`` mount the dialogue detail view uses; the layout
// swap to full-width single-panel happens via the ``layout-speaker``
// body class set by ``navigation.js``.
//
// All state that needs to survive a back/forward navigation lives in
// the URL: ``#game=...&view=speaker&speaker=<id>&priority=<bucket>``.
// The filter chips call back into ``navigateToSpeaker`` so every click
// is a real navigation (browser history captures the drill-down
// sequence).
//
// The textline list is always grouped by ``section``; within each
// section rows order by the game's natural play order (narrative rank
// on H2, narrative-priority tier on H1) via ``compareWithinSection``.
//
// The single filter axis is repeatability (the ``playOnce`` flag),
// matching the per-row Play-once / Repeatable badge. Filter values are:
//   - ``all``       (default; passes every textline)
//   - ``priority``  (play-once dialogues only)
//   - ``plain``     (repeatable dialogues only)
// The bucket keys stay ``priority`` / ``plain`` for URL and CSS
// stability; see ``priorityScheme`` below.

import { textlines, speakers, sectionKeyLabels, gameLabels, getActiveGame } from './data.js';
import { canonicalSpeakerId, getSpeakerGroupEntry, similarSpeakers } from './speaker-groups.js';
import {
    escapeHtml,
    jsAttr,
    renderPrimaryPriorityBadgeHtml,
    renderPlayOnceBadgeHtml,
    renderSectionHtml,
} from './utilities.js';

// Priority filter scheme. Both games slice a speaker's owned dialogues
// on the same axis - repeatability (the ``playOnce`` flag) - matching
// the per-row Play-once / Repeatable badge. The 'priority' bucket holds
// play-once dialogues, 'plain' holds repeatable ones; the bucket *keys*
// stay 'priority'/'plain' for URL and CSS stability while the labels and
// meaning are repeatability. ``buckets`` drives which chips render and in
// what order; ``labels`` map each bucket to its displayed text. The 'all'
// chip is added implicitly and always renders first.
const _PRIORITY_SCHEME = {
    buckets: ['priority', 'plain'],
    labels: { priority: 'Play-once', plain: 'Repeatable' },
};

function priorityScheme() {
    return _PRIORITY_SCHEME;
}

// Public canonicaliser - exported so ``navigation.js`` can normalise a
// parsed URL state before handing it to ``renderSpeaker``. Returns the
// default ('all') when the input is missing / unrecognised or names a
// bucket that isn't part of the scheme (e.g. a stale ``super`` from a
// pre-rework URL collapses to ``all``).
export function canonicalisePriority(value) {
    if (value === 'all' || !value) return 'all';
    return priorityScheme().buckets.indexOf(value) >= 0 ? value : 'all';
}

// Returns the filter bucket for a textline: 'priority' for play-once
// dialogues, 'plain' for repeatable ones. Computed JS-side rather than
// read off a Python-emitted field to avoid shipping a per-textline
// bucket string across the data payload.
function priorityBucket(tl) {
    return (tl && tl.playOnce) ? 'priority' : 'plain';
}

function filterPassesBucket(bucket, filter) {
    if (filter === 'all') return true;
    return bucket === filter;
}

function sectionDisplay(sectionKey) {
    if (!sectionKey) return 'No section';
    return sectionKeyLabels[sectionKey] || sectionKey;
}

// Render the empty-state banner when the URL names a speaker that
// isn't registered in the active game's speakers map. The same panel
// chrome stays - just the body explains the mismatch and gives the
// user a way back to the dialogue view.
function renderMissingSpeaker(speakerId) {
    return `<div class="speaker-overview speaker-overview-missing">`
        + `<h3>Unknown speaker</h3>`
        + `<p>No speaker with the id <code>${escapeHtml(speakerId)}</code> is registered in the active game. It may belong to the other game - try the game toggle.</p>`
        + `</div>`;
}

// Render the repeatability filter chips (with counts). Clickable: each
// navigates to the same speaker with the matching ``priority`` URL key,
// pivoting the textline list. The active chip carries an ``is-active``
// class + ``aria-pressed`` flag. Chip list and labels come from
// ``priorityScheme``. Returns the chip buttons' HTML (no wrapper).
//
// The bucket counts (play-once vs repeatable) are derived client-side
// via ``priorityBucket`` rather than read off a Python-emitted field.
function renderPriorityChips(entry, speakerId, currentFilter) {
    const ownedNames = entry.ownedTextlines || [];
    const owned = ownedNames.length;
    const scheme = priorityScheme();
    const bucketCounts = {};
    for (const name of ownedNames) {
        const tl = textlines[name];
        if (!tl) continue;
        const b = priorityBucket(tl);
        bucketCounts[b] = (bucketCounts[b] || 0) + 1;
    }
    const chipBuckets = ['all', ...scheme.buckets];
    return chipBuckets.map(bucket => {
        const isActive = currentFilter === bucket;
        const cls = `priority-chip${isActive ? ' is-active' : ''}`;
        let label;
        let count;
        if (bucket === 'all') {
            label = 'All';
            count = owned;
        } else {
            label = scheme.labels[bucket];
            count = bucketCounts[bucket] || 0;
        }
        const aria = isActive ? ' aria-pressed="true"' : ' aria-pressed="false"';
        return `<button type="button" class="${cls}"${aria} onclick="event.stopPropagation(); filterSpeakerPriority(${jsAttr(speakerId)}, ${jsAttr(bucket)})">${escapeHtml(label)}: <span class="speaker-count">${count}</span></button>`;
    }).join('');
}

// Within-section ordering of textlines, matching each game's natural
// in-game play order. On H2 dialogues play in narrative-rank order
// (rank 1 first); rank-less dialogues (repeatables) sort last. On H1
// there is no rank, so dialogues order by their narrative-priority tier
// (super-priority first, then priority, normal, low). Ties and
// untiered rows fall back to alphabetical by name.
function compareWithinSection(a, b, game) {
    if ((game || getActiveGame()) === 'hades2') {
        const ra = Number.isInteger(a.tl.narrativePriorityOrdinal) ? a.tl.narrativePriorityOrdinal : Infinity;
        const rb = Number.isInteger(b.tl.narrativePriorityOrdinal) ? b.tl.narrativePriorityOrdinal : Infinity;
        if (ra !== rb) return ra - rb;
    } else {
        const ta = h1TierRank(a.tl);
        const tb = h1TierRank(b.tl);
        if (ta !== tb) return ta - tb;
    }
    return a.name.localeCompare(b.name);
}

// H1 narrative-priority tier as a sortable rank (lower plays first):
// super-priority, then priority, then normal, then low (the final
// fallback). Mirrors the tier the per-row badge shows
// (``narrativePrioritySectionTier``).
function h1TierRank(tl) {
    const sec = tl && tl.narrativePrioritySectionTier;
    if (sec === 'super') return 0;
    if (sec === 'priority') return 1;
    if (sec === 'low') return 3;
    return 2;
}

// Render the summary cards: owned/guest totals and the per-section
// breakdown. The priority filter chips live with the textline list they
// pivot (see ``renderTextlineControls``), not here.
function renderSummary(entry) {
    const owned = (entry.ownedTextlines || []).length;
    const asSpeaker = (entry.asSpeakerTextlines || []).length;
    const sectionCounts = entry.sectionCounts || {};

    const sectionEntries = Object.entries(sectionCounts).sort((a, b) => b[1] - a[1]);
    const sectionsHtml = sectionEntries.length
        ? sectionEntries.map(([key, count]) =>
            `<li>${renderSectionHtml(key)}: <span class="speaker-count">${count}</span></li>`
        ).join('')
        : '<li class="muted">none</li>';

    return `<section class="speaker-summary">`
        + `<div class="speaker-summary-row">`
        + `<div class="speaker-summary-cell"><h4>Owned dialogues</h4><div class="speaker-summary-value">${owned}</div></div>`
        + `<div class="speaker-summary-cell"><h4>As guest speaker</h4><div class="speaker-summary-value">${asSpeaker}</div><div class="speaker-summary-note">speaks in textlines owned by other speakers</div></div>`
        + `<div class="speaker-summary-cell speaker-summary-sections"><h4>Sections</h4><ul class="speaker-section-list">${sectionsHtml}</ul></div>`
        + `</div>`
        + `</section>`;
}

// Render the upstream + downstream adjacency tables. Each row is a
// clickable speaker link so the user can drill across the social
// graph one hop at a time. Self-loops are kept (a speaker frequently
// gates on their own textlines via cooldown / sequence chains; that
// IS useful information).
function renderAdjacency(entry) {
    const up = entry.adjacencyUpstream || {};
    const down = entry.adjacencyDownstream || {};
    const upRows = Object.entries(up).sort((a, b) => b[1] - a[1]);
    const downRows = Object.entries(down).sort((a, b) => b[1] - a[1]);

    const upHtml = upRows.length
        ? `<ul class="speaker-adjacency-list">`
            + upRows.map(([sid, count]) => `<li><a class="speaker-link" onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(sid)})">${escapeHtml(displayNameFor(sid))}</a> <span class="speaker-id-inline">(${escapeHtml(sid)})</span><span class="speaker-count">${count}</span></li>`).join('')
            + `</ul>`
        : `<p class="muted">No dialogue requirements from this speaker reference any other speaker's dialogues.</p>`;

    const downHtml = downRows.length
        ? `<ul class="speaker-adjacency-list">`
            + downRows.map(([sid, count]) => `<li><a class="speaker-link" onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(sid)})">${escapeHtml(displayNameFor(sid))}</a> <span class="speaker-id-inline">(${escapeHtml(sid)})</span><span class="speaker-count">${count}</span></li>`).join('')
            + `</ul>`
        : `<p class="muted">No other speaker's dialogue requirements reference any dialogue from this speaker.</p>`;

    return `<section class="speaker-adjacency">`
        + `<div class="speaker-adjacency-col"><h4>Dialogue requirements reference dialogues from these speakers</h4>${upHtml}</div>`
        + `<div class="speaker-adjacency-col"><h4>These speakers' dialogue requirements reference dialogues from this speaker</h4>${downHtml}</div>`
        + `</section>`;
}

function displayNameFor(speakerId) {
    const entry = speakers[speakerId];
    if (entry && entry.name && entry.name !== speakerId) return entry.name;
    return speakerId;
}

// Render the textline list. Dialogues are always grouped by section
// (the only meaningful grouping; the previous "tier" grouping merely
// re-sliced the same axis as the repeatability filter). Within each
// section, rows order by the game's natural play order via
// ``compareWithinSection``. The controls strip (the repeatability
// filter) renders above the list.
function renderTextlineList(entry, speakerId, filter, game) {
    const owned = (entry.ownedTextlines || [])
        .map(n => ({ name: n, tl: textlines[n] }))
        .filter(o => o.tl);
    const filtered = owned.filter(o => filterPassesBucket(priorityBucket(o.tl), filter));

    const controls = renderTextlineControls(entry, speakerId, filter);

    if (filtered.length === 0) {
        return `<section class="speaker-textlines">${controls}<p class="muted speaker-textlines-empty">No textlines match the current filter.</p></section>`;
    }

    const groups = new Map();
    for (const o of filtered) {
        const sec = o.tl.section || '';
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(o);
    }
    const orderedSections = Array.from(groups.keys()).sort((a, b) => {
        // Sort sections by count desc, then by label for ties.
        const ca = groups.get(a).length;
        const cb = groups.get(b).length;
        if (ca !== cb) return cb - ca;
        return sectionDisplay(a).localeCompare(sectionDisplay(b));
    });
    const body = orderedSections.map(sec => {
        const rows = groups.get(sec).slice().sort((a, b) => compareWithinSection(a, b, game));
        const header = sec
            ? renderSectionHtml(sec)
            : `<span class="section-name">(unknown section)</span>`;
        return `<div class="speaker-textline-group">`
            + `<h5 class="speaker-textline-group-header">${header} <span class="speaker-count">${rows.length}</span></h5>`
            + `<ul class="speaker-textline-list">${rows.map(o => renderTextlineRow(o.name, o.tl)).join('')}</ul>`
            + `</div>`;
    }).join('');

    return `<section class="speaker-textlines">${controls}${body}</section>`;
}

// Render the controls strip above the textline list: the repeatability
// filter chips (co-located with the list they pivot).
function renderTextlineControls(entry, speakerId, filter) {
    const priorityChips = renderPriorityChips(entry, speakerId, filter);
    return `<div class="speaker-textline-controls">`
        + `<span class="speaker-control-label">Filter:</span>`
        + `<div class="speaker-priority-chips" role="group" aria-label="Repeatability filter">${priorityChips}</div>`
        + `</div>`;
}

function renderTextlineRow(name, tl) {
    const priority = renderPrimaryPriorityBadgeHtml(tl);
    const playOnce = renderPlayOnceBadgeHtml(tl);
    return `<li class="speaker-textline-row">`
        + `<a class="textline-link" onclick="navigateTo(${jsAttr(name)})">${escapeHtml(name)}</a>`
        + `<span class="speaker-textline-badges">${priority}${playOnce}</span>`
        + `</li>`;
}

// Main entry. ``opts.priority`` is the URL-supplied filter string
// (already canonicalised by ``navigation.js``). The function is
// pure-render: it never touches the URL or any global state besides the
// DOM mount, so the caller controls navigation timing.
//
// The incoming ``speakerId`` may be any member id of a group; the
// renderer resolves to the canonical id internally and presents the
// aggregated entry. ``navigation.js`` also canonicalises before
// writing the URL so user clicks land on the stable canonical id.
export function renderSpeaker(speakerId, opts) {
    const container = document.getElementById('info-content');
    if (!container) return;
    if (!speakerId) {
        container.innerHTML = `<div class="empty-state">Select a speaker to see their overview</div>`;
        return;
    }
    if (!speakers[speakerId]) {
        container.innerHTML = renderMissingSpeaker(speakerId);
        return;
    }
    const canonical = canonicalSpeakerId(speakerId);
    const entry = getSpeakerGroupEntry(canonical) || speakers[canonical];
    if (!entry) {
        container.innerHTML = renderMissingSpeaker(speakerId);
        return;
    }
    const game = getActiveGame() || '';
    const filter = canonicalisePriority(opts && opts.priority);
    const friendly = entry.name && entry.name !== canonical ? entry.name : null;
    const description = entry.description || '';
    const gameLabel = (gameLabels && gameLabels[game]) || game;
    const members = (entry._members && entry._members.length > 0) ? entry._members : [canonical];

    // When the group has multiple members, list every member id on a
    // dedicated row so the user can see what was collapsed (the
    // friendly name alone is ambiguous - e.g. H1 ``Hermes`` covers
    // ``HermesUpgrade``, ``HermesUpgradeRare``, and ``NPC_Hermes_01``).
    // Single-member groups keep the existing inline ``(id)`` shape.
    const headerTitle = members.length > 1
        ? `<h3>${escapeHtml(friendly || canonical)}</h3>`
            + `<p class="speaker-ids"><span class="muted">Internal ids (${members.length}):</span> `
            + members.map(m => `<code>${escapeHtml(m)}</code>`).join(' \u00B7 ')
            + `</p>`
        : `<h3>${escapeHtml(friendly || canonical)}`
            + (friendly ? ` <span class="speaker-id">(${escapeHtml(canonical)})</span>` : '')
            + `</h3>`;

    // Other in-game versions of the same character (e.g. Chronos vs
    // Chronos (Boss) / (Reformed)). Rendered in the header's right column,
    // aligned with the summary's right column below.
    const similar = similarSpeakers(canonical);
    const similarHtml = similar.length
        ? `<div class="speaker-similar"><span class="speaker-similar-label">Other versions of this speaker:</span>`
            + similar.map(s => `<a class="speaker-similar-pill" role="button" onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(s.id)})">${escapeHtml(s.name)}</a>`).join('')
            + `</div>`
        : '';

    const headerHtml = `<header class="speaker-overview-header">`
        + `<div class="speaker-overview-header-main">`
        + headerTitle
        + (description ? `<p class="speaker-description">${escapeHtml(description)}</p>` : '')
        + `</div>`
        + `<div class="speaker-overview-header-aside">`
        + (gameLabel ? `<p class="speaker-game">Game: ${escapeHtml(gameLabel)}</p>` : '')
        + similarHtml
        + `</div>`
        + `</header>`;

    container.innerHTML = `<div class="speaker-overview">`
        + headerHtml
        + renderSummary(entry)
        + renderAdjacency(entry)
        + renderTextlineList(entry, canonical, filter, game)
        + `</div>`;
}
