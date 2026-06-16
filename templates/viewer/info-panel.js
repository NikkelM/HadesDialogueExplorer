// Info panel: full details for the currently-selected textline (or
// the unresolved-ref banner when the name has no definition).

import {
    textlines,
    knownUnresolved,
    unresolvedCategoryLabels,
    unresolvedCategoryDescriptions,
    unresolvedRefBlocks,
    reqTypeLabels,
    duplicates,
    getActiveGame,
    gameLabels,
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
    renderChoiceNameHtml,
    reqTypeOrderIndex,
} from './utilities.js';
import { metaUpgradeNames, gameDataRefs, namedRequirements } from './data.js';
import { getDialogueStatus, getSaveProgress, saveMatchesActiveGame } from './save-parser.js';

// Render an ``otherRequirements`` key. H2 synthesises compound keys
// like ``PathTrue:GameState.ReachedTrueEnding`` (operator-prefix, then
// the path tail) and ``FunctionName:RequiredAlive``; H1 keeps bare
// field names like ``RequiredFalseFlags``. When the prefix has a
// friendly label in ``reqTypeLabels`` we render it as a hover-tooltip
// pill (internal name + plain-English blurb) and keep the path tail
// readable in monospace. Unknown prefixes fall back to the raw
// pre-escaped key so nothing is lost - the goal is additive: no
// regression for unlabelled keys, friendly labels surface where the
// per-game label vocabulary covers the prefix.
function renderOtherReqKeyHtml(key) {
    const colonIdx = key.indexOf(':');
    const prefix = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    const tail = colonIdx >= 0 ? key.slice(colonIdx + 1) : '';
    if (reqTypeLabels[prefix]) {
        const head = renderReqTypeHtml(prefix);
        return tail
            ? `${head}: <code class="other-req-path">${escapeHtml(tail)}</code>`
            : head;
    }
    return escapeHtml(key);
}

// Lookup key for ``reqTypeOrderIndex`` over an ``otherRequirements``
// entry. Compound keys (``Path:<head>``, ``FunctionName:<name>``)
// share their parent prefix's order slot; bare operator keys map
// straight through. Used to sort the Other Requirements section by
// the same canonical per-game display order the dialogue-edge
// sections use above it.
function _otherReqOrderKey(key) {
    const colonIdx = key.indexOf(':');
    return colonIdx >= 0 ? key.slice(0, colonIdx) : key;
}

// Verbal form for each per-record membership operator on a Path:<head>
// entry. Comparison is handled separately because its rendering reuses
// the comparator string directly (``>``, ``<=`` etc.).
const _PATH_RECORD_MEMBERSHIP_VERBS = {
    IsAny:     'is one of',
    IsNone:    'is none of',
    HasAny:    'contains any of',
    HasAll:    'contains all of',
    HasNone:   'contains none of',
    NotHasAll: 'does not contain all of',
};

// Phrasing for ``CountOf``-modified Path records:
// ``head <phrase> N of <items>``. Mirror sym for ``~=`` / ``!=``.
const _COUNT_OP_PHRASING = {
    '>=': 'has at least',
    '>':  'has more than',
    '<=': 'has at most',
    '<':  'has fewer than',
    '==': 'has exactly',
    '~=': 'does not have exactly',
    '!=': 'does not have exactly',
};

// Friendly head labels for the four single-path operator prefixes whose
// value records carry no extra info beyond the path repeated. These
// drive the row 1-5 rendering: ``Must be true: <head>`` (no value
// suffix - the path tail is already in the head).
const _PATH_OP_FRIENDLY_KEYS = new Set(['PathTrue', 'PathFalse', 'PathEmpty', 'PathNotEmpty']);

// Allowed keys on a ``Path:<head>`` value record we know how to render
// in a human-friendly form. Records carrying any additional modifier
// (CountOf, SumOf, SumPrevRuns, UseLength, ...) fall back to the raw
// JSON display so no information is silently dropped.
const _PATH_RECORD_CLEAN_EXTRA_KEYS = new Set(['Path']);

function _isCleanPathRecord(rec, opKey) {
    for (const k of Object.keys(rec)) {
        if (k === opKey) continue;
        if (opKey === 'Comparison' && k === 'Value') continue;
        if (!_PATH_RECORD_CLEAN_EXTRA_KEYS.has(k)) return false;
    }
    return true;
}

function _formatScalar(v) {
    return typeof v === 'string' ? v : JSON.stringify(v);
}

// Strip a ``<ref:...>`` placeholder back to the bare identifier
// (e.g. ``<ref:GameData.AllWeaponAspects>`` -> ``GameData.AllWeaponAspects``).
// Returns ``null`` for non-string or non-ref values.
function _strRefName(s) {
    if (typeof s !== 'string') return null;
    if (!s.startsWith('<ref:') || !s.endsWith('>')) return null;
    // Reject malformed shapes like ``<ref:foo>bar<ref:baz>`` whose
    // first ``>`` sits before the end of the string; the slice would
    // otherwise extract a body containing literal ``>`` / ``<ref:`` and
    // confuse downstream rendering.
    if (s.indexOf('>') !== s.length - 1) return null;
    return s.slice(5, -1);
}

// Resolve a dotted ``GameData`` / ``ScreenData`` / ``QuestOrderData``
// reference name to its captured registry value, walking nested
// containers + ``[N]`` array indices as needed. The extractor captures
// each top-level assignment whole; nested paths like
// ``ScreenData.Shrine.BountyOrder`` must descend into the parent
// ``ScreenData.Shrine`` dict. Returns the resolved value (list / dict
// / scalar) or ``null`` when no entry covers the requested path.
function _resolveGameDataRef(refName) {
    if (gameDataRefs && gameDataRefs[refName] !== undefined) {
        return gameDataRefs[refName];
    }
    if (!gameDataRefs || typeof refName !== 'string') return null;
    const segs = [];
    const partRe = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
    let m;
    while ((m = partRe.exec(refName)) !== null) {
        segs.push(m[1] !== undefined ? { kind: 'name', value: m[1] } : { kind: 'index', value: parseInt(m[2], 10) });
    }
    if (segs.length === 0) return null;
    for (let i = segs.length - 1; i > 0; i--) {
        const headSegs = segs.slice(0, i);
        if (headSegs.some(s => s.kind !== 'name')) continue;
        const head = headSegs.map(s => s.value).join('.');
        if (gameDataRefs[head] === undefined) continue;
        let cur = gameDataRefs[head];
        let ok = true;
        for (let j = i; j < segs.length; j++) {
            if (cur === null || cur === undefined) { ok = false; break; }
            const seg = segs[j];
            if (seg.kind === 'name') {
                if (typeof cur !== 'object' || Array.isArray(cur)) { ok = false; break; }
                cur = cur[seg.value];
            } else {
                if (!Array.isArray(cur)) { ok = false; break; }
                cur = cur[seg.value - 1];
            }
            if (cur === undefined) { ok = false; break; }
        }
        if (ok) return cur;
    }
    return null;
}

// Render a single item from a membership / CountOf operand list. A
// ``<ref:GameData.X>`` placeholder collapses to the bare ``GameData.X``
// identifier styled as a path chip (the referenced table contents land
// in a follow-up todo); every other value renders as a plain ``<code>``
// chip.
function _renderListItemHtml(v) {
    const refName = _strRefName(v);
    if (refName !== null) {
        return `<code class="other-req-path">${escapeHtml(refName)}</code>`;
    }
    return `<code>${escapeHtml(_formatScalar(v))}</code>`;
}

function _renderOperandList(items) {
    if (!Array.isArray(items)) {
        return _renderListItemHtml(items);
    }
    return items.map(_renderListItemHtml).join(', ');
}

// Render the CountOf item list inline. A top-level ``<ref:GameData.X>``
// placeholder collapses to the bare identifier; arrays render as
// comma-separated chips with ref-stripping applied per element.
function _renderCountItemsHtml(items) {
    return _renderOperandList(items);
}

function _renderCountOfRecord(head, rec) {
    if (!('CountOf' in rec) || !('Comparison' in rec) || !('Value' in rec)) return null;
    for (const k of Object.keys(rec)) {
        if (k === 'CountOf' || k === 'Comparison' || k === 'Value' || k === 'Path') continue;
        return null;
    }
    const phrase = _COUNT_OP_PHRASING[rec.Comparison];
    if (!phrase) return null;
    const headHtml = `<code class="other-req-path">${escapeHtml(head)}</code>`;
    const itemsHtml = _renderCountItemsHtml(rec.CountOf);
    return `${headHtml} ${phrase} <code>${escapeHtml(_formatScalar(rec.Value))}</code> of: ${itemsHtml}`;
}

function _renderPathRecord(head, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    const headHtml = `<code class="other-req-path">${escapeHtml(head)}</code>`;
    const countOf = _renderCountOfRecord(head, rec);
    if (countOf !== null) return countOf;
    if ('Comparison' in rec && 'Value' in rec && _isCleanPathRecord(rec, 'Comparison')) {
        return `${headHtml} ${escapeHtml(String(rec.Comparison))} <code>${escapeHtml(_formatScalar(rec.Value))}</code>`;
    }
    for (const [op, verb] of Object.entries(_PATH_RECORD_MEMBERSHIP_VERBS)) {
        if (op in rec && _isCleanPathRecord(rec, op)) {
            return `${headHtml} ${verb}: ${_renderOperandList(rec[op])}`;
        }
    }
    return null;
}

// Format a single ``FunctionName`` record as
// ``funcName(arg1=val1, arg2=val2): true``. Returns null if the record
// shape is unrecognised so the caller can fall back to raw JSON.
function _renderFunctionRecord(fnName, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    if (rec.FunctionName !== fnName) return null;
    for (const k of Object.keys(rec)) {
        if (k !== 'FunctionName' && k !== 'FunctionArgs') return null;
    }
    const args = rec.FunctionArgs;
    let argsHtml = '';
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        const parts = [];
        for (const [k, v] of Object.entries(args)) {
            parts.push(`${escapeHtml(k)}=<code>${escapeHtml(_formatScalar(v))}</code>`);
        }
        argsHtml = parts.join(', ');
    } else if (args !== undefined) {
        return null;
    }
    return `<span class="other-req-func">${escapeHtml(fnName)}</span>(${argsHtml}) = <code>true</code>`;
}

// Render one of the four "just the path" operator prefixes
// (PathTrue / PathFalse / PathEmpty / PathNotEmpty). The value is a
// list of records each carrying ONLY the operator key with the same
// path as the synthetic head; multiple records (duplicates from the
// extractor) repeat the friendly key joined by ``AND``. Returns
// ``null`` for any unexpected shape so the caller falls back to raw
// JSON.
function _renderPathOpEntry(opKey, key, val) {
    if (!Array.isArray(val) || val.length === 0) return null;
    for (const rec of val) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
        const keys = Object.keys(rec);
        if (keys.length !== 1 || keys[0] !== opKey) return null;
    }
    const friendlyKey = renderOtherReqKeyHtml(key);
    return val.map(() => friendlyKey).join(' <span class="other-req-and">AND</span> ');
}

// Compact friendly summary of a bare-key value. Works for any bare
// key, including ones without a ``reqTypeLabels`` entry - the caller
// drives the label rendering separately.
function _renderBareKeyValueHtml(val) {
    if (val === null || val === undefined) return escapeHtml(String(val));
    if (Array.isArray(val)) {
        if (val.length === 0) return '<code>(empty)</code>';
        return val.map(v => `<code>${escapeHtml(_formatScalar(v))}</code>`).join(', ');
    }
    if (typeof val === 'object') {
        const entries = Object.entries(val);
        if (entries.length === 1 && entries[0][0] === 'Count') {
            return `<code>${escapeHtml(_formatScalar(entries[0][1]))}</code>`;
        }
        if (entries.length === 2 && 'Count' in val && 'Name' in val) {
            return `<code>${escapeHtml(_formatScalar(val.Name))}</code> &gt;= <code>${escapeHtml(_formatScalar(val.Count))}</code>`;
        }
        return entries
            .map(([k, v]) => `<code>${escapeHtml(k)}</code> &gt;= <code>${escapeHtml(_formatScalar(v))}</code>`)
            .join(', ');
    }
    return `<code>${escapeHtml(_formatScalar(val))}</code>`;
}

// Format a bare-key entry as ``Label: summary``. Labelled keys
// surface the friendly pill via ``renderReqTypeHtml``; unlabelled keys
// (e.g. ``RequiredKills``, ``RequiredMinNPCInteractions``) still get
// the same outer shape with the raw key name, so list values render
// with comma+space spacing and map values use the ``Name >= Count``
// idiom rather than the raw JSON fallback.
function _renderBareKeyEntry(key, val) {
    return `${renderReqTypeHtml(key)}: ${_renderBareKeyValueHtml(val)}`;
}

// Lua identifier check for the tooltip formatter: bare keys reproduce
// as ``key = value``; non-identifier keys (containing dots, spaces,
// digits-first, etc.) fall back to bracketed-string form
// ``["My Key"] = value``.
const _LUA_KEYWORDS = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
    'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or',
    'repeat', 'return', 'then', 'true', 'until', 'while',
]);
function _luaIsBareIdent(s) {
    return typeof s === 'string'
        && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
        && !_LUA_KEYWORDS.has(s);
}

// Recursive Lua-table pretty-printer used for the row's hover tooltip.
// Strings quote with double-quotes; ``<ref:GameData.X>`` placeholders
// inline-expand via ``gameDataRefs`` when the referenced table is a
// list / dict (the resolved value renders recursively via
// ``_luaFormat`` so nested refs continue to expand); scalar / missing
// refs fall back to the bare ``GameData.X`` identifier. Booleans /
// numbers print verbatim; arrays render as ``{ v, v }``; objects
// render as ``{ key = v, key = v }`` with bare keys when the key is
// a valid Lua identifier (bracketed-string form otherwise).
//
// ``seen`` guards against pathological self-referential ref cycles
// in the captured registry; it's intentionally not part of the public
// signature so external callers can keep calling ``_luaFormat(v)``.
function _luaFormat(value, seen) {
    if (value === null || value === undefined) return 'nil';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
        const refName = _strRefName(value);
        if (refName !== null) {
            const resolved = _resolveGameDataRef(refName);
            if (
                (Array.isArray(resolved) || (resolved && typeof resolved === 'object'))
                && !(seen && seen.has(refName))
            ) {
                const nextSeen = seen ? new Set(seen) : new Set();
                nextSeen.add(refName);
                return _luaFormat(resolved, nextSeen);
            }
            return refName;
        }
        if (value.startsWith('<expr:') && value.endsWith('>')) return value.slice(6, -1);
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '{ }';
        return `{ ${value.map(v => _luaFormat(v, seen)).join(', ')} }`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{ }';
        const parts = entries.map(([k, v]) => {
            const keyForm = _luaIsBareIdent(k) ? k : `[${JSON.stringify(k)}]`;
            return `${keyForm} = ${_luaFormat(v, seen)}`;
        });
        return `{ ${parts.join(', ')} }`;
    }
    return String(value);
}

// Canonical reading order for keys inside a record (the structured
// form used in row tooltips). Subject (``Path`` / ``FunctionName`` /
// path-operator keys) first, then the comparator / membership
// operator, then the comparand / operand set. Keys not in this list
// retain their original relative order via stable sort.
const _RECORD_KEY_ORDER = [
    'FunctionName',
    'FunctionArgs',
    'Path',
    'PathTrue', 'PathFalse', 'PathEmpty', 'PathNotEmpty',
    'Comparison',
    'Value',
    'CountOf',
    'IsAny', 'IsNone', 'HasAny', 'HasAll', 'HasNone', 'NotHasAll',
    'SumOf', 'SumPrevRuns', 'UseLength',
];
const _RECORD_KEY_ORDER_INDEX = new Map(
    _RECORD_KEY_ORDER.map((k, i) => [k, i])
);

// Render a single record (object) as a multi-line ``Key: value`` field
// list for use inside the tooltip. Each field is on its own line so
// compound records (``Path``, ``Comparison``, ``CountOf``, ...) read
// top-to-bottom. Fields are sorted into ``_RECORD_KEY_ORDER`` reading
// order; nested tables / lists keep Lua syntax via ``_luaFormat``.
function _luaRecord(rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return _luaFormat(rec);
    const entries = Object.entries(rec);
    entries.sort(([a], [b]) => {
        const ia = _RECORD_KEY_ORDER_INDEX.has(a)
            ? _RECORD_KEY_ORDER_INDEX.get(a) : 999;
        const ib = _RECORD_KEY_ORDER_INDEX.has(b)
            ? _RECORD_KEY_ORDER_INDEX.get(b) : 999;
        return ia - ib;
    });
    const parts = entries.map(([k, v]) => {
        const keyForm = _luaIsBareIdent(k) ? k : `[${JSON.stringify(k)}]`;
        return `${keyForm}: ${_luaFormat(v)}`;
    });
    return parts.join('\n');
}

// Build the structured-form tooltip for an ``otherRequirements`` row.
// Compound-key entries (``Path:`` / ``PathTrue:`` / ``FunctionName:``
// etc.) carry a list of records; each record renders as a multi-line
// block of ``OpKey: value`` lines so compound records read top-to-
// bottom. Multiple records under the same key are separated by a
// blank line for visual separation. Bare keys (no colon) render as
// Lua-style single-line ``Key = value``.
export function renderOtherReqTooltip(key, val) {
    const colonIdx = key.indexOf(':');
    if (colonIdx >= 0 && Array.isArray(val)) {
        if (val.length === 0) return `${key.slice(0, colonIdx)} = ${_luaFormat(val)}`;
        return val.map(_luaRecord).join('\n\n');
    }
    const bareKey = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    return `${bareKey} = ${_luaFormat(val)}`;
}

// Resolve a single ``otherRequirements`` entry to its full inner HTML.
// Dispatched per-prefix:
//   - ``PathTrue:`` / ``PathFalse:`` / ``PathEmpty:`` / ``PathNotEmpty:``
//     -> friendly head + path tail with no value suffix (the path
//     already lives in the synthetic key).
//   - ``Path:<head>`` -> Comparison / membership / CountOf records
//     resolved to ``head op value`` / ``head verb: items`` / ``head
//     has at least N of: items``; multiple records AND-joined.
//   - ``FunctionName:<name>`` -> ``f(args) = true`` per record, AND-
//     joined.
//   - Bare keys (with or without a friendly label entry) ->
//     ``Label: summary``; the value renderer turns map values into
//     ``Name >= Count`` and lists into comma-separated chips.
//   - Anything else -> the existing raw fallback (``Key = JSON``).
// Returns the inner HTML to wrap in a ``<div class="other-req-item">``.
function renderOtherReqEntryHtml(key, val) {
    for (const opKey of _PATH_OP_FRIENDLY_KEYS) {
        if (key.startsWith(opKey + ':')) {
            const result = _renderPathOpEntry(opKey, key, val);
            if (result !== null) return result;
            break;
        }
    }
    if (key.startsWith('Path:') && Array.isArray(val) && val.length > 0) {
        const head = key.slice('Path:'.length);
        const parts = [];
        for (const rec of val) {
            const formatted = _renderPathRecord(head, rec);
            if (formatted === null) {
                parts.length = 0;
                break;
            }
            parts.push(formatted);
        }
        if (parts.length) {
            return parts.join(' <span class="other-req-and">AND</span> ');
        }
    }
    if (key.startsWith('FunctionName:') && Array.isArray(val) && val.length > 0) {
        const fnName = key.slice('FunctionName:'.length);
        const parts = [];
        for (const rec of val) {
            const formatted = _renderFunctionRecord(fnName, rec);
            if (formatted === null) {
                parts.length = 0;
                break;
            }
            parts.push(formatted);
        }
        if (parts.length) {
            return parts.join(' <span class="other-req-and">AND</span> ');
        }
    }
    if (key.indexOf(':') === -1) {
        return _renderBareKeyEntry(key, val);
    }
    const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return `${renderOtherReqKeyHtml(key)} = ${escapeHtml(display)}`;
}

// Cross-game duplicate badge. Rendered as a small clickable pill in the
// textline detail header when the same name exists in the other game.
// Clicking it switches to the other game and navigates to the same name.
let _duplicateNameSet = null;
function _getDuplicateNameSet() {
    if (_duplicateNameSet === null) {
        _duplicateNameSet = new Set((duplicates || []).map(d => d.name));
    }
    return _duplicateNameSet;
}

export function resetDuplicateNameSet() {
    _duplicateNameSet = null;
}

function renderCrossGameBadgeHtml(name) {
    if (!_getDuplicateNameSet().has(name)) return '';
    const active = getActiveGame();
    const otherGame = active === 'hades1' ? 'hades2' : 'hades1';
    const otherLabel = (gameLabels && gameLabels[otherGame]) || otherGame;
    return ` <a class="cross-game-badge" title="Also exists in ${otherLabel} - click to navigate" `
        + `onclick="event.stopPropagation(); navigateToState({game:${jsAttr(otherGame)}, view:'dialogue', dialogue:${jsAttr(name)}})">`
        + `\u21C4 ${escapeHtml(otherLabel)}</a>`;
}

function renderSaveProgressPillHtml(name, tl) {
    if (!getSaveProgress() || !saveMatchesActiveGame()) return '';
    const status = getDialogueStatus(name, tl);
    if (!status) return '';
    const labels = { played: '\u2714 Played', eligible: '\u25CB Eligible', blocked: '\u2022 Blocked' };
    const label = labels[status] || status;
    if (status === 'blocked') {
        return ` <a class="save-progress-pill ${status} clickable" onclick="navigateToEligibility(${jsAttr(name)})" title="Open eligibility tracer">${label}</a>`;
    }
    return ` <span class="save-progress-pill ${status}">${label}</span>`;
}

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
        <h3><span class="name">${escapeHtml(name)}</span>${renderCollisionBadgeHtml(tl)}${renderCrossGameBadgeHtml(name)}${renderPriorityBadgeHtml(tl)}${renderPlayOnceBadgeHtml(tl)}${renderSaveProgressPillHtml(name, tl)}</h3>
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
        html += `<div class="synthetic-banner">`
              + `<span>\u21B3 Choice variant of `
              + `<a class="choice-link" onclick="navigateTo(${jsAttr(tl.parentTextline)})">${escapeHtml(tl.parentTextline)}</a>`
              + ` \u00B7 ChoiceText: ${renderChoiceNameHtml(tl.choiceText)}`
              + `</span></div>`;
    }

    // Forward links to any choice variants of this parent textline.
    // Order matches the Lua source (i.e. the same order the engine
    // shows the options to the player, and the same order the
    // dialogue-line ``Choice:`` block below uses) by reading the
    // parent's own ``choicePrompt`` cues. Iterating ``textlines``
    // directly would order them alphabetically, which diverges from
    // both renderings. Anything still missing after walking the
    // prompts is appended in iteration order as a defensive
    // fallback so synthetic children never silently disappear.
    const childChoices = [];
    const seenTargets = new Set();
    for (const line of (tl.dialogueLines || [])) {
        if (line && line.kind === 'choicePrompt' && Array.isArray(line.choices)) {
            for (const c of line.choices) {
                if (textlines[c.targetTextline] && !seenTargets.has(c.targetTextline)) {
                    childChoices.push({ name: c.targetTextline, choice: c.internal });
                    seenTargets.add(c.targetTextline);
                }
            }
        }
    }
    for (const [n, t] of Object.entries(textlines)) {
        if (t.isSynthetic && t.parentTextline === name && !seenTargets.has(n)) {
            childChoices.push({ name: n, choice: t.choiceText });
            seenTargets.add(n);
        }
    }
    if (childChoices.length > 0) {
        html += `<div class="synthetic-banner"><span>Choices: `
              + childChoices.map(c =>
                    `<a class="choice-link" onclick="navigateTo(${jsAttr(c.name)})">${renderChoiceNameHtml(c.choice)}</a>`
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

// Compute the per-option label letters for a choice-prompt's option
// list. Consecutive options that share a ``requiredMetaUpgrade``
// restriction are mutually exclusive at runtime (the player can only
// have one Mirror of Night upgrade variant active per row), so they
// share a single base letter and get numeric suffixes (A1, A2, ...)
// to flag the grouping. Solo gated options (no adjacent siblings with
// the same restriction shape) and ungated options each consume their
// own base letter (A, B, C, ...).
//
// Returns a parallel array of label strings aligned with the input
// ``choices`` array.
function computeChoiceLetters(choices) {
    const labels = new Array(choices.length);
    let baseIdx = 0;
    let i = 0;
    while (i < choices.length) {
        const baseLetter = String.fromCharCode(65 + baseIdx);
        if (choices[i].requiredMetaUpgrade) {
            let j = i;
            while (j < choices.length && choices[j].requiredMetaUpgrade) j++;
            const runLength = j - i;
            if (runLength === 1) {
                labels[i] = baseLetter;
            } else {
                for (let k = 0; k < runLength; k++) {
                    labels[i + k] = baseLetter + (k + 1);
                }
            }
            i = j;
        } else {
            labels[i] = baseLetter;
            i++;
        }
        baseIdx++;
    }
    return labels;
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
            if (typeof line === 'object' && line.kind === 'choicePrompt' && Array.isArray(line.choices)
                && line.choices.length > 0) {
                // Structured choice-prompt rendering. ``renderChoiceNameHtml``
                // falls back to the raw internal id when an option is
                // missing from ``HADES1_CHOICE_NAMES`` / ``HADES2_CHOICE_NAMES``,
                // so partially-unmapped prompts still surface their
                // option list (with a concrete id string for whoever
                // adds the missing label).
                //
                // ``targetTextline`` distinguishes two flavours of
                // choice: inline ``Choices = {...}`` options (romance
                // prompts) have a synthetic follow-up textline name and
                // get wrapped in a click-through link; preset-referenced
                // ``Choices = PresetEventArgs.X`` options (boon vendor
                // menus) carry ``targetTextline: null`` because the
                // engine calls the choice's function directly with no
                // follow-up dialogue, so the option renders as a plain
                // friendly-label span (tooltip still surfaces the
                // internal id).
                html += `<div class="dialogue-line choice-prompt"><span class="choice-prompt-label">Choice:</span> ${escapeHtml(line.text)}</div>`;
                const letters = computeChoiceLetters(line.choices);
                for (let i = 0; i < line.choices.length; i++) {
                    const c = line.choices[i];
                    const letter = letters[i];
                    let extraTooltip = null;
                    if (c.requiredMetaUpgrade) {
                        const friendly = metaUpgradeNames[c.requiredMetaUpgrade] || c.requiredMetaUpgrade;
                        extraTooltip = `Requires ${friendly} (Mirror of Night)`;
                    }
                    const labelHtml = renderChoiceNameHtml(c.internal, extraTooltip);
                    const optionHtml = c.targetTextline
                        ? `<a class="choice-link" onclick="navigateTo(${jsAttr(c.targetTextline)})">${labelHtml}</a>`
                        : labelHtml;
                    html += `<div class="dialogue-line choice-option">`
                          + `<span class="choice-option-letter">${letter}:</span> `
                          + optionHtml
                          + `</div>`;
                }
            } else if (typeof line === 'object' && line.speaker) {
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

    html += renderRequirementsAndOtherHtml(
        requirements,
        otherRequirements,
        {
            textlineName,
            sourcesByType: src.requirementSources || {},
            // The base requirements block uses sectioned ``<h4>``
            // headers per requirement type with a final "Other
            // Requirements" section header. OR-branch payloads reuse
            // this helper with ``compact: true`` to suppress the
            // "Other Requirements" header (the surrounding branch
            // header already provides scope context).
            otherHeaderLabel: 'Other Requirements',
        }
    );

    // H2 alternative requirement groups (set-level ``OrRequirements``
    // on the source RequirementSet). Each branch is itself a set of
    // requirements + otherRequirements that, taken together, satisfies
    // the group; the group as a whole satisfies the parent textline if
    // ANY one branch passes. Rendered as a sibling section to the
    // base AND requirements above so the reader sees both at a glance
    // - the base block is what MUST always hold, the OR block lists
    // the options where any one is sufficient.
    html += renderOrBranchesSectionHtml(src.orBranches, textlineName);

    return html;
}


// Render the OR-branches section ("At least one of these N branches")
// for a host textline or for a named-requirement expansion. Extracted
// so both call sites use the exact same layout, branch numbering, and
// collapse semantics. Returns an empty string when ``orBranches`` is
// missing, not an array, or has no entries.
function renderOrBranchesSectionHtml(orBranches, textlineName) {
    const branches = Array.isArray(orBranches) ? orBranches : [];
    if (branches.length === 0) return '';
    const total = branches.length;
    const groupLabel = `At least one of these ${total} branch${total === 1 ? '' : 'es'}`;
    let html = `<div class="req-section req-type-or-group">`
             + `<h4><span class="toggle">\u25BC</span>${escapeHtml(groupLabel)}</h4>`
             + `<div class="req-section-children expanded">`;
    for (let bi = 0; bi < branches.length; bi++) {
        const branch = branches[bi] || {};
        html += `<div class="or-branch">`
              + `<h5 class="or-branch-header"><span class="toggle">\u25BC</span>`
              + `Option ${bi + 1} of ${total}</h5>`
              + `<div class="or-branch-children expanded">`;
        html += renderRequirementsAndOtherHtml(
            branch.requirements || {},
            branch.otherRequirements || {},
            {
                textlineName,
                sourcesByType: {},
                otherHeaderLabel: null,
            }
        );
        html += `</div></div>`;
    }
    html += `</div></div>`;
    return html;
}


// Set-level keys whose values carry a list of NamedRequirements names
// that can be drilled into. The pre-resolved ``namedRequirements``
// registry shipped in the per-game payload supplies the inner
// requirement chain to render inside each expander.
const _NAMED_REQ_EXPANSION_KEYS = new Set([
    'NamedRequirements',
    'NamedRequirementsFalse',
    'NamedRequirementsCycle',
]);

// Semantic suffix shown next to the name inside the expander header.
// Mirrors the engine semantics each set-level key implies so the
// reader knows whether the resolved chain "must pass" (the default,
// surfaces here only for unresolved names the registry didn't cover)
// or "must FAIL" / signals a cycle.
const _NAMED_REQ_SEMANTIC_SUFFIX = {
    'NamedRequirements':      'must pass',
    'NamedRequirementsFalse': 'must NOT pass',
    'NamedRequirementsCycle': 'recursive reference cycle',
};


function _namedReqIsEmpty(resolved) {
    if (!resolved) return true;
    const reqEmpty = !resolved.requirements || Object.keys(resolved.requirements).length === 0;
    const otherEmpty = !resolved.otherRequirements
        || Object.keys(resolved.otherRequirements).length === 0;
    const orEmpty = !Array.isArray(resolved.orBranches) || resolved.orBranches.length === 0;
    return reqEmpty && otherEmpty && orEmpty;
}


// Render the host-side ``otherRequirements`` entry for one of the
// set-level NamedRequirements* keys. ``names`` is a list of names
// the extractor surfaced (the engine forbids ``NamedRequirements*``
// of length 0). For each name, looks up the resolved inner chain in
// the per-game ``namedRequirements`` registry and renders either:
//   - an expandable section (``.named-req-expand`` with a collapsible
//     ``.named-req-children`` body) when the inner chain has content;
//     the body uses the same ``renderRequirementsAndOtherHtml`` +
//     ``renderOrBranchesSectionHtml`` machinery the host textline uses.
//   - a flat chip (``.named-req-flat``) when the registry has no
//     entry (truly unresolved) or the entry resolves to an empty
//     requirement set (e.g. all gates inlined elsewhere).
// Returns ``null`` when ``names`` is not a non-empty array so the
// caller can fall through to the existing flat-list rendering.
function renderNamedReqExpansionsHtml(key, names, hostTextlineName) {
    if (!Array.isArray(names) || names.length === 0) return null;
    const suffix = _NAMED_REQ_SEMANTIC_SUFFIX[key] || '';
    let html = `<div class="other-req-item named-req-item">`
             + `<div class="named-req-label">${renderOtherReqKeyHtml(key)}:</div>`
             + `<div class="named-req-list">`;
    for (const name of names) {
        const resolved = namedRequirements ? namedRequirements[name] : null;
        const safeName = escapeHtml(name);
        const safeSuffix = suffix ? ` <span class="named-req-suffix">(${escapeHtml(suffix)})</span>` : '';
        if (_namedReqIsEmpty(resolved)) {
            html += `<div class="named-req-flat">`
                  + `<code class="named-req-name">${safeName}</code>${safeSuffix}`
                  + `</div>`;
            continue;
        }
        const inner = renderRequirementsAndOtherHtml(
            resolved.requirements || {},
            resolved.otherRequirements || {},
            {
                textlineName: hostTextlineName,
                sourcesByType: {},
                otherHeaderLabel: null,
            }
        ) + renderOrBranchesSectionHtml(resolved.orBranches, hostTextlineName);
        html += `<div class="named-req-expand">`
              + `<h5 class="named-req-header">`
              + `<span class="toggle">\u25BC</span>`
              + `<code class="named-req-name">${safeName}</code>${safeSuffix}`
              + `</h5>`
              + `<div class="named-req-children expanded">${inner}</div>`
              + `</div>`;
    }
    html += `</div></div>`;
    return html;
}


// Render the requirements + otherRequirements blocks for one set of
// requirement data - the textline's base AND set, or a single OR
// branch. Extracted from ``renderDialogueAndRequirementsHtml`` so OR
// branches can reuse the exact same per-section markup, sort order,
// inline GameData grouping, and Count-on-header merging as the base
// block. The only difference between the two call sites is the
// "Other Requirements" outer header: the base wraps its non-textline
// gates in a labelled ``<h4>`` section, OR branches inline them
// directly under the branch header (which already provides scope).
function renderRequirementsAndOtherHtml(requirements, otherRequirements, options) {
    const { textlineName, sourcesByType, otherHeaderLabel } = options;
    let html = '';

    // Sort requirement sections by the canonical per-game display
    // order so the panel reads with the same ALL -> ANY -> NONE ->
    // MIN -> MAX banding as the tree view (both surfaces consume the
    // single ``reqTypeOrder`` per game). Unknown types fall to the
    // 999 sentinel and trail in stable insertion order amongst
    // themselves.
    const sortedReqEntries = Object.entries(requirements).sort(
        ([a], [b]) => reqTypeOrderIndex(a) - reqTypeOrderIndex(b)
    );
    for (const [type, refs] of sortedReqEntries) {
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
        const sources = (sourcesByType && sourcesByType[type]) || [];
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
        // Sort otherRequirements by the canonical per-game display
        // order too. Compound keys (``Path:<head>``, ``FunctionName:
        // <name>``) are looked up by their prefix; bare operator keys
        // and unknown prefixes fall through to the 999 sentinel.
        const sortedOtherEntries = Object.entries(otherRequirements).sort(
            ([a], [b]) => reqTypeOrderIndex(_otherReqOrderKey(a))
                        - reqTypeOrderIndex(_otherReqOrderKey(b))
        );
        for (const [key, val] of sortedOtherEntries) {
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
                        const extrasTooltip = renderOtherReqTooltip(key, extras);
                        const tipAttr = extrasTooltip ? ` data-tooltip="${escapeHtml(extrasTooltip)}"` : '';
                        otherHtml += `<div class="other-req-item"${tipAttr}>${renderOtherReqKeyHtml(key)} = ${escapeHtml(JSON.stringify(extras))}</div>`;
                    }
                }
                continue;
            }
            // NamedRequirements* set-level keys: render each name as
            // a collapsible expander whose body shows the resolved
            // inner requirement chain. Falls back to the flat-list
            // rendering below if the helper returns null (empty /
            // non-array value).
            if (_NAMED_REQ_EXPANSION_KEYS.has(key)) {
                const expandedHtml = renderNamedReqExpansionsHtml(key, val, textlineName);
                if (expandedHtml !== null) {
                    otherHtml += expandedHtml;
                    continue;
                }
            }
            const tooltip = renderOtherReqTooltip(key, val);
            const tipAttr = tooltip ? ` data-tooltip="${escapeHtml(tooltip)}"` : '';
            otherHtml += `<div class="other-req-item"${tipAttr}>${renderOtherReqEntryHtml(key, val)}</div>`;
        }
        if (otherHtml) {
            if (otherHeaderLabel) {
                html += `<div class="req-section req-type-other">`
                      + `<h4><span class="toggle">\u25BC</span>${escapeHtml(otherHeaderLabel)}</h4>`
                      + `<div class="req-section-children expanded">${otherHtml}</div>`
                      + `</div>`;
            } else {
                // Compact (OR-branch) mode: inline the items directly
                // under the surrounding branch header without an extra
                // section wrapper.
                html += otherHtml;
            }
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
        // NamedRequirements expander header: matched before the OR
        // branch header so a click on a named-req expander deep inside
        // an OR branch toggles the expander rather than collapsing the
        // whole branch above it.
        const namedReqHeader = e.target.closest('.named-req-header');
        if (namedReqHeader && container.contains(namedReqHeader)) {
            toggleSection(namedReqHeader, 'named-req-children');
            return;
        }
        // OR-branch header (h5) inside an Alternative Requirement
        // Groups section. Matched before the wrapping req-section h4
        // so a click on a branch header never bubbles up and folds
        // the whole OR group.
        const orBranchHeader = e.target.closest('.or-branch-header');
        if (orBranchHeader && container.contains(orBranchHeader)) {
            toggleSection(orBranchHeader, 'or-branch-children');
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
