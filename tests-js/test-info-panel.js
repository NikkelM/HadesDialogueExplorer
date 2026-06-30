// Tests for ``templates/viewer/info-panel.js``.
//
// ``renderInfo`` writes its HTML into ``document.getElementById('info-content').innerHTML``,
// so we install a minimal ``document`` stub on ``globalThis`` that
// captures whatever was set. The module-level fixtures populate the
// data tables that ``renderInfo`` reads from.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderInfo, renderOtherReqEntryHtml, setOperandMarks } from '../templates/viewer/info-panel.js';
import { loadData, getActiveGame } from '../templates/viewer/data.js';
import { restoreSaveProgress, clearSaveProgress, SAVE_STORAGE_SCHEMA } from '../templates/viewer/save-parser.js';
import { loadFixtureData, buildFixtureData } from './fixtures.js';

// Captured innerHTML from the most recent renderInfo call.
let lastHtml = '';

// Minimal localStorage stub so the save-restore path works under Node;
// the trace-eligibility-button test seeds a save through it.
const _saveStore = new Map();
globalThis.localStorage = {
    getItem: k => (_saveStore.has(k) ? _saveStore.get(k) : null),
    setItem: (k, v) => { _saveStore.set(k, String(v)); },
    removeItem: k => { _saveStore.delete(k); },
};

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
    clearSaveProgress();
    _saveStore.clear();
});

test('renderInfo shows a prominent Trace eligibility button only when a matching save is loaded', () => {
    // No save loaded: the button is absent (the tracer needs a save).
    renderInfo('ZeusWithAphrodite01');
    assert.doesNotMatch(lastHtml, /trace-eligibility-btn/);

    // Load a save matching the active game (schema v1; games are frozen).
    _saveStore.set('hde.save', JSON.stringify({
        v: SAVE_STORAGE_SCHEMA, gameId: getActiveGame(), runs: 1, played: [],
    }));
    restoreSaveProgress();
    renderInfo('ZeusWithAphrodite01');
    assert.match(lastHtml, /trace-eligibility-btn/);
    assert.match(lastHtml, /Trace eligibility/);
    // It opens the tracer for this dialogue.
    assert.match(lastHtml, /navigateToEligibility\(&quot;ZeusWithAphrodite01&quot;\)/);
    clearSaveProgress();
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
    assert.match(lastHtml, /Type:/);
    assert.match(lastHtml, /<h4>Dialogue<\/h4>/);
    // The source-file/line meta was removed from the detail view.
    assert.doesNotMatch(lastHtml, /Source:/);
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


test('choicePrompt with a partially-unmapped option list still renders as a structured choice block', () => {
    // ``BecameCloseWithMegaera01`` in the shared fixture has three
    // choices, one of which (``Meg_UnknownInternalOnly``) deliberately
    // has no entry in ``choiceNames``. The previous implementation
    // gated structured choice rendering on EVERY option having a
    // friendly label, which silently demoted the whole prompt to a
    // bare speaker line. Option A from the issue drops that gate -
    // ``renderChoiceNameHtml`` already falls back to the internal id
    // for unmapped options, so the prompt now stays visible and the
    // unmapped id surfaces as a concrete string for the next
    // contributor to map.
    loadData(buildFixtureData());
    renderInfo('BecameCloseWithMegaera01');
    // Structured choice-prompt scaffolding is present.
    assert.match(lastHtml, /class="dialogue-line choice-prompt"/);
    assert.match(lastHtml, /class="choice-prompt-label">Choice:/);
    // All three options render with letters A / B / C.
    assert.match(lastHtml, /choice-option-letter">A:/);
    assert.match(lastHtml, /choice-option-letter">B:/);
    assert.match(lastHtml, /choice-option-letter">C:/);
    // Mapped options render their friendly labels.
    assert.match(lastHtml, />Go to Her</);
    assert.match(lastHtml, />Back Off</);
    // The unmapped option surfaces its internal id verbatim instead
    // of being silently dropped.
    assert.match(lastHtml, />Meg_UnknownInternalOnly</);
});


// Build a fixture for the H2 ``otherRequirements`` rendering path: the
// data carries compound operator-prefixed keys (PathTrue:..., Path:...,
// FunctionName:...) plus a bare label-less key. The viewer must
// surface friendly pills for the prefixed keys whose prefix has a label
// in ``reqTypeLabels``, while keeping unknown-prefix keys verbatim.
function fixtureWithOtherRequirements() {
    const data = buildFixtureData();
    // Borrow H2's operator-prefix labels for this fixture so the
    // viewer can resolve ``PathTrue`` / ``PathFalse`` / ``FunctionName``
    // / ``NamedRequirementsFalse`` prefixes encountered below.
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        PathTrue: 'Must be true',
        PathFalse: 'Must be false',
        FunctionName: 'Custom function check',
        NamedRequirementsFalse: 'Named requirements must NOT pass',
    };
    data.reqTypeTooltips = {
        ...data.reqTypeTooltips,
        PathTrue: 'Truthy-path check tooltip blurb.',
        // ``PathFalse`` deliberately has no tooltip entry to exercise the
        // header-only branch of ``reqTypeTitleText`` inside the renderer.
        FunctionName: 'Custom predicate tooltip blurb.',
        NamedRequirementsFalse: 'Named requirements inverse tooltip blurb.',
    };
    data.textlines.OrpheusOtherReqDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo line' }],
        requirements: {},
        otherRequirements: {
            'PathTrue:GameState.ReachedTrueEnding': [
                { PathTrue: ['GameState', 'ReachedTrueEnding'] },
            ],
            'PathFalse:CurrentRun.Cleared': [
                { PathFalse: ['CurrentRun', 'Cleared'] },
            ],
            'FunctionName:RequiredAlive': [
                { FunctionName: 'RequiredAlive', FunctionArgs: { Ids: [42] } },
            ],
            NamedRequirementsFalse: ['NoBossActive'],
            'UnknownPrefix:Foo.Bar': 'leave-me-raw',
        },
    };
    return data;
}


test('otherRequirements: with a matching save, gates show met/indeterminate eligibility dots', () => {
    // This fixture's gates use the H2 structured model (PathTrue / FunctionName /
    // NamedRequirements), so it must load under the Hades II game id for the H2
    // evaluator (not the flat-named-field H1 one) to resolve them.
    const fix = fixtureWithOtherRequirements();
    loadData({
        games: { hades2: fix }, gameIds: ['hades2'],
        gameLabels: { hades2: 'Hades II' }, defaultGame: 'hades2',
    });
    _saveStore.set('hde.save', JSON.stringify({
        v: SAVE_STORAGE_SCHEMA, gameId: getActiveGame(), runs: 1, played: [], gameState: { ReachedTrueEnding: true },
    }));
    restoreSaveProgress();
    renderInfo('OrpheusOtherReqDemo');
    // PathTrue:GameState.ReachedTrueEnding -> true in the slice -> satisfied (green dot).
    assert.match(
        lastHtml,
        /<span class="group-status group-status-met"[^>]*><\/span> <span class="other-req-text"><span class="req-type-name"[^>]*>Must be true<\/span>: <code class="other-req-path">GameState\.ReachedTrueEnding<\/code>/,
    );
    // PathFalse:CurrentRun.Cleared reads live run state -> indeterminate, with a reason.
    assert.match(lastHtml, /class="group-status group-status-unknown" data-tooltip="[^"]*current-run state/);
    clearSaveProgress();
});

test('otherRequirements: known operator prefixes render as friendly pills with tooltips', () => {
    loadData(fixtureWithOtherRequirements());
    renderInfo('OrpheusOtherReqDemo');
    // ``Other Requirements`` section header should be present.
    assert.match(lastHtml, /<h4><span class="toggle">.<\/span>Other Requirements<\/h4>/);
    // ``PathTrue:GameState.ReachedTrueEnding`` -> friendly pill +
    // monospace path tail. Tooltip carries internal name + blurb.
    // The trailing raw ``= [...]`` suffix is dropped: the path already
    // lives in the synthetic key so repeating it adds no info.
    assert.match(
        lastHtml,
        /<div class="other-req-item" data-tooltip="PathTrue: \{ &quot;GameState&quot;, &quot;ReachedTrueEnding&quot; \}"><span class="other-req-text"><span class="req-type-name" data-tooltip="Internal name: PathTrue\n\nTruthy-path check tooltip blurb\.">Must be true<\/span>: <code class="other-req-path">GameState\.ReachedTrueEnding<\/code><\/span><\/div>/
    );
    // ``PathFalse`` has a label but no tooltip entry: pill renders the
    // friendly text + header-only tooltip (internal name).
    assert.match(
        lastHtml,
        /<span class="req-type-name" data-tooltip="Internal name: PathFalse">Must be false<\/span>: <code class="other-req-path">CurrentRun\.Cleared<\/code>/
    );
    // ``FunctionName:RequiredAlive`` with numeric Ids -> friendly clause that
    // still surfaces the raw unit id.
    assert.match(
        lastHtml,
        /<span class="other-req-func-gate">unit <code class="other-req-path">42<\/code> must be alive<\/span>/
    );
    // Bare key ``NamedRequirementsFalse`` (no registry entry for the
    // fixture name ``NoBossActive``) -> friendly pill, value rendered
    // as the new flat-chip variant of the named-req expansion (no
    // resolved inner chain available -> chip, no expander). The
    // semantic suffix carries the ``(must NOT pass)`` clarifier so
    // the reader knows the operator's intent.
    assert.match(
        lastHtml,
        /<div class="other-req-item named-req-item"><div class="named-req-label"><span class="req-type-name" data-tooltip="Internal name: NamedRequirementsFalse\n\nNamed requirements inverse tooltip blurb\.">Named requirements must NOT pass<\/span>:<\/div><div class="named-req-list"><div class="named-req-flat"><code class="named-req-name">NoBossActive<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/div><\/div><\/div>/
    );
});


test('otherRequirements: unknown prefixes fall back to the raw escaped key', () => {
    loadData(fixtureWithOtherRequirements());
    renderInfo('OrpheusOtherReqDemo');
    // ``UnknownPrefix`` has no entry in ``reqTypeLabels`` - the
    // renderer must keep the original full key as plain escaped text
    // so nothing is lost when the per-game vocabulary doesn't cover a
    // newly-introduced operator. The row still carries a structured-
    // form tooltip via ``[data-tooltip]`` so the raw value is reachable
    // on hover even without a friendly summary.
    assert.match(
        lastHtml,
        /<div class="other-req-item" data-tooltip="UnknownPrefix = &quot;leave-me-raw&quot;"><span class="other-req-text">UnknownPrefix:Foo\.Bar = leave-me-raw<\/span><\/div>/
    );
    // The unknown key must NOT be wrapped in a req-type pill.
    assert.doesNotMatch(lastHtml, /<span class="req-type-name"[^>]*>UnknownPrefix<\/span>/);
});


// ``Path:<head>`` compound keys synthesised by ``_synth_other_key``
// carry no operator info in the prefix - the actual test op lives
// inside the value records. The renderer must pull the inner op into
// a human-readable line (``head <comparator> value`` for Comparison,
// ``head <verb>: <items>`` for membership tests).
function fixtureWithPathRecords() {
    const data = buildFixtureData();
    data.textlines.PathRecordDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo line' }],
        requirements: {},
        otherRequirements: {
            // Clean numeric comparison - the user's exact example.
            'Path:GameState.ClearedUnderworldRunsCache': [
                {
                    Comparison: '>',
                    Path: ['GameState', 'ClearedUnderworldRunsCache'],
                    Value: 2,
                },
            ],
            // IsAny membership test against a scalar value at the path.
            'Path:AudioState.AmbientTrackName': [
                {
                    IsAny: ['/Music/ArtemisSong_MC', '/Music/IrisEndThemeCrossroads_MC'],
                    Path: ['AudioState', 'AmbientTrackName'],
                },
            ],
            // HasAny membership test against a container at the path.
            'Path:CurrentRun.RoomsEntered': [
                {
                    HasAny: ['O_Boss01', 'O_Boss02'],
                    Path: ['CurrentRun', 'RoomsEntered'],
                },
            ],
            // Two records under the same Path:<head> key - independent AND-
            // clauses, rendered as one requirement row each.
            'Path:GameState.Resources.GiftPointsRare': [
                {
                    Comparison: '>=',
                    Path: ['GameState', 'Resources', 'GiftPointsRare'],
                    Value: 1,
                },
                {
                    Comparison: '<',
                    Path: ['GameState', 'Resources', 'GiftPointsRare'],
                    Value: 5,
                },
            ],
            // Decorated record carrying a SumPrevRuns modifier - rendered
            // as a friendly comparison with an "(over the last N runs)"
            // clause appended.
            'Path:GameState.RunsCache': [
                {
                    Comparison: '>=',
                    Path: ['GameState', 'RunsCache'],
                    SumPrevRuns: 3,
                    Value: 1,
                },
            ],
            // A record carrying a key the renderer does not recognise must
            // fall back to the raw JSON dump rather than silently drop it.
            'Path:GameState.TrulyUnknown': [
                {
                    Comparison: '>=',
                    Path: ['GameState', 'TrulyUnknown'],
                    Value: 1,
                    SomeUnknownModifier: true,
                },
            ],
        },
    };
    return data;
}


test('otherRequirements: Path:<head> + Comparison records render as "head op value"', () => {
    loadData(fixtureWithPathRecords());
    renderInfo('PathRecordDemo');
    // The user's exact requested format: ``GameState.ClearedUnderworldRunsCache > 2``.
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.ClearedUnderworldRunsCache<\/code> &gt; <code>2<\/code><\/span><\/div>/
    );
});


test('otherRequirements: Path:<head> + membership records render with a verbal operator', () => {
    loadData(fixtureWithPathRecords());
    renderInfo('PathRecordDemo');
    // IsAny -> "is one of": <items>
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">AudioState\.AmbientTrackName<\/code> is one of: <code>\/Music\/ArtemisSong_MC<\/code> \u2022 <code>\/Music\/IrisEndThemeCrossroads_MC<\/code><\/span><\/div>/
    );
    // HasAny -> "contains any of": <items>
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">CurrentRun\.RoomsEntered<\/code> contains any of: <code>O_Boss01<\/code> \u2022 <code>O_Boss02<\/code><\/span><\/div>/
    );
});


test('otherRequirements: multiple Path:<head> records under one key render as separate rows', () => {
    loadData(fixtureWithPathRecords());
    renderInfo('PathRecordDemo');
    // Two Comparison records on the same path are independent AND-clauses; each
    // renders on its own requirement row rather than joined into one long line.
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.Resources\.GiftPointsRare<\/code> &gt;= <code>1<\/code><\/span><\/div>/
    );
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.Resources\.GiftPointsRare<\/code> &lt; <code>5<\/code><\/span><\/div>/
    );
    // The records are no longer concatenated with a visible AND separator.
    assert.doesNotMatch(lastHtml, /class="other-req-and"/);
});


test('otherRequirements: Path:<head> + SumPrevRuns renders a friendly "(over the last N runs)" clause', () => {
    loadData(fixtureWithPathRecords());
    renderInfo('PathRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.RunsCache<\/code> &gt;= <code>1<\/code> <span class="other-req-mod">\(over the last 3 runs\)<\/span>/
    );
});


test('otherRequirements: Path:<head> records with unrecognised keys fall back to raw JSON', () => {
    loadData(fixtureWithPathRecords());
    renderInfo('PathRecordDemo');
    // An unknown modifier key must NOT be silently dropped - the raw
    // JSON dump preserves all fields verbatim.
    assert.match(lastHtml, /Path:GameState\.TrulyUnknown = /);
    assert.match(lastHtml, /SomeUnknownModifier/);
});


// Path:<head> records decorated with aggregation modifiers
// (TableValuesToCount / UseLength / CountPathTrue / SumOf / ValuePath /
// SumPrevRooms / ...). Each must render a friendly clause rather than
// falling back to raw JSON.
function fixtureWithModifierRecords() {
    const data = buildFixtureData();
    data.textlines.ModifierRecordDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo line' }],
        requirements: {},
        otherRequirements: {
            // TableValuesToCount counted against a threshold, summed over
            // previous runs (the user's reported example shape).
            'Path:EncountersOccurredCache': [
                {
                    Comparison: '>=',
                    Path: ['EncountersOccurredCache'],
                    SumPrevRuns: 2,
                    TableValuesToCount: ['DevotionTestF', 'DevotionTestG'],
                    Value: 1,
                },
            ],
            // UseLength -> "number of entries in <head>".
            'Path:GameState.WeaponsUnlocked': [
                { Comparison: '>=', Path: ['GameState', 'WeaponsUnlocked'], UseLength: true, Value: 3 },
            ],
            // CountPathTrue -> "number of true entries in <head>", summed.
            'Path:SpeechRecord': [
                { Comparison: '<=', Path: ['SpeechRecord'], CountPathTrue: true, SumPrevRuns: 4, Value: 0 },
            ],
            // SumOf -> "sum of <items> in <head>".
            'Path:GameState.RoomsEntered': [
                { Comparison: '>=', Path: ['GameState', 'RoomsEntered'], SumOf: ['N_Boss01', 'N_Boss02'], Value: 3 },
            ],
            // ValuePath compared with a negative ValuePathAddition.
            'Path:GameState.LastObjectiveFailedRun.NemesisBet': [
                {
                    Comparison: '<',
                    Path: ['GameState', 'LastObjectiveFailedRun', 'NemesisBet'],
                    ValuePath: ['GameState', 'CompletedRunsCache'],
                    ValuePathAddition: -5,
                },
            ],
            // Membership carrying a HintId (metadata) still renders friendly.
            'Path:GameState.TextLinesRecord': [
                { IsNone: ['SomeLine'], Path: ['GameState', 'TextLinesRecord'], HintId: 7 },
            ],
            // SumPrevRooms + IgnoreCurrentRun decorators combine.
            'Path:Encounter.NemesisShopping': [
                {
                    Comparison: '<=',
                    Path: ['Encounter', 'NemesisShopping'],
                    SumPrevRooms: 12,
                    IgnoreCurrentRun: true,
                    Value: 0,
                },
            ],
            // CountPathTrue + TableValuesToCount co-occur: count the truthy
            // entries among the listed items (still the count phrasing).
            'Path:EncountersOccurredCache2': [
                {
                    Comparison: '>=',
                    CountPathTrue: true,
                    Path: ['EncountersOccurredCache2'],
                    SumPrevRuns: 2,
                    TableValuesToCount: ['ArtemisCombatN', 'ArtemisCombatN2'],
                    Value: 1,
                },
            ],
        },
    };
    return data;
}


test('Path TableValuesToCount renders a count-of-items threshold with a run clause', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">EncountersOccurredCache<\/code> has at least <code>1<\/code> of: <code>DevotionTestF<\/code> \u2022 <code>DevotionTestG<\/code> <span class="other-req-mod">\(over the last 2 runs\)<\/span>/
    );
});


test('Path UseLength renders "Number of entries in <head>"', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /Number of entries in <code class="other-req-path">GameState\.WeaponsUnlocked<\/code> &gt;= <code>3<\/code>/
    );
});


test('Path CountPathTrue renders "Number of true entries in <head>" with a run clause', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /Number of true entries in <code class="other-req-path">SpeechRecord<\/code> &lt;= <code>0<\/code> <span class="other-req-mod">\(over the last 4 runs\)<\/span>/
    );
});


test('Path SumOf renders "Sum of <items> in <head>"', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /Sum of <code>N_Boss01<\/code> \u2022 <code>N_Boss02<\/code> in <code class="other-req-path">GameState\.RoomsEntered<\/code> &gt;= <code>3<\/code>/
    );
});


test('Path ValuePath renders the referenced path with a signed addition', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.LastObjectiveFailedRun\.NemesisBet<\/code> &lt; <code class="other-req-path">GameState\.CompletedRunsCache<\/code> - <code>5<\/code>/
    );
});


test('Path membership record carrying a HintId still renders friendly', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.TextLinesRecord<\/code> is none of: <code>SomeLine<\/code>/
    );
});


test('Path SumPrevRooms + IgnoreCurrentRun decorators combine in one clause', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<span class="other-req-mod">\(over the last 12 rooms, excluding the current run\)<\/span>/
    );
});


test('Path CountPathTrue + TableValuesToCount renders as a count-of-items threshold', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">EncountersOccurredCache2<\/code> has at least <code>1<\/code> of: <code>ArtemisCombatN<\/code> \u2022 <code>ArtemisCombatN2<\/code> <span class="other-req-mod">\(over the last 2 runs\)<\/span>/
    );
});


// ``FunctionName:<name>`` compound keys carry a record array whose
// entries each have ``FunctionName`` + optional ``FunctionArgs``. The
// renderer must format each as ``funcName(arg1=val1, arg2=val2) = true``
// with multiple records AND-joined, falling back to raw JSON for
// shapes that don't match.
function fixtureWithFunctionRecords() {
    const data = buildFixtureData();
    data.textlines.FunctionRecordDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo line' }],
        requirements: {},
        otherRequirements: {
            // Real-data shape - one of the most common H2 functions.
            'FunctionName:RequiredAlive': [
                { FunctionName: 'RequiredAlive', FunctionArgs: { Ids: [558096] } },
            ],
            // Argless function - args field absent entirely.
            'FunctionName:IsBossDifficultyShrineUpgradeActive': [
                { FunctionName: 'IsBossDifficultyShrineUpgradeActive' },
            ],
            // Two-argument function.
            'FunctionName:RequiredHealthFraction': [
                { FunctionName: 'RequiredHealthFraction', FunctionArgs: { Comparison: '<=', Value: 0.49 } },
            ],
            // Multiple records under the same key - independent AND-clauses,
            // rendered as one requirement row each.
            'FunctionName:RequiredAliveMulti': [
                { FunctionName: 'RequiredAliveMulti', FunctionArgs: { Ids: [1] } },
                { FunctionName: 'RequiredAliveMulti', FunctionArgs: { Ids: [2] } },
            ],
            // Decorated record carrying an unknown extra field - the
            // renderer must NOT pretend it's a clean function call.
            'FunctionName:Mystery': [
                { FunctionName: 'Mystery', FunctionArgs: {}, ExtraMeta: 'unexpected' },
            ],
        },
    };
    return data;
}


test('otherRequirements: FunctionName records render as friendly per-function clauses', () => {
    loadData(fixtureWithFunctionRecords());
    renderInfo('FunctionRecordDemo');
    // Single-arg function (numeric runtime Ids shown as the raw unit id).
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><span class="other-req-func-gate">unit <code class="other-req-path">558096<\/code> must be alive<\/span><\/span><\/div>/
    );
    // Two-arg health-fraction function: the 0.49 fraction reads as a percentage.
    assert.match(
        lastHtml,
        /<span class="other-req-func-gate">Player health at most 49%<\/span>/
    );
});


test('otherRequirements: FunctionName records with no args render a friendly clause', () => {
    loadData(fixtureWithFunctionRecords());
    renderInfo('FunctionRecordDemo');
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><span class="other-req-func-gate">Vow of Rivals is active \(boss fought in its unrivalled form\)<\/span><\/span><\/div>/
    );
});


test('otherRequirements: an unmapped FunctionName with multiple records renders each on its own row', () => {
    loadData(fixtureWithFunctionRecords());
    renderInfo('FunctionRecordDemo');
    // Each record is an independent AND-clause and renders on its own row.
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text">Function call to <code class="other-req-func">RequiredAliveMulti\(Ids=\[1\]\)<\/code> must evaluate to <code class="other-req-func">true<\/code><\/span><\/div>/
    );
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text">Function call to <code class="other-req-func">RequiredAliveMulti\(Ids=\[2\]\)<\/code> must evaluate to <code class="other-req-func">true<\/code><\/span><\/div>/
    );
    assert.doesNotMatch(lastHtml, /class="other-req-and"/);
});


test('otherRequirements: FunctionName records with unknown extra fields fall back to raw JSON', () => {
    loadData(fixtureWithFunctionRecords());
    renderInfo('FunctionRecordDemo');
    // The renderer must NOT silently drop ExtraMeta - it fails the
    // clean-record check and we fall back to ``key = JSON.stringify(val)``.
    assert.match(lastHtml, /FunctionName:Mystery = /);
    assert.match(lastHtml, /ExtraMeta/);
});


// The details panel must group its requirement sections AND its
// Other Requirements entries in ``reqTypeOrderIndex`` order so the
// reading order matches the tree view (both surfaces consume the
// single per-game ``reqTypeOrder`` array). Insertion order from the
// JSON data is NOT a stable signal - the H1 alphabetical-ish layout
// happened to be close to correct but H2 entries arrive in extractor
// emission order which is unrelated to the display banding.
function fixtureWithReqOrdering() {
    const data = buildFixtureData();
    // Extend the fixture's order vocabulary so the assertions below
    // can pin a deterministic header sequence. The chosen positions
    // mirror the real H1/H2 unified scheme:
    // ALL -> ANY -> NONE -> MIN -> MAX, with compound otherReq
    // prefixes appended after the textline block.
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        RequiredMinAnyTextLines: 'Required min (ANY)',
        RequiredMaxAnyTextLines: 'Required max (ANY)',
        PathTrue: 'Must be true',
        FunctionName: 'Custom function check',
    };
    data.reqTypeEdgeLabels = {
        ...data.reqTypeEdgeLabels,
        RequiredMinAnyTextLines: 'MIN',
        RequiredMaxAnyTextLines: 'MAX',
    };
    data.reqTypeOrder = [
        'RequiredTextLines',         // ALL
        'RequiredAnyTextLines',      // ANY
        'RequiredFalseTextLines',    // NONE
        'RequiredMinAnyTextLines',   // MIN
        'RequiredMaxAnyTextLines',   // MAX
        'PathTrue',                  // operator block
        'FunctionName',
    ];
    data.textlines.OrderingDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo line' }],
        // Insertion order is deliberately reversed vs reqTypeOrder so
        // the test fails if the renderer falls back to insertion order.
        requirements: {
            RequiredMaxAnyTextLines: ['LateA'],
            RequiredMinAnyTextLines: ['LateB'],
            RequiredFalseTextLines: ['Negative'],
            RequiredAnyTextLines: ['Either'],
            RequiredTextLines: ['Always'],
        },
        otherRequirements: {
            // ``FunctionName`` should sort after ``PathTrue`` per the
            // order array above; bare ``RequiredFalseTextLines`` (with a
            // ``Count`` companion - shared with the requirements entry)
            // is suppressed by the ``key in requirements`` guard so it
            // shouldn't appear on its own. Two ``PathTrue`` records test
            // stable sort: their relative order must match insertion.
            'FunctionName:RequiredAlive': [
                { FunctionName: 'RequiredAlive', FunctionArgs: { Ids: [1] } },
            ],
            'PathTrue:GameState.A': [{ PathTrue: ['GameState', 'A'] }],
            'PathTrue:GameState.B': [{ PathTrue: ['GameState', 'B'] }],
        },
    };
    return data;
}


test('requirement sections render in reqTypeOrderIndex order, not insertion order', () => {
    loadData(fixtureWithReqOrdering());
    renderInfo('OrderingDemo');
    // Extract the indices of each section header in the rendered HTML.
    // The five sections must appear in the order ALL -> ANY -> NONE ->
    // MIN -> MAX even though the requirements dict listed them
    // reversed.
    const headerOrder = [
        'Required (ALL)',
        'Required (ANY)',
        'Not played (NONE)',
        'Required min (ANY)',
        'Required max (ANY)',
    ];
    const positions = headerOrder.map((label) => lastHtml.indexOf(label));
    for (let i = 0; i < positions.length; i++) {
        assert.notEqual(positions[i], -1, `header "${headerOrder[i]}" missing from rendered HTML`);
    }
    for (let i = 1; i < positions.length; i++) {
        assert.ok(
            positions[i - 1] < positions[i],
            `header "${headerOrder[i - 1]}" should render before "${headerOrder[i]}" `
            + `(positions ${positions[i - 1]} vs ${positions[i]})`
        );
    }
});


test('otherRequirements entries render in reqTypeOrderIndex order by prefix, stable within prefix', () => {
    loadData(fixtureWithReqOrdering());
    renderInfo('OrderingDemo');
    // ``PathTrue`` is positioned before ``FunctionName`` in the
    // fixture's reqTypeOrder. The two PathTrue records must precede
    // the FunctionName record, and the two PathTrue records must
    // appear in insertion order (stable sort) - A before B.
    const pathA = lastHtml.indexOf('GameState.A');
    const pathB = lastHtml.indexOf('GameState.B');
    const funcAlive = lastHtml.indexOf('must be alive');
    assert.notEqual(pathA, -1, 'PathTrue:GameState.A missing');
    assert.notEqual(pathB, -1, 'PathTrue:GameState.B missing');
    assert.notEqual(funcAlive, -1, 'FunctionName:RequiredAlive clause missing');
    assert.ok(pathA < pathB, 'stable sort within same prefix violated (A should precede B)');
    assert.ok(pathB < funcAlive, 'PathTrue entries should precede FunctionName entries');
});




// H2 OrRequirements (alternative requirement groups). The details panel
// must surface every branch under a dedicated "Alternative Requirement
// Groups (OR)" section so the reader can see that the parent textline
// is satisfied if ANY one branch passes - this is a fundamentally
// different gating semantic to the AND base block above. Each branch
// renders its own per-req-type sub-sections + inline otherRequirements
// (no nested "Other Requirements" header inside a branch, since the
// branch header already provides scope).
function fixtureWithOrBranches() {
    const data = buildFixtureData();
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        PathTrue: 'Must be true',
    };
    data.textlines.OrDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'or demo' }],
        requirements: {
            RequiredTextLines: ['BaseDep'],
        },
        otherRequirements: {},
        orBranches: [
            {
                requirements: { RequiredTextLines: ['BranchOneDep'] },
                otherRequirements: { 'PathTrue:GameState.X': { Path: ['GameState', 'X'] } },
            },
            {
                requirements: { RequiredAnyTextLines: ['BranchTwoDepA', 'BranchTwoDepB'] },
                otherRequirements: {},
            },
        ],
    };
    return data;
}


test('OR branches render a dedicated option requirement groups section', () => {
    loadData(fixtureWithOrBranches());
    renderInfo('OrDemo');
    assert.match(lastHtml, /At least one of these 2 branches/);
    assert.match(lastHtml, /req-type-or-group/);
    // The wrapping section is a regular collapsible req-section so it
    // can be folded away if the user doesn't want to see the OR
    // alternatives detail.
    assert.match(lastHtml, /class="req-section req-type-or-group"/);
});


test('OR branches render one per-branch sub-header with the canonical "Option N of M" label', () => {
    loadData(fixtureWithOrBranches());
    renderInfo('OrDemo');
    const headerCount = (lastHtml.match(/class="or-branch-header"/g) || []).length;
    assert.equal(headerCount, 2);
    assert.match(lastHtml, /Option 1 of 2/);
    assert.match(lastHtml, /Option 2 of 2/);
});


test('OR branches still render their textline children inside req-type sub-sections', () => {
    loadData(fixtureWithOrBranches());
    renderInfo('OrDemo');
    // Each branch carries its own `.req-section.req-type-<X>` block
    // for textline-typed requirements so the per-branch contents read
    // with the same structure as the AND base block above.
    assert.match(lastHtml, /BranchOneDep/);
    assert.match(lastHtml, /BranchTwoDepA/);
    assert.match(lastHtml, /BranchTwoDepB/);
    // The branch with otherRequirements inlines them WITHOUT a nested
    // "Other Requirements" header (the surrounding branch already
    // provides scope) - exactly one Other Requirements header should
    // appear in the rendered HTML, only when the base block has its
    // own otherRequirements. The fixture's base has none, so the
    // header should not appear at all.
    const otherHeaders = (lastHtml.match(/Other Requirements/g) || []).length;
    assert.equal(otherHeaders, 0);
});


test('OR branches preserve the base AND block above with its own requirements', () => {
    loadData(fixtureWithOrBranches());
    renderInfo('OrDemo');
    // The base requirements must still render as a top-level section
    // separate from the OR group: a textline can have BOTH an AND
    // base block ("must always hold") and an OR alternatives block
    // ("any one of these as well"), and the reader needs to see
    // both clearly differentiated.
    assert.match(lastHtml, /BaseDep/);
    // The base RequiredTextLines section appears before the OR group
    // wrapper in the rendered HTML.
    const baseIdx = lastHtml.indexOf('BaseDep');
    const orIdx = lastHtml.indexOf('req-type-or-group');
    assert.ok(baseIdx > -1 && orIdx > -1);
    assert.ok(baseIdx < orIdx, 'base AND requirements should render before the OR alternatives section');
});


test('textlines without orBranches render no option requirement groups section', () => {
    loadData(buildFixtureData());
    renderInfo('OrpheusSingsAgain02');
    assert.doesNotMatch(lastHtml, /At least one of these/);
    assert.doesNotMatch(lastHtml, /req-type-or-group/);
    assert.doesNotMatch(lastHtml, /or-branch-header/);
});


// New simplified-rendering coverage: every path-op variant (PathTrue,
// PathFalse, PathEmpty, PathNotEmpty), the CountOf-decorated Path
// record, and the bare-key compact summaries (scalars, lists, Count-
// only and Count+Name objects, generic maps). Each row also carries a
// Lua-form ``data-tooltip`` on the wrapping ``.other-req-item`` so the
// raw structured value remains reachable on hover.
function fixtureWithSimplifiedOtherReqs() {
    const data = buildFixtureData();
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        PathTrue:     'Must be true',
        PathFalse:    'Must be false',
        PathEmpty:    'Path must be empty',
        PathNotEmpty: 'Path must not be empty',
        RequiresRunCleared:                'Requires run cleared',
        RequiredMinCompletedRuns:          'Required min completed runs',
        RequiredRoom:                      'Required room',
        RequiredFalseFlags:                'Required false flags',
        RequiredCosmetics:                 'Required cosmetics',
        MinRunsSinceAnyTextLines:          'Min runs since played (ANY)',
        RequiredMinActiveMetaUpgradeLevel: 'Required min active meta upgrade level',
        RequiredKills:                     'Required kills',
        RequiredMinNPCInteractions:        'Required min NPC interactions',
        RequiredLifetimeResourcesSpentMax: 'Maximum lifetime resource spent',
        RequiredValues:                    'GameState field must equal',
        RequiredFalseValues:               'GameState field must NOT equal',
        RequiredMinAnyCosmetics:           'Minimum cosmetics owned (from set)',
        RequiredCodexEntry:                'Codex entry must be unlocked',
        RequiredPlayed:                    'Voiceline must have played (ALL)',
    };
    data.textlines.SimplifiedOtherReqDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo' }],
        requirements: {},
        otherRequirements: {
            'PathTrue:GameState.ReachedTrueEnding': [
                { PathTrue: ['GameState', 'ReachedTrueEnding'] },
            ],
            'PathFalse:CurrentRun.Cleared': [
                { PathFalse: ['CurrentRun', 'Cleared'] },
            ],
            'PathEmpty:CurrentRun.Foo': [
                { PathEmpty: ['CurrentRun', 'Foo'] },
            ],
            'PathNotEmpty:CurrentRun.CurrentRoom.FishingPointChoices': [
                { PathNotEmpty: ['CurrentRun', 'CurrentRoom', 'FishingPointChoices'] },
            ],
            // Duplicate PathTrue records (engine permits this; the
            // extractor preserves both) get repeated friendly key
            // joined by AND.
            'PathTrue:GameState.Dup': [
                { PathTrue: ['GameState', 'Dup'] },
                { PathTrue: ['GameState', 'Dup'] },
            ],
            // PathFalse carrying a HintId (metadata) still renders
            // friendly - the HintId surfaces only in the raw tooltip.
            'PathFalse:CurrentRun.Hero.IsDead': [
                { PathFalse: ['CurrentRun', 'Hero', 'IsDead'], HintId: 'Codex_AthenaUnlockHint01' },
            ],
            // PathTrue carrying PathFromSource appends a "(from source)"
            // decorator clause.
            'PathTrue:WasRandomLoot': [
                { PathTrue: ['WasRandomLoot'], PathFromSource: true },
            ],
            // A voiceline-cue path leaf: a single ``SpeechRecord`` cue clause
            // renders as the friendly "Voiceline must (NOT) have played" label
            // (the cue scope drives the run / room suffix), with the ``/VO/``
            // scope stripped from the cue chip but kept in its tooltip.
            'PathTrue:GameState.SpeechRecord./VO/Artemis_0304': [
                { PathTrue: ['GameState', 'SpeechRecord', '/VO/Artemis_0304'] },
            ],
            'PathFalse:CurrentRun.SpeechRecord./VO/Hecate_0070': [
                { PathFalse: ['CurrentRun', 'SpeechRecord', '/VO/Hecate_0070'] },
            ],
            // CountOf inline list -> "head has at least N of items"
            'Path:CurrentRun.UseRecord': [
                {
                    Comparison: '>=',
                    CountOf: ['ZeusUpgrade', 'HeraUpgrade', 'PoseidonUpgrade'],
                    Path: ['CurrentRun', 'UseRecord'],
                    Value: 2,
                },
            ],
            // CountOf referencing a GameData table -> ref name (the
            // contents land in the tooltip via a future follow-up).
            'Path:GameState.WeaponsUnlocked': [
                {
                    Comparison: '>=',
                    CountOf: '<ref:GameData.AllWeaponAspects>',
                    Path: ['GameState', 'WeaponsUnlocked'],
                    Value: 1,
                },
                {
                    Comparison: '<=',
                    CountOf: '<ref:GameData.AllWeaponAspects>',
                    Path: ['GameState', 'WeaponsUnlocked'],
                    Value: 8,
                },
            ],
            // Bare keys with friendly labels.
            RequiresRunCleared:       true,
            RequiredMinCompletedRuns: 4,
            RequiredRoom:             'A_Boss02',
            RequiredFalseFlags:       ['InFlashback'],
            RequiredCosmetics:        ['QuestLog', 'Cosmetic_X'],
            MinRunsSinceAnyTextLines: { Count: 8 },
            RequiredMinActiveMetaUpgradeLevel: { Count: 1, Name: 'BossDifficultyShrineUpgrade' },
            RequiredKills:               { Harpy: 2 },
            RequiredMinNPCInteractions:  { 'NPC_Hades_01': 5 },
            RequiredLifetimeResourcesSpentMax: { Gems: 5000 },
            RequiredValues:              { CurrentEmployeeOfTheMonth: 'Dusa' },
            RequiredFalseValues:         { CurrentEmployeeOfTheMonth: 'Achilles' },
            RequiredMinAnyCosmetics:     { Cosmetics: ['Cosmetic_A', 'Cosmetic_B'], Count: 2 },
            RequiredCodexEntry:          { EntryIndex: 3, EntryName: 'RoomRewardConsolationPrize' },
            RequiredPlayed:              ['/VO/ZagreusHome_0895', '/VO/ZagreusHome_3490'],
        },
    };
    return data;
}


test('PathTrue row drops the redundant value suffix and carries a Lua tooltip', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(
        lastHtml,
        /<div class="other-req-item" data-tooltip="PathTrue: \{ &quot;GameState&quot;, &quot;ReachedTrueEnding&quot; \}">[^<]*<span class="other-req-text"><span class="req-type-name"[^>]*>Must be true<\/span>: <code class="other-req-path">GameState\.ReachedTrueEnding<\/code><\/span><\/div>/
    );
});


test('PathFalse row drops the redundant value suffix and carries a Lua tooltip', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(
        lastHtml,
        /data-tooltip="PathFalse: \{ &quot;CurrentRun&quot;, &quot;Cleared&quot; \}">[^<]*<span class="other-req-text"><span class="req-type-name"[^>]*>Must be false<\/span>: <code class="other-req-path">CurrentRun\.Cleared<\/code>/
    );
});


test('PathEmpty / PathNotEmpty rows use the consistent "must (not) be empty" wording', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /Path must be empty<\/span>: <code class="other-req-path">CurrentRun\.Foo<\/code>/);
    assert.match(lastHtml, /Path must not be empty<\/span>: <code class="other-req-path">CurrentRun\.CurrentRoom\.FishingPointChoices<\/code>/);
});


test('multiple PathTrue records under one key render as separate rows', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // Two PathTrue records on the same path are independent AND-clauses; each
    // renders on its own row with its own single-record tooltip, rather than
    // repeating the friendly key joined by AND on one line.
    const rowRe = /data-tooltip="PathTrue: \{ &quot;GameState&quot;, &quot;Dup&quot; \}">[^<]*<span class="other-req-text"><span class="req-type-name"[^>]*>Must be true<\/span>: <code class="other-req-path">GameState\.Dup<\/code><\/span><\/div>/g;
    const matches = lastHtml.match(rowRe);
    assert.ok(matches && matches.length === 2, 'expected two separate Must-be-true GameState.Dup rows');
    assert.doesNotMatch(lastHtml, /class="other-req-and"/);
});


test('PathFalse record carrying a HintId renders friendly (no raw fallback)', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // HintId is metadata - it must not force a raw JSON dump, and adds
    // no visible suffix (it remains in the row's hover tooltip only).
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Must be false<\/span>: <code class="other-req-path">CurrentRun\.Hero\.IsDead<\/code><\/span><\/div>/
    );
    assert.doesNotMatch(lastHtml, /PathFalse:CurrentRun\.Hero\.IsDead = /);
});


test('PathTrue record carrying PathFromSource appends a "(from source)" clause', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Must be true<\/span>: <code class="other-req-path">WasRandomLoot<\/code> <span class="other-req-mod">\(from source\)<\/span>/
    );
});


test('Path CountOf records render as "head has at least N of: items"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // Inline list: each item is a separate ``<code>`` chip.
    assert.match(
        lastHtml,
        /<code class="other-req-path">CurrentRun\.UseRecord<\/code> has at least <code>2<\/code> of: <code>ZeusUpgrade<\/code> \u2022 <code>HeraUpgrade<\/code> \u2022 <code>PoseidonUpgrade<\/code>/
    );
});


test('Path CountOf referencing a GameData table renders the ref name in the head position', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // The ``<ref:GameData.AllWeaponAspects>`` placeholder collapses to
    // the bare ``GameData.AllWeaponAspects`` identifier in display and
    // in the tooltip. The two records (a range check) are independent AND-
    // clauses, each rendered on its own row.
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has at least <code>1<\/code> of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code><\/span><\/div>/
    );
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has at most <code>8<\/code> of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code><\/span><\/div>/
    );
    // Tooltip carries the structured form with the bare ref name (not
    // the ``<ref:...>`` wrapper, which would clutter the display).
    assert.match(lastHtml, /data-tooltip="[^"]*CountOf: GameData\.AllWeaponAspects[^"]*"/);
});


test('bare-key scalars render as "Label: value"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Requires run cleared<\/span>: <code>true<\/code>/);
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required min completed runs<\/span>: <code>4<\/code>/);
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required room<\/span>: <code>A_Boss02<\/code>/);
});


test('bare-key list values render as comma-separated chips without JSON brackets', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required false flags<\/span>: <code>InFlashback<\/code>/);
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required cosmetics<\/span>: <code>QuestLog<\/code> \u2022 <code>Cosmetic_X<\/code>/);
});


test('voiceline cue operands drop the /VO/ prefix in the label but keep it in the tooltip', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // "/VO/ZagreusHome_0895" -> "ZagreusHome_0895", joined by the operand bullet.
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Voiceline must have played \(ALL\)<\/span>: <code data-tooltip="\/VO\/ZagreusHome_0895">ZagreusHome_0895<\/code> \u2022 <code data-tooltip="\/VO\/ZagreusHome_3490">ZagreusHome_3490<\/code>/
    );
});


test('voiceline cue PathTrue clause renders the friendly "Voiceline must have played" label', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // GameState scope -> no run/room suffix; cue chip drops /VO/, tooltip keeps it.
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Voiceline must have played<\/span>: <code data-tooltip="\/VO\/Artemis_0304">Artemis_0304<\/code>/
    );
});


test('voiceline cue PathFalse clause renders "Voiceline must NOT have played" with run scope', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // CurrentRun scope -> "(this run)" suffix.
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Voiceline must NOT have played \(this run\)<\/span>: <code data-tooltip="\/VO\/Hecate_0070">Hecate_0070<\/code>/
    );
});


test('equality gate shows the save actual value coloured beside the required value', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    // A failing RequiredValues gate: the save's actual employee (Megaera) differs
    // from the required Hypnos, so the actual renders red, in parens, by the field.
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: 'Megaera', met: false }]]) } });
    const missHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(missHtml, /<code[^>]*>CurrentEmployeeOfTheMonth<\/code> \(<code class="other-req-operand-unmet"[^>]*>Megaera<\/code>\) = <code[^>]*>Hypnos<\/code>/);
    // A satisfied gate colours the actual green; an unset field reads "(unset)".
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: 'Hypnos', met: true }]]) } });
    const okHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(okHtml, /\(<code class="other-req-operand-met"[^>]*>Hypnos<\/code>\)/);
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: null, met: false }]]) } });
    const unsetHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(unsetHtml, /\(<code class="other-req-operand-unmet">unset<\/code>\)/);
    setOperandMarks(null);
});


test('a broken / typo requirement key renders an amber warning and hides the value', () => {
    loadData(buildFixtureData());
    // RequiredTextLinesThis is a misspelled key the engine never reads. The row
    // shows the raw key + a "broken requirement key" warning (with the
    // explanation in the tooltip) and does NOT surface the operand value.
    const html = renderOtherReqEntryHtml('RequiredTextLinesThis', ['OlympianReunionQuestComplete']);
    assert.match(html, /<code class="other-req-path">RequiredTextLinesThis<\/code> <span class="other-req-broken-ref" data-tooltip="[^"]*never evaluates[^"]*">\(broken requirement key - never evaluated, no effect\)<\/span>/);
    // The operand value is intentionally absent.
    assert.doesNotMatch(html, /OlympianReunionQuestComplete/);
});


test('bare-key {Count} objects collapse to just the count', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Min runs since played \(ANY\)<\/span>: <code>8<\/code>/);
});


test('bare-key {Count, Name} objects render as "Name >= Count"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Required min active meta upgrade level<\/span>: <code>BossDifficultyShrineUpgrade<\/code> &gt;= <code>1<\/code>/
    );
});


test('bare-key map objects render as "k >= v, k >= v"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required kills<\/span>: <code>Harpy<\/code> &gt;= <code>2<\/code>/);
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Required min NPC interactions<\/span>: <code>NPC_Hades_01<\/code> &gt;= <code>5<\/code>/);
});

test('a "Max" bare-key gate renders with <= (at most), not >=', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // RequiredLifetimeResourcesSpentMax gates on "spent at most N", so the
    // operator must be <= - rendering >= would state the opposite.
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Maximum lifetime resource spent<\/span>: <code>Gems<\/code> &lt;= <code>5000<\/code>/);
    assert.doesNotMatch(lastHtml, /Maximum lifetime resource spent<\/span>: <code>Gems<\/code> &gt;=/);
});

test('equality / negation gates render with = / != , not >=', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // RequiredValues is an equality check (field === value); RequiredFalseValues
    // is its negation. Rendering either with >= states the opposite.
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>GameState field must equal<\/span>: <code>CurrentEmployeeOfTheMonth<\/code> = <code>Dusa<\/code>/);
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>GameState field must NOT equal<\/span>: <code>CurrentEmployeeOfTheMonth<\/code> &ne; <code>Achilles<\/code>/);
});

test('"N of a set" gates render as "at least N of: items", not an array dump', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // RequiredMinAnyCosmetics {Cosmetics:[...], Count} -> "at least N of: list".
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Minimum cosmetics owned \(from set\)<\/span>: at least <code>2<\/code> of: <code>Cosmetic_A<\/code> \u2022 <code>Cosmetic_B<\/code>/);
});

test('a structured Codex gate renders the entry name and unlock depth, not raw index/operator', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // EntryIndex is a cumulative threshold (first N entries unlocked), so it is
    // surfaced as readable detail alongside the entry name.
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Codex entry must be unlocked<\/span>: <code>RoomRewardConsolationPrize<\/code> \(first <code>3<\/code> entries\)/);
    // The old garbage render dumped "EntryIndex >= 3, EntryName >= ..." as the
    // visible value; the raw value still appears in the row's data-tooltip, so
    // only assert the broken visible form is gone.
    assert.doesNotMatch(lastHtml, /EntryIndex<\/code>/);
});


test('bare-key rows carry a Lua-form data-tooltip with the raw value', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // Scalar.
    assert.match(lastHtml, /data-tooltip="RequiresRunCleared = true"/);
    // List of strings -> Lua table braces with quoted entries.
    assert.match(lastHtml, /data-tooltip="RequiredFalseFlags = \{ &quot;InFlashback&quot; \}"/);
    // Object with bare-ident keys -> ``{ Count = 8 }``.
    assert.match(lastHtml, /data-tooltip="MinRunsSinceAnyTextLines = \{ Count = 8 \}"/);
    // Object with name+count.
    assert.match(
        lastHtml,
        /data-tooltip="RequiredMinActiveMetaUpgradeLevel = \{ Count = 1, Name = &quot;BossDifficultyShrineUpgrade&quot; \}"/
    );
});


// Build a fixture for the broader-coverage rendering refinements:
//   - bare keys WITHOUT a friendly label still get the friendly
//     ``Label: value`` shape (no raw JSON fallback), so lists render
//     with comma+space separators rather than ``["a","b"]`` blobs.
//   - membership / CountOf operand lists strip ``<ref:GameData.X>``
//     placeholders to the bare identifier.
function fixtureForBareKeyAndRefRefinements() {
    const data = buildFixtureData();
    data.textlines.UnlabelledOtherReqDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo' }],
        requirements: {},
        otherRequirements: {
            // No reqTypeLabels entry for any of these keys.
            RequiredAnyEncountersThisRun: [
                'ThanatosTartarus', 'ThanatosAsphodel',
                'ThanatosElysium', 'ThanatosElysiumIntro',
            ],
            RequiredResourcesMin: { GiftPoints: 1, SuperGiftPoints: 1 },
            // HasAny operand that is a top-level GameData ref string
            // (no array wrapper) -> styled as a path chip with the
            // ``<ref:>`` wrapper stripped.
            'Path:GameState.AspectsUnlocked': [
                { HasAny: '<ref:GameData.AllWeaponAspects>',
                  Path: ['GameState', 'AspectsUnlocked'] },
            ],
            // IsAny operand list that contains ref strings -> each
            // element strips ``<ref:>`` to the bare identifier.
            'Path:GameState.SelectedAspect': [
                { IsAny: ['<ref:GameData.WeaponAspectA>', 'PlainString'],
                  Path: ['GameState', 'SelectedAspect'] },
            ],
        },
    };
    return data;
}


test('unlabelled bare-key lists render as comma-space chips, not raw JSON', () => {
    loadData(fixtureForBareKeyAndRefRefinements());
    renderInfo('UnlabelledOtherReqDemo');
    // The pill carries no tooltip blurb (no reqTypeLabels entry) but
    // the value renders through the friendly formatter, so each
    // encounter is a separate ``<code>`` chip with ``", "`` joiners.
    assert.match(
        lastHtml,
        /<span class="req-type-name">RequiredAnyEncountersThisRun<\/span>: <code>ThanatosTartarus<\/code> \u2022 <code>ThanatosAsphodel<\/code> \u2022 <code>ThanatosElysium<\/code> \u2022 <code>ThanatosElysiumIntro<\/code>/
    );
    // The raw ``["a","b"]`` JSON fallback must NOT appear for this key
    // anywhere in the output.
    assert.doesNotMatch(lastHtml, /RequiredAnyEncountersThisRun = \[/);
});


test('unlabelled bare-key map values render as "k >= v" with the raw key as the label', () => {
    loadData(fixtureForBareKeyAndRefRefinements());
    renderInfo('UnlabelledOtherReqDemo');
    assert.match(
        lastHtml,
        /<span class="req-type-name">RequiredResourcesMin<\/span>: <code>GiftPoints<\/code> &gt;= <code>1<\/code> \u2022 <code>SuperGiftPoints<\/code> &gt;= <code>1<\/code>/
    );
});


test('membership operand that is a top-level GameData ref strips the <ref:> wrapper', () => {
    loadData(fixtureForBareKeyAndRefRefinements());
    renderInfo('UnlabelledOtherReqDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.AspectsUnlocked<\/code> contains any of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code>/
    );
});


test('membership operand list strips <ref:> on each element while keeping plain strings as plain chips', () => {
    loadData(fixtureForBareKeyAndRefRefinements());
    renderInfo('UnlabelledOtherReqDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.SelectedAspect<\/code> is one of: <code class="other-req-path">GameData\.WeaponAspectA<\/code> \u2022 <code>PlainString<\/code>/
    );
});


test('compound-record tooltips use newlines between fields in reading order (Path -> Comparison -> Value -> CountOf)', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // The CountOf record stored as { Comparison, CountOf, Path, Value }
    // (JSON-insertion order) must render its tooltip in canonical
    // reading order: Path first, then Comparison, then Value, then
    // CountOf - each field on its own line.
    assert.match(
        lastHtml,
        /data-tooltip="Path: \{ &quot;CurrentRun&quot;, &quot;UseRecord&quot; \}\nComparison: &quot;&gt;=&quot;\nValue: 2\nCountOf: \{ &quot;ZeusUpgrade&quot;, &quot;HeraUpgrade&quot;, &quot;PoseidonUpgrade&quot; \}"/
    );
});


test('multi-record compound gates split into one row per record, each with its own tooltip', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // The two-record CountOf (range check on WeaponsUnlocked) splits into one
    // row per record; each row's tooltip carries just its own record rather
    // than a blank-line-joined pair.
    assert.match(
        lastHtml,
        /data-tooltip="Path: \{ &quot;GameState&quot;, &quot;WeaponsUnlocked&quot; \}\nComparison: &quot;&gt;=&quot;\nValue: 1\nCountOf: GameData\.AllWeaponAspects"/
    );
    assert.match(
        lastHtml,
        /data-tooltip="Path: \{ &quot;GameState&quot;, &quot;WeaponsUnlocked&quot; \}\nComparison: &quot;&lt;=&quot;\nValue: 8\nCountOf: GameData\.AllWeaponAspects"/
    );
    // No blank-line-joined two-record tooltip remains.
    assert.doesNotMatch(lastHtml, /CountOf: GameData\.AllWeaponAspects\n\nPath:/);
});


// Fixture variant that also supplies the ``gameDataRefs`` registry so
// ``<ref:GameData.X>`` placeholders inside the row tooltip inline-
// expand to the referenced table's contents. Mirrors the real H2
// build output (``hades2_metadata.json``) where the registry is shipped
// alongside the textline data.
function fixtureWithGameDataRefs() {
    const data = fixtureWithSimplifiedOtherReqs();
    data.gameDataRefs = {
        'GameData.AllWeaponAspects': ['StaffClearCastAspect', 'StaffSelfHitAspect', 'StaffRaiseDeadAspect'],
        // Nested ScreenData.X table with a child list - exercises the
        // dotted-path walk for refs like ``ScreenData.Shrine.BountyOrder``.
        'ScreenData.Shrine': {
            BountyOrder: ['BountyA', 'BountyB'],
        },
        // Self-referential ref - the cycle guard must drop the second
        // recursion and fall back to the bare identifier.
        'GameData.SelfRef': ['<ref:GameData.SelfRef>'],
    };
    data.textlines.GameDataRefDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo' }],
        requirements: {},
        otherRequirements: {
            // Top-level GameData ref resolves to the list -> tooltip
            // shows the inlined contents on the ``CountOf`` line.
            'Path:GameState.WeaponsUnlocked': [
                {
                    Comparison: '>=',
                    CountOf: '<ref:GameData.AllWeaponAspects>',
                    Path: ['GameState', 'WeaponsUnlocked'],
                    Value: 1,
                },
            ],
            // Dotted-path ref (no direct entry) -> walks down through
            // the captured parent ``ScreenData.Shrine`` to find the
            // nested ``BountyOrder`` list.
            'Path:GameState.BountyHistory': [
                {
                    HasAny: '<ref:ScreenData.Shrine.BountyOrder>',
                    Path: ['GameState', 'BountyHistory'],
                },
            ],
            // Unknown ref (no entry, no walkable parent) -> falls back
            // to the bare identifier (existing behaviour).
            'Path:GameState.NoEntry': [
                {
                    HasAny: '<ref:GameData.NoSuchRegistry>',
                    Path: ['GameState', 'NoEntry'],
                },
            ],
            // Self-referential ref -> cycle guard kicks in on the
            // second recursion so the resolved-list contents show the
            // bare identifier rather than infinite-looping.
            'Path:GameState.SelfRefCheck': [
                {
                    HasAny: '<ref:GameData.SelfRef>',
                    Path: ['GameState', 'SelfRefCheck'],
                },
            ],
        },
    };
    return data;
}


test('top-level GameData ref expands inline inside the row tooltip', () => {
    loadData(fixtureWithGameDataRefs());
    renderInfo('GameDataRefDemo');
    // The CountOf line now shows the resolved list contents instead
    // of just the bare ``GameData.AllWeaponAspects`` identifier.
    assert.match(
        lastHtml,
        /CountOf: \{ &quot;StaffClearCastAspect&quot;, &quot;StaffSelfHitAspect&quot;, &quot;StaffRaiseDeadAspect&quot; \}/
    );
});


test('dotted-path ref walks down through a captured parent table', () => {
    loadData(fixtureWithGameDataRefs());
    renderInfo('GameDataRefDemo');
    // ``ScreenData.Shrine.BountyOrder`` has no direct entry; resolver
    // descends via the captured ``ScreenData.Shrine`` parent. Tooltip
    // surfaces the nested list contents on the ``HasAny`` line.
    assert.match(
        lastHtml,
        /HasAny: \{ &quot;BountyA&quot;, &quot;BountyB&quot; \}/
    );
});


test('unknown ref with no walkable parent falls back to the bare identifier', () => {
    loadData(fixtureWithGameDataRefs());
    renderInfo('GameDataRefDemo');
    // The synthesised row body for the ``Path:GameState.NoEntry``
    // entry must still render the bare identifier as a styled chip.
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.NoEntry<\/code> contains any of: <code class="other-req-path">GameData\.NoSuchRegistry<\/code>/
    );
    // And the row tooltip falls back to the bare identifier on the
    // HasAny line (no inline expansion possible).
    assert.match(
        lastHtml,
        /HasAny: GameData\.NoSuchRegistry/
    );
});


test('row display keeps the bare identifier even when the ref expands in the tooltip', () => {
    loadData(fixtureWithGameDataRefs());
    renderInfo('GameDataRefDemo');
    // The display side (the visible row content) intentionally keeps
    // the bare identifier as a path chip - expansion is tooltip-only
    // so long lists don't blow up the row width.
    assert.match(
        lastHtml,
        /<code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has at least <code>1<\/code> of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code>/
    );
});


test('self-referential ref expansion is cycle-guarded so resolution does not infinite-loop', () => {
    loadData(fixtureWithGameDataRefs());
    renderInfo('GameDataRefDemo');
    // First expansion of ``GameData.SelfRef`` reveals its single
    // element (which is itself a ``<ref:GameData.SelfRef>``); on the
    // recursive call the cycle guard drops the inner expansion and
    // falls back to the bare identifier rather than looping forever.
    assert.match(
        lastHtml,
        /HasAny: \{ GameData\.SelfRef \}/
    );
});


// Fixture variant for NamedRequirements drill-in: ships the
// ``namedRequirements`` registry so the host textline's
// ``NamedRequirementsFalse`` entries inline-expand into the resolved
// inner requirement chain (mirroring the real H2 metadata payload).
function fixtureWithNamedRequirements() {
    const data = fixtureWithSimplifiedOtherReqs();
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        NamedRequirementsFalse: 'Named requirements must NOT pass',
    };
    data.reqTypeTooltips = {
        ...(data.reqTypeTooltips || {}),
        NamedRequirementsFalse: 'Named requirements inverse tooltip blurb.',
    };
    data.namedRequirements = {
        // Typical resolved entry: has both a textline edge and a
        // non-dialogue gate. Expands fully.
        HecateMissing: {
            requirements: { RequiredTextLines: ['HecateBossKidnapped01'] },
            otherRequirements: {
                'PathFalse:GameState.ReachedTrueEnding': [
                    { PathFalse: ['GameState', 'ReachedTrueEnding'] },
                ],
            },
            orBranches: [],
            flags: {},
        },
        // Entry with an empty resolution: no edges, no other reqs,
        // no OR branches. Renders as a flat chip (no expander).
        EmptyResolution: {
            requirements: {},
            otherRequirements: {},
            orBranches: [],
            flags: {},
        },
        // Entry whose only content is OR branches: expansion must
        // include the OR-branches section.
        DreamRunIncorrectBiomeGuess: {
            requirements: {},
            otherRequirements: {},
            orBranches: [
                {
                    requirements: { RequiredTextLines: ['DreamRunBiomeGuessA'] },
                    otherRequirements: {},
                },
                {
                    requirements: { RequiredTextLines: ['DreamRunBiomeGuessB'] },
                    otherRequirements: {},
                },
            ],
            flags: {},
        },
        // Entry that itself references another named requirement via
        // ``NamedRequirementsFalse``. Exercises recursive expansion:
        // the host's NamedRequirementsFalse expands into a chain
        // that itself contains another NamedRequirementsFalse drill-
        // in expander. The pre-resolved registry breaks any potential
        // cycles via the Python ``_visited`` guard, so the viewer
        // never recurses through the same name twice.
        ScyllaBalladForced: {
            requirements: { RequiredTextLines: ['ScyllaAboutSongs02'] },
            otherRequirements: {
                NamedRequirementsFalse: ['HecateMissing'],
            },
            orBranches: [],
            flags: {},
        },
    };
    data.textlines.NamedReqExpansionDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'demo' }],
        requirements: {},
        otherRequirements: {
            NamedRequirementsFalse: [
                'HecateMissing',         // expands fully
                'EmptyResolution',       // flat chip (empty inner)
                'UnknownToRegistry',     // flat chip (no entry at all)
                'DreamRunIncorrectBiomeGuess',  // OR-branches only
                'ScyllaBalladForced',    // recursive expansion
            ],
        },
    };
    return data;
}


test('NamedRequirementsFalse: resolved entry expands into a collapsible inner chain', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    // The HecateMissing expander wraps a header (with ``(must NOT
    // pass)`` semantic suffix), a toggle, and a children container
    // that holds the resolved inner requirements + otherRequirements.
    assert.match(
        lastHtml,
        /<div class="named-req-expand"><h5 class="named-req-header"><span class="toggle">.<\/span><code class="named-req-name">HecateMissing<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/h5><div class="named-req-children expanded">/
    );
    // Inner body re-uses the per-req-type section markup; the
    // resolved textline edge renders as a clickable ``.req-item``.
    assert.match(
        lastHtml,
        /<div class="named-req-children expanded"><div class="req-section req-type-RequiredTextLines">[^]*HecateBossKidnapped01/
    );
    // Inner otherRequirements also renders via the standard
    // ``.other-req-item`` pipeline (PathFalse here).
    assert.match(
        lastHtml,
        /<div class="named-req-children expanded">[^]*<code class="other-req-path">GameState\.ReachedTrueEnding<\/code>/
    );
});


test('NamedRequirementsFalse: entry with an empty resolution renders as a flat chip (no expander)', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    assert.match(
        lastHtml,
        /<div class="named-req-flat"><code class="named-req-name">EmptyResolution<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/div>/
    );
});


test('NamedRequirementsFalse: unknown name (no registry entry) renders as a flat chip', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    // A name the registry doesn't cover falls through to the same
    // flat-chip variant as the empty-resolution case so the reader
    // still sees the gate, just without drill-in affordance.
    assert.match(
        lastHtml,
        /<div class="named-req-flat"><code class="named-req-name">UnknownToRegistry<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/div>/
    );
});


test('NamedRequirementsFalse: entry with only OR branches still expands and renders the OR-branches section inside the body', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    // DreamRunIncorrectBiomeGuess has no top-level requirements or
    // otherRequirements; its content lives entirely in orBranches.
    // The expander body must still surface the "At least one of
    // these N branches" section so the OR alternatives are visible.
    assert.match(
        lastHtml,
        /<code class="named-req-name">DreamRunIncorrectBiomeGuess<\/code>[^]*?<div class="named-req-children expanded">[^]*?At least one of these 2 branches/
    );
});


test('NamedRequirementsFalse: recursive expansion - inner chain may itself carry a NamedRequirementsFalse drill-in', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    // ScyllaBalladForced expands; its body has a nested
    // NamedRequirementsFalse pointing at HecateMissing which itself
    // expands (HecateMissing is also a top-level expander on the
    // host, so we expect two distinct HecateMissing expander headers
    // in the rendered HTML).
    const headers = lastHtml.match(/<code class="named-req-name">HecateMissing<\/code>/g) || [];
    assert.ok(headers.length >= 2, `expected at least 2 HecateMissing chips (host + nested), got ${headers.length}`);
});


test('NamedRequirementsFalse: per-name label pill is rendered exactly once (above the list, not per-entry)', () => {
    loadData(fixtureWithNamedRequirements());
    renderInfo('NamedReqExpansionDemo');
    // The semantic operator pill ("Named requirements must NOT
    // pass") wraps the entire list of names, not each entry. Asserts
    // that exactly one label pill appears on the host textline (the
    // nested expansions add their own pills inside their bodies).
    const labels = lastHtml.match(
        /<div class="named-req-label"><span class="req-type-name"[^>]*>Named requirements must NOT pass<\/span>/g
    ) || [];
    // Exactly 2 today: 1 for the host, 1 for the nested expansion in
    // ScyllaBalladForced. The host always has 1; the nested count is
    // an artefact of this fixture using ScyllaBalladForced.
    assert.equal(labels.length, 2);
});
