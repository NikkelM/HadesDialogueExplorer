// Tree panel renderers: upstream / downstream entry points plus the
// requirement-type and GameData-source grouping wrappers that wrap
// chunks of children in collapsible boxes.

import { textlines, alternates } from './data.js';
import {
    reqTypeOrderIndex,
    getEdgeClass,
    getEdgeLabel,
    formatReqType,
    reqTypeTitleText,
} from './utilities.js';
import { reqGroupStatus, reqGroupLocked, requirementSetStatus, runsSinceGroupTooltip } from './requirements.js';
import { isGroupUnobtainable, isRequirementSetUnobtainable } from './unobtainable.js';
import { getSaveProgress, getSaveContext, saveMatchesActiveGame } from './save-parser.js';
import { createNodeEl, getChildren, ensureExpandedContentVisible } from './tree.js';


// The loaded save's evaluation context, but only when it applies to the
// active game; otherwise null. Group-satisfaction verdicts render only when
// this is non-null (upstream tree only - a group's "satisfied?" question is
// meaningless for downstream dependents).
function activeSaveContext() {
    return (getSaveProgress() && saveMatchesActiveGame()) ? getSaveContext() : null;
}

// Whether a requirement set (one ``orBranches`` alternative) carries a
// non-dialogue gate the tool can't evaluate from a save - a Path /
// FunctionName / GameState check or any other ``otherRequirements`` entry
// that isn't merely the count threshold for a textline requirement (those
// share their key with the requirement, e.g. ``RequiredMinAnyTextLines``).
// Used to downgrade an otherwise-"met" branch to indeterminate, since its
// real eligibility hinges on a condition outside the played record.
function branchHasUnevaluableGates(branch) {
    const req = (branch && branch.requirements) || {};
    const other = (branch && branch.otherRequirements) || {};
    return Object.keys(other).some(k => !(k in req));
}

// Build the satisfaction verdict dot for a group header. ``status`` is
// 'met' | 'unmet' | 'unknown' | 'unobtainable' (anything else - e.g. null
// when no save is loaded - renders no dot). ``detail`` is an optional richer
// tooltip (used for run-count groups to spell out each line's runs-ago
// distance and why it makes the group met/unmet/permanently locked); when
// absent the generic per-status wording is used. The dot mirrors the per-row
// save badge's visual language: green when met, grey when unmet, the
// indeterminate periwinkle when the field can't be resolved from a save, and
// the unobtainable red when the group can never be satisfied again. Placed
// right after the chevron so the verdicts line up down the left edge.
function makeGroupStatusBadge(status, detail = null) {
    if (!['met', 'unmet', 'unknown', 'unobtainable'].includes(status)) return null;
    const badge = document.createElement('span');
    badge.className = `group-status group-status-${status}`;
    badge.dataset.tooltip = detail
        || (status === 'met' ? 'Satisfied by the loaded save: every line this group needs has played (or, for a "must not have played" gate, none have).'
            : status === 'unmet' ? 'Not satisfied by the loaded save: this group\u2019s condition is not met yet.'
                : status === 'unobtainable' ? 'Permanently locked: this group can never be satisfied again in this save (a play-once line is past its run-count window, a one-time line has already played, or a count cap is exceeded).'
                    : 'Can\u2019t be determined: this dialogue is gated by requirements the save doesn\u2019t include (such as queued textlines).');
    return badge;
}


// Wire the collapse/expand toggle shared by every static sub-tree header
// (OR groups, count-min groups, GameData groups, alternates): clicking the
// header flips the `.expanded` class on its children box and swaps the
// chevron glyph (down = open, right = closed). Centralised so the
// behaviour can't drift between the otherwise-identical group renderers.
// The main lazy-loading dependency tree (tree.js) keeps its own handler
// because it also triggers on-demand child rendering and stops event
// propagation to the row.
function attachCollapseToggle(header, toggle, childrenBox) {
    header.addEventListener('click', () => {
        const isExpanded = childrenBox.classList.contains('expanded');
        childrenBox.classList.toggle('expanded');
        toggle.textContent = isExpanded ? '\u25B6' : '\u25BC';
        if (!isExpanded) ensureExpandedContentVisible(childrenBox);
    });
}

// Append a short italic note under a leaf root so an empty prerequisite /
// dependent tree reads as "intentionally nothing here" rather than a render
// that failed to load. The root's toggle stays blank (it is a true leaf).
function appendEmptyTreeNote(rootNode, text) {
    const note = document.createElement('div');
    note.className = 'tree-empty-note';
    note.textContent = text;
    rootNode.appendChild(note);
}

export function renderUpstream(name) {
    const container = document.getElementById('upstream-content');
    container.innerHTML = '';
    container.setAttribute('role', 'tree');
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
        rootNode.querySelector('.tree-label').setAttribute('aria-expanded', 'true');
    } else {
        appendEmptyTreeNote(rootNode, 'This textline has no dialogue prerequisites.');
    }
    container.appendChild(rootNode);
}

export function renderDownstream(name) {
    const container = document.getElementById('downstream-content');
    container.innerHTML = '';
    container.setAttribute('role', 'tree');
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
        rootNode.querySelector('.tree-label').setAttribute('aria-expanded', 'true');
    } else {
        appendEmptyTreeNote(rootNode, 'No other textlines depend on this one.');
    }
    container.appendChild(rootNode);
}

// Outer grouping: partitions kids into the AND base block (no
// ``orBranchIndex``) and H2 OR-branch alternatives (one or more
// alternatives, each tagged with a 1-based ``orBranchIndex`` +
// ``orBranchTotal``). The base block renders via the same
// requirement-type grouping it always has. The OR block renders
// inside a dedicated ``.or-group-box`` wrapper that, in turn, holds
// one ``.or-branch-box`` per alternative; each branch reuses the
// same per-type grouping internally so the visual model is
// consistent at every depth.
//
// Inside each (base or per-branch) block the existing GameData
// grouping (``appendGroupedChildren``) still runs, so the nesting is:
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
    const baseKids = kids.filter(k => !k.orBranchIndex);
    const orKids = kids.filter(k => k.orBranchIndex);
    if (baseKids.length > 0) {
        appendByReqTypeGroups(container, baseKids, direction, ancestorPath, parentName);
    }
    if (direction === 'upstream') {
        // Surface the full OR group even when zero branches contributed
        // textline kids. A branch can be gated entirely on non-textline
        // conditions (Path checks, FunctionName checks) and would
        // otherwise be invisible in the tree even though it is a real
        // alternative the engine evaluates. Each empty branch renders
        // as a compact placeholder row directing the user to the
        // details panel for the full content.
        const parent = parentName ? textlines[parentName] : null;
        const parentOrBranches = (parent && Array.isArray(parent.orBranches)) ? parent.orBranches : [];
        if (orKids.length > 0 || parentOrBranches.length > 0) {
            appendOrAlternatives(container, orKids, direction, ancestorPath, parentName, parentOrBranches);
        }
    } else if (orKids.length > 0) {
        // Downstream: dependents that reference parentName via an OR
        // option group. Routing into their own section is semantically
        // important -- the dependent does NOT strictly require this
        // textline (any one option in its OR group satisfies the
        // gate), so mixing them with the AND base block would imply a
        // hard requirement that doesn't exist.
        appendDownstreamOrSection(container, orKids, direction, ancestorPath);
    }
}

// Inner per-req-type grouping pass. Operates on a single AND-context
// kid list (either the base block or one OR branch's contents) OR on
// a downstream OR-routed kid list (annotated kids retain their
// ``orBranchIndex`` / ``orBranchTotal`` so the per-row badge surfaces).
function appendByReqTypeGroups(container, kids, direction, ancestorPath, parentName) {
    // Annotate each kid with the Count threshold for its
    // requirement-relationship to ``parentName``. For upstream the
    // requirement (and thus the count) lives on the parent; for
    // downstream it lives on the child itself. OR-branch kids skip
    // the count lookup: the AND-base ``otherRequirements`` doesn't
    // hold per-branch counts (those live inside the branch's own
    // ``otherRequirements``) so a naive parent lookup would
    // incorrectly merge branches by mismatched count keys.
    const annotated = kids.map(k => {
        let count = null;
        if (!k.orBranchIndex) {
            const ownerName = direction === 'upstream' ? parentName : k.name;
            const owner = textlines[ownerName];
            const meta = owner && owner.otherRequirements && owner.otherRequirements[k.edgeType];
            count = (meta && typeof meta === 'object' && 'Count' in meta) ? meta.Count : null;
        }
        return {
            name: k.name,
            edgeType: k.edgeType,
            group: k.group,
            orBranchIndex: k.orBranchIndex || null,
            orBranchTotal: k.orBranchTotal || null,
            _count: count,
        };
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
        // Verdict for this requirement group against the loaded save
        // (upstream only - downstream groups list dependents, not
        // prerequisites, so "satisfied?" has no meaning there).
        let status = null;
        let statusDetail = null;
        if (direction === 'upstream') {
            const ctx = activeSaveContext();
            if (ctx) {
                const names = chunk.map(c => c.name);
                const cnt = groupCount == null ? 1 : groupCount;
                status = reqGroupStatus(edgeType, names, ctx, cnt, parentName);
                // A permanently-locked group (a play-once run-count ref past
                // its window, a one-time negative line that has played, an
                // overflowed count cap, or - transitively - a required line
                // that is itself unobtainable) can never be satisfied again,
                // so show the unobtainable verdict instead of a plain grey
                // "unmet".
                if (reqGroupLocked(edgeType, names, ctx, cnt, parentName)
                    || isGroupUnobtainable(edgeType, names, ctx.played, ctx.runsAgo, cnt, parentName)) {
                    status = 'unobtainable';
                }
                // Run-count groups get a richer tooltip spelling out each
                // line's runs-ago distance and why the group is met/unmet
                // (null for every other field type).
                statusDetail = runsSinceGroupTooltip(edgeType, names, ctx, cnt, parentName);
            }
        }
        const box = createReqTypeGroup(edgeType, chunk.length, groupCount, direction, status, statusDetail);
        const groupChildren = box.querySelector('.req-type-group-children');
        appendGroupedChildren(groupChildren, chunk, direction, ancestorPath);
        container.appendChild(box);
        i = j;
    }
}

// Wraps OR-tagged kids in a single ``.or-group-box`` collapsible
// containing one ``.or-branch-box`` per branch (1..N). Branches with
// no textline kids still get a slot - rendered as a compact
// "non-dialogue gate" placeholder pointing at the details panel -
// so the tree truthfully reflects the parent's branch count even
// when an alternative is gated entirely on non-textline conditions.
// ``parentOrBranches`` is the parent textline's full ``orBranches``
// array (upstream only). When empty, we fall back to ``orKids[0]``'s
// ``orBranchTotal`` tag so the legacy "kids-only" caller path (no
// parent context, e.g. tests) still gets a sensible count.
function appendOrAlternatives(container, orKids, direction, ancestorPath, parentName, parentOrBranches) {
    const byBranch = new Map();
    for (const k of orKids) {
        const arr = byBranch.get(k.orBranchIndex) || [];
        arr.push(k);
        byBranch.set(k.orBranchIndex, arr);
    }
    const total = parentOrBranches.length || (orKids[0] && orKids[0].orBranchTotal) || 0;
    if (total === 0) return;
    // Verdicts for the OR group + each branch against the loaded save. A
    // branch is 'unobtainable' when its requirement set is permanently
    // locked (e.g. it requires a line that can never play), 'unknown' when
    // it is gated only on non-dialogue conditions the tool can't evaluate
    // (Path / FunctionName / GameState checks), otherwise the met / unmet /
    // unknown verdict from ``requirementSetStatus``. The OR group is met
    // when any branch is met, unobtainable when every branch is
    // unobtainable, unmet only when every branch is unmet, and unknown
    // otherwise (a branch we can't confirm, none met).
    const ctx = activeSaveContext();
    const branchStatusOf = (bi) => {
        const b = parentOrBranches[bi - 1];
        if (!ctx || !b) return null;
        if (isRequirementSetUnobtainable(b, parentName, ctx.played, ctx.runsAgo)) return 'unobtainable';
        const st = requirementSetStatus(b.requirements, b.otherRequirements, ctx, parentName);
        // A branch whose textline gates all pass but that also carries
        // non-dialogue gates can't actually be confirmed satisfied - the
        // honest verdict is indeterminate, not "met".
        if (st === 'met' && branchHasUnevaluableGates(b)) return 'unknown';
        return st;
    };
    let groupStatus = null;
    if (ctx && parentOrBranches.length > 0) {
        let anyMet = false;
        let anyUnknown = false;
        let allUnobtainable = true;
        for (let bi = 1; bi <= total; bi++) {
            const st = branchStatusOf(bi);
            if (st === 'met') { anyMet = true; break; }
            if (st !== 'unobtainable') allUnobtainable = false;
            if (st !== 'unmet' && st !== 'unobtainable') anyUnknown = true;
        }
        groupStatus = anyMet ? 'met'
            : allUnobtainable ? 'unobtainable'
                : anyUnknown ? 'unknown' : 'unmet';
    }
    const groupBox = createOrGroupBox(total, groupStatus);
    const groupChildren = groupBox.querySelector('.or-group-children');
    for (let bi = 1; bi <= total; bi++) {
        const branchKids = byBranch.get(bi);
        if (branchKids && branchKids.length > 0) {
            const branchBox = createOrBranchBox(bi, total, branchKids.length, branchStatusOf(bi));
            const branchChildren = branchBox.querySelector('.or-branch-box-children');
            appendByReqTypeGroups(branchChildren, branchKids, direction, ancestorPath, parentName);
            groupChildren.appendChild(branchBox);
        } else {
            groupChildren.appendChild(createOrBranchPlaceholder(bi, total));
        }
    }
    container.appendChild(groupBox);
}

// Downstream sibling of ``appendOrAlternatives``. Wraps all OR-routed
// dependent kids in a single ``.or-downstream-section`` collapsible
// labelled "Optional gate (via OR option)" -- so the user immediately
// reads that none of these dependents strictly require the rooted
// textline (the rooted textline merely satisfies their OR group via
// one option). Internally the kids still get the standard per-req-type
// grouping pass; each row carries its own "option N/M" badge so the
// exact branch is visible without unfolding the dependent's tree.
function appendDownstreamOrSection(container, orKids, direction, ancestorPath) {
    const section = createDownstreamOrSection(orKids.length);
    const sectionChildren = section.querySelector('.or-downstream-children');
    appendByReqTypeGroups(sectionChildren, orKids, direction, ancestorPath, null);
    container.appendChild(section);
}

export function createDownstreamOrSection(count) {
    const box = document.createElement('div');
    box.className = 'or-downstream-section';

    const header = document.createElement('div');
    header.className = 'or-downstream-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const label = document.createElement('span');
    label.className = 'or-downstream-label';
    label.textContent = 'Optional gate (via OR option)';
    label.dataset.tooltip = 'These dependents reference this textline as one option in an OR group (OrRequirements). They do not strictly require it; any one option in their group satisfies the gate.';
    header.appendChild(label);

    const countSpan = document.createElement('span');
    countSpan.className = 'or-downstream-count';
    countSpan.textContent = `${count} textline${count === 1 ? '' : 's'}`;
    header.appendChild(countSpan);

    const childrenBox = document.createElement('div');
    childrenBox.className = 'or-downstream-children expanded';

    attachCollapseToggle(header, toggle, childrenBox);

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}


export function createOrBranchPlaceholder(index, total) {
    const box = document.createElement('div');
    box.className = 'or-branch-box or-branch-box-placeholder';

    const header = document.createElement('div');
    header.className = 'or-branch-box-header or-branch-box-header-placeholder';
    // Tooltip on the header so hovering anywhere across the row
    // surfaces the routing hint, not just the trailing note span.
    header.dataset.tooltip = 'This option is gated entirely on non-textline conditions (state paths, function checks, ...). Open the option requirement groups section in the details panel for the full content.';

    const label = document.createElement('span');
    label.className = 'or-branch-box-label';
    label.textContent = `Option ${index} of ${total}`;
    header.appendChild(label);

    const note = document.createElement('span');
    note.className = 'or-branch-placeholder-note';
    note.textContent = 'non-dialogue - see details';
    header.appendChild(note);

    box.appendChild(header);
    return box;
}

// Collapsible wrapper for the whole "any one of these alternatives"
// block. Mirrors ``createReqTypeGroup`` structure (header + children
// container with shared expand / collapse handler) so the same
// tooltip / scroll-into-view affordances apply.
export function createOrGroupBox(total, status = null) {
    const box = document.createElement('div');
    box.className = 'or-group-box';

    const header = document.createElement('div');
    header.className = 'or-group-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const statusBadge = makeGroupStatusBadge(status);
    if (statusBadge) header.appendChild(statusBadge);

    const label = document.createElement('span');
    label.className = 'or-group-label';
    label.textContent = `At least one of these ${total} branch${total === 1 ? '' : 'es'}`;
    label.dataset.tooltip = 'Option requirement groups (OrRequirements). Any ONE option passing satisfies the group; all are listed so the user can see what each path requires.';
    header.appendChild(label);

    const childrenBox = document.createElement('div');
    childrenBox.className = 'or-group-children expanded';

    attachCollapseToggle(header, toggle, childrenBox);

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}

// One alternative inside an OR group. ``count`` is the number of
// textline children inside this branch (the per-req-type grouping
// below shows them broken down by type).
export function createOrBranchBox(index, total, count, status = null) {
    const box = document.createElement('div');
    box.className = 'or-branch-box';

    const header = document.createElement('div');
    header.className = 'or-branch-box-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const statusBadge = makeGroupStatusBadge(status);
    if (statusBadge) header.appendChild(statusBadge);

    const label = document.createElement('span');
    label.className = 'or-branch-box-label';
    label.textContent = `Option ${index} of ${total}`;
    header.appendChild(label);

    const countSpan = document.createElement('span');
    countSpan.className = 'or-branch-box-count';
    countSpan.textContent = `${count} textline${count === 1 ? '' : 's'}`;
    header.appendChild(countSpan);

    const childrenBox = document.createElement('div');
    childrenBox.className = 'or-branch-box-children expanded';

    attachCollapseToggle(header, toggle, childrenBox);

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}

export function createReqTypeGroup(edgeType, count, requirementCount, direction = 'upstream', status = null, statusDetail = null) {
    const box = document.createElement('div');
    box.className = `req-type-group req-type-${edgeType}`;

    const header = document.createElement('div');
    header.className = 'req-type-group-header';

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    toggle.textContent = '\u25BC';
    header.appendChild(toggle);

    const statusBadge = makeGroupStatusBadge(status, statusDetail);
    if (statusBadge) header.appendChild(statusBadge);

    const edgeChip = document.createElement('span');
    edgeChip.className = `edge-type ${getEdgeClass(edgeType)}`;
    edgeChip.textContent = getEdgeLabel(edgeType);
    header.appendChild(edgeChip);

    const label = document.createElement('span');
    label.className = 'req-type-group-label';
    // Append the count threshold for count-based requirement fields
    // so the tree-view header matches the detail-view format
    // ``Must have played at least (ANY): 3``.
    const friendlyLabel = formatReqType(edgeType, direction);
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
    const titleText = reqTypeTitleText(edgeType, direction);
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

    attachCollapseToggle(header, toggle, childrenBox);

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}

// Walks the children list and chunks contiguous runs that share the same
// non-null GameData group + edge type into a single collapsible
// `.gamedata-group` box. Ungrouped children are appended as-is. Called
// from `appendChildrenWithTypeGrouping` after kids have already been
// chunked by requirement type. Passes per-kid ``orBranchIndex`` /
// ``orBranchTotal`` through to ``createNodeEl`` so the per-row "option
// N/M" badge renders on downstream OR-routed rows.
export function appendGroupedChildren(container, kids, direction, ancestorPath) {
    let i = 0;
    const grouped = new Set(); // track kids already placed in an alternates group
    while (i < kids.length) {
        const child = kids[i];

        // Check for alternates grouping: if this child has alternates
        // and some of those siblings are also in this kid list, group them
        if (!grouped.has(child.name) && alternates[child.name]) {
            const siblingSet = new Set(alternates[child.name]);
            // Collect all kids in this chunk that are alternates of each other
            const altGroup = [child];
            for (let k = 0; k < kids.length; k++) {
                if (k === i) continue;
                if (siblingSet.has(kids[k].name) && !grouped.has(kids[k].name)) {
                    altGroup.push(kids[k]);
                }
            }
            if (altGroup.length >= 2) {
                // Check if this group relates to the viewed dialogue
                const includesSelf = altGroup.some(a =>
                    ancestorPath.has(a.name) ||
                    (alternates[a.name] && alternates[a.name].some(s => ancestorPath.has(s)))
                );
                const box = createAlternatesGroup(altGroup.length, includesSelf);
                const groupChildren = box.querySelector('.alternates-group-children');
                for (const alt of altGroup) {
                    grouped.add(alt.name);
                    groupChildren.appendChild(
                        createNodeEl(alt.name, alt.edgeType, direction, ancestorPath, _edgeOptsFor(alt))
                    );
                }
                container.appendChild(box);
                i++;
                continue;
            }
        }

        if (grouped.has(child.name)) {
            i++;
            continue;
        }

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
                    createNodeEl(kids[k].name, kids[k].edgeType, direction, ancestorPath, _edgeOptsFor(kids[k]))
                );
            }
            container.appendChild(box);
            i = j;
        } else {
            container.appendChild(
                createNodeEl(child.name, child.edgeType, direction, ancestorPath, _edgeOptsFor(child))
            );
            i++;
        }
    }
}

function createAlternatesGroup(count, includesSelf) {
    const box = document.createElement('div');
    box.className = `alternates-group expanded${includesSelf ? ' alternates-self' : ' alternates-other'}`;
    const label = includesSelf ? 'Alternates (this dialogue)' : 'Alternates';
    box.innerHTML = `<div class="alternates-group-header" onclick="this.parentElement.classList.toggle('expanded')" data-tooltip="Mutually exclusive variants - only one can trigger; the others are permanently blocked once one plays.">` +
        `<span class="alternates-group-chevron">\u25B6</span>` +
        `<span class="alternates-group-label">${label}</span>` +
        `<span class="alternates-group-count">${count}</span>` +
        `</div>` +
        `<div class="alternates-group-children"></div>`;
    return box;
}

// Extract the ``createNodeEl`` ``edgeOpts`` argument from an annotated
// kid record. Only the OR-routing fields surface today; kept as a
// dedicated helper so future per-edge metadata (e.g. priority-based
// hints) can be threaded through the same channel without churning
// the call sites.
function _edgeOptsFor(kid) {
    const opts = {};
    if (kid.orBranchIndex) {
        opts.orBranchIndex = kid.orBranchIndex;
        opts.orBranchTotal = kid.orBranchTotal;
    }
    // The group's Count threshold lets a per-row run-count tooltip explain
    // the gate ("played 2 runs ago, needs at least 8 since").
    if (kid._count != null) opts.count = kid._count;
    return Object.keys(opts).length > 0 ? opts : null;
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

    attachCollapseToggle(header, toggle, childrenBox);

    box.appendChild(header);
    box.appendChild(childrenBox);
    return box;
}
