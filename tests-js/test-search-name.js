// Tests for ``templates/viewer/search-name.js``.
//
// Covers the per-token tier ranking (issue #27) and the
// per-query lexicographic ordering across tokens (issue #66).

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    rankSearchToken,
    searchNameMatches,
} from '../templates/viewer/search-name.js';
import { loadFixtureData } from './fixtures.js';

before(() => {
    loadFixtureData();
});

test('rankSearchToken: tier 0 (prefix of textline name) wins over PascalCase boundary', () => {
    // Token at start of textline name -> tier 0.
    assert.equal(
        rankSearchToken('zeus', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        0,
    );
});

test('rankSearchToken: tier 1 (prefix of owner id or display)', () => {
    // Token doesn't prefix the textline name but does prefix the owner id.
    assert.equal(
        rankSearchToken('npc', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        1,
    );
});

test('rankSearchToken: tier 2 (PascalCase boundary inside textline name)', () => {
    // ``aphrodite`` matches at offset 8 in ``ZeusWithAphrodite01`` where
    // the original-case char is uppercase ``A`` - that's the PascalCase
    // boundary tier.
    assert.equal(
        rankSearchToken('aphrodite', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        2,
    );
});

test('rankSearchToken: tier 3 (mid-segment match in textline name)', () => {
    // ``ith`` matches at offset 5 in ``ZeusWithAphrodite01`` but the
    // original-case char at that position is lowercase, so it's tier 3
    // not tier 2.
    assert.equal(
        rankSearchToken('ith', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        3,
    );
});

test('rankSearchToken: tier 4 (token only inside owner id, not in textline name)', () => {
    // ``haron`` doesn't appear in the textline name and doesn't prefix
    // the owner id or display name, but it IS a substring of
    // ``npc_charon_01`` - the bottom tier.
    assert.equal(
        rankSearchToken('haron', 'SomeTextline01', 'sometextline01', 'npc_charon_01', 'charon'),
        4,
    );
});

test('rankSearchToken: returns -1 when the token appears nowhere', () => {
    assert.equal(
        rankSearchToken('xyzzy', 'ZeusWithAphrodite01', 'zeuswithaphrodite01', 'npc_zeus_01', 'zeus'),
        -1,
    );
});

test('searchNameMatches: AND across tokens (every token must match)', () => {
    // ``zeus`` matches both ZeusWith... and AphroditeWith...Zeus, but
    // ``aphrodite`` further constrains so we only get the two that
    // mention both names.
    const matches = searchNameMatches(['zeus', 'aphrodite'], 50);
    const names = matches.map((m) => m.name);
    assert.deepEqual(names.sort(), ['AphroditeWithZeus01', 'ZeusWithAphrodite01']);
});

test('searchNameMatches: query token order dominates ranking (issue #66)', () => {
    // "zeus aphrodite" - first token's tier is the dominant axis, so
    // ZeusWithAphrodite01 (tiers 0,2) must outrank AphroditeWithZeus01
    // (tiers 2,2) regardless of any later-token differences.
    const matches = searchNameMatches(['zeus', 'aphrodite'], 50);
    assert.equal(matches[0].name, 'ZeusWithAphrodite01');
    assert.equal(matches[1].name, 'AphroditeWithZeus01');

    // Reverse the query: now AphroditeWithZeus01 wins.
    const reversed = searchNameMatches(['aphrodite', 'zeus'], 50);
    assert.equal(reversed[0].name, 'AphroditeWithZeus01');
    assert.equal(reversed[1].name, 'ZeusWithAphrodite01');
});

test('searchNameMatches: a single non-matching token drops the candidate', () => {
    // ``zeus`` matches a couple of textlines; adding ``xyzzy`` (which
    // matches nothing) reduces the result set to empty - AND semantics.
    const matches = searchNameMatches(['zeus', 'xyzzy'], 50);
    assert.equal(matches.length, 0);
});

test('searchNameMatches: limit caps the result set', () => {
    // ``a`` will match plenty of names; verify the cap.
    const matches = searchNameMatches(['a'], 2);
    assert.equal(matches.length, 2);
});
