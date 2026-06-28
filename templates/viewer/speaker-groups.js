// Speaker grouping for the speaker overview view.
//
// The Python aggregator emits one ``speakers`` entry per internal id
// (``NPC_Hermes_01``, ``HermesUpgrade``, etc). For the user-facing
// speaker view we collapse entries whose friendly ``name`` is the
// same (e.g. ``HermesUpgrade`` / ``HermesUpgradeRare`` /
// ``NPC_Hermes_01`` all carry the friendly label ``"Hermes"``) into
// a single canonical entry whose stats are merged across siblings.
//
// Disambiguator suffixes are preserved because they are part of the
// friendly name itself: ``"Hecate"`` and ``"Hecate (Boss)"`` are
// distinct labels and stay in separate groups, as do
// ``"Zagreus"`` / ``"Zagreus (Boss)"``, ``"Orpheus"`` /
// ``"Orpheus (Field)"``, and similar.
//
// This collapse is DISPLAY-ONLY: the underlying ``textlines`` map
// keeps its single-owner-id-per-textline shape unchanged, so search,
// graph traversal, dialogue rendering, and every other module that
// resolves a textline owner still see the original ids.
//
// Empty / missing friendly names never group - each such speaker
// stays a singleton (collapsing every nameless ``*Upgrade`` entry
// into one bucket would lose information rather than gain it).
//
// Canonical id within a group is the alphabetically first member id.
// Stable across rebuilds, deterministic from the dataset alone.

import { speakers, textlines, dependents } from './data.js';

// Built lazily on first access and reset on game switch via
// ``resetSpeakerGroups``. Each per-game build is O(speakers) plus
// the adjacency re-derive (O(ownedTextlines * avg_reqs)) per
// multi-member group; both are tiny in practice.
let _idToCanonical = null;          // {memberId -> canonicalId}
let _canonicalToMembers = null;     // {canonicalId -> [memberId, ...]}
let _nameToCanonical = null;        // {friendlyName -> canonicalId}
let _groupEntryCache = null;        // {canonicalId -> aggregated entry}

// Clear the per-game caches. Called by ``navigation.js`` on game
// switch (alongside ``buildSpeakerIndex``) so the next access
// rebuilds against the new active game's speakers map.
export function resetSpeakerGroups() {
    _idToCanonical = null;
    _canonicalToMembers = null;
    _nameToCanonical = null;
    _groupEntryCache = null;
}

function _ensureGroups() {
    if (_idToCanonical && _canonicalToMembers) return;
    _idToCanonical = {};
    _canonicalToMembers = {};
    _nameToCanonical = {};
    _groupEntryCache = {};

    // Bucket ids by trimmed friendly name. Empty / missing names go
    // straight into singletons so the * Upgrade speakers (which
    // share an empty friendly label across both games) stay
    // distinct.
    const byName = new Map();
    for (const sid of Object.keys(speakers)) {
        const entry = speakers[sid] || {};
        const name = (entry.name || '').trim();
        if (!name) {
            _idToCanonical[sid] = sid;
            _canonicalToMembers[sid] = [sid];
            continue;
        }
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(sid);
    }

    for (const [name, members] of byName) {
        members.sort();
        const canonical = members[0];
        _canonicalToMembers[canonical] = members;
        _nameToCanonical[name] = canonical;
        for (const mid of members) {
            _idToCanonical[mid] = canonical;
        }
    }
}

// Returns the canonical id for a member id (the id itself if the
// speaker isn't in any group, e.g. for unknown ids surfaced by an
// out-of-date URL). Safe to call for any string; non-speaker ids
// pass through unchanged.
export function canonicalSpeakerId(speakerId) {
    if (!speakerId) return speakerId;
    _ensureGroups();
    return _idToCanonical[speakerId] || speakerId;
}

// Resolve a friendly speaker name (as carried in the URL hash) to its
// group's canonical id within the active game, or ``null`` when no
// speaker carries that name. Friendly names are unique per game - the
// speaker overview buckets every id by friendly name - so the mapping
// is unambiguous. This is the inverse of writing ``speakers[canonical].name``
// into the hash: ``navigation.js`` stores the readable name in the URL and
// resolves it back to the canonical id here when rendering.
export function canonicalIdForSpeakerName(name) {
    if (!name) return null;
    _ensureGroups();
    return _nameToCanonical[name] || null;
}

// Returns the sorted list of member ids in the same group as
// ``speakerId``. Single-member groups return ``[speakerId]``.
export function speakerGroupMembers(speakerId) {
    if (!speakerId) return [];
    _ensureGroups();
    const canon = _idToCanonical[speakerId] || speakerId;
    return (_canonicalToMembers[canon] || [canon]).slice();
}

// Returns the list of all canonical ids in the active game, sorted
// alphabetically. Used by the speaker search index so only one
// dropdown entry shows per group.
export function listCanonicalSpeakerIds() {
    _ensureGroups();
    return Object.keys(_canonicalToMembers).sort();
}

// The "character key" of a friendly name: the base name with a trailing
// ``(disambiguator)`` suffix removed (``"Chronos (Boss)"`` ->
// ``"Chronos"``). Speakers that share a character key are different
// in-game versions of the same character. Returns ``null`` for names
// whose base carries no letters - e.g. the ``"? ? ?"`` placeholder used
// for not-yet-revealed speakers, where the real identity lives in the
// parenthetical, so those must NOT cross-link to one another.
function _baseCharacterKey(name) {
    const base = (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!/[A-Za-z]/.test(base)) return null;
    return base;
}

// Returns the other canonical speakers in the active game that are
// different in-game versions of the same character (same character key),
// excluding the speaker itself. Each result is ``{ id, name }`` with the
// canonical id and its friendly name, sorted by name. Empty when the
// speaker has no variants (or is a letterless placeholder).
export function similarSpeakers(speakerId) {
    if (!speakerId) return [];
    _ensureGroups();
    const canon = _idToCanonical[speakerId] || speakerId;
    const key = _baseCharacterKey((speakers[canon] || {}).name);
    if (!key) return [];
    const out = [];
    for (const otherCanon of Object.keys(_canonicalToMembers)) {
        if (otherCanon === canon) continue;
        const e = speakers[otherCanon] || {};
        if (_baseCharacterKey(e.name) === key) {
            out.push({ id: otherCanon, name: e.name || otherCanon });
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

// Re-derive the upstream adjacency for a collapsed group: count of
// owned textlines (across all members) that reference at least one
// textline owned by any member of another group. Mapped back through
// ``_idToCanonical`` so the OTHER axis is also collapsed - so e.g.
// the Hermes group's upstream to the Zeus group counts each Hermes
// textline once even when it references both ``NPC_Zeus_01`` and
// ``ZeusUpgrade``.
function _deriveGroupUpstream(ownedTextlines) {
    const counts = {};
    for (const name of ownedTextlines) {
        const tl = textlines[name];
        if (!tl) continue;
        const referencedGroups = new Set();
        const reqs = tl.requirements || {};
        for (const refList of Object.values(reqs)) {
            if (!Array.isArray(refList)) continue;
            for (const ref of refList) {
                const refTl = textlines[ref];
                if (!refTl || !refTl.owner) continue;
                referencedGroups.add(_idToCanonical[refTl.owner] || refTl.owner);
            }
        }
        for (const g of referencedGroups) {
            counts[g] = (counts[g] || 0) + 1;
        }
    }
    return counts;
}

// Re-derive downstream adjacency: for each owned textline T in this
// group, collect ALL dependent textline names, dedup them
// (a dependent textline may appear under multiple owned-T entries
// when it gates on more than one), then bucket each dependent by
// its owner's canonical group.
function _deriveGroupDownstream(ownedTextlines) {
    const dependentToGroup = new Map();
    for (const name of ownedTextlines) {
        const deps = dependents[name] || [];
        if (!Array.isArray(deps)) continue;
        for (const dep of deps) {
            const depName = typeof dep === 'string' ? dep : (dep && dep.name);
            if (!depName) continue;
            const depTl = textlines[depName];
            if (!depTl || !depTl.owner) continue;
            dependentToGroup.set(depName, _idToCanonical[depTl.owner] || depTl.owner);
        }
    }
    const counts = {};
    for (const g of dependentToGroup.values()) {
        counts[g] = (counts[g] || 0) + 1;
    }
    return counts;
}

// Returns the aggregated entry for the group containing ``speakerId``.
// Single-member groups pass the underlying speaker entry through with
// a single-id ``_members`` augment (so renderers can test for sibling
// presence via ``entry._members.length``) but still re-derive adjacency
// so the OTHER axis is collapsed to canonical ids.
// Multi-member groups merge ownedTextlines, asSpeakerTextlines (with
// group-owned subtracted), sectionCounts, priorityCounts across
// members, then re-derive adjacency using the canonical mapping so
// the OTHER axis is also collapsed.
export function getSpeakerGroupEntry(speakerId) {
    _ensureGroups();
    const canon = _idToCanonical[speakerId];
    if (!canon) return null;
    if (_groupEntryCache[canon]) return _groupEntryCache[canon];

    const members = _canonicalToMembers[canon] || [canon];
    const canonEntry = speakers[canon] || {};

    if (members.length === 1) {
        // Re-derive adjacency even for singletons so the OTHER axis is
        // collapsed to canonical ids, matching the multi-member path and
        // the detail builder. The raw per-owner maps emitted by the
        // pipeline can key an edge under an alias id (e.g. ``SpellDrop``)
        // that the detail files under its canonical id (``NPC_Selene_01``),
        // which would leave the expanded row showing no individual links.
        const ownedSingle = canonEntry.ownedTextlines || [];
        const single = {
            ...canonEntry,
            adjacencyUpstream: _deriveGroupUpstream(ownedSingle),
            adjacencyDownstream: _deriveGroupDownstream(ownedSingle),
            _canonicalId: canon,
            _members: members.slice(),
        };
        _groupEntryCache[canon] = single;
        return single;
    }

    const owned = new Set();
    const asSpeaker = new Set();
    const sectionCounts = {};
    const priorityCounts = { super: 0, priority: 0, plain: 0 };
    let description = '';
    for (const mid of members) {
        const e = speakers[mid] || {};
        for (const t of e.ownedTextlines || []) owned.add(t);
        for (const t of e.asSpeakerTextlines || []) asSpeaker.add(t);
        const sc = e.sectionCounts || {};
        for (const k of Object.keys(sc)) sectionCounts[k] = (sectionCounts[k] || 0) + sc[k];
        const pc = e.priorityCounts || {};
        for (const b of ['super', 'priority', 'plain']) priorityCounts[b] += pc[b] || 0;
        if (!description && e.description) description = e.description;
    }
    // After collapse, textlines owned by other members of THIS group
    // are now group-owned, so drop them from the as-speaker set.
    for (const t of owned) asSpeaker.delete(t);

    const ownedSorted = Array.from(owned).sort();

    const entry = {
        name: canonEntry.name || canon,
        description,
        ownedTextlines: ownedSorted,
        asSpeakerTextlines: Array.from(asSpeaker).sort(),
        sectionCounts,
        priorityCounts,
        adjacencyUpstream: _deriveGroupUpstream(ownedSorted),
        adjacencyDownstream: _deriveGroupDownstream(ownedSorted),
        _canonicalId: canon,
        _members: members.slice(),
    };
    _groupEntryCache[canon] = entry;
    return entry;
}
