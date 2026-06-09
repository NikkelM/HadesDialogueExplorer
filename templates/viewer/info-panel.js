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
        <h3><span class="name">${escapeHtml(name)}</span>${renderPriorityBadgeHtml(tl)}${renderPlayOnceBadgeHtml(tl)}</h3>
        <div class="meta">
            <span>Owner: ${renderSpeakerHtml(tl.owner)}</span>
            ${tl.partner ? `<span>Partner: ${renderSpeakerHtml(tl.partner)}</span>` : ''}
            <span>Section: ${renderSectionHtml(tl.section)}</span>
            <span>Source: ${escapeHtml(tl.source || 'Unknown')}${tl.sourceFile ? ' \u00B7 ' + escapeHtml(tl.sourceFile) + (tl.sourceLine ? ':' + tl.sourceLine : '') : ''}</span>
        </div>`;

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

    // Dialogue text with speaker names
    if (tl.dialogueLines && tl.dialogueLines.length > 0) {
        html += `<div class="dialogue-section"><h4>Dialogue</h4>`;
        for (const line of tl.dialogueLines) {
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

    // Textline requirements
    for (const [type, refs] of Object.entries(tl.requirements)) {
        // Count-based requirement fields stash ``{Count: N}`` in
        // ``otherRequirements`` under the same key as the requirement.
        // Surface the count inline with the header so the
        // user sees ``Required min (any) (3)`` instead of finding the
        // Count duplicated in the Other Requirements section below.
        const meta = tl.otherRequirements[type];
        let countSuffix = '';
        if (meta && typeof meta === 'object' && 'Count' in meta) {
            countSuffix = `: ${escapeHtml(String(meta.Count))}`;
        }
        html += `<div class="req-section req-type-${type}"><h4>${renderReqTypeHtml(type)}${countSuffix}</h4>`;
        const sources = (tl.requirementSources && tl.requirementSources[type]) || [];
        let i = 0;
        while (i < refs.length) {
            const src = sources[i] || null;
            if (src) {
                let j = i;
                while (j < refs.length && (sources[j] || null) === src) j++;
                html += `<div class="gamedata-group-inline">`
                      + `<div class="gamedata-group-header-inline">`
                      + `<span class="gamedata-group-label">${escapeHtml(src)}</span>`
                      + `<span class="gamedata-group-count">${j - i} textline${j - i === 1 ? '' : 's'}</span>`
                      + `</div>`;
                for (let k = i; k < j; k++) {
                    html += renderReqItem(refs[k], name);
                }
                html += `</div>`;
                i = j;
            } else {
                html += renderReqItem(refs[i], name);
                i++;
            }
        }
        html += `</div>`;
    }

    // Other requirements
    if (Object.keys(tl.otherRequirements).length > 0) {
        let otherHtml = '';
        for (const [key, val] of Object.entries(tl.otherRequirements)) {
            if (key in tl.requirements) {
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
            html += `<div class="req-section req-type-other"><h4>Other Requirements</h4>${otherHtml}</div>`;
        }
    }

    html += `</div>`;
    container.innerHTML = html;
}
