// Tree component (lazy expansion).
//
// Builds the tree-row DOM nodes used by both the upstream and
// downstream panels. The render entry points + grouping helpers live
// in ``tree-renderers.js``; the two files reference each other
// (tree -> tree-renderers for ``appendChildrenWithTypeGrouping``;
// tree-renderers -> tree for ``createNodeEl`` / ``getChildren``),
// which is fine for ES modules because every reference happens inside
// a function body.

import {
    textlines,
    dependents,
    speakers,
    knownUnresolved,
    unresolvedCategoryLabels,
    unresolvedRefBlocks,
} from './data.js';
import {
    getEdgeClass,
    getEdgeLabel,
    unresolvedCategoryFor,
    renderTierBadgeHtml,
} from './utilities.js';
import { renderInfo } from './info-panel.js';
import { appendChildrenWithTypeGrouping } from './tree-renderers.js';
import { navigateTo } from './navigation.js';

export function getChildren(name, direction) {
    const children = [];
    if (direction === 'upstream') {
        const tl = textlines[name];
        if (tl) {
            for (const [type, refs] of Object.entries(tl.requirements)) {
                const sources = (tl.requirementSources && tl.requirementSources[type]) || [];
                for (let i = 0; i < refs.length; i++) {
                    // Skip self-references: they always come from cooldown
                    // / PlayOnce fields (MinRunsSinceAnyTextLines,
                    // RequiredFalseTextLines*) and would render as a
                    // misleading recursive edge. Still shown in the
                    // requirements list in renderInfo with a "self" badge.
                    if (refs[i] === name) continue;
                    children.push({
                        name: refs[i],
                        edgeType: type,
                        group: sources[i] || null,
                    });
                }
            }
        }
    } else {
        for (const dep of (dependents[name] || [])) {
            // Self-edges are already filtered out of the dependents
            // index by graph.py, but guard defensively in case the
            // upstream data ever changes.
            if (dep.name === name) continue;
            children.push({ name: dep.name, edgeType: dep.type, group: null });
        }
    }
    return children;
}

export function hasChildren(name, direction) {
    if (direction === 'upstream') {
        const tl = textlines[name];
        if (!tl) return false;
        // Mirror getChildren's self-filter so a textline whose only
        // requirement is a self-reference renders as a leaf.
        return Object.values(tl.requirements).some(
            r => r.some(ref => ref !== name)
        );
    }
    return (dependents[name] || []).some(d => d.name !== name);
}

// Bring newly-expanded content into the visible scroll viewport. After
// a DOM mutation reveals new tree rows (e.g. clicking a `.tree-label`
// toggle, expanding a `.req-type-group` / `.gamedata-group` header),
// horizontally scroll the enclosing `.panel-body` to the rightmost
// position so the full extent of the section is on-screen. CSS handles
// the actual layout / right-edge alignment (see `styles/tree.css`):
// each container uses default block layout so its right edge equals
// its parent's right edge, and the root `.tree-node.root` sizes to
// `max-content` so the panel-body scrollWidth equals the widest
// descendant's natural content width. We only need to nudge the
// scroll position here.
//
// We always scroll to `panelBody.scrollWidth` (auto-clamped to the
// max scrollable position) rather than measuring whether the new
// container fits in the current viewport. Measuring `container.right`
// is unreliable because: the newly-revealed branch can contain deeper
// labels that grew the panel's intrinsic width via `max-content`
// propagation; each level of `.req-type-group` / `.gamedata-group`
// adds `padding-right` framing so the container's right edge sits
// inside the panel's rightmost content; and a previous expand may
// have already scrolled the container into view, leaving the
// section's full extent still off-screen. Unconditional max-scroll
// matches the user's mental model: "expand to see the whole section".
export function ensureExpandedContentVisible(container) {
    if (!container) return;
    const panelBody = container.closest('.panel-body');
    if (!panelBody) return;
    requestAnimationFrame(() => {
        panelBody.scrollTo({ left: panelBody.scrollWidth, behavior: 'smooth' });
    });
}

export function createNodeEl(name, edgeType, direction, ancestorPath) {
    const tl = textlines[name];
    // Use the friendly display name for the owner tag when available,
    // otherwise fall back to a stripped-down version of the internal ID.
    let ownerTag = '?';
    if (tl) {
        ownerTag = speakers[tl.owner]?.name || tl.owner.replace('NPC_', '').replace('_01', '');
    }
    const isCycle = ancestorPath.has(name);
    const expandable = !isCycle && hasChildren(name, direction);

    const node = document.createElement('div');
    node.className = 'tree-node';

    const label = document.createElement('div');
    label.className = 'tree-label';
    label.dataset.name = name;
    label.dataset.direction = direction;
    label.dataset.ancestors = JSON.stringify([...ancestorPath]);

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = expandable ? '\u25B6' : '\u00B7';
    label.appendChild(toggle);

    if (edgeType) {
        const edge = document.createElement('span');
        edge.className = `edge-type ${getEdgeClass(edgeType)}`;
        edge.textContent = getEdgeLabel(edgeType);
        label.appendChild(edge);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = name;
    label.appendChild(nameSpan);

    if (!tl) {
        const cat = unresolvedCategoryFor(name);
        const warn = document.createElement('span');
        warn.className = `tree-unresolved-badge unresolved-cat-${cat || 'uncategorized'}`;
        const known = knownUnresolved[name];
        if (known) {
            const lbl = unresolvedCategoryLabels[cat] || cat;
            warn.textContent = lbl;
            warn.title = known.reason;
        } else {
            warn.textContent = '\u26A0 not in game';
            warn.title = 'Not found in the parsed game data.';
        }
        label.appendChild(warn);
        const blocks = unresolvedRefBlocks[name] || [];
        if (blocks.length > 0) {
            const blockedBadge = document.createElement('span');
            blockedBadge.className = 'tree-blocked-badge';
            blockedBadge.textContent = `\u26D4 blocks ${blocks.length}`;
            blockedBadge.title = `Blocks ${blocks.length} dialogue${blocks.length === 1 ? '' : 's'} from ever playing: ${blocks.join(', ')}`;
            label.appendChild(blockedBadge);
        }
    } else if (tl.blocked) {
        const blockedBadge = document.createElement('span');
        blockedBadge.className = 'tree-blocked-badge';
        blockedBadge.textContent = '\u26D4 blocked';
        const reasonText = (tl.blockingReasons || [])
            .map(r => `${r.field}: missing ${r.missingRefs.join(', ')}`)
            .join(' \u00B7 ');
        blockedBadge.title = reasonText
            ? `This dialogue can never play. ${reasonText}`
            : 'This dialogue can never play.';
        label.appendChild(blockedBadge);
    }

    if (isCycle) {
        const cycleSpan = document.createElement('span');
        cycleSpan.className = 'cycle-marker';
        cycleSpan.textContent = ' \u21A9 cycle';
        label.appendChild(cycleSpan);
    }

    // Narrative-priority tier badge. Tree view shows
    // only the section-tier badge to keep rows uncluttered; the
    // set-level (SP/P) and PlayOnce indicators are reserved for the
    // details panel. Placed inside the right-aligned cluster of the
    // row so badges line up across rows regardless of name length.
    // Only relevant for resolved textlines (`tl != null`).
    if (tl) {
        const tierHtml = renderTierBadgeHtml(tl);
        if (tierHtml) {
            const wrapper = document.createElement('span');
            wrapper.innerHTML = tierHtml;
            while (wrapper.firstChild) {
                label.appendChild(wrapper.firstChild);
            }
        }
    }

    const npcSpan = document.createElement('span');
    npcSpan.className = 'npc-tag';
    npcSpan.textContent = ownerTag;
    if (tl) {
        // Mirror the tooltip format used by renderSpeakerHtml:
        //   friendly + description:    "Friendly (internal id)\nDescription"
        //   friendly without quip:     "Friendly (internal id)"
        //   no friendly + description: "Description"   (id visible already)
        //   nothing known:             no tooltip
        const entry = speakers[tl.owner] || {};
        const friendly = entry.name;
        const description = entry.description;
        if (friendly && friendly !== tl.owner) {
            const titleParts = [`${friendly} (${tl.owner})`];
            if (description) titleParts.push(description);
            npcSpan.title = titleParts.join('\n');
        } else if (description) {
            npcSpan.title = description;
        }
    }
    label.appendChild(npcSpan);

    // Focus button (for non-root nodes)
    if (edgeType) {
        const btn = document.createElement('span');
        btn.className = 'focus-btn';
        btn.title = 'Focus on this dialogue';
        btn.textContent = '\u2934';
        label.appendChild(btn);
    }

    node.appendChild(label);

    // Click handler
    label.addEventListener('click', (e) => {
        if (e.target.classList.contains('focus-btn')) {
            navigateTo(name);
            return;
        }
        if (!expandable) {
            renderInfo(name);
            return;
        }
        let childContainer = label.nextElementSibling;
        if (childContainer && childContainer.classList.contains('tree-children')) {
            // Toggle existing children
            const isExpanded = childContainer.classList.contains('expanded');
            childContainer.classList.toggle('expanded');
            toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
            if (!isExpanded) ensureExpandedContentVisible(childContainer);
        } else {
            // Lazily create children
            childContainer = document.createElement('div');
            childContainer.className = 'tree-children expanded';
            const newPath = new Set(ancestorPath);
            newPath.add(name);
            const kids = getChildren(name, direction);
            appendChildrenWithTypeGrouping(childContainer, kids, direction, newPath, name);
            node.appendChild(childContainer);
            toggle.textContent = '\u25BC';
            ensureExpandedContentVisible(childContainer);
        }
        renderInfo(name);
    });

    label.addEventListener('dblclick', () => navigateTo(name));

    return node;
}
