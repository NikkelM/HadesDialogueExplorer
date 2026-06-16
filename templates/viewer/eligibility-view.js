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

// Requirement types that represent hard AND prerequisites (all must be played).
const AND_REQ_TYPES = new Set([
    'RequiredTextLines',
    'RequiredTextLinesThisRun',
    'RequiredQueuedTextLines',
]);

// Requirement types that represent OR prerequisites (any one suffices).
const OR_REQ_TYPES = new Set([
    'RequiredAnyTextLines',
    'RequiredAnyTextLinesLastRun',
    'RequiredAnyQueuedTextLines',
    'RequiredAnyOtherTextLines',
]);

// Types we skip: negative requirements (must NOT have played), cooldowns,
// and count-based gates (not dialogue prerequisites).
// RequiredFalse*, MinRunsSince*, MaxRunsSince*, RequiredMin*, RequiredMax*

// Recursively collect the prerequisite chain for a dialogue, respecting
// AND vs OR semantics. Only includes nodes that are actually needed.
// Returns a Map of name -> { depth, parents, played }
function buildPrereqChain(rootName) {
    const chain = new Map();
    const visited = new Set();

    function walk(name, depth) {
        if (visited.has(name)) return;
        visited.add(name);

        const tl = textlines[name];
        if (!tl || !tl.requirements) return;

        for (const [reqType, refs] of Object.entries(tl.requirements)) {
            if (!Array.isArray(refs)) continue;

            if (AND_REQ_TYPES.has(reqType)) {
                // ALL refs are needed
                for (const ref of refs) {
                    if (ref === name) continue;
                    addToChain(ref, name, reqType, depth);
                    walk(ref, depth + 1);
                }
            } else if (OR_REQ_TYPES.has(reqType)) {
                // Only ONE ref is needed - pick the best option:
                // 1. If any ref is already played, the OR is satisfied - skip all
                // 2. Otherwise, include only the option with fewest unplayed transitive deps
                const anyPlayed = refs.some(ref => ref !== name && isDialoguePlayed(ref) === true);
                if (anyPlayed) continue; // OR gate already satisfied

                // Find cheapest unplayed option (by shallow heuristic: prefer
                // refs that exist in the game data and have fewer direct reqs)
                let cheapest = null;
                let cheapestCost = Infinity;
                for (const ref of refs) {
                    if (ref === name) continue;
                    const refTl = textlines[ref];
                    const cost = refTl ? Object.values(refTl.requirements || {}).reduce((s, r) => s + r.length, 0) : 999;
                    if (cost < cheapestCost) {
                        cheapestCost = cost;
                        cheapest = ref;
                    }
                }
                if (cheapest) {
                    addToChain(cheapest, name, reqType, depth);
                    walk(cheapest, depth + 1);
                }
            }
            // Skip RequiredFalse*, MinRunsSince*, MaxRunsSince*, RequiredMin*, RequiredMax*
        }
    }

    function addToChain(ref, parentName, reqType, depth) {
        if (!chain.has(ref)) {
            chain.set(ref, {
                depth: depth + 1,
                parents: [{ name: parentName, reqType }],
                played: isDialoguePlayed(ref) === true,
            });
        } else {
            const entry = chain.get(ref);
            entry.parents.push({ name: parentName, reqType });
            entry.depth = Math.max(entry.depth, depth + 1);
        }
    }

    walk(rootName, 0);
    return chain;
}

// Filter chain to only nodes on paths containing at least one unplayed node
function filterUnplayedPaths(chain, rootName) {
    // A node is relevant if: it's unplayed, OR it has a descendant (closer to root)
    // that depends on an unplayed node
    const relevant = new Set();

    // Start from all unplayed nodes and trace back to root
    for (const [name, info] of chain) {
        if (!info.played) {
            relevant.add(name);
            // Trace parents back toward root
            let current = [name];
            const traced = new Set([name]);
            while (current.length > 0) {
                const next = [];
                for (const n of current) {
                    const entry = chain.get(n);
                    if (!entry) continue;
                    for (const parent of entry.parents) {
                        if (parent.name === rootName) continue;
                        if (!traced.has(parent.name)) {
                            traced.add(parent.name);
                            relevant.add(parent.name);
                            next.push(parent.name);
                        }
                    }
                }
                current = next;
            }
        }
    }
    return relevant;
}

function renderSummaryHtml(rootName, chain) {
    const total = chain.size;
    const played = [...chain.values()].filter(n => n.played).length;
    const unplayed = total - played;
    const rootPlayed = isDialoguePlayed(rootName) === true;

    let html = `<div class="eligibility-summary">`;

    if (rootPlayed) {
        html += `<div class="eligibility-status eligibility-played">\u2714 Already played</div>`;
        html += `<div class="eligibility-detail">${escapeHtml(rootName)} is already in this save's TextLinesRecord.</div>`;
    } else if (unplayed === 0) {
        html += `<div class="eligibility-status eligibility-eligible">\u25CB Eligible to play</div>`;
        html += `<div class="eligibility-detail">All ${total} prerequisite dialogue${total === 1 ? '' : 's'} have been played. This dialogue should be eligible.</div>`;
    } else {
        html += `<div class="eligibility-status eligibility-blocked">\u2022 Blocked</div>`;
        html += `<div class="eligibility-detail">${unplayed} of ${total} prerequisite${total === 1 ? '' : 's'} still needed.</div>`;
        html += `<div class="eligibility-progress-bar"><div class="eligibility-progress-fill" style="width:${total > 0 ? (played / total * 100) : 0}%"></div></div>`;
        html += `<div class="eligibility-progress-label">${played}/${total} complete</div>`;
    }

    html += `</div>`;
    return html;
}

function renderUnplayedListHtml(chain, relevantNodes, rootName) {
    // Get direct unplayed prerequisites (immediate blockers)
    const rootTl = textlines[rootName];
    if (!rootTl) return '';

    // Collect all unplayed nodes sorted by depth (deepest first = play first)
    const unplayed = [];
    for (const [name, info] of chain) {
        if (!info.played && relevantNodes.has(name)) {
            unplayed.push({ name, ...info });
        }
    }
    unplayed.sort((a, b) => b.depth - a.depth);

    if (unplayed.length === 0) return '';

    let html = `<div class="eligibility-tree">`;
    html += `<h4 class="eligibility-tree-header">Unplayed prerequisites (${unplayed.length})</h4>`;
    html += `<div class="eligibility-tree-hint">Ordered by depth (deepest first - play in this order)</div>`;
    html += `<div class="eligibility-list">`;

    for (const node of unplayed) {
        const tl = textlines[node.name];
        const ownerEntry = tl ? speakers[tl.owner] : null;
        const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '?');

        // Show which dialogues require this one (the "needed by" chain toward root)
        const neededBy = node.parents
            .filter(p => p.name === rootName || (chain.has(p.name) && !chain.get(p.name).played))
            .map(p => p.name)
            .slice(0, 3);
        const neededByStr = neededBy.length > 0
            ? neededBy.map(n => `<a class="eligibility-ref" onclick="event.stopPropagation();navigateTo(${jsAttr(n)})">${escapeHtml(n.length > 25 ? n.slice(0, 23) + '\u2026' : n)}</a>`).join(', ')
            : '';

        // Edge type labels
        const edgeLabels = [...new Set(node.parents.map(p => p.reqType))];
        const edgeBadges = edgeLabels
            .map(t => `<span class="edge-type ${getEdgeClass(t)}">${getEdgeLabel(t)}</span>`)
            .join(' ');

        html += `<div class="eligibility-item" onclick="navigateTo(${jsAttr(node.name)})">`;
        html += `<div class="eligibility-item-main">`;
        html += `<span class="eligibility-depth">L${node.depth}</span>`;
        html += `<span class="eligibility-item-name">${escapeHtml(node.name)}</span>`;
        html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
        html += `</div>`;
        if (edgeBadges || neededByStr) {
            html += `<div class="eligibility-item-meta">`;
            if (edgeBadges) html += edgeBadges;
            if (neededByStr) html += ` <span class="eligibility-needed-by">needed by ${neededByStr}</span>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    html += `</div></div>`;
    return html;
}

function renderTreeHtml(chain, rootName) {
    if (chain.size === 0) return '';

    // Build a children map: for each node, which chain entries list it as a parent?
    const childrenOf = new Map();
    for (const [name, info] of chain) {
        for (const p of info.parents) {
            if (!childrenOf.has(p.name)) childrenOf.set(p.name, []);
            childrenOf.get(p.name).push({ name, reqType: p.reqType });
        }
    }

    // If root has no direct children in the chain, nothing to show
    if (!childrenOf.has(rootName) || childrenOf.get(rootName).length === 0) return '';

    let html = `<div class="eligibility-tree-section">`;
    html += `<h4 class="eligibility-tree-header">Prerequisite tree</h4>`;
    html += `<div class="eligibility-tree-hint">Nested view showing dependency hierarchy</div>`;
    html += `<div class="eligibility-tree-container">`;
    html += renderTreeNode(rootName, childrenOf, chain, new Set(), 0);
    html += `</div></div>`;
    return html;
}

function renderTreeNode(name, childrenOf, chain, visited, depth) {
    if (visited.has(name) || depth > 20) return '';
    visited.add(name);

    const children = childrenOf.get(name) || [];
    if (children.length === 0 && !chain.has(name)) return '';

    let html = '';
    for (const child of children) {
        const info = chain.get(child.name);
        if (!info) continue;

        const playedClass = info.played ? 'tree-played' : 'tree-unplayed';
        const icon = info.played ? '\u2714' : '\u2022';
        const tl = textlines[child.name];
        const ownerEntry = tl ? speakers[tl.owner] : null;
        const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '');
        const edgeLabel = getEdgeLabel(child.reqType);

        // Only recurse into unplayed nodes - played ones are satisfied
        const subtree = info.played ? '' : renderTreeNode(child.name, childrenOf, chain, visited, depth + 1);
        const hasChildren = subtree.length > 0;
        const chevron = hasChildren ? '<span class="tree-chevron">\u25B6</span>' : '';
        const statusIcon = info.played ? '<span class="tree-icon">\u2714</span>' : '';

        html += `<div class="tree-node ${playedClass}${hasChildren ? ' collapsible collapsed' : ''}">`;
        html += `<div class="tree-node-row"${hasChildren ? ' onclick="this.parentElement.classList.toggle(\'collapsed\')"' : ''} ondblclick="event.stopPropagation();navigateTo(${jsAttr(child.name)})">`;
        html += `${chevron}${statusIcon}`;
        html += `<span class="tree-name">${escapeHtml(child.name)}</span>`;
        if (ownerLabel) html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
        html += `<span class="edge-type ${getEdgeClass(child.reqType)}">${edgeLabel}</span>`;
        html += `<a class="tree-link" onclick="event.stopPropagation();navigateTo(${jsAttr(child.name)})" title="Open detail view">\u2197</a>`;
        html += `</div>`;

        if (hasChildren) html += `<div class="tree-children">${subtree}</div>`;

        html += `</div>`;
    }
    return html;
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

    const chain = buildPrereqChain(dialogueName);
    const relevantNodes = filterUnplayedPaths(chain, dialogueName);

    let html = `<div class="eligibility-view">`;
    html += `<div class="eligibility-target">`;
    html += `<h3>Eligibility: <a class="eligibility-target-link" onclick="navigateTo(${jsAttr(dialogueName)})">${escapeHtml(dialogueName)}</a></h3>`;
    html += `<div class="eligibility-target-meta">Owner: ${renderSpeakerHtml(tl.owner)}</div>`;
    html += `</div>`;

    html += renderSummaryHtml(dialogueName, chain);
    html += renderUnplayedListHtml(chain, relevantNodes, dialogueName);
    html += renderTreeHtml(chain, dialogueName);

    html += `</div>`;
    container.innerHTML = html;
}
