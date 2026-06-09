// Info panel: full details for the currently-selected textline (or
// the unresolved-ref banner when the name has no definition).

import {
    textlines,
    knownUnresolved,
    unresolvedCategoryLabels,
    unresolvedCategoryDescriptions,
    unresolvedRefBlocks,
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
} from './utilities.js';

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
        html += `<div class="meta synthetic-banner">`
              + `<span>\u21B3 Choice variant of `
              + `<a class="choice-link" onclick="navigateTo(${jsAttr(tl.parentTextline)})">${escapeHtml(tl.parentTextline)}</a>`
              + ` \u00B7 ChoiceText: <code>${escapeHtml(tl.choiceText)}</code>`
              + `</span></div>`;
    }

    // Forward links to any choice variants of this parent textline.
    const childChoices = [];
    for (const [n, t] of Object.entries(textlines)) {
        if (t.isSynthetic && t.parentTextline === name) {
            childChoices.push({ name: n, choice: t.choiceText });
        }
    }
    if (childChoices.length > 0) {
        html += `<div class="meta synthetic-banner"><span>Choices: `
              + childChoices.map(c =>
                    `<a class="choice-link" onclick="navigateTo(${jsAttr(c.name)})">${escapeHtml(c.choice)}</a>`
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
            if (typeof line === 'object' && line.speaker) {
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
                        otherHtml += `<div class="other-req-item">${escapeHtml(key)} = ${escapeHtml(JSON.stringify(extras))}</div>`;
                    }
                }
                continue;
            }
            const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
            otherHtml += `<div class="other-req-item">${escapeHtml(key)} = ${escapeHtml(display)}</div>`;
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
