// --- Data Layer ---
//
// All DATA-dependent module state is declared with ``let`` so it can be
// assigned inside ``init(data)`` once the dataset is loaded. Two boot
// modes are supported by the same script (see the bottom of this file):
//
//   - Split build (GH Pages / local HTTP): ``fetch('data.json')``.
//   - Bundled single-file (release artifact, ``file://``): JSON is
//     inlined inside a ``<script type="application/json"
//     id="viewer-data">`` element and read via ``textContent``.

let textlines, dependents, speakerNames, stats;
let knownUnresolved, unresolvedCategoryLabels, unresolvedCategoryDescriptions;
let unresolvedRefBlocks;
let reqTypeLabels, reqTypeEdgeLabels, reqTypeOrder;
let sectionKeyLabels;
let allNames;

// Pre-built index for O(1) lookups when sorting tree children into
// per-type groups; falls back to a sentinel so unknown types sort last
// and keep a stable order amongst themselves. Initialised in
// ``init(data)`` once ``reqTypeOrder`` is populated.
let _reqTypeOrderIndex;

function loadData(DATA) {
    return {
        textlines: DATA.textlines,
        dependents: DATA.dependents,
        speakerNames: DATA.speakerNames || {},
        stats: DATA.stats,
        knownUnresolved: DATA.knownUnresolvedRefs || {},
        unresolvedCategoryLabels: DATA.unresolvedCategoryLabels || {},
        unresolvedCategoryDescriptions: DATA.unresolvedCategoryDescriptions || {},
        unresolvedRefBlocks: DATA.unresolvedRefBlocks || {},
        reqTypeLabels: DATA.reqTypeLabels || {},
        reqTypeEdgeLabels: DATA.reqTypeEdgeLabels || {},
        reqTypeOrder: DATA.reqTypeOrder || [],
        sectionKeyLabels: DATA.sectionKeyLabels || {},
        allNames: Object.keys(DATA.textlines).sort(),
    };
}

// --- Utilities ---

// Escape a string for safe embedding into HTML, covering both text
// content and double-quoted attribute values (the only attribute-quote
// style used in the templates here). Escaping ``"`` in addition to
// the three text-content metacharacters is a free hardening: it has
// no effect inside element text, and it prevents an attribute value
// from breaking out of its surrounding ``"..."`` if a future game
// adds quotes to an identifier. Use :func:`jsAttr` instead when the
// value also needs to be a JavaScript string literal (e.g. inline
// ``onclick``).
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Render a string value safe for embedding inside a quoted HTML
// attribute that is also a JavaScript string literal (e.g.
// ``onclick="navigateTo(${jsAttr(ref)})"``). ``JSON.stringify``
// produces a properly-escaped JS string literal (handles backslashes,
// quotes, control chars, unicode) including its own outer quotes, and
// the subsequent :func:`escapeHtml` pass (which also escapes ``"``)
// keeps the embedded quotes from terminating the surrounding
// attribute. Call sites must NOT add their own quotes around the
// placeholder.
function jsAttr(s) {
    return escapeHtml(JSON.stringify(String(s)));
}

// Look up the friendly display name for a speaker/NPC ID, falling back to
// the internal ID when no mapping exists.
function displayName(id) {
    return speakerNames[id] || id;
}

// Render a speaker/NPC name as HTML: friendly label with the internal ID
// available as a `title` tooltip when a mapping exists.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - both the friendly label and the internal-ID tooltip are
// already routed through escapeHtml below.
function renderSpeakerHtml(id) {
    const friendly = speakerNames[id];
    if (friendly && friendly !== id) {
        return `<span class="speaker-name" title="${escapeHtml(id)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="speaker-name">${escapeHtml(id)}</span>`;
}

function getEdgeClass(type) {
    if (type.includes('False')) return 'edge-false';
    if (type.includes('Any')) return 'edge-any';
    return 'edge-all';
}

// All label/order data lives in Python (see textline_set.py); these
// helpers are pure lookups against the maps injected via DATA.
function reqTypeOrderIndex(type) {
    const i = _reqTypeOrderIndex[type];
    return i === undefined ? 999 : i;
}

function getEdgeLabel(type) {
    return reqTypeEdgeLabels[type] || 'ALL';
}

function formatReqType(type) {
    return reqTypeLabels[type] || type;
}

// Render a requirement-type label as HTML: friendly name with the
// internal field key available as a `title` tooltip when a mapping
// exists. Mirrors ``renderSpeakerHtml`` / ``renderSectionHtml`` so the
// hover-to-reveal-internal-name affordance is consistent across the
// three label families.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at
// the call site - both the friendly label and the internal-key tooltip
// are already routed through escapeHtml below.
function renderReqTypeHtml(type, extraClass) {
    const friendly = reqTypeLabels[type];
    const cls = `req-type-name${extraClass ? ' ' + extraClass : ''}`;
    if (friendly && friendly !== type) {
        return `<span class="${cls}" title="${escapeHtml(type)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="${cls}">${escapeHtml(type)}</span>`;
}

// Render a section key as HTML: friendly label with the internal key
// available as a `title` tooltip when a mapping exists, falling back
// to the raw key when no mapping is registered. The build pipeline
// audits the labels map against the section-key allowlist so any
// missing entry becomes a build-time warning rather than silently
// rendering the raw key here. Mirrors ``renderSpeakerHtml`` so both
// UI surfaces (search dropdown + details view) get the same
// hover-to-reveal-internal-name behaviour, including the dotted-
// underline affordance via the ``[title]`` attribute selector.
//
// Returns pre-escaped HTML. Do NOT pass through escapeHtml again at the
// call site - both the friendly label and the internal-key tooltip are
// already routed through escapeHtml below.
function renderSectionHtml(key) {
    const friendly = sectionKeyLabels[key];
    if (friendly && friendly !== key) {
        return `<span class="section-name" title="${escapeHtml(key)}">${escapeHtml(friendly)}</span>`;
    }
    return `<span class="section-name">${escapeHtml(key)}</span>`;
}

// Returns the category id ('back-compatibility', 'typo-or-bug', 'cut-content')
// for a known unresolved ref, or 'uncategorized' for one not in the
// hardcoded list, or null if the ref is fully resolved.
function unresolvedCategoryFor(name) {
    if (name in textlines) return null;
    const known = knownUnresolved[name];
    return known ? known.category : 'uncategorized';
}

// Render narrative-priority badges as HTML for either the tree or the
// details panel (see issue #8). Two independent signals are surfaced
// side-by-side:
//
//   1. Tier badge - derived purely from the parent section the textline
//      lives in. The engine cascades through priority-tagged sibling
//      containers at the call site (super -> priority -> normal -> low),
//      so this is the dominant scheduling axis.
//
//   2. Set-level badge (optional) - the per-textline-set `Priority` /
//      `SuperPriority` boolean. This only biases random selection
//      *within* a section, never across sections, so it gets its own
//      small "SP" / "P" pill rather than collapsing into the tier badge.
//
// Always returns at least one badge (the tier badge) so every row in
// the tree has a priority tag for visual alignment.
function renderPriorityBadgeHtml(tl) {
    return renderTierBadgeHtml(tl) + renderSetLevelBadgeHtml(tl);
}

function renderTierBadgeHtml(tl) {
    const sec = tl && tl.narrativePrioritySectionTier;
    let strongest;
    let label;
    let icon;
    let tip;
    if (sec === 'super') {
        strongest = 'super';
        label = 'super-priority';
        icon = '\u2605\u2605';
        tip = 'Super-priority dialogues are played before all other dialogues from the same context. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'priority') {
        strongest = 'priority';
        label = 'priority';
        icon = '\u2605';
        tip = 'Priority dialogues are played before normal and low-priority dialogues from the same context, but after super-priority dialogues. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else if (sec === 'low') {
        strongest = 'low';
        label = 'low-priority';
        icon = '\u2B07';
        tip = 'Low-priority dialogues are the final fallback - played only when no super-priority, priority, or normal dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    } else {
        strongest = 'normal';
        label = 'normal';
        icon = '\u25CF';
        tip = 'Normal dialogues are played only when no super-priority or priority dialogue from the same context is eligible. Within a set, a random dialogue from all eligible dialogues is picked.';
    }
    return `<span class="priority-badge priority-${strongest}" title="${escapeHtml(tip)}">${icon} ${escapeHtml(label)}</span>`;
}

function renderSetLevelBadgeHtml(tl) {
    const set = tl && tl.narrativePrioritySetLevel;
    if (set !== 'super' && set !== 'priority') return '';
    const isSuper = set === 'super';
    const cls = isSuper ? 'set-priority-super' : 'set-priority-priority';
    const text = isSuper ? 'SP' : 'P';
    const word = isSuper ? 'super-priority' : 'priority';
    const tip = `Within its own set, this dialogue will be played with ${word} before other eligible dialogues from the same set.`;
    return `<span class="set-priority-badge ${cls}" title="${escapeHtml(tip)}">${text}</span>`;
}

// Render a single requirement <div>, applying the resolved/unresolved
// class plus (when unresolved) the category class so the viewer can
// color-code back-compat vs typo-or-bug vs cut-content vs uncategorized.
// When the ref equals ``selfName`` (the textline whose requirements
// list we're rendering), mark it as a self-reference so the user can
// see that the game data is faithful while understanding it's a known
// cooldown / PlayOnce idiom rather than a contradiction.
function renderReqItem(ref, selfName) {
    const cat = unresolvedCategoryFor(ref);
    const classes = ['req-item'];
    let tip = '';
    if (cat === null) {
        classes.push('resolved');
    } else {
        classes.push('unresolved');
        classes.push('unresolved-cat-' + cat);
        const known = knownUnresolved[ref];
        if (known) {
            const label = unresolvedCategoryLabels[cat] || cat;
            tip = ` title="${escapeHtml(label)}: ${escapeHtml(known.reason)}"`;
        }
    }
    const isSelf = selfName && ref === selfName;
    if (isSelf) {
        classes.push('self-ref');
        if (!tip) {
            tip = ` title="Self-reference: this textline appears in its own requirement list. Common with cooldown (MinRunsSinceAnyTextLines) and PlayOnce (RequiredFalse*) fields; excluded from the dependency graph."`;
        }
    }
    const selfBadge = isSelf ? `<span class="self-ref-badge">self</span>` : '';
    return `<div class="${classes.join(' ')}" data-name="${escapeHtml(ref)}"${tip} onclick="navigateTo(${jsAttr(ref)})">${escapeHtml(ref)}${selfBadge}</div>`;
}

// Render a human-friendly explanation for one blockingReasons entry.
// Each entry describes a single requirement field whose semantics can
// never be satisfied because of unresolved refs.
function renderBlockingReason(reason) {
    const fieldHtml = renderReqTypeHtml(reason.field, 'blocking-field');
    const missing = (reason.missingRefs || [])
        .map(r => `<a class="blocked-ref" onclick="navigateTo(${jsAttr(r)})">${escapeHtml(r)}</a>`)
        .join(', ');
    let explain;
    if (reason.semantics === 'all') {
        explain = `${fieldHtml} requires every listed textline to have played, but `
                + (reason.missingRefs.length === reason.totalRefs
                    ? `none of the ${reason.totalRefs} entries are defined`
                    : `${reason.missingRefs.length} of ${reason.totalRefs} entries are undefined`)
                + `: ${missing}.`;
    } else if (reason.semantics === 'any') {
        explain = `${fieldHtml} requires at least one of the listed textlines to have played, but all ${reason.totalRefs} are undefined: ${missing}.`;
    } else if (reason.semantics === 'count-min') {
        explain = `${fieldHtml} requires at least ${reason.requiredCount} of the listed textlines to have played, but only ${reason.resolvedCount} are defined (${reason.missingRefs.length} missing: ${missing}).`;
    } else {
        explain = `${fieldHtml}: ${missing}.`;
    }
    return `<div class="blocked-reason">${explain}</div>`;
}

// --- Stats Component ---

function initStats() {
    const el = document.getElementById('stats');
    const byCat = stats.unresolvedByCategory || {};
    const uncategorizedCount = byCat.uncategorized || 0;

    let txt =
        `${stats.totalOwners} owners \u00B7 ${stats.totalTextlines} textlines \u00B7 ${stats.totalEdges} relationships`;

    if (uncategorizedCount > 0) {
        txt += ` \u00B7 ${uncategorizedCount} external refs`;
    }
    el.textContent = txt;
}

// --- Search Component ---

function initSearch() {
    const searchInput = document.getElementById('search');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        if (!q) { searchResults.classList.remove('visible'); return; }
        // Match against textline name, NPC internal id, and NPC display name
        const matches = allNames.filter(n => {
            if (n.toLowerCase().includes(q)) return true;
            const tl = textlines[n];
            if (!tl) return false;
            if (tl.owner.toLowerCase().includes(q)) return true;
            const friendly = speakerNames[tl.owner];
            if (friendly && friendly.toLowerCase().includes(q)) return true;
            return false;
        }).slice(0, 30);
        if (matches.length === 0) { searchResults.classList.remove('visible'); return; }
        searchResults.innerHTML = matches.map(n => {
            const tl = textlines[n];
            const ownerLabel = displayName(tl.owner);
            return `<div class="search-item" data-name="${escapeHtml(n)}">${escapeHtml(n)}<span class="npc">${escapeHtml(ownerLabel)} \u00B7 ${renderSectionHtml(tl.section)}</span></div>`;
        }).join('');
        searchResults.classList.add('visible');
    });

    searchResults.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (item) {
            navigateTo(item.dataset.name);
            searchResults.classList.remove('visible');
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = searchResults.querySelector('.search-item');
            if (first) {
                navigateTo(first.dataset.name);
                searchResults.classList.remove('visible');
            }
        }
        if (e.key === 'Escape') searchResults.classList.remove('visible');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) searchResults.classList.remove('visible');
    });
}

// --- Info Panel Component ---

function renderInfo(name) {
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
              + `<span class="unresolved-cat-badge">\u26A0 External / unresolved</span>`
              + `<span class="unresolved-cat-reason">Referenced as a requirement but no definition found in any parsed source file, and not categorized in the hardcoded known-unresolved list.</span>`
              + `</div>`
              + blocksHtml
              + `</div>`;
        }
        return;
    }
    let html = `<div class="textline-info">
        <h3>${escapeHtml(name)}${renderPriorityBadgeHtml(tl)}</h3>
        <div class="meta">
            <span>Owner: ${renderSpeakerHtml(tl.owner)}</span>
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
        // Surface the count inline with the header (issue #43) so the
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

// --- Tree Component (lazy expansion) ---

function getChildren(name, direction) {
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

function hasChildren(name, direction) {
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
function ensureExpandedContentVisible(container) {
    if (!container) return;
    const panelBody = container.closest('.panel-body');
    if (!panelBody) return;
    requestAnimationFrame(() => {
        panelBody.scrollTo({ left: panelBody.scrollWidth, behavior: 'smooth' });
    });
}

function createNodeEl(name, edgeType, direction, ancestorPath) {
    const tl = textlines[name];
    // Use the friendly display name for the owner tag when available,
    // otherwise fall back to a stripped-down version of the internal ID.
    let ownerTag = '?';
    if (tl) {
        ownerTag = speakerNames[tl.owner] || tl.owner.replace('NPC_', '').replace('_01', '');
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
            warn.textContent = '\u26A0 unresolved';
            warn.title = 'Referenced but not defined; not in the hardcoded known-unresolved list.';
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

    // Narrative-priority badge (see issue #8). Surfaces both the
    // section-tier and set-level priority on the textline; the badge
    // collapses to the strongest of the two with the breakdown in the
    // tooltip. Placed immediately before `.npc-tag` so it sits inside
    // the right-aligned cluster of the row; CSS pushes the badge to
    // the right via `margin-left: auto` so badges line up across rows
    // regardless of textline-name length. Only relevant for resolved
    // textlines (`tl != null`); unresolved-ref nodes never have
    // priority metadata.
    if (tl) {
        const priorityHtml = renderPriorityBadgeHtml(tl);
        if (priorityHtml) {
            const wrapper = document.createElement('span');
            wrapper.innerHTML = priorityHtml;
            while (wrapper.firstChild) {
                label.appendChild(wrapper.firstChild);
            }
        }
    }

    const npcSpan = document.createElement('span');
    npcSpan.className = 'npc-tag';
    npcSpan.textContent = ownerTag;
    if (tl) {
        npcSpan.title = tl.owner;
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

// --- Tree Panel Renderers ---

function renderUpstream(name) {
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

function renderDownstream(name) {
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
//     └─ .gamedata-group  (per GameData.X source list, optional)
//          └─ .tree-node
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
function appendChildrenWithTypeGrouping(container, kids, direction, ancestorPath, parentName) {
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

function createReqTypeGroup(edgeType, count, requirementCount) {
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
    // Mirror the other render*Html helpers: only attach the tooltip
    // when a friendly mapping exists, so unmapped types stay plain.
    const friendlyEdge = reqTypeLabels[edgeType];
    if (friendlyEdge && friendlyEdge !== edgeType) {
        label.title = edgeType;
        label.classList.add('has-tooltip');
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
function appendGroupedChildren(container, kids, direction, ancestorPath) {
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

function createGameDataGroup(groupName, edgeType, count) {
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

// --- Navigation ---

// Tracks the name currently reflected in window.location.hash so the
// hashchange listener can skip the redundant re-render that fires when
// navigateTo itself sets the hash.
let urlSelection = null;

function selectTextline(name) {
    renderInfo(name);
    renderUpstream(name);
    renderDownstream(name);
}

function navigateTo(name) {
    urlSelection = name;
    selectTextline(name);
    document.getElementById('search').value = name;
    window.location.hash = name;
}

// Read window.location.hash and sync the viewer to whatever name it
// points to. Used on initial load and on every browser back/forward.
function applyHashFromUrl() {
    const hash = window.location.hash;
    // Normalise to ``null`` so an absent / freshly-cleared hash and the
    // initial ``urlSelection = null`` state compare equal, sparing the
    // redundant first-load clear and preventing ``urlSelection`` from
    // drifting between ``''`` and ``null`` across navigations.
    const name = (hash ? decodeURIComponent(hash.slice(1)) : '') || null;
    if (name === urlSelection) return;
    urlSelection = name;
    if (name) {
        selectTextline(name);
        document.getElementById('search').value = name;
    } else {
        // User cleared the hash (e.g. manually deleted ``#Foo`` from the
        // URL bar). Clear the panels so the previously-selected
        // textline's content doesn't linger as a stale "current
        // selection" the user can no longer link to via the URL.
        clearSelection();
    }
}

// Restore each panel and the search box to the same empty state the
// page starts in (mirrors the placeholder markup in
// ``templates/index.html``). Called by :func:`applyHashFromUrl` when
// the location hash is removed so the viewer matches its first-load
// appearance rather than holding onto a stale selection.
function clearSelection() {
    document.getElementById('info-content').innerHTML =
        '<div class="empty-state">Search for a textline to see its details</div>';
    document.getElementById('upstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see its prerequisites</div>';
    document.getElementById('downstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see what depends on it</div>';
    document.getElementById('search').value = '';
}

// --- Init ---

function init(data) {
    ({
        textlines, dependents, speakerNames, stats,
        knownUnresolved, unresolvedCategoryLabels, unresolvedCategoryDescriptions,
        unresolvedRefBlocks,
        reqTypeLabels, reqTypeEdgeLabels, reqTypeOrder,
        sectionKeyLabels,
        allNames,
    } = loadData(data));

    _reqTypeOrderIndex = (() => {
        const m = {};
        reqTypeOrder.forEach((t, i) => { m[t] = i; });
        return m;
    })();

    initStats();
    initSearch();
    applyHashFromUrl();
    window.addEventListener('hashchange', applyHashFromUrl);
}

// Render a load error into the stable #app-error mount instead of
// blowing away the page chrome, so the search bar and panel headers
// remain visible while the user reads the message.
function showLoadError(err) {
    const mount = document.getElementById('app-error');
    const msg = (err && err.message) ? err.message : String(err);
    if (mount) {
        mount.hidden = false;
        mount.textContent = 'Failed to load dialogue data: ' + msg;
    } else {
        // Fallback: prepend to body if the mount is missing (e.g.
        // someone customised the shell and removed the placeholder).
        const fallback = document.createElement('div');
        fallback.style.cssText = 'padding:1em;margin:1em;background:#3a1414;color:#f8b;border:1px solid #a44;border-radius:6px';
        fallback.textContent = 'Failed to load dialogue data: ' + msg;
        document.body.insertBefore(fallback, document.body.firstChild);
    }
}

// Dual-mode boot:
//   1. Bundled single-file: data is inlined as
//      ``<script type="application/json" id="viewer-data">``; we read
//      its textContent and JSON.parse it. Works from ``file://``.
//   2. Split build: no inline element, so fetch ``data.json``. Requires
//      an HTTP server (local dev or GH Pages).
// Wrapped in an async function so a synchronous JSON.parse throw is
// caught by the same try/catch as a network failure.
async function boot() {
    try {
        const inline = document.getElementById('viewer-data');
        let data;
        if (inline) {
            data = JSON.parse(inline.textContent);
        } else {
            const r = await fetch('data.json');
            if (!r.ok) {
                throw new Error('HTTP ' + r.status + ' fetching data.json');
            }
            data = await r.json();
        }
        init(data);
    } catch (err) {
        console.error('Viewer boot failed:', err);
        showLoadError(err);
    }
}

boot();
