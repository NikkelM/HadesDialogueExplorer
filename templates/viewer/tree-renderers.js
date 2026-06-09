// Tree panel renderers: upstream / downstream entry points plus the
// requirement-type and GameData-source grouping wrappers that wrap
// chunks of children in collapsible boxes.

import { textlines } from './data.js';
import {
    reqTypeOrderIndex,
    getEdgeClass,
    getEdgeLabel,
    formatReqType,
    reqTypeTitleText,
} from './utilities.js';
import { createNodeEl, getChildren, ensureExpandedContentVisible } from './tree.js';

export function renderUpstream(name) {
    const container = document.getElementById('upstream-content');
    container.innerHTML = '';
    const rootPath = new Set();
    const rootNode = createNodeEl(name, null, 'upstream', rootPath);
    rootNode.classList.add('root');
    rootNode.querySelector('.tree-label').classList.add('active');
    // Auto-expand root's children
    const kids = getChildren(name, 'upstream');
    if (kids.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        const newPath = new Set([name]);
        appendChildrenWithTypeGrouping(childContainer, kids, 'upstream', newPath, name);
        rootNode.appendChild(childContainer);
        rootNode.querySelector('.toggle').textContent = '\u25BC';
    }
    container.appendChild(rootNode);
}

export function renderDownstream(name) {
    const container = document.getElementById('downstream-content');
    container.innerHTML = '';
    const rootPath = new Set();
    const rootNode = createNodeEl(name, null, 'downstream', rootPath);
    rootNode.classList.add('root');
    rootNode.querySelector('.tree-label').classList.add('active');
    // Auto-expand root's children
    const kids = getChildren(name, 'downstream');
    if (kids.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children expanded';
        const newPath = new Set([name]);
        appendChildrenWithTypeGrouping(childContainer, kids, 'downstream', newPath, name);
        rootNode.appendChild(childContainer);
        rootNode.querySelector('.toggle').textContent = '\u25BC';
    }
    container.appendChild(rootNode);
}

// Outer grouping: sorts kids by requirement-type order, then wraps each
// contiguous same-type run in a colour-coded `.req-type-group` box that
// mirrors the per-type styling in the info panel. Inside each box the
// existing GameData grouping (`appendGroupedChildren`) still runs, so the
// nesting is:
//   .req-type-group  (per requirement type, e.g. ALL / ANY / NOT / ...)
//     `-- .gamedata-group  (per GameData.X source list, optional)
//          `-- .tree-node
//
// Count-based requirement types (Min/MaxRunsSinceAny, RequiredMin/MaxAny)
// stash their threshold in ``otherRequirements[edgeType].Count`` on the
// textline that OWNS the requirement: for upstream the parent (one count
// for the whole group); for downstream each child individually (counts
// can vary per dependent). Grouping by ``(edgeType, count)`` means each
// group header carries a single, unambiguous count to display alongside
// the friendly label - upstream collapses to one group as before;
// downstream splits into per-count subgroups when threshold values
// differ across dependents. Used by both the root auto-expand path and
// the lazy-expand path so the grouping is consistent at every depth.
export function appendChildrenWithTypeGrouping(container, kids, direction, ancestorPath, parentName) {
    if (kids.length === 0) return;
    // Annotate each kid with the Count threshold for its
    // requirement-relationship to ``parentName``. For upstream the
    // requirement (and thus the count) lives on the parent; for
    // downstream it lives on the child itself.
    const annotated = kids.map(k => {
        const ownerName = direction === 'upstream' ? parentName : k.name;
        const owner = textlines[ownerName];
        const meta = owner && owner.otherRequirements && owner.otherRequirements[k.edgeType];
        const count = (meta && typeof meta === 'object' && 'Count' in meta) ? meta.Count : null;
        return { name: k.name, edgeType: k.edgeType, group: k.group, _count: count };
    });
    // Stable sort by (req-type order, count). JS Array.prototype.sort is
    // stable in all evergreen browsers, so kids within the same key keep
    // their natural insertion order - which is what the inner GameData
    // chunking relies on to detect contiguous same-group runs.
    const sorted = annotated.slice().sort((a, b) => {
        const d = reqTypeOrderIndex(a.edgeType) - reqTypeOrderIndex(b.edgeType);
        if (d !== 0) return d;
        const ac = a._count == null ? -Infinity : a._count;
        const bc = b._count == null ? -Infinity : b._count;
        return ac - bc;
    });
    let i = 0;
    while (i < sorted.length) {
        const edgeType = sorted[i].edgeType;
        const groupCount = sorted[i]._count;
        let j = i;
        while (j < sorted.length && sorted[j].edgeType === edgeType && sorted[j]._count === groupCount) j++;
        const chunk = sorted.slice(i, j);
        const box = createReqTypeGroup(edgeType, chunk.length, groupCount);
        const groupChildren = box.querySelector('.req-type-group-children');
        appendGroupedChildren(groupChildren, chunk, direction, ancestorPath);
        container.appendChild(box);
        i = j;
    }
}

export function createReqTypeGroup(edgeType, count, requirementCount) {
    const box = document.createElement('div');
    box.className = `req-type-group req-type-${edgeType}`;

    const header = document.createElement('div');
    header.className = 'req-type-group-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const edgeChip = document.createElement('span');
    edgeChip.className = `edge-type ${getEdgeClass(edgeType)}`;
    edgeChip.textContent = getEdgeLabel(edgeType);
    header.appendChild(edgeChip);

    const label = document.createElement('span');
    label.className = 'req-type-group-label';
    // Append the count threshold for count-based requirement fields
    // so the tree-view header matches the detail-view format
    // ``Must have played at least (ANY): 3``.
    const friendlyLabel = formatReqType(edgeType);
    label.textContent = requirementCount != null
        ? `${friendlyLabel}: ${requirementCount}`
        : friendlyLabel;
    // Mirror the other render*Html helpers: attach the tooltip on both
    // the edge-chip and the label so hovering over either part of the
    // header surfaces the internal field name + plain-English blurb.
    // Skipped for unmapped types so they stay plain. The
    // ``[data-tooltip]`` attribute is the single source for both the
    // floating-popup payload (``tooltip.js``) and the dotted-underline
    // / help-cursor affordance (``panels-tooltips.css``).
    const titleText = reqTypeTitleText(edgeType);
    if (titleText !== null) {
        label.dataset.tooltip = titleText;
        edgeChip.dataset.tooltip = titleText;
    }
    header.appendChild(label);

    const countSpan = document.createElement('span');
    countSpan.className = 'req-type-group-count';
    countSpan.textContent = `${count} textline${count === 1 ? '' : 's'}`;
    header.appendChild(countSpan);

    const childrenBox = document.createElement('div');
    childrenBox.className = 'req-type-group-children expanded';

    header.addEventListener('click', () => {
        const isExpanded = childrenBox.classList.contains('expanded');
        childrenBox.classList.toggle('expanded');
        toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
        if (!isExpanded) ensureExpandedContentVisible(childrenBox);
    });

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}

// Walks the children list and chunks contiguous runs that share the same
// non-null GameData group + edge type into a single collapsible
// `.gamedata-group` box. Ungrouped children are appended as-is. Called
// from `appendChildrenWithTypeGrouping` after kids have already been
// chunked by requirement type.
export function appendGroupedChildren(container, kids, direction, ancestorPath) {
    let i = 0;
    while (i < kids.length) {
        const child = kids[i];
        if (child.group) {
            let j = i;
            while (
                j < kids.length
                && kids[j].group === child.group
                && kids[j].edgeType === child.edgeType
            ) {
                j++;
            }
            const box = createGameDataGroup(child.group, child.edgeType, j - i);
            const groupChildren = box.querySelector('.gamedata-group-children');
            for (let k = i; k < j; k++) {
                groupChildren.appendChild(
                    createNodeEl(kids[k].name, kids[k].edgeType, direction, ancestorPath)
                );
            }
            container.appendChild(box);
            i = j;
        } else {
            container.appendChild(
                createNodeEl(child.name, child.edgeType, direction, ancestorPath)
            );
            i++;
        }
    }
}

export function createGameDataGroup(groupName, edgeType, count) {
    const box = document.createElement('div');
    box.className = 'gamedata-group';

    const header = document.createElement('div');
    header.className = 'gamedata-group-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const edgeChip = document.createElement('span');
    edgeChip.className = `edge-type ${getEdgeClass(edgeType)}`;
    edgeChip.textContent = getEdgeLabel(edgeType);
    header.appendChild(edgeChip);

    const label = document.createElement('span');
    label.className = 'gamedata-group-label';
    label.textContent = groupName;
    header.appendChild(label);

    const countSpan = document.createElement('span');
    countSpan.className = 'gamedata-group-count';
    countSpan.textContent = `${count} textline${count === 1 ? '' : 's'}`;
    header.appendChild(countSpan);

    const childrenBox = document.createElement('div');
    childrenBox.className = 'gamedata-group-children expanded';

    header.addEventListener('click', () => {
        const isExpanded = childrenBox.classList.contains('expanded');
        childrenBox.classList.toggle('expanded');
        toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
        if (!isExpanded) ensureExpandedContentVisible(childrenBox);
    });

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}
