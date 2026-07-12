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
    reqTypeTitleText,
    unresolvedCategoryFor,
    renderPrimaryPriorityBadgeHtml,
    saveStatusTooltip,
} from './utilities.js';
import { renderInfo } from './info-panel.js';
import { appendChildrenWithTypeGrouping } from './tree-renderers.js';
import { navigateTo, navigateToSpeaker } from './navigation.js';
import { getDialogueStatus, getSaveProgress, getSaveContext, saveMatchesActiveGame } from './save-parser.js';
import { RUNS_SINCE_REQ_TYPES, runsSinceRefTooltip, runsSinceExplain, scopedGateExplain } from './requirements.js';

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
                        orBranchIndex: null,
                        orBranchTotal: null,
                    });
                }
            }
            // H2 alternative requirement groups (``OrRequirements``).
            // Each branch contributes its own textline-typed children
            // tagged with the 1-based branch index + total. The tree
            // renderer partitions kids on these tags so OR-tagged
            // children render under a dedicated Alternative wrapper,
            // separated from the AND base block above.
            const orBranches = Array.isArray(tl.orBranches) ? tl.orBranches : [];
            const total = orBranches.length;
            for (let bi = 0; bi < total; bi++) {
                const branchReqs = (orBranches[bi] && orBranches[bi].requirements) || {};
                for (const [type, refs] of Object.entries(branchReqs)) {
                    for (let i = 0; i < refs.length; i++) {
                        if (refs[i] === name) continue;
                        children.push({
                            name: refs[i],
                            edgeType: type,
                            group: null,
                            orBranchIndex: bi + 1,
                            orBranchTotal: total,
                        });
                    }
                }
            }
        }
    } else {
        for (const dep of (dependents[name] || [])) {
            // Self-edges are already filtered out of the dependents
            // index by graph.py, but guard defensively in case the
            // upstream data ever changes.
            if (dep.name === name) continue;
            // OR-branch tagging on dep edges (``orBranchIndex`` /
            // ``orBranchTotal``) is preserved so the tree renderer
            // can route the dependent under a dedicated "Optional
            // gate (via OR option)" section -- mixing OR-routed
            // dependents in with strict AND-dependents would falsely
            // imply the dependent requires this textline, when in
            // truth the dependent's OR group is satisfied by any one
            // option (this textline being one of them).
            children.push({
                name: dep.name,
                edgeType: dep.type,
                group: null,
                orBranchIndex: dep.orBranchIndex || null,
                orBranchTotal: dep.orBranchTotal || null,
            });
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
        const baseHas = Object.values(tl.requirements).some(
            r => r.some(ref => ref !== name)
        );
        if (baseHas) return true;
        // Any OrRequirements branches at all count as expandable - even
        // branches without textline-typed children render as
        // placeholder rows in the OR group, so users can see the
        // alternative count and the pointer to the details panel.
        const orBranches = Array.isArray(tl.orBranches) ? tl.orBranches : [];
        return orBranches.length > 0;
    }
    return (dependents[name] || []).some(d => d.name !== name);
}

// Bring a newly-expanded row into a useful scroll position. After a DOM
// mutation reveals new tree rows (clicking a `.tree-label` toggle, expanding a
// `.req-type-group` / `.gamedata-group` / OR-group header), horizontally scroll
// the enclosing `.panel-body` so the EXPANDED row's own left edge sits at the
// column's left content edge (where top-level rows naturally begin, i.e. just
// inside the panel-body's left padding).
//
// This keeps the clicked row and the start of its (more-indented) children in
// view from the left, instead of the old behaviour of jumping to
// `panelBody.scrollWidth` - the far right - which showed only the single
// deepest new descendant and scrolled the clicked row off the left entirely.
//
// ``rowEl`` is the clicked row/header element (not its children box): its
// horizontal position is fixed by its nesting depth and is unaffected by the
// children appended below it, so the target is stable. We measure inside a
// ``requestAnimationFrame`` so the just-mutated layout is settled first.
export function ensureExpandedContentVisible(rowEl) {
    if (!rowEl) return;
    const panelBody = rowEl.closest('.panel-body');
    if (!panelBody) return;
    requestAnimationFrame(() => {
        const rowLeft = rowEl.getBoundingClientRect().left - panelBody.getBoundingClientRect().left;
        // The row's left edge in the panel's scroll coordinate space, aligned to
        // the content start (left padding) so it isn't flush against the border.
        const padLeft = parseFloat(getComputedStyle(panelBody).paddingLeft) || 0;
        const target = Math.max(0, panelBody.scrollLeft + rowLeft - padLeft);
        panelBody.scrollTo({ left: target, behavior: 'smooth' });
    });
}

// Whether the stacked mobile layout is active (<= 1024px, the responsive.css
// tablet breakpoint). Used to give tree rows touch-tuned tap behaviour: the
// owner tag doesn't navigate on tap, single-tap only expands (never selects
// into the details panel), and a quick second tap re-roots.
function treeIsMobileLayout() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 1024px)').matches;
}

// Custom double-tap detection for the mobile tree. Desktop re-roots the tree on
// ``dblclick``; on touch that is unreliable (double-tap is a zoom gesture and
// often fires no ``dblclick``), so on mobile we detect two quick taps on the
// same row here instead. ``touch-action: manipulation`` on ``.tree-label`` (see
// tree.css) disables the double-tap-zoom so both taps arrive promptly as
// clicks. Returns true when the tap completed a double-tap (and re-rooted), so
// the caller skips its single-tap action.
const DOUBLE_TAP_MS = 300;
let lastTapName = null;
let lastTapTime = 0;
function handleMobileDoubleTap(name) {
    const now = Date.now();
    if (lastTapName === name && now - lastTapTime < DOUBLE_TAP_MS) {
        lastTapName = null;
        lastTapTime = 0;
        cancelMobileScroll();
        navigateTo(name);
        return true;
    }
    lastTapName = name;
    lastTapTime = now;
    return false;
}

// The mobile expand auto-scroll is deferred (see ``scrollExpandedIntoView``) so
// it can't slide a row sideways between the two taps of a double-tap; a
// completed double-tap cancels any pending scroll before re-rooting.
let mobileScrollTimer = null;
function cancelMobileScroll() {
    if (mobileScrollTimer !== null) {
        clearTimeout(mobileScrollTimer);
        mobileScrollTimer = null;
    }
}

// Bring a freshly expanded row's indented content into view. Desktop scrolls
// immediately; mobile DEFERS it past the double-tap window. A first tap that
// expands a row must not horizontally auto-scroll it mid-gesture - that moves
// the row on screen, so the second tap of a double-tap lands elsewhere and the
// "two taps on the same row" re-root gesture silently fails. Expanding only
// inserts children *below* the row (the row itself doesn't move vertically), so
// deferring this horizontal scroll keeps the row stationary while the second
// tap can land; on a genuine single tap the scroll still runs a beat later.
function scrollExpandedIntoView(rowEl) {
    if (!treeIsMobileLayout()) {
        ensureExpandedContentVisible(rowEl);
        return;
    }
    cancelMobileScroll();
    mobileScrollTimer = setTimeout(() => {
        mobileScrollTimer = null;
        ensureExpandedContentVisible(rowEl);
    }, DOUBLE_TAP_MS + 40);
}

export function createNodeEl(name, edgeType, direction, ancestorPath, edgeOpts) {
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
    // Keyboard accessibility: each row is a focusable ARIA tree item. The
    // delegated handler in tree-keyboard.js reads ``data-name`` to select it
    // and toggles ``aria-expanded`` via the chevron. (The interleaved group
    // headers are separate inline-onclick elements already made operable by
    // keyboard-a11y.js.)
    label.tabIndex = 0;
    label.setAttribute('role', 'treeitem');
    label.dataset.name = name;
    if (expandable) label.setAttribute('aria-expanded', 'false');

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    // Expandable rows show a chevron; leaf rows render nothing. The
    // span's ``min-width`` (see styles/tree.css) still reserves the
    // toggle column so leaf labels line up with expandable siblings.
    toggle.textContent = expandable ? '\u25B6' : '';
    label.appendChild(toggle);

    if (edgeType) {
        const edge = document.createElement('span');
        edge.className = `edge-type ${getEdgeClass(edgeType)}`;
        edge.textContent = getEdgeLabel(edgeType);
        // Per-row edge chips collapse the field semantics into a
        // short label (e.g. ``ANY LR`` for ``RequiredAnyTextLinesLastRun``).
        // Surface the full internal name + plain-English blurb on
        // hover so the chip is self-disambiguating on the most
        // prominent shorthand surface in the viewer.
        // Skipped for unmapped types so the chip stays plain.
        const titleText = reqTypeTitleText(edgeType, direction);
        if (titleText !== null) {
            edge.dataset.tooltip = titleText;
        }
        label.appendChild(edge);
    }

    // Save progress badge (coloured dot before the name)
    if (tl && getSaveProgress() && saveMatchesActiveGame()) {
        let status = getDialogueStatus(name, tl);
        if (status) {
            let tip = saveStatusTooltip(status);
            // Make the dot edge-aware (upstream only): a line can be played in
            // the save yet still NOT satisfy the specific run-count or
            // run-scoped requirement it sits under, in which case a plain green
            // "played" dot is misleading. Flag those as a near-miss and explain.
            if (direction === 'upstream' && RUNS_SINCE_REQ_TYPES.has(edgeType)) {
                const cnt = (edgeOpts && edgeOpts.count != null) ? edgeOpts.count : 1;
                const ctx = getSaveContext();
                const extra = runsSinceRefTooltip(edgeType, name, ctx, cnt);
                if (extra) tip = `${tip}\n${extra}`;
                const ex = runsSinceExplain(edgeType, [name], ctx, cnt);
                if (status === 'played' && ex && ex.refs[0] && !ex.refs[0].ok) status = 'near-miss';
            } else if (direction === 'upstream') {
                // Run-scoped positive gate (this-run / this-room / last-run /
                // queued): a ref played in the save but not in the gate's scope
                // is a near-miss - it has played, just not where this gate needs.
                // A queued ref that is play-once and already played is instead a
                // permanent block: it can never be queued to play next again.
                const ex = scopedGateExplain(edgeType, [name], getSaveContext());
                const blocker = ex && ex.blockers[0];
                if (blocker && blocker.permanent) {
                    status = 'unobtainable';
                    tip = blocker.tooltip;
                } else if (blocker && blocker.playedInSave) {
                    status = 'near-miss';
                    tip = blocker.tooltip;
                }
            }
            const badge = document.createElement('span');
            badge.className = `save-badge ${status}`;
            badge.dataset.tooltip = tip;
            label.appendChild(badge);
        }
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = name;
    label.appendChild(nameSpan);

    // Secondary metadata (status / blocked / skip badges, cycle marker,
    // OR-routed badge, narrative-priority badge, owner tag) is wrapped so mobile
    // can drop it onto its own second row beneath the name - the name is the
    // important part and should get the full first row. On desktop the wrapper
    // is ``display: contents`` (tree.css), so these elements stay inline in the
    // flex row exactly as before: no desktop layout change.
    const meta = document.createElement('span');
    meta.className = 'tree-label-meta';

    if (!tl) {
        const cat = unresolvedCategoryFor(name);
        const warn = document.createElement('span');
        warn.className = `tree-unresolved-badge unresolved-cat-${cat || 'uncategorized'}`;
        const known = knownUnresolved[name];
        if (known) {
            const lbl = unresolvedCategoryLabels[cat] || cat;
            warn.textContent = lbl;
            warn.dataset.tooltip = known.reason;
        } else {
            warn.textContent = '\u26A0 not in game';
            warn.dataset.tooltip = 'Not found in the parsed game data.';
        }
        meta.appendChild(warn);
        const blocks = unresolvedRefBlocks[name] || [];
        if (blocks.length > 0) {
            const blockedBadge = document.createElement('span');
            blockedBadge.className = 'tree-blocked-badge';
            blockedBadge.textContent = `\u26D4 blocks ${blocks.length}`;
            blockedBadge.dataset.tooltip = `Blocks ${blocks.length} dialogue${blocks.length === 1 ? '' : 's'} from ever playing: ${blocks.join(', ')}`;
            meta.appendChild(blockedBadge);
        }
    } else if (tl.skip) {
        const skipBadge = document.createElement('span');
        skipBadge.className = 'tree-skip-badge';
        const icon = document.createElement('span');
        icon.className = 'status-symbol';
        icon.textContent = '\u2298';
        skipBadge.append(icon, 'retired');
        skipBadge.dataset.tooltip = tl.skipReplacement
            ? `Retired line (flagged Skip) - can never play. Superseded by ${tl.skipReplacement}.`
            : 'Retired line (flagged Skip) - can never play.';
        meta.appendChild(skipBadge);
    } else if (tl.blocked) {
        const blockedBadge = document.createElement('span');
        blockedBadge.className = 'tree-blocked-badge';
        blockedBadge.textContent = '\u26D4 blocked';
        const reasonText = (tl.blockingReasons || [])
            .map(r => `${r.field}: missing ${r.missingRefs.join(', ')}`)
            .join(' \u00B7 ');
        blockedBadge.dataset.tooltip = reasonText
            ? `This dialogue can never play. ${reasonText}`
            : 'This dialogue can never play.';
        meta.appendChild(blockedBadge);
    }

    if (isCycle) {
        const cycleSpan = document.createElement('span');
        cycleSpan.className = 'cycle-marker';
        cycleSpan.textContent = ' \u21A9 cycle';
        meta.appendChild(cycleSpan);
    }

    // OR-routed dep badge (downstream only). Indicates this row
    // satisfies the dependent's OR group via a specific option, so
    // the dependent does NOT strictly require this textline -- any
    // one option in its group satisfies the gate. The badge is the
    // only place the option index/total surfaces in the tree; the
    // containing ".or-downstream-section" wrapper carries the
    // higher-level "this section is OR-routed" framing.
    if (edgeOpts && edgeOpts.orBranchIndex && edgeOpts.orBranchTotal) {
        const orAlt = document.createElement('span');
        orAlt.className = 'or-alt-badge';
        orAlt.textContent = `option ${edgeOpts.orBranchIndex}/${edgeOpts.orBranchTotal}`;
        orAlt.dataset.tooltip = `Routed via option ${edgeOpts.orBranchIndex} of ${edgeOpts.orBranchTotal} in this dependent's OR group. The dependent does not strictly need this textline; any one option in its OR group satisfies the gate.`;
        meta.appendChild(orAlt);
    }

    // Narrative-priority badge. Tree view shows a single compact
    // badge (H1 tier or H2 ordinal) to keep rows uncluttered; the
    // set-level (SP/P) pill and PlayOnce indicator are reserved for
    // the details panel. Placed inside the right-aligned cluster of
    // the row so badges line up across rows regardless of name length.
    // Only relevant for resolved textlines (`tl != null`).
    if (tl) {
        const tierHtml = renderPrimaryPriorityBadgeHtml(tl);
        if (tierHtml) {
            const wrapper = document.createElement('span');
            wrapper.innerHTML = tierHtml;
            while (wrapper.firstChild) {
                meta.appendChild(wrapper.firstChild);
            }
        }
    }

    const npcSpan = document.createElement('span');
    npcSpan.className = 'npc-tag clickable';
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
            npcSpan.dataset.tooltip = titleParts.join('\n');
        } else if (description) {
            npcSpan.dataset.tooltip = description;
        }
        // Click the owner tag to jump to the speaker overview.
        // ``stopPropagation`` keeps the parent row's click handler
        // (which selects or expands the textline) from firing for
        // the same gesture.
        //
        // Disabled on the stacked mobile layout (<= 1024px, see
        // responsive.css): the tag is a tiny tap target crowded against the
        // row, so navigating on tap causes frequent misinputs. There we let the
        // tap fall through to the row (toggle / select) instead of yanking the
        // user to the speaker view.
        npcSpan.addEventListener('click', (e) => {
            if (treeIsMobileLayout()) return;
            e.stopPropagation();
            navigateToSpeaker(tl.owner);
        });
    }
    meta.appendChild(npcSpan);

    label.appendChild(meta);

    node.appendChild(label);

    // Click handlers: the toggle chevron is a pure expand / collapse
    // toggle (no selection change), so the user can fold a branch
    // back up without re-rooting the details panel. Clicking the row
    // body anywhere else both selects the textline in the details
    // panel AND ensures its children are expanded -- exploring deeper
    // is the natural follow-up to "show me this dialogue". The body
    // click is expand-only (never collapses) so a re-click on an
    // already-open row doesn't surprise-fold it; collapsing is the
    // chevron's job. Double-clicking the row (anywhere, including the
    // toggle) re-roots the panels.
    if (expandable) {
        // Idempotent expand: builds the children container the first
        // time, then marks it expanded if it isn't already. Returns
        // the children container so callers can scroll it into view.
        const expandNode = () => {
            let childContainer = label.nextElementSibling;
            if (childContainer && childContainer.classList.contains('tree-children')) {
                if (!childContainer.classList.contains('expanded')) {
                    childContainer.classList.add('expanded');
                    toggle.textContent = '\u25BC';
                    label.setAttribute('aria-expanded', 'true');
                    scrollExpandedIntoView(label);
                }
                return childContainer;
            }
            childContainer = document.createElement('div');
            childContainer.className = 'tree-children expanded';
            const newPath = new Set(ancestorPath);
            newPath.add(name);
            const kids = getChildren(name, direction);
            appendChildrenWithTypeGrouping(childContainer, kids, direction, newPath, name);
            node.appendChild(childContainer);
            toggle.textContent = '\u25BC';
            label.setAttribute('aria-expanded', 'true');
            scrollExpandedIntoView(label);
            return childContainer;
        };

        // Expand if collapsed, collapse if expanded - shared by the chevron
        // and the row body so both toggle the same way.
        const toggleNode = () => {
            const childContainer = label.nextElementSibling;
            if (childContainer
                && childContainer.classList.contains('tree-children')
                && childContainer.classList.contains('expanded')) {
                childContainer.classList.remove('expanded');
                toggle.textContent = '\u25B6';
                label.setAttribute('aria-expanded', 'false');
                return;
            }
            expandNode();
        };

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNode();
        });

        label.addEventListener('click', (e) => {
            // Skip clicks inside the toggle chevron (its own handler runs and
            // stops propagation; this guards against future child elements).
            if (e.target.closest('.toggle')) return;
            if (treeIsMobileLayout()) {
                // Mobile: a single tap only expands / collapses (rows are
                // usually tapped just to explore the tree, so it must NOT select
                // the row into the details panel). A quick second tap on the
                // same row re-roots it (makes it the main dialogue, which also
                // shows its details) - the touch replacement for dblclick.
                if (handleMobileDoubleTap(name)) return;
                toggleNode();
                return;
            }
            // Desktop: the whole row body toggles expand / collapse; clicking
            // the dialogue name additionally loads it into the detail panel, so
            // browsing by toggling the empty space doesn't swap the panel.
            // ``tour-no-nav`` (set during a tour step) suppresses only the
            // panel swap, leaving expand / collapse working.
            if (e.target.closest('.name') && !document.body.classList.contains('tour-no-nav')) renderInfo(name);
            toggleNode();
        });
    } else {
        label.addEventListener('click', () => {
            if (document.body.classList.contains('tour-no-nav')) return;
            if (treeIsMobileLayout()) {
                // Mobile: a leaf can't expand, so a single tap does nothing
                // (no details select); a quick second tap re-roots it.
                handleMobileDoubleTap(name);
                return;
            }
            renderInfo(name);
        });
    }

    // Desktop re-roots on double-click; on mobile the same is handled by the
    // two-quick-taps detection in the click handlers above (dblclick is
    // unreliable on touch), so guard this to true-desktop to avoid firing twice.
    label.addEventListener('dblclick', () => { if (!treeIsMobileLayout()) navigateTo(name); });

    return node;
}
