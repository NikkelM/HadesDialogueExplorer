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
    renderSaveBadgeHtml,
} from './utilities.js';
import { getDialogueStatus, getSaveProgress, saveMatchesActiveGame } from './save-parser.js';

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

// --- Eligibility (save-status) filter ---
//
// A second, independent filter axis that only exists once a save is
// loaded that matches the active game. It slices owned dialogues by their
// save status - the same four-way played / eligible / blocked /
// unobtainable classification the eligibility tracer and the per-row save
// dot use (``getDialogueStatus``). With no matching save the axis
// collapses to 'all': the chips don't render and the filter is a no-op,
// so a shared ``eligibility=`` URL never lands the viewer on an empty
// list before a save is loaded.
const _ELIGIBILITY_BUCKETS = ['eligible', 'blocked', 'played', 'unobtainable'];
const _ELIGIBILITY_LABELS = {
    played: 'Played',
    eligible: 'Eligible',
    blocked: 'Blocked',
    unobtainable: 'Unobtainable',
};

// Public canonicaliser - mirrors ``canonicalisePriority`` so
// ``navigation.js`` can normalise the URL value before rendering.
export function canonicaliseEligibility(value) {
    if (value === 'all' || !value) return 'all';
    return _ELIGIBILITY_BUCKETS.indexOf(value) >= 0 ? value : 'all';
}

// True when a loaded save applies to the active game, so save-derived UI
// (the per-row dot, the eligibility chips, the summary counts) is
// meaningful. Mirrors the guard the other save-aware surfaces use.
function saveActive() {
    return !!getSaveProgress() && saveMatchesActiveGame();
}

// Tally owned dialogues by save status. Returns ``{}`` when no save
// applies. Shared by the eligibility chips and the summary counts cell so
// both read the same numbers.
function eligibilityCounts(entry) {
    const counts = {};
    if (!saveActive()) return counts;
    for (const name of entry.ownedTextlines || []) {
        const tl = textlines[name];
        if (!tl) continue;
        const status = getDialogueStatus(name, tl);
        if (status) counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
}

function eligibilityPasses(o, filter) {
    if (filter === 'all' || !saveActive()) return true;
    return getDialogueStatus(o.name, o.tl) === filter;
}

function sectionDisplay(sectionKey) {
    if (!sectionKey) return 'No section';
    return sectionKeyLabels[sectionKey] || sectionKey;
}

// H1 fragments dialogue contexts across many section keys where H2 uses
// one. The speaker view collapses each context into a single displayed
// group (matching H2), keyed by a representative section key. Three
// kinds of fragmentation are collapsed:
//   - Priority variants that share a label, e.g. "God boon pickup"
//     (SuperPriorityPickup / PriorityPickup / Pickup) and the four
//     "Boss introduction" intro tiers.
//   - Play-once vs repeatable splits: H1 puts repeatable fallback lines
//     in a separate ``*Repeatable*`` table labelled "X (repeatable)";
//     these fold into their play-once base "X" so a context's play-once
//     and repeatable lines share one section (the per-row badge + the
//     repeatability filter still distinguish them, exactly as on H2).
//   - Same-label event tables, e.g. OnDeath / OnTrophy* also labelled
//     "NPC interaction", and OnUsed labelled "Misc. interaction".
// Priority order within a merged group is preserved via
// ``narrativePrioritySectionTier`` (see ``compareWithinSection``). These
// keys are H1-only (absent in H2), so the map is a no-op there.
const _MERGED_SECTION_KEYS = {
    // "God boon pickup"
    PickupTextLineSets: 'PickupTextLineSets',
    PriorityPickupTextLineSets: 'PickupTextLineSets',
    SuperPriorityPickupTextLineSets: 'PickupTextLineSets',
    // "NPC interaction" (interact + repeatable fallback + on-death / trophy)
    InteractTextLineSets: 'InteractTextLineSets',
    RepeatableTextLineSets: 'InteractTextLineSets',
    OnDeathTextLineSets: 'InteractTextLineSets',
    OnTrophyRevealedTextLineSets: 'InteractTextLineSets',
    OnTrophyUnlockedTextLineSets: 'InteractTextLineSets',
    // "Misc. interaction"
    TextLineSet: 'TextLineSet',
    OnUsedTextLineSets: 'TextLineSet',
    // "Boss introduction" (four intro tiers + repeatable fallback)
    BossPresentationIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationPriorityIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationSuperPriorityIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationRepeatableTextLineSets: 'BossPresentationIntroTextLineSets',
    // "Boss outro" (+ repeatable fallback)
    BossPresentationOutroTextLineSets: 'BossPresentationOutroTextLineSets',
    BossPresentationOutroRepeatableTextLineSets: 'BossPresentationOutroTextLineSets',
};

function mergedSectionKey(sectionKey) {
    return _MERGED_SECTION_KEYS[sectionKey] || sectionKey;
}

// Display order for the H1 boss-encounter section groups, following the
// in-game flow rather than raw dialogue counts: introduction -> phase
// transition -> outro. (Repeatable intro/outro fold into introduction /
// outro via ``_MERGED_SECTION_KEYS``, so they are not listed here.)
// Keyed on the merged section key. Sections not listed keep the default
// rank and order by count, leaving other speakers untouched.
const _SECTION_ORDER = {
    BossPresentationIntroTextLineSets: 1,
    BossPresentationNextStageTextLineSets: 2,
    BossPresentationOutroTextLineSets: 3,
};
const _SECTION_ORDER_DEFAULT = 100;

function sectionOrderRank(key) {
    // Every explicit rank is >= 1, so ``||`` safely supplies the default.
    return _SECTION_ORDER[key] || _SECTION_ORDER_DEFAULT;
}

// Order two (merged) section keys for display: explicit flow rank first
// (the boss families), then dialogue count descending, then label.
function compareSections(keyA, countA, keyB, countB) {
    const ra = sectionOrderRank(keyA);
    const rb = sectionOrderRank(keyB);
    if (ra !== rb) return ra - rb;
    if (countA !== countB) return countB - countA;
    return sectionDisplay(keyA).localeCompare(sectionDisplay(keyB));
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

// Render the eligibility (save-status) filter chips with live counts.
// Only meaningful when a save applies to the active game; the caller
// (``renderTextlineControls``) omits the whole row otherwise. Counts come
// from the loaded save via ``eligibilityCounts``. The status-specific
// class drives the leading colour dot that echoes the per-row badge.
function renderEligibilityChips(entry, speakerId, currentFilter) {
    const counts = eligibilityCounts(entry);
    let total = 0;
    for (const b of _ELIGIBILITY_BUCKETS) total += counts[b] || 0;
    const chipBuckets = ['all', ..._ELIGIBILITY_BUCKETS];
    return chipBuckets.map(bucket => {
        const isActive = currentFilter === bucket;
        const dotClass = bucket === 'all' ? '' : ` eligibility-chip-${bucket}`;
        const cls = `priority-chip eligibility-chip${dotClass}${isActive ? ' is-active' : ''}`;
        const label = bucket === 'all' ? 'All' : _ELIGIBILITY_LABELS[bucket];
        const count = bucket === 'all' ? total : (counts[bucket] || 0);
        const aria = isActive ? ' aria-pressed="true"' : ' aria-pressed="false"';
        return `<button type="button" class="${cls}"${aria} onclick="event.stopPropagation(); filterSpeakerEligibility(${jsAttr(speakerId)}, ${jsAttr(bucket)})">${escapeHtml(label)}: <span class="speaker-count">${count}</span></button>`;
    }).join('');
}

// Within-section ordering of textlines, matching each game's natural
// in-game play order. On H2 dialogues play in narrative-rank order
// (rank 1 first); rank-less dialogues (repeatables) sort last. On H1
// there is no rank, so play-once dialogues order by their
// narrative-priority tier (super-priority, priority, normal, low) and
// repeatable dialogues - the fallback that only plays when no play-once
// line is eligible - sort after all of them (mirroring H2's
// repeatables-last). Ties fall back to alphabetical by name.
function compareWithinSection(a, b, game) {
    if ((game || getActiveGame()) === 'hades2') {
        const ra = Number.isInteger(a.tl.narrativePriorityOrdinal) ? a.tl.narrativePriorityOrdinal : Infinity;
        const rb = Number.isInteger(b.tl.narrativePriorityOrdinal) ? b.tl.narrativePriorityOrdinal : Infinity;
        if (ra !== rb) return ra - rb;
    } else {
        const ra = h1SortRank(a.tl);
        const rb = h1SortRank(b.tl);
        if (ra !== rb) return ra - rb;
    }
    return a.name.localeCompare(b.name);
}

// H1 play-order rank for a textline within its section. Play-once lines
// rank by narrative-priority tier (0..3); repeatable lines are the
// lowest-priority fallback and rank after every play-once tier.
function h1SortRank(tl) {
    if (!(tl && tl.playOnce)) return 4;
    return h1TierRank(tl);
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

    // Collapse same-label section variants (e.g. the three god-boon
    // pickup priority tiers) into one row so the breakdown matches the
    // grouped textline list below.
    const mergedCounts = {};
    for (const [key, count] of Object.entries(sectionCounts)) {
        const mk = mergedSectionKey(key);
        mergedCounts[mk] = (mergedCounts[mk] || 0) + count;
    }
    const sectionEntries = Object.entries(mergedCounts)
        .sort((a, b) => compareSections(a[0], a[1], b[0], b[1]));
    const sectionsHtml = sectionEntries.length
        ? sectionEntries.map(([key, count]) =>
            `<li>${renderSectionHtml(key)}: <span class="speaker-count">${count}</span></li>`
        ).join('')
        : '<li class="muted">none</li>';

    // The save-progress cell only renders with a matching save loaded.
    // When present it makes a fourth column, so widen the grid to keep
    // all cells on one aligned row (the CSS default is three columns).
    const eligibilityCell = renderEligibilitySummaryCell(entry);
    const rowClass = eligibilityCell
        ? 'speaker-summary-row speaker-summary-row-4'
        : 'speaker-summary-row';

    return `<section class="speaker-summary">`
        + `<div class="${rowClass}">`
        + `<div class="speaker-summary-cell"><h4>Owned dialogues</h4><div class="speaker-summary-value">${owned}</div></div>`
        + `<div class="speaker-summary-cell"><h4>As guest speaker</h4><div class="speaker-summary-value">${asSpeaker}</div><div class="speaker-summary-note">speaks in textlines owned by other speakers</div></div>`
        + `<div class="speaker-summary-cell speaker-summary-sections"><h4>Sections</h4><ul class="speaker-section-list">${sectionsHtml}</ul></div>`
        + eligibilityCell
        + `</div>`
        + `</section>`;
}

// Save-progress breakdown cell (played / eligible / blocked /
// unobtainable counts), shown only when a save applies to the active
// game. Each row carries the same coloured dot as the per-textline badge
// so the summary and the list read consistently. Returns '' otherwise so
// the summary keeps its three-cell shape with no save loaded.
function renderEligibilitySummaryCell(entry) {
    if (!saveActive()) return '';
    const counts = eligibilityCounts(entry);
    const items = _ELIGIBILITY_BUCKETS
        .filter(b => counts[b])
        .map(b => `<li><span class="save-badge ${b}"></span>${escapeHtml(_ELIGIBILITY_LABELS[b])}: <span class="speaker-count">${counts[b]}</span></li>`)
        .join('');
    const body = items || '<li class="muted">none</li>';
    return `<div class="speaker-summary-cell speaker-summary-eligibility"><h4>Save progress</h4><ul class="speaker-section-list">${body}</ul></div>`;
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
function renderTextlineList(entry, speakerId, filter, eligFilter, game) {
    const owned = (entry.ownedTextlines || [])
        .map(n => ({ name: n, tl: textlines[n] }))
        .filter(o => o.tl);
    const filtered = owned.filter(o =>
        filterPassesBucket(priorityBucket(o.tl), filter) && eligibilityPasses(o, eligFilter));

    const controls = renderTextlineControls(entry, speakerId, filter, eligFilter);

    if (filtered.length === 0) {
        return `<section class="speaker-textlines">${controls}<p class="muted speaker-textlines-empty">No textlines match the current filter.</p></section>`;
    }

    const groups = new Map();
    for (const o of filtered) {
        const sec = mergedSectionKey(o.tl.section || '');
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(o);
    }
    const orderedSections = Array.from(groups.keys()).sort((a, b) =>
        compareSections(a, groups.get(a).length, b, groups.get(b).length));
    const body = orderedSections.map(sec => {
        const rows = groups.get(sec).slice().sort((a, b) => compareWithinSection(a, b, game));
        const header = sec
            ? renderSectionHtml(sec)
            : `<span class="section-name">(unknown section)</span>`;
        // Collapsed by default (no ``expanded`` modifier); the header
        // toggles it. Matches the ``alternates-group`` collapse pattern.
        return `<div class="speaker-textline-group">`
            + `<h5 class="speaker-textline-group-header" onclick="this.parentElement.classList.toggle('expanded')">`
            + `<span class="speaker-group-chevron">\u25B6</span>`
            + `${header} <span class="speaker-count">${rows.length}</span>`
            + `</h5>`
            + `<ul class="speaker-textline-list">${rows.map(o => renderTextlineRow(o.name, o.tl)).join('')}</ul>`
            + `</div>`;
    }).join('');

    return `<section class="speaker-textlines">${controls}${body}</section>`;
}

// Render the controls strip above the textline list: the repeatability
// filter chips, plus the eligibility (save-status) filter chips on a
// second row when a save applies to the active game.
function renderTextlineControls(entry, speakerId, filter, eligFilter) {
    const priorityChips = renderPriorityChips(entry, speakerId, filter);
    let html = `<div class="speaker-textline-controls">`
        + `<span class="speaker-control-label">Filter:</span>`
        + `<div class="speaker-priority-chips" role="group" aria-label="Repeatability filter">${priorityChips}</div>`
        + `</div>`;
    if (saveActive()) {
        const eligChips = renderEligibilityChips(entry, speakerId, eligFilter);
        html += `<div class="speaker-textline-controls">`
            + `<span class="speaker-control-label">Eligibility:</span>`
            + `<div class="speaker-priority-chips" role="group" aria-label="Eligibility filter">${eligChips}</div>`
            + `</div>`;
    }
    return html;
}

function renderTextlineRow(name, tl) {
    const saveBadge = renderSaveBadgeHtml(name, tl);
    const priority = renderPrimaryPriorityBadgeHtml(tl);
    const playOnce = renderPlayOnceBadgeHtml(tl);
    return `<li class="speaker-textline-row">`
        + saveBadge
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
    const eligFilter = canonicaliseEligibility(opts && opts.eligibility);
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
        + renderTextlineList(entry, canonical, filter, eligFilter, game)
        + `</div>`;
}
