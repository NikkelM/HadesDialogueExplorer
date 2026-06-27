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
//                   the remainder (meta/keepsake/weapon-upgrade COST tables, codex
//                   layout) still aren't shipped and report 'unknown' with a reason.
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
    'RecordLastClearedShrineReward', 'SpeechRecord',
];

// Top-level CurrentRun keys the evaluator reads (captured for an in-run / hub
// CurrentRun snapshot). Hero is pruned to the read fields; RoomHistory is pruned
// to per-room {Kills}; CurrentRoom to its read fields.
export const H1_CURRENTRUN_SLICE_KEYS = [
    'Cleared', 'RunDepthCache', 'BiomeDepthCache', 'LootTypeHistory', 'TraitCache',
    'RoomCountCache', 'EncountersCompletedCache', 'EncountersOccurredCache',
    'ActivationRecord', 'NPCInteractions',
    'SpeechRecord', 'SupportAINames', 'MetaUpgradeCache',
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

// ---- per-field handlers ------------------------------------------------------
//
// Each handler is ``(value, ctx) => { status, reason?, kind? }`` where ``value``
// is the dialogue's requirement value for that field and ``ctx`` is the H1 save
// context ``{ gs, currentRun, prevRun, runHistory, saveInRun }``.

// Convenience: require a CurrentRun slice (resolved owner-context), else wrong-save.
function _h1cr(ctx) { return ctx ? ctx.currentRun : null; }
const _CR_REASON = 'Reads CurrentRun.* - current-run state; load the matching save type to resolve it (an in-run "_Temp" save for run dialogue, a hub save for hub dialogue).';

const H1_FIELD_EVALS = {
    // ===== PERSISTENT: GameState flags / values =====
    RequiredTrueFlags: (v, ctx) => { const f = h1Gs(ctx, 'Flags') || {}; return _h1bool(h1Arr(v).every(k => h1Truthy(f[k]))); },
    RequiredFalseFlags: (v, ctx) => { const f = h1Gs(ctx, 'Flags') || {}; return _h1bool(!h1Arr(v).some(k => h1Truthy(f[k]))); },
    RequiredValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(Object.entries(v || {}).every(([k, val]) => gs[k] === val)); },
    RequiredFalseValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(!Object.entries(v || {}).some(([k, val]) => gs[k] === val)); },
    RequiredMinValues: (v, ctx) => { const gs = ctx.gs || {}; return _h1bool(Object.entries(v || {}).every(([k, min]) => h1Num(gs[k]) >= min)); },

    // ===== PERSISTENT: run counts =====
    RequiredCompletedRuns: (v, ctx) => _h1bool(h1Len(h1Gs(ctx, 'RunHistory')) === v),
    RequiredMinCompletedRuns: (v, ctx) => _h1bool(h1Len(h1Gs(ctx, 'RunHistory')) >= v),
    RequiredMaxCompletedRuns: (v, ctx) => _h1bool(h1Len(h1Gs(ctx, 'RunHistory')) <= v),
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

    // ===== PERSISTENT but needs static game-data tables this build omits =====
    RequiredAccumulatedMetaPoints: () => H1_NEEDS_STATIC('Needs the meta-upgrade cost tables (total accumulated Darkness) not shipped in this build.'),
    RequiredActiveMetaPointsMin: () => H1_NEEDS_STATIC('Needs the meta-upgrade cost tables (spent Darkness) not shipped in this build.'),
    RequiredActiveMetaPointsMax: () => H1_NEEDS_STATIC('Needs the meta-upgrade cost tables (spent Darkness) not shipped in this build.'),
    RequiredAllMetaUpgradesMaxed: () => H1_NEEDS_STATIC('Needs the meta-upgrade order / max-level tables not shipped in this build.'),
    RequiresMaxKeepsake: () => H1_NEEDS_STATIC('Needs the keepsake chamber-threshold tables not shipped in this build.'),
    RequiredMinSuperLockKeysSpentOnWeapon: () => H1_NEEDS_STATIC('Needs the weapon-upgrade cost tables not shipped in this build.'),
    RequiredCodexEntry: () => H1_NEEDS_STATIC('Needs the codex chapter/entry layout not shipped in this build.'),
    RequiredCodexEntriesMin: () => H1_NEEDS_STATIC('Needs the codex chapter/entry layout not shipped in this build.'),
    RequiresCodexFullyUnlocked: () => H1_NEEDS_STATIC('Needs the codex chapter/entry layout not shipped in this build.'),
    RequiredLastInteractedWeaponUpgrade: () => H1_NEEDS_STATIC('Needs the weapon-upgrade trait tables not shipped in this build.'),
    RequiredLastInteractedWeaponUpgradeMaxed: () => H1_NEEDS_STATIC('Needs the weapon-upgrade tables not shipped in this build.'),
    RequiredMinShrinePointThresholdClear: () => H1_NEEDS_STATIC('Needs the per-weapon boss-room shrine-clear records cross-referenced with static room data.'),
    RequiredCosmeticPurchaseable: () => H1_NEEDS_STATIC('Needs the conditional-item purchase definitions not shipped in this build.'),

    // ===== PREV RUN (GameState.RunHistory[#]) =====
    RequiresLastRunCleared: (v, ctx) => _h1bool(h1Truthy(ctx.prevRun && ctx.prevRun.Cleared)),
    RequiresLastRunNotCleared: (v, ctx) => _h1bool(!h1Truthy(ctx.prevRun && ctx.prevRun.Cleared)),
    RequiresBestClearTimeLastRun: () => H1_NEEDS_STATIC('Compares the last run\u2019s clear time against the run-history best, which this slice doesn\u2019t fully carry.'),
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
    RequiredGodLoot: () => H1_NEEDS_STATIC('Needs the per-god LootData trait index to test the hero\u2019s boons against a god.'),
    RequiredLootThisRun: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => h1Truthy(t[v])),
    RequiredFalseGodLoot: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => !h1Truthy(t[v]), true),
    RequiredFalseGodLoots: (v, ctx) => h1CrTable(ctx, 'LootTypeHistory', t => !h1Arr(v).some(k => h1Truthy(t[k])), true),
    RequiredNoGodBoons: () => H1_NEEDS_STATIC('Needs the IsGodTrait classification to test whether any equipped trait is a god boon.'),
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
    RequiredUsedAssistInRoomThisRun: () => H1_NEEDS_STATIC('Reads per-room assist usage from CurrentRun.RoomHistory, not carried in this slice.'),
    RequiredAnyPlayedThisRun: (v, ctx) => h1CrTable(ctx, 'SpeechRecord', t => h1Arr(v).some(k => h1ListHas(t, k))),
    RequiredFalsePlayedThisRoom: (v, ctx) => { const cr = _h1cr(ctx); if (!cr) return H1_WRONGSAVE(_CR_REASON); const list = cr.CurrentRoom && cr.CurrentRoom.VoiceLinesPlayed; return _h1bool(!h1Arr(v).some(k => h1ListHas(list, k))); },
    RequiredSupportAINames: (v, ctx) => h1CrTable(ctx, 'SupportAINames', t => h1Arr(v).every(k => h1Truthy(t[k]))),
    RequiredFalseSupportAINames: (v, ctx) => h1CrTable(ctx, 'SupportAINames', t => !h1Arr(v).some(k => h1Truthy(t[k])), true),
    RequiredLootChoices: () => H1_LIVE('Reads the live number of loot choices being offered, computed during reward generation.'),
    RequiredMinWeaponUpgrades: () => H1_LIVE('Reads the live Daedalus-hammer pickup count plus the current room\u2019s chosen reward.'),
    RequiredMaxWeaponUpgrades: () => H1_LIVE('Reads the live Daedalus-hammer pickup count plus the current room\u2019s chosen reward.'),
    RequiredConsumablesThisRun: () => H1_NEEDS_STATIC('Reads CurrentRun.ConsumableRecord, not carried in this slice.'),
    RequiredResourcesMin: () => H1_NEEDS_STATIC('Reads live current-run resources (Money / blood etc.), not carried in this slice.'),
    RequiredMinCaughtFishThisRun: () => H1_NEEDS_STATIC('Reads CurrentRun.CaughtFish, not carried in this slice.'),
    RequiredPurchasedWorldItemCountMin: () => H1_LIVE('Counts purchased (despawned) store items in the current room - live world state.'),
    RequiredPurchasedWorldItemCountMax: () => H1_LIVE('Counts purchased (despawned) store items in the current room - live world state.'),
    RequiresFishingPointInRoom: () => H1_LIVE('Reads whether the current room has a live fishing point.'),

    // ===== LIVE ONLY: combat / audio / active enemies / UI =====
    RequiredLastKilledByUnits: () => H1_LIVE('Reads the live "last killed by" unit, set transiently on death.'),
    RequiredLastKilledByWeaponNames: () => H1_LIVE('Reads the live "last killed by" weapon, set transiently on death.'),
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
function h1RunsCleared(ctx) {
    let n = 0;
    const hist = h1Gs(ctx, 'RunHistory');
    if (hist && typeof hist === 'object') {
        for (const r of Object.values(hist)) if (r && h1Truthy(r.Cleared)) n += 1;
    }
    if (ctx.currentRun && h1Truthy(ctx.currentRun.Cleared)) n += 1;
    return n;
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
// StartsUnlocked base-aspect slot (h1SaveEvalStatic.weaponUpgradeStartsUnlocked).
// ``maxed`` keeps the legacy "count maxed (==5) slots" variant; both honour the
// base-aspect exclusion.
function h1CountWeaponUnlocks(ctx, maxed) {
    const w = h1Gs(ctx, 'WeaponUnlocks') || {};
    const startsUnlocked = (h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeStartsUnlocked) || {};
    let n = 0;
    for (const [weaponName, weapon] of Object.entries(w)) {
        if (!weapon || typeof weapon !== 'object') continue;
        const skip = startsUnlocked[weaponName] || [];
        for (const [idx, lvl] of Object.entries(weapon)) {
            if (skip.includes(Number(idx))) continue;
            if (maxed ? lvl === 5 : (lvl != null && lvl !== 0)) n += 1;
        }
    }
    return n;
}
function h1WeaponStaticReady() {
    return !!(h1SaveEvalStatic && h1SaveEvalStatic.weaponUpgradeStartsUnlocked);
}
const _WEAPON_STATIC_REASON = 'Needs the weapon base-aspect (StartsUnlocked) table - not loaded.';

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
// A handful of H1 ``otherRequirements`` "max" gates read a monotonic-up
// persistent counter that only ever grows over the profile's lifetime in normal
// play (run counts, lifetime resources, one-way weapon-aspect unlocks/upgrades,
// cumulative NPC / room interaction counts, cashed-out quests). Once such a
// counter passes the gate's cap it can never come back down, so the gate is not
// merely *unmet now* but *permanently unmet* - the dialogue is unobtainable, not
// just blocked. (Story-reset wipes these, the same documented caveat as the H2
// permanent-state allowlist; permanence here describes normal play.)
//
// Each entry returns true when the gate is permanently unmet given the current
// GameState. Conservative: only the already-surpassed case is permanent. Gates
// over resettable / per-run / respec-able / removable state (depth, last stands,
// health, meta-upgrade levels, Heat, cosmetics, support AI) are intentionally
// absent and stay "blocked".
const H1_PERMANENT_UNMET_EVALS = {
    RequiredMaxCompletedRuns: (v, ctx) => h1Len(h1Gs(ctx, 'RunHistory')) > v,
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
};

// Whether a Hades 1 textline's flat ``otherRequirements`` map is *permanently*
// unmet against the persistent GameState slice (one of its monotonic "max"
// gates is already surpassed and can never recover). Returns 'unmet' or null.
// ``gameStateSlice`` is the persisted H1 GameState slice; the monotonic gates
// read only GameState tables, so a minimal ``ctx`` (no current/prev run) is used.
export function evaluateH1OtherReqPermanence(otherRequirements, gameStateSlice) {
    if (!otherRequirements || !gameStateSlice) return null;
    const ctx = { gs: gameStateSlice, currentRun: null, prevRun: null, runHistory: null };
    for (const [field, value] of Object.entries(otherRequirements)) {
        const evalFn = H1_PERMANENT_UNMET_EVALS[field];
        if (evalFn && evalFn(value, ctx, otherRequirements)) return 'unmet';
    }
    return null;
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
