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

import { textlines, speakers, sectionKeyLabels, gameLabels, getActiveGame, alternates, dependents } from './data.js';
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

// Shared renderer for a single filter chip (repeatability or
// eligibility). A chip whose selection would produce an empty list is
// disabled - greyed out and unclickable - so the user can't pivot the
// list into a dead end. The currently-active chip is never disabled (it
// stays clickable so an empty combination reached via a shared URL can
// always be toggled back out). ``extraCls`` carries the eligibility
// colour-dot class; ``count`` is the size of the list the chip yields.
function renderFilterChip({ cls, extraCls = '', label, count, isActive, onclick }) {
    const isDisabled = count === 0 && !isActive;
    const classes = cls + extraCls
        + (isActive ? ' is-active' : '')
        + (isDisabled ? ' is-disabled' : '');
    const aria = ` aria-pressed="${isActive ? 'true' : 'false'}"`;
    const disabled = isDisabled ? ' disabled' : '';
    return `<button type="button" class="${classes}"${aria}${disabled} onclick="event.stopPropagation(); ${onclick}">${escapeHtml(label)}: <span class="speaker-count">${count}</span></button>`;
}

// Render the repeatability filter chips (with counts). Clickable: each
// navigates to the same speaker with the matching ``priority`` URL key,
// pivoting the textline list. The active chip carries an ``is-active``
// class + ``aria-pressed`` flag. Chip list and labels come from
// ``priorityScheme``. Returns the chip buttons' HTML (no wrapper).
//
// Counts are tallied within the current eligibility filter so each chip's
// number - and its disabled state - reflects what selecting it would
// actually yield once both filter axes combine. With no save (or the
// eligibility axis on 'all') this collapses to the plain owned counts.
function renderPriorityChips(entry, speakerId, currentFilter, eligFilter) {
    const ownedNames = entry.ownedTextlines || [];
    const scheme = priorityScheme();
    const bucketCounts = {};
    let total = 0;
    for (const name of ownedNames) {
        const tl = textlines[name];
        if (!tl) continue;
        if (!eligibilityPasses({ name, tl }, eligFilter)) continue;
        total += 1;
        const b = priorityBucket(tl);
        bucketCounts[b] = (bucketCounts[b] || 0) + 1;
    }
    const chipBuckets = ['all', ...scheme.buckets];
    return chipBuckets.map(bucket => renderFilterChip({
        cls: 'priority-chip',
        label: bucket === 'all' ? 'All' : scheme.labels[bucket],
        count: bucket === 'all' ? total : (bucketCounts[bucket] || 0),
        isActive: currentFilter === bucket,
        onclick: `filterSpeakerPriority(${jsAttr(speakerId)}, ${jsAttr(bucket)})`,
    })).join('');
}

// Render the eligibility (save-status) filter chips with live counts.
// Only meaningful when a save applies to the active game; the caller
// (``renderTextlineControls``) omits the whole row otherwise. Counts are
// tallied within the current repeatability filter (mirroring
// ``renderPriorityChips``) so each chip reflects the combined result and
// a chip that would empty the list renders disabled. The status-specific
// class drives the leading colour dot that echoes the per-row badge.
function renderEligibilityChips(entry, speakerId, currentFilter, priorityFilter) {
    const counts = {};
    let total = 0;
    for (const name of entry.ownedTextlines || []) {
        const tl = textlines[name];
        if (!tl) continue;
        if (!filterPassesBucket(priorityBucket(tl), priorityFilter)) continue;
        const status = getDialogueStatus(name, tl);
        if (!status) continue;
        counts[status] = (counts[status] || 0) + 1;
        total += 1;
    }
    const chipBuckets = ['all', ..._ELIGIBILITY_BUCKETS];
    return chipBuckets.map(bucket => renderFilterChip({
        cls: 'priority-chip eligibility-chip',
        extraCls: bucket === 'all' ? '' : ` eligibility-chip-${bucket}`,
        label: bucket === 'all' ? 'All' : _ELIGIBILITY_LABELS[bucket],
        count: bucket === 'all' ? total : (counts[bucket] || 0),
        isActive: currentFilter === bucket,
        onclick: `filterSpeakerEligibility(${jsAttr(speakerId)}, ${jsAttr(bucket)})`,
    })).join('');
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

// Render the cross-speaker dependency tables: which speakers this one
// depends on (its dialogues require their lines) and which speakers
// depend on it. Each row is expandable to list the actual dialogue
// links - derived client-side from the requirements / dependents data
// and rendered lazily on first expand (see ``toggleAdjacencyRow``) so a
// busy speaker's many links don't bloat the initial markup. Self-loops
// are kept and tagged (a speaker frequently gates on its own textlines
// via cooldown / sequence chains; that IS useful information).
//
// ``_adjDetail`` holds the per-direction link maps for the speaker last
// rendered, so the lazy expand handler can build a row's detail:
//   Map(otherCanonicalId -> Map(dependentTextline -> Set(requiredTextline)))
let _adjDetail = { up: new Map(), down: new Map() };

function renderAdjacency(entry, canonicalSelf) {
    const selfName = entry.name || canonicalSelf || '';
    const up = entry.adjacencyUpstream || {};
    const down = entry.adjacencyDownstream || {};
    _adjDetail = buildAdjacencyDetail(entry.ownedTextlines || []);

    const upRows = Object.entries(up).sort((a, b) => b[1] - a[1]);
    const downRows = Object.entries(down).sort((a, b) => b[1] - a[1]);

    const upBody = upRows.length
        ? `<ul class="speaker-adjacency-list" style="--adj-name-col: ${_adjNameColCh(upRows)}ch">${upRows.map(([sid, count]) => renderAdjacencyRow(sid, count, 'up', canonicalSelf, selfName)).join('')}</ul>`
        : `<p class="muted">${escapeHtml(selfName)}'s dialogues don't reference any other speaker's dialogues.</p>`;
    const downBody = downRows.length
        ? `<ul class="speaker-adjacency-list" style="--adj-name-col: ${_adjNameColCh(downRows)}ch">${downRows.map(([sid, count]) => renderAdjacencyRow(sid, count, 'down', canonicalSelf, selfName)).join('')}</ul>`
        : `<p class="muted">No other speaker's dialogues reference ${escapeHtml(selfName)}'s dialogues.</p>`;

    return `<section class="speaker-adjacency">`
        + renderAdjacencyCol('Depends on', `${selfName}'s dialogues require lines from these speakers`, '\u2192', upBody)
        + renderAdjacencyCol('Required by', `these speakers' dialogues require ${selfName}'s lines`, '\u2190', downBody)
        + `</section>`;
}

function renderAdjacencyCol(title, sub, arrow, body) {
    return `<div class="speaker-adjacency-col">`
        + `<div class="speaker-adjacency-head">`
        + `<h4><span class="speaker-adjacency-dir">${arrow}</span> ${escapeHtml(title)}</h4>`
        + `<p class="speaker-adjacency-sub">${escapeHtml(sub)}</p>`
        + `</div>`
        + body
        + `</div>`;
}

// One adjacency row: ``FriendlyName (InternalId)`` in a fixed-width cell
// (so the count chips line up in a column, like the duplicates view's
// game buttons), then the count chip and an optional ``self`` tag, then
// an empty detail list populated on first expand. ``dir`` is 'up' (this
// speaker depends on the other) or 'down' (the other depends on this).
function renderAdjacencyRow(sid, count, dir, canonicalSelf, selfName) {
    const otherName = displayNameFor(sid);
    const isSelf = sid === canonicalSelf;
    const selfTag = isSelf
        ? `<span class="speaker-adjacency-self" data-tooltip="This speaker references its own dialogues (e.g. cooldowns or sequence chains).">self</span>`
        : '';
    const tip = dir === 'up'
        ? `${count} of ${selfName}'s dialogues require at least one of ${otherName}'s. Click to list them.`
        : `${count} of ${otherName}'s dialogues require at least one of ${selfName}'s. Click to list them.`;
    return `<li class="speaker-adjacency-item" data-adj-dir="${escapeHtml(dir)}" data-adj-sid="${escapeHtml(sid)}">`
        + `<div class="speaker-adjacency-row" onclick="toggleAdjacencyRow(this.parentElement)">`
        + `<span class="speaker-adjacency-chevron">\u25B6</span>`
        + `<span class="speaker-adjacency-nameid">`
        + `<a class="speaker-link" onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(sid)})">${escapeHtml(otherName)}</a>`
        + ` <span class="speaker-id-inline">(${escapeHtml(sid)})</span>`
        + `</span>`
        + `<span class="speaker-adjacency-count" data-tooltip="${escapeHtml(tip)}">${count}</span>`
        + selfTag
        + `</div>`
        + `<ul class="speaker-adjacency-detail"></ul>`
        + `</li>`;
}

// Width (in ``ch``) for the name+id cell: the longest
// ``FriendlyName (InternalId)`` string in the list. Drives the
// ``--adj-name-col`` custom property so every count chip starts at the
// same x. Proportional text is narrower than ``ch``, so this slightly
// over-reserves, which keeps the longest row from ever truncating.
function _adjNameColCh(rows) {
    let max = 0;
    for (const [sid] of rows) {
        const len = displayNameFor(sid).length + sid.length + 3; // " (" + ")"
        if (len > max) max = len;
    }
    return max;
}

// Expand/collapse handler for an adjacency row. On first expand it
// renders the dialogue-link detail (lazy) from ``_adjDetail``. Exposed
// globally for the inline ``onclick``.
export function toggleAdjacencyRow(itemEl) {
    if (!itemEl) return;
    const expanding = !itemEl.classList.contains('expanded');
    itemEl.classList.toggle('expanded');
    if (!expanding) return;
    const detailUl = itemEl.querySelector('.speaker-adjacency-detail');
    if (!detailUl || detailUl.dataset.loaded === '1') return;
    const linkMap = (_adjDetail[itemEl.dataset.adjDir] || new Map()).get(itemEl.dataset.adjSid);
    detailUl.innerHTML = renderAdjacencyDetailRows(linkMap);
    detailUl.dataset.loaded = '1';
}

// Build the dialogue-link detail for every adjacency edge of a speaker,
// in one pass over its owned textlines. ``up`` records this speaker's
// dialogues that require another's (dependent -> required); ``down``
// records other speakers' dialogues that require this one's. The
// dependent-count per edge equals the ``adjacency*`` row count, so the
// detail and the chip always agree.
export function buildAdjacencyDetail(ownedTextlines) {
    const up = new Map();
    const down = new Map();
    for (const aName of ownedTextlines) {
        const tl = textlines[aName];
        if (!tl) continue;
        for (const refList of Object.values(tl.requirements || {})) {
            if (!Array.isArray(refList)) continue;
            for (const ref of refList) {
                const refTl = textlines[ref];
                if (!refTl || !refTl.owner) continue;
                _recordAdjacencyLink(up, canonicalSpeakerId(refTl.owner), aName, ref);
            }
        }
        const deps = dependents[aName];
        if (!Array.isArray(deps)) continue;
        for (const dep of deps) {
            const depName = typeof dep === 'string' ? dep : (dep && dep.name);
            if (!depName) continue;
            const depTl = textlines[depName];
            if (!depTl || !depTl.owner) continue;
            _recordAdjacencyLink(down, canonicalSpeakerId(depTl.owner), depName, aName);
        }
    }
    return { up, down };
}

function _recordAdjacencyLink(map, sid, dependentName, requiredName) {
    if (!map.has(sid)) map.set(sid, new Map());
    const edge = map.get(sid);
    if (!edge.has(dependentName)) edge.set(dependentName, new Set());
    edge.get(dependentName).add(requiredName);
}

// Render the detail rows for one expanded edge: each dependent dialogue
// and the line(s) it requires (``dependent -> required``), all clickable.
export function renderAdjacencyDetailRows(linkMap) {
    if (!linkMap || linkMap.size === 0) {
        return `<li class="muted speaker-adjacency-detail-empty">No individual links.</li>`;
    }
    return [...linkMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dependent, requiredSet]) => {
            const required = [...requiredSet].sort()
                .map(r => `<a class="textline-link" onclick="event.stopPropagation(); navigateTo(${jsAttr(r)})">${escapeHtml(r)}</a>`)
                .join('<span class="speaker-adjacency-sep">, </span>');
            return `<li class="speaker-adjacency-detail-row">`
                + `<a class="textline-link speaker-adjacency-dep" onclick="event.stopPropagation(); navigateTo(${jsAttr(dependent)})">${escapeHtml(dependent)}</a>`
                + `<div class="speaker-adjacency-reqs"><span class="speaker-adjacency-req-label">requires</span> ${required}</div>`
                + `</li>`;
        }).join('');
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
    // Preserve which sections the user expanded across re-renders (filter /
    // eligibility changes) for the SAME speaker; reset for a new speaker.
    if (speakerId !== _expandedSpeaker) {
        _expandedSpeaker = speakerId;
        _expandedSections = new Set();
    }
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
        // Collapsed by default; an expanded section is remembered (see
        // ``_expandedSections``) so it survives a filter / eligibility
        // re-render. The header toggle records the new state.
        const expandedClass = _expandedSections.has(sec) ? ' expanded' : '';
        return `<div class="speaker-textline-group${expandedClass}">`
            + `<h5 class="speaker-textline-group-header" onclick="toggleSpeakerSection(this, ${jsAttr(sec)})">`
            + `<span class="speaker-group-chevron">\u25B6</span>`
            + `${header} <span class="speaker-count">${rows.length}</span>`
            + `</h5>`
            + `<ul class="speaker-textline-list">${renderSectionRowsHtml(rows)}</ul>`
            + `</div>`;
    }).join('');

    return `<section class="speaker-textlines">${controls}${body}</section>`;
}

// Section expand/collapse state, preserved across re-renders for the SAME
// speaker so a section the user opened stays open when they change the
// repeatability / eligibility filters. Keyed by merged section key; reset
// in ``renderTextlineList`` when a different speaker is rendered.
let _expandedSpeaker = null;
let _expandedSections = new Set();

// Section-header click target: toggle the group open/closed and record the
// choice so the next re-render keeps it. Exposed globally for the inline
// ``onclick`` in the rendered header.
export function toggleSpeakerSection(headerEl, sectionKey) {
    const group = headerEl && headerEl.parentElement;
    if (!group) return;
    const nowExpanded = group.classList.toggle('expanded');
    if (nowExpanded) _expandedSections.add(sectionKey);
    else _expandedSections.delete(sectionKey);
}

// Render a section's rows, grouping mutually-exclusive alternate variants
// (e.g. ``SomeLine01`` / ``SomeLine01_B``) into a single labelled cluster
// so the list reads as one logical line with its variants, rather than N
// near-identical rows. Only variants co-present in this section's rows are
// clustered; a lone variant renders as a normal row. Order within the
// cluster follows the already-sorted ``rows``.
function renderSectionRowsHtml(rows) {
    const grouped = new Set();
    let html = '';
    for (const o of rows) {
        if (grouped.has(o.name)) continue;
        const siblings = alternates[o.name];
        if (siblings && siblings.length) {
            const names = new Set([o.name, ...siblings]);
            const cluster = rows.filter(r => names.has(r.name) && !grouped.has(r.name));
            if (cluster.length >= 2) {
                for (const c of cluster) grouped.add(c.name);
                html += renderAlternatesClusterHtml(cluster);
                continue;
            }
        }
        grouped.add(o.name);
        html += renderTextlineRow(o.name, o.tl);
    }
    return html;
}

// A cluster of mutually-exclusive alternate variants: a labelled box (the
// gold ``Alternates`` accent shared with the dialogue detail view) wrapping
// the variant rows.
function renderAlternatesClusterHtml(cluster) {
    const rowsHtml = cluster.map(o => renderTextlineRow(o.name, o.tl)).join('');
    return `<li class="speaker-alt-group" data-tooltip="Mutually exclusive variants - only one of these can play; the others are blocked once one does.">`
        + `<div class="speaker-alt-group-label">Alternates <span class="speaker-count">${cluster.length}</span></div>`
        + `<ul class="speaker-alt-group-rows">${rowsHtml}</ul>`
        + `</li>`;
}

// Render the controls strip above the textline list: the repeatability
// filter chips, plus the eligibility (save-status) filter chips on a
// second row when a save applies to the active game.
function renderTextlineControls(entry, speakerId, filter, eligFilter) {
    const priorityChips = renderPriorityChips(entry, speakerId, filter, eligFilter);
    let html = `<div class="speaker-textline-controls">`
        + `<span class="speaker-control-label">Filter:</span>`
        + `<div class="speaker-priority-chips" role="group" aria-label="Repeatability filter">${priorityChips}</div>`
        + `</div>`;
    if (saveActive()) {
        const eligChips = renderEligibilityChips(entry, speakerId, eligFilter, filter);
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
            + similar.map(s => `<a class="speaker-similar-pill" role="button" data-tooltip="${escapeHtml(s.id)}" onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(s.id)})">${escapeHtml(s.name)}</a>`).join('')
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
        + renderAdjacency(entry, canonical)
        + renderTextlineList(entry, canonical, filter, eligFilter, game)
        + `</div>`;
}
