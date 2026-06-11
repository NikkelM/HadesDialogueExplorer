// Info panel: full details for the currently-selected textline (or
// the unresolved-ref banner when the name has no definition).

import {
    textlines,
    knownUnresolved,
    unresolvedCategoryLabels,
    unresolvedCategoryDescriptions,
    unresolvedRefBlocks,
    reqTypeLabels,
} from './data.js';
import {
    escapeHtml,
    jsAttr,
    renderSpeakerHtml,
    renderSectionHtml,
    renderReqTypeHtml,
    renderPriorityBadgeHtml,
    renderPlayOnceBadgeHtml,
    renderBlockingReason,
    renderReqItem,
    renderChoiceNameHtml,
} from './utilities.js';
import { choiceNames, metaUpgradeNames } from './data.js';

// Render an ``otherRequirements`` key. H2 synthesises compound keys
// like ``PathTrue:GameState.ReachedTrueEnding`` (operator-prefix, then
// the path tail) and ``FunctionName:RequiredAlive``; H1 keeps bare
// field names like ``RequiredFalseFlags``. When the prefix has a
// friendly label in ``reqTypeLabels`` we render it as a hover-tooltip
// pill (internal name + plain-English blurb) and keep the path tail
// readable in monospace. Unknown prefixes fall back to the raw
// pre-escaped key so nothing is lost - the goal is additive: no
// regression for unlabelled keys, friendly labels surface where the
// per-game label vocabulary covers the prefix.
function renderOtherReqKeyHtml(key) {
    const colonIdx = key.indexOf(':');
    const prefix = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    const tail = colonIdx >= 0 ? key.slice(colonIdx + 1) : '';
    if (reqTypeLabels[prefix]) {
        const head = renderReqTypeHtml(prefix);
        return tail
            ? `${head}: <code class="other-req-path">${escapeHtml(tail)}</code>`
            : head;
    }
    return escapeHtml(key);
}

// Verbal form for each per-record membership operator on a Path:<head>
// entry. Comparison is handled separately because its rendering reuses
// the comparator string directly (``>``, ``<=`` etc.).
const _PATH_RECORD_MEMBERSHIP_VERBS = {
    IsAny:     'is one of',
    IsNone:    'is none of',
    HasAny:    'contains any of',
    HasAll:    'contains all of',
    HasNone:   'contains none of',
    NotHasAll: 'does not contain all of',
};

// Allowed keys on a ``Path:<head>`` value record we know how to render
// in a human-friendly form. Records carrying any additional modifier
// (CountOf, SumOf, SumPrevRuns, UseLength, ...) fall back to the raw
// JSON display so no information is silently dropped.
const _PATH_RECORD_CLEAN_EXTRA_KEYS = new Set(['Path']);

function _isCleanPathRecord(rec, opKey) {
    for (const k of Object.keys(rec)) {
        if (k === opKey) continue;
        if (opKey === 'Comparison' && k === 'Value') continue;
        if (!_PATH_RECORD_CLEAN_EXTRA_KEYS.has(k)) return false;
    }
    return true;
}

function _formatScalar(v) {
    return typeof v === 'string' ? v : JSON.stringify(v);
}

function _renderOperandList(items) {
    if (!Array.isArray(items)) {
        return `<code>${escapeHtml(_formatScalar(items))}</code>`;
    }
    return items.map(v => `<code>${escapeHtml(_formatScalar(v))}</code>`).join(', ');
}

function _renderPathRecord(head, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    const headHtml = `<code class="other-req-path">${escapeHtml(head)}</code>`;
    if ('Comparison' in rec && 'Value' in rec && _isCleanPathRecord(rec, 'Comparison')) {
        return `${headHtml} ${escapeHtml(String(rec.Comparison))} <code>${escapeHtml(_formatScalar(rec.Value))}</code>`;
    }
    for (const [op, verb] of Object.entries(_PATH_RECORD_MEMBERSHIP_VERBS)) {
        if (op in rec && _isCleanPathRecord(rec, op)) {
            return `${headHtml} ${verb}: ${_renderOperandList(rec[op])}`;
        }
    }
    return null;
}

// Resolve a single ``otherRequirements`` entry to its full inner HTML
// (the friendly-key prefix already rendered upstream is REPLACED here
// for ``Path:<head>`` entries whose records have a recognisable inner
// test op, because the synthetic ``Path`` prefix carries no operator
// information and the real op only appears inside the value records).
// Returns the inner HTML to wrap in a ``<div class="other-req-item">``.
function renderOtherReqEntryHtml(key, val) {
    if (key.startsWith('Path:') && Array.isArray(val) && val.length > 0) {
        const head = key.slice('Path:'.length);
        const parts = [];
        for (const rec of val) {
            const formatted = _renderPathRecord(head, rec);
            if (formatted === null) {
                parts.length = 0;
                break;
            }
            parts.push(formatted);
        }
        if (parts.length) {
            return parts.join(' <span class="other-req-and">AND</span> ');
        }
    }
    const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `${renderOtherReqKeyHtml(key)} = ${escapeHtml(display)}`;
}

export function renderInfo(name) {
    const tl = textlines[name];
    const container = document.getElementById('info-content');
    if (!tl) {
        const blocks = unresolvedRefBlocks[name] || [];
        const blocksHtml = blocks.length
            ? `<div class="meta blocked-banner">`
            + `<div class="blocked-banner-header">\u26D4 Blocks ${blocks.length} dialogue${blocks.length === 1 ? '' : 's'} from ever playing</div>`
            + `<div class="blocked-banner-list">`
            + blocks.map(b => `<a class="blocked-ref" onclick="navigateTo(${jsAttr(b)})">${escapeHtml(b)}</a>`).join(', ')
            + `</div></div>`
            : '';
        const cat = knownUnresolved[name];
        if (cat) {
            const label = unresolvedCategoryLabels[cat.category] || cat.category;
            const desc = unresolvedCategoryDescriptions[cat.category] || '';
            container.innerHTML =
                `<div class="textline-info"><h3>${escapeHtml(name)}</h3>`
              + `<div class="meta unresolved-banner unresolved-cat-${escapeHtml(cat.category)}">`
              + `<span class="unresolved-cat-badge">${escapeHtml(label)}</span>`
              + `<span class="unresolved-cat-reason">${escapeHtml(cat.reason)}</span>`
              + `</div>`
              + blocksHtml
              + (desc ? `<div class="meta unresolved-cat-desc">${escapeHtml(desc)}</div>` : '')
              + `</div>`;
        } else {
            container.innerHTML =
                `<div class="textline-info"><h3>${escapeHtml(name)}</h3>`
              + `<div class="meta unresolved-banner unresolved-cat-uncategorized">`
              + `<span class="unresolved-cat-badge">\u26A0 Not in the game</span>`
              + `<span class="unresolved-cat-reason">No textline with this name was found in the parsed game data.</span>`
              + `</div>`
              + blocksHtml
              + `</div>`;
        }
        return;
    }
    let html = `<div class="textline-info">
        <h3><span class="name">${escapeHtml(name)}</span>${renderCollisionBadgeHtml(tl)}${renderPriorityBadgeHtml(tl)}${renderPlayOnceBadgeHtml(tl)}</h3>
        <div class="meta">
            <span>Owner: ${renderSpeakerHtml(tl.owner)}</span>
            ${tl.partner ? `<span>Partner: ${renderSpeakerHtml(tl.partner)}</span>` : ''}
            <span>Type: ${renderSectionHtml(tl.section)}</span>
            <span>Source: ${escapeHtml(tl.source || 'Unknown')}${tl.sourceFile ? ' \u00B7 ' + escapeHtml(tl.sourceFile) + (tl.sourceLine ? ':' + tl.sourceLine : '') : ''}</span>
        </div>`;

    // Collision-rename banner: this textline name was duplicated in
    // the game's source data; the tool renamed it with a numeric
    // suffix so each definition can be navigated independently. Links
    // to the sibling variants so the user can quickly compare.
    html += renderCollisionBannerHtml(tl);

    // Blocked banner: this textline can never play because at least one
    // of its hard requirement fields references undefined textlines.
    if (tl.blocked && tl.blockingReasons && tl.blockingReasons.length > 0) {
        html += `<div class="meta blocked-banner">`
              + `<div class="blocked-banner-header">\u26D4 This dialogue can never play</div>`;
        for (const reason of tl.blockingReasons) {
            html += renderBlockingReason(reason);
        }
        html += `</div>`;
    }

    // Choice-variant banner: this textline is a synthetic child of a
    // dialogue choice picked by the player at runtime.
    if (tl.isSynthetic && tl.parentTextline && tl.choiceText) {
        html += `<div class="synthetic-banner">`
              + `<span>\u21B3 Choice variant of `
              + `<a class="choice-link" onclick="navigateTo(${jsAttr(tl.parentTextline)})">${escapeHtml(tl.parentTextline)}</a>`
              + ` \u00B7 ChoiceText: ${renderChoiceNameHtml(tl.choiceText)}`
              + `</span></div>`;
    }

    // Forward links to any choice variants of this parent textline.
    // Order matches the Lua source (i.e. the same order the engine
    // shows the options to the player, and the same order the
    // dialogue-line ``Choice:`` block below uses) by reading the
    // parent's own ``choicePrompt`` cues. Iterating ``textlines``
    // directly would order them alphabetically, which diverges from
    // both renderings. Anything still missing after walking the
    // prompts is appended in iteration order as a defensive
    // fallback so synthetic children never silently disappear.
    const childChoices = [];
    const seenTargets = new Set();
    for (const line of (tl.dialogueLines || [])) {
        if (line && line.kind === 'choicePrompt' && Array.isArray(line.choices)) {
            for (const c of line.choices) {
                if (textlines[c.targetTextline] && !seenTargets.has(c.targetTextline)) {
                    childChoices.push({ name: c.targetTextline, choice: c.internal });
                    seenTargets.add(c.targetTextline);
                }
            }
        }
    }
    for (const [n, t] of Object.entries(textlines)) {
        if (t.isSynthetic && t.parentTextline === name && !seenTargets.has(n)) {
            childChoices.push({ name: n, choice: t.choiceText });
            seenTargets.add(n);
        }
    }
    if (childChoices.length > 0) {
        html += `<div class="synthetic-banner"><span>Choices: `
              + childChoices.map(c =>
                    `<a class="choice-link" onclick="navigateTo(${jsAttr(c.name)})">${renderChoiceNameHtml(c.choice)}</a>`
                ).join(' \u00B7 ')
              + `</span></div>`;
    }

    // Dialogue + requirements: always rendered as a single block since
    // ``split_name_collisions`` (see src/graph.py) has already promoted
    // each collision variant to its own suffixed textline.
    html += renderDialogueAndRequirementsHtml(tl, name);

    html += `</div>`;
    container.innerHTML = html;
}

// Compute the per-option label letters for a choice-prompt's option
// list. Consecutive options that share a ``requiredMetaUpgrade``
// restriction are mutually exclusive at runtime (the player can only
// have one Mirror of Night upgrade variant active per row), so they
// share a single base letter and get numeric suffixes (A1, A2, ...)
// to flag the grouping. Solo gated options (no adjacent siblings with
// the same restriction shape) and ungated options each consume their
// own base letter (A, B, C, ...).
//
// Returns a parallel array of label strings aligned with the input
// ``choices`` array.
function computeChoiceLetters(choices) {
    const labels = new Array(choices.length);
    let baseIdx = 0;
    let i = 0;
    while (i < choices.length) {
        const baseLetter = String.fromCharCode(65 + baseIdx);
        if (choices[i].requiredMetaUpgrade) {
            let j = i;
            while (j < choices.length && choices[j].requiredMetaUpgrade) j++;
            const runLength = j - i;
            if (runLength === 1) {
                labels[i] = baseLetter;
            } else {
                for (let k = 0; k < runLength; k++) {
                    labels[i + k] = baseLetter + (k + 1);
                }
            }
            i = j;
        } else {
            labels[i] = baseLetter;
            i++;
        }
        baseIdx++;
    }
    return labels;
}

// Render the dialogue lines + textline-typed requirements + other
// requirements blocks for one source object - either the textline
// itself (normal case) or a single variant (name-collision case).
// Extracted so the variant-rendering loop can reuse the exact same
// markup as the single-block case without duplication.
function renderDialogueAndRequirementsHtml(src, textlineName) {
    let html = '';

    if (src.dialogueLines && src.dialogueLines.length > 0) {
        html += `<div class="dialogue-section"><h4>Dialogue</h4>`;
        for (const line of src.dialogueLines) {
            if (typeof line === 'object' && line.kind === 'choicePrompt' && Array.isArray(line.choices)
                && line.choices.length > 0
                && line.choices.every(c => choiceNames[c.internal])) {
                // Structured choice-prompt rendering: only kicks in when
                // every option has a friendly label in
                // ``HADES1_CHOICE_NAMES``. Unmapped prompts (Hermes
                // squelch / Orpheus jukebox today) fall through to the
                // regular speaker-line rendering so we never
                // accidentally surface a bare internal id as the
                // player-facing prompt label.
                //
                // ``targetTextline`` distinguishes two flavours of
                // choice: inline ``Choices = {...}`` options (romance
                // prompts) have a synthetic follow-up textline name and
                // get wrapped in a click-through link; preset-referenced
                // ``Choices = PresetEventArgs.X`` options (boon vendor
                // menus) carry ``targetTextline: null`` because the
                // engine calls the choice's function directly with no
                // follow-up dialogue, so the option renders as a plain
                // friendly-label span (tooltip still surfaces the
                // internal id).
                html += `<div class="dialogue-line choice-prompt"><span class="choice-prompt-label">Choice:</span> ${escapeHtml(line.text)}</div>`;
                const letters = computeChoiceLetters(line.choices);
                for (let i = 0; i < line.choices.length; i++) {
                    const c = line.choices[i];
                    const letter = letters[i];
                    let extraTooltip = null;
                    if (c.requiredMetaUpgrade) {
                        const friendly = metaUpgradeNames[c.requiredMetaUpgrade] || c.requiredMetaUpgrade;
                        extraTooltip = `Requires ${friendly} (Mirror of Night)`;
                    }
                    const labelHtml = renderChoiceNameHtml(c.internal, extraTooltip);
                    const optionHtml = c.targetTextline
                        ? `<a class="choice-link" onclick="navigateTo(${jsAttr(c.targetTextline)})">${labelHtml}</a>`
                        : labelHtml;
                    html += `<div class="dialogue-line choice-option">`
                          + `<span class="choice-option-letter">${letter}:</span> `
                          + optionHtml
                          + `</div>`;
                }
            } else if (typeof line === 'object' && line.speaker) {
                html += `<div class="dialogue-line">${renderSpeakerHtml(line.speaker)}<span class="speaker-sep">:</span> ${escapeHtml(line.text)}</div>`;
            } else if (typeof line === 'object') {
                html += `<div class="dialogue-line">${escapeHtml(line.text || '')}</div>`;
            } else {
                html += `<div class="dialogue-line">${escapeHtml(line)}</div>`;
            }
        }
        html += `</div>`;
    }

    const requirements = src.requirements || {};
    const otherRequirements = src.otherRequirements || {};

    for (const [type, refs] of Object.entries(requirements)) {
        // Count-based requirement fields stash ``{Count: N}`` in
        // ``otherRequirements`` under the same key as the requirement.
        // Surface the count inline with the header so the
        // user sees ``Required min (any) (3)`` instead of finding the
        // Count duplicated in the Other Requirements section below.
        const meta = otherRequirements[type];
        let countSuffix = '';
        if (meta && typeof meta === 'object' && 'Count' in meta) {
            countSuffix = `: ${escapeHtml(String(meta.Count))}`;
        }
        html += `<div class="req-section req-type-${type}">`
              + `<h4><span class="toggle">\u25BC</span>${renderReqTypeHtml(type)}${countSuffix}</h4>`
              + `<div class="req-section-children expanded">`;
        const sources = (src.requirementSources && src.requirementSources[type]) || [];
        let i = 0;
        while (i < refs.length) {
            const srcGroup = sources[i] || null;
            if (srcGroup) {
                let j = i;
                while (j < refs.length && (sources[j] || null) === srcGroup) j++;
                html += `<div class="gamedata-group-inline">`
                      + `<div class="gamedata-group-header-inline">`
                      + `<span class="toggle">\u25BC</span>`
                      + `<span class="gamedata-group-label">${escapeHtml(srcGroup)}</span>`
                      + `<span class="gamedata-group-count">${j - i} textline${j - i === 1 ? '' : 's'}</span>`
                      + `</div>`
                      + `<div class="gamedata-group-children-inline expanded">`;
                for (let k = i; k < j; k++) {
                    html += renderReqItem(refs[k], textlineName);
                }
                html += `</div></div>`;
                i = j;
            } else {
                html += renderReqItem(refs[i], textlineName);
                i++;
            }
        }
        html += `</div></div>`;
    }

    if (Object.keys(otherRequirements).length > 0) {
        let otherHtml = '';
        for (const [key, val] of Object.entries(otherRequirements)) {
            if (key in requirements) {
                // Already surfaced inline with the requirement-section
                // header above. Defensively render any non-Count meta
                // keys to guard against silent data loss if the game
                // data ever ships additional metadata fields beyond
                // ``Count`` (none today across all 4 H1 sources).
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const extras = {};
                    for (const [k, v] of Object.entries(val)) {
                        if (k !== 'Count') extras[k] = v;
                    }
                    if (Object.keys(extras).length > 0) {
                        otherHtml += `<div class="other-req-item">${renderOtherReqKeyHtml(key)} = ${escapeHtml(JSON.stringify(extras))}</div>`;
                    }
                }
                continue;
            }
            otherHtml += `<div class="other-req-item">${renderOtherReqEntryHtml(key, val)}</div>`;
        }
        if (otherHtml) {
            html += `<div class="req-section req-type-other">`
                  + `<h4><span class="toggle">\u25BC</span>Other Requirements</h4>`
                  + `<div class="req-section-children expanded">${otherHtml}</div>`
                  + `</div>`;
        }
    }

    return html;
}

// Shared tooltip text for the collision-rename UI (badge in the header
// + banner under the meta line). Single source of truth so the badge
// and the in-banner label can't drift out of sync.
function collisionTooltipText(tl) {
    return (
        `Renamed for Dialogue Explorer. The game's source data has ${tl.collisionTotal} distinct ` +
        `definitions sharing the name "${tl.collisionOriginalName}". The engine ` +
        `keys CurrentRun.TextLinesRecord globally by name, so once any one of ` +
        `these variants triggers, the others are blocked from ever playing in ` +
        `the same save - almost certainly a base-game bug.`
    );
}

// Compact warning badge shown next to the textline name when this
// entry was renamed by the tool to disambiguate an engine name
// collision. Tooltip carries the full explanation; the visible label
// is just enough to draw attention without bloating the header.
function renderCollisionBadgeHtml(tl) {
    if (!tl.collisionOriginalName) return '';
    const tip = collisionTooltipText(tl);
    return ` <span class="collision-badge" data-tooltip="${escapeHtml(tip)}">\u26A0 Renamed</span>`;
}

// Banner shown below the meta line when the textline was renamed by
// the tool. Surfaces the original name and lists all duplicate
// siblings (including the currently-selected one) so the user can
// quickly compare definitions. The full engine-bug explanation is
// attached to the "Renamed for Dialogue Explorer" label only (via a
// tooltip) - the rest of the banner, in particular the sibling
// links, intentionally carries no tooltip so hovering a link does
// not pop an explanation that obscures the click target.
function renderCollisionBannerHtml(tl) {
    if (!tl.collisionOriginalName) return '';
    const original = tl.collisionOriginalName;
    const tip = collisionTooltipText(tl);
    const siblings = Array.isArray(tl.collisionSiblings) ? tl.collisionSiblings : [];
    const siblingLinks = siblings.map(s => {
        const sibTl = textlines[s];
        const label = sibTl
            ? `#${sibTl.collisionIndex} ${s}`
            : s;
        return `<a class="collision-sibling-link" onclick="navigateTo(${jsAttr(s)})">${escapeHtml(label)}</a>`;
    }).join(' \u00B7 ');
    return `<div class="collision-banner">`
         + `<div class="collision-banner-header">`
         + `<span class="collision-banner-label" data-tooltip="${escapeHtml(tip)}">`
         + `\u26A0 Renamed for Dialogue Explorer`
         + `</span>`
         + ` \u00B7 Original name: <code>${escapeHtml(original)}</code> `
         + `\u00B7 Variant ${tl.collisionIndex} of ${tl.collisionTotal}`
         + `</div>`
         + (siblingLinks
             ? `<div class="collision-banner-body">Duplicates of this dialogue: ${siblingLinks}</div>`
             : '')
         + `</div>`;
}

// Click-to-collapse for the requirement-section boxes and the
// GameData group boxes inside the details panel. Wired once during
// boot via :func:`init.js`. Uses delegation so it keeps working
// across every ``renderInfo`` re-render (which replaces the panel's
// ``innerHTML`` and therefore wipes any per-element listeners).
// Collapse state is intentionally NOT persisted across re-renders:
// each ``renderInfo`` call starts with all groups expanded, matching
// the tree-view group default.
function toggleSection(headerEl, childrenClass) {
    const children = headerEl.nextElementSibling;
    if (!children || !children.classList.contains(childrenClass)) return;
    const isExpanded = children.classList.contains('expanded');
    children.classList.toggle('expanded');
    const toggle = headerEl.querySelector('.toggle');
    if (toggle) toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
}

export function initInfoPanel() {
    const container = document.getElementById('info-content');
    if (!container) return;
    container.addEventListener('click', (e) => {
        // Inner collapse target first: a GameData group header. Match
        // the inner case before the outer so a click deep inside a
        // group never accidentally toggles the wrapping req-section.
        const gdHeader = e.target.closest('.gamedata-group-header-inline');
        if (gdHeader && container.contains(gdHeader)) {
            toggleSection(gdHeader, 'gamedata-group-children-inline');
            return;
        }
        // Outer collapse target: the requirement-section header (h4).
        // Scoped to direct h4 children of .req-section so other h4s
        // (Player Choices, Dialogue) stay non-collapsible.
        const reqHeader = e.target.closest('.req-section > h4');
        if (reqHeader && container.contains(reqHeader)) {
            toggleSection(reqHeader, 'req-section-children');
            return;
        }
    });
}
