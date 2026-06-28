// Hades 1 GameState requirement evaluator.
//
// Resolves a Hades 1 textline's non-textline requirements (the structured
// named-field ``otherRequirements`` model: ``RequiredKills``, ``RequiredRoom``,
// ``RequiredTrueFlags``, ``RequiredMinCompletedRuns``, ...) against a loaded
// save. A direct JS port of the per-field branches in the game's
// ``IsGameStateEligible`` (RunManager.lua:2569-5516), with the engine's exact
// nil / Lua-truthiness handling (a missing GameState sub-key coerces to 0 /
// false / empty exactly as the engine reads it).
//
// This is the H1 sibling of ``evaluateOtherRequirements`` in gamestate-eval.js
// (which handles H2's array-clause / FunctionName model). The textline-record
// fields (``RequiredTextLines`` etc., plus ``Min/MaxRunsSinceAnyTextLines`` and
// ``Required(Min|Max)AnyTextLines``) are owned by ``requirementSetStatus`` in
// requirements.js for both games and are skipped here.
//
// Resolution scope, mirroring the H2 pass:
//   * persistent  - reads only GameState.* aggregates: resolved for any save.
//   * prevrun     - reads GameState.RunHistory[#] (the last completed run):
//                   resolved whenever a save is loaded (empty when no prior run).
//   * runcount    - scans GameState.RunHistory across runs.
//   * currentrun  - reads CurrentRun.* : resolved only when the dialogue owner's
//                   trigger context matches the loaded save type (see
//                   ``currentRunResolvableH1``); otherwise 'unknown' (wrong save).
//   * liveonly    - transient combat / audio / live-enemy / UI state a static
//                   save cannot provide: always 'unknown' with a reason.
//   * static-data - a few persistent fields also consult static game tables.
//                   The Mirror "active" gates, the weapon-enchantment count and
//                   the cosmetic-visible constant ship as h1SaveEvalStatic (see
//                   src/extractors/hades1/save_eval_data.py) and resolve here;
//                   the remainder (meta/keepsake/weapon-upgrade COST tables) still
//                   aren't shipped and report 'unknown' with a reason. The codex
//                   gates need no static tables - they read the persisted
//                   top-level CodexStatus global directly (see collectH1GlobalRefs).
//
// Returns, for a whole requirement set, { status, clauses } where ``status`` is
// 'met' | 'unmet' | 'unknown' and ``clauses`` lists each field's verdict (with a
// reason for every 'unknown'), matching the shape evaluateOtherRequirements
// produces so the tracer / detail view render identical status dots.

import { h1SaveEvalStatic } from './data.js';

// ---- save-slice key lists (single-sourced for save-parser.js) ----------------
//
// The top-level GameState keys this evaluator reads. The H1 save-slice
// extraction captures exactly these (RunHistory pruned to per-run {Cleared,
// WeaponsCache}); every other GameState sub-key the engine would coerce to
// nil/0/false is simply absent and the handlers coerce it the same way.
export const H1_GAMESTATE_SLICE_KEYS = [
    'Flags', 'EnemyKills', 'TotalRequiredEnemyKills', 'WeaponKills', 'RoomCountCache',
    'EncountersOccurredCache', 'Cosmetics', 'CosmeticsAdded', 'CosmeticsViewed',
    'MetaUpgrades', 'MetaUpgradesSelected', 'MetaUpgradesUnlocked', 'TraitsTaken', 'WeaponsUnlocked', 'WeaponUnlocks',
    'NPCInteractions', 'ItemInteractions', 'ScreensViewed', 'LifetimeResourcesGained',
    'LifetimeResourcesSpent', 'QuestStatus', 'TotalCaughtFish', 'CaughtFish',
    'SpentShrinePointsCache', 'ConsecutiveClears', 'LastAwardTrait', 'LastAssistTrait',
    'RecordLastClearedShrineReward', 'Resources', 'SpentMetaPointsCache', 'LastInteractedWeaponUpgrade',
    'KeepsakeChambers',
];

// Hades 1 persists every global not in Main.lua's SaveIgnores, so a few tables
// the dialogue requirements read live at the TOP LEVEL of the save (siblings of
// GameState), not under it: the global voiceline ``SpeechRecord`` (cue -> true,
// read by RequiredPlayed / RequiredFalsePlayed) and ``CodexStatus``
// (chapter -> entry -> per-page Unlocked flags, read by the codex gates). The
// save-slice captures these under synthetic ``SpeechRecord`` / ``Codex`` /
// ``CodexUnlockedTotal`` keys (see save-parser.js), pruned to just the cues /
// entries the data references, because the raw globals are large (SpeechRecord
// alone is ~11k cues). Collect those referenced names from the dialogue data.
export function collectH1GlobalRefs(textlines) {
    const codexEntries = new Set();
    const speechCues = new Set();
    let needsCodexTotal = false;
    for (const tl of Object.values(textlines || {})) {
        const o = tl && tl.otherRequirements;
        if (!o) continue;
        if (o.RequiredCodexEntry && o.RequiredCodexEntry.EntryName) codexEntries.add(o.RequiredCodexEntry.EntryName);
        if (o.RequiredCodexEntriesMin != null) needsCodexTotal = true;
        for (const field of ['RequiredPlayed', 'RequiredFalsePlayed']) {
            const v = o[field];
            if (v == null) continue;
            for (const cue of (Array.isArray(v) ? v : [v])) speechCues.add(cue);
        }
    }
    return { codexEntries, speechCues, needsCodexTotal };
}

// Top-level CurrentRun keys the evaluator reads (captured for an in-run / hub
// CurrentRun snapshot). Hero is pruned to the read fields; RoomHistory is pruned
// to per-room {Kills}; CurrentRoom to its read fields.
export const H1_CURRENTRUN_SLICE_KEYS = [
    'Cleared', 'RunDepthCache', 'BiomeDepthCache', 'LootTypeHistory', 'TraitCache',
    'RoomCountCache', 'EncountersCompletedCache', 'EncountersOccurredCache',
    'ActivationRecord', 'NPCInteractions',
    'SpeechRecord', 'SupportAINames', 'MetaUpgradeCache',
    'CaughtFish', 'ConsumableRecord',
];

// ---- Lua-coercion helpers ----------------------------------------------------

// nil -> 0; a present number stays. (The engine does arithmetic / comparison on
// nil GameState counters as 0.)
function h1Num(v) { return typeof v === 'number' ? v : 0; }

// Lua truthiness: only nil / false are falsy (0 and "" are truthy).
function h1Truthy(v) { return v !== undefined && v !== null && v !== false; }

// pairs-style key count (TableLength), nil -> 0.
function h1Len(v) { return (v && typeof v === 'object') ? Object.keys(v).length : 0; }

// Coerce a field value that may be a single string or an array of strings into
// an array (the engine's ``type(x) ~= "table"`` single-value branch).
function h1Arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

// Read GameState.<key> from the slice (an object), nil-safe.
function h1Gs(ctx, key) { const gs = ctx && ctx.gs; return gs ? gs[key] : undefined; }

// ---- verdict helpers ---------------------------------------------------------

const H1_UNMET = { status: 'unmet' };
const H1_OK = { status: 'met' };
const H1_WRONGSAVE = (reason) => ({ status: 'unknown', reason, kind: 'wrong-save-type' });
const H1_LIVE = (reason) => ({ status: 'unknown', reason });
const H1_NEEDS_STATIC = (reason) => ({ status: 'unknown', reason });

const _h1bool = (b) => (b ? H1_OK : H1_UNMET);

// Hero trait membership from a CurrentRun slice. The save-parser prunes the
// hero's traits to a compact ``Traits`` array of ``{Name, ...}``; fall back to
// the ``TraitDictionary`` name map when present (raw save shape).
function h1HeroHasTrait(cr, name) {
    const hero = cr && cr.Hero;
    if (!hero) return false;
    const traits = hero.Traits;
    if (traits && typeof traits === 'object') {
        if (Object.values(traits).some(t => t && t.Name === name)) return true;
    }
    if (hero.TraitDictionary && typeof hero.TraitDictionary === 'object') {
        return h1Truthy(hero.TraitDictionary[name]);
    }
    return false;
}

// Names of every trait the hero holds, from the pruned ``Traits`` array (or the
// raw ``TraitDictionary`` keys), for the god-loot / no-god-boons set tests.
function h1HeroTraitNames(cr) {
    const hero = cr && cr.Hero;
    if (!hero) return [];
    const traits = hero.Traits;
    if (traits && typeof traits === 'object') {
        return Object.values(traits).map(t => t && t.Name).filter(Boolean);
    }
    if (hero.TraitDictionary && typeof hero.TraitDictionary === 'object') {
        return Object.keys(hero.TraitDictionary);
    }
    return [];
}

// HasResource(name, amount) (RoomManager.lua:3450): amount 0 is always met;
// otherwise GameState.Resources[name] must exist and be >= amount.
function h1HasResource(resources, name, amount) {
    if (amount === 0) return true;
    const have = resources[name];
    return have != null && have >= amount;
}

// ---- per-field handlers ------------------------------------------------------
//
// Each handler is ``(value, ctx) => { status, reason?, kind? }`` where ``value``
// is the dialogue's requirement value for that field and ``ctx`` is the H1 save
// context ``{ gs, currentRun, prevRun, runHistory, saveInRun }``.

// Convenience: require a CurrentRun slice (resolved owner-context), else wrong-save.
function _h1cr(ctx) { return ctx ? ctx.currentRun : null; }
const _CR_REASON = 'This requirement reads data from a different save type. Load a "ProfileX.sav" file for a hub save, or "ProfileX_Temp.sav" for an in-run save.';

const H1_FIELD_EVALS = {
    // ===== PERSISTENT: GameState flags / values =====
    RequiredTrueFlags: (v, ctx) => { const f = h1Gs(ctx, 'Flags') || {}; return _h1bool(h1Arr(v).every(k => h1Truthy(f[k]))); },
    RequiredFalseFlags: (v, ctx) => { const f = h1Gs(ctx, 'Flags') || {}; return _h1bool(!h1Arr(v).some(k => h1Truthy(f[k]))); },
    RequiredValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(Object.entries(v || {}).every(([k, val]) => gs[k] === val)); },
    RequiredFalseValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(!Object.entries(v || {}).some(([k, val]) => gs[k] === val)); },
    RequiredMinValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(Object.entries(v || {}).every(([k, min]) => h1Num(gs[k]) >= min)); },

    // ===== PERSISTENT: run counts =====
    RequiredCompletedRuns: (v, ctx) => _h1bool(h1CompletedRuns(ctx) === v),
    RequiredMinCompletedRuns: (v, ctx) => _h1bool(h1CompletedRuns(ctx) >= v),
    RequiredMaxCompletedRuns: (v, ctx) => _h1bool(h1CompletedRuns(ctx) <= v),
    RequiredRunsCleared: (v, ctx) => _h1bool(h1RunsCleared(ctx) === v),
    RequiredMinRunsCleared: (v, ctx) => _h1bool(h1RunsCleared(ctx) >= v),
    RequiredMaxRunsCleared: (v, ctx) => _h1bool(h1RunsCleared(ctx) <= v),
    RequiredMinConsecutiveClears: (v, ctx) => _h1bool(h1Num(h1Gs(ctx, 'ConsecutiveClears')) >= v),

    // ===== PERSISTENT: kills =====
    RequiredKills: (v, ctx) => { const k = h1Gs(ctx, 'EnemyKills') || {}; return _h1bool(Object.entries(v || {}).every(([e, c]) => h1Num(k[e]) >= c)); },
    RequiredFalseKills: (v, ctx) => { const k = h1Gs(ctx, 'EnemyKills') || {}; return _h1bool(!h1Arr(v).some(e => h1Num(k[e]) > 0)); },
    RequiredMinTotalKills: (v, ctx) => _h1bool(h1Num(h1Gs(ctx, 'TotalRequiredEnemyKills')) >= v),
    RequiredMinWeaponKills: (v, ctx) => { const k = h1Gs(ctx, 'WeaponKills') || {}; return _h1bool(Object.entries(v || {}).every(([w, c]) => h1Num(k[w]) >= c)); },

    // ===== PERSISTENT: rooms seen / encounters =====
    RequiredSeenRooms: (v, ctx) => _h1bool(h1Arr(v).every(r => h1HasSeenRoom(ctx, r))),
    RequiredFalseSeenRooms: (v, ctx) => _h1bool(!h1Arr(v).some(r => h1HasSeenRoom(ctx, r))),
    RequiredMinTimesSeenRoom: (v, ctx) => { const rc = h1Gs(ctx, 'RoomCountCache') || {}; return _h1bool(Object.entries(v || {}).every(([r, c]) => h1Num(rc[r]) >= c)); },
    RequiredMaxTimesSeenRoom: (v, ctx) => { const rc = h1Gs(ctx, 'RoomCountCache') || {}; return _h1bool(Object.entries(v || {}).every(([r, c]) => rc[r] != null && h1Num(rc[r]) <= c)); },
    RequiredSeenEncounter: (v, ctx) => { const e = h1Gs(ctx, 'EncountersOccurredCache') || {}; return _h1bool(h1Num(e[v]) > 0); },

    // ===== PERSISTENT: cosmetics =====
    RequiredCosmetics: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; return _h1bool(h1Arr(v).every(k => h1Truthy(c[k]))); },
    RequiredFalseCosmetics: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; return _h1bool(!h1Arr(v).some(k => h1Truthy(c[k]))); },
    RequiredAnyCosmetics: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; return _h1bool(h1Arr(v).some(k => h1Truthy(c[k]))); },
    RequiredMinAnyCosmetics: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; const list = h1Arr(v && v.Cosmetics); return _h1bool(list.filter(k => h1Truthy(c[k])).length >= (v && v.Count)); },
    RequiredMaxAnyCosmetics: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; const list = h1Arr(v && v.Cosmetics); return _h1bool(list.filter(k => h1Truthy(c[k])).length <= (v && v.Count)); },
    RequiredCosmeticItemVisible: (v, ctx) => { const c = h1Gs(ctx, 'Cosmetics') || {}; const vis = (h1SaveEvalStatic && h1SaveEvalStatic.cosmeticVisibleValue) || 'visible'; return _h1bool(c[v] === vis); },
    RequiredSeenCosmeticPurchaseable: (v, ctx) => { const a = h1Gs(ctx, 'CosmeticsAdded') || {}; const w = h1Gs(ctx, 'CosmeticsViewed') || {}; return _h1bool(h1Truthy(a[v]) || h1Truthy(w[v])); },

    // ===== PERSISTENT: meta upgrades =====
    RequiredMetaUpgradeUnlocked: (v, ctx) => { const m = h1Gs(ctx, 'MetaUpgradesUnlocked') || {}; return _h1bool(h1Truthy(m[v])); },
    RequiredInactiveMetaUpgrade: (v, ctx) => h1MetaStaticReady() ? _h1bool(h1MetaUpgradeLevel(ctx, v) <= 0) : H1_NEEDS_STATIC(_META_STATIC_REASON),
    RequiredActiveMetaUpgrade: (v, ctx) => h1MetaStaticReady() ? _h1bool(h1MetaUpgradeLevel(ctx, v) >= 1) : H1_NEEDS_STATIC(_META_STATIC_REASON),
    RequiredMinActiveMetaUpgradeLevel: (v, ctx) => h1MetaStaticReady() ? _h1bool(h1MetaUpgradeLevel(ctx, v && v.Name) >= (v && v.Count)) : H1_NEEDS_STATIC(_META_STATIC_REASON),
    RequiredMaxActiveMetaUpgradeLevel: (v, ctx) => h1MetaStaticReady() ? _h1bool(h1MetaUpgradeLevel(ctx, v && v.Name) <= (v && v.Count)) : H1_NEEDS_STATIC(_META_STATIC_REASON),

    // ===== PERSISTENT: traits taken =====
    RequiredTraitsTaken: (v, ctx) => { const t = h1Gs(ctx, 'TraitsTaken') || {}; return _h1bool(h1Arr(v).every(k => h1Truthy(t[k]))); },

    // ===== PERSISTENT: weapons unlocked / enchantments =====
    RequiredWeaponsUnlocked: (v, ctx) => { const w = h1Gs(ctx, 'WeaponsUnlocked') || {}; return _h1bool(h1Arr(v).every(k => h1Truthy(w[k]))); },
    RequiredFalseWeaponsUnlocked: (v, ctx) => { const w = h1Gs(ctx, 'WeaponsUnlocked') || {}; return _h1bool(!h1Arr(v).some(k => h1Truthy(w[k]))); },
    RequiredAnyWeaponsUnlocked: (v, ctx) => { const w = h1Gs(ctx, 'WeaponsUnlocked') || {}; return _h1bool(h1Arr(v).some(k => h1Truthy(w[k]))); },
    RequiredMinUnlockedWeaponEnchantments: (v, ctx) => h1WeaponStaticReady() ? _h1bool(h1CountWeaponUnlocks(ctx, false) >= v) : H1_NEEDS_STATIC(_WEAPON_STATIC_REASON),
    RequiredMaxUnlockedWeaponEnchantments: (v, ctx) => h1WeaponStaticReady() ? _h1bool(h1CountWeaponUnlocks(ctx, false) <= v) : H1_NEEDS_STATIC(_WEAPON_STATIC_REASON),
    RequiredMaxWeaponUpgrade: (v, ctx, all) => h1MaxWeaponUpgrade(ctx, v, all && all.RequiredMaxWeaponUpgradeIndex, false),
    RequiredFalseMaxWeaponUpgrade: (v, ctx, all) => h1MaxWeaponUpgrade(ctx, v, all && all.RequiredFalseMaxWeaponUpgradeIndex, true),

    // ===== PERSISTENT: shrine points / bounties =====
    RequiredActiveShrinePointsMin: (v, ctx) => _h1bool(h1Num(h1Gs(ctx, 'SpentShrinePointsCache')) >= v),
    RequiredActiveShrinePointsMax: (v, ctx) => _h1bool(h1Num(h1Gs(ctx, 'SpentShrinePointsCache')) <= v),
    RequiredMinBountiesEarned: (v, ctx) => _h1bool(h1CountBounties(ctx) >= v),

    // ===== PERSISTENT: lifetime resources =====
    RequiredLifetimeResourcesGainedMin: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesGained') || {}; return _h1bool(Object.entries(v || {}).every(([k, a]) => h1Num(r[k]) >= a)); },
    RequiredLifetimeResourcesGainedMax: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesGained') || {}; return _h1bool(!Object.entries(v || {}).some(([k, a]) => h1Num(r[k]) > a)); },
    RequiredLifetimeResourcesSpentMin: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesSpent') || {}; return _h1bool(Object.entries(v || {}).every(([k, a]) => h1Num(r[k]) >= a)); },
    RequiredLifetimeResourcesSpentMax: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesSpent') || {}; return _h1bool(!Object.entries(v || {}).some(([k, a]) => h1Num(r[k]) > a)); },

    // ===== PERSISTENT: quests / codex / fishing =====
    RequiredMinQuestsComplete: (v, ctx) => _h1bool(h1CountCashedOutQuests(ctx) >= v),
    RequiredMaxQuestsComplete: (v, ctx) => _h1bool(h1CountCashedOutQuests(ctx) <= v),
    RequiredMinTotalCaughtFish: (v, ctx) => { const f = h1Gs(ctx, 'TotalCaughtFish') || {}; return _h1bool(h1SumValues(f) >= v); },
    RequiredAnyCaughtFishTypes: (v, ctx) => { const f = h1Gs(ctx, 'TotalCaughtFish') || {}; return _h1bool(h1Arr(v).some(t => h1Num(f[t]) > 0)); },
    RequiredHasFish: (v, ctx) => _h1bool(h1Len(h1Gs(ctx, 'CaughtFish')) > 0),

    // ===== PERSISTENT: interactions / screens / keepsakes =====
    RequiredMinNPCInteractions: (v, ctx) => { const n = h1Gs(ctx, 'NPCInteractions') || {}; return _h1bool(Object.entries(v || {}).every(([k, c]) => h1Num(n[k]) >= c)); },
    RequiredMaxNPCInteractions: (v, ctx) => { const n = h1Gs(ctx, 'NPCInteractions') || {}; return _h1bool(Object.entries(v || {}).every(([k, c]) => n[k] != null && h1Num(n[k]) <= c)); },
    RequiredMinItemInteractions: (v, ctx) => { const it = h1Gs(ctx, 'ItemInteractions') || {}; return _h1bool(Object.entries(v || {}).every(([k, c]) => h1Num(it[k]) >= c)); },
    RequiredScreenViewed: (v, ctx) => { const s = h1Gs(ctx, 'ScreensViewed') || {}; return _h1bool(h1Truthy(s[v])); },
    RequiredScreenViewedFalse: (v, ctx) => { const s = h1Gs(ctx, 'ScreensViewed') || {}; return _h1bool(!h1Truthy(s[v])); },
    RequiredKeepsake: (v, ctx) => _h1bool(h1Gs(ctx, 'LastAwardTrait') === v),
    RequiredAssistKeepsake: (v, ctx) => _h1bool(h1Gs(ctx, 'LastAssistTrait') === v),

    // ===== PERSISTENT: config options =====
    RequiredTrueConfigOptions: () => H1_LIVE('Reads game config options (settings), which a save file doesn\u2019t store.'),
    RequiredFalseConfigOptions: () => H1_LIVE('Reads game config options (settings), which a save file doesn\u2019t store.'),

    // ===== PERSISTENT: voiceline speech record (global) =====
    RequiredPlayed: (v, ctx) => { const s = h1Gs(ctx, 'SpeechRecord'); if (!s) return H1_LIVE('Reads the global voiceline speech record, not stored in this save slice.'); return _h1bool(h1Arr(v).every(k => h1Truthy(s[k]))); },
    RequiredFalsePlayed: (v, ctx) => { const s = h1Gs(ctx, 'SpeechRecord'); if (!s) return H1_LIVE('Reads the global voiceline speech record, not stored in this save slice.'); return _h1bool(!h1Arr(v).some(k => h1Truthy(s[k]))); },

    // ===== PERSISTENT: codex (top-level CodexStatus global) =====
    RequiredCodexEntry: (v, ctx) => {
        const codex = ctx.gs && ctx.gs.Codex;
        if (!codex) return H1_LIVE('Reads the persistent codex unlock status (not stored in this save slice).');
        const e = codex[v && v.EntryName];
        const idx = (v && v.EntryIndex) || 1;
        // HasCodexEntryBeenFound (RunManager.lua:5657): the entry's first ``idx``
        // pages must all be unlocked AND the entry must have been viewed (not New).
        if (!e) return H1_UNMET;
        return _h1bool(e.u >= idx && e.viewed);
    },
    RequiredCodexEntriesMin: (v, ctx) => {
        const total = ctx.gs && ctx.gs.CodexUnlockedTotal;
        if (total == null) return H1_LIVE('Reads the total codex entries unlocked (not stored in this save slice).');
        return _h1bool(total >= v);
    },
    RequiresCodexFullyUnlocked: () => H1_NEEDS_STATIC('Needs the full static codex chapter/entry layout (to know every entry that must be unlocked) not shipped in this build.'),

    // ===== PERSISTENT: meta-point totals (Darkness) =====
    // GetTotalAccumulatedMetaPoints = Resources.MetaPoints (unspent) + total spent.
    // The engine keeps SpentMetaPointsCache equal to its GetTotalSpentMetaPoints
    // sum over the selected Mirror talents, so both gates resolve from the save
    // caches directly - no static cost tables needed.
    RequiredAccumulatedMetaPoints: (v, ctx) => { const sp = h1Gs(ctx, 'SpentMetaPointsCache'); if (sp == null) return H1_LIVE(_META_POINTS_REASON); const r = h1Gs(ctx, 'Resources') || {}; return _h1bool(h1Num(r.MetaPoints) + h1Num(sp) >= v); },
    RequiredActiveMetaPointsMin: (v, ctx) => { const sp = h1Gs(ctx, 'SpentMetaPointsCache'); return sp == null ? H1_LIVE(_META_POINTS_REASON) : _h1bool(h1Num(sp) >= v); },
    RequiredActiveMetaPointsMax: (v, ctx) => { const sp = h1Gs(ctx, 'SpentMetaPointsCache'); return sp == null ? H1_LIVE(_META_POINTS_REASON) : _h1bool(h1Num(sp) <= v); },

    // ===== PERSISTENT: resources (Darkness / Gems / ...) =====
    // HasResource reads GameState.Resources, so this resolves from any save.
    RequiredResourcesMin: (v, ctx) => { const r = h1Gs(ctx, 'Resources') || {}; return _h1bool(Object.entries(v || {}).every(([name, amount]) => h1HasResource(r, name, amount))); },

    // ===== PERSISTENT: weapon-aspect upgrades (h1SaveEvalStatic.weaponUpgradeSlots) =====
    RequiredMinSuperLockKeysSpentOnWeapon: (v, ctx) => h1WeaponStaticReady() ? _h1bool(h1WeaponKeysSpent(ctx, v && v.Name) >= (v && v.Count)) : H1_NEEDS_STATIC(_WEAPON_STATIC_REASON),
    RequiredLastInteractedWeaponUpgrade: (v, ctx) => { if (!h1WeaponStaticReady()) return H1_NEEDS_STATIC(_WEAPON_STATIC_REASON); const li = h1Gs(ctx, 'LastInteractedWeaponUpgrade'); if (li == null) return H1_UNMET; return _h1bool(h1WeaponUpgradeTrait(ctx, li.WeaponName, li.ItemIndex) === v); },
    RequiredLastInteractedWeaponUpgradeMaxed: (v, ctx) => { if (!h1WeaponStaticReady()) return H1_NEEDS_STATIC(_WEAPON_STATIC_REASON); const li = h1Gs(ctx, 'LastInteractedWeaponUpgrade'); if (li == null) return H1_UNMET; const slot = h1WeaponSlot(li.WeaponName, li.ItemIndex); if (!slot || slot.max == null) return H1_UNMET; return _h1bool(h1WeaponUpgradeLevel(ctx, li.WeaponName, li.ItemIndex) >= slot.max); },

    // ===== PERSISTENT but needs static game-data tables this build omits =====
    RequiredAllMetaUpgradesMaxed: () => H1_NEEDS_STATIC('Needs the meta-upgrade order / max-level tables not shipped in this build.'),
    RequiresMaxKeepsake: (v, ctx) => {
        if (!h1KeepsakeStaticReady()) return H1_NEEDS_STATIC(_KEEPSAKE_STATIC_REASON);
        // Engine quirk (RunManager.lua:3152): the gate only fails when a keepsake
        // is equipped AND not mastered, so no equipped keepsake passes vacuously.
        const last = h1Gs(ctx, 'LastAwardTrait');
        if (last == null) return H1_OK;
        const max = h1SaveEvalStatic.keepsakeMaxChambers[last];
        if (max == null) return H1_NEEDS_STATIC(_KEEPSAKE_RARITY_REASON);
        const chambers = (h1Gs(ctx, 'KeepsakeChambers') || {})[last];
        return _h1bool(typeof chambers === 'number' && chambers >= max);
    },
    RequiredMinShrinePointThresholdClear: () => H1_NEEDS_STATIC('Needs the per-weapon boss-room shrine-clear records cross-referenced with static room data.'),
    RequiredCosmeticPurchaseable: () => H1_NEEDS_STATIC('Needs the conditional-item purchase definitions not shipped in this build.'),

    // ===== PREV RUN (GameState.RunHistory[#]) =====
    RequiresLastRunCleared: (v, ctx) => _h1bool(h1Truthy(ctx.prevRun && ctx.prevRun.Cleared)),
    RequiresLastRunNotCleared: (v, ctx) => _h1bool(!h1Truthy(ctx.prevRun && ctx.prevRun.Cleared)),
    RequiresBestClearTimeLastRun: (v, ctx) => h1BestClearTimeLastRun(ctx),
    RequiredRoomLastRun: (v, ctx) => { const rc = (ctx.prevRun && ctx.prevRun.RoomCountCache) || {}; return _h1bool(h1Num(rc[v]) > 0); },
    RequiredAnyRoomsLastRun: (v, ctx) => { const rc = (ctx.prevRun && ctx.prevRun.RoomCountCache) || {}; return _h1bool(h1Arr(v).some(r => h1Num(rc[r]) > 0)); },
    RequiredFalseRoomLastRun: (v, ctx) => { const rc = (ctx.prevRun && ctx.prevRun.RoomCountCache) || {}; return _h1bool(!(h1Num(rc[v]) > 0)); },
    RequiredKillsLastRun: (v, ctx) => _h1bool(h1RunKills(ctx.prevRun, h1Arr(v)) > 0),

    // ===== RUN COUNT (GameState.RunHistory across runs) =====
    RequiredMinRunsWithWeapons: (v, ctx) => _h1bool(Object.entries(v || {}).every(([w, c]) => h1RunsWithWeapon(ctx, w) >= c)),
    RequiredMaxRunsWithWeapons: (v, ctx) => _h1bool(!Object.entries(v || {}).some(([w, c]) => h1RunsWithWeapon(ctx, w) > c)),

    // ===== CURRENT RUN: room / biome / depth =====
    RequiredRoom: (v, ctx) => h1CrRoomName(ctx, name => name === v),
    RequiredRooms: (v, ctx) => h1CrRoomName(ctx, name => h1Arr(v).includes(name)),
    RequiredFalseRooms: (v, ctx) => h1CrRoomName(ctx, name => !h1Arr(v).includes(name), true),
    RequiredBiome: (v, ctx) => h1CrRoomField(ctx, 'RoomSetName', rs => rs === v),
    RequiredFalseBiome: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const room = cr.CurrentRoom; return _h1bool(!!room && room.RoomSetName !== v); },
    RequiredMinExits: (v, ctx) => h1CrRoomField(ctx, 'NumExits', n => h1Num(n) >= v),
    RequiredMinDepth: (v, ctx) => h1CrNum(ctx, 'RunDepthCache', n => n >= v),
    RequiredMaxDepth: (v, ctx) => h1CrNum(ctx, 'RunDepthCache', n => n < v),
    RequiredMinBiomeDepth: (v, ctx) => h1CrNum(ctx, 'BiomeDepthCache', n => n >= v),
    RequiredMaxBiomeDepth: (v, ctx) => h1CrNum(ctx, 'BiomeDepthCache', n => n <= v),

    // ===== CURRENT RUN: cleared / death =====
    RequiresRunCleared: (v, ctx) => { const cr = _h1cr(ctx); return cr ? _h1bool(h1Truthy(cr.Cleared)) : H1_WRONGSAVE(_CR_REASON); },
    RequiresRunNotCleared: (v, ctx) => { const cr = _h1cr(ctx); return cr ? _h1bool(!h1Truthy(cr.Cleared)) : H1_WRONGSAVE(_CR_REASON); },
    RequiredDeathRoom: (v, ctx) => h1CrDeath(ctx, name => name === v, H1_UNMET),
    RequiredFalseDeathRoom: (v, ctx) => h1CrDeath(ctx, name => name !== v),
    RequiredAnyDeathEncounters: (v, ctx) => h1CrDeathEncounter(ctx, enc => h1Arr(v).includes(enc)),
    RequiredFalseDeathEncounters: (v, ctx) => h1CrDeathEncounter(ctx, enc => !h1Arr(v).includes(enc)),

    // ===== CURRENT RUN: loot / traits / weapon =====
    RequiredGodLoot: (v, ctx) => { if (!h1GodLootStaticReady()) return H1_NEEDS_STATIC(_GODLOOT_STATIC_REASON); const index = h1SaveEvalStatic.godLootTraitIndex[v]; if (!index) return H1_UNMET; const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const set = new Set(index); return _h1bool(h1HeroTraitNames(cr).some(n => set.has(n))); },
    RequiredLootThisRun: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => h1Truthy(t[v])),
    RequiredFalseGodLoot: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => !h1Truthy(t[v]), true),
    RequiredFalseGodLoots: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => !h1Arr(v).some(k => h1Truthy(t[k])), true),
    RequiredNoGodBoons: (v, ctx) => { if (!h1GodLootStaticReady()) return H1_NEEDS_STATIC(_GODLOOT_STATIC_REASON); const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const set = new Set(h1SaveEvalStatic.godTraitNamesForShop); return _h1bool(!h1HeroTraitNames(cr).some(n => set.has(n))); },
    RequiredWeapon: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1Truthy(cr.Hero && cr.Hero.Weapons && cr.Hero.Weapons[v])); },
    RequiredTrait: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1HeroHasTrait(cr, v)); },
    RequiredFalseTraits: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(!h1Arr(v).some(t => h1HeroHasTrait(cr, t))); },
    RequiredOneOfTraits: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1Arr(v).some(t => h1HeroHasTrait(cr, t))); },
    RequiredCountOfTraits: (v, ctx, all) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const need = (all && all.RequiredCountOfTraitsCount) || 1; return _h1bool(h1Arr(v).filter(t => h1HeroHasTrait(cr, t)).length >= need); },
    RequiredRunHasOneOfTraits: (v, ctx) => h1CrTable(ctx, 'TraitCache', t => h1Arr(v).some(k => h1Truthy(t[k]))),
    RequiredMaxLastStands: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1Len(cr.Hero && cr.Hero.LastStands) <= v); },
    RequiredMaxHealthFraction: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const h = cr.Hero || {}; if (!h.MaxHealth) return H1_WRONGSAVE(_CR_REASON); return _h1bool((h1Num(h.Health) / h.MaxHealth) <= v); },

    // ===== CURRENT RUN: rooms / encounters this run =====
    RequiredRoomThisRun: (v, ctx) => h1CrTable(ctx, 'RoomCountCache', t => h1Num(t[v]) > 0),
    RequiredAnyRoomsThisRun: (v, ctx) => h1CrTable(ctx, 'RoomCountCache', t => h1Arr(v).some(r => h1Num(t[r]) > 0)),
    RequiredFalseSeenRoomThisRun: (v, ctx) => h1CrSeenRoomInRun(ctx, v, true),
    RequiredFalseSeenRoomsThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(!h1Arr(v).some(r => h1Num((cr.RoomCountCache || {})[r]) > 0 || cr.CurrentRoom && cr.CurrentRoom.Name === r)); },
    RequiredEncounterThisRun: (v, ctx) => h1CrTable(ctx, 'EncountersOccurredCache', t => t[v] != null),
    RequiredAnyEncountersThisRun: (v, ctx) => h1CrTable(ctx, 'EncountersCompletedCache', t => h1Arr(v).some(e => h1Truthy(t[e]))),
    RequiredKillsThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1RunKills(cr, h1Arr(v)) > 0); },
    RequiredAnyKillsThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1RunKills(cr, h1Arr(v)) > 0); },
    RequiredNotActivatedThisRun: (v, ctx) => h1CrTable(ctx, 'ActivationRecord', t => !h1Truthy(t[v]), true),
    RequiredIdsNotActivatedThisRun: (v, ctx) => h1CrTable(ctx, 'ActivationRecord', t => !h1Arr(v).some(id => h1Truthy(t[id])), true),
    RequiredFalseInteractionThisRun: (v, ctx) => h1CrTable(ctx, 'NPCInteractions', t => !h1Truthy(t[v]), true),
    RequiredUsedAssistInRoomThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const rh = cr.RoomHistory || {}; return _h1bool(!Object.values(rh).some(room => room && room.Name === v && !h1Truthy(room.UsedAssist))); },
    RequiredAnyPlayedThisRun: (v, ctx) => h1CrTable(ctx, 'SpeechRecord', t => h1Arr(v).some(k => h1ListHas(t, k))),
    RequiredFalsePlayedThisRoom: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const list = cr.CurrentRoom && cr.CurrentRoom.VoiceLinesPlayed; return _h1bool(!h1Arr(v).some(k => h1ListHas(list, k))); },
    RequiredSupportAINames: (v, ctx) => h1CrTable(ctx, 'SupportAINames', t => h1Arr(v).every(k => h1Truthy(t[k]))),
    RequiredFalseSupportAINames: (v, ctx) => h1CrTable(ctx, 'SupportAINames', t => !h1Arr(v).some(k => h1Truthy(t[k])), true),
    RequiredLootChoices: () => H1_LIVE('Reads the live number of loot choices being offered, computed during reward generation.'),
    RequiredMinWeaponUpgrades: () => H1_LIVE('Reads the live Daedalus-hammer pickup count plus the current room\u2019s chosen reward.'),
    RequiredMaxWeaponUpgrades: () => H1_LIVE('Reads the live Daedalus-hammer pickup count plus the current room\u2019s chosen reward.'),
    RequiredConsumablesThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const rec = cr.ConsumableRecord || {}; const count = h1Arr(v && v.Names).reduce((s, n) => s + h1Num(rec[n]), 0); return _h1bool(count >= (v && v.Count)); },
    RequiredMinCaughtFishThisRun: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); return _h1bool(h1SumValues(cr.CaughtFish) >= v); },
    RequiredPurchasedWorldItemCountMin: () => H1_LIVE('Counts purchased (despawned) store items in the current room - live world state.'),
    RequiredPurchasedWorldItemCountMax: () => H1_LIVE('Counts purchased (despawned) store items in the current room - live world state.'),
    RequiresFishingPointInRoom: () => H1_LIVE('Reads whether the current room has a live fishing point.'),

    // ===== LIVE ONLY: combat / audio / active enemies / UI =====
    RequiredLastKilledByUnits: (v, ctx) => _h1bool(h1Arr(v).includes(h1Gs(ctx, 'LastKilledByUnitName'))),
    RequiredLastKilledByWeaponNames: (v, ctx) => _h1bool(h1Arr(v).includes(h1Gs(ctx, 'LastKilledByWeaponName'))),
    RequiredMaxSupportAINames: () => H1_LIVE('Counts live active support-AI enemies in the room.'),
    RequiredUnitAlive: () => H1_LIVE('Queries whether a unit is alive in the live room.'),
    RequiredUnitNotAlive: () => H1_LIVE('Queries whether a unit is alive in the live room.'),
    RequiredBossPhase: () => H1_LIVE('Reads the live boss\u2019s current combat phase.'),
    RequiredAmbientTrackName: () => H1_LIVE('Reads the live ambient music track name.'),
    RequiredAmbientTrackNameMatch: () => H1_LIVE('Compares the live ambient music track against the queued track.'),
    RequiresAmbientMusicId: () => H1_LIVE('Reads the live ambient music id.'),
    RequiresNullAmbientMusicId: () => H1_LIVE('Reads the live ambient music id.'),

    // ===== DEAD DATA (no engine evaluation) =====
    RequiredActiveMetaPointMax: () => H1_LIVE('Unimplemented field (engine has no branch for it; likely a typo for RequiredActiveMetaPointsMax).'),
    RequiredTextLinesThis: () => H1_LIVE('Unimplemented field (engine has no branch for it; likely a truncated RequiredTextLinesThisRun).'),
};

// Index-paired fields whose VALUE is only meaningful with a sibling index field;
// they are evaluated by the primary handler reading the sibling from ``all``.
// The index siblings themselves are no-ops (handled with their primary).
const H1_INDEX_SIBLINGS = new Set([
    'RequiredMaxWeaponUpgradeIndex', 'RequiredFalseMaxWeaponUpgradeIndex', 'RequiredCountOfTraitsCount',
]);

// ---- shared field helpers ----------------------------------------------------

// Count runs cleared = CurrentRun.Cleared (if resolvable) + RunHistory[i].Cleared.
// On a Zagreus' Journey (Hades Biomes) modded H2 save the ported Hades 1 runs
// are not in this save's RunHistory; the mod tracks the cleared-run count in
// GameState.ModsNikkelMHadesBiomesClearedRunsCache instead, so prefer that when
// present (a vanilla H1 save never carries it).
function h1RunsCleared(ctx) {
    const cache = h1Gs(ctx, 'ModsNikkelMHadesBiomesClearedRunsCache');
    if (typeof cache === 'number') return cache;
    let n = 0;
    const hist = h1Gs(ctx, 'RunHistory');
    if (hist && typeof hist === 'object') {
        for (const r of Object.values(hist)) if (r && h1Truthy(r.Cleared)) n += 1;
    }
    if (ctx.currentRun && h1Truthy(ctx.currentRun.Cleared)) n += 1;
    return n;
}

// Count completed runs = #RunHistory. As with cleared runs above, a Hades Biomes
// modded H2 save keeps the ported completed-run count in
// GameState.ModsNikkelMHadesBiomesCompletedRunsCache rather than this save's
// RunHistory, so prefer that cache when present.
function h1CompletedRuns(ctx) {
    const cache = h1Gs(ctx, 'ModsNikkelMHadesBiomesCompletedRunsCache');
    if (typeof cache === 'number') return cache;
    return h1Len(h1Gs(ctx, 'RunHistory'));
}

// HasSeenRoom: persistent RoomCountCache, OR seen in the resolvable current run.
function h1HasSeenRoom(ctx, room) {
    const rc = h1Gs(ctx, 'RoomCountCache') || {};
    if (h1Num(rc[room]) > 0) return true;
    const cr = ctx.currentRun;
    if (cr) {
        if (cr.CurrentRoom && cr.CurrentRoom.Name === room) return true;
        if (h1Num((cr.RoomCountCache || {})[room]) > 0) return true;
    }
    return false;
}

// Whether the static Mirror tables (shipped in data-hades1.json's
// h1SaveEvalStatic) are present, so the active-meta-upgrade gates can be
// resolved. False only in a build / test that didn't load them.
function h1MetaStaticReady() {
    const sd = h1SaveEvalStatic || {};
    return Array.isArray(sd.shrineUpgradeOrder)
        && typeof sd.metaUpgradeOrderLength === 'number'
        && typeof sd.strikeThroughChangeValue === 'number';
}
const _META_STATIC_REASON = 'Needs the Mirror-of-Night order tables (shrine order, row count, strike-through value) - not loaded.';

// IsMetaUpgradeActive(name) port (MetaUpgrades.lua:1970). Shrine (Pact)
// upgrades are always active; a Mirror talent is active only if it is the
// selected side of its row (GameState.MetaUpgradesSelected) and that row
// isn't struck through by the MetaUpgradeStrikeThroughShrineUpgrade Pact
// (which nulls ``abs(level * ChangeValue)`` rows from the end). Assumes
// h1MetaStaticReady().
function h1IsMetaUpgradeActive(ctx, name) {
    const sd = h1SaveEvalStatic;
    if (sd.shrineUpgradeOrder.includes(name)) return true;
    const m = h1Gs(ctx, 'MetaUpgrades') || {};
    const nulled = Math.abs(h1Num(m.MetaUpgradeStrikeThroughShrineUpgrade) * sd.strikeThroughChangeValue);
    const limit = sd.metaUpgradeOrderLength - nulled;
    const selected = h1Gs(ctx, 'MetaUpgradesSelected') || {};
    const rows = Object.keys(selected).map(Number).filter(k => !Number.isNaN(k)).sort((a, b) => a - b);
    for (const k of rows) {
        if (k > limit) return false; // this row (and all later) is nulled
        if (selected[k] === name) return true;
    }
    return false;
}

// GetNumMetaUpgrades(name) port (RunManager.lua:2310): in-run fast-path
// (CurrentRun.MetaUpgradeCache already reflects the active set), else the
// persistent level only when the upgrade is currently active, else 0.
function h1MetaUpgradeLevel(ctx, name) {
    const cr = ctx.currentRun;
    if (cr && cr.MetaUpgradeCache && cr.MetaUpgradeCache[name] != null) return h1Num(cr.MetaUpgradeCache[name]);
    if (!h1IsMetaUpgradeActive(ctx, name)) return 0;
    const m = h1Gs(ctx, 'MetaUpgrades') || {};
    return h1Num(m[name]);
}

// GetNumUnlockedWeaponUpgrades port (WeaponUpgradeScripts.lua:490): count the
// player's unlocked weapon-upgrade slots, EXCLUDING each weapon's
// StartsUnlocked base-aspect slot (h1SaveEvalStatic.weaponUpgradeSlots[*].startsUnlocked).
// ``maxed`` keeps the legacy "count maxed (==max) slots" variant; both honour the
// base-aspect exclusion.
function h1CountWeaponUnlocks(ctx, maxed) {
    const w = h1Gs(ctx, 'WeaponUnlocks') || {};
    const slots = (h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeSlots) || {};
    let n = 0;
    for (const [weaponName, weapon] of Object.entries(w)) {
        if (!weapon || typeof weapon !== 'object') continue;
        const wSlots = slots[weaponName] || {};
        for (const [idx, lvl] of Object.entries(weapon)) {
            if (wSlots[idx] && wSlots[idx].startsUnlocked) continue;
            const max = (wSlots[idx] && wSlots[idx].max) || 5;
            if (maxed ? lvl === max : (lvl != null && lvl !== 0)) n += 1;
        }
    }
    return n;
}
function h1WeaponStaticReady() {
    return !!(h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeSlots);
}
const _WEAPON_STATIC_REASON = 'Needs the weapon-upgrade slot table - not loaded.';

// Whether the per-god LootData trait index (h1SaveEvalStatic.godLootTraitIndex /
// godTraitNamesForShop) is present, so RequiredGodLoot / RequiredNoGodBoons can
// resolve. False only in a build / test that didn't load it.
function h1GodLootStaticReady() {
    return !!(h1SaveEvalStatic && h1SaveEvalStatic.godLootTraitIndex
        && Array.isArray(h1SaveEvalStatic.godTraitNamesForShop));
}
const _GODLOOT_STATIC_REASON = 'Needs the per-god LootData trait index - not loaded.';

// Whether the keepsake chamber-threshold table (h1SaveEvalStatic.keepsakeMaxChambers)
// is present, so RequiresMaxKeepsake can resolve. False only in a build / test
// that didn't load it.
function h1KeepsakeStaticReady() {
    return !!(h1SaveEvalStatic && h1SaveEvalStatic.keepsakeMaxChambers);
}
const _KEEPSAKE_STATIC_REASON = 'Needs the keepsake chamber-threshold table - not loaded.';
const _KEEPSAKE_RARITY_REASON = 'Companion-keepsake mastery is gated by assist-NPC upgrade levels, which this save slice does not carry.';

// GetWeaponUpgradeLevel port (WeaponUpgradeScripts.lua:395): the level the player
// has bought for a weapon aspect = GameState.WeaponUnlocks[weapon][index] (0 if
// none). The engine also returns 0 when the slot is buy/upgrade-disabled (a
// static DisableBuy flag - unused in vanilla - or unmet aspect-unlock
// GameStateRequirements); we omit that precondition, matching h1MaxWeaponUpgrade
// (the affected dialogues gate on aspects the player has demonstrably invested in).
function h1WeaponUpgradeLevel(ctx, weapon, index) {
    const w = h1Gs(ctx, 'WeaponUnlocks') || {};
    return h1Num(w[weapon] && w[weapon][index]);
}

// Resolve a {weapon, index} pointer to its static slot record from
// h1SaveEvalStatic.weaponUpgradeSlots ({trait?, reqTrait?, max?, costs?,
// startsUnlocked?}), or null when the table or slot is missing.
function h1WeaponSlot(weapon, index) {
    const slots = (h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeSlots) || {};
    return (slots[weapon] && slots[weapon][index]) || null;
}

// GetWeaponUpgradeTrait port (WeaponUpgradeScripts.lua:770): resolve a
// {weapon, index} slot pointer to its trait name. Aspect slots carry a static
// ``trait`` (TraitName); the base slot carries ``reqTrait``
// (RequiredInvestmentTraitName) but only counts once its level > 0.
function h1WeaponUpgradeTrait(ctx, weapon, index) {
    const slot = h1WeaponSlot(weapon, index);
    if (!slot) return null;
    if (slot.trait) return slot.trait;
    if (slot.reqTrait && h1WeaponUpgradeLevel(ctx, weapon, index) > 0) return slot.reqTrait;
    return null;
}

// GetSuperLockKeysSpentOnWeapon port (WeaponUpgradeScripts.lua): total upgrade
// keys spent across every aspect of ``weapon`` = sum of each slot's per-level
// Costs[1..GetWeaponUpgradeLevel].
function h1WeaponKeysSpent(ctx, weapon) {
    const slots = (h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeSlots) || {};
    const wSlots = slots[weapon] || {};
    let total = 0;
    for (const idx of Object.keys(wSlots)) {
        const lvl = h1WeaponUpgradeLevel(ctx, weapon, idx);
        const costs = wSlots[idx].costs || [];
        for (let i = 0; i < lvl; i++) total += h1Num(costs[i]);
    }
    return total;
}
const _META_POINTS_REASON = 'Needs the save\u2019s spent-Darkness cache (SpentMetaPointsCache) - not in this slice.';

// RequiresBestClearTimeLastRun port (RunManager.lua:3525): the last run must be a
// new (or tied) best clear time. prevRun = RunHistory[#] (highest key). If there
// is no last run or it wasn't cleared the gate is a no-op (met). Otherwise the
// record is the fastest GameplayTime over all same-mode (God Mode on/off must
// match prevRun), past-the-final-boss (RunDepthCache > 44), cleared runs that
// carry a GameplayTime; prevRun itself is one such candidate, so the gate passes
// iff prevRun's time is no slower than that record.
function h1BestClearTimeLastRun(ctx) {
    const hist = h1Gs(ctx, 'RunHistory');
    if (!hist || typeof hist !== 'object') return H1_OK;
    let prev = null, prevKey = -Infinity;
    for (const [k, r] of Object.entries(hist)) {
        const n = Number(k);
        if (Number.isFinite(n) && n > prevKey) { prevKey = n; prev = r; }
    }
    if (!prev || !h1Truthy(prev.Cleared)) return H1_OK;
    if (prev.GameplayTime == null) return H1_LIVE(_BEST_CLEAR_REASON);
    const godMode = !!prev.EasyModeLevel;
    let record = Infinity;
    for (const r of Object.values(hist)) {
        if (!r || !h1Truthy(r.Cleared) || r.GameplayTime == null) continue;
        if (h1Num(r.RunDepthCache) <= 44) continue;
        if (!!r.EasyModeLevel !== godMode) continue;
        if (r.GameplayTime < record) record = r.GameplayTime;
    }
    return _h1bool(h1Num(prev.GameplayTime) <= record);
}
const _BEST_CLEAR_REASON = 'Needs the last run\u2019s clear time (GameplayTime) - not in this slice.';

// RequiredMaxWeaponUpgrade(+Index): IsWeaponUpgradeMaxed(weapon, index) - the
// given weapon aspect (``index``) is fully levelled, i.e. WeaponUnlocks[weapon]
// [index] == 5. This is a "is maxed?" test, NOT a max-value comparison (the
// similarly-named plural RequiredMaxWeaponUpgrades is the comparison one, handled
// separately as live-only). ``negate`` for the RequiredFalse* variant. The engine
// also gates the result on the aspect being buyable (IsBuyWeaponUpgradeDisabled:
// a static DisableBuy flag - unused in vanilla - or unmet aspect-unlock
// GameStateRequirements); we omit that precondition since it needs the static
// WeaponUpgradeData tables this build doesn't ship, and the only dialogues using
// this field gate on always-unlocked base aspects where it is a no-op.
function h1MaxWeaponUpgrade(ctx, weapon, index, negate) {
    if (weapon == null || index == null) return H1_OK; // engine only checks when both present
    const w = h1Gs(ctx, 'WeaponUnlocks') || {};
    const isMax = !!(w[weapon] && w[weapon][index] === 5);
    return _h1bool(negate ? !isMax : isMax);
}

// GetTotalEarnedBounties (RunManager.lua:2086): for each weapon's per-room
// record, add the threshold-count when the room entry is a table, else +1 for a
// scalar entry (an older single-threshold record).
function h1CountBounties(ctx) {
    const rec = h1Gs(ctx, 'RecordLastClearedShrineReward') || {};
    let n = 0;
    for (const byRoom of Object.values(rec)) {
        if (!byRoom || typeof byRoom !== 'object') continue;
        for (const roomData of Object.values(byRoom)) {
            n += (roomData && typeof roomData === 'object') ? Object.keys(roomData).length : 1;
        }
    }
    return n;
}

// Count quests with QuestStatus == "CashedOut".
function h1CountCashedOutQuests(ctx) {
    const q = h1Gs(ctx, 'QuestStatus') || {};
    let n = 0;
    for (const status of Object.values(q)) if (status === 'CashedOut') n += 1;
    return n;
}

function h1SumValues(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    let s = 0;
    for (const v of Object.values(obj)) s += h1Num(v);
    return s;
}

// Value-membership in a Lua list (array or object-of-values), Contains-style.
function h1ListHas(list, value) {
    if (!list || typeof list !== 'object') return false;
    return Object.values(list).includes(value);
}

// Sum of a run's per-room kills for any of the listed enemy types.
function h1RunKills(run, enemyNames) {
    if (!run) return 0;
    const rh = run.RoomHistory;
    if (!rh || typeof rh !== 'object') return 0;
    let total = 0;
    for (const room of Object.values(rh)) {
        const kills = room && room.Kills;
        if (kills && typeof kills === 'object') {
            for (const e of enemyNames) total += h1Num(kills[e]);
        }
    }
    return total;
}

// Count runs in history whose WeaponsCache contains ``weapon``.
function h1RunsWithWeapon(ctx, weapon) {
    const hist = h1Gs(ctx, 'RunHistory');
    if (!hist || typeof hist !== 'object') return 0;
    let n = 0;
    for (const run of Object.values(hist)) {
        if (run && run.WeaponsCache && h1Truthy(run.WeaponsCache[weapon])) n += 1;
    }
    return n;
}

// CurrentRun current-room name predicate, honouring the death-area room.
function h1CrRoomName(ctx, pred, negateDefault) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    const name = (cr.Hero && cr.Hero.IsDead && cr.CurrentDeathAreaRoom) ? cr.CurrentDeathAreaRoom.Name
        : (cr.CurrentRoom && cr.CurrentRoom.Name);
    if (name == null) return negateDefault ? H1_OK : H1_UNMET;
    return _h1bool(pred(name));
}

function h1CrRoomField(ctx, field, pred) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    const room = cr.CurrentRoom || {};
    return _h1bool(pred(room[field]));
}

function h1CrNum(ctx, field, pred) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    return _h1bool(pred(h1Num(cr[field])));
}

function h1CrTable(ctx, field, pred, _negateMissing) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    const t = cr[field] || {};
    return _h1bool(pred(t));
}

function h1CrSeenRoomInRun(ctx, room, negate) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    const seen = (cr.CurrentRoom && cr.CurrentRoom.Name === room) || h1Num((cr.RoomCountCache || {})[room]) > 0;
    return _h1bool(negate ? !seen : seen);
}

// Predicate on the room the hero died in, mirroring the engine's DidFailRun
// gate (run not cleared AND hero dead). On a run that did NOT fail, the positive
// gates (RequiredDeathRoom / RequiredAnyDeathRooms) become ineligible while the
// "False" variants pass - the caller picks via notFailedResult.
function h1CrDeath(ctx, pred, notFailedResult) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    const failed = h1Truthy(cr.Hero && cr.Hero.IsDead) && !h1Truthy(cr.Cleared);
    if (!failed) return notFailedResult || H1_OK;
    const name = cr.CurrentRoom && cr.CurrentRoom.Name;
    return _h1bool(name != null && pred(name));
}

function h1CrDeathEncounter(ctx, pred) {
    const cr = _h1cr(ctx);
    if (!cr) return H1_WRONGSAVE(_CR_REASON);
    if (!h1Truthy(cr.Hero && cr.Hero.IsDead)) return H1_OK;
    const enc = cr.CurrentRoom && cr.CurrentRoom.Encounter && cr.CurrentRoom.Encounter.Name;
    return _h1bool(enc != null && pred(enc));
}

// Requirement keys owned by ``requirementSetStatus`` (textline records) - skipped
// by this evaluator so they aren't double-counted.
const H1_TEXTLINE_REQ_KEYS = new Set([
    'RequiredTextLines', 'RequiredAnyTextLines', 'RequiredAnyOtherTextLines', 'RequiredFalseTextLines',
    'RequiredMinAnyTextLines', 'RequiredMaxAnyTextLines',
    'RequiredTextLinesThisRun', 'RequiredAnyTextLinesThisRun', 'RequiredFalseTextLinesThisRun',
    'RequiredTextLinesThisRoom', 'RequiredFalseTextLinesThisRoom',
    'RequiredQueuedTextLines', 'RequiredAnyQueuedTextLines', 'RequiredFalseQueuedTextLines',
    'RequiredAnyTextLinesLastRun', 'RequiredFalseTextLinesLastRun', 'RequiredTextLinesLastRun',
    'MinRunsSinceAnyTextLines', 'MaxRunsSinceAnyTextLines',
]);

// ---- public API --------------------------------------------------------------

// Evaluate a Hades 1 textline's ``otherRequirements`` (the structured named-field
// map) against the H1 save context ``ctx`` = ``{ gs, currentRun, prevRun,
// runHistory, saveInRun }``. Returns { status, clauses } in the same shape as
// evaluateOtherRequirements. ``ctx`` is null when no save is loaded.
export function evaluateH1OtherRequirements(otherRequirements, ctx) {
    const keys = Object.keys(otherRequirements || {}).filter(
        k => !H1_TEXTLINE_REQ_KEYS.has(k) && !H1_INDEX_SIBLINGS.has(k));
    if (keys.length === 0) return { status: 'met', clauses: [] };
    if (!ctx) {
        const clauses = keys.map(key => ({ key, status: 'unknown', reason: 'No save loaded.' }));
        return { status: 'unknown', clauses };
    }
    const clauses = [];
    for (const key of keys) {
        const handler = H1_FIELD_EVALS[key];
        let r;
        if (!handler) {
            r = { status: 'unknown', reason: `Requirement "${key}" is not yet resolved against the save.` };
        } else {
            r = handler(otherRequirements[key], ctx, otherRequirements) || { status: 'unknown', reason: 'Unrecognised condition shape.' };
        }
        clauses.push({ key, status: r.status, reason: r.status === 'unknown' ? (r.reason || null) : null, ...(r.kind ? { kind: r.kind } : {}) });
    }
    return { status: h1CombineAnd(clauses.map(c => c.status)), clauses };
}

// AND-combine: any unmet -> unmet; else any unknown -> unknown; else met.
function h1CombineAnd(statuses) {
    if (statuses.includes('unmet')) return 'unmet';
    if (statuses.includes('unknown')) return 'unknown';
    return 'met';
}

// ---- permanence (blocked vs unobtainable) ------------------------------------
//
// Two families of H1 ``otherRequirements`` gate are not merely *unmet now* but
// *permanently unmet*, so the dialogue is unobtainable rather than just blocked:
//
//  1. "max" gates that read a monotonic-up persistent counter only ever growing
//     over the profile's lifetime in normal play (run counts, lifetime
//     resources, one-way weapon-aspect unlocks/upgrades, cumulative NPC / room
//     interaction counts, cashed-out quests). Once the counter passes the cap it
//     can never come back down.
//  2. "require-absence" gates that forbid a monotonic, append-only persistent
//     event having happened (a played voiceline, an enemy kill, a seen room, a
//     weapon unlock, a viewed screen). The engine only ever sets / increments
//     these records and never clears them in normal play, so once the forbidden
//     event is on record the gate can never become met again.
//
// (Story-reset wipes both, the same documented caveat as the H2 permanent-state
// allowlist; permanence here describes normal play.)
//
// Each entry returns true when the gate is permanently unmet given the current
// GameState. Conservative: only the already-surpassed / already-happened case is
// permanent. Gates over resettable / per-run / respec-able / removable state
// (depth, last stands, health, meta-upgrade levels, Heat, support AI) and over
// removable cosmetics (RequiredFalseCosmetics, whose decor entries toggle back
// off) are intentionally absent and stay "blocked".
// GameState.Flags entries whose value, once observed in a save, can never change
// in the direction that would satisfy a currently-unmet flag gate:
//  - FIXED-PER-SAVE: ``HardMode`` (Hell Mode) is read from the config exactly
//    once and baked into GameState.Flags at save creation (RunManager.lua
//    StartNewGame); it is never reassigned, so a save is permanently Hell or
//    permanently not. Both directions are permanent.
//  - MONOTONIC-TRUE: ``ShrineUnlocked`` (MetaUpgrades.lua) and ``AspectsUnlocked``
//    (RoomManager.lua) are one-way unlocks only ever set true. A currently-true
//    unlock can never go false; a currently-false one can still unlock later, so
//    only the "already true" direction is permanent.
// Every other dialogue flag (InFlashback / AllowFlashback transient scene state,
// NyxChaosReunionInProgress, the Persephone* ~7-run cycle, the Dusa* rehire
// story state) toggles during normal play and stays merely blocked.
const H1_FIXED_PER_SAVE_FLAGS = new Set(['HardMode']);
const H1_MONOTONIC_TRUE_FLAGS = new Set(['ShrineUnlocked', 'AspectsUnlocked']);

const H1_PERMANENT_UNMET_EVALS = {
    RequiredMaxCompletedRuns: (v, ctx) => h1CompletedRuns(ctx) > v,
    RequiredMaxRunsCleared: (v, ctx) => h1RunsCleared(ctx) > v,
    RequiredMaxRunsWithWeapons: (v, ctx) => Object.entries(v || {}).some(([w, c]) => h1RunsWithWeapon(ctx, w) > c),
    RequiredMaxUnlockedWeaponEnchantments: (v, ctx) => h1WeaponStaticReady() && h1CountWeaponUnlocks(ctx, false) > v,
    RequiredMaxNPCInteractions: (v, ctx) => { const n = h1Gs(ctx, 'NPCInteractions') || {}; return Object.entries(v || {}).some(([k, c]) => n[k] != null && h1Num(n[k]) > c); },
    RequiredMaxTimesSeenRoom: (v, ctx) => { const rc = h1Gs(ctx, 'RoomCountCache') || {}; return Object.entries(v || {}).some(([r, c]) => rc[r] != null && h1Num(rc[r]) > c); },
    RequiredMaxQuestsComplete: (v, ctx) => h1CountCashedOutQuests(ctx) > v,
    RequiredLifetimeResourcesGainedMax: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesGained') || {}; return Object.entries(v || {}).some(([k, a]) => h1Num(r[k]) > a); },
    RequiredLifetimeResourcesSpentMax: (v, ctx) => { const r = h1Gs(ctx, 'LifetimeResourcesSpent') || {}; return Object.entries(v || {}).some(([k, a]) => h1Num(r[k]) > a); },
    // Aspect upgrades are one-way; an already-maxed aspect (==5) can never
    // un-max, so a "must NOT be maxed" gate is permanently unmet once maxed.
    RequiredFalseMaxWeaponUpgrade: (weapon, ctx, all) => {
        const idx = all && all.RequiredFalseMaxWeaponUpgradeIndex;
        if (weapon == null || idx == null) return false;
        const w = h1Gs(ctx, 'WeaponUnlocks') || {};
        return !!(w[weapon] && w[weapon][idx] === 5);
    },

    // ===== require-absence of a monotonic, append-only persistent event =====
    // "Must NOT have played voiceline cue X" - the global SpeechRecord is only
    // ever set true (AudioScripts / UtilityScripts) and never cleared in normal
    // play, so a recorded cue can never be un-played.
    RequiredFalsePlayed: (v, ctx) => { const s = h1Gs(ctx, 'SpeechRecord') || {}; return h1Arr(v).some(k => h1Truthy(s[k])); },
    // "Must NOT have killed enemy X" - GameState.EnemyKills counts only increment.
    RequiredFalseKills: (v, ctx) => { const k = h1Gs(ctx, 'EnemyKills') || {}; return h1Arr(v).some(e => h1Num(k[e]) > 0); },
    // "Must NOT have seen room X" - the persistent RoomCountCache only increments
    // (h1HasSeenRoom reads it; the null currentRun here ignores the per-run copy).
    RequiredFalseSeenRooms: (v, ctx) => h1Arr(v).some(r => h1HasSeenRoom(ctx, r)),
    // "Must NOT have weapon X unlocked" - WeaponsUnlocked is a one-way unlock flag.
    RequiredFalseWeaponsUnlocked: (v, ctx) => { const w = h1Gs(ctx, 'WeaponsUnlocked') || {}; return h1Arr(v).some(k => h1Truthy(w[k])); },
    // "Must NOT have viewed screen X" - ScreensViewed is a write-once view record.
    RequiredScreenViewedFalse: (v, ctx) => { const s = h1Gs(ctx, 'ScreensViewed') || {}; return h1Truthy(s[v]); },
    // "Must NOT have flag F" - permanently unmet once a fixed-per-save (HardMode)
    // or one-way unlock (ShrineUnlocked / AspectsUnlocked) flag is already true,
    // as it can never return to false. Toggleable story flags are excluded.
    RequiredFalseFlags: (v, ctx) => {
        const f = h1Gs(ctx, 'Flags') || {};
        return h1Arr(v).some(k => h1Truthy(f[k]) && (H1_FIXED_PER_SAVE_FLAGS.has(k) || H1_MONOTONIC_TRUE_FLAGS.has(k)));
    },
    // "Must have flag F" - permanently unmet only for a fixed-per-save flag
    // (HardMode) that is already false, since it can never become true. One-way
    // unlock flags can still flip true through normal progression, so a
    // currently-false unlock stays blocked, not unobtainable.
    RequiredTrueFlags: (v, ctx) => {
        const f = h1Gs(ctx, 'Flags') || {};
        return h1Arr(v).some(k => H1_FIXED_PER_SAVE_FLAGS.has(k) && !h1Truthy(f[k]));
    },
};

// Whether a Hades 1 textline's flat ``otherRequirements`` map is *permanently*
// unmet against the persistent GameState slice (one of its monotonic "max"
// gates is already surpassed and can never recover). Returns 'unmet' or null.
// ``gameStateSlice`` is the persisted H1 GameState slice; the monotonic gates
// read only GameState tables, so a minimal ``ctx`` (no current/prev run) is used.
export function evaluateH1OtherReqPermanence(otherRequirements, gameStateSlice) {
    if (!otherRequirements || !gameStateSlice) return null;
    for (const [field, value] of Object.entries(otherRequirements)) {
        if (h1FieldPermanentlyUnmet(field, value, gameStateSlice, otherRequirements)) return 'unmet';
    }
    return null;
}

// Whether a single H1 ``otherRequirements`` field is a permanently-unmet
// monotonic "max" gate given the GameState slice - its one-way counter is
// already past the cap and can never come back down. ``allFields`` supplies
// sibling fields a gate may pair with (e.g. the weapon-aspect index). Returns a
// boolean; used by the tracer / detail view to upgrade the gate's dot to
// "unobtainable" and to explain the lock.
export function h1FieldPermanentlyUnmet(field, value, gameStateSlice, allFields = {}) {
    if (!gameStateSlice) return false;
    const evalFn = H1_PERMANENT_UNMET_EVALS[field];
    if (!evalFn) return false;
    const ctx = { gs: gameStateSlice, currentRun: null, prevRun: null, runHistory: null };
    return !!evalFn(value, ctx, allFields);
}

// Dialogue-trigger context per Hades 1 owner, deciding whether a dialogue's
// ``CurrentRun.*`` gates resolve from a loaded save and against which save type
// (see ``currentRunResolvable`` in gamestate-eval.js for the full rationale):
//   'hub' - speaks only in the House of Hades (reads the just-ended run held in
//           a hub save).
//   'run' - speaks mid-descent (reads the live current run, so needs an in-run
//           "_Temp" save).
//   'both' - the same owner speaks in the House AND during a run.
// Classification verified against the Hades 1 game data (NPCData / EnemyData /
// EncounterData / RoomData / GiftData). Note two non-obvious cases: the Surface
// (Greece) is the tail of a *live* escape run - CurrentRun is never nilled going
// through Hades' door - so NPC_Persephone_Home_01 reads the live run ('run'),
// while the post-ending House Persephone (NPC_Persephone_01) is 'hub'. Megaera
// (NPC_FurySister_01) is both a giftable House NPC and the speaker of her
// boss-fight VO, so 'both'. Charon has no House persona in H1 (his shop trigger
// is placed in biome rooms), so NPC_Charon_01 is 'run'.
export const H1_OWNER_RUN_CONTEXT = {
    // hub: House of Hades speakers
    NPC_Nyx_01: 'hub', NPC_Dusa_01: 'hub', NPC_Hades_01: 'hub',
    NPC_Achilles_01: 'hub', NPC_Hypnos_01: 'hub', NPC_Orpheus_01: 'hub',
    NPC_Cerberus_01: 'hub', NPC_Thanatos_01: 'hub', NPC_Persephone_01: 'hub',
    TrainingMelee: 'hub',
    // run: boon-pickup gods
    HermesUpgrade: 'run', DemeterUpgrade: 'run', AresUpgrade: 'run',
    PoseidonUpgrade: 'run', ArtemisUpgrade: 'run', ZeusUpgrade: 'run',
    AthenaUpgrade: 'run', DionysusUpgrade: 'run', AphroditeUpgrade: 'run',
    TrialUpgrade: 'run',
    // run: in-biome bosses / enemies / NPCs / story scenes / narrator
    Harpy: 'run', Harpy2: 'run', Harpy3: 'run',
    Hades: 'run', Theseus: 'run', Minotaur: 'run', Charon: 'run',
    NPC_Charon_01: 'run', NPC_Sisyphus_01: 'run', NPC_Patroclus_01: 'run',
    NPC_Eurydice_01: 'run', NPC_Bouldy_01: 'run', NPC_Cerberus_Field_01: 'run',
    NPC_Thanatos_Field_01: 'run', NPC_Persephone_Home_01: 'run',
    NPC_Orpheus_Story_01: 'run', NPC_Nyx_Story_01: 'run', Storyteller: 'run',
    // both: speaks in the House and during a run
    NPC_FurySister_01: 'both', CharProtag: 'both',
};
