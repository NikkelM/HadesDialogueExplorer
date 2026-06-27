// Rendering utilities and label formatters.
//
// Pure functions that turn dataset entries into HTML fragments shared
// across the info panel, search results, tree rows, and badges. All
// data lookups go through ``./data.js`` so live-binding updates
// after ``loadData`` propagate transparently.

import {
    textlines,
    speakers,
    sectionKeyLabels,
    reqTypeLabels,
    reqTypeEdgeLabels,
    reqTypeTooltips,
    reqTypeLabelsDependents,
    reqTypeTooltipsDependents,
    _reqTypeOrderIndex,
    knownUnresolved,
    unresolvedCategoryLabels,
    choiceNames,
    getActiveGame,
} from './data.js';
import { getDialogueStatus, getSaveProgress, saveMatchesActiveGame } from './save-parser.js';

// Human-readable tooltips for each save-derived dialogue status, shared by
// every surface that renders a status dot/pill so the wording stays in
// lockstep. A dialogue's status now reflects all of its gates - textline
// requirements AND non-textline game-state conditions. ``indeterminate``
// covers anything the save can't resolve: a run-scoped textline record (the
// Hades II queue or current-run state) or a live game-state condition.
export const SAVE_STATUS_TOOLTIPS = {
    played: 'Played in loaded save',
    eligible: 'Eligible to play (every requirement and condition is met)',
    blocked: 'Blocked (a requirement or condition is not met)',
    unobtainable: 'Unobtainable - a required choice, mutually-exclusive line, count-max gate, or play-once run-count gate is permanently locked',
    indeterminate: 'Indeterminate - gates on something this save can\u2019t resolve: a run-scoped textline record (the Hades II queue or current-run state) or a live game-state condition (run / room / session state, or a game function), so eligibility can\u2019t be determined',
};

export function saveStatusTooltip(status) {
    return SAVE_STATUS_TOOLTIPS[status] || '';
}

// Tooltip for a requirement-group / OR-option / "other requirements" dot.
// Generalised over BOTH dialogue-line requirements and non-textline game-state
// conditions, since a group dot can now reflect either (or a mix). Shared by
// the dependency tree (``makeGroupStatusBadge``) and the detail panel so the
// wording stays in lockstep.
export function groupStatusTooltip(status) {
    switch (status) {
    case 'met':
        return 'Satisfied by your save: every condition here holds (required lines played, forbidden lines not played, and any game-state checks met).';
    case 'unmet':
        return 'Not satisfied by your save: at least one condition here isn\u2019t met yet.';
    case 'unobtainable':
        return 'Permanently locked: this can never be satisfied again in this save (e.g. a one-time line already played or now past its run-count window, a count cap exceeded, or a required line that is itself unobtainable).';
    case 'unknown':
        return 'Can\u2019t be determined from your save: it depends on something the save doesn\u2019t resolve - a run-scoped textline record (the Hades II queue or current-run state) or a live game-state condition (run / room / session state, or a game function).';
    default:
        return '';
    }
}

// Coloured save-status dot for one dialogue, read from the loaded save.
// Returns '' when no save is loaded or it doesn't match the active game,
// so callers can interpolate it unconditionally. Shared by the
// eligibility tracer tree and the speaker overview list so both surfaces
// render an identical badge.
export function renderSaveBadgeHtml(name, tl) {
    if (!tl || !getSaveProgress() || !saveMatchesActiveGame()) return '';
    const status = getDialogueStatus(name, tl);
    if (!status) return '';
    return `<span class="save-badge ${status}" role="img" aria-label="${escapeHtml(saveStatusTooltip(status))}" data-tooltip="${escapeHtml(saveStatusTooltip(status))}"></span>`;
}

// Escape a string for safe embedding into HTML, covering both text
// content and double-quoted attribute values (the only attribute-quote
// style used in the templates here). Escaping ``"`` in addition to
// the three text-content metacharacters is a free hardening: it has
// no effect inside element text, and it prevents an attribute value
// from breaking out of its surrounding ``"..."`` if a future game
// adds quotes to an identifier. Use :func:`jsAttr` instead when the
// value also needs to be a JavaScript string literal (e.g. inline
// ``onclick``).
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Render a string value safe for embedding inside a quoted HTML
// attribute that is also a JavaScript string literal (e.g.
// ``onclick="navigateTo(${jsAttr(ref)})"``). ``JSON.stringify``
// produces a properly-escaped JS string literal (handles backslashes,
// quotes, control chars, unicode) including its own outer quotes, and
// the subsequent :func:`escapeHtml` pass (which also escapes ``"``)
// keeps the embedded quotes from terminating the surrounding
// attribute. Call sites must NOT add their own quotes around the
// placeholder.
export function jsAttr(s) {
    return escapeHtml(JSON.stringify(String(s)));
}

// Look up the friendly display name for a speaker/NPC ID, falling back to
// the internal ID when no mapping exists.
export function displayName(id) {
    return speakers[id]?.name || id;
}

// Render a speaker/NPC name as HTML: friendly label with the internal ID
// and (when available) a one-line character description quip available
// via a multi-line ``data-tooltip`` popup (rendered by the floating
// tooltip layer in ``tooltip.js``).
//
// Tooltip format:
//   friendly + description:    "Friendly (internal id)\nDescription"
//   friendly without quip:     "Friendly (internal id)"
//   no friendly + description: "Description"          (id already visible)
//   no friendly, no quip:      <no tooltip>           (id already visible)
//
// Speakers click through to the speaker overview view by default. The
// inline ``onclick`` calls ``event.stopPropagation()`` first so a
// click on a speaker name inside a parent click-handler container
// (tree row label, info-panel link) routes to the speaker view rather
// than re-rooting the parent's textline. Pass ``{ clickable: false }``
// to render the name as plain (tooltip-only) text - used in search
// results, where every speaker name sits inside a row whose own click
// should open the matched dialogue, not divert to the speaker. The
// ``speaker-name`` class itself doesn't visually advertise clickability;
// the CSS layer adds the cursor + hover styling (only with the
// ``clickable`` class) so the click affordance stays in sync.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - the friendly label, internal-ID tooltip, and description
// quip are all routed through escapeHtml below.
export function renderSpeakerHtml(id, { clickable = true } = {}) {
    const entry = speakers[id] || {};
    const friendly = entry.name;
    const description = entry.description;
    const cls = clickable ? 'speaker-name clickable' : 'speaker-name';
    const clickAttr = clickable ? ` onclick="event.stopPropagation(); navigateToSpeaker(${jsAttr(id)})"` : '';
    if (friendly && friendly !== id) {
        const titleParts = [`${friendly} (${id})`];
        if (description) titleParts.push(description);
        return `<span class="${cls}" data-tooltip="${escapeHtml(titleParts.join('\n'))}"${clickAttr}>${escapeHtml(friendly)}</span>`;
    }
    if (description) {
        return `<span class="${cls}" data-tooltip="${escapeHtml(description)}"${clickAttr}>${escapeHtml(id)}</span>`;
    }
    return `<span class="${cls}"${clickAttr}>${escapeHtml(id)}</span>`;
}

export function getEdgeClass(type) {
    if (type.includes('False')) return 'edge-false';
    if (type.includes('Any')) return 'edge-any';
    return 'edge-all';
}

// All label/order data lives in Python (see textline_set.py); these
// helpers are pure lookups against the maps injected via DATA.
export function reqTypeOrderIndex(type) {
    const i = _reqTypeOrderIndex[type];
    return i === undefined ? 999 : i;
}

export function getEdgeLabel(type) {
    return reqTypeEdgeLabels[type] || 'ALL';
}

// Direction-aware friendly label for a requirement type. The downstream
// (dependents) tree describes how the rooted textline gates a list of
// dependent textlines, so the wording flips perspective. Both maps
// share the same field-name keys; the dependents map is a strict
// subset (only textline-dependency fields can surface as downstream
// edges) so missing-key fallback chains through the upstream label
// before degrading to the raw field name.
export function formatReqType(type, direction = 'upstream') {
    if (direction === 'downstream') {
        return reqTypeLabelsDependents[type] || reqTypeLabels[type] || type;
    }
    return reqTypeLabels[type] || type;
}

// Build the tooltip-attribute string for a requirement-type label. When
// a plain-English blurb is known for the field, the tooltip is rendered
// as the internal field name on the first line, a blank line, and the
// blurb beneath. Otherwise we fall back to the internal-name-only
// tooltip so unmapped types still get the
// hover-to-reveal-internal-name affordance.
//
// Returns ``null`` when no friendly label exists either: in that case
// the rendered span already shows the internal name as its text, so an
// echoing tooltip would be redundant.
//
// ``direction`` switches between the upstream (prerequisites) and
// downstream (dependents) wording. Same fallback chain as
// ``formatReqType``: dependents map -> upstream map -> bare field name.
// The header line always shows the internal field name regardless of
// direction.
export function reqTypeTitleText(type, direction = 'upstream') {
    const friendly = (direction === 'downstream'
        ? (reqTypeLabelsDependents[type] || reqTypeLabels[type])
        : reqTypeLabels[type]);
    if (!friendly || friendly === type) return null;
    const header = `Internal name: ${type}`;
    const blurb = (direction === 'downstream'
        ? (reqTypeTooltipsDependents[type] || reqTypeTooltips[type])
        : reqTypeTooltips[type]);
    return blurb ? `${header}\n\n${blurb}` : header;
}

// Render a requirement-type label as HTML: friendly name with the
// internal field key (and a plain-English explanation when known)
// available as a custom tooltip popup. Mirrors ``renderSpeakerHtml`` /
// ``renderSectionHtml`` so the hover-to-reveal-internal-name affordance
// is consistent across the three label families.
//
// ``direction`` (``'upstream'`` | ``'downstream'``) picks the
// perspective-appropriate label / tooltip wording.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at
// the call site - both the friendly label and the tooltip text are
// already routed through escapeHtml below.
export function renderReqTypeHtml(type, extraClass, direction = 'upstream') {
    const friendly = (direction === 'downstream'
        ? (reqTypeLabelsDependents[type] || reqTypeLabels[type])
        : reqTypeLabels[type]);
    const cls = `req-type-name${extraClass ? ' ' + extraClass : ''}`;
    const titleText = reqTypeTitleText(type, direction);
    if (titleText !== null) {
        return `<span class="${cls}" data-tooltip="${escapeHtml(titleText)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="${cls}">${escapeHtml(type)}</span>`;
}

// Render a section key as HTML: friendly label with the internal key
// available as a custom tooltip popup when a mapping exists, falling
// back to the raw key when no mapping is registered. The build
// pipeline audits the labels map against the section-key allowlist so
// any missing entry becomes a build-time warning rather than silently
// rendering the raw key here. Mirrors ``renderSpeakerHtml`` so both
// UI surfaces (search dropdown + details view) get the same
// hover-to-reveal-internal-name behaviour, including the dotted-
// underline affordance via the ``[data-tooltip]`` attribute selector.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - both the friendly label and the internal-key tooltip are
// already routed through escapeHtml below.
export function renderSectionHtml(key) {
    const friendly = sectionKeyLabels[key];
    if (friendly && friendly !== key) {
        return `<span class="section-name" data-tooltip="${escapeHtml(key)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="section-name">${escapeHtml(key)}</span>`;
}

// Render a choice ``ChoiceText`` identifier as HTML: friendly label
// with the internal id available as a custom tooltip popup when a
// mapping exists, falling back to the raw internal id otherwise.
// Mirrors :func:`renderSectionHtml` / :func:`renderSpeakerHtml` so the
// hover-to-reveal-internal-name affordance is consistent across the
// label families. Returns the inner ``<span>`` only - the call site is
// responsible for wrapping it in a clickable element when navigation
// is desired (see ``info-panel.js`` choice-summary box).
//
// ``extraTooltipLine`` (optional) appends a second line to the tooltip
// after the internal id. Used by gated boon-vendor choices to surface
// the required Mirror of Night upgrade ("Requires Death Defiance
// (Mirror of Night)") without crowding the dialogue layout. The extra
// line is shown even when the friendly label equals the internal id
// (so unmapped gated choices still surface the requirement).
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - the friendly label, internal-key tooltip, and extra
// tooltip line are all routed through escapeHtml below.
export function renderChoiceNameHtml(internal, extraTooltipLine = null) {
    const friendly = choiceNames[internal];
    const hasFriendly = friendly && friendly !== internal;
    const tooltipParts = [];
    if (hasFriendly) tooltipParts.push(internal);
    if (extraTooltipLine) tooltipParts.push(extraTooltipLine);
    const tooltipAttr = tooltipParts.length > 0
        ? ` data-tooltip="${escapeHtml(tooltipParts.join('\n'))}"`
        : '';
    const visible = hasFriendly ? friendly : internal;
    return `<span class="choice-name"${tooltipAttr}>${escapeHtml(visible)}</span>`;
}

// Returns the category id ('back-compatibility', 'typo-or-bug', 'cut-content')
// for a known unresolved ref, or 'uncategorized' for one not in the
// hardcoded list, or null if the ref is fully resolved.
export function unresolvedCategoryFor(name) {
    if (name in textlines) return null;
    const known = knownUnresolved[name];
    return known ? known.category : 'uncategorized';
}

// Render narrative-priority badges as HTML for either the tree or the
// details panel. The two games use independent priority models and we
// dispatch per active game:
//
//   - Hades I: tier badge (super / priority / normal / low) + optional
//     set-level pill (SP / P). Tier is derived from the parent section
//     the textline lives in; the engine cascades through priority-
//     tagged sibling containers at the call site, so this is the
//     dominant scheduling axis. The set-level boolean
//     (``Priority`` / ``SuperPriority`` on the set table) only biases
//     random selection *within* a section, so it gets its own pill.
//     Every textline gets at least the tier badge (default "normal")
//     so tree rows align on the right edge.
//
//   - Hades II: ordinal badge ("#N/M") sourced from NarrativeData.lua.
//     H2 uses an ordered list per owner+section rather than the H1
//     tier enum, so the rank is shown literally with the section size
//     for context. Cluster members tied at the same rank surface in
//     the tooltip. Textlines absent from NarrativeData (not every
//     textline is listed) render no badge.
export function renderPriorityBadgeHtml(tl) {
    if (!tl) return '';
    if (getActiveGame() === 'hades2') {
        return renderOrdinalBadgeHtml(tl);
    }
    return renderTierBadgeHtml(tl) + renderSetLevelBadgeHtml(tl);
}

// Compact single-badge dispatch for contexts that only have room for
// one priority indicator per row (tree rows, dependency-ref pills).
// Returns the tier badge for H1 and the ordinal badge for H2; the
// set-level (SP / P) pill is intentionally omitted here and reserved
// for the wider info-panel header.
export function renderPrimaryPriorityBadgeHtml(tl) {
    if (!tl) return '';
    if (getActiveGame() === 'hades2') {
        return renderOrdinalBadgeHtml(tl);
    }
    return renderTierBadgeHtml(tl);
}

export function renderTierBadgeHtml(tl) {
    const sec = tl && tl.narrativePrioritySectionTier;
    let strongest;
    let label;
    let icon;
    let tip;
    if (sec === 'super') {
        strongest = 'super';
        label = 'Super-priority';
        icon = '\u2605\u2605';
        tip = 'Super-priority dialogues are played before all other dialogues from the same context. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'priority') {
        strongest = 'priority';
        label = 'Priority';
        icon = '\u2605';
        tip = 'Priority dialogues are played before normal and low-priority dialogues from the same context, but after super-priority dialogues. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'low') {
        strongest = 'low';
        label = 'Low-priority';
        icon = '\u2B07';
        tip = 'Low-priority dialogues are the final fallback - played only when no super-priority, priority, or normal dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else {
        strongest = 'normal';
        label = 'Normal';
        // Rendered as a CSS-drawn dot (see renderTierBadgeHtml return / .priority-icon-dot):
        // the filled-circle glyph (U+25CF) sits low within its em box in the font,
        // so a drawn circle is used instead to centre cleanly against the label.
        icon = null;
        tip = 'Normal dialogues are played only when no super-priority or priority dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    }
    const iconHtml = (icon === null)
        ? '<span class="priority-icon priority-icon-dot"></span>'
        : `<span class="priority-icon">${icon}</span>`;
    return `<span class="priority-badge priority-${strongest}" data-tooltip="${escapeHtml(tip)}">${iconHtml}${escapeHtml(label)}</span>`;
}

export function renderSetLevelBadgeHtml(tl) {
    const set = tl && tl.narrativePrioritySetLevel;
    if (set !== 'super' && set !== 'priority') return '';
    const isSuper = set === 'super';
    const cls = isSuper ? 'set-priority-super' : 'set-priority-priority';
    const text = isSuper ? 'SP' : 'P';
    const word = isSuper ? 'super-priority' : 'priority';
    const tip = `Within its own set, this dialogue will be played with ${word} before other eligible dialogues from the same set.`;
    return `<span class="set-priority-badge ${cls}" data-tooltip="${escapeHtml(tip)}">${text}</span>`;
}

// H2 ordinal-rank priority badge. Hades II keeps narrative priority in
// a separate NarrativeData.lua registry (ordered list per owner-and-
// section); this renders the textline's 1-based position as "#N/M".
// Cluster members (sibling textlines tied at the same ordinal slot)
// are listed in the tooltip so the tree row stays compact. Returns the
// empty string when no ordinal is set (textline absent from the
// NarrativeData registry).
export function renderOrdinalBadgeHtml(tl) {
    if (!tl) return '';
    const ord = tl.narrativePriorityOrdinal;
    if (!Number.isInteger(ord) || ord < 1) return '';
    const size = tl.narrativePrioritySectionSize;
    const haveSize = Number.isInteger(size) && size > 0;
    const label = haveSize ? `#${ord}/${size}` : `#${ord}`;
    const cluster = Array.isArray(tl.narrativePriorityClusterMembers) ? tl.narrativePriorityClusterMembers : [];
    // The ordinal is scoped to this owner AND this dialogue type (H2's
    // NarrativeData registry is ordered per owner-and-section), so name
    // the type ("NPC interaction", "NPC gifting", ...) to stop the rank
    // reading as if it ranked everything the owner ever says.
    const typeLabel = tl.section ? (sectionKeyLabels[tl.section] || tl.section) : '';
    const scope = typeLabel ? `among this owner's ${typeLabel} dialogues` : 'for this owner';
    const tipParts = [
        `Narrative priority rank ${ord}${haveSize ? ` of ${size}` : ''} ${scope}. Out of all eligible dialogues in this group, the smallest numbered one will play first. If multiple dialogues have the same rank, one will be chosen at random.`,
    ];
    if (cluster.length) {
        tipParts.push(`Tied at the same rank with:\n${cluster.join('\n')}`);
    }
    return `<span class="priority-badge priority-ordinal" data-tooltip="${escapeHtml(tipParts.join(' '))}">${escapeHtml(label)}</span>`;
}

// PlayOnce / Repeatable indicator. Always renders one of
// the two so the repeatability state is explicit rather than implied
// by the absence of a badge - a non-PlayOnce dialogue is still
// eligible to play after it's been heard (subject to other gates),
// which is easy to miss if the only visual signal is the lock.
export function renderPlayOnceBadgeHtml(tl) {
    if (tl && tl.playOnce) {
        return `<span class="play-once-badge play-once-locked" data-tooltip="This dialogue can play at most one time across the entire save.">\u{1F512} Play-once</span>`;
    }
    return `<span class="play-once-badge play-once-repeatable" data-tooltip="This dialogue can play repeatedly as long as its requirements are met.">\u{1F501} Repeatable</span>`;
}

// Render a single requirement <div>, applying the resolved/unresolved
// class plus (when unresolved) the category class so the viewer can
// color-code back-compat vs typo-or-bug vs cut-content vs uncategorized.
// When the ref equals ``selfName`` (the textline whose requirements
// list we're rendering), mark it as a self-reference so the user can
// see that the game data is faithful while understanding it's a known
// cooldown / PlayOnce idiom rather than a contradiction.
export function renderReqItem(ref, selfName) {
    const cat = unresolvedCategoryFor(ref);
    const classes = ['req-item'];
    let tip = '';
    if (cat === null) {
        classes.push('resolved');
    } else {
        classes.push('unresolved');
        classes.push('unresolved-cat-' + cat);
        const known = knownUnresolved[ref];
        if (known) {
            const label = unresolvedCategoryLabels[cat] || cat;
            tip = ` data-tooltip="${escapeHtml(label)}: ${escapeHtml(known.reason)}"`;
        }
    }
    const isSelf = selfName && ref === selfName;
    if (isSelf) {
        classes.push('self-ref');
        if (!tip) {
            tip = ` data-tooltip="Self-reference: this textline appears in its own requirement list. Common with cooldown (MinRunsSinceAnyTextLines) and PlayOnce (RequiredFalse*) fields; excluded from the dependency graph."`;
        }
    }
    const selfBadge = isSelf ? `<span class="self-ref-badge">self</span>` : '';
    // Tier badge for resolved refs - mirrors the tree view so the user
    // can see each requirement's narrative-priority tier at a glance.
    // Skipped for unresolved/self refs since the former has no textline
    // data and the latter is a known cooldown/PlayOnce idiom.
    const refTl = (cat === null && !isSelf) ? textlines[ref] : null;
    const tierBadge = refTl ? renderPrimaryPriorityBadgeHtml(refTl) : '';
    // Save-status dot for the referenced dialogue (played / eligible / blocked /
    // indeterminate / unobtainable), matching the dependency-tree rows. Empty
    // when no matching save is loaded or the ref is unresolved.
    const saveBadge = refTl ? renderSaveBadgeHtml(ref, refTl) : '';
    return `<div class="${classes.join(' ')}" data-name="${escapeHtml(ref)}"${tip} onclick="navigateTo(${jsAttr(ref)})">${saveBadge}${escapeHtml(ref)}${selfBadge}${tierBadge}</div>`;
}

// Render a human-friendly explanation for one blockingReasons entry.
// Each entry describes a single requirement field whose semantics can
// never be satisfied because of unresolved refs.
export function renderBlockingReason(reason) {
    const fieldHtml = renderReqTypeHtml(reason.field, 'blocking-field');
    const missing = (reason.missingRefs || [])
        .map(r => `<a class="blocked-ref" onclick="navigateTo(${jsAttr(r)})">${escapeHtml(r)}</a>`)
        .join(', ');
    let explain;
    if (reason.semantics === 'all') {
        explain = `${fieldHtml} requires every listed textline to have played, but `
                + (reason.missingRefs.length === reason.totalRefs
                    ? `none of the ${reason.totalRefs} entries are defined`
                    : `${reason.missingRefs.length} of ${reason.totalRefs} entries are undefined`)
                + `: ${missing}.`;
    } else if (reason.semantics === 'any') {
        explain = `${fieldHtml} requires at least one of the listed textlines to have played, but all ${reason.totalRefs} are undefined: ${missing}.`;
    } else if (reason.semantics === 'count-min') {
        explain = `${fieldHtml} requires at least ${reason.requiredCount} of the listed textlines to have played, but only ${reason.resolvedCount} are defined (${reason.missingRefs.length} missing: ${missing}).`;
    } else {
        explain = `${fieldHtml}: ${missing}.`;
    }
    return `<div class="blocked-reason">${explain}</div>`;
}
