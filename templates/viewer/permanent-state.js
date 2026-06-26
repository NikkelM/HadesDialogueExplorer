/**
 * Permanent ("set-and-forget") GameState classification for unobtainability.
 *
 * A loaded save's persistent ``GameState`` mostly only grows: across runs the
 * engine appends to / increments these tables and never clears them
 * (``RunLogic.GameStateInit`` uses the ``X = X or {}`` idiom, and
 * ``StartNewRun`` / ``EndRun`` rebuild only ``CurrentRun``). So a dialogue gated
 * on "must NOT have <X>" - where X reads a monotonic ``GameState`` path - becomes
 * permanently unplayable once X holds: the value can never move back. This
 * module is the manually-maintained allowlist of those one-way paths plus the
 * per-operator rules that decide, for a single ``GameState`` clause, whether it
 * is *permanently* met or *permanently* unmet given the current save (as opposed
 * to merely met / unmet right now).
 *
 * Caveat - the story reset. The player-triggered "story reset"
 * (``DoStoryReset``, an explicit New-Game-Plus-style wipe) nils a hardcoded
 * subset of these keys - ``ReachedTrueEnding``, ``TyphonDefeatedWithStormStop``,
 * a few quest / room / boss records and the matching ``TextLinesRecord`` /
 * ``SpeechRecord`` entries. Because that is a deliberate, destructive,
 * whole-progression wipe (and it also clears the dialogue records a named
 * requirement reads), the verdicts here assume no story reset has been
 * performed: they describe permanence under normal play.
 * ``GameState.StoryResetCount`` being greater than 0 signals a reset has
 * happened on the profile.
 *
 * Classification verified against the game's Lua write / clear sites
 * (RunLogic, RoomLogic, CombatLogic, TraitLogic, AudioLogic, ...) and the reset
 * allowlists in ``StoryResetData`` / ``StoryResetLogic``.
 */

// ``GameState`` sub-tables whose child entries (counters, or ``= true`` records)
// are only ever appended / incremented and never cleared in normal play. A
// truthy / non-zero child here only moves "up".
const MONOTONIC_TABLES = new Set([
    'RoomsEntered', 'RoomCountCache', 'EnemyKills', 'UseRecord',
    'WeaponsUnlocked', 'FamiliarsUnlocked', 'AchievementsUnlocked',
    'ScreensViewed', 'CodexEntriesViewed', 'MusicRecord', 'SpeechRecord',
    'SpecialInteractRecord', 'EncountersOccurredCache', 'EncountersCompletedCache',
    'LifetimeResourcesGained', 'BiomeVisits', 'ExorcisedNames', 'TraitsTaken',
    'Flags', 'NemesisTakeExitRecord', 'NemesisTakeRoomExitRecord',
    'WorldUpgrades', 'WorldUpgradesAdded', 'WorldUpgradesViewed', 'WorldUpgradesRevealed',
]);

// Scalar ``GameState`` keys that are write-once (nil / false -> truthy) and are
// never flipped back in normal play (only by a story reset; see the caveat).
const MONOTONIC_FLAGS = new Set([
    'ReachedTrueEnding', 'TyphonDefeatedWithStormStop',
]);

// True when ``path`` (an engine path array including the leading 'GameState')
// reads a value that only ever moves "up" - nil / 0 / false -> truthy / larger -
// over the profile's lifetime in normal play. Resettable / "last-status" keys
// (``LastDreamRunCleared``, ``LastBossDifficultyRecord.*``, ``ActiveShrineBounty``,
// ``EquippedFamiliar``) and anything under ``CurrentRun`` are deliberately not
// listed, so they fall through to ``false`` and never read as permanent.
export function isMonotonicUpPath(path) {
    if (!Array.isArray(path) || path[0] !== 'GameState' || path.length < 2) return false;
    const seg = path[1];
    if (path.length === 2) return MONOTONIC_FLAGS.has(seg);
    // ``MetaUpgradeState.<Arcana>.Unlocked`` is a one-way unlock flag (the
    // equipped / rank state in the same record is not).
    if (seg === 'MetaUpgradeState') return path[path.length - 1] === 'Unlocked';
    if (MONOTONIC_TABLES.has(seg)) {
        // Cosmetic entries in the ``WorldUpgrades*`` tables toggle back off when
        // a cosmetic is removed / swapped, so they are not one-way.
        const leaf = path[path.length - 1];
        if (seg.startsWith('WorldUpgrades') && /^Cosmetic_/.test(leaf)) return false;
        return true;
    }
    return false;
}

// True when ``path`` points *at* a monotonic-up sub-table (one whose membership
// is only ever appended to). Unlike ``isMonotonicUpPath`` - which inspects a
// scalar leaf - this validates the table itself, for the ``Has*`` set-membership
// operators whose ``Path`` is the table and whose keys are the listed members.
export function isMonotonicTablePath(path) {
    return Array.isArray(path) && path[0] === 'GameState' && path.length === 2
        && MONOTONIC_TABLES.has(path[1]);
}

// Walk a GameState path array (path[0] === 'GameState') from the slice, breaking
// on the first nil hop (matches the engine's stop-at-nil descent).
function walk(gs, path) {
    let v = gs;
    for (let i = 1; i < path.length; i++) {
        if (v === undefined || v === null || typeof v !== 'object') return undefined;
        v = v[path[i]];
    }
    return v;
}

// Lua truthiness: only nil and false are falsy (0 and "" are truthy).
function truthy(v) {
    return v !== undefined && v !== null && v !== false;
}

// pairs-style key count (the engine's TableLength), nil -> 0.
function tableLen(v) {
    return (v && typeof v === 'object') ? Object.keys(v).length : 0;
}

/**
 * Permanence of a single ``GameState`` gate clause against the current save:
 *   'met'   - satisfied now and can never become unsatisfied (the path is
 *             monotonic-up and already past the threshold)
 *   'unmet' - unsatisfied now and can never become satisfied (the path is
 *             monotonic-up and already past the point of no return the gate
 *             forbids)
 *   null    - not provably permanent (the path is resettable / live, the
 *             operator can still flip with growth, or the shape is unsupported)
 *
 * Only plain ``GameState.*`` path clauses on a monotonic-up path are analysed;
 * ``FunctionName`` / ``PathFromSource`` / ``SumPrev*`` / ``CurrentRun`` and the
 * like read transient state and always return null. Conservative by design: a
 * false 'met' / 'unmet' would wrongly brand a dialogue permanently
 * (un)obtainable, so anything uncertain stays null.
 */
export function gameStateClausePermanence(rec, gameStateSlice) {
    if (!rec || typeof rec !== 'object' || !gameStateSlice) return null;
    if (rec.FunctionName || rec.PathFromSource || rec.PathFromArgs
        || rec.SumPrevRuns !== undefined || rec.SumPrevRooms !== undefined) return null;

    // Boolean terminals.
    if (rec.PathTrue) {
        if (!isMonotonicUpPath(rec.PathTrue)) return null;
        const v = walk(gameStateSlice, rec.PathTrue);
        // PathTrue: met iff truthy AND != 0. Once a monotonic-up value crosses
        // into truthy / non-zero it stays there -> permanently met. While still
        // falsy / 0 it may yet rise -> not provably permanent.
        return (truthy(v) && v !== 0) ? 'met' : null;
    }
    if (rec.PathFalse) {
        if (!isMonotonicUpPath(rec.PathFalse)) return null;
        const v = walk(gameStateSlice, rec.PathFalse);
        // PathFalse: met iff falsy. A monotonic-up value already truthy stays
        // truthy -> the gate is permanently UNMET. While still falsy it may rise.
        return truthy(v) ? 'unmet' : null;
    }

    // Numeric comparison against a constant over a monotonic-up counter
    // (optionally its table length).
    if (rec.Comparison && Array.isArray(rec.Path)) {
        if (rec.ValuePath) return null;            // compared to another live value
        if (rec.Modulo !== undefined) return null; // wraps - not monotonic
        if (rec.CountOf !== undefined || rec.SumOf !== undefined) return null; // needs GameData list
        if (!isMonotonicUpPath(rec.Path)) return null;
        const right = rec.Value;
        if (typeof right !== 'number') return null;
        let left = walk(gameStateSlice, rec.Path);
        if (rec.UseLength) left = tableLen(left);
        else left = (left === undefined || left === null) ? 0 : left;
        if (typeof left !== 'number' || Number.isNaN(left)) return null;
        const now = compareNum(left, rec.Comparison, right);
        if (rec.Comparison === '>' || rec.Comparison === '>=') return now ? 'met' : null;
        if (rec.Comparison === '<' || rec.Comparison === '<=') return now ? null : 'unmet';
        return null; // == / ~= are unstable as the counter grows
    }

    // Set-membership over a monotonic-up table (keys are only ever added).
    if (Array.isArray(rec.Path) && isMonotonicTablePath(rec.Path)) {
        const v = walk(gameStateSlice, rec.Path);
        const list = rec.HasAny || rec.HasAll || rec.HasNone;
        if (!Array.isArray(list)) return null; // a <ref:GameData.X> list - can't resolve here
        // Cosmetic membership in the WorldUpgrades* tables can toggle back off,
        // so a Has* over them is not provably permanent.
        if (rec.Path[1].startsWith('WorldUpgrades') && list.some(k => /^Cosmetic_/.test(k))) return null;
        if (rec.HasAny) return list.some(k => truthy(v && v[k])) ? 'met' : null;
        if (rec.HasAll) return list.every(k => truthy(v && v[k])) ? 'met' : null;
        if (rec.HasNone) return list.some(k => truthy(v && v[k])) ? 'unmet' : null;
    }
    return null;
}

function compareNum(left, op, right) {
    switch (op) {
    case '>=': return left >= right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '<': return left < right;
    default: return false;
    }
}
