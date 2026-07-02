// Tests for ``templates/viewer/search-keywords.js`` - the concept
// ("buzzword") keyword mappings that let a player search a dialogue by
// what it is ABOUT ("eris romance") rather than its internal name.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    computeDialogueKeywords,
    keywordSetMatches,
    MIN_KEYWORD_TOKEN_LENGTH,
    KEYWORD_RULES,
} from '../templates/viewer/search-keywords.js';

// --- computeDialogueKeywords: name-pattern rules ------------------

test('romance concept fires on BecomingCloser / Relationship names', () => {
    const a = computeDialogueKeywords('ErisBecomingCloser01', 'InteractTextLineSets');
    assert.ok(a.has('romance'));
    assert.ok(a.has('relationship'));
    const b = computeDialogueKeywords('ThanatosAboutRelationship01', 'InteractTextLineSets');
    assert.ok(b.has('romance'));
    // ``courtship`` was intentionally dropped from the term list.
    assert.ok(!a.has('courtship'));
});

test('gift concept fires on GiftTextLineSets section and on nectar names', () => {
    const bySection = computeDialogueKeywords('ZeusGift01', 'GiftTextLineSets');
    assert.ok(bySection.has('gift'));
    assert.ok(bySection.has('nectar'));
    const byName = computeDialogueKeywords('AphroditeAboutNectar01', 'InteractTextLineSets');
    assert.ok(byName.has('gift'));
});

test('fishing / taverna / bathhouse are also tagged gift so "gift" finds them', () => {
    const fishing = computeDialogueKeywords('DoraFishing01', 'InteractTextLineSets');
    assert.ok(fishing.has('fishing'));
    assert.ok(fishing.has('lure'));
    assert.ok(fishing.has('gift'), 'fishing dialogues should also carry the gift concept');

    const bath = computeDialogueKeywords('AphroditeAboutBathHouse01', 'GiftTextLineSets');
    assert.ok(bath.has('bathhouse'));
    assert.ok(bath.has('salts'));
    assert.ok(bath.has('gift'));

    const taverna = computeDialogueKeywords('DoraTaverna01', 'GiftTextLineSets');
    assert.ok(taverna.has('taverna'));
    assert.ok(taverna.has('drinking'));
});

test('boss concept fires on Boss names/sections and carries the "guardian" synonym', () => {
    const s = computeDialogueKeywords('ChronosBossAboutChaos01', 'BossIntroTextLineSets');
    assert.ok(s.has('boss'));
    assert.ok(s.has('guardian'));
});

test('keepsake is NOT a concept (redundant with the literal name match)', () => {
    const s = computeDialogueKeywords('ErisBossAboutKeepsake01', 'BossIntroTextLineSets');
    assert.ok(!s.has('keepsake'));
    assert.ok(!KEYWORD_RULES.some(r => r.concept === 'keepsake'));
});

// --- collision avoidance: lure / salt as terms, never name patterns

test('"lure" does not tag Failure dialogues, "salt" does not tag BossAltFight dialogues', () => {
    // "Failure" contains "lure"; "BossAltFight" contains "salt". Neither is a
    // name pattern, so these dialogues must not pick up fishing / bathhouse.
    const failure = computeDialogueKeywords('NemesisAboutCombatFailure01', 'InteractTextLineSets');
    assert.ok(!failure.has('fishing'));
    assert.ok(!failure.has('lure'));

    const altFight = computeDialogueKeywords('ChronosBossAltFightMiscDefeat01', 'BossOutroTextLineSets');
    assert.ok(!altFight.has('bathhouse'));
    assert.ok(!altFight.has('salts'));
    // It does still (correctly) match boss / combat / death by other signals.
    assert.ok(altFight.has('boss'));
});

test('a name with no concept signal yields an empty keyword set', () => {
    const s = computeDialogueKeywords('ZagreusMiscThink01', 'InteractTextLineSets');
    assert.equal(s.size, 0);
});

// --- keywordSetMatches: prefix + min-length gating ----------------

test('keywordSetMatches: prefix match works for mid-typing', () => {
    const set = new Set(['romance', 'relationship']);
    assert.ok(keywordSetMatches(set, 'rom'));
    assert.ok(keywordSetMatches(set, 'relationship'));
    assert.ok(!keywordSetMatches(set, 'xyz'));
});

test('keywordSetMatches: tokens shorter than the minimum never fire', () => {
    const set = new Set(['romance']);
    assert.equal(MIN_KEYWORD_TOKEN_LENGTH, 3);
    assert.ok(!keywordSetMatches(set, 'ro'));
    assert.ok(!keywordSetMatches(set, 'r'));
    assert.ok(keywordSetMatches(set, 'rom'));
});

test('keywordSetMatches: empty / null set is a cheap miss', () => {
    assert.ok(!keywordSetMatches(null, 'romance'));
    assert.ok(!keywordSetMatches(new Set(), 'romance'));
});
