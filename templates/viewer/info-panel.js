// Info panel: full details for the currently-selected textline (or
// the unresolved-ref banner when the name has no definition).

import {
    textlines,
    alternates,
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
    renderSaveBadgeHtml,
    saveStatusTooltip,
    groupStatusTooltip,
} from './utilities.js';
import { metaUpgradeNames, entityNames, gameDataRefs, namedRequirements } from './data.js';
import { pathScopeNames, pathFieldNames, pathObjectFields, pathFieldLeafNames, pathLiteralLeafFields, brokenPathRefs } from './data.js';
import { getDialogueStatus, getSaveProgress, getSaveContext, saveMatchesActiveGame } from './save-parser.js';
import { evaluateOtherRequirements, buildOtherReqSlices, gateClausePermanentlyUnmet, h2OperandMarks } from './gamestate-eval.js';
import { h1OperandMarks } from './gamestate-eval-h1.js';
import { requirementGroupVerdict, orBranchVerdict, orGroupVerdict, namedRequirementGroupVerdict, namedRequirementHostVerdict } from './unobtainable.js';

// Whether to render save-eligibility dots (a matching save is loaded).
function _saveDotsActive() {
    return !!(getSaveProgress() && saveMatchesActiveGame());
}

// A met / unmet / indeterminate / unobtainable status dot (same colour
// language as the dependency tree's group dots), or '' for an unknown status
// value. The trailing space lets callers interpolate it before a label.
function statusDot(status, tooltip) {
    if (!['met', 'unmet', 'unknown', 'unobtainable'].includes(status)) return '';
    return `<span class="group-status group-status-${status}" data-tooltip="${escapeHtml(tooltip)}"></span> `;
}

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
// Scope phrases for a ``SpeechRecord`` voiceline clause, keyed by the path
// segments preceding ``SpeechRecord``. ``GameState`` (or a bare table) is the
// lifetime record, so it carries no suffix; the run / room records add one.
const _SPEECH_SCOPE_PHRASES = {
    '': '',
    'GameState': '',
    'CurrentRun': ' (this run)',
    'CurrentRun.CurrentRoom': ' (this room)',
};

// A ``PathTrue`` / ``PathFalse`` clause that targets a single voiceline cue in a
// ``SpeechRecord`` table reads far more naturally as "Voiceline must (NOT) have
// played" than the raw "Must be true: GameState.SpeechRecord.<cue>" - mirroring
// the H1 RequiredPlayed / RequiredFalsePlayed wording. Returns the head HTML
// (friendly pill + trimmed cue chip) or ``null`` when the tail is not such a
// clause, so the generic operator rendering still applies everywhere else.
function _voicelineCueHeadHtml(prefix, tail) {
    if (prefix !== 'PathTrue' && prefix !== 'PathFalse') return null;
    const segs = String(tail).split('.');
    const si = segs.indexOf('SpeechRecord');
    // The cue must be the single segment immediately after ``SpeechRecord``.
    if (si < 0 || si !== segs.length - 2) return null;
    const leaf = segs[segs.length - 1];
    if (!leaf.startsWith('/VO/')) return null;
    const scopeKey = segs.slice(0, si).join('.');
    if (!(scopeKey in _SPEECH_SCOPE_PHRASES)) return null;
    const played = prefix === 'PathTrue';
    const label = (played ? 'Voiceline must have played' : 'Voiceline must NOT have played')
        + _SPEECH_SCOPE_PHRASES[scopeKey];
    const pill = `<span class="req-type-name" data-tooltip="${escapeHtml('Internal name: ' + prefix)}">${escapeHtml(label)}</span>`;
    return `${pill}: ${_valueChip(leaf)}`;
}

function renderOtherReqKeyHtml(key) {
    const colonIdx = key.indexOf(':');
    const prefix = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    const tail = colonIdx >= 0 ? key.slice(colonIdx + 1) : '';
    if (tail) {
        const voiceline = _voicelineCueHeadHtml(prefix, tail);
        if (voiceline !== null) return voiceline;
    }
    if (reqTypeLabels[prefix]) {
        const head = renderReqTypeHtml(prefix);
        return tail
            ? `${head}: ${_renderPathTailHtml(tail)}`
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

// Aggregation modifiers that count how many of the listed items occur in
// the path's table, read most naturally as ``<head> <phrase> N of:
// items`` (paired with Comparison + Value).
const _PATH_COUNT_ITEMS_KEYS = ['CountOf', 'TableValuesToCount', 'ValuesToCount'];

// A Path record renders friendly only when every one of its keys is
// recognised and consumed; any leftover key sends the caller back to the
// raw JSON dump so a modifier is never silently dropped.
function _allConsumed(keys, consumed) {
    for (const k of keys) {
        if (!consumed.has(k)) return false;
    }
    return true;
}

function _pathToString(p) {
    return Array.isArray(p) ? p.join('.') : _formatScalar(p);
}

function _formatScalar(v) {
    // Round non-integer numbers to 2 decimals so save-derived fractions (e.g. a
    // boss health-bar value like 0.8111153846) read cleanly.
    if (typeof v === 'number' && !Number.isInteger(v)) {
        return String(Math.round(v * 100) / 100);
    }
    return typeof v === 'string' ? v : JSON.stringify(v);
}

// Voiceline cues are stored with a leading ``/VO/`` scope (e.g.
// ``/VO/ZagreusHome_0895``), and the engine keys ``SpeechRecord`` by that full
// cue - so the raw value is kept for save matching and tooltips, but the prefix
// is noise in the displayed label and is stripped for readability. Cues also
// appear as a path leaf (``GameState.SpeechRecord./VO/Artemis_0304``), so every
// occurrence is removed, not just a leading one.
function _trimVoCue(s) {
    return typeof s === 'string' ? s.replace(/\/VO\//g, '') : s;
}

// Operand-satisfaction marking: when a matching save is loaded, the set/any/
// count gates can show which individual listed operands the save satisfies.
// ``_operandMarks`` holds the marks for the gate currently rendering: a
// ``{ recs, flat }`` where ``flat`` colours operands by value across the whole
// gate and ``recs`` (when present) colours per record so the same operand can be
// green under one clause and red under another (e.g. a "3-4 of 5" range).
// ``_curGreen`` / ``_curRed`` are the operand sets in force for the chip being
// rendered; the Path record loop swaps them per record, H1 leaves them at flat.
// Module-scoped to avoid threading them through every operand-formatting helper.
let _operandMarks = null;
let _curGreen = null;
let _curRed = null;
let _curCounts = null;
let _curTotal = null;
let _curTotalMet = null;
let _curScalar = null;
let _curScalarMet = null;
let _curActuals = null;

// Compute the operand marks for one gate, dispatched by game. Returns a
// ``{ recs, flat }`` mark structure (green = having the operand helps the clause,
// red = it hurts), or null when the gate isn't a markable set/membership/count
// gate (or nothing is determinable from the save).
export function computeOperandMarks(key, val, sctx, slices, gameId) {
    if (!sctx || !sctx.gameState) return null;
    if (gameId === 'hades1') {
        const ctx = {
            gs: sctx.gameState,
            currentRun: (slices && slices.currentRun) || null,
            prevRun: (slices && slices.prevRun) || null,
            runHistory: (slices && slices.runHistory) || null,
        };
        return h1OperandMarks(key, val, ctx);
    }
    return h2OperandMarks(key, val, { ...(slices || {}), gameState: sctx.gameState });
}

// A mark structure carries something to show when a flat / per-record set is
// non-empty, it has per-operand count tallies, or it has an aggregate "you have
// X" total to display.
function _markEntryHasContent(e) {
    return !!(e && (e.green.size || e.red.size || (e.counts && e.counts.size)
        || e.total != null || e.scalarValue != null || (e.actuals && e.actuals.size)));
}
function _hasOperandMarks(marks) {
    if (!marks) return false;
    if (_markEntryHasContent(marks.flat)) return true;
    return !!(marks.recs && marks.recs.some(_markEntryHasContent));
}

// Set / clear the operand marks for the entry about to render. Exported so the
// eligibility tracer's other-conditions renderer can mark operands too. Resets
// the in-force sets to the gate's flat marks (the default for H1 single-list
// renders); the Path record loop overrides them per record via _setRecordMarks.
export function setOperandMarks(marks) {
    _operandMarks = _hasOperandMarks(marks) ? marks : null;
    _setFlatMarks();
}
function _setFlatMarks() {
    const flat = _operandMarks && _operandMarks.flat;
    _curGreen = flat && flat.green.size ? flat.green : null;
    _curRed = flat && flat.red.size ? flat.red : null;
    _curCounts = flat && flat.counts && flat.counts.size ? flat.counts : null;
    _curTotal = flat && flat.total != null ? flat.total : null;
    _curTotalMet = flat ? (flat.totalMet ?? null) : null;
    _curScalar = flat && flat.scalarValue != null ? flat.scalarValue : null;
    _curScalarMet = flat ? (flat.scalarMet ?? null) : null;
    _curActuals = flat && flat.actuals && flat.actuals.size ? flat.actuals : null;
}
// Swap the in-force operand sets to the marks for Path record index ``i`` (used
// while rendering a multi-clause Path gate). Falls back to no marks for that
// record when record-indexed marks exist but this record has none.
function _setRecordMarks(i) {
    if (!_operandMarks || !_operandMarks.recs) return; // flat-only (H1): leave as-is
    const rec = _operandMarks.recs[i];
    _curGreen = rec && rec.green.size ? rec.green : null;
    _curRed = rec && rec.red.size ? rec.red : null;
    _curCounts = rec && rec.counts && rec.counts.size ? rec.counts : null;
    _curTotal = rec && rec.total != null ? rec.total : null;
    _curTotalMet = rec ? (rec.totalMet ?? null) : null;
    _curScalar = rec && rec.scalarValue != null ? rec.scalarValue : null;
    _curScalarMet = rec ? (rec.scalarMet ?? null) : null;
    _curActuals = rec && rec.actuals && rec.actuals.size ? rec.actuals : null;
}

// CSS class colouring a numeric tally by whether its criterion is met: green when
// the comparison the gate makes is satisfied by the save, red when not. Returns
// '' (no colour) when the met-state is unknown.
function _metClass(met) {
    if (met === true) return 'other-req-operand-met';
    if (met === false) return 'other-req-operand-unmet';
    return '';
}

// Aggregate "(X)" clause for a count-of-set gate, inserted between the "... of"
// phrasing and the operand list. Shows how many of the listed set the save has -
// the quantity the gate's threshold actually compares against - for sets whose
// members are boolean (so they carry no per-item tally). Coloured green / red by
// whether that count satisfies the gate. Empty when there's no aggregate to show.
function _renderAggregateHtml() {
    if (_curTotal == null) return '';
    const cls = _metClass(_curTotalMet);
    const attr = cls ? ` class="${cls}"` : '';
    return ` (<code${attr}>${escapeHtml(String(_curTotal))}</code>)`;
}

// "(X)" clause for a plain numeric comparison gate (no list), inserted after the
// path subject so the save's value sits beside the threshold it's compared
// against. Coloured green / red by whether the comparison is satisfied. Empty
// when the gate currently rendering has no scalar value.
function _renderScalarHaveHtml() {
    if (_curScalar == null) return '';
    const cls = _metClass(_curScalarMet);
    const attr = cls ? ` class="${cls}"` : '';
    return ` (<code${attr}>${escapeHtml(_formatScalar(_curScalar))}</code>)`;
}

// Render a scalar operand value as a ``<code>`` chip, resolving an internal
// game-entity id (boon/trait, keepsake, companion, weapon aspect, god boon,
// enemy, item, ...) to its friendly DisplayName via ``entityNames`` and keeping
// the internal id in the hover tooltip. Non-strings and unmapped ids render the
// raw value unchanged. ``cls`` adds a CSS class to the chip when given.
function _valueChip(v, cls) {
    const klass = cls ? ` class="${cls}"` : '';
    if (typeof v === 'string') {
        const friendly = entityNames[v];
        if (friendly && friendly !== v) {
            return `<code${klass} data-tooltip="${escapeHtml(v)}">${escapeHtml(friendly)}</code>`;
        }
    }
    const raw = _formatScalar(v);
    const disp = _trimVoCue(raw);
    // A trimmed ``/VO/`` cue keeps its full form reachable via the tooltip.
    const tip = disp !== raw ? ` data-tooltip="${escapeHtml(raw)}"` : '';
    return `<code${klass}${tip}>${escapeHtml(disp)}</code>`;
}

// Build a friendly gloss for a dotted save-state path, e.g.
// ``CurrentRun.UseRecord.NPC_Hecate_01`` -> "interacted with Hecate, this run"
// and ``GameState.ReachedTrueEnding`` -> "reached the credits". Composes the
// root scope (this run / last run; GameState adds no suffix), the state field
// label, and - for object-taking fields - the trailing entity leaf resolved via
// ``entityNames``. Returns ``{ text, full }`` (``full`` = every path segment is
// represented by a friendly name, so the raw path can move to a tooltip) or
// ``null`` when no field matches (caller falls back to the single-entity-leaf
// behaviour, then to the raw path).
function _pathGloss(segs) {
    if (!segs.length) return null;
    const hasScope = Object.prototype.hasOwnProperty.call(pathScopeNames, segs[0]);
    const scope = hasScope ? pathScopeNames[segs[0]] : '';
    const rest = hasScope ? segs.slice(1) : segs;
    // Longest field key first (three-segment CurrentRoom.Encounter.* sub-paths,
    // two-segment Hero.* / CurrentRoom.* sub-paths), then the single segment.
    for (const len of [3, 2, 1]) {
        if (rest.length < len) continue;
        const key = rest.slice(0, len).join('.');
        const label = pathFieldNames[key];
        if (!label) continue;
        let gloss = label;
        let full = true;
        if (pathObjectFields.has(key)) {
            const objSegs = rest.slice(len);
            if (!objSegs.length) {
                // Bare aggregation (HasAny / CountOf / UseLength over operands).
                // A noun-category label (ends with ':') still describes the head,
                // so gloss it without the trailing ':'. A verb label (no ':')
                // would dangle before the operator phrasing, so leave the path
                // raw and let the friendly operands carry the meaning.
                if (!label.endsWith(':')) return null;
                gloss = label.slice(0, -1);
            } else {
                const leaf = objSegs[objSegs.length - 1];
                const leafMap = pathFieldLeafNames[key];
                const friendly = (leafMap && leafMap[leaf]) || entityNames[leaf];
                // The label may carry a trailing ':' separator; keep a single space.
                gloss += ' ' + (friendly || leaf);
                // Partial when the leaf is an unresolved id (unless the field's
                // raw leaf is itself the intended value, e.g. a TextLinesRecord
                // dialogue id), or there are extra intermediate segments the
                // gloss doesn't account for.
                const literalOk = !friendly && pathLiteralLeafFields.has(key);
                if ((!friendly && !literalOk) || objSegs.length > 1) full = false;
            }
        } else {
            if (gloss.endsWith(':')) gloss = gloss.slice(0, -1);
            // A terminal field that still carries trailing segments leaves them
            // unresolved (e.g. WeaponsFiredRecord.WeaponSpellLaser).
            if (rest.length > len) full = false;
        }
        // Append the run/last-run scope suffix, except for current-room fields
        // (a "current room ..." label already implies the current run, so the
        // ", this run" suffix would be redundant).
        if (scope && !key.startsWith('CurrentRoom')) gloss += ', ' + scope;
        // Glosses can render standalone (fully-resolved paths drop the raw path),
        // so present them sentence-case: capitalise the first letter. The label
        // maps stay lowercase fragments so they compose cleanly.
        const text = gloss.charAt(0).toUpperCase() + gloss.slice(1);
        return { text, full };
    }
    return null;
}

// A "(cut content)" note badge when any segment of a path is a known broken /
// cut reference (see ``brokenPathRefs``); empty otherwise. The full explanation
// rides in the hover tooltip. Appended to the rendered path so a reader knows
// the gate references something that no longer exists and has no effect.
function _brokenRefNote(segs) {
    for (const seg of segs) {
        const note = brokenPathRefs[seg];
        if (note) {
            return ` <span class="other-req-broken-ref" data-tooltip="${escapeHtml(note)}">`
                + `(cut content)</span>`;
        }
    }
    return '';
}

// Render a dotted path tail (``CurrentRun.UseRecord.<entity>``,
// ``GameState.ReachedTrueEnding``, ...) as an ``other-req-path`` chip. A fully
// resolved path renders as just its friendly gloss, with the raw internal path
// moved to a hover tooltip. A partially resolved path (or a single resolved
// entity segment) keeps the raw path with the friendly gloss appended in
// parentheses. An unresolved path renders raw. A "(cut content)" note is
// appended when a segment is a known broken reference.
function _renderPathTailHtml(path) {
    const segs = String(path).split('.');
    const broken = _brokenRefNote(segs);
    const gloss = _pathGloss(segs);
    const dispPath = _trimVoCue(path);
    // When a ``/VO/`` cue prefix is stripped from the visible path, keep the full
    // path reachable via a tooltip (branches that already tooltip the raw path
    // don't need it).
    const cueTip = dispPath !== path ? ` data-tooltip="${escapeHtml(path)}"` : '';
    if (gloss) {
        const glossText = _trimVoCue(gloss.text);
        if (gloss.full) {
            return `<code class="other-req-path" data-tooltip="${escapeHtml(path)}">`
                + `${escapeHtml(glossText)}</code>${broken}`;
        }
        return `<code class="other-req-path"${cueTip}>${escapeHtml(dispPath)}`
            + ` <span class="other-req-friendly">(${escapeHtml(glossText)})</span></code>${broken}`;
    }
    const hits = [];
    for (let i = 0; i < segs.length; i++) {
        const friendly = entityNames[segs[i]];
        if (friendly && friendly !== segs[i]) hits.push(i);
    }
    if (hits.length !== 1) {
        return `<code class="other-req-path"${cueTip}>${escapeHtml(dispPath)}</code>${broken}`;
    }
    const friendly = entityNames[segs[hits[0]]];
    return `<code class="other-req-path"${cueTip}>${escapeHtml(dispPath)}`
        + ` <span class="other-req-friendly">(${escapeHtml(friendly)})</span></code>${broken}`;
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
    const direct = gameDataRefs && gameDataRefs[refName];
    // A direct hit wins, unless it's the broken self-ref alias (``X -> <ref:X>``)
    // that shadows a table actually stored nested under a parent key - then fall
    // through to the dotted-name walk below.
    if (direct !== undefined && direct !== `<ref:${refName}>`) {
        return direct;
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
    let cls = null;
    if (_curRed && _curRed.has(v)) cls = 'other-req-operand-unmet';
    else if (_curGreen && _curGreen.has(v)) cls = 'other-req-operand-met';
    let html = _valueChip(v, cls);
    if (_curCounts && _curCounts.has(v)) {
        // The tally shares its operand's colour treatment (same green / red
        // backdrop), so the two read as one unit. The separating space lives
        // inside the tally span so the backdrop / underline runs unbroken from
        // the name into the tally rather than leaving an uncoloured gap.
        const tint = cls ? ` ${cls}` : '';
        html += `<span class="other-req-operand-count${tint}"> (${escapeHtml(String(_curCounts.get(v)))})</span>`;
    }
    if (_curActuals && _curActuals.has(v)) {
        // Equality gates show the save's actual field value beside the operand
        // name, coloured green / red by whether it satisfies the gate. The field
        // name itself stays uncoloured so the "(actual)" reads as distinct from
        // the required value that follows the operator (e.g. ``field (Megaera) =
        // Hypnos``). An absent field reads "(unset)".
        const a = _curActuals.get(v);
        const acls = _metClass(a.met);
        if (a.value == null) {
            const attr = acls ? ` class="${acls}"` : '';
            html += ` (<code${attr}>unset</code>)`;
        } else {
            html += ` (${_valueChip(a.value, acls)})`;
        }
    }
    return html;
}

// Separator between items in a rendered operand list. A bullet (not a comma) so
// friendly names that themselves contain commas (e.g. cosmetics "Columns,
// Jeweled", some rooms / enemies) stay unambiguous - the comma is part of a name,
// the bullet divides items.
const _OPERAND_SEP = ' \u2022 ';

function _renderOperandList(items) {
    if (!Array.isArray(items)) {
        return _renderListItemHtml(items);
    }
    return items.map(_renderListItemHtml).join(_OPERAND_SEP);
}

// Run/room aggregation + misc decorators that can wrap any Path record.
// Marks recognised keys in ``consumed`` and returns a trailing modifier
// clause (empty when none apply). ``HintId`` is metadata surfaced only
// in the raw tooltip, so it is consumed without adding visible text.
function _pathDecoratorSuffix(rec, consumed) {
    const mods = [];
    if ('SumPrevRuns' in rec) {
        consumed.add('SumPrevRuns');
        mods.push(`over the last ${escapeHtml(_formatScalar(rec.SumPrevRuns))} runs`);
    }
    if ('SumPrevRooms' in rec) {
        consumed.add('SumPrevRooms');
        mods.push(`over the last ${escapeHtml(_formatScalar(rec.SumPrevRooms))} rooms`);
    }
    if ('IgnoreCurrentRun' in rec) {
        consumed.add('IgnoreCurrentRun');
        if (rec.IgnoreCurrentRun) mods.push('excluding the current run');
    }
    if ('PathFromSource' in rec) {
        consumed.add('PathFromSource');
        if (rec.PathFromSource) mods.push('from source');
    }
    if ('HintId' in rec) {
        consumed.add('HintId');
    }
    return mods.length ? ` <span class="other-req-mod">(${mods.join(', ')})</span>` : '';
}

// Right-hand value of a Comparison record: a literal ``Value``, or a
// ``ValuePath`` (value read from another path) with an optional signed
// ``ValuePathAddition``. Marks the keys it uses in ``consumed``; returns
// null when no value source is present.
function _renderComparisonValue(rec, consumed) {
    if ('Value' in rec) {
        consumed.add('Value');
        return _valueChip(rec.Value);
    }
    if ('ValuePath' in rec) {
        consumed.add('ValuePath');
        let html = `<code class="other-req-path">${escapeHtml(_pathToString(rec.ValuePath))}</code>`;
        if ('ValuePathAddition' in rec) {
            consumed.add('ValuePathAddition');
            const add = rec.ValuePathAddition;
            if (typeof add === 'number' && add < 0) {
                html += ` - <code>${escapeHtml(_formatScalar(-add))}</code>`;
            } else {
                html += ` + <code>${escapeHtml(_formatScalar(add))}</code>`;
            }
        }
        return html;
    }
    return null;
}

// Friendly rendering of a Comparison record: an optional aggregation of
// the path value (CountOf / TableValuesToCount / ValuesToCount counted
// against a threshold; SumOf / UseLength / CountPathTrue reshaped into a
// numeric subject) compared against a value, plus run/room decorators.
// Returns null (caller falls back to raw JSON) if any key is unhandled.
function _renderComparisonRecord(head, headHtml, rec, keys) {
    const consumed = new Set(['Comparison', 'Path']);
    const valueHtml = _renderComparisonValue(rec, consumed);
    if (valueHtml === null) return null;
    const suffix = _pathDecoratorSuffix(rec, consumed);

    // "Count how many of these items occur" aggregations read most
    // naturally as ``<head> has at least N of: items``.
    for (const ck of _PATH_COUNT_ITEMS_KEYS) {
        if (ck in rec) {
            consumed.add(ck);
            // CountPathTrue co-occurs with a table-values count to mean
            // "count the truthy entries among these items"; the count
            // phrasing already conveys that, so consume it here.
            if ('CountPathTrue' in rec) consumed.add('CountPathTrue');
            const phrase = _COUNT_OP_PHRASING[rec.Comparison];
            if (!phrase || !_allConsumed(keys, consumed)) return null;
            return `${headHtml} ${phrase} ${valueHtml} of: ${_renderOperandList(rec[ck])}${_renderAggregateHtml()}${suffix}`;
        }
    }

    // Aggregations that reshape the path value into a numeric subject.
    let subjectHtml = headHtml;
    if ('UseLength' in rec) {
        consumed.add('UseLength');
        subjectHtml = `Number of entries in ${headHtml}`;
    } else if ('CountPathTrue' in rec) {
        consumed.add('CountPathTrue');
        subjectHtml = `Number of true entries in ${headHtml}`;
    } else if ('SumOf' in rec) {
        consumed.add('SumOf');
        subjectHtml = `Sum of ${_renderOperandList(rec.SumOf)} in ${headHtml}`;
    }

    if (!_allConsumed(keys, consumed)) return null;
    return `${subjectHtml}${_renderScalarHaveHtml()} ${escapeHtml(String(rec.Comparison))} ${valueHtml}${suffix}`;
}

function _renderPathRecord(head, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    const keys = new Set(Object.keys(rec));
    const headHtml = _renderPathTailHtml(head);

    // Set-/value-membership predicates carry only the operand list plus
    // optional decorators.
    for (const [op, verb] of Object.entries(_PATH_RECORD_MEMBERSHIP_VERBS)) {
        if (op in rec) {
            const consumed = new Set([op, 'Path']);
            const suffix = _pathDecoratorSuffix(rec, consumed);
            if (!_allConsumed(keys, consumed)) return null;
            return `${headHtml} ${verb}: ${_renderOperandList(rec[op])}${suffix}`;
        }
    }

    if ('Comparison' in rec) {
        return _renderComparisonRecord(head, headHtml, rec, keys);
    }
    return null;
}

// Friendly rendering of a single ``FunctionName`` requirement record. Each H2
// custom-function gate (``RequiredAlive``, ``RequiredHealthFraction``, ...) is
// turned into a plain-English clause; entity arguments (enemy Units, boon Name,
// room Names, incantation HasAny) resolve through ``_valueChip`` /
// ``_renderOperandList``. Unknown functions fall back to a readable signature.
const _FN_CMP_WORDS = {
    '<=': 'at most', '<': 'below', '>=': 'at least', '>': 'over',
    '==': 'exactly', '~=': 'not', '!=': 'not',
};
const _FN_QUEST_STATUS = {
    CashedOut: 'cashed-out', Assigned: 'active', Complete: 'completed',
    Completed: 'completed', Available: 'available',
};

// Subject of a RequiredAlive gate: named Units resolve to friendly names;
// numeric runtime Ids are shown as-is (they identify a specific spawned unit).
function _fnAliveSubject(a) {
    if (Array.isArray(a.Units) && a.Units.length) return _renderOperandList(a.Units);
    if (Array.isArray(a.Ids) && a.Ids.length) {
        const ids = a.Ids.map(id => `<code class="other-req-path">${escapeHtml(String(id))}</code>`).join(', ');
        return `${a.Ids.length > 1 ? 'units' : 'unit'} ${ids}`;
    }
    return 'the target';
}

// Room operand(s) for the consecutive-clear / death gates (a Names list or a
// single Name). The Names are alternative room ids that count as the same room
// (e.g. a boss room's normal + Vow-of-Rivals variants), so a multi-entry list
// reads as "any of" to make the OR explicit. Rooms resolve to friendly names.
function _fnRooms(a) {
    if (Array.isArray(a.Names) && a.Names.length) {
        const list = _renderOperandList(a.Names);
        return a.Names.length > 1 ? `any of: ${list}` : list;
    }
    if (a.Name != null) return _valueChip(a.Name);
    return 'a room';
}

// A ``<ref:GameData.X>`` operand renders as the bare table id; a literal list
// renders as friendly operand chips.
function _fnRefOrList(v) {
    const ref = _strRefName(v);
    if (ref !== null) return `<code class="other-req-path">${escapeHtml(ref)}</code>`;
    return _renderOperandList(v);
}

const _FN_RENDERERS = {
    RequiredAlive(a) {
        return `${_fnAliveSubject(a)} must be ${a.Alive === false ? 'dead' : 'alive'}`;
    },
    IsBossDifficultyShrineUpgradeActive() {
        return 'Vow of Rivals is active (boss fought in its unrivalled form)';
    },
    RequiredHealthFraction(a) {
        const pct = Math.round((Number(a.Value) || 0) * 100);
        const w = _FN_CMP_WORDS[a.Comparison] || escapeHtml(String(a.Comparison));
        return `Player health ${w} ${pct}%`;
    },
    RequiredTraitNameInRoom(a) {
        return `This room offers the boon ${_valueChip(a.Name)}`;
    },
    RequireRunsSinceTextLines(a) {
        const n = Number(a.Min);
        return `At least ${escapeHtml(String(a.Min))} run${n === 1 ? '' : 's'} since: ${_fnRefOrList(a.TextLines)}`;
    },
    RequiredRarityInRoom(a) {
        const parts = [];
        if (a.HasAtLeastRarity) parts.push(`at least one ${escapeHtml(String(a.HasAtLeastRarity))}+ boon`);
        if (a.AllAtLeastRarity) parts.push(`all boons at least ${escapeHtml(String(a.AllAtLeastRarity))}`);
        return parts.length ? `This room has ${parts.join(', ')}` : null;
    },
    RequiredConsecutiveClearsOfRoom(a) {
        const n = Number(a.Count);
        return `Cleared ${_fnRooms(a)} ${escapeHtml(String(a.Count))} time${n === 1 ? '' : 's'} in a row`;
    },
    RequiredSellableGodTraits() {
        return 'Player has god boons that can be sold';
    },
    RequireQuestCount(a) {
        const st = _FN_QUEST_STATUS[a.Status] || escapeHtml(String(a.Status));
        let range;
        if (a.Min != null && a.Max != null) range = `between ${escapeHtml(String(a.Min))} and ${escapeHtml(String(a.Max))}`;
        else if (a.Min != null) range = `at least ${escapeHtml(String(a.Min))}`;
        else if (a.Max != null) range = `at most ${escapeHtml(String(a.Max))}`;
        else range = 'some';
        return `Has ${range} ${st} quest(s)`;
    },
    RequiredConsecutiveDeathsInRoom(a) {
        const n = Number(a.Count);
        return `Died in ${_fnRooms(a)} ${escapeHtml(String(a.Count))} time${n === 1 ? '' : 's'} in a row`;
    },
    RequireUnrestrictedBoonChoices() {
        return 'Boon choices are unrestricted';
    },
    RequiredBossPhase(a) {
        return `Boss is in phase ${escapeHtml(String(a.Phase))}`;
    },
    RequireAffordableGhostAdminItems(a) {
        const items = Array.isArray(a.HasAny) && a.HasAny.length ? _renderOperandList(a.HasAny) : 'a Cauldron item';
        return `Can afford a Cauldron item: ${items}`;
    },
    RequiredQueuedTextLine(a) {
        return `No dialogue queued from: ${_fnRefOrList(a.IsNone)}`;
    },
};

function _renderFunctionRecord(fnName, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    if (rec.FunctionName !== fnName) return null;
    for (const k of Object.keys(rec)) {
        if (k !== 'FunctionName' && k !== 'FunctionArgs') return null;
    }
    const rawArgs = rec.FunctionArgs;
    if (rawArgs !== undefined && (typeof rawArgs !== 'object' || Array.isArray(rawArgs))) return null;
    const args = rawArgs || {};
    const renderer = _FN_RENDERERS[fnName];
    if (renderer) {
        const html = renderer(args);
        if (html) return `<span class="other-req-func-gate">${html}</span>`;
    }
    // Fallback for any unmapped function: a readable signature.
    const argsText = Object.entries(args).map(([k, v]) => `${k}=${_formatScalar(v)}`).join(', ');
    return `Function call to <code class="other-req-func">${escapeHtml(`${fnName}(${argsText})`)}</code> must evaluate to <code class="other-req-func">true</code>`;
}

// Render one of the four "just the path" operator prefixes
// (PathTrue / PathFalse / PathEmpty / PathNotEmpty). Each record carries
// the operator key (the path lives in the synthetic head) plus optional
// decorators (HintId / PathFromSource / SumPrevRuns / ...); multiple
// records (duplicates from the extractor) repeat the friendly key joined
// by ``AND``. Returns ``null`` for any unexpected shape so the caller
// falls back to raw JSON.
function _renderPathOpEntry(opKey, key, val) {
    if (!Array.isArray(val) || val.length === 0) return null;
    const friendlyKey = renderOtherReqKeyHtml(key);
    const parts = [];
    for (const rec of val) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
        if (!(opKey in rec)) return null;
        const consumed = new Set([opKey]);
        const suffix = _pathDecoratorSuffix(rec, consumed);
        if (!_allConsumed(new Set(Object.keys(rec)), consumed)) return null;
        parts.push(`${friendlyKey}${suffix}`);
    }
    return parts.join(' <span class="other-req-and">AND</span> ');
}

// Compact friendly summary of a bare-key value. Works for any bare
// key, including ones without a ``reqTypeLabels`` entry - the caller
// drives the label rendering separately.
function _renderBareKeyValueHtml(val, key) {
    if (val === null || val === undefined) return escapeHtml(String(val));
    if (Array.isArray(val)) {
        if (val.length === 0) return '<code>(empty)</code>';
        return val.map(_renderListItemHtml).join(_OPERAND_SEP);
    }
    if (typeof val === 'object') {
        const kind = _reqGateKind(key);
        const op = _GATE_OP_SYMBOL[kind];
        const objKeys = Object.keys(val);
        // ``{Count}`` only -> just the count (the label carries the min/max sense).
        if (objKeys.length === 1 && objKeys[0] === 'Count') {
            return `<code>${escapeHtml(_formatScalar(val.Count))}</code>`;
        }
        // ``{Name, Count}`` threshold pair -> ``Name op Count``.
        if (objKeys.length === 2 && 'Count' in val && 'Name' in val) {
            return `${_valueChip(val.Name)} ${op} <code>${escapeHtml(_formatScalar(val.Count))}</code>`;
        }
        // Codex entry ``{EntryName, EntryIndex}`` -> the entry name plus how far
        // it must be unlocked. EntryIndex is a cumulative threshold: the gate
        // requires the first N entries of that codex subject to be unlocked
        // (HasCodexEntryBeenFound checks indices 1..N), so it conveys "how much
        // about this subject the player has revealed", not a positional id.
        if ('EntryName' in val) {
            const idx = Number(val.EntryIndex) || 1;
            const name = _valueChip(val.EntryName);
            const detail = idx === 1 ? 'first entry' : `first <code>${idx}</code> entries`;
            return `${name} (${detail})`;
        }
        // "N of a set" gates: one array-valued key plus a ``Count`` (e.g.
        // RequiredMinAnyCosmetics ``{Cosmetics: [...], Count}``,
        // RequiredConsumablesThisRun ``{Names: [...], Count}``) -> ``<at least|at
        // most> N of: items`` rather than dumping the array against an operator.
        const listKey = objKeys.find(k => Array.isArray(val[k]));
        if (listKey && 'Count' in val && objKeys.length === 2) {
            return `${_GATE_OF_PHRASE[kind]} <code>${escapeHtml(_formatScalar(val.Count))}</code> of: ${_renderOperandList(val[listKey])}${_renderAggregateHtml()}`;
        }
        // Scalar value map -> ``key op value`` per entry. The key is the
        // subject (often an entity id, e.g. ``RequiredMinNPCInteractions:
        // {NPC_Achilles_01: 1}``), so resolve it through ``entityNames`` too.
        // ``_renderListItemHtml`` carries any operand colour + "(N)" save tally
        // for the "Name op Count" numeric gates; the right-hand value is the
        // gate's threshold, so it stays a plain chip.
        // ``op`` reflects the gate's real comparison: ``=`` for RequiredValues
        // (must equal), ``!=`` for RequiredFalseValues, ``<=`` for max
        // thresholds, ``>=`` otherwise.
        return Object.entries(val)
            .map(([k, v]) => `${_renderListItemHtml(k)} ${op} ${_valueChip(v)}`)
            .join(_OPERAND_SEP);
    }
    // Plain scalar threshold (number / string / boolean). For the single-scalar
    // numeric gates the loaded save resolves a value, appended as a coloured
    // "(X)" tally beside the threshold; other scalars render the value alone.
    return _valueChip(val) + _renderScalarHaveHtml();
}

// Comparison sense of a bare-key gate, derived from the requirement key:
//   'eq'  - RequiredValues: the field must EQUAL the value.
//   'neq' - RequiredFalseValues: the field must NOT equal the value.
//   'max' - a "Max" threshold: the value must be AT MOST the target.
//   'min' - everything else: an "at least" threshold.
// Without this, equality / negation / max gates render with ">=", stating the
// opposite of what they check (e.g. RequiredFalseValues "must NOT equal X"
// rendered as "field >= X", or RequiredLifetimeResourcesSpentMax as "Gems >= N").
// "Max" is matched only as a word (followed by an uppercase letter or the end
// of the key) so "...Min..." keys and unrelated substrings never trip it.
function _reqGateKind(key) {
    if (key === 'RequiredFalseValues') return 'neq';
    if (key === 'RequiredValues') return 'eq';
    if (/Max([A-Z]|$)/.test(key)) return 'max';
    return 'min';
}

// Operator symbol shown between a gate's field/name and its value, per kind.
const _GATE_OP_SYMBOL = { min: '&gt;=', max: '&lt;=', eq: '=', neq: '&ne;' };
// Quantifier phrase for the "N of a set" gates, per kind.
const _GATE_OF_PHRASE = { min: 'at least', max: 'at most', eq: 'exactly', neq: 'not exactly' };

// Format a bare-key entry as ``Label: summary``. Labelled keys
// surface the friendly pill via ``renderReqTypeHtml``; unlabelled keys
// (e.g. ``RequiredKills``, ``RequiredMinNPCInteractions``) still get
// the same outer shape with the raw key name, so list values render
// with comma+space spacing and map values use the ``Name >= Count``
// idiom rather than the raw JSON fallback.
function _renderBareKeyEntry(key, val) {
    return `${renderReqTypeHtml(key)}: ${_renderBareKeyValueHtml(val, key)}`;
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
// Shared retired-line banner (`Skip = true`). Rendered identically in the
// detail panel and the eligibility tracer so the two views match. `replacement`
// is the superseding textline name, or falsy when none is known.
export function renderRetiredBannerHtml(replacement) {
    const repl = replacement
        ? ` Superseded by <a class="blocked-ref" onclick="navigateTo(${jsAttr(replacement)})">${escapeHtml(replacement)}</a>.`
        : '';
    return `<div class="meta blocked-banner">`
        + `<div class="blocked-banner-header"><span class="status-symbol">\u2298</span> Retired dialogue - can never play</div>`
        + `<div class="blocked-banner-list">This line is flagged <code>Skip</code> in the game data, so the engine permanently skips it.${repl}</div>`
        + `</div>`;
}

export function renderOtherReqEntryHtml(key, val) {
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
        for (let i = 0; i < val.length; i++) {
            _setRecordMarks(i);
            const formatted = _renderPathRecord(head, val[i]);
            if (formatted === null) {
                parts.length = 0;
                break;
            }
            parts.push(formatted);
        }
        _setFlatMarks();
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
    return ` <a class="cross-game-badge cross-game-${otherGame}" data-tooltip="Also exists in ${escapeHtml(otherLabel)} - click to navigate" `
        + `onclick="event.stopPropagation(); navigateToState({game:${jsAttr(otherGame)}, view:'dialogue', dialogue:${jsAttr(name)}})">`
        + `\u21C4 ${escapeHtml(otherLabel)}</a>`;
}

function renderSaveProgressPillHtml(name, tl) {
    if (!getSaveProgress() || !saveMatchesActiveGame()) return '';
    const status = getDialogueStatus(name, tl);
    if (!status) return '';
    const labels = {
        played: '\u2714 Played',
        eligible: '\u25CB Eligible',
        blocked: '\u2022 Blocked',
        indeterminate: '? Indeterminate',
        unobtainable: '<span class="status-symbol">\u2298</span> Unobtainable',
    };
    const label = labels[status] || status;
    // Every status opens the eligibility tracer for this dialogue: blocked
    // shows what's still missing, eligible/played show the satisfied chain.
    const tip = `${saveStatusTooltip(status)}. Click to open the eligibility tracer`;
    return ` <a class="save-progress-pill ${status} clickable" onclick="navigateToEligibility(${jsAttr(name)})" data-tooltip="${escapeHtml(tip)}">${label}</a>`;
}

// Prominent, labelled entry point to the eligibility tracer for this
// dialogue. The header save-progress pill is also a shortcut, but a
// dedicated button is more discoverable for users who don't realise the
// status badge is clickable. Save-gated like the pill - the tracer only
// has meaning once a matching save is loaded.
function renderTraceEligibilityButtonHtml(name, tl) {
    if (!getSaveProgress() || !saveMatchesActiveGame()) return '';
    if (!getDialogueStatus(name, tl)) return '';
    return `<div class="trace-eligibility-row">`
        + `<a class="trace-eligibility-btn" data-tooltip="Open the eligibility tracer to see what this dialogue still needs to play, based on your loaded save" onclick="navigateToEligibility(${jsAttr(name)})">`
        + `Trace eligibility</a></div>`;
}

function renderAlternatesHtml(name) {
    const siblings = alternates[name];
    if (!siblings || siblings.length === 0) return '';

    let html = `<div class="alternates-section">`;
    html += `<h4 class="alternates-header">Alternates / Mutually exclusive</h4>`;
    html += `<div class="alternates-hint">Only one of these variants can trigger; the others are permanently blocked once one plays.</div>`;
    html += `<div class="alternates-list">`;

    // The open dialogue leads the list, flagged as the current variant so it
    // reads in context against its siblings rather than being absent from a
    // list it belongs to. Not a link - it's already on screen.
    const currentBadge = renderSaveBadgeHtml(name, textlines[name]);
    html += `<div class="alternates-item alternates-item-current">`;
    if (currentBadge) html += currentBadge;
    html += `<span class="alternates-name">${escapeHtml(name)}</span>`;
    html += `<span class="alternates-current-tag">current</span>`;
    html += `</div>`;

    for (const sibling of siblings) {
        const tl = textlines[sibling];
        const badge = renderSaveBadgeHtml(sibling, tl);
        html += `<a class="alternates-item" onclick="navigateTo(${jsAttr(sibling)})">`;
        if (badge) html += badge;
        html += `<span class="alternates-name">${escapeHtml(sibling)}</span>`;
        html += `</a>`;
    }

    html += `</div></div>`;
    return html;
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
        <h3><span class="h3-main"><span class="name">${escapeHtml(name)}</span>${renderCollisionBadgeHtml(tl)}${renderCrossGameBadgeHtml(name)}</span><span class="h3-indicators">${renderSaveProgressPillHtml(name, tl)}${renderPriorityBadgeHtml(tl)}${renderPlayOnceBadgeHtml(tl)}</span></h3>
        <div class="meta">
            <span>Owner: ${renderSpeakerHtml(tl.owner)}</span>
            ${tl.partner ? `<span>Partner: ${renderSpeakerHtml(tl.partner)}</span>` : ''}
            <span>Type: ${renderSectionHtml(tl.section)}</span>
        </div>`;

    // Prominent eligibility-tracer entry button (save-gated). Placed high
    // in the panel so it's the obvious way to ask "why is this blocked?".
    html += renderTraceEligibilityButtonHtml(name, tl);

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

    // Retired banner: `Skip = true` in the game data permanently disables
    // this line (the engine rejects it before any eligibility check). Shown
    // regardless of save state; links to the replacement when known. Shares
    // markup with the eligibility tracer via renderRetiredBannerHtml so the
    // two views look identical.
    if (tl.skip) {
        html += renderRetiredBannerHtml(tl.skipReplacement);
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

    html += renderAlternatesHtml(name);

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
    const reqOptions = {
        textlineName,
        sourcesByType: src.requirementSources || {},
        // The base requirements block uses sectioned ``<h4>`` headers
        // per requirement type with a final "Other Requirements"
        // section header. OR-branch and NamedRequirements payloads
        // reuse the shared helper with ``otherHeaderLabel: null`` to
        // suppress that header (the surrounding header already
        // provides scope context).
        otherHeaderLabel: 'Other Requirements',
    };

    // Base AND requirements - the gates that MUST always hold.
    // All requirement blocks (base AND sections, OR branches, and the
    // "Other Requirements" catch-all) are wrapped in a single container so
    // the onboarding tour can highlight them together rather than just the
    // first block.
    let reqHtml = renderBaseRequirementsHtml(requirements, otherRequirements, reqOptions);

    // H2 alternative requirement groups (set-level ``OrRequirements``
    // on the source RequirementSet). Each branch is itself a set of
    // requirements + otherRequirements that, taken together, satisfies
    // the group; the group as a whole satisfies the parent textline if
    // ANY one branch passes. Rendered between the base AND block and
    // the Other Requirements section below so the reader sees the
    // must-always-hold gates first, then the any-one-suffices options.
    reqHtml += renderOrBranchesSectionHtml(src.orBranches, textlineName);

    // The "Other Requirements" catch-all always renders last so it
    // stays pinned to the bottom of the detail view, beneath any OR
    // branches.
    reqHtml += renderOtherRequirementsSectionHtml(requirements, otherRequirements, reqOptions);

    if (reqHtml) html += `<div class="requirements-group">${reqHtml}</div>`;

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
    const showDots = _saveDotsActive();
    const ctx = showDots ? getSaveContext() : null;
    // Overall "alternates" verdict: met if any option's requirements hold.
    let groupDot = '';
    if (showDots) {
        const gv = orGroupVerdict(branches, ctx, textlineName);
        groupDot = statusDot(gv, groupStatusTooltip(gv));
    }
    let html = `<div class="req-section req-type-or-group">`
             + `<h4><span class="toggle">\u25BC</span>${groupDot}${escapeHtml(groupLabel)}</h4>`
             + `<div class="req-section-children expanded">`;
    for (let bi = 0; bi < branches.length; bi++) {
        const branch = branches[bi] || {};
        // Per-option verdict: this branch's combined requirement + GameState dot.
        let branchDot = '';
        if (showDots) {
            const bv = orBranchVerdict(branch, ctx, textlineName);
            branchDot = statusDot(bv, groupStatusTooltip(bv));
        }
        html += `<div class="or-branch">`
              + `<h5 class="or-branch-header"><span class="toggle">\u25BC</span>`
              + `${branchDot}Option ${bi + 1} of ${total}</h5>`
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
export function renderNamedReqExpansionsHtml(key, names, hostTextlineName) {
    if (!Array.isArray(names) || names.length === 0) return null;
    const suffix = _NAMED_REQ_SEMANTIC_SUFFIX[key] || '';
    // Per-name + group dots reflect whether each named requirement is eligible
    // as a whole (textline records + GameState gates + OR branches), in the
    // host's run context. For NamedRequirementsFalse the status is the host's
    // gate contribution (inverted), so it reads the same way as the group dot.
    const showDots = _saveDotsActive();
    const sctx = showDots ? getSaveContext() : null;
    const hostOwner = (hostTextlineName && textlines[hostTextlineName])
        ? textlines[hostTextlineName].owner : undefined;
    let groupDot = '';
    if (showDots) {
        const g = namedRequirementGroupVerdict(key, names, sctx, hostOwner);
        groupDot = statusDot(g, groupStatusTooltip(g));
    }
    let html = `<div class="other-req-item named-req-item">`
             + `<div class="named-req-label">${groupDot}${renderOtherReqKeyHtml(key)}:</div>`
             + `<div class="named-req-list">`;
    for (const name of names) {
        const resolved = namedRequirements ? namedRequirements[name] : null;
        const safeName = escapeHtml(name);
        const safeSuffix = suffix ? ` <span class="named-req-suffix">(${escapeHtml(suffix)})</span>` : '';
        let nameDot = '';
        if (showDots) {
            const s = namedRequirementHostVerdict(key, name, sctx, hostOwner);
            nameDot = statusDot(s, groupStatusTooltip(s));
        }
        if (_namedReqIsEmpty(resolved)) {
            html += `<div class="named-req-flat">`
                  + `${nameDot}<code class="named-req-name">${safeName}</code>${safeSuffix}`
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
              + `${nameDot}<code class="named-req-name">${safeName}</code>${safeSuffix}`
              + `</h5>`
              + `<div class="named-req-children expanded">${inner}</div>`
              + `</div>`;
    }
    html += `</div></div>`;
    return html;
}


// Render the requirements + otherRequirements blocks for one set of
// requirement data - the textline's base AND set, a single OR branch,
// or a resolved NamedRequirements chain - by concatenating the base
// AND sections with the "Other Requirements" section. The top-level
// detail view calls the two halves separately (with the OR-branches
// section rendered between them, so Other Requirements always stays
// pinned to the bottom); the OR-branch and NamedRequirements call
// sites want the two halves adjacent and use this combined wrapper.
function renderRequirementsAndOtherHtml(requirements, otherRequirements, options) {
    return renderBaseRequirementsHtml(requirements, otherRequirements, options)
         + renderOtherRequirementsSectionHtml(requirements, otherRequirements, options);
}


// Render only the base AND requirement sections, sorted by the
// canonical per-game display order. ``otherRequirements`` is still
// consulted so a Count-based field's threshold can be surfaced inline
// with the matching requirement-section header. Reused verbatim by the
// OR-branch and NamedRequirements call sites for identical markup.
function renderBaseRequirementsHtml(requirements, otherRequirements, options) {
    const { textlineName, sourcesByType } = options;
    let html = '';
    const showDots = _saveDotsActive();
    const ctx = showDots ? getSaveContext() : null;

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
        // Group verdict dot (met / unmet / indeterminate / unobtainable),
        // shared with the dependency tree's group dots.
        let groupDot = '';
        if (showDots) {
            const cnt = (meta && typeof meta === 'object' && 'Count' in meta) ? meta.Count : 1;
            const v = requirementGroupVerdict(type, refs, ctx, cnt, textlineName);
            groupDot = statusDot(v, groupStatusTooltip(v));
        }
        html += `<div class="req-section req-type-${type}">`
              + `<h4><span class="toggle">\u25BC</span>${groupDot}${renderReqTypeHtml(type)}${countSuffix}</h4>`
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

    return html;
}


// Render only the "Other Requirements" section - the catch-all gates
// that aren't textline requirements (operators, Path/FunctionName
// keys, NamedRequirements* expansions). Returns an empty string when
// there are none, or when every entry was a Count-meta key already
// surfaced inline with its requirement-section header. ``otherHeaderLabel``
// set wraps the items in a labelled ``<h4>`` section (the base/host
// call site); null inlines them bare (OR-branch and NamedRequirements
// expansion call sites, where the surrounding header already provides
// scope).
export function renderOtherRequirementsSectionHtml(requirements, otherRequirements, options) {
    const { textlineName, otherHeaderLabel } = options;
    if (Object.keys(otherRequirements).length === 0) return '';

    // With a matching save loaded, evaluate each non-textline gate against the
    // persisted GameState slice and prefix it with a met / unmet / indeterminate
    // dot (same colour language as the dependency tree + tracer). ``dotFor``
    // returns '' when there's no save or the key isn't an evaluable gate.
    const showDots = !!(getSaveProgress() && saveMatchesActiveGame());
    let overallVerdict = null;
    let gateByKey = null;
    let operandMarksByKey = null;
    if (showDots) {
        const sctx = getSaveContext();
        const owner = (textlineName && textlines[textlineName]) ? textlines[textlineName].owner : undefined;
        const gameId = getActiveGame();
        const slices = buildOtherReqSlices(sctx, owner, gameId);
        const res = evaluateOtherRequirements(otherRequirements, sctx.gameState, slices, gameId);
        gateByKey = new Map(res.clauses.map(c => [c.key, c]));
        // Which individual operands of each set/membership gate the save already
        // satisfies, so the list items can be highlighted as the entry renders.
        operandMarksByKey = new Map();
        for (const [key, val] of Object.entries(otherRequirements)) {
            const marks = computeOperandMarks(key, val, sctx, slices, gameId);
            if (marks) operandMarksByKey.set(key, marks);
        }
        // Named requirement gates resolve GameState-only in
        // evaluateOtherRequirements (it can't read textline records). Re-
        // evaluate them as full requirement sets so the dot - and the section
        // verdict - reflect whether the named requirement is eligible as a whole.
        for (const [key, c] of gateByKey) {
            if (key.startsWith('NamedRequirements')) {
                c.status = namedRequirementGroupVerdict(key, otherRequirements[key], sctx, owner);
                if (c.status !== 'unknown') c.reason = null;
            } else if (c.status === 'unmet'
                && gateClausePermanentlyUnmet(key, otherRequirements, sctx.gameState, gameId)) {
                // A gate over monotonic save progress already past what it allows
                // can never recover (its counter only grows, or the forbidden
                // event is on record for good) -> permanently locked, not just
                // unmet.
                c.status = 'unobtainable';
                c.reason = null;
            }
        }
        const _statuses = [...gateByKey.values()].map(c => c.status);
        overallVerdict = _statuses.includes('unobtainable') ? 'unobtainable'
            : _statuses.includes('unmet') ? 'unmet'
                : _statuses.includes('unknown') ? 'unknown' : 'met';
    }
    const dotFor = (key) => {
        const c = gateByKey && gateByKey.get(key);
        if (!c) return '';
        const tip = c.status === 'met' ? 'Satisfied by your save.'
            : c.status === 'unmet' ? 'Not satisfied by your save.'
                : c.status === 'unobtainable' ? 'Permanently locked: this reads save progress that only ever advances, and your save has already passed what this gate allows - so it can never be satisfied again.'
                    : (c.reason || 'Can\u2019t be determined from the save.');
        return `<span class="group-status group-status-${c.status}" data-tooltip="${escapeHtml(tip)}"></span> `;
    };

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
        _operandMarks = operandMarksByKey ? (operandMarksByKey.get(key) || null) : null;
        _setFlatMarks();
        otherHtml += `<div class="other-req-item"${tipAttr}>${dotFor(key)}<span class="other-req-text">${renderOtherReqEntryHtml(key, val)}</span></div>`;
        setOperandMarks(null);
    }

    if (!otherHtml) return '';
    if (otherHeaderLabel) {
        const headerDot = showDots ? statusDot(overallVerdict, groupStatusTooltip(overallVerdict)) : '';
        return `<div class="req-section req-type-other">`
              + `<h4><span class="toggle">\u25BC</span>${headerDot}${escapeHtml(otherHeaderLabel)}</h4>`
              + `<div class="req-section-children expanded">${otherHtml}</div>`
              + `</div>`;
    }
    // Compact (OR-branch) mode: inline the items directly under the
    // surrounding branch header without an extra section wrapper.
    return otherHtml;
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
