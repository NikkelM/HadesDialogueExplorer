// Rendering utilities and label formatters.
//
// Pure functions that turn dataset entries into HTML fragments shared
// across the info panel, search results, tree rows, and badges. All
// data lookups go through ``./data.js`` so live-binding updates
// after ``loadData`` propagate transparently.

import {
    textlines,
    speakerNames,
    sectionKeyLabels,
    reqTypeLabels,
    reqTypeEdgeLabels,
    reqTypeTooltips,
    _reqTypeOrderIndex,
    knownUnresolved,
    unresolvedCategoryLabels,
} from './data.js';

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
    return speakerNames[id] || id;
}

// Render a speaker/NPC name as HTML: friendly label with the internal ID
// available as a `title` tooltip when a mapping exists.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - both the friendly label and the internal-ID tooltip are
// already routed through escapeHtml below.
export function renderSpeakerHtml(id) {
    const friendly = speakerNames[id];
    if (friendly && friendly !== id) {
        return `<span class="speaker-name" title="${escapeHtml(id)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="speaker-name">${escapeHtml(id)}</span>`;
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

export function formatReqType(type) {
    return reqTypeLabels[type] || type;
}

// Build the title-attribute string for a requirement-type label. When a
// plain-English blurb is known for the field, the tooltip is rendered as
// the internal field name on the first line, a blank line, and the
// blurb beneath. Otherwise we fall back to the internal-name-only
// tooltip so unmapped types still get the
// hover-to-reveal-internal-name affordance.
//
// Returns ``null`` when no friendly label exists either: in that case
// the rendered span already shows the internal name as its text, so an
// echoing tooltip would be redundant.
export function reqTypeTitleText(type) {
    const friendly = reqTypeLabels[type];
    if (!friendly || friendly === type) return null;
    const blurb = reqTypeTooltips[type];
    return blurb ? `${type}\n\n${blurb}` : type;
}

// Render a requirement-type label as HTML: friendly name with the
// internal field key (and a plain-English explanation when known)
// available as a `title` tooltip. Mirrors ``renderSpeakerHtml`` /
// ``renderSectionHtml`` so the hover-to-reveal-internal-name affordance
// is consistent across the three label families.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at
// the call site - both the friendly label and the tooltip text are
// already routed through escapeHtml below.
export function renderReqTypeHtml(type, extraClass) {
    const friendly = reqTypeLabels[type];
    const cls = `req-type-name${extraClass ? ' ' + extraClass : ''}`;
    const titleText = reqTypeTitleText(type);
    if (titleText !== null) {
        return `<span class="${cls}" title="${escapeHtml(titleText)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="${cls}">${escapeHtml(type)}</span>`;
}

// Render a section key as HTML: friendly label with the internal key
// available as a `title` tooltip when a mapping exists, falling back
// to the raw key when no mapping is registered. The build pipeline
// audits the labels map against the section-key allowlist so any
// missing entry becomes a build-time warning rather than silently
// rendering the raw key here. Mirrors ``renderSpeakerHtml`` so both
// UI surfaces (search dropdown + details view) get the same
// hover-to-reveal-internal-name behaviour, including the dotted-
// underline affordance via the ``[title]`` attribute selector.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - both the friendly label and the internal-key tooltip are
// already routed through escapeHtml below.
export function renderSectionHtml(key) {
    const friendly = sectionKeyLabels[key];
    if (friendly && friendly !== key) {
        return `<span class="section-name" title="${escapeHtml(key)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="section-name">${escapeHtml(key)}</span>`;
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
// details panel. Two independent signals are surfaced
// side-by-side:
//
//   1. Tier badge - derived purely from the parent section the textline
//      lives in. The engine cascades through priority-tagged sibling
//      containers at the call site (super -> priority -> normal -> low),
//      so this is the dominant scheduling axis.
//
//   2. Set-level badge (optional) - the per-textline-set `Priority` /
//      `SuperPriority` boolean. This only biases random selection
//      *within* a section, never across sections, so it gets its own
//      small "SP" / "P" pill rather than collapsing into the tier badge.
//
// Always returns at least one badge (the tier badge) so every row in
// the tree has a priority tag for visual alignment.
export function renderPriorityBadgeHtml(tl) {
    return renderTierBadgeHtml(tl) + renderSetLevelBadgeHtml(tl);
}

export function renderTierBadgeHtml(tl) {
    const sec = tl && tl.narrativePrioritySectionTier;
    let strongest;
    let label;
    let icon;
    let tip;
    if (sec === 'super') {
        strongest = 'super';
        label = 'super-priority';
        icon = '\u2605\u2605';
        tip = 'Super-priority dialogues are played before all other dialogues from the same context. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'priority') {
        strongest = 'priority';
        label = 'priority';
        icon = '\u2605';
        tip = 'Priority dialogues are played before normal and low-priority dialogues from the same context, but after super-priority dialogues. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'low') {
        strongest = 'low';
        label = 'low-priority';
        icon = '\u2B07';
        tip = 'Low-priority dialogues are the final fallback - played only when no super-priority, priority, or normal dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else {
        strongest = 'normal';
        label = 'normal';
        icon = '\u25CF';
        tip = 'Normal dialogues are played only when no super-priority or priority dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    }
    return `<span class="priority-badge priority-${strongest}" title="${escapeHtml(tip)}">${icon} ${escapeHtml(label)}</span>`;
}

export function renderSetLevelBadgeHtml(tl) {
    const set = tl && tl.narrativePrioritySetLevel;
    if (set !== 'super' && set !== 'priority') return '';
    const isSuper = set === 'super';
    const cls = isSuper ? 'set-priority-super' : 'set-priority-priority';
    const text = isSuper ? 'SP' : 'P';
    const word = isSuper ? 'super-priority' : 'priority';
    const tip = `Within its own set, this dialogue will be played with ${word} before other eligible dialogues from the same set.`;
    return `<span class="set-priority-badge ${cls}" title="${escapeHtml(tip)}">${text}</span>`;
}

// PlayOnce / Repeatable indicator. Always renders one of
// the two so the repeatability state is explicit rather than implied
// by the absence of a badge - a non-PlayOnce dialogue is still
// eligible to play after it's been heard (subject to other gates),
// which is easy to miss if the only visual signal is the lock.
export function renderPlayOnceBadgeHtml(tl) {
    if (tl && tl.playOnce) {
        return `<span class="play-once-badge play-once-locked" title="This dialogue can play at most one time across the entire save.">\u{1F512} PlayOnce</span>`;
    }
    return `<span class="play-once-badge play-once-repeatable" title="This dialogue can play repeatedly as long as its requirements are met.">\u{1F501} Repeatable</span>`;
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
            tip = ` title="${escapeHtml(label)}: ${escapeHtml(known.reason)}"`;
        }
    }
    const isSelf = selfName && ref === selfName;
    if (isSelf) {
        classes.push('self-ref');
        if (!tip) {
            tip = ` title="Self-reference: this textline appears in its own requirement list. Common with cooldown (MinRunsSinceAnyTextLines) and PlayOnce (RequiredFalse*) fields; excluded from the dependency graph."`;
        }
    }
    const selfBadge = isSelf ? `<span class="self-ref-badge">self</span>` : '';
    // Tier badge for resolved refs - mirrors the tree view so the user
    // can see each requirement's narrative-priority tier at a glance.
    // Skipped for unresolved/self refs since the former has no textline
    // data and the latter is a known cooldown/PlayOnce idiom.
    const refTl = (cat === null && !isSelf) ? textlines[ref] : null;
    const tierBadge = refTl ? renderTierBadgeHtml(refTl) : '';
    return `<div class="${classes.join(' ')}" data-name="${escapeHtml(ref)}"${tip} onclick="navigateTo(${jsAttr(ref)})">${escapeHtml(ref)}${selfBadge}${tierBadge}</div>`;
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
