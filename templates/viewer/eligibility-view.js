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

import { textlines, speakers, alternates } from './data.js';
import { escapeHtml, jsAttr, renderSpeakerHtml, getEdgeLabel, getEdgeClass, renderSaveBadgeHtml, renderPrimaryPriorityBadgeHtml, formatReqType } from './utilities.js';
import { getSaveProgress, getSaveContext, saveMatchesActiveGame, isDialoguePlayed } from './save-parser.js';
import { AND_REQ_TYPES, OR_REQ_TYPES, COUNT_MIN_REQ_TYPES, RUNS_SINCE_REQ_TYPES, REQ_TYPE_SCOPE, requiredCount, directSatisfaction, runsSinceExplain, scopedGateExplain } from './requirements.js';
import { isUnobtainable, unobtainableReasons } from './unobtainable.js';
import { renderOtherRequirementsSectionHtml } from './info-panel.js';

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
            // The flat chain is the global textline-dependency graph. Run-
            // scoped fields (this-run / this-room / queued) are situational,
            // resolved against their own records for the root/branch verdict,
            // and would only pollute the "still needed" progression here, so
            // walk only the global-scope fields (negatives + run-count were
            // already skipped because they aren't AND/OR/count prerequisites).
            if (REQ_TYPE_SCOPE[reqType] !== 'played') continue;
            const options = refs.filter(ref => ref !== name);

            if (AND_REQ_TYPES.has(reqType)) {
                // ALL refs are needed: each is an individual prerequisite.
                // A ref that's already played is satisfied, so it is recorded
                // (and shown ticked in the tree) but NOT walked - its own
                // prerequisites are no longer needed, and walking them would
                // pollute the "still needed" list and the summary count with
                // deep prereqs of already-satisfied lines.
                for (const ref of options) {
                    addToChain(ref, name, reqType, null, depth);
                    if (!isPlayed(ref)) walk(ref, depth + 1);
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

// Pick a dialogue that is currently blocked with unplayed prerequisites for the
// loaded save, so the tracer renders its full set of sections (used by the
// onboarding tour when the dialogue the user opened happens to be already
// eligible / played and would otherwise show none). Prefers a moderate chain so
// the example reads clearly; returns null when nothing qualifies (e.g. a fully
// completed save).
export function findEligibilityExample() {
    const runsAgo = getSaveContext().runsAgo;
    let fallback = null;
    for (const [name, tl] of Object.entries(textlines)) {
        const req = tl && tl.requirements;
        if (!req || !Array.isArray(req.RequiredTextLines) || req.RequiredTextLines.length === 0) continue;
        if (isDialoguePlayed(name) === true) continue;
        if (isUnobtainable(name, getSaveProgress(), runsAgo)) continue;
        const { chain, mandatory } = buildPrereqChain(name);
        let unplayed = 0;
        for (const [n, info] of chain) {
            if (n !== name && mandatory.has(n) && !info.played) unplayed++;
        }
        if (unplayed >= 3 && unplayed <= 12) return name; // a clear, moderate example
        if (unplayed >= 1 && !fallback) fallback = name;
    }
    return fallback;
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
//
// ``completed`` lists the names of the already-played prerequisites that
// the ``played`` count credits (capped per group at its quota, so
// ``completed.length === played``); the summary uses it for a tooltip
// spelling out which requirements are already done.
//
// ``directCount`` is the number of *immediate* requirements (depth-1
// individuals + depth-1 groups), and ``hasIndirect`` is true when the
// total also includes deeper prerequisites (a prerequisite's own
// prerequisites). The summary uses these to explain why the total can
// exceed the number of requirements listed directly on the dialogue.
export function summarizePrereqs(chain, groups, mandatory, rootName, isPlayed = (n) => isDialoguePlayed(n) === true) {
    const activeGroups = [...groups.values()].filter(g => isActiveGroup(g, mandatory, rootName));
    const memberNames = new Set();
    for (const g of activeGroups) {
        for (const o of g.options) memberNames.add(o);
    }
    let total = 0;
    let played = 0;
    let directCount = 0;
    let hasIndirect = false;
    const completed = [];
    for (const [name, info] of chain) {
        if (!mandatory.has(name) || memberNames.has(name)) continue;
        total += 1;
        if (info.depth <= 1) directCount += 1; else hasIndirect = true;
        if (info.played) {
            played += 1;
            completed.push(name);
        }
    }
    for (const g of activeGroups) {
        total += g.quota;
        if (g.depth <= 1) directCount += 1; else hasIndirect = true;
        const playedOpts = g.options.filter(o => isPlayed(o));
        played += Math.min(playedOpts.length, g.quota);
        for (const o of playedOpts.slice(0, g.quota)) completed.push(o);
    }
    return { total, played, stillNeeded: total - played, completed, directCount, hasIndirect, hasGroups: activeGroups.length > 0 };
}

// Render the specific locks behind an "unobtainable" verdict - negative gates
// whose line has played, count-max gates that have overflowed, play-once
// run-count gates now out of range, and choices the player took differently -
// each linking to the dialogue involved.
function renderUnobtainableReasonsHtml(rootName, playedSet, runsAgo) {
    const reasons = unobtainableReasons(rootName, playedSet, runsAgo);
    if (reasons.length === 0) return '';
    const ref = (name) => `<a class="eligibility-ref" onclick="navigateTo(${jsAttr(name)})">${escapeHtml(name)}</a>`;
    const runs = (n) => `${n} run${n === 1 ? '' : 's'}`;
    let html = `<ul class="eligibility-unobtainable-reasons">`;
    for (const r of reasons) {
        if (r.kind === 'choice') {
            html += `<li>Needs the "<strong>${escapeHtml(r.requiredChoice)}</strong>" choice in ${ref(r.parent)}`
                + ` \u2014 you chose "${escapeHtml(r.taken.join('" / "'))}".</li>`;
        } else if (r.kind === 'negative') {
            html += `<li>${ref(r.blocker)} has already played, but this requires it <strong>not</strong> to have.</li>`;
        } else if (r.kind === 'maxany') {
            html += `<li>Too many of a limited group have already played (at most <strong>${r.count}</strong> allowed): `
                + `${r.blockers.map(ref).join(', ')}.</li>`;
        } else if (r.kind === 'runcount') {
            const when = r.ago === null ? 'longer ago than the tracked run history' : `${runs(r.ago)} ago`;
            html += `<li>${ref(r.blocker)} can only play once and played ${when}, so this dialogue\u2019s `
                + `\u201Cwithin ${runs(r.count)}\u201D gate can never be met again.</li>`;
        }
    }
    html += `</ul>`;
    return html;
}

function renderSummaryHtml(rootName, chain, groups, mandatory) {
    const { total, played, stillNeeded, completed, hasIndirect, hasGroups } =
        summarizePrereqs(chain, groups, mandatory, rootName);
    const rootPlayed = isDialoguePlayed(rootName) === true;
    const rootTl = textlines[rootName];
    const playedSet = getSaveProgress() || new Set();
    // Evaluation context: the global played set plus the run-scoped records.
    const saveCtx = { ...getSaveContext(), played: playedSet };
    // The tracer walks only the global textline prerequisites (the AND/OR/
    // count chain); an H2 dialogue can also be gated by set-level
    // ``orBranches`` the chain doesn't enumerate, plus run-scoped fields, so
    // confirm direct eligibility against the same shared check the save badge
    // uses. 'unknown' means every resolvable requirement holds but the
    // dialogue also gates on last-run or run-count state a save can't resolve.
    const rootSat = rootPlayed ? null : directSatisfaction(rootTl, saveCtx, rootName);
    const directlyEligible = rootSat === 'met';
    const indeterminate = rootSat === 'unknown';

    // The total isn't a simple node count of the tree below: it spans the
    // whole chain (so it can exceed the requirements listed directly on the
    // dialogue), but a "play any of" group counts once and already-satisfied
    // branches drop off (so it can also be smaller than the tree). Explain
    // that whenever either of those applies, to pre-empt both "why so many?"
    // and "why so few?" confusion.
    let chainNote = '';
    if (hasIndirect || hasGroups) {
        const parts = ['Counts prerequisites across the whole chain'];
        if (hasIndirect) parts.push('including indirect ones (a prerequisite\u2019s own prerequisites)');
        if (hasGroups) parts.push('with each \u201Cplay any of\u201D group counted once');
        const visible = parts.join(', ') + ' - so it may differ from the tree below.';
        const tip = 'Indirect prerequisites (prerequisites of prerequisites) are included, so the total '
            + 'can exceed the requirements listed directly on this dialogue. A \u201Cplay any N of these\u201D '
            + 'group counts as the N you must play - not its number of options - and branches you have '
            + 'already satisfied drop off, so the total can be smaller than the number of rows in the '
            + 'prerequisite tree below.';
        chainNote = `<div class="eligibility-chain-note" data-tooltip="${escapeHtml(tip)}">${escapeHtml(visible)}</div>`;
    }

    let html = `<div class="eligibility-summary">`;

    if (rootPlayed) {
        html += `<div class="eligibility-status eligibility-played">\u2714 Already played</div>`;
        html += `<div class="eligibility-detail">${escapeHtml(rootName)} is already in this save's TextLinesRecord.</div>`;
    } else if (directlyEligible) {
        html += `<div class="eligibility-status eligibility-eligible">\u25CB Eligible to play</div>`;
        html += `<div class="eligibility-detail">All ${total} prerequisite${total === 1 ? '' : 's'} have been played. This dialogue should be eligible.</div>`;
        html += chainNote;
    } else if (isUnobtainable(rootName, playedSet, saveCtx.runsAgo)) {
        html += `<div class="eligibility-status eligibility-unobtainable">\u2298 Unobtainable</div>`;
        html += `<div class="eligibility-detail">This dialogue can no longer become eligible in this save:</div>`;
        html += renderUnobtainableReasonsHtml(rootName, playedSet, saveCtx.runsAgo);
    } else if (indeterminate) {
        html += `<div class="eligibility-status eligibility-indeterminate">? Indeterminate</div>`;
        html += `<div class="eligibility-detail">Eligibility can\u2019t be determined from this save: this dialogue gates on a run-scoped record the save doesn\u2019t include (the Hades II textline queue, or a current-run record when no run is active). Its resolvable prerequisites are satisfied.</div>`;
        html += chainNote;
    } else if (total === 0) {
        // Blocked, but gated entirely by alternative branches (no flat chain).
        html += `<div class="eligibility-status eligibility-blocked">\u2022 Blocked</div>`;
        html += `<div class="eligibility-detail">Blocked - satisfy one of the alternative requirement branches below.</div>`;
    } else {
        html += `<div class="eligibility-status eligibility-blocked">\u2022 Blocked</div>`;
        html += `<div class="eligibility-detail">${stillNeeded} of ${total} prerequisite${total === 1 ? '' : 's'} still needed.</div>`;
        html += `<div class="eligibility-progress-bar"><div class="eligibility-progress-fill" style="width:${total > 0 ? (played / total * 100) : 0}%"></div></div>`;
        const completeTip = completed.length
            ? 'Already complete:\n' + completed.join('\n')
            : '';
        const tipAttr = completeTip ? ` data-tooltip="${escapeHtml(completeTip)}"` : '';
        html += `<div class="eligibility-progress-label"${tipAttr}>${played}/${total} complete</div>`;
        html += chainNote;
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

// Surface the root dialogue's currently-blocking *situational* gates - the
// conditions the prerequisite chain deliberately omits because they depend on
// run / room / queue / timing state rather than on playing a prerequisite
// line ever. Covers:
//   - run-count gates (Min/MaxRunsSinceAnyTextLines): "how long since X last
//     played"; and
//   - run-scoped gates (*ThisRun / *ThisRoom / *LastRun / *Queued): "X (not)
//     played this run / room / last run / queue".
// Lists only gates that are currently unmet *and recoverable*: a permanent
// play-once run-count lock is reported as an unobtainable reason instead, and
// the caller skips this section entirely for played / unobtainable dialogues.
// A gate whose record the save doesn't carry stays indeterminate and is not
// listed. ``ctx`` is the save context (defaults to the live one). Returns ''
// when nothing applies.
export function renderBlockingGatesHtml(rootName, ctx = getSaveContext()) {
    const tl = textlines[rootName];
    if (!tl || !tl.requirements) return '';
    const gates = [];
    for (const [reqType, refs] of Object.entries(tl.requirements)) {
        if (!Array.isArray(refs)) continue;
        if (RUNS_SINCE_REQ_TYPES.has(reqType)) {
            const ex = runsSinceExplain(reqType, refs, ctx, requiredCount(tl, reqType), rootName);
            if (!ex || ex.status !== 'unmet' || ex.permanent) continue;
            gates.push({ reqType, count: ex.count, scopeLabel: null, blockers: ex.refs.filter(r => !r.ok).map(r => ({ name: r.name, reason: r.reason })) });
        } else {
            const ex = scopedGateExplain(reqType, refs, ctx, rootName);
            if (!ex || ex.status !== 'unmet') continue;
            gates.push({ reqType, count: null, scopeLabel: ex.scopeLabel, blockers: ex.blockers });
        }
    }
    if (gates.length === 0) return '';

    let html = `<div class="eligibility-tree">`;
    html += `<h4 class="eligibility-tree-header">Situational gates (${gates.length})</h4>`;
    html += `<div class="eligibility-tree-hint">These block on current-run, recent-run, or timing state rather than a missing prerequisite - they change as you play.</div>`;
    html += `<div class="eligibility-list">`;
    for (const { reqType, count, scopeLabel, blockers } of gates) {
        const label = count != null ? `${formatReqType(reqType, 'upstream')}: ${count}` : formatReqType(reqType, 'upstream');
        // When some options have played in the save but not in this scope,
        // call it out at the gate level so the highlighting is self-explaining.
        const hasNearMiss = blockers.some(b => b.playedInSave);
        const headTipAttr = (hasNearMiss && scopeLabel)
            ? ` data-tooltip="${escapeHtml(`Highlighted options have played in your save but not in ${scopeLabel}, so they don\u2019t count - this gate needs one played in ${scopeLabel}.`)}"`
            : '';
        html += `<div class="eligibility-gate">`;
        html += `<div class="eligibility-gate-head"${headTipAttr}><span class="group-status group-status-unmet"></span>${escapeHtml(label)}</div>`;
        html += `<ul class="eligibility-gate-refs">`;
        for (const b of blockers) {
            const link = `<a class="eligibility-ref" onclick="navigateTo(${jsAttr(b.name)})">${escapeHtml(b.name)}</a>`;
            html += b.playedInSave
                ? `<li>${link} <span class="gate-ref-elsewhere" data-tooltip="${escapeHtml(b.tooltip)}">- ${escapeHtml(b.reason)}</span></li>`
                : `<li>${link} - ${escapeHtml(b.reason)}</li>`;
        }
        html += `</ul></div>`;
    }
    html += `</div></div>`;
    return html;
}

// Surface the target's non-textline requirements - the static game-state /
// run-modifier / unlock conditions stored in ``otherRequirements`` that
// aren't references to other dialogues (e.g. "all weapons unlocked",
// "cleared the last run"). They never appear in the prerequisite chain or
// tree, so the tracer would otherwise hide them. Reuses the info panel's
// renderer (compact mode) wrapped in the tracer's section frame. Keys that
// are also textline-requirement types are skipped: those are already
// represented by the chain and the situational gates above. Informational
// only - most gate on live GameState a save doesn't carry, so the tracer
// shows the dialogue's declared conditions rather than evaluating them.
export function renderOtherConditionsHtml(rootName) {
    const tl = textlines[rootName];
    if (!tl) return '';
    const reqs = tl.requirements || {};
    const other = tl.otherRequirements || {};
    const count = Object.keys(other).filter((k) => !(k in reqs)).length;
    if (count === 0) return '';
    const inner = renderOtherRequirementsSectionHtml(reqs, other, { textlineName: rootName });
    if (!inner) return '';
    let html = `<div class="eligibility-tree">`;
    html += `<h4 class="eligibility-tree-header">Other requirements (${count})</h4>`;
    html += `<div class="eligibility-tree-hint">Non-textline conditions (game state, unlocks, run modifiers) this dialogue also gates on. They're read from its definition - the tracer can't check them against your save.</div>`;
    html += `<div class="eligibility-list eligibility-other-reqs">${inner}</div>`;
    html += `</div>`;
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
        ? neededBy.map(n => `<a class="eligibility-ref" onclick="event.stopPropagation();navigateTo(${jsAttr(n)})">${escapeHtml(n)}</a>`).join(', ')
        : '';

    const edgeLabels = [...new Set(info.parents.map(p => p.reqType))];
    const edgeBadges = edgeLabels
        .map(t => `<span class="edge-type ${getEdgeClass(t)}">${getEdgeLabel(t)}</span>`)
        .join(' ');

    let html = `<div class="eligibility-item" onclick="navigateTo(${jsAttr(name)})">`;
    html += `<div class="eligibility-item-main">`;
    html += `<span class="eligibility-depth" data-tooltip="The prerequisite dialogue is ${info.depth} step${info.depth === 1 ? '' : 's'} back from this dialogue. Play higher levels first.">Lvl ${info.depth}</span>`;
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
    html += `<span class="eligibility-depth" data-tooltip="The prerequisite dialogue is ${group.depth} step${group.depth === 1 ? '' : 's'} back from this dialogue. Play higher levels first.">Lvl ${group.depth}</span>`;
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

// Build the children map a tree render walks: for each node, which chain
// entries list it as a parent (carrying the group id so alternatives can be
// grouped).
function buildChildrenOf(chain) {
    const childrenOf = new Map();
    for (const [name, info] of chain) {
        for (const p of info.parents) {
            if (!childrenOf.has(p.name)) childrenOf.set(p.name, []);
            childrenOf.get(p.name).push({ name, reqType: p.reqType, groupId: p.groupId });
        }
    }
    return childrenOf;
}

export function renderTreeHtml(chain, rootName, groups) {
    if (chain.size === 0) return '';

    const childrenOf = buildChildrenOf(chain);

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

// Render a single textline ``ref`` as an expandable prerequisite-tree node:
// the same chevron / recursion / played-status rendering the main tree uses,
// so a branch line behaves exactly like a node in the dependency tree. Its
// own prerequisite chain is built on demand (rooted at ``ref``); played refs
// are leaves (already satisfied). ``isPlayed`` threads the (injectable) save
// lookup through so tests stay deterministic.
function renderRefAsTreeNode(ref, reqType, isPlayed) {
    const { chain, groups } = buildPrereqChain(ref, isPlayed);
    const childrenOf = buildChildrenOf(chain);
    const played = isPlayed(ref);
    const subtree = played ? '' : renderChildrenOf(ref, childrenOf, chain, groups, new Set([ref]), 0);
    return renderTreeRow(ref, reqType, true, subtree, played);
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

    const seenGroups = new Set();
    const rendered = [];
    for (const child of children) {
        if (child.groupId) {
            // Render each group once, at the position of its first option.
            if (seenGroups.has(child.groupId)) continue;
            seenGroups.add(child.groupId);
            const group = groups.get(child.groupId);
            if (group) rendered.push({ name: null, html: renderTreeGroupHtml(group, childrenOf, chain, groups, visited, depth) });
        } else {
            rendered.push({ name: child.name, html: renderTreeChildHtml(child, childrenOf, chain, groups, visited, depth) });
        }
    }
    return clusterAlternatesHtml(rendered);
}

// Wrap runs of mutually-exclusive alternate variants among a sibling list
// in a single collapsible "Alternates" box, matching the dependency tree
// (reuses the ``alternates-group`` markup + styling). ``rendered`` is a
// list of ``{ name, html }`` (``name`` null for non-textline items such as
// nested groups, which never cluster). Items keep their order; a cluster
// renders at the position of its first member.
export function clusterAlternatesHtml(rendered) {
    const grouped = new Set();
    let html = '';
    for (const item of rendered) {
        if (item.name && grouped.has(item.name)) continue;
        const siblings = item.name ? alternates[item.name] : null;
        if (siblings && siblings.length) {
            const names = new Set([item.name, ...siblings]);
            const cluster = rendered.filter(r => r.name && names.has(r.name) && !grouped.has(r.name));
            if (cluster.length >= 2) {
                for (const c of cluster) grouped.add(c.name);
                html += renderAlternatesGroupHtml(cluster.map(c => c.html).join(''), cluster.length);
                continue;
            }
        }
        html += item.html;
    }
    return html;
}

function renderAlternatesGroupHtml(rowsHtml, count) {
    return `<div class="alternates-group expanded alternates-other">`
        + `<div class="alternates-group-header" onclick="this.parentElement.classList.toggle('expanded')" data-tooltip="Mutually exclusive variants - only one of these can play; the others are blocked once one does.">`
        + `<span class="alternates-group-chevron">\u25B6</span>`
        + `<span class="alternates-group-label">Alternates</span>`
        + `<span class="alternates-group-count">${count}</span>`
        + `</div>`
        + `<div class="alternates-group-children">${rowsHtml}</div>`
        + `</div>`;
}

// Markup for one tree row given a (possibly empty) pre-rendered subtree.
function renderTreeRow(name, reqType, showEdge, subtree, played) {
    const tl = textlines[name];
    const ownerEntry = tl ? speakers[tl.owner] : null;
    const ownerLabel = ownerEntry?.name || (tl ? tl.owner.replace('NPC_', '').replace('_01', '') : '');
    const hasChildren = subtree.length > 0;
    const chevron = hasChildren ? '<span class="tree-chevron">\u25B6</span>' : '';
    // Coloured save-status dot (played / eligible / blocked), matching the
    // dependency tree, so an eligible-but-unplayed prerequisite (one the
    // player can satisfy right now - common for OR-branch alternatives)
    // reads differently from a blocked one.
    const saveBadge = renderSaveBadgeHtml(name, tl);

    let html = `<div class="tree-node ${played ? 'tree-played' : 'tree-unplayed'}${hasChildren ? ' collapsible collapsed' : ''}">`;
    // Expandable rows toggle on a single click (and open on double-click);
    // leaf rows (a met / satisfied requirement has nothing to expand) open on
    // a single click too, matching how expandable rows respond to one click.
    const rowAttrs = hasChildren
        ? ` onclick="this.parentElement.classList.toggle('collapsed')" ondblclick="event.stopPropagation();navigateTo(${jsAttr(name)})"`
        : ` onclick="navigateTo(${jsAttr(name)})"`;
    html += `<div class="tree-node-row"${rowAttrs}>`;
    html += `${chevron}${saveBadge}`;
    html += `<span class="tree-name">${escapeHtml(name)}</span>`;
    // Narrative-priority badge (H1 tier / H2 ordinal), matching the
    // dependency tree so the two tree views read consistently.
    if (tl) html += renderPrimaryPriorityBadgeHtml(tl);
    if (ownerLabel) html += `<span class="npc-tag">${escapeHtml(ownerLabel)}</span>`;
    if (showEdge && reqType) html += `<span class="edge-type ${getEdgeClass(reqType)}">${getEdgeLabel(reqType)}</span>`;
    html += `<a class="tree-link" onclick="event.stopPropagation();navigateTo(${jsAttr(name)})" data-tooltip="Open detail view" aria-label="Open detail view">\u2197</a>`;
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
    const rendered = sorted.map(opt => {
        if (isDialoguePlayed(opt) === true || !chain.has(opt)) {
            return { name: opt, html: renderTreePlayedOptionHtml(opt) };
        }
        // The option is already claimed, so expand its children directly.
        const subtree = renderChildrenOf(opt, childrenOf, chain, groups, visited, depth + 1);
        return { name: opt, html: renderTreeRow(opt, group.reqType, false, subtree, false) };
    });
    // Cluster mutually-exclusive variants among the options into one box.
    html += clusterAlternatesHtml(rendered);
    html += `</div></div>`;
    return html;
}

// A satisfied (or unwalked) group option: a plain leaf row, ticked when
// already played.
function renderTreePlayedOptionHtml(opt) {
    const isPlayedOpt = isDialoguePlayed(opt) === true;
    return renderTreeRow(opt, null, false, '', isPlayedOpt);
}

// H2 set-level OR branches (alternative requirement sets): the dialogue is
// eligible when at least ONE branch is fully satisfied. The flat prerequisite
// chain can't express "play all of one alternative", so branches get their
// own section - one card per branch. Each branch lists its positive textline
// prerequisites as expandable prerequisite-tree nodes (chevron, recursion,
// played status), exactly like the main tree. Negative (RequiredFalse*) and
// run-count / non-textline gates are omitted - consistent with the rest of
// the tracer, which surfaces positive prerequisite chains, not blocking
// conditions; they are still reflected in each branch's satisfied/unmet
// status. A branch with only non-textline gates shows as already satisfiable.
export function renderOrBranchesHtml(rootName, playedSet = getSaveProgress() || new Set()) {
    const tl = textlines[rootName];
    const branches = (tl && Array.isArray(tl.orBranches)) ? tl.orBranches : [];
    if (branches.length === 0) return '';
    const isPlayed = (n) => playedSet.has(n);

    let html = `<div class="eligibility-tree">`;
    html += `<h4 class="eligibility-tree-header">Alternative requirement branches (${branches.length})</h4>`;
    html += `<div class="eligibility-tree-hint">Satisfy any one of these branches to unlock the dialogue</div>`;
    html += `<div class="eligibility-list">`;
    branches.forEach((branch, i) => {
        html += renderBranchHtml(branch, i, branches.length, rootName, playedSet, isPlayed);
    });
    html += `</div></div>`;
    return html;
}

function renderBranchHtml(branch, index, total, rootName, playedSet, isPlayed) {
    const sat = directSatisfaction(branch, { ...getSaveContext(), played: playedSet }, rootName);
    const satisfied = sat === 'met';
    const indeterminate = sat === 'unknown';
    const icon = satisfied ? '\u2714' : indeterminate ? '?' : '\u25CB';
    const stateCls = satisfied ? ' eligibility-branch-satisfied'
        : indeterminate ? ' eligibility-branch-indeterminate' : '';
    const stateNote = satisfied ? ' \u00B7 satisfied'
        : indeterminate ? ' \u00B7 can\u2019t determine' : '';
    let html = `<div class="eligibility-group${stateCls}">`;
    html += `<div class="eligibility-group-head">`;
    html += `<span class="eligibility-group-option-icon">${icon}</span>`;
    html += `<span class="eligibility-group-title">Option ${index + 1} of ${total}${stateNote}</span>`;
    html += `</div>`;
    html += `<div class="eligibility-tree-container eligibility-branch-prereqs">`;
    html += renderBranchRequirementsHtml(branch, rootName, isPlayed);
    html += `</div></div>`;
    return html;
}

// Render a branch's positive textline prerequisites as expandable tree
// nodes, grouped by semantics (all / any / at-least-N).
function renderBranchRequirementsHtml(branch, rootName, isPlayed) {
    const reqs = (branch && branch.requirements) || {};
    let html = '';
    for (const [reqType, refs] of Object.entries(reqs)) {
        if (!Array.isArray(refs)) continue;
        const others = refs.filter(r => typeof r === 'string' && r !== rootName);
        if (others.length === 0) continue;

        if (OR_REQ_TYPES.has(reqType)) {
            html += `<div class="eligibility-branch-note">Any one of:</div>`;
        } else if (COUNT_MIN_REQ_TYPES.has(reqType)) {
            html += `<div class="eligibility-branch-note">At least ${requiredCount(branch, reqType)} of:</div>`;
        } else if (!AND_REQ_TYPES.has(reqType)) {
            // Negative / run-count / non-textline gates aren't shown as
            // prerequisites (they still drive the satisfied/unmet status).
            continue;
        }
        for (const ref of others) html += renderRefAsTreeNode(ref, reqType, isPlayed);
    }
    if (!html) {
        html += `<div class="eligibility-branch-note">No save-trackable prerequisites (gated by other conditions).</div>`;
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

    const { chain, groups, mandatory } = buildPrereqChain(dialogueName);

    let html = `<div class="eligibility-view">`;
    html += `<div class="eligibility-target">`;
    html += `<h3>Eligibility: <a class="eligibility-target-link" onclick="navigateTo(${jsAttr(dialogueName)})">${escapeHtml(dialogueName)}</a></h3>`;
    html += `<div class="eligibility-target-meta">Owner: ${renderSpeakerHtml(tl.owner)}</div>`;
    html += `</div>`;

    html += renderSummaryHtml(dialogueName, chain, groups, mandatory);
    html += renderOrBranchesHtml(dialogueName);
    // Timing (run-count) gates block independently of the prerequisite chain,
    // but are moot once the dialogue has played or is permanently locked.
    const playedSet = getSaveProgress() || new Set();
    if (isDialoguePlayed(dialogueName) !== true
        && !isUnobtainable(dialogueName, playedSet, getSaveContext().runsAgo)) {
        html += renderBlockingGatesHtml(dialogueName, getSaveContext());
    }
    html += renderUnplayedListHtml(chain, mandatory, dialogueName, groups);
    html += renderTreeHtml(chain, dialogueName, groups);
    // Non-textline conditions (weapons unlocked, last-run cleared, ...) that
    // gate the dialogue but never show up in the prerequisite chain.
    html += renderOtherConditionsHtml(dialogueName);

    html += `</div>`;
    container.innerHTML = html;
}
