// Tests for ``templates/viewer/info-panel.js``.
//
// ``renderInfo`` writes its HTML into ``document.getElementById('info-content').innerHTML``,
// so we install a minimal ``document`` stub on ``globalThis`` that
// captures whatever was set. The module-level fixtures populate the
// data tables that ``renderInfo`` reads from.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderInfo } from '../templates/viewer/info-panel.js';
import { loadData } from '../templates/viewer/data.js';
import { loadFixtureData, buildFixtureData } from './fixtures.js';

// Captured innerHTML from the most recent renderInfo call.
let lastHtml = '';

// Minimal DOM stub: only the parts ``renderInfo`` touches.
// ``getElementById`` returns an object whose ``innerHTML`` setter
// records the rendered markup so the tests can assert on it.
globalThis.document = {
    getElementById(id) {
        if (id === 'info-content') {
            return {
                set innerHTML(v) { lastHtml = v; },
                get innerHTML() { return lastHtml; },
            };
        }
        return null;
    },
};

before(() => {
    loadFixtureData();
});

beforeEach(() => {
    lastHtml = '';
});


// Build a fixture-data object that includes a pair of suffixed
// collision sibling entries (the post-split shape produced by
// ``src.graph.split_name_collisions``).
function fixtureWithCollisionPair() {
    const data = buildFixtureData();
    data.textlines.Shared_1 = {
        owner: 'NPC_Zeus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'A.lua',
        sourceLine: 10,
        dialogueLines: [{ speaker: 'NPC_Zeus_01', text: 'first text' }],
        requirements: {},
        otherRequirements: {},
        collisionOriginalName: 'Shared',
        collisionIndex: 1,
        collisionTotal: 2,
        collisionSiblings: ['Shared_1', 'Shared_2'],
    };
    data.textlines.Shared_2 = {
        owner: 'NPC_Aphrodite_01',
        section: 'InteractTextLineSets',
        sourceFile: 'B.lua',
        sourceLine: 20,
        dialogueLines: [{ speaker: 'NPC_Aphrodite_01', text: 'second text' }],
        requirements: {},
        otherRequirements: {},
        collisionOriginalName: 'Shared',
        collisionIndex: 2,
        collisionTotal: 2,
        collisionSiblings: ['Shared_1', 'Shared_2'],
    };
    return data;
}


test('non-collision textline renders standard meta and a single Dialogue block', () => {
    renderInfo('ZeusWithAphrodite01');
    assert.match(lastHtml, /Owner:/);
    assert.match(lastHtml, /<h4>Dialogue<\/h4>/);
    // Standard render must not include the collision badge or banner.
    assert.doesNotMatch(lastHtml, /collision-badge/);
    assert.doesNotMatch(lastHtml, /collision-banner/);
});


test('renamed collision sibling renders the warning badge with a tooltip', () => {
    loadData(fixtureWithCollisionPair());
    renderInfo('Shared_1');
    // Compact badge in the header carries the rename signal with
    // the full engine-bug explanation tucked into the tooltip.
    assert.match(lastHtml, /collision-badge/);
    assert.match(lastHtml, /Renamed/);
    const badgeMatch = lastHtml.match(/<span class="collision-badge"[^>]*data-tooltip="([^"]*)"/);
    assert.ok(badgeMatch, 'expected a collision-badge with a data-tooltip popup');
    assert.match(badgeMatch[1], /TextLinesRecord/);
    assert.match(badgeMatch[1], /Shared/);
});


test('renamed collision sibling renders a banner with original name and all sibling links', () => {
    loadData(fixtureWithCollisionPair());
    renderInfo('Shared_1');
    assert.match(lastHtml, /collision-banner/);
    // Original (pre-rename) name surfaced for the user to recognise.
    assert.match(lastHtml, /Original name: <code>Shared<\/code>/);
    // Variant index + total visible in the banner header.
    assert.match(lastHtml, /Variant 1 of 2/);
    // Heading is "Duplicates of this dialogue" (not "Other variants")
    // so it reads naturally when it also lists the current entry.
    assert.match(lastHtml, /Duplicates of this dialogue:/);
    // ALL siblings are listed - including the currently-selected one -
    // so the user can quickly see how many duplicates exist without
    // having to mentally count + add the current entry.
    const siblingLinks = (lastHtml.match(/class="collision-sibling-link"/g) || []).length;
    assert.equal(siblingLinks, 2);
    // ``jsAttr`` HTML-escapes the wrapping quotes so the rendered
    // attribute is ``navigateTo(&quot;Shared_1&quot;)`` rather than
    // ``navigateTo("Shared_1")``.
    assert.match(lastHtml, /navigateTo\(&quot;Shared_1&quot;\)/);
    assert.match(lastHtml, /navigateTo\(&quot;Shared_2&quot;\)/);
    // The outer banner div itself carries no tooltip so hovering the
    // sibling links does not pop an obscuring tooltip. The full
    // engine-bug explanation is attached only to the inner
    // "Renamed for Dialogue Explorer" label (asserted below).
    // The custom-tooltip layer uses ``data-tooltip``; the legacy
    // ``title`` attribute must also be absent so no native browser
    // popup ever fires.
    const bannerMatch = lastHtml.match(/<div class="collision-banner"[^>]*>/);
    assert.ok(bannerMatch, 'expected a collision-banner div');
    assert.doesNotMatch(bannerMatch[0], /\bdata-tooltip=/);
    assert.doesNotMatch(bannerMatch[0], /\btitle=/);
    // Banner must NOT carry the generic ``meta`` class - that class
    // injects ``margin-right: 12px`` on every inner span via
    // ``.textline-info .meta span`` in panels.css, which would push
    // the rest of the header line away from the renamed-label span.
    assert.doesNotMatch(bannerMatch[0], /\bclass="[^"]*\bmeta\b/);
    // The "Renamed for Dialogue Explorer" label inside the banner
    // header carries the same tooltip as the header badge so the
    // explanation is reachable from both surfaces.
    const labelMatch = lastHtml.match(/<span class="collision-banner-label"[^>]*data-tooltip="([^"]*)"[^>]*>/);
    assert.ok(labelMatch, 'expected a collision-banner-label span with a data-tooltip popup');
    assert.match(labelMatch[1], /TextLinesRecord/);
    assert.match(labelMatch[1], /Shared/);
    // Badge tooltip and banner-label tooltip must match exactly so they
    // can't drift out of sync if the wording is updated later.
    const badgeMatch2 = lastHtml.match(/<span class="collision-badge"[^>]*data-tooltip="([^"]*)"/);
    assert.equal(labelMatch[1], badgeMatch2[1]);
});


test('renamed collision sibling renders dialogue + meta exactly once (no variant blocks)', () => {
    loadData(fixtureWithCollisionPair());
    renderInfo('Shared_1');
    const dialogueHeaders = (lastHtml.match(/<h4>Dialogue<\/h4>/g) || []).length;
    assert.equal(dialogueHeaders, 1);
    // Verbose per-variant block UI is gone now that we split into
    // sibling entries; assert that no variant-block markup leaked back
    // in from a stale code path.
    assert.doesNotMatch(lastHtml, /variant-block/);
    assert.doesNotMatch(lastHtml, /variants-section/);
});


test('non-collision textlines never render the collision badge or banner', () => {
    loadData(fixtureWithCollisionPair());
    renderInfo('OrpheusSingsAgain02');
    assert.doesNotMatch(lastHtml, /collision-badge/);
    assert.doesNotMatch(lastHtml, /collision-banner/);
});


// Build a fixture with a Patroclus-style boon-vendor textline whose
// choicePrompt mixes meta-upgrade-gated and unconditional options. Used
// by the grouping / tooltip tests below.
function fixtureWithBoonVendorChoices() {
    const data = buildFixtureData();
    data.textlines.PatroclusFirstMeeting01 = {
        owner: 'NPC_Patroclus_01',
        section: 'InteractTextLineSets',
        playOnce: false,
        narrativePrioritySectionTier: 'normal',
        narrativePrioritySetLevel: null,
        dialogueLines: [
            { speaker: 'NPC_Patroclus_01', text: 'Patroclus offers a token of his favour.',
              kind: 'choicePrompt',
              choices: [
                  { internal: 'ChoiceText_BuffExtraChance',          targetTextline: null,
                    requiredMetaUpgrade: 'ExtraChanceMetaUpgrade' },
                  { internal: 'ChoiceText_BuffExtraChanceReplenish', targetTextline: null,
                    requiredMetaUpgrade: 'ExtraChanceReplenishMetaUpgrade' },
                  { internal: 'ChoiceText_BuffHealing',              targetTextline: null },
                  { internal: 'ChoiceText_BuffWeapon',               targetTextline: null },
              ] },
        ],
        requirements: {},
        otherRequirements: {},
    };
    data.choiceNames = {
        ChoiceText_BuffExtraChance:          'Kiss of Styx Premium',
        ChoiceText_BuffExtraChanceReplenish: 'Touch of Styx Dark',
        ChoiceText_BuffHealing:              'HydraLite Gold',
        ChoiceText_BuffWeapon:               'Cyclops Jerky Select',
    };
    data.metaUpgradeNames = {
        ExtraChanceMetaUpgrade:          'Death Defiance',
        ExtraChanceReplenishMetaUpgrade: 'Stubborn Defiance',
    };
    return data;
}


test('consecutive meta-upgrade-gated boon choices share a base letter with numeric suffixes', () => {
    loadData(fixtureWithBoonVendorChoices());
    renderInfo('PatroclusFirstMeeting01');
    // The two gated choices form a single mutually-exclusive group
    // (same Mirror of Night row) so they share base letter A as A1/A2;
    // the two unconditional choices each consume their own letter (B, C).
    assert.match(lastHtml, /choice-option-letter">A1:/);
    assert.match(lastHtml, /choice-option-letter">A2:/);
    assert.match(lastHtml, /choice-option-letter">B:/);
    assert.match(lastHtml, /choice-option-letter">C:/);
    // No stray A3 / D - confirms the group is exactly the first two.
    assert.doesNotMatch(lastHtml, /choice-option-letter">A3:/);
    assert.doesNotMatch(lastHtml, /choice-option-letter">D:/);
});


test('meta-upgrade-gated choices append a Mirror of Night requirement to their tooltip', () => {
    loadData(fixtureWithBoonVendorChoices());
    renderInfo('PatroclusFirstMeeting01');
    // Each gated choice's choice-name span carries a two-line tooltip:
    // internal id + "Requires <FriendlyMirrorUpgradeName> (Mirror of Night)".
    // The tooltip lines are joined with a literal newline, which
    // ``escapeHtml`` passes through verbatim (the floating tooltip
    // layer in tooltip.js splits on \n at render time).
    const a1Match = lastHtml.match(/<span class="choice-name" data-tooltip="ChoiceText_BuffExtraChance\nRequires Death Defiance \(Mirror of Night\)"/);
    assert.ok(a1Match, 'expected A1 to surface Death Defiance in its tooltip');
    const a2Match = lastHtml.match(/<span class="choice-name" data-tooltip="ChoiceText_BuffExtraChanceReplenish\nRequires Stubborn Defiance \(Mirror of Night\)"/);
    assert.ok(a2Match, 'expected A2 to surface Stubborn Defiance in its tooltip');
    // Unconditional choices keep the original tooltip shape (internal id only).
    const bMatch = lastHtml.match(/<span class="choice-name" data-tooltip="ChoiceText_BuffHealing"/);
    assert.ok(bMatch, 'expected the ungated HydraLite Gold tooltip to stay internal-id only');
});


test('boon-vendor choice options render without a click-through link when targetTextline is null', () => {
    loadData(fixtureWithBoonVendorChoices());
    renderInfo('PatroclusFirstMeeting01');
    // The boon-vendor cues call a function directly so there is no
    // follow-up textline to navigate to. The choice-option block must
    // not wrap the friendly label in a ``<a class="choice-link">``.
    assert.doesNotMatch(lastHtml, /<a class="choice-link"/);
});

