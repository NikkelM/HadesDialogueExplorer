// Speaker overview view. Renders a single speaker's full catalogue:
// header, summary counts, cross-speaker adjacency tables, and an
// optionally-filtered + sorted textline list. Hosted by the same
// ``#info-content`` mount the dialogue detail view uses; the layout
// swap to full-width single-panel happens via the ``layout-speaker``
// body class set by ``navigation.js``.
//
// All state that needs to survive a back/forward navigation lives in
// the URL: ``#game=...&view=speaker&speaker=<id>&priority=<bucket>&sort=<axis>``.
// The filter and sort controls call back into ``navigateToSpeaker`` so
// every click is a real navigation (browser history captures the
// drill-down sequence).
//
// Priority buckets emitted by the Python aggregator: ``super`` /
// ``priority`` / ``plain``. The user-facing chips and chip labels are
// per-game (H1 vs H2 use entirely different narrative-priority
// systems), see ``priorityScheme`` below for the per-game contract.
// URL bucket vocabulary is uniform across games; chips that aren't
// available for the active game just don't render. Filter values are:
//   - ``all``       (default; passes every textline)
//   - ``super``     (H1 only - only ``super`` bucket)
//   - ``priority``  (H1: ``super`` OR ``priority`` - i.e. "ranked";
//                    H2: only the ``priority`` bucket, which on H2
//                    corresponds to textlines that carry a
//                    NarrativeData ordinal)
//   - ``plain``     (only ``plain`` bucket; on H2 this is the
//                    "unranked" set - no NarrativeData ordinal)
// Sort axes:
//   - ``section``   (default; groups by ``section`` field, headers
//                    use the per-game section label)
//   - ``tier``      (per-game tier order; ties broken by section
//                    then name)
//   - ``name``      (flat alphabetical)

import { textlines, speakers, sectionKeyLabels, gameLabels, getActiveGame } from './data.js';
import { canonicalSpeakerId, getSpeakerGroupEntry, similarSpeakers } from './speaker-groups.js';
import {
    escapeHtml,
    jsAttr,
    renderPrimaryPriorityBadgeHtml,
    renderPlayOnceBadgeHtml,
    renderSectionHtml,
} from './utilities.js';

// Per-game priority filter schemes. H1 has the section/set-tier
// super/priority distinction inherited from the legacy game; H2
// dropped that system in favour of a flat per-(owner, section)
// ordinal ranking, so the user-facing chips collapse to a
// "ranked" (has ordinal) vs "unranked" (no ordinal) split. The
// ``buckets`` list drives which chips render and in what order;
// ``labels`` map each bucket to its displayed text. The 'all'
// chip is added implicitly and always renders first.
const _PRIORITY_SCHEMES = {
    hades1: {
        buckets: ['super', 'priority', 'plain'],
        labels: { super: 'Super-priority', priority: 'Priority', plain: 'Plain' },
    },
    hades2: {
        // No "super" chip - H2 has no super-priority bucket at all.
        buckets: ['priority', 'plain'],
        labels: { priority: 'Ranked', plain: 'Unranked' },
    },
};

const _DEFAULT_PRIORITY_SCHEME = _PRIORITY_SCHEMES.hades1;

function priorityScheme(game) {
    return _PRIORITY_SCHEMES[game] || _DEFAULT_PRIORITY_SCHEME;
}

// Public canonicalisers - exported so ``navigation.js`` can normalise
// a parsed URL state before handing it to ``renderSpeaker``. Returns
// the default value when the input is missing / unrecognised or when
// the bucket isn't available for the active game (e.g. ``super`` on
// H2 collapses to ``all`` since H2 has no super-priority bucket).
const SORT_VALUES = ['section', 'tier', 'name'];

export function canonicalisePriority(value, game) {
    if (value === 'all' || !value) return 'all';
    const scheme = priorityScheme(game || getActiveGame());
    return scheme.buckets.indexOf(value) >= 0 ? value : 'all';
}

export function canonicaliseSort(value) {
    return SORT_VALUES.indexOf(value) >= 0 ? value : 'section';
}

// Returns the bucket (``super`` / ``priority`` / ``plain``) for a
// textline using the same rules as the Python aggregator. Kept JS-side
// rather than reading off a Python-emitted ``priorityBucket`` field
// because the per-textline bucket is cheap to compute and avoids
// shipping a 30 KB string field across the data payload.
function priorityBucket(tl) {
    const set = tl && tl.narrativePrioritySetLevel;
    const sec = tl && tl.narrativePrioritySectionTier;
    if (set === 'super' || sec === 'super') return 'super';
    if (set === 'priority' || sec === 'priority') return 'priority';
    if (tl && Number.isInteger(tl.narrativePriorityOrdinal)) return 'priority';
    return 'plain';
}

function filterPassesBucket(bucket, filter, game) {
    if (filter === 'all') return true;
    // H1-only: "priority" filter means "super OR priority" (i.e.
    // "ranked or better"). On H2 there's no super bucket so this
    // reduces to a plain bucket-equality check.
    const activeGame = game || getActiveGame();
    if (filter === 'priority' && activeGame === 'hades1') {
        return bucket === 'super' || bucket === 'priority';
    }
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

// Render the per-priority filter chips (with counts). Clickable: each
// navigates to the same speaker with the matching ``priority`` URL key,
// pivoting the textline list. The active chip carries an ``is-active``
// class + ``aria-pressed`` flag. Chip list and labels are per-game; see
// ``priorityScheme``. Returns the chip buttons' HTML (no wrapper).
function renderPriorityChips(entry, speakerId, currentFilter, game) {
    const owned = (entry.ownedTextlines || []).length;
    const priorityCounts = entry.priorityCounts || { super: 0, priority: 0, plain: 0 };
    const scheme = priorityScheme(game);
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
            count = priorityCounts[bucket] || 0;
        }
        const aria = isActive ? ' aria-pressed="true"' : ' aria-pressed="false"';
        return `<button type="button" class="${cls}"${aria} onclick="event.stopPropagation(); filterSpeakerPriority(${jsAttr(speakerId)}, ${jsAttr(bucket)})">${escapeHtml(label)}: <span class="speaker-count">${count}</span></button>`;
    }).join('');
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

// Render the textline list. Always renders a header strip with the
// active sort control so the user can pivot without scrolling back
// up. Group headers use the section label, the tier label, or are
// omitted entirely depending on the active sort axis.
function renderTextlineList(entry, speakerId, filter, sort, game) {
    const scheme = priorityScheme(game);
    const owned = (entry.ownedTextlines || [])
        .map(n => ({ name: n, tl: textlines[n] }))
        .filter(o => o.tl);
    const filtered = owned.filter(o => filterPassesBucket(priorityBucket(o.tl), filter, game));

    const controls = renderTextlineControls(entry, speakerId, filter, sort, game);

    if (filtered.length === 0) {
        return `<section class="speaker-textlines">${controls}<p class="muted speaker-textlines-empty">No textlines match the current filter.</p></section>`;
    }

    let body;
    if (sort === 'name') {
        const rows = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
        body = `<ul class="speaker-textline-list">${rows.map(o => renderTextlineRow(o.name, o.tl)).join('')}</ul>`;
    } else if (sort === 'tier') {
        const groups = new Map();
        for (const o of filtered) {
            const bucket = priorityBucket(o.tl);
            if (!groups.has(bucket)) groups.set(bucket, []);
            groups.get(bucket).push(o);
        }
        const orderedBuckets = ['super', 'priority', 'plain'].filter(b => groups.has(b));
        body = orderedBuckets.map(bucket => {
            const rows = groups.get(bucket).slice().sort((a, b) => {
                const sa = (a.tl.section || '').localeCompare(b.tl.section || '');
                if (sa !== 0) return sa;
                return a.name.localeCompare(b.name);
            });
            const bucketLabel = scheme.labels[bucket] || bucket;
            return `<div class="speaker-textline-group">`
                + `<h5 class="speaker-textline-group-header speaker-tier-header speaker-tier-${bucket}">${escapeHtml(bucketLabel)} <span class="speaker-count">${rows.length}</span></h5>`
                + `<ul class="speaker-textline-list">${rows.map(o => renderTextlineRow(o.name, o.tl)).join('')}</ul>`
                + `</div>`;
        }).join('');
    } else {
        // Default: section grouping.
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
        body = orderedSections.map(sec => {
            const rows = groups.get(sec).slice().sort((a, b) => a.name.localeCompare(b.name));
            const header = sec
                ? renderSectionHtml(sec)
                : `<span class="section-name">(unknown section)</span>`;
            return `<div class="speaker-textline-group">`
                + `<h5 class="speaker-textline-group-header">${header} <span class="speaker-count">${rows.length}</span></h5>`
                + `<ul class="speaker-textline-list">${rows.map(o => renderTextlineRow(o.name, o.tl)).join('')}</ul>`
                + `</div>`;
        }).join('');
    }

    return `<section class="speaker-textlines">${controls}${body}</section>`;
}

// Render the controls strip above the textline list: the priority filter
// chips (co-located with the list they pivot) and the sort-axis chips.
function renderTextlineControls(entry, speakerId, filter, sort, game) {
    const priorityChips = renderPriorityChips(entry, speakerId, filter, game);
    const sortOptions = [
        ['section', 'Section'],
        ['tier', 'Tier'],
        ['name', 'Name'],
    ];
    const sortButtons = sortOptions.map(([val, label]) => {
        const isActive = sort === val;
        const cls = `sort-chip${isActive ? ' is-active' : ''}`;
        const aria = isActive ? ' aria-pressed="true"' : ' aria-pressed="false"';
        return `<button type="button" class="${cls}"${aria} onclick="event.stopPropagation(); sortSpeakerTextlines(${jsAttr(speakerId)}, ${jsAttr(val)})">${escapeHtml(label)}</button>`;
    }).join('');
    return `<div class="speaker-textline-controls">`
        + `<span class="speaker-control-label">Filter:</span>`
        + `<div class="speaker-priority-chips" role="group" aria-label="Priority filter">${priorityChips}</div>`
        + `<span class="speaker-control-label speaker-control-group-sep">Sort by:</span>`
        + `<div class="speaker-sort-chips" role="group" aria-label="Sort">${sortButtons}</div>`
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

// Main entry. ``opts.priority`` / ``opts.sort`` are the URL-supplied
// strings (already canonicalised by ``navigation.js``). The function
// is pure-render: it never touches the URL or any global state
// besides the DOM mount, so the caller controls navigation timing.
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
    const filter = canonicalisePriority(opts && opts.priority, game);
    const sort = canonicaliseSort(opts && opts.sort);
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
        + renderTextlineList(entry, canonical, filter, sort, game)
        + `</div>`;
}
