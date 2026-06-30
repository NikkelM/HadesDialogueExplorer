// Tests for the Hades 1 named-field requirement evaluator
// (gamestate-eval-h1.js): the JS port of RunManager.lua IsGameStateEligible's
// flat ``Required*`` field model. Synthetic H1 save contexts exercise the
// persistent / current-run / no-save paths, the Lua coercion semantics
// (nil -> 0 / false, single-or-list values, list value-membership), the
// AND-combine, the textline-record skip set, and the owner run-context map.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData } from '../templates/viewer/data.js';
import {
    evaluateH1OtherRequirements,
    evaluateH1OtherReqPermanence,
    h1OperandMarks,
    H1_OWNER_RUN_CONTEXT,
    H1_GAMESTATE_SLICE_KEYS,
    H1_CURRENTRUN_SLICE_KEYS,
} from '../templates/viewer/gamestate-eval-h1.js';

// Build an H1 save context. ``gs`` is the persistent GameState slice; pass a
// ``currentRun`` for in-run / hub current-run gates.
function ctx({ gs = {}, currentRun = null, prevRun = null, runHistory = null } = {}) {
    return { gs, currentRun, prevRun, runHistory };
}

// Load (or clear) the H1 static save-eval tables the active-Mirror /
// weapon-enchantment / cosmetic-visible gates read via data.js. ``extra``
// overrides individual fields; pass ``null`` to load no static tables at all
// (so those gates fall back to NEEDS_STATIC).
function loadStatic(extra = {}) {
    const h1SaveEvalStatic = extra === null ? undefined : {
        metaUpgradeOrderLength: 12,
        shrineUpgradeOrder: ['BossDifficultyShrineUpgrade'],
        strikeThroughChangeValue: -3,
        weaponUpgradeSlots: { SwordWeapon: { 1: { startsUnlocked: true, reqTrait: 'SwordBaseUpgradeTrait', max: 5, costs: [1, 1, 1, 1, 1] }, 2: { trait: 'SwordRushTrait', max: 5, costs: [1, 1, 2, 2, 3] }, 3: { trait: 'SwordConsecrationTrait', max: 5, costs: [3, 3, 3, 3, 3] } } },
        cosmeticVisibleValue: 'visible',
        godLootTraitIndex: { ZeusUpgrade: ['ZeusWeaponTrait', 'LightningRodTrait'], HermesUpgrade: ['RushSpeedBoostTrait'] },
        godTraitNamesForShop: ['ZeusWeaponTrait', 'LightningRodTrait', 'RushSpeedBoostTrait'],
        keepsakeMaxChambers: { MaxHealthKeepsakeTrait: 75, ReincarnationTrait: 75 },
        ...extra,
    };
    loadData({ textlines: {}, speakers: {}, h1SaveEvalStatic });
}

// --- no save / empty ---------------------------------------------------------

test('H1: no save context -> every field is unknown with a reason', () => {
    const r = evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 3 }, null);
    assert.equal(r.status, 'unknown');
    assert.equal(r.clauses.length, 1);
    assert.equal(r.clauses[0].status, 'unknown');
    assert.match(r.clauses[0].reason, /No save loaded/);
});

test('H1: empty otherRequirements -> met with no clauses', () => {
    assert.deepEqual(evaluateH1OtherRequirements({}, ctx()), { status: 'met', clauses: [] });
    assert.deepEqual(evaluateH1OtherRequirements(null, ctx()), { status: 'met', clauses: [] });
});

test('H1: RequiredLastKilledByUnits/WeaponNames resolve from the death globals', () => {
    // Present in hub saves (set at death). Met iff the killer/weapon is in the list.
    const c = ctx({ gs: { LastKilledByUnitName: 'Minotaur', LastKilledByWeaponName: 'MinotaurWeapon' } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByUnits: ['Minotaur', 'Minotaur2'] }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByUnits: ['Theseus'] }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByWeaponNames: ['MinotaurWeapon'] }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByWeaponNames: ['BiomeTimer'] }, c).status, 'unmet');
    // Single-string operand (engine's non-table branch) is accepted.
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByUnits: 'Minotaur' }, c).status, 'met');
    // Absent global (in-run save before any death) -> nil -> unmet, matching the
    // engine's Contains(list, nil) = false.
    assert.equal(evaluateH1OtherRequirements({ RequiredLastKilledByUnits: ['Minotaur'] }, ctx({ gs: {} })).status, 'unmet');
});

// --- persistent GameState aggregates -----------------------------------------

test('H1: RequiredMinCompletedRuns counts RunHistory length', () => {
    const c = ctx({ gs: { RunHistory: [{}, {}, {}] } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 3 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 4 }, c).status, 'unmet');
});

test('H1: completed/cleared run gates read the Hades Biomes caches on a modded H2 save', () => {
    // Zagreus' Journey (Hades Biomes) ports H1 runs into an H2 save, where this
    // save's RunHistory is Melinoe's. The ported H1 completed / cleared counts
    // live in the mod cache keys, which take precedence over RunHistory.
    const c = ctx({ gs: {
        RunHistory: [{}, {}, {}, {}, {}],
        ModsNikkelMHadesBiomesCompletedRunsCache: 2,
        ModsNikkelMHadesBiomesClearedRunsCache: 1,
    } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 2 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 3 }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredCompletedRuns: 2 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxCompletedRuns: 2 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinRunsCleared: 1 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinRunsCleared: 2 }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredRunsCleared: 1 }, c).status, 'met');
    // A zero cache (mod present, no ported runs yet) still wins over RunHistory.
    const zero = ctx({ gs: { RunHistory: [{}, {}], ModsNikkelMHadesBiomesCompletedRunsCache: 0, ModsNikkelMHadesBiomesClearedRunsCache: 0 } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCompletedRuns: 1 }, zero).status, 'unmet');
});

test('H1: RequiredKills compares per-enemy EnemyKills counters', () => {
    const c = ctx({ gs: { EnemyKills: { Harpy: 5 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredKills: { Harpy: 5 } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredKills: { Harpy: 6 } }, c).status, 'unmet');
});

test('H1: missing GameState counter coerces to 0 (unmet, never unknown)', () => {
    // No EnemyKills table at all -> Harpy reads 0 -> requirement of 1 is unmet,
    // but a definite verdict (the save *does* answer it).
    const r = evaluateH1OtherRequirements({ RequiredKills: { Harpy: 1 } }, ctx({ gs: {} }));
    assert.equal(r.status, 'unmet');
    assert.equal(r.clauses[0].reason, null);
});

test('H1: RequiredTrueFlags / RequiredFalseFlags use Lua truthiness', () => {
    const c = ctx({ gs: { Flags: { SeenIntro: true, Hidden: false } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredTrueFlags: 'SeenIntro' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredTrueFlags: 'Hidden' }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseFlags: 'Hidden' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseFlags: 'SeenIntro' }, c).status, 'unmet');
});

test('H1: RequiredMaxNPCInteractions fails when the npc record is nil', () => {
    // Engine semantics: a missing NPCInteractions entry is ALSO ineligible for a
    // Max gate (nil OR > count), not vacuously satisfied.
    const c = ctx({ gs: { NPCInteractions: {} } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxNPCInteractions: { NPC_Orpheus_01: 2 } }, c).status, 'unmet');
    const c2 = ctx({ gs: { NPCInteractions: { NPC_Orpheus_01: 1 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxNPCInteractions: { NPC_Orpheus_01: 2 } }, c2).status, 'met');
});

test('H1: RequiredMaxTimesSeenRoom fails when the room record is nil', () => {
    // Like RequiredMaxNPCInteractions, the engine gate is (nil OR > count) ->
    // false, so a never-seen room is INELIGIBLE for a Max-times-seen gate.
    const cMissing = ctx({ gs: { RoomCountCache: {} } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxTimesSeenRoom: { A_Combat01: 2 } }, cMissing).status, 'unmet');
    const cSeen = ctx({ gs: { RoomCountCache: { A_Combat01: 2 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxTimesSeenRoom: { A_Combat01: 2 } }, cSeen).status, 'met');
    const cOver = ctx({ gs: { RoomCountCache: { A_Combat01: 3 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxTimesSeenRoom: { A_Combat01: 2 } }, cOver).status, 'unmet');
});

test('H1: RequiredEncounterThisRun reads EncountersOccurredCache (occurred, not completed)', () => {
    // Engine uses HasEncounterOccurred without requireCompleted -> the OCCURRED
    // cache. An encounter that occurred but is not in the completed cache passes.
    const c = ctx({ currentRun: { EncountersOccurredCache: { Boss01: true }, EncountersCompletedCache: {} } });
    assert.equal(evaluateH1OtherRequirements({ RequiredEncounterThisRun: 'Boss01' }, c).status, 'met');
    const cNo = ctx({ currentRun: { EncountersOccurredCache: {}, EncountersCompletedCache: { Boss01: true } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredEncounterThisRun: 'Boss01' }, cNo).status, 'unmet');
});

test('H1: RequiredDeathRoom is ineligible on a run that did not fail', () => {
    // Engine: not DidFailRun (run cleared OR hero alive) -> the gate returns false.
    const alive = ctx({ currentRun: { Hero: { IsDead: false }, CurrentRoom: { Name: 'A_Boss01' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredDeathRoom: 'A_Boss01' }, alive).status, 'unmet');
    const died = ctx({ currentRun: { Cleared: false, Hero: { IsDead: true }, CurrentRoom: { Name: 'A_Boss01' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredDeathRoom: 'A_Boss01' }, died).status, 'met');
    const diedElsewhere = ctx({ currentRun: { Cleared: false, Hero: { IsDead: true }, CurrentRoom: { Name: 'A_Combat01' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredDeathRoom: 'A_Boss01' }, diedElsewhere).status, 'unmet');
    // The "False" variant still passes on a non-failed run.
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseDeathRoom: 'A_Boss01' }, alive).status, 'met');
});

test('H1: RequiredFalseBiome is ineligible when the current room is unresolved', () => {
    // Engine: a nil CurrentRoom (or a matching RoomSetName) -> ineligible. Only a
    // present room whose biome differs passes.
    const inBiome = ctx({ currentRun: { CurrentRoom: { RoomSetName: 'Tartarus' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseBiome: 'Asphodel' }, inBiome).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseBiome: 'Tartarus' }, inBiome).status, 'unmet');
    const noRoom = ctx({ currentRun: { CurrentRoom: null } });
    assert.equal(evaluateH1OtherRequirements({ RequiredFalseBiome: 'Asphodel' }, noRoom).status, 'unmet');
});

// --- current-run gates / wrong-save type -------------------------------------

test('H1: CurrentRun.* gate is wrong-save-type unknown when no currentRun slice', () => {
    const r = evaluateH1OtherRequirements({ RequiresRunCleared: true }, ctx({ gs: {} }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.clauses[0].kind, 'wrong-save-type');
    assert.match(r.clauses[0].reason, /different save type/);
});

test('H1: RequiresRunCleared resolves against a present currentRun slice', () => {
    assert.equal(evaluateH1OtherRequirements({ RequiresRunCleared: true }, ctx({ currentRun: { Cleared: true } })).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiresRunNotCleared: true }, ctx({ currentRun: { Cleared: true } })).status, 'unmet');
});

test('H1: RequiredWeapon reads the in-run hero weapon table', () => {
    const c = ctx({ currentRun: { Hero: { Weapons: { SwordWeapon: true } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredWeapon: 'SwordWeapon' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredWeapon: 'BowWeapon' }, c).status, 'unmet');
});

// --- resources / run-record gates (group A/B) --------------------------------

test('H1: RequiredResourcesMin reads GameState.Resources (resolves from any save)', () => {
    const c = ctx({ gs: { Resources: { Gems: 30, MetaPoints: 5 } }, currentRun: null });
    assert.equal(evaluateH1OtherRequirements({ RequiredResourcesMin: { Gems: 30 } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredResourcesMin: { Gems: 31 } }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredResourcesMin: { Gems: 30, MetaPoints: 5 } }, c).status, 'met');
    // amount 0 is always satisfied (HasResource short-circuit); a missing resource is 0.
    assert.equal(evaluateH1OtherRequirements({ RequiredResourcesMin: { Diamonds: 0 } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredResourcesMin: { Diamonds: 1 } }, c).status, 'unmet');
});

test('H1: RequiredMinCaughtFishThisRun sums CurrentRun.CaughtFish', () => {
    const c = ctx({ currentRun: { CaughtFish: { TartarusFish: 1, AsphodelFish: 2 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCaughtFishThisRun: 3 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCaughtFishThisRun: 4 }, c).status, 'unmet');
    // No fish caught yet -> 0.
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCaughtFishThisRun: 1 }, ctx({ currentRun: {} })).status, 'unmet');
    // Wrong save type (no current-run slice) -> unknown.
    assert.equal(evaluateH1OtherRequirements({ RequiredMinCaughtFishThisRun: 1 }, ctx()).status, 'unknown');
});

test('H1: RequiredConsumablesThisRun sums ConsumableRecord across Names', () => {
    const c = ctx({ currentRun: { ConsumableRecord: { RoomRewardConsolationPrize: 1, RoomRewardMaxHealthDrop: 2 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredConsumablesThisRun: { Count: 1, Names: ['RoomRewardConsolationPrize'] } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredConsumablesThisRun: { Count: 3, Names: ['RoomRewardConsolationPrize', 'RoomRewardMaxHealthDrop'] } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredConsumablesThisRun: { Count: 2, Names: ['RoomRewardConsolationPrize'] } }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredConsumablesThisRun: { Count: 1, Names: ['RoomRewardConsolationPrize'] } }, ctx()).status, 'unknown');
});

test('H1: RequiredUsedAssistInRoomThisRun checks per-room UsedAssist in RoomHistory', () => {
    // The engine fails if any room matching the name lacks UsedAssist.
    const used = ctx({ currentRun: { RoomHistory: { 1: { Name: 'A_Boss01', UsedAssist: true }, 2: { Name: 'B_Combat01' } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredUsedAssistInRoomThisRun: 'A_Boss01' }, used).status, 'met');
    const notUsed = ctx({ currentRun: { RoomHistory: { 1: { Name: 'A_Boss01', UsedAssist: false } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredUsedAssistInRoomThisRun: 'A_Boss01' }, notUsed).status, 'unmet');
    // Room not visited this run -> no failing room -> met.
    assert.equal(evaluateH1OtherRequirements({ RequiredUsedAssistInRoomThisRun: 'C_Boss01' }, used).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredUsedAssistInRoomThisRun: 'A_Boss01' }, ctx()).status, 'unknown');
});

// --- Lua list vs set semantics -----------------------------------------------

test('H1: RequiredFalsePlayedThisRoom treats VoiceLinesPlayed as a value list', () => {
    // CurrentRoom.VoiceLinesPlayed is a Lua list (value membership), not a keyed set.
    const c = ctx({ currentRun: { CurrentRoom: { VoiceLinesPlayed: ['LineA', 'LineB'] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredFalsePlayedThisRoom: 'LineC' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalsePlayedThisRoom: 'LineA' }, c).status, 'unmet');
});

test('H1: RequiredAnyPlayedThisRun matches a current-run SpeechRecord list', () => {
    const c = ctx({ currentRun: { SpeechRecord: ['LineA', 'LineB'] } });
    assert.equal(evaluateH1OtherRequirements({ RequiredAnyPlayedThisRun: ['LineB'] }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredAnyPlayedThisRun: ['LineZ'] }, c).status, 'unmet');
});

// --- single-or-array value handling ------------------------------------------

test('H1: a field value may be a single string or an array of strings', () => {
    const c = ctx({ gs: { Flags: { A: true, B: true } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredTrueFlags: 'A' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredTrueFlags: ['A', 'B'] }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredTrueFlags: ['A', 'C'] }, c).status, 'unmet');
});

// --- AND-combine across fields -----------------------------------------------

test('H1: clauses AND-combine (any unmet -> unmet; else any unknown -> unknown)', () => {
    const c = ctx({ gs: { RunHistory: [{}, {}] }, currentRun: null });
    // met + unmet -> unmet
    assert.equal(evaluateH1OtherRequirements(
        { RequiredMinCompletedRuns: 1, RequiredMaxCompletedRuns: 1 }, c).status, 'unmet');
    // met + wrong-save unknown -> unknown
    assert.equal(evaluateH1OtherRequirements(
        { RequiredMinCompletedRuns: 1, RequiresRunCleared: true }, c).status, 'unknown');
    // met + met -> met
    assert.equal(evaluateH1OtherRequirements(
        { RequiredMinCompletedRuns: 1, RequiredMaxCompletedRuns: 5 }, c).status, 'met');
});

// --- textline-record skip set ------------------------------------------------

test('H1: textline-record fields are skipped (owned by requirementSetStatus)', () => {
    // These resolve elsewhere; the H1 evaluator must not double-count them, so a
    // dialogue gated ONLY on them yields met (no clauses) here.
    const r = evaluateH1OtherRequirements({ RequiredTextLines: ['X'], RequiredTextLinesThisRun: ['Y'] }, ctx());
    assert.equal(r.status, 'met');
    assert.equal(r.clauses.length, 0);
});

// --- needs-static-data fields ------------------------------------------------

test('H1: fields needing static game tables stay unknown with a reason', () => {
    const r = evaluateH1OtherRequirements({ RequiresCodexFullyUnlocked: true }, ctx({ gs: {} }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.clauses[0].kind, undefined);
    assert.match(r.clauses[0].reason, /codex/i);
});

// --- codex (resolved from the persisted top-level CodexStatus global) --------

test('H1: RequiredCodexEntry passes when the entry is unlocked deep enough and viewed', () => {
    const c = ctx({ gs: { Codex: { NPC_Achilles_01: { u: 4, viewed: true } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Achilles_01', EntryIndex: 3 } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Achilles_01', EntryIndex: 4 } }, c).status, 'met');
});

test('H1: RequiredCodexEntry fails when not unlocked far enough, unviewed, or absent', () => {
    const shallow = ctx({ gs: { Codex: { RoomRewardConsolationPrize: { u: 2, viewed: true } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'RoomRewardConsolationPrize', EntryIndex: 3 } }, shallow).status, 'unmet');
    const unviewed = ctx({ gs: { Codex: { NPC_Patroclus_01: { u: 4, viewed: false } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Patroclus_01', EntryIndex: 1 } }, unviewed).status, 'unmet');
    const absent = ctx({ gs: { Codex: {} } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Skelly_01', EntryIndex: 1 } }, absent).status, 'unmet');
});

test('H1: RequiredCodexEntry defaults a missing EntryIndex to 1', () => {
    const c = ctx({ gs: { Codex: { NPC_Thanatos_01: { u: 1, viewed: true } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Thanatos_01' } }, c).status, 'met');
});

test('H1: RequiredCodexEntry is unknown when no codex slice is present', () => {
    const r = evaluateH1OtherRequirements({ RequiredCodexEntry: { EntryName: 'NPC_Achilles_01', EntryIndex: 1 } }, ctx({ gs: {} }));
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /codex/i);
});

test('H1: RequiredCodexEntriesMin compares the total unlocked count', () => {
    const c = ctx({ gs: { CodexUnlockedTotal: 165 } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntriesMin: 50 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntriesMin: 200 }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredCodexEntriesMin: 50 }, ctx({ gs: {} })).status, 'unknown');
});

test('H1: RequiredPlayed / RequiredFalsePlayed resolve against the global SpeechRecord', () => {
    const c = ctx({ gs: { SpeechRecord: { CueA: true } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredPlayed: 'CueA' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredPlayed: 'CueB' }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalsePlayed: 'CueB' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredFalsePlayed: 'CueA' }, c).status, 'unmet');
});

// --- active Mirror-of-Night gates (h1SaveEvalStatic-backed) -------------------

test('H1: RequiredActiveMetaUpgrade is active only for the selected Mirror side', () => {
    loadStatic();
    // Row 3 selects ExtraChanceMetaUpgrade (Death Defiance); the player has
    // points in both sides but only the selected one is "active".
    const gs = {
        MetaUpgradesSelected: { 1: 'BackstabMetaUpgrade', 3: 'ExtraChanceMetaUpgrade' },
        MetaUpgrades: { ExtraChanceMetaUpgrade: 2, ExtraChanceReplenishMetaUpgrade: 1 },
    };
    const c = ctx({ gs });
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'ExtraChanceMetaUpgrade' }, c).status, 'met');
    // The unselected side has points but is inactive -> the level reads 0.
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'ExtraChanceReplenishMetaUpgrade' }, c).status, 'unmet');
});

test('H1: RequiredInactiveMetaUpgrade passes for an invested-but-deselected talent', () => {
    loadStatic();
    const c = ctx({ gs: {
        MetaUpgradesSelected: { 1: 'ExtraChanceMetaUpgrade' },
        MetaUpgrades: { ExtraChanceReplenishMetaUpgrade: 3 },
    } });
    // The engine treats the deselected side as inactive (0), so "must be
    // inactive" is satisfied even though MetaUpgrades has a non-zero level.
    assert.equal(evaluateH1OtherRequirements({ RequiredInactiveMetaUpgrade: 'ExtraChanceReplenishMetaUpgrade' }, c).status, 'met');
});

test('H1: strike-through Pact nulls Mirror rows from the end', () => {
    loadStatic();
    // metaUpgradeOrderLength 12, ChangeValue -3, strike level 1 -> 3 rows nulled
    // -> rows > 9 are inactive. Row 10 is therefore inactive, row 9 active.
    const gs = {
        MetaUpgradesSelected: { 9: 'RowNineUpgrade', 10: 'RowTenUpgrade' },
        MetaUpgrades: { RowNineUpgrade: 1, RowTenUpgrade: 1, MetaUpgradeStrikeThroughShrineUpgrade: 1 },
    };
    const c = ctx({ gs });
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'RowNineUpgrade' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'RowTenUpgrade' }, c).status, 'unmet');
});

test('H1: shrine (Pact) upgrades are always active', () => {
    loadStatic();
    const c = ctx({ gs: { MetaUpgradesSelected: {}, MetaUpgrades: { BossDifficultyShrineUpgrade: 2 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'BossDifficultyShrineUpgrade' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinActiveMetaUpgradeLevel: { Name: 'BossDifficultyShrineUpgrade', Count: 2 } }, c).status, 'met');
});

test('H1: active-Mirror gates are unknown when the static tables are absent', () => {
    loadStatic(null);
    const c = ctx({ gs: { MetaUpgradesSelected: { 1: 'ExtraChanceMetaUpgrade' }, MetaUpgrades: { ExtraChanceMetaUpgrade: 1 } } });
    const r = evaluateH1OtherRequirements({ RequiredActiveMetaUpgrade: 'ExtraChanceMetaUpgrade' }, c);
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /Mirror/i);
    loadStatic(); // restore for any later tests
});

// --- god loot / no god boons (h1SaveEvalStatic.godLootTraitIndex) -------------

test('H1: RequiredGodLoot is met when the hero holds a boon from that god', () => {
    loadStatic();
    const c = ctx({ currentRun: { Hero: { Traits: [{ Name: 'LightningRodTrait' }, { Name: 'RushSpeedBoostTrait' }] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredGodLoot: 'ZeusUpgrade' }, c).status, 'met');
    // Hero has no Hermes boon equipped -> unmet.
    const c2 = ctx({ currentRun: { Hero: { Traits: [{ Name: 'LightningRodTrait' }] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredGodLoot: 'HermesUpgrade' }, c2).status, 'unmet');
    // Unknown god (not in LootData) -> unmet, regardless of save.
    assert.equal(evaluateH1OtherRequirements({ RequiredGodLoot: 'NotAGod' }, c).status, 'unmet');
    // Wrong save type (no current-run slice) -> unknown.
    assert.equal(evaluateH1OtherRequirements({ RequiredGodLoot: 'ZeusUpgrade' }, ctx()).status, 'unknown');
});

test('H1: RequiredGodLoot is unknown when the static index is absent', () => {
    loadStatic(null);
    const c = ctx({ currentRun: { Hero: { Traits: [{ Name: 'LightningRodTrait' }] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredGodLoot: 'ZeusUpgrade' }, c).status, 'unknown');
    loadStatic();
});

test('H1: RequiredNoGodBoons fails when any equipped trait is a god boon', () => {
    loadStatic();
    // A non-boon build (only a keepsake-style trait) passes.
    const clean = ctx({ currentRun: { Hero: { Traits: [{ Name: 'SomeKeepsakeTrait' }] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredNoGodBoons: true }, clean).status, 'met');
    // Holding a god boon (Zeus) fails the gate.
    const withBoon = ctx({ currentRun: { Hero: { Traits: [{ Name: 'ZeusWeaponTrait' }] } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredNoGodBoons: true }, withBoon).status, 'unmet');
    // Wrong save type -> unknown.
    assert.equal(evaluateH1OtherRequirements({ RequiredNoGodBoons: true }, ctx()).status, 'unknown');
});


// --- keepsake mastery (h1SaveEvalStatic.keepsakeMaxChambers) ------------------

test('H1: RequiresMaxKeepsake is met when the equipped keepsake is mastered', () => {
    loadStatic();
    // KeepsakeChambers reaches the 75-chamber mastery threshold.
    const c = ctx({ gs: { LastAwardTrait: 'ReincarnationTrait', KeepsakeChambers: { ReincarnationTrait: 80 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c).status, 'met');
});

test('H1: RequiresMaxKeepsake is unmet when the equipped keepsake is not yet mastered', () => {
    loadStatic();
    const c = ctx({ gs: { LastAwardTrait: 'ReincarnationTrait', KeepsakeChambers: { ReincarnationTrait: 37 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c).status, 'unmet');
});

test('H1: RequiresMaxKeepsake passes vacuously when no keepsake is equipped', () => {
    loadStatic();
    // Engine quirk: the gate only fails when a keepsake is equipped and unmastered.
    const c = ctx({ gs: {} });
    assert.equal(evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c).status, 'met');
});

test('H1: RequiresMaxKeepsake is unmet when the keepsake has no recorded chambers', () => {
    loadStatic();
    const c = ctx({ gs: { LastAwardTrait: 'ReincarnationTrait' } });
    assert.equal(evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c).status, 'unmet');
});

test('H1: RequiresMaxKeepsake is unknown for a companion keepsake (not in the table)', () => {
    loadStatic();
    // Companion keepsakes use the assist-NPC upgrade path, absent from the slice.
    const c = ctx({ gs: { LastAwardTrait: 'FuryAssistTrait', KeepsakeChambers: { FuryAssistTrait: 80 } } });
    const r = evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c);
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /companion/i);
});

test('H1: RequiresMaxKeepsake is unknown when the static table is absent', () => {
    loadStatic(null);
    const c = ctx({ gs: { LastAwardTrait: 'ReincarnationTrait', KeepsakeChambers: { ReincarnationTrait: 80 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiresMaxKeepsake: true }, c).status, 'unknown');
    loadStatic();
});



test('H1: unlocked-weapon-enchantment count excludes the StartsUnlocked base aspect', () => {
    loadStatic();
    // SwordWeapon index 1 is the base aspect (StartsUnlocked) -> excluded;
    // indices 2 and 3 count. So the unlocked-enchantment count is 2.
    const c = ctx({ gs: { WeaponUnlocks: { SwordWeapon: { 1: 5, 2: 3, 3: 1 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinUnlockedWeaponEnchantments: 2 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinUnlockedWeaponEnchantments: 3 }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredMaxUnlockedWeaponEnchantments: 2 }, c).status, 'met');
});

// --- meta-point totals (Darkness) --------------------------------------------

test('H1: RequiredAccumulatedMetaPoints sums unspent + spent Darkness', () => {
    const c = ctx({ gs: { Resources: { MetaPoints: 1739 }, SpentMetaPointsCache: 17300 } });
    assert.equal(evaluateH1OtherRequirements({ RequiredAccumulatedMetaPoints: 19000 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredAccumulatedMetaPoints: 19040 }, c).status, 'unmet');
    // Missing spent-Darkness cache -> can't resolve (unknown).
    const noCache = ctx({ gs: { Resources: { MetaPoints: 1739 } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredAccumulatedMetaPoints: 1 }, noCache).status, 'unknown');
});

test('H1: RequiredActiveMetaPoints Min/Max compare spent Darkness', () => {
    const c = ctx({ gs: { SpentMetaPointsCache: 17300 } });
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaPointsMin: 1000 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaPointsMin: 20000 }, c).status, 'unmet');
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaPointsMax: 20000 }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredActiveMetaPointsMax: 1000 }, c).status, 'unmet');
});

// --- best clear time last run ------------------------------------------------

test('H1: RequiresBestClearTimeLastRun passes when the last run set a new record', () => {
    // RunHistory keyed 1..n; the last (key 3) is the newest, with the fastest time.
    const hist = {
        1: { Cleared: true, GameplayTime: 1800, RunDepthCache: 60 },
        2: { Cleared: true, GameplayTime: 1500, RunDepthCache: 60 },
        3: { Cleared: true, GameplayTime: 1200, RunDepthCache: 60 },
    };
    assert.equal(evaluateH1OtherRequirements({ RequiresBestClearTimeLastRun: true }, ctx({ gs: { RunHistory: hist } })).status, 'met');
});

test('H1: RequiresBestClearTimeLastRun fails when an earlier run was faster', () => {
    const hist = {
        1: { Cleared: true, GameplayTime: 1000, RunDepthCache: 60 },
        2: { Cleared: true, GameplayTime: 1500, RunDepthCache: 60 },
    };
    assert.equal(evaluateH1OtherRequirements({ RequiresBestClearTimeLastRun: true }, ctx({ gs: { RunHistory: hist } })).status, 'unmet');
});

test('H1: RequiresBestClearTimeLastRun is a no-op when the last run was not cleared', () => {
    const hist = { 1: { Cleared: true, GameplayTime: 1000, RunDepthCache: 60 }, 2: { Cleared: false } };
    assert.equal(evaluateH1OtherRequirements({ RequiresBestClearTimeLastRun: true }, ctx({ gs: { RunHistory: hist } })).status, 'met');
});

test('H1: RequiresBestClearTimeLastRun only competes against runs in the same God Mode state', () => {
    // The last run (God Mode on) ignores the faster non-God-Mode run.
    const hist = {
        1: { Cleared: true, GameplayTime: 800, RunDepthCache: 60 },
        2: { Cleared: true, GameplayTime: 1200, RunDepthCache: 60, EasyModeLevel: 5 },
    };
    assert.equal(evaluateH1OtherRequirements({ RequiresBestClearTimeLastRun: true }, ctx({ gs: { RunHistory: hist } })).status, 'met');
});

// --- weapon-aspect gates -----------------------------------------------------

test('H1: RequiredLastInteractedWeaponUpgrade matches the pointed-at slot trait', () => {
    loadStatic();
    // Last interacted = SwordWeapon slot 2 (SwordRushTrait).
    const c = ctx({ gs: { LastInteractedWeaponUpgrade: { WeaponName: 'SwordWeapon', ItemIndex: 2 }, WeaponUnlocks: { SwordWeapon: { 2: 3 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordRushTrait' }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordConsecrationTrait' }, c).status, 'unmet');
    // No last-interacted record -> unmet.
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordRushTrait' }, ctx({ gs: {} })).status, 'unmet');
    // Without the slot table -> unknown.
    loadStatic(null);
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordRushTrait' }, c).status, 'unknown');
});

test('H1: RequiredLastInteractedWeaponUpgrade resolves the base aspect only when invested', () => {
    loadStatic();
    // The base aspect (slot 1) carries reqTrait, but only resolves once level > 0.
    const invested = ctx({ gs: { LastInteractedWeaponUpgrade: { WeaponName: 'SwordWeapon', ItemIndex: 1 }, WeaponUnlocks: { SwordWeapon: { 1: 2 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordBaseUpgradeTrait' }, invested).status, 'met');
    const uninvested = ctx({ gs: { LastInteractedWeaponUpgrade: { WeaponName: 'SwordWeapon', ItemIndex: 1 }, WeaponUnlocks: {} } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgrade: 'SwordBaseUpgradeTrait' }, uninvested).status, 'unmet');
});

test('H1: RequiredLastInteractedWeaponUpgradeMaxed checks the bought level vs the slot max', () => {
    loadStatic();
    const maxed = ctx({ gs: { LastInteractedWeaponUpgrade: { WeaponName: 'SwordWeapon', ItemIndex: 2 }, WeaponUnlocks: { SwordWeapon: { 2: 5 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgradeMaxed: true }, maxed).status, 'met');
    const partial = ctx({ gs: { LastInteractedWeaponUpgrade: { WeaponName: 'SwordWeapon', ItemIndex: 2 }, WeaponUnlocks: { SwordWeapon: { 2: 4 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredLastInteractedWeaponUpgradeMaxed: true }, partial).status, 'unmet');
});

test('H1: RequiredMinSuperLockKeysSpentOnWeapon sums per-level costs across the weapon slots', () => {
    loadStatic();
    // Slot 2 (costs 1,1,2,2,3) at level 3 -> 1+1+2 = 4; slot 3 (costs 3,3,3,3,3)
    // at level 1 -> 3. Total = 7.
    const c = ctx({ gs: { WeaponUnlocks: { SwordWeapon: { 2: 3, 3: 1 } } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredMinSuperLockKeysSpentOnWeapon: { Name: 'SwordWeapon', Count: 7 } }, c).status, 'met');
    assert.equal(evaluateH1OtherRequirements({ RequiredMinSuperLockKeysSpentOnWeapon: { Name: 'SwordWeapon', Count: 8 } }, c).status, 'unmet');
});

// --- cosmetic visible constant -----------------------------------------------

test('H1: RequiredCosmeticItemVisible matches the VISIBLE constant, not mere truthiness', () => {
    loadStatic();
    const visible = ctx({ gs: { Cosmetics: { LoungeBanner: 'visible' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCosmeticItemVisible: 'LoungeBanner' }, visible).status, 'met');
    // "pending" is truthy but not the VISIBLE state -> ineligible.
    const pending = ctx({ gs: { Cosmetics: { LoungeBanner: 'pending' } } });
    assert.equal(evaluateH1OtherRequirements({ RequiredCosmeticItemVisible: 'LoungeBanner' }, pending).status, 'unmet');
});

test('H1: h1OperandMarks marks owned items in a set/membership gate', () => {
    // RequiredMinAnyCosmetics counts owned cosmetics from a list - mark the owned green.
    const c = ctx({ gs: { Cosmetics: { A: true, C: 'visible' }, WeaponsUnlocked: { BowWeapon: true } } });
    const m = h1OperandMarks('RequiredMinAnyCosmetics', { Cosmetics: ['A', 'B', 'C'], Count: 2 }, c);
    assert.deepEqual([...m.flat.green].sort(), ['A', 'C']);
    assert.deepEqual([...m.flat.red], []);
    assert.equal(m.flat.total, 2); // aggregate: 2 of the 3 listed cosmetics owned
    assert.equal(m.flat.totalMet, true); // min gate, 2 owned >= Count 2
    // A "max" set gate colours owned members red (surplus pushes past the cap).
    const mMax = h1OperandMarks('RequiredMaxAnyCosmetics', { Cosmetics: ['A', 'B', 'C'], Count: 2 }, c);
    assert.deepEqual([...mMax.flat.red].sort(), ['A', 'C']);
    assert.deepEqual([...mMax.flat.green], []);
    // Flat-array cosmetics field.
    assert.deepEqual([...h1OperandMarks('RequiredAnyCosmetics', ['A', 'B'], c).flat.green], ['A']);
    // Weapons unlocked.
    assert.deepEqual([...h1OperandMarks('RequiredWeaponsUnlocked', ['BowWeapon', 'GunWeapon'], c).flat.green], ['BowWeapon']);
    // A genuinely unsupported field -> null (nothing marked).
    assert.equal(h1OperandMarks('RequiredRoom', 'N_Tartarus', c), null);
    // A current-run gate with no current run slice -> indeterminate -> null.
    assert.equal(h1OperandMarks('RequiredOneOfTraits', ['T1', 'T2'], ctx({ gs: {} })), null);
});

test('H1: h1OperandMarks tallies and colours "Name op Count" numeric gates', () => {
    const c = ctx({ gs: { EnemyKills: { Harpy: 3, Hydra: 0 }, NPCInteractions: { NPC_Sisyphus_01: 6 } } });
    // RequiredKills (min): present counts green, with the save's actual tally;
    // an absent / zero entry carries a (0) tally but no colour.
    const k = h1OperandMarks('RequiredKills', { Harpy: 1, Hydra: 2, Skull: 1 }, c);
    assert.equal(k.flat.counts.get('Harpy'), 3);
    assert.equal(k.flat.counts.get('Hydra'), 0);
    assert.equal(k.flat.counts.get('Skull'), 0); // absent table entry -> 0
    assert.deepEqual([...k.flat.green], ['Harpy']); // only the >0 entry is coloured
    assert.deepEqual([...k.flat.red], []);
    // A "max" gate colours present counts red (more pushes past the cap).
    const n = h1OperandMarks('RequiredMaxNPCInteractions', { NPC_Sisyphus_01: 5 }, c);
    assert.equal(n.flat.counts.get('NPC_Sisyphus_01'), 6);
    assert.deepEqual([...n.flat.red], ['NPC_Sisyphus_01']);
    assert.deepEqual([...n.flat.green], []);
    // The underlying table absent -> indeterminate -> null (mark nothing).
    assert.equal(h1OperandMarks('RequiredKills', { Harpy: 1 }, ctx({ gs: {} })), null);
    // RequiredMinValues reads a top-level GameState field directly.
    const mv = h1OperandMarks('RequiredMinValues', { NumCerberusPettings: 20 }, ctx({ gs: { NumCerberusPettings: 31 } }));
    assert.equal(mv.flat.counts.get('NumCerberusPettings'), 31);
    assert.deepEqual([...mv.flat.green], ['NumCerberusPettings']); // present (>0), min field -> green
});

test('H1: h1OperandMarks surfaces the actual field value for equality gates', () => {
    // RequiredValues (must equal): the save's actual employee satisfies the gate.
    const eq = h1OperandMarks('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' }, ctx({ gs: { CurrentEmployeeOfTheMonth: 'Hypnos' } }));
    assert.deepEqual(eq.flat.actuals.get('CurrentEmployeeOfTheMonth'), { value: 'Hypnos', met: true });
    // A different actual value fails the equality gate.
    const eqMiss = h1OperandMarks('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' }, ctx({ gs: { CurrentEmployeeOfTheMonth: 'Megaera' } }));
    assert.deepEqual(eqMiss.flat.actuals.get('CurrentEmployeeOfTheMonth'), { value: 'Megaera', met: false });
    // RequiredFalseValues (must NOT equal): a matching value fails, a differing one passes.
    const neq = h1OperandMarks('RequiredFalseValues', { CurrentEmployeeOfTheMonth: 'Thanatos' }, ctx({ gs: { CurrentEmployeeOfTheMonth: 'Thanatos' } }));
    assert.deepEqual(neq.flat.actuals.get('CurrentEmployeeOfTheMonth'), { value: 'Thanatos', met: false });
    const neqOk = h1OperandMarks('RequiredFalseValues', { CurrentEmployeeOfTheMonth: 'Thanatos' }, ctx({ gs: { CurrentEmployeeOfTheMonth: 'Hypnos' } }));
    assert.deepEqual(neqOk.flat.actuals.get('CurrentEmployeeOfTheMonth'), { value: 'Hypnos', met: true });
    // An unset field reads as null (rendered "unset"); RequiredValues stays unmet.
    const unset = h1OperandMarks('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' }, ctx({ gs: {} }));
    assert.deepEqual(unset.flat.actuals.get('CurrentEmployeeOfTheMonth'), { value: null, met: false });
});

test('H1: h1OperandMarks colours run-kill array gates', () => {
    // RequiredKillsThisRun: an enemy killed in the current run -> green.
    const cr = { RoomHistory: { 1: { Kills: { Harpy: 2 } } } };
    const m = h1OperandMarks('RequiredKillsThisRun', ['Harpy', 'Hydra'], ctx({ gs: {}, currentRun: cr }));
    assert.deepEqual([...m.flat.green], ['Harpy']);
    assert.deepEqual([...m.flat.red], []);
    // RequiredFalseKills (negative, lifetime EnemyKills): a killed enemy -> red.
    const f = h1OperandMarks('RequiredFalseKills', ['Harpy', 'Hydra'], ctx({ gs: { EnemyKills: { Harpy: 5 } } }));
    assert.deepEqual([...f.flat.red], ['Harpy']);
    assert.deepEqual([...f.flat.green], []);
    // No current run (hub save) -> indeterminate -> null.
    assert.equal(h1OperandMarks('RequiredKillsThisRun', ['Harpy'], ctx({ gs: {} })), null);
});

test('H1: h1OperandMarks reads and colours single-scalar numeric gates', () => {
    const c = ctx({ gs: { RunHistory: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }, TotalRequiredEnemyKills: 50 } });
    // RequiredMinCompletedRuns: 7 completed runs >= 5 -> met (green).
    const r = h1OperandMarks('RequiredMinCompletedRuns', 5, c);
    assert.equal(r.flat.scalarValue, 7);
    assert.equal(r.flat.scalarMet, true);
    // RequiredMinTotalKills: 50 >= 100 -> not met (red).
    const k = h1OperandMarks('RequiredMinTotalKills', 100, c);
    assert.equal(k.flat.scalarValue, 50);
    assert.equal(k.flat.scalarMet, false);
    // RequiredMaxDepth uses strict "<": depth 8 < 12 -> met.
    const cr = ctx({ gs: {}, currentRun: { RunDepthCache: 8 } });
    const d = h1OperandMarks('RequiredMaxDepth', 12, cr);
    assert.equal(d.flat.scalarValue, 8);
    assert.equal(d.flat.scalarMet, true);
    // A per-run gate with no current run slice -> indeterminate -> null.
    assert.equal(h1OperandMarks('RequiredMaxDepth', 12, ctx({ gs: {} })), null);
    // Meta-point gate needs SpentMetaPointsCache; absent -> null.
    assert.equal(h1OperandMarks('RequiredActiveMetaPointsMin', 100, ctx({ gs: {} })), null);
});

// --- permanence: monotonic "max" gates (blocked vs unobtainable) -------------

test('H1: surpassed monotonic max gates are permanently unmet (unobtainable)', () => {
    // Run-count caps over append-only counters: once past the cap, never recover.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxCompletedRuns: 2 }, { RunHistory: [{}, {}, {}] }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxCompletedRuns: 3 }, { RunHistory: [{}, {}, {}] }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxRunsCleared: 1 }, { RunHistory: [{ Cleared: true }, { Cleared: true }] }), 'unmet');
    // The Hades Biomes ported run-count caches are likewise monotonic, so a
    // surpassed max gate resolves permanently unmet from a modded H2 save.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxCompletedRuns: 2 }, { ModsNikkelMHadesBiomesCompletedRunsCache: 3 }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxCompletedRuns: 3 }, { ModsNikkelMHadesBiomesCompletedRunsCache: 3 }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxRunsCleared: 1 }, { ModsNikkelMHadesBiomesClearedRunsCache: 2 }), 'unmet');
    // Lifetime resources (monotonic) over a per-resource cap.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredLifetimeResourcesSpentMax: { Gems: 100 } }, { LifetimeResourcesSpent: { Gems: 150 } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredLifetimeResourcesSpentMax: { Gems: 100 } }, { LifetimeResourcesSpent: { Gems: 50 } }), null);
    // Cumulative interaction / room counts: only the surpassed case is permanent.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxNPCInteractions: { NPC_Orpheus_01: 2 } }, { NPCInteractions: { NPC_Orpheus_01: 5 } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxTimesSeenRoom: { A_Combat01: 1 } }, { RoomCountCache: { A_Combat01: 3 } }), 'unmet');
    // Cashed-out quests (terminal/monotonic).
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxQuestsComplete: 1 }, { QuestStatus: { Q1: 'CashedOut', Q2: 'CashedOut' } }), 'unmet');
});

test('H1: an already-maxed weapon aspect makes "must NOT be maxed" permanent', () => {
    assert.equal(
        evaluateH1OtherReqPermanence(
            { RequiredFalseMaxWeaponUpgrade: 'SwordWeapon', RequiredFalseMaxWeaponUpgradeIndex: 1 },
            { WeaponUnlocks: { SwordWeapon: { 1: 5 } } }),
        'unmet');
    // Not yet maxed -> can still be upgraded, not permanent.
    assert.equal(
        evaluateH1OtherReqPermanence(
            { RequiredFalseMaxWeaponUpgrade: 'SwordWeapon', RequiredFalseMaxWeaponUpgradeIndex: 1 },
            { WeaponUnlocks: { SwordWeapon: { 1: 3 } } }),
        null);
});

test('H1: resettable / per-run max gates are never permanent', () => {
    // These read per-run / respec-able / removable state, so a surpassed value
    // can come back down - they stay "blocked", not "unobtainable".
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxActiveMetaUpgradeLevel: { Name: 'X', Count: 1 } }, { MetaUpgrades: { X: 5 } }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxAnyCosmetics: { Cosmetics: ['A', 'B'], Count: 0 } }, { Cosmetics: { A: true, B: true } }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxDepth: 1 }, { RunHistory: [] }), null);
    // No save slice -> null.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredMaxCompletedRuns: 0 }, null), null);
});

// --- permanence: require-absence of a monotonic event (blocked vs unobtainable)

test('H1: forbidding a monotonic event that already happened is permanently unmet', () => {
    // A played voiceline can never be un-played (the global SpeechRecord is
    // append-only), so a "must NOT have played" gate over a recorded cue is
    // permanently unmet -> unobtainable, not merely blocked.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalsePlayed: ['/VO/A_1', '/VO/A_2'] }, { SpeechRecord: { '/VO/A_2': true } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalsePlayed: ['/VO/A_1'] }, { SpeechRecord: {} }), null);
    // EnemyKills counts only increment.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseKills: ['Harpy'] }, { EnemyKills: { Harpy: 3 } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseKills: ['Harpy'] }, { EnemyKills: {} }), null);
    // The persistent RoomCountCache only increments (per-run copy is ignored).
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseSeenRooms: ['C_Intro'] }, { RoomCountCache: { C_Intro: 1 } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseSeenRooms: ['C_Intro'] }, { RoomCountCache: {} }), null);
    // Weapon unlocks and screen views are one-way records.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseWeaponsUnlocked: ['GunWeapon'] }, { WeaponsUnlocked: { GunWeapon: true } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseWeaponsUnlocked: ['GunWeapon'] }, { WeaponsUnlocked: {} }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredScreenViewedFalse: 'WeaponUpgradeScreen' }, { ScreensViewed: { WeaponUpgradeScreen: true } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredScreenViewedFalse: 'WeaponUpgradeScreen' }, { ScreensViewed: {} }), null);
});

test('H1: removable-state absence gates stay blocked, not unobtainable', () => {
    // Cosmetics can be removed / swapped (decor toggles back off), so a
    // "must NOT have cosmetic X" gate is not provably permanent.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseCosmetics: ['Cosmetic_NorthHallSundial'] }, { Cosmetics: { Cosmetic_NorthHallSundial: true } }), null);
});

// --- permanence: set-and-forget GameState flags ------------------------------

test('H1: HardMode is fixed per save, so both flag directions are permanent', () => {
    // Hell Mode is baked into GameState.Flags at save creation and never
    // reassigned, so a save is permanently Hell or permanently not.
    // "must NOT be HardMode" on a Hell save can never become met.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['HardMode'] }, { Flags: { HardMode: true } }), 'unmet');
    // "must be HardMode" on a non-Hell save can never become met.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredTrueFlags: ['HardMode'] }, { Flags: {} }), 'unmet');
    // Matching state is satisfiable, not permanently unmet.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['HardMode'] }, { Flags: {} }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredTrueFlags: ['HardMode'] }, { Flags: { HardMode: true } }), null);
});

test('H1: one-way unlock flags are permanent only in the already-true direction', () => {
    // ShrineUnlocked / AspectsUnlocked are one-way unlocks (only ever set true).
    // "must NOT have unlocked" on an already-unlocked save can never become met.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['ShrineUnlocked'] }, { Flags: { ShrineUnlocked: true } }), 'unmet');
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['AspectsUnlocked'] }, { Flags: { AspectsUnlocked: true } }), 'unmet');
    // "must have unlocked" while still locked can unlock later -> blocked, not permanent.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredTrueFlags: ['ShrineUnlocked'] }, { Flags: {} }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredTrueFlags: ['AspectsUnlocked'] }, { Flags: {} }), null);
});

test('H1: toggleable story flags stay blocked, never permanently unmet', () => {
    // Persephone* (~7-run cycle), Dusa* (rehire), InFlashback (transient scene),
    // NyxChaosReunionInProgress all flip back and forth in normal play.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['PersephoneAway'] }, { Flags: { PersephoneAway: true } }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['DusaNotYetReHired'] }, { Flags: { DusaNotYetReHired: true } }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['InFlashback'] }, { Flags: { InFlashback: true } }), null);
    assert.equal(evaluateH1OtherReqPermanence({ RequiredTrueFlags: ['PersephoneAway'] }, { Flags: {} }), null);
    // A permanent flag in a multi-flag gate still dooms it.
    assert.equal(evaluateH1OtherReqPermanence({ RequiredFalseFlags: ['PersephoneAway', 'HardMode'] }, { Flags: { HardMode: true } }), 'unmet');
});

// --- unrecognised field ------------------------------------------------------

test('H1: an unmapped field is unknown rather than crashing', () => {
    const r = evaluateH1OtherRequirements({ RequiredSomethingBrandNew: 1 }, ctx({ gs: {} }));
    assert.equal(r.status, 'unknown');
    assert.match(r.clauses[0].reason, /not yet resolved/);
});

// --- owner run-context map ---------------------------------------------------

test('H1: owner run-context classifies hub / run / both speakers', () => {
    assert.equal(H1_OWNER_RUN_CONTEXT.NPC_Orpheus_01, 'hub');
    assert.equal(H1_OWNER_RUN_CONTEXT.NPC_Persephone_01, 'hub');
    assert.equal(H1_OWNER_RUN_CONTEXT.HermesUpgrade, 'run');
    assert.equal(H1_OWNER_RUN_CONTEXT.NPC_Persephone_Home_01, 'run');
    assert.equal(H1_OWNER_RUN_CONTEXT.NPC_Charon_01, 'run');
    assert.equal(H1_OWNER_RUN_CONTEXT.NPC_FurySister_01, 'both');
    assert.equal(H1_OWNER_RUN_CONTEXT.CharProtag, 'both');
});

// --- exported slice key lists ------------------------------------------------

test('H1: slice-key lists are non-empty unique string arrays', () => {
    for (const list of [H1_GAMESTATE_SLICE_KEYS, H1_CURRENTRUN_SLICE_KEYS]) {
        assert.ok(Array.isArray(list) && list.length > 0);
        assert.equal(new Set(list).size, list.length);
        assert.ok(list.every(k => typeof k === 'string'));
    }
});
