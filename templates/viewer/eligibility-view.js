/**
 * Eligibility tracer view.
 *
 * Shows what's blocking a target dialogue from becoming eligible to play,
 * based on a loaded save file's TextLinesRecord. Displays:
 *   1. Summary stats (X of Y prerequisites still needed)
 *   2. Filtered upstream tree showing only unplayed branches
 *
 * URL state: view=eligibility&dialogue=X
 * Only functional when a save file is loaded.
 */

import { textlines, speakers } from './data.js';
import { escapeHtml, jsAttr, renderSpeakerHtml, getEdgeLabel, getEdgeClass } from './utilities.js';
import { getSaveProgress, saveMatchesActiveGame, isDialoguePlayed } from './save-parser.js';
import { AND_REQ_TYPES, OR_REQ_TYPES, COUNT_MIN_REQ_TYPES, requiredCount } from './requirements.js';

// AND / OR / COUNT_MIN requirement-type sets come from ./requirements.js
// (the single source of truth shared with the save-progress badge), so the
// tracer and the badge agree on what's satisfied. Negative (RequiredFalse*)
// and run-count gates (Min/MaxRunsSince*, RequiredMaxAny*) are intentionally
// not walked: the tracer surfaces positive prerequisite chains, not blocking
// conditions.

// Types we skip: negative requirements (must NOT have played), cooldowns,
// and count-based gates (not dialogue prerequisites).
// RequiredFalse*, MinRunsSince*, MaxRunsSince*, RequiredMin*, RequiredMax*

// Recursively collect the prerequisite chain for a dialogue, respecting
// AND / OR / count-min semantics.
//
// Returns ``{ chain, groups }``:
//   - ``chain``  Map of name -> { depth, parents:[{name, reqType, groupId}], played }
//   - ``groups`` Map of groupId -> { id, parentName, reqType, kind, quota,
//                size, options:[name], depth }. A group is one OR
//                (``kind:'any'``, quota 1) or count-min (``kind:'count-min'``,
//                quota N) requirement whose options are alternatives: the
//                user needs only ``quota`` of them, so the renderers present
//                them as one "play N of these" unit rather than N separate
//                mandatory prerequisites.
//
// ``isPlayed`` is injectable so the walk is unit-testable without a loaded
// save; it defaults to the live save-progress lookup.
export function buildPrereqChain(rootName, isPlayed = (n) => isDialoguePlayed(n) === true) {
    const chain = new Map();
    const groups = new Map();
    const visited = new Set();

    function walk(name, depth) {
        if (visited.has(name)) return;
        visited.add(name);

        const tl = textlines[name];
        if (!tl || !tl.requirements) return;

        for (const [reqType, refs] of Object.entries(tl.requirements)) {
            if (!Array.isArray(refs)) continue;
            const options = refs.filter(ref => ref !== name);

            if (AND_REQ_TYPES.has(reqType)) {
                // ALL refs are needed: each is an individual prerequisite.
                for (const ref of options) {
                    addToChain(ref, name, reqType, null, depth);
                    walk(ref, depth + 1);
                }
            } else if (OR_REQ_TYPES.has(reqType)) {
                // Any one suffices. If none has played yet, present all
                // options as a single "play any 1 of these" group. Options
                // are walked so the tree can expand each one's own chain.
                if (options.some(ref => isPlayed(ref))) continue;
                const groupId = recordGroup(name, reqType, 'any', 1, options, depth);
                for (const ref of options) {
                    addToChain(ref, name, reqType, groupId, depth);
                    walk(ref, depth + 1);
                }
            } else if (COUNT_MIN_REQ_TYPES.has(reqType)) {
                // "At least Count of these must have played." Present them as
                // one "play any N of these" group when the quota isn't met.
                const playedCount = options.filter(ref => isPlayed(ref)).length;
                const quota = requiredCount(tl, reqType);
                if (playedCount >= quota) continue;
                const groupId = recordGroup(name, reqType, 'count-min', quota, options, depth);
                for (const ref of options) {
                    if (isPlayed(ref)) continue;
                    addToChain(ref, name, reqType, groupId, depth);
                    walk(ref, depth + 1);
                }
            }
            // Skip negative (RequiredFalse*) and run-count gates
            // (Min/MaxRunsSince*, RequiredMaxAny*).
        }
    }

    function recordGroup(parentName, reqType, kind, quota, options, depth) {
        const id = `${parentName}::${reqType}`;
        if (!groups.has(id)) {
            groups.set(id, {
                id, parentName, reqType, kind, quota,
                size: options.length,
                options,
                depth: depth + 1,
            });
        }
        return id;
    }

    function addToChain(ref, parentName, reqType, groupId, depth) {
        if (!chain.has(ref)) {
            chain.set(ref, {
                depth: depth + 1,
                parents: [{ name: parentName, reqType, groupId }],
                played: isPlayed(ref),
            });
        } else {
            const entry = chain.get(ref);
            entry.parents.push({ name: parentName, reqType, groupId });
            entry.depth = Math.max(entry.depth, depth + 1);
        }
    }

    walk(rootName, 0);
    return { chain, groups, mandatory: computeMandatory(chain, rootName) };
}

// Names reachable from the root following only non-group (AND) edges -
// i.e. the genuinely-required individual prerequisites. A group's options
// and everything reached only through them are excluded, so the flat list
// and summary count what must be played rather than every conditional
// alternative branch (which still appears, expandable, in the tree).
function computeMandatory(chain, rootName) {
    const adj = new Map();
    for (const [name, info] of chain) {
        for (const p of info.parents) {
            if (p.groupId) continue; // group edges aren't mandatory paths
            if (!adj.has(p.name)) adj.set(p.name, []);
            adj.get(p.name).push(name);
        }
    }
    const mandatory = new Set();
    const queue = [rootName];
    const seen = new Set([rootName]);
    while (queue.length) {
        const cur = queue.shift();
        for (const child of (adj.get(cur) || [])) {
            mandatory.add(child);
            if (!seen.has(child)) {
                seen.add(child);
                queue.push(child);
            }
        }
    }
    return mandatory;
}

// A group is "active" (shown in the flat list / counted in the summary)
// when its parent is the root or a mandatory prerequisite. Groups nested
// under another group's option are conditional, so they only appear in the
// tree under that option.
function isActiveGroup(group, mandatory, rootName) {
    return group.parentName === rootName || mandatory.has(group.parentName);
}

// Group-aware prerequisite progress. Only mandatory individual nodes and
// active groups (parent is the root or mandatory) count; a group counts as
// its quota (e.g. "play 3 of 5" contributes 3, not 5). Conditional branches
// nested under a group's option are excluded so the summary reflects what
// actually has to be played. ``isPlayed`` is injectable for testing.
export function summarizePrereqs(chain, groups, mandatory, rootName, isPlayed = (n) => isDialoguePlayed(n) === true) {
    const activeGroups = [...groups.values()].filter(g => isActiveGroup(g, mandatory, rootName));
    const memberNames = new Set();
    for (const g of activeGroups) {
        for (const o of g.options) memberNames.add(o);
    }
    let total = 0;
    let played = 0;
    for (const [name, info] of chain) {
        if (!mandatory.has(name) || memberNames.has(name)) continue;
        total += 1;
        if (info.played) played += 1;
    }
    for (const g of activeGroups) {
        total += g.quota;
        const got = g.options.filter(o => isPlayed(o)).length;
        played += Math.min(got, g.quota);
    }
    return { total, played, stillNeeded: total - played };
}

function renderSummaryHtml(rootName, chain, groups, mandatory) {
    const { total, played, stillNeeded } = summarizePrereqs(chain, groups, mandatory, rootName);
    const rootPlayed = isDialoguePlayed(rootName) === true;

    let html = `<div class="eligibility-summary">`;

    if (rootPlayed) {
        html += `<div class="eligibility-status eligibility-played">\u2714 Already played</div>`;
        html += `<div class="eligibility-detail">${escapeHtml(rootName)} is already in this save's TextLinesRecord.</div>`;
    } else if (stillNeeded === 0) {
        html += `<div class="eligibility-status eligibility-eligible">\u25CB Eligible to play</div>`;
        html += `<div class="eligibility-detail">All ${total} prerequisite${total === 1 ? '' : 's'} have been played. This dialogue should be eligible.</div>`;
    } else {
        html += `<div class="eligibility-status eligibility-blocked">\u2022 Blocked</div>`;
        html += `<div class="eligibility-detail">${stillNeeded} of ${total} prerequisite${total === 1 ? '' : 's'} still needed.</div>`;
        html += `<div class="eligibility-progress-bar"><div class="eligibility-progress-fill" style="width:${total > 0 ? (played / total * 100) : 0}%"></div></div>`;
        html += `<div class="eligibility-progress-label">${played}/${total} complete</div>`;
    }

    html += `</div>`;
    return html;
}

function renderUnplayedListHtml(chain, mandatory, rootName, groups) {
    const rootTl = textlines[rootName];
    if (!rootTl) return '';

    // Only active groups (parent is root or mandatory) surface here;
    // conditional groups nested under an option live in the tree only.
    const activeGroups = [...groups.values()].filter(g => isActiveGroup(g, mandatory, rootName));
    const memberNames = new Set();
    for (const g of activeGroups) {
        for (const o of g.options) memberNames.add(o);
    }

    // Rows are either a standalone unplayed prerequisite or a group
    // ("play N of these"); both carry a depth so they interleave in
    // deepest-first (play) order. Standalone rows are limited to mandatory
    // nodes so conditional sub-branches don't pad the "what to play" list.
    const rows = [];
    for (const [name, info] of chain) {
        if (info.played || !mandatory.has(name) || memberNames.has(name)) continue;
        rows.push({ kind: 'item', depth: info.depth, name, info });
    }
    for (const g of activeGroups) {
        rows.push({ kind: 'group', depth: g.depth, group: g });
    }
    if (rows.length === 0) return '';
    rows.sort((a, b) => b.depth - a.depth);

    let html = `<div class="eligibility-tree">`;
    html += `<h4 class="eligibility-tree-header">Unplayed prerequisites (${rows.length})</h4>`;
    html += `<div class="eligibility-tree-hint">Ordered by depth (deepest first - play in this order)</div>`;
    html += `<div class="eligibility-list">`;
    for (const row of rows) {
        html += row.kind === 'group'
            ? renderGroupItemHtml(row.group, rootName, chain)
            : renderUnplayedItemHtml(row.name, row.info, chain, rootName);
    }
    html += `</div></div>`;
    return html;
}

function renderUnplayedItemHtml(name, info, chain, rootName) {
    const tl = textlines[name];
    const ownerEntry = tl ? speakers[tl.owner] : null;
    const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '?');

    // Show which dialogues require this one (the "needed by" chain toward root)
    const neededBy = info.parents
        .filter(p => p.name === rootName || (chain.has(p.name) && !chain.get(p.name).played))
        .map(p => p.name)
        .slice(0, 3);
    const neededByStr = neededBy.length > 0
        ? neededBy.map(n => `<a class="eligibility-ref" onclick="event.stopPropagation();navigateTo(${jsAttr(n)})">${escapeHtml(n.length > 25 ? n.slice(0, 23) + '\u2026' : n)}</a>`).join(', ')
        : '';

    const edgeLabels = [...new Set(info.parents.map(p => p.reqType))];
    const edgeBadges = edgeLabels
        .map(t => `<span class="edge-type ${getEdgeClass(t)}">${getEdgeLabel(t)}</span>`)
        .join(' ');

    let html = `<div class="eligibility-item" onclick="navigateTo(${jsAttr(name)})">`;
    html += `<div class="eligibility-item-main">`;
    html += `<span class="eligibility-depth" title="Prerequisite level ${info.depth}: ${info.depth} step${info.depth === 1 ? '' : 's'} back from this dialogue. Play higher levels first.">Lvl ${info.depth}</span>`;
    html += `<span class="eligibility-item-name">${escapeHtml(name)}</span>`;
    html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
    html += `</div>`;
    if (edgeBadges || neededByStr) {
        html += `<div class="eligibility-item-meta">`;
        if (edgeBadges) html += edgeBadges;
        if (neededByStr) html += ` <span class="eligibility-needed-by">needed by ${neededByStr}</span>`;
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

// A requirement group rendered as one "play any N of these" card, with each
// alternative listed and the already-played ones ticked off. Makes it clear
// the options are interchangeable rather than all individually required.
function renderGroupItemHtml(group, rootName, chain) {
    const playedCount = group.options.filter(o => isDialoguePlayed(o) === true).length;
    const quotaText = group.quota === 1
        ? `Play any 1 of these ${group.size}`
        : `Play any ${group.quota} of these ${group.size}`;
    const progress = playedCount > 0 ? ` \u00B7 ${playedCount} played` : '';
    const edgeBadge = `<span class="edge-type ${getEdgeClass(group.reqType)}">${getEdgeLabel(group.reqType)}</span>`;
    const showNeededBy = group.parentName !== rootName && chain.has(group.parentName);
    const neededByStr = showNeededBy
        ? ` <span class="eligibility-needed-by">needed by <a class="eligibility-ref" onclick="event.stopPropagation();navigateTo(${jsAttr(group.parentName)})">${escapeHtml(group.parentName)}</a></span>`
        : '';

    let html = `<div class="eligibility-group">`;
    html += `<div class="eligibility-group-head">`;
    html += `<span class="eligibility-depth" title="Prerequisite level ${group.depth}: ${group.depth} step${group.depth === 1 ? '' : 's'} back from this dialogue. Play higher levels first.">Lvl ${group.depth}</span>`;
    html += `<span class="eligibility-group-title">${quotaText}${progress}</span>`;
    html += edgeBadge;
    html += `</div>`;
    if (neededByStr) html += `<div class="eligibility-item-meta">${neededByStr}</div>`;

    html += `<div class="eligibility-group-options">`;
    // Unplayed options first (those are the actionable ones), then played.
    const sorted = [...group.options].sort(
        (a, b) => (isDialoguePlayed(a) === true) - (isDialoguePlayed(b) === true)
    );
    for (const opt of sorted) {
        const isPlayedOpt = isDialoguePlayed(opt) === true;
        const tl = textlines[opt];
        const ownerEntry = tl ? speakers[tl.owner] : null;
        const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '?');
        const icon = isPlayedOpt ? '\u2714' : '\u25CB';
        html += `<div class="eligibility-group-option${isPlayedOpt ? ' played' : ''}" onclick="navigateTo(${jsAttr(opt)})">`;
        html += `<span class="eligibility-group-option-icon">${icon}</span>`;
        html += `<span class="eligibility-item-name">${escapeHtml(opt)}</span>`;
        html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
        html += `</div>`;
    }
    html += `</div></div>`;
    return html;
}

function renderTreeHtml(chain, rootName, groups) {
    if (chain.size === 0) return '';

    // Build a children map: for each node, which chain entries list it as a
    // parent (carrying the group id so alternatives can be grouped)?
    const childrenOf = new Map();
    for (const [name, info] of chain) {
        for (const p of info.parents) {
            if (!childrenOf.has(p.name)) childrenOf.set(p.name, []);
            childrenOf.get(p.name).push({ name, reqType: p.reqType, groupId: p.groupId });
        }
    }

    // If root has no direct children in the chain, nothing to show
    if (!childrenOf.has(rootName) || childrenOf.get(rootName).length === 0) return '';

    let html = `<div class="eligibility-tree-section">`;
    html += `<h4 class="eligibility-tree-header">Prerequisite tree</h4>`;
    html += `<div class="eligibility-tree-hint">Nested view showing dependency hierarchy</div>`;
    html += `<div class="eligibility-tree-container">`;
    html += renderTreeNode(rootName, childrenOf, chain, groups, new Set(), 0);
    html += `</div></div>`;
    return html;
}

function renderTreeNode(name, childrenOf, chain, groups, visited, depth) {
    if (visited.has(name) || depth > 20) return '';
    visited.add(name);
    return renderChildrenOf(name, childrenOf, chain, groups, visited, depth);
}

// Render the children of an already-claimed node (the caller has added
// ``name`` to ``visited``). Split out from renderTreeNode so a group can
// claim its options up front and still expand each one's children.
function renderChildrenOf(name, childrenOf, chain, groups, visited, depth) {
    if (depth > 20) return '';
    const children = childrenOf.get(name) || [];
    if (children.length === 0) return '';

    let html = '';
    const seenGroups = new Set();
    for (const child of children) {
        if (child.groupId) {
            // Render each group once, at the position of its first option.
            if (seenGroups.has(child.groupId)) continue;
            seenGroups.add(child.groupId);
            const group = groups.get(child.groupId);
            if (group) html += renderTreeGroupHtml(group, childrenOf, chain, groups, visited, depth);
        } else {
            html += renderTreeChildHtml(child, childrenOf, chain, groups, visited, depth);
        }
    }
    return html;
}

// Markup for one tree row given a (possibly empty) pre-rendered subtree.
function renderTreeRow(name, reqType, showEdge, subtree, played) {
    const tl = textlines[name];
    const ownerEntry = tl ? speakers[tl.owner] : null;
    const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '');
    const hasChildren = subtree.length > 0;
    const chevron = hasChildren ? '<span class="tree-chevron">\u25B6</span>' : '';
    const statusIcon = played ? '<span class="tree-icon">\u2714</span>' : '';

    let html = `<div class="tree-node ${played ? 'tree-played' : 'tree-unplayed'}${hasChildren ? ' collapsible collapsed' : ''}">`;
    html += `<div class="tree-node-row"${hasChildren ? ' onclick="this.parentElement.classList.toggle(\'collapsed\')"' : ''} ondblclick="event.stopPropagation();navigateTo(${jsAttr(name)})">`;
    html += `${chevron}${statusIcon}`;
    html += `<span class="tree-name">${escapeHtml(name)}</span>`;
    if (ownerLabel) html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
    if (showEdge && reqType) html += `<span class="edge-type ${getEdgeClass(reqType)}">${getEdgeLabel(reqType)}</span>`;
    html += `<a class="tree-link" onclick="event.stopPropagation();navigateTo(${jsAttr(name)})" title="Open detail view">\u2197</a>`;
    html += `</div>`;
    if (hasChildren) html += `<div class="tree-children">${subtree}</div>`;
    html += `</div>`;
    return html;
}

function renderTreeChildHtml(child, childrenOf, chain, groups, visited, depth, showEdge = true) {
    const info = chain.get(child.name);
    if (!info) return '';
    // Only recurse into unplayed nodes - played ones are satisfied
    const subtree = info.played ? '' : renderTreeNode(child.name, childrenOf, chain, groups, visited, depth + 1);
    return renderTreeRow(child.name, child.reqType, showEdge, subtree, info.played);
}

// A requirement group as a labelled wrapper ("Play any N of M"). Each
// alternative is rendered as a normal, expandable tree node so the user can
// drill into an option's own prerequisites; played options are ticked.
function renderTreeGroupHtml(group, childrenOf, chain, groups, visited, depth) {
    const quotaText = group.quota === 1
        ? `Play any 1 of ${group.size}`
        : `Play any ${group.quota} of ${group.size}`;

    let html = `<div class="tree-node tree-group">`;
    html += `<div class="tree-node-row tree-group-row">`;
    html += `<span class="tree-group-label">${escapeHtml(quotaText)}</span>`;
    html += `<span class="edge-type ${getEdgeClass(group.reqType)}">${getEdgeLabel(group.reqType)}</span>`;
    html += `</div>`;
    html += `<div class="tree-children tree-group-children">`;
    const sorted = [...group.options].sort(
        (a, b) => (isDialoguePlayed(a) === true) - (isDialoguePlayed(b) === true)
    );
    // Claim every expandable option for the group up front so a sibling
    // option's own subtree can't take ownership of (and thus flatten) a
    // later option before the group renders it.
    const expandable = sorted.filter(opt => isDialoguePlayed(opt) !== true && chain.has(opt));
    for (const opt of expandable) visited.add(opt);
    for (const opt of sorted) {
        if (isDialoguePlayed(opt) === true || !chain.has(opt)) {
            html += renderTreePlayedOptionHtml(opt);
        } else {
            // The option is already claimed, so expand its children directly.
            const subtree = renderChildrenOf(opt, childrenOf, chain, groups, visited, depth + 1);
            html += renderTreeRow(opt, group.reqType, false, subtree, false);
        }
    }
    html += `</div></div>`;
    return html;
}

// A satisfied (or unwalked) group option: a plain leaf row, ticked when
// already played.
function renderTreePlayedOptionHtml(opt) {
    const isPlayedOpt = isDialoguePlayed(opt) === true;
    return renderTreeRow(opt, null, false, '', isPlayedOpt);
}

export function renderEligibility(dialogueName) {
    const container = document.getElementById('info-content');
    if (!container) return;

    if (!getSaveProgress() || !saveMatchesActiveGame()) {
        container.innerHTML = '<div class="empty-state">Load a save file to use the eligibility tracer</div>';
        return;
    }

    if (!dialogueName) {
        container.innerHTML = '<div class="empty-state">Search for a dialogue above to trace its eligibility</div>';
        return;
    }

    const tl = textlines[dialogueName];
    if (!tl) {
        container.innerHTML = `<div class="empty-state">Dialogue "${escapeHtml(dialogueName)}" not found in game data</div>`;
        return;
    }

    const { chain, groups, mandatory } = buildPrereqChain(dialogueName);

    let html = `<div class="eligibility-view">`;
    html += `<div class="eligibility-target">`;
    html += `<h3>Eligibility: <a class="eligibility-target-link" onclick="navigateTo(${jsAttr(dialogueName)})">${escapeHtml(dialogueName)}</a></h3>`;
    html += `<div class="eligibility-target-meta">Owner: ${renderSpeakerHtml(tl.owner)}</div>`;
    html += `</div>`;

    html += renderSummaryHtml(dialogueName, chain, groups, mandatory);
    html += renderUnplayedListHtml(chain, mandatory, dialogueName, groups);
    html += renderTreeHtml(chain, dialogueName, groups);

    html += `</div>`;
    container.innerHTML = html;
}
