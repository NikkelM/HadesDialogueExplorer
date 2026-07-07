// Tests for ``templates/viewer/info-panel.js``.
//
// ``renderInfo`` writes its HTML into ``document.getElementById('info-content').innerHTML``,
// so we install a minimal ``document`` stub on ``globalThis`` that
// captures whatever was set. The module-level fixtures populate the
// data tables that ``renderInfo`` reads from.

import { test, before, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderInfo, renderOtherReqEntryHtml, setOperandMarks, renderStatusLegendHtml } from '../templates/viewer/info-panel.js';
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
    assert.match(lastHtml, /Check dialogue eligibility/);
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
    assert.match(badgeMatch[1], /records played lines globally by name/);
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
    assert.match(labelMatch[1], /records played lines globally by name/);
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
            {
                speaker: 'NPC_Patroclus_01', text: 'Patroclus offers a token of his favour.',
                kind: 'choicePrompt',
                choices: [
                    {
                        internal: 'ChoiceText_BuffExtraChance', targetTextline: null,
                        requiredMetaUpgrade: 'ExtraChanceMetaUpgrade'
                    },
                    {
                        internal: 'ChoiceText_BuffExtraChanceReplenish', targetTextline: null,
                        requiredMetaUpgrade: 'ExtraChanceReplenishMetaUpgrade'
                    },
                    { internal: 'ChoiceText_BuffHealing', targetTextline: null },
                    { internal: 'ChoiceText_BuffWeapon', targetTextline: null },
                ]
            },
        ],
        requirements: {},
        otherRequirements: {},
    };
    data.choiceNames = {
        ChoiceText_BuffExtraChance: 'Kiss of Styx Premium',
        ChoiceText_BuffExtraChanceReplenish: 'Touch of Styx Dark',
        ChoiceText_BuffHealing: 'HydraLite Gold',
        ChoiceText_BuffWeapon: 'Cyclops Jerky Select',
    };
    data.metaUpgradeNames = {
        ExtraChanceMetaUpgrade: 'Death Defiance',
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
    const a1Match = lastHtml.match(/<span class="choice-name" data-tooltip="Internal name: ChoiceText_BuffExtraChance\n\nRequires Death Defiance \(Mirror of Night\)"/);
    assert.ok(a1Match, 'expected A1 to surface Death Defiance in its tooltip');
    const a2Match = lastHtml.match(/<span class="choice-name" data-tooltip="Internal name: ChoiceText_BuffExtraChanceReplenish\n\nRequires Stubborn Defiance \(Mirror of Night\)"/);
    assert.ok(a2Match, 'expected A2 to surface Stubborn Defiance in its tooltip');
    // Unconditional choices keep the original tooltip shape (internal id only).
    const bMatch = lastHtml.match(/<span class="choice-name" data-tooltip="Internal name: ChoiceText_BuffHealing"/);
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
        /<div class="other-req-item named-req-item"><div class="named-req-label"><span class="req-header-text"><span class="req-type-name" data-tooltip="Internal name: NamedRequirementsFalse\n\nNamed requirements inverse tooltip blurb\.">Named requirements must NOT pass<\/span>:<\/span><\/div><div class="named-req-list"><div class="named-req-flat"><code class="named-req-name">NoBossActive<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/div><\/div><\/div>/
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
            // Decorated record carrying a SumPrevRuns modifier with a
            // non-boundary threshold - rendered as a friendly comparison with
            // an "(over the last N runs)" clause appended. (A boundary value
            // instead reads as a per-run window; see the dedicated test below.)
            'Path:GameState.RunsCache': [
                {
                    Comparison: '>=',
                    Path: ['GameState', 'RunsCache'],
                    SumPrevRuns: 3,
                    Value: 5,
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
        /<code class="other-req-path">GameState\.RunsCache<\/code> &gt;= <code>5<\/code> <span class="other-req-mod">\(over the last 3 runs\)<\/span>/
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
            // ValuePath compared with a negative ValuePathAddition (generic
            // path so it exercises raw ValuePath rendering, not a special gloss).
            'Path:GameState.SomeCounterCache': [
                {
                    Comparison: '<',
                    Path: ['GameState', 'SomeCounterCache'],
                    ValuePath: ['GameState', 'CompletedRunsCache'],
                    ValuePathAddition: -5,
                },
            ],
            // Membership carrying a HintId (metadata) still renders friendly.
            'Path:GameState.TextLinesRecord': [
                { IsNone: ['SomeLine'], Path: ['GameState', 'TextLinesRecord'], HintId: 7 },
            ],
            // SumPrevRooms + IgnoreCurrentRun decorators combine into the
            // "(over the last N rooms...)" suffix for a non-boundary threshold.
            'Path:Encounter.NemesisShopping': [
                {
                    Comparison: '<=',
                    Path: ['Encounter', 'NemesisShopping'],
                    SumPrevRooms: 12,
                    IgnoreCurrentRun: true,
                    Value: 3,
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
        /<code class="other-req-path">EncountersOccurredCache<\/code> has any of: <code>DevotionTestF<\/code> \u2022 <code>DevotionTestG<\/code> <span class="other-req-mod">\(over the last 2 runs\)<\/span>/
    );
});


test('Path UseLength renders "Number of distinct <head>"', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /Number of distinct <code class="other-req-path">GameState\.WeaponsUnlocked<\/code> &gt;= <code>3<\/code>/
    );
});


test('Path CountPathTrue over runs reads "In <quantifier> of the last N runs: <clause>"', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /In none of the last 4 runs: <code class="other-req-path">SpeechRecord<\/code>/
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
        /<code class="other-req-path">GameState\.SomeCounterCache<\/code> &lt; <code class="other-req-path">GameState\.CompletedRunsCache<\/code> - <code>5<\/code>/
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

// A boolean per-room record counted via ``ValuesToCount: [true]`` over a room
// window is a truthy-occurrence count (like CountPathTrue), so a ``<= 0`` gate
// reads "In none of the last N rooms: ..." rather than "has none of: true"
// (#134 follow-up: Encounter.NemesisShopping).
test('Path ValuesToCount [true] over a room window reads as an "In none of the last N rooms" clause', () => {
    const data = buildFixtureData();
    data.pathFieldNames = { ...(data.pathFieldNames || {}), 'Encounter.NemesisShopping': 'Nemesis appeared at a shop' };
    loadData(data);
    const html = _stripReq(renderOtherReqEntryHtml('Path:Encounter.NemesisShopping', [
        { Comparison: '<=', Path: ['Encounter', 'NemesisShopping'], SumPrevRooms: 12, Value: 0, ValuesToCount: [true] },
    ]));
    assert.equal(html, 'In none of the last 12 rooms: Nemesis appeared at a shop');
    // The awkward raw "has none of: true" / raw path must not leak.
    assert.doesNotMatch(html, /has none of|: true|NemesisShopping/);
});


test('Path CountPathTrue + TableValuesToCount renders as a count-of-items threshold', () => {
    loadData(fixtureWithModifierRecords());
    renderInfo('ModifierRecordDemo');
    assert.match(
        lastHtml,
        /<code class="other-req-path">EncountersOccurredCache2<\/code> has any of: <code>ArtemisCombatN<\/code> \u2022 <code>ArtemisCombatN2<\/code> <span class="other-req-mod">\(over the last 2 runs\)<\/span>/
    );
});


// Boundary count thresholds read as "has none of" / "has any of" rather than
// "has at most 0 of" / "has at least 1 of"; non-boundary counts keep the
// operator phrasing. Covers both the Comparison count-of-items path and the
// bare-key "N of a set" path (issue #134).
const _stripReq = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();

test('count-of-a-set boundary thresholds render as "has none of" / "has any of"', () => {
    loadData(buildFixtureData());
    const countRec = (op, value) => [{ Comparison: op, Path: ['GameState', 'RoomsEntered'], TableValuesToCount: ['A_Boss01', 'B_Boss01'], Value: value }];
    const r = (op, value) => _stripReq(renderOtherReqEntryHtml('Path:GameState.RoomsEntered', countRec(op, value)));
    // Boundary -> "none".
    assert.match(r('<=', 0), /has none of:/);
    assert.match(r('==', 0), /has none of:/);
    assert.match(r('<', 1), /has none of:/);
    assert.doesNotMatch(r('<=', 0), /at most 0/);
    // Boundary -> "any".
    assert.match(r('>=', 1), /has any of:/);
    assert.match(r('>', 0), /has any of:/);
    // Non-boundary keeps the operator phrasing.
    assert.match(r('>=', 3), /has at least <code>3<\/code> of:|has at least 3 of:/);
    assert.match(r('<=', 8), /has at most 8 of:/);
});

test('bare-key "N of a set" gate renders a Count of 0 as "none of"', () => {
    loadData(buildFixtureData());
    // A max-kind list gate with Count 0 -> "none of"; a min-kind Count 1 -> "any of".
    const maxHtml = _stripReq(renderOtherReqEntryHtml('RequiredMaxAnyCosmetics', { Cosmetics: ['Cosmetic_A', 'Cosmetic_B'], Count: 0 }));
    assert.match(maxHtml, /none of:/);
    assert.doesNotMatch(maxHtml, /at most 0/);
    const minHtml = _stripReq(renderOtherReqEntryHtml('RequiredMinAnyCosmetics', { Cosmetics: ['Cosmetic_A', 'Cosmetic_B'], Count: 1 }));
    assert.match(minHtml, /any of:/);
    // Non-boundary count keeps the quantifier.
    const min2 = _stripReq(renderOtherReqEntryHtml('RequiredMinAnyCosmetics', { Cosmetics: ['Cosmetic_A', 'Cosmetic_B'], Count: 2 }));
    assert.match(min2, /at least 2 of:/);
});

// --- issue #135: boundary phrasing for scalar / length / H1-Maximum gates ---

// Fixture carrying the H2 path vocabulary the boundary phrasing reads from.
function fixtureWithPathVocab() {
    const data = buildFixtureData();
    data.pathScopeNames = { CurrentRun: 'this run', PrevRun: 'last run', GameState: '' };
    data.pathFieldNames = {
        UseRecord: 'interacted with',
        RoomsEntered: 'entered',
        EnemyKills: 'killed',
        CompletedRunsCache: 'completed runs',
        SpentShrinePointsCache: 'total active Fear',
        Resources: 'current',
        TraitCache: 'boons/traits taken:',
        LifetimeResourcesGained: 'gained',
        'Hero.MetGods': 'gods encountered',
        'LastBossHealthBarRecord': 'previous-encounter health of',
    };
    data.pathObjectFields = ['UseRecord', 'RoomsEntered', 'EnemyKills', 'LastBossHealthBarRecord', 'Resources', 'TraitCache', 'LifetimeResourcesGained'];
    data.entityNames = {
        AresUpgrade: 'Ares', H_Boss01: "Cerberus' chamber", Chronos: 'Chronos',
        HadesSpearPoints: 'Gigaros', AthenaEncounterKeepsake: 'Gorgon Amulet', PlantFMoly: 'Moly',
        SorceryRegenUpgrade: 'The Moon', DoubleRewardBoon: 'Sea Star', NemesisBet: "Nemesis' wager",
        ForceApolloBoonKeepsake: 'Harmonic Photon', I: 'Tartarus', ArtemisCombatN: 'Artemis',
    };
    return data;
}

test('H1 "Maximum X: 0" max gate renders as "No X"', () => {
    const data = buildFixtureData();
    data.reqTypeLabels.RequiredMaxLastStands = 'Maximum Death Defiance charges remaining';
    loadData(data);
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMaxLastStands', 0)), 'No Death Defiance charges remaining');
    // Non-zero max keeps the "Maximum X: N" form.
    assert.match(_stripReq(renderOtherReqEntryHtml('RequiredMaxLastStands', 3)), /Maximum Death Defiance charges remaining : 3/);
});

test('H2 UseLength boundary renders "is empty" / "is not empty"', () => {
    loadData(fixtureWithPathVocab());
    const rec = (op, value) => [{ Comparison: op, Path: ['CurrentRun', 'Hero', 'MetGods'], UseLength: true, Value: value }];
    const r = (op, value) => _stripReq(renderOtherReqEntryHtml('Path:CurrentRun.Hero.MetGods', rec(op, value)));
    assert.match(r('==', 0), /Gods encountered is empty, this run/);
    assert.match(r('<=', 0), /is empty/);
    assert.match(r('<', 1), /is empty/);
    assert.match(r('>=', 1), /is not empty/);
    assert.match(r('>', 0), /is not empty/);
    // Non-boundary keeps the "Number of distinct X >= N" form.
    assert.match(r('>=', 3), /Number of distinct .* &gt;= .*3|Number of distinct .* >= .*3/);
});

test('H2 scalar event-count gate renders "Has" / "Never <verb>" at boundaries', () => {
    loadData(fixtureWithPathVocab());
    const rec = (path, op, value) => [{ Comparison: op, Path: path, Value: value }];
    const r = (path, op, value) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), rec(path, op, value)));
    // Event verb families: none -> "Never <verb>", any -> "Has <verb>".
    assert.match(r(['CurrentRun', 'UseRecord', 'AresUpgrade'], '<=', 0), /Never interacted with Ares/);
    assert.match(r(['CurrentRun', 'UseRecord', 'AresUpgrade'], '>=', 1), /Has interacted with Ares/);
    assert.match(r(['GameState', 'RoomsEntered', 'H_Boss01'], '==', 0), /Never entered Cerberus/);
    assert.match(r(['GameState', 'EnemyKills', 'Chronos'], '>', 0), /Has killed Chronos/);
    // Non-boundary keeps the operator.
    assert.match(r(['GameState', 'EnemyKills', 'Chronos'], '>=', 3), /Killed Chronos.*3/);
});

test('H2 scalar cumulative-count gate renders "No" / "Has <noun>"; value fields stay raw', () => {
    loadData(fixtureWithPathVocab());
    const rec = (path, op, value) => [{ Comparison: op, Path: path, Value: value }];
    const r = (path, op, value) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), rec(path, op, value)));
    assert.match(r(['GameState', 'CompletedRunsCache'], '<', 1), /No completed runs/);
    assert.match(r(['GameState', 'CompletedRunsCache'], '>', 0), /Has completed runs/);
    // A value cache (points total) keeps the raw operator at non-boundary
    // thresholds (it is not an occurrence count).
    assert.match(r(['GameState', 'SpentShrinePointsCache'], '>=', 2), /Total active Fear &gt;= 2|Total active Fear >= 2/);
    // ...but its 0/1 boundary reads as a curated possession clause.
    assert.match(r(['GameState', 'SpentShrinePointsCache'], '==', 0), /No active Fear/);
    assert.match(r(['GameState', 'SpentShrinePointsCache'], '>=', 1), /Has active Fear/);
});

// Curated "success / achievement / possession" scalar counters read as a whole
// natural clause at the 0/1 boundary instead of "<noun label> >= 1" (#134
// follow-up). Non-boundary thresholds keep the noun label + operator.
test('H2 achievement / possession counters read as a natural clause at the 0/1 boundary', () => {
    const data = fixtureWithPathVocab();
    // Glosses used only by the non-boundary assertions below (the boundary
    // clauses are curated and gloss-independent).
    data.pathFieldNames = {
        ...data.pathFieldNames,
        ClearedDreamRunsCache: 'cleared Dream Dives',
        ExorcismSuccessesFamiliar: 'shades pacified by Familiar',
    };
    loadData(data);
    const r = (path, op, value) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), [{ Comparison: op, Path: path, Value: value }]));
    // >= 1 / > 0 (any-side): "Has <done X>".
    assert.match(r(['GameState', 'ShovelSuccesses'], '>=', 1), /^Has dug successfully/);
    assert.match(r(['CurrentRun', 'FishingSuccessesManual'], '>=', 1), /Has caught a fish by hand/);
    assert.match(r(['GameState', 'ExorcismSuccessesFamiliar'], '>=', 1), /Has pacified a shade with Frinos/);
    assert.match(r(['CurrentRun', 'ExorcismSuccesses'], '>=', 1), /Has pacified a shade/);
    assert.match(r(['GameState', 'ClearedDreamRunsCache'], '>=', 1), /Has cleared a Dream Dive/);
    assert.match(r(['GameState', 'HighestShrinePointClearUnderworldCache'], '>=', 1), /Has cleared the Underworld with at least 1 Fear/);
    assert.match(r(['CurrentRun', 'Hero', 'UpgradableHammerCount'], '>=', 1), /Has an upgradable Daedalus Hammer/);
    // The run-scoped ones still append the run scope.
    assert.match(r(['CurrentRun', 'FishingSuccessesManual'], '>=', 1), /, this run$/);
    // == 0 / < 1 (none-side): "Has never <done X>".
    assert.match(r(['GameState', 'ShovelSuccesses'], '==', 0), /Has never dug successfully/);
    assert.match(r(['GameState', 'ClearedDreamRunsCache'], '<', 1), /Has never cleared a Dream Dive/);
    // Non-boundary threshold keeps the noun label + operator (no re-phrasing).
    assert.match(r(['GameState', 'ClearedDreamRunsCache'], '>=', 2), /Cleared Dream Dives &gt;= 2|Cleared Dream Dives >= 2/);
    assert.match(r(['GameState', 'ExorcismSuccessesFamiliar'], '>=', 5), /Shades pacified by Familiar .*5/);
    // No raw ">= 1" leaks for any of them.
    assert.doesNotMatch(r(['GameState', 'ShovelSuccesses'], '>=', 1), />= 1|&gt;= 1/);
});

// A Path* gate whose leaf is a known broken save-record reference (a UseRecord
// keyed by a dialogue id) renders as a broken requirement, not a glossed path
// with a "(cut content)" note (#134 follow-up: ZeusAboutAres01).
test('H2 a broken UseRecord-leaf gate renders as a broken requirement', () => {
    const data = fixtureWithPathVocab();
    data.reqTypeLabels = { ...data.reqTypeLabels, PathFalse: 'Must be false' };
    data.brokenPathRefs = { ZeusAboutAres02: 'Broken requirement: UseRecord only tracks interactions with entities, never dialogue ids.' };
    loadData(data);
    const html = renderOtherReqEntryHtml('PathFalse:GameState.UseRecord.ZeusAboutAres02', [{ PathFalse: ['GameState', 'UseRecord', 'ZeusAboutAres02'] }]);
    // Raw path shown (so the fault is visible) + the shared broken-requirement label.
    assert.match(html, /<code class="other-req-path">GameState\.UseRecord\.ZeusAboutAres02<\/code>/);
    assert.match(html, /class="other-req-broken-ref"[^>]*>\(broken requirement - always passes, no effect\)<\/span>/);
    // Not glossed as "Interacted with ..." and not labelled "(cut content)".
    assert.doesNotMatch(html, /Interacted with/);
    assert.doesNotMatch(html, /cut content/i);
});

test('H2 boss health-bar defeat gate renders "Defeated" / "Did not defeat" at value 0', () => {
    loadData(fixtureWithPathVocab());
    const rec = (path, op, value) => [{ Comparison: op, Path: path, Value: value }];
    const r = (path, op, value) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), rec(path, op, value)));
    const boss = ['GameState', 'LastBossHealthBarRecord', 'Chronos'];
    // Health depleted to exactly 0 = defeated; any health remaining (> 0) = not.
    assert.match(r(boss, '<=', 0), /Defeated Chronos .*last encounter/);
    assert.match(r(boss, '>', 0), /Did not defeat Chronos .*last encounter/);
    // The previous-run record reads "last run" rather than "last encounter".
    assert.match(r(['PrevRun', 'BossHealthBarRecord', 'Chronos'], '>', 0), /Did not defeat Chronos .*last run/);
    // Fractional "close match" / "barely lost" thresholds show a remaining-health
    // percentage (like the player-health gate), not a defeat verb. The
    // always-true >= 0 also reads as a percentage ("at least 0%").
    assert.match(r(boss, '<=', 0.15), /Previous-encounter health of Chronos at most 15%/);
    assert.match(r(boss, '>=', 0.25), /Previous-encounter health of Chronos at least 25%/);
    assert.doesNotMatch(r(boss, '<=', 0.15), /Defeated/);
    assert.match(r(boss, '>=', 0), /Previous-encounter health of Chronos at least 0%/);
    assert.doesNotMatch(r(boss, '>=', 0), /Defeated|Did not defeat/);
});

test('H2 resource / possession gate renders natural clauses on both boundaries', () => {
    loadData(fixtureWithPathVocab());
    const rec = (path, op, value) => [{ Comparison: op, Path: path, Value: value }];
    const r = (path, op, value) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), rec(path, op, value)));
    const res = ['GameState', 'Resources', 'HadesSpearPoints'];
    const trait = ['TraitCache', 'AthenaEncounterKeepsake'];
    const gained = ['GameState', 'LifetimeResourcesGained', 'PlantFMoly'];
    // Resources = live amount; TraitCache = use-count (not inventory); *Gained =
    // lifetime total. Zero side ("none") and at-least-one side ("any") each read
    // as their own natural phrasing.
    assert.match(r(res, '<=', 0), /Does not have Gigaros/);
    assert.match(r(res, '>=', 1), /Has Gigaros/);
    assert.match(r(trait, '<=', 0), /Has not used Gorgon Amulet/);
    assert.match(r(trait, '>=', 1), /Has used Gorgon Amulet/);
    assert.match(r(gained, '<=', 0), /Never gained Moly/);
    assert.match(r(gained, '>', 0), /Has gained Moly/);
    // No raw "current" gloss or operator leaks through for these fields.
    assert.doesNotMatch(r(res, '>=', 1), /Current Gigaros/);
    // Non-boundary counts still keep the operator phrasing (not re-phrased).
    assert.match(r(res, '>=', 5), /Current Gigaros.*5/);
});

// Class A: verb-style object fields used with a whole-record set/count
// aggregation read as a verb clause ("Entered any of: X") instead of leaking
// the raw path ("CurrentRun.RoomsEntered contains any of: X").
test('H2 verb-field set aggregations read as verb clauses', () => {
    loadData(fixtureWithPathVocab());
    const memb = (path, op, ops) => _stripReq(renderOtherReqEntryHtml('Path:' + path.join('.'), [{ [op]: ops, Path: path }]));
    assert.match(memb(['CurrentRun', 'RoomsEntered'], 'HasAny', ['H_Boss01']), /Entered any of: Cerberus/);
    assert.match(memb(['CurrentRun', 'UseRecord'], 'HasNone', ['AresUpgrade']), /Interacted with none of: Ares/);
    assert.match(memb(['GameState', 'EnemyKills'], 'HasAll', ['Chronos']), /Killed all of: Chronos/);
    assert.doesNotMatch(memb(['CurrentRun', 'RoomsEntered'], 'HasAny', ['H_Boss01']), /RoomsEntered/);
    // The run scope must survive even though a bare verb-field has no gloss:
    // CurrentRun -> "this run"; GameState carries no scope.
    assert.match(memb(['CurrentRun', 'RoomsEntered'], 'HasAny', ['H_Boss01']), /, this run$/);
    assert.doesNotMatch(memb(['GameState', 'EnemyKills'], 'HasAll', ['Chronos']), /this run/);
    // CountOf: boundary -> "<verb> any of"; non-boundary -> "<verb> at least N of".
    const cnt = (op, val) => _stripReq(renderOtherReqEntryHtml('Path:CurrentRun.RoomsEntered', [{ Comparison: op, Path: ['CurrentRun', 'RoomsEntered'], TableValuesToCount: ['H_Boss01'], Value: val }]));
    assert.match(cnt('>=', 1), /Entered any of: Cerberus/);
    assert.match(cnt('>=', 3), /Entered at least .*3.* of: Cerberus/);
    // SumOf -> "Number of times <verb>: X".
    const sum = _stripReq(renderOtherReqEntryHtml('Path:CurrentRun.RoomsEntered', [{ Comparison: '>=', Path: ['CurrentRun', 'RoomsEntered'], SumOf: ['H_Boss01'], Value: 2 }]));
    assert.match(sum, /Number of times entered\s*:\s*Cerberus/);
});

// Class B + leaf/sub-field special renderers.
test('H2 keepsake rarity, Arcana state, lifetime use, objective delta, region clear', () => {
    loadData(fixtureWithPathVocab());
    const rec = (obj) => _stripReq(renderOtherReqEntryHtml('Path:' + obj.Path.join('.'), [obj]));
    // Keepsake rarity (IsAny top-range on ...TraitDictionary.<K>.1.Rarity).
    assert.match(
        rec({ IsAny: ['Epic', 'Heroic'], Path: ['CurrentRun', 'Hero', 'TraitDictionary', 'ForceApolloBoonKeepsake', '1', 'Rarity'] }),
        /Equipped Harmonic Photon at Epic rarity or higher/
    );
    // Arcana card rank -> tier name (rank 3 = Epic).
    assert.match(rec({ Comparison: '>=', Path: ['GameState', 'MetaUpgradeState', 'SorceryRegenUpgrade', 'Level'], Value: 3 }), /The Moon Arcana is upgraded to Epic rank or higher/);
    // Lifetime trait use count.
    assert.match(rec({ Comparison: '>=', Path: ['GameState', 'LifetimeTraitStats', 'DoubleRewardBoon', 'UseCount'], Value: 15 }), /Runs using Sea Star >= .*15/);
    // Objective last-failed run delta -> "N+ runs ago".
    assert.match(
        rec({ Comparison: '<', Path: ['GameState', 'LastObjectiveFailedRun', 'NemesisBet'], ValuePath: ['GameState', 'CompletedRunsCache'], ValuePathAddition: -5 }),
        /Nemesis' wager last failed 5\+ runs ago/
    );
    // ClearedWithWeapons region form (leaf is a region code).
    assert.match(rec({ HasNone: ['SomeWeapon'], Path: ['GameState', 'ClearedWithWeapons', 'I'] }), /Cleared Tartarus with none of:/);
});

// A scalar per-run occurrence record (UseRecord.<X>) summed over a window at a
// 0/1 boundary reads as a per-run window ("In none / at least one of the last N
// runs: ...") rather than a self-contradictory "Never ... (over the last N
// runs)". Covers issue #134 round-4 item C.
test('H2 boundary SumPrevRuns reads as an "In <none|at least one> of the last N runs" window', () => {
    loadData(fixtureWithPathVocab());
    const rec = (obj) => _stripReq(renderOtherReqEntryHtml('Path:' + obj.Path.join('.'), [obj]));
    // == 0 over runs -> "In none of the last N runs" (shape of MorosAboutQuestLog08).
    const none = rec({ Comparison: '==', Path: ['UseRecord', 'ArtemisCombatN'], SumPrevRuns: 3, IgnoreCurrentRun: true, Value: 0 });
    assert.match(none, /In none of the last 3 runs: Interacted with Artemis/);
    assert.match(none, /excluding the current run/);
    assert.doesNotMatch(none, /Never/);
    // >= 1 over runs -> "In at least one of the last N runs" (AphroditeAboutAthena02).
    assert.match(
        rec({ Comparison: '>=', Path: ['UseRecord', 'AresUpgrade'], SumPrevRuns: 2, Value: 1 }),
        /In at least one of the last 2 runs: Interacted with Ares/
    );
});

// QuestsCompleted HasAll <ref:QuestOrderData> is the "every Minor Prophecy"
// gate; the raw ref name must not leak (item D, MorosAboutQuestLog08).
test('H2 QuestsCompleted HasAll QuestOrderData reads "Completed all Minor Prophecies"', () => {
    loadData(buildFixtureData());
    assert.equal(
        _stripReq(renderOtherReqEntryHtml('Path:GameState.QuestsCompleted', [{ HasAll: '<ref:QuestOrderData>', Path: ['GameState', 'QuestsCompleted'] }])),
        'Completed all Minor Prophecies'
    );
});

// A CurrentRun run-type boolean (ActiveBounty / IsDreamRun) as a PathTrue /
// PathFalse gate reads "Must be true/false: This run is a ..." (item E).
test('H2 ActiveBounty / IsDreamRun PathTrue reads "This run is a Chaos Trial / Dream Dive"', () => {
    loadData(buildFixtureData());
    assert.match(
        _stripReq(renderOtherReqEntryHtml('PathTrue:CurrentRun.ActiveBounty', [{ PathTrue: ['CurrentRun', 'ActiveBounty'] }])),
        /This run is a Chaos Trial/
    );
    assert.match(
        _stripReq(renderOtherReqEntryHtml('PathFalse:CurrentRun.IsDreamRun', [{ PathFalse: ['CurrentRun', 'IsDreamRun'] }])),
        /This run is a Dream Dive/
    );
});

// NextBiomeStateName is/isn't "Rain" -> the region's weather, keeping the field
// clause and relabelling only the value (item F).
test('H2 NextBiomeStateName Rain reads "Raining" / "Not raining"', () => {
    const data = buildFixtureData();
    data.pathFieldNames = { ...(data.pathFieldNames || {}), NextBiomeStateName: 'next region condition' };
    loadData(data);
    assert.equal(_stripReq(renderOtherReqEntryHtml('Path:GameState.NextBiomeStateName', [{ IsAny: ['Rain'], Path: ['GameState', 'NextBiomeStateName'] }])), 'Next region condition is: Raining');
    assert.equal(_stripReq(renderOtherReqEntryHtml('Path:GameState.NextBiomeStateName', [{ IsNone: ['Rain'], Path: ['GameState', 'NextBiomeStateName'] }])), 'Next region condition is: Not raining');
});

// RequireAffordableGhostAdminItems names an incantation as plain resolved text,
// not an operand code chip (item G, HecateAboutStormStopNotCast01).
test('H2 RequireAffordableGhostAdminItems renders the incantation as plain text', () => {
    loadData(fixtureWithPathVocab());
    const html = renderOtherReqEntryHtml('FunctionName:RequireAffordableGhostAdminItems', [
        { FunctionArgs: { CategoryIndex: 1, HasAny: ['AresUpgrade'] }, FunctionName: 'RequireAffordableGhostAdminItems' },
    ]);
    assert.equal(_stripReq(html), 'Can afford incantation: Ares');
    // The incantation name must not be wrapped in an operand <code> chip.
    assert.doesNotMatch(html, /<code[^>]*>Ares<\/code>/);
});

// A curated GameState.Flags leaf name is used verbatim, not camelCase-split
// (item I, CirceAboutScyllaQuestComplete01).
test('H2 the AcquiredMixerForCirceQuest flag reads "Acquired Pearl for Circe"', () => {
    const data = fixtureWithPathVocab();
    data.reqTypeLabels = { ...data.reqTypeLabels, PathTrue: 'Must be true' };
    data.pathFieldNames = { ...data.pathFieldNames, Flags: 'Story flag:' };
    data.pathObjectFields = [...data.pathObjectFields, 'Flags'];
    data.pathFieldLeafNames = { Flags: { AcquiredMixerForCirceQuest: 'Acquired Pearl for Circe' } };
    loadData(data);
    const html = _stripReq(renderOtherReqEntryHtml('PathTrue:GameState.Flags.AcquiredMixerForCirceQuest', [{ PathTrue: ['GameState', 'Flags', 'AcquiredMixerForCirceQuest'] }]));
    assert.match(html, /Acquired Pearl for Circe/);
    // Not the raw camelCase split ("Acquired Mixer For Circe Quest").
    assert.doesNotMatch(html, /Mixer/);
});

test('H1 minimum-of-1 value-map gate drops the redundant ">= 1"', () => {
    loadData(buildFixtureData());
    const html = _stripReq(renderOtherReqEntryHtml('RequiredResourcesMin', { Nectar: 1, TitanBlood: 5 }));
    // "at least 1" is implied by the "Minimum ..." label -> show the entity only.
    assert.match(html, /Nectar\b/);
    assert.doesNotMatch(html, /Nectar >= 1|Nectar &gt;= 1/);
    // A higher threshold keeps the operator.
    assert.match(html, /TitanBlood >= 5|TitanBlood &gt;= 5/);
});

test('H1 RequiredMaxHealthFraction renders like H2 ("Health at most N%")', () => {
    loadData(buildFixtureData());
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMaxHealthFraction', 0.5)), 'Health at most 50%');
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMaxHealthFraction', 0.33)), 'Health at most 33%');
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMinHealthFraction', 0.25)), 'Health at least 25%');
    // No leftover "fraction" label or raw 0.xx value.
    const html = renderOtherReqEntryHtml('RequiredMaxHealthFraction', 0.5);
    assert.doesNotMatch(html, /fraction/i);
    assert.doesNotMatch(html, /0\.5/);
    // Both games route through the shared _healthFractionGloss, so the H1 bare
    // field and the H2 function-gate record must produce byte-identical HTML.
    const h1 = renderOtherReqEntryHtml('RequiredMaxHealthFraction', 0.49);
    const h2 = renderOtherReqEntryHtml('FunctionName:RequiredHealthFraction', [
        { FunctionName: 'RequiredHealthFraction', FunctionArgs: { Comparison: '<=', Value: 0.49 } },
    ]);
    assert.equal(h1, h2);
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
        /<span class="other-req-func-gate">Health at most 49%<\/span>/
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
        PathTrue: 'Must be true',
        PathFalse: 'Must be false',
        PathEmpty: 'Path must be empty',
        PathNotEmpty: 'Path must not be empty',
        RequiresRunCleared: 'Requires run cleared',
        RequiredMinCompletedRuns: 'Required min completed runs',
        RequiredRoom: 'Required room',
        RequiredFalseFlags: 'Required false flags',
        RequiredCosmetics: 'Required cosmetics',
        MinRunsSinceAnyTextLines: 'Min runs since played (ANY)',
        RequiredMinActiveMetaUpgradeLevel: 'Required min active meta upgrade level',
        RequiredKills: 'Required kills',
        ObjectivesCompleted: 'Minimum objective completions',
        ObjectiveMaxDemo: 'Objective max demo',
        RequiredMinNPCInteractions: 'Required min NPC interactions',
        RequiredLifetimeResourcesSpentMax: 'Maximum lifetime resource spent',
        RequiredValues: 'GameState field must equal',
        RequiredFalseValues: 'GameState field must NOT equal',
        RequiredMinAnyCosmetics: 'Minimum cosmetics owned (from set)',
        RequiredCodexEntry: 'Codex entry must be unlocked',
        RequiredPlayed: 'Voiceline must have played (ALL)',
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
            RequiresRunCleared: true,
            RequiredMinCompletedRuns: 4,
            RequiredRoom: 'A_Boss02',
            RequiredFalseFlags: ['InFlashback'],
            RequiredCosmetics: ['QuestLog', 'Cosmetic_X'],
            MinRunsSinceAnyTextLines: { Count: 8 },
            RequiredMinActiveMetaUpgradeLevel: { Count: 1, Name: 'BossDifficultyShrineUpgrade' },
            RequiredKills: { Harpy: 2 },
            ObjectivesCompleted: { Name: 'PlayerKills', Min: 8 },
            ObjectiveMaxDemo: { Name: 'Deaths', Max: 3 },
            RequiredMinNPCInteractions: { 'NPC_Hades_01': 5 },
            RequiredLifetimeResourcesSpentMax: { Gems: 5000 },
            RequiredValues: { CurrentEmployeeOfTheMonth: 'Dusa' },
            RequiredFalseValues: { CurrentEmployeeOfTheMonth: 'Achilles' },
            RequiredMinAnyCosmetics: { Cosmetics: ['Cosmetic_A', 'Cosmetic_B'], Count: 2 },
            RequiredCodexEntry: { EntryIndex: 3, EntryName: 'RoomRewardConsolationPrize' },
            RequiredPlayed: ['/VO/ZagreusHome_0895', '/VO/ZagreusHome_3490'],
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
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has any of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code><\/span><\/div>/
    );
    assert.match(
        lastHtml,
        /<div class="other-req-item"[^>]*><span class="other-req-text"><code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has at most <code>8<\/code> of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code><\/span><\/div>/
    );
    // Tooltip carries the structured form with the bare ref name (not
    // the ``<ref:...>`` wrapper, which would clutter the display).
    assert.match(lastHtml, /data-tooltip="[^"]*CountOf: GameData\.AllWeaponAspects[^"]*"/);
});


test('bare-key scalars render as "Label: value" (boolean flags render label-only)', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // A boolean-true flag gate states its whole condition in the label, so no
    // redundant ": true" is appended (mirrors H2's PathTrue / PathFalse gates).
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Requires run cleared<\/span>/);
    assert.doesNotMatch(lastHtml, /Requires run cleared<\/span>: <code>true<\/code>/);
    // Numeric / string scalars still render their value.
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
    // from the required Hypnos, so the actual renders red, in parens, beside the
    // curated "Employee of the Month is ..." clause.
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: 'Megaera', met: false }]]) } });
    const missHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(missHtml, /Employee of the Month is <code[^>]*>Hypnos<\/code> \(<code class="other-req-operand-unmet"[^>]*>Megaera<\/code>\)/);
    // A satisfied gate colours the actual green; an unset field reads "(unset)".
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: 'Hypnos', met: true }]]) } });
    const okHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(okHtml, /\(<code class="other-req-operand-met"[^>]*>Hypnos<\/code>\)/);
    setOperandMarks({ flat: { green: new Set(), red: new Set(), actuals: new Map([['CurrentEmployeeOfTheMonth', { value: null, met: false }]]) } });
    const unsetHtml = renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Hypnos' });
    assert.match(unsetHtml, /\(<code class="other-req-operand-unmet">unset<\/code>\)/);
    setOperandMarks(null);
});


// Curated H1 GameState value-map gates read as friendly clauses instead of the
// generic "GameState field ..." label + raw field name (#134 follow-up).
test('H1 curated GameState value fields render friendly clauses', () => {
    const data = fixtureWithSimplifiedOtherReqs();
    data.badgeRankManager = 'Resources Director';
    data.badgeRankNames = { 6: 'Alpha Fixer', 21: 'Alpha Shadow', 50: 'Unseen One' };
    loadData(data);
    // Employee of the Month (RequiredValues == / RequiredFalseValues !=).
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredValues', { CurrentEmployeeOfTheMonth: 'Megaera' })), 'Employee of the Month is Megaera');
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredFalseValues', { CurrentEmployeeOfTheMonth: 'Zagreus' })), 'Employee of the Month is not Zagreus');
    // Cerberus pettings (RequiredMinValues >=).
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMinValues', { NumCerberusPettings: 20 })), 'Petted Cerberus at least 20 times');
    // BadgeRank (RequiredMinValues >=) -> Resources Director rank name.
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMinValues', { BadgeRank: 6 })), 'Resources Director rank: Alpha Fixer or higher');
    assert.equal(_stripReq(renderOtherReqEntryHtml('RequiredMinValues', { BadgeRank: 50 })), 'Resources Director rank: Unseen One or higher');
    // A value with no rank name falls back to the generic label (no crash).
    assert.match(_stripReq(renderOtherReqEntryHtml('RequiredMinValues', { BadgeRank: 999 })), /BadgeRank/);
});

// H2 GameState.BadgeRank path comparison resolves to the Spirit Mixer rank name.
test('H2 GameState.BadgeRank resolves to the Spirit Mixer rank name', () => {
    const data = buildFixtureData();
    data.pathScopeNames = { GameState: '' };
    data.badgeRankManager = 'Spirit Mixer';
    data.badgeRankNames = { 41: 'Unseen X', 50: 'Unseen I' };
    loadData(data);
    // == exact rank.
    assert.equal(_stripReq(renderOtherReqEntryHtml('Path:GameState.BadgeRank', [{ Comparison: '==', Path: ['GameState', 'BadgeRank'], Value: 50 }])), 'Spirit Mixer rank: Unseen I');
    // >= "or higher".
    assert.equal(_stripReq(renderOtherReqEntryHtml('Path:GameState.BadgeRank', [{ Comparison: '>=', Path: ['GameState', 'BadgeRank'], Value: 41 }])), 'Spirit Mixer rank: Unseen X or higher');
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

test('a malformed path (operator keyword as root) renders a broken-path no-op note', () => {
    loadData(buildFixtureData());
    // ``PathFalse: ["PathFalse", "RoomsEntered", "N_Opening01"]`` - the operator
    // leaked into the path (a source typo). Show the raw path + a note that the
    // root doesn't exist so the "must be false" check always passes / has no effect.
    const key = 'PathFalse:PathFalse.RoomsEntered.N_Opening01';
    const html = renderOtherReqEntryHtml(key, [{ PathFalse: ['PathFalse', 'RoomsEntered', 'N_Opening01'] }]);
    assert.match(html, /<code class="other-req-path">PathFalse\.RoomsEntered\.N_Opening01<\/code>/);
    assert.match(html, /class="other-req-broken-ref"[^>]*>\(broken path - always passes, no effect\)<\/span>/);
});

// H1 "played"-family gates reference a voiceline by ``/VO/<cue>`` id; when the
// cue's spoken line was recovered (from the source comment) into ``cueTexts``,
// the operand renders as the quoted line, not the raw cue id (#134 follow-up).
test('a /VO/ voice-line ref renders as its recovered spoken line', () => {
    const data = buildFixtureData();
    data.reqTypeLabels = { ...data.reqTypeLabels, RequiredPlayed: 'Voiceline must have played (ALL)' };
    data.cueTexts = { ZagreusHome_2930: { text: 'Dusa, you did it!', speaker: 'Zagreus' } };
    loadData(data);
    const html = renderOtherReqEntryHtml('RequiredPlayed', ['/VO/ZagreusHome_2930']);
    // The spoken line is shown, quoted, with the speaker in parens; the raw cue
    // id moves to the tooltip.
    assert.match(_stripReq(html), /"Dusa, you did it!" \(Zagreus\)/);
    assert.match(html, /data-tooltip="[^"]*ZagreusHome_2930[^"]*"/);
    assert.doesNotMatch(_stripReq(html), /\/VO\/|ZagreusHome_2930/);
    // A cue with no recovered text keeps the raw (VO-stripped) id.
    const raw = _stripReq(renderOtherReqEntryHtml('RequiredPlayed', ['/VO/ZagreusField_0744']));
    assert.match(raw, /ZagreusField_0744/);
});

// A voice-line operand carries the save's played/not-played colour like any
// other operand: green when the cue has played (RequiredPlayed satisfied), red
// when a "must NOT have played" cue has played.
test('a /VO/ voice-line ref is coloured green / red by the loaded save', () => {
    const data = buildFixtureData();
    data.reqTypeLabels = { ...data.reqTypeLabels, RequiredPlayed: 'Voiceline must have played (ALL)', RequiredFalsePlayed: 'Voiceline must NOT have played (ANY)' };
    data.cueTexts = { ZagreusHome_2930: { text: 'Dusa, you did it!', speaker: 'Zagreus' } };
    loadData(data);
    setOperandMarks({ flat: { green: new Set(['/VO/ZagreusHome_2930']), red: new Set(), actuals: new Map() } });
    assert.match(renderOtherReqEntryHtml('RequiredPlayed', ['/VO/ZagreusHome_2930']), /<code class="other-req-operand-met"[^>]*>"Dusa, you did it!" \(Zagreus\)<\/code>/);
    setOperandMarks({ flat: { green: new Set(), red: new Set(['/VO/ZagreusHome_2930']), actuals: new Map() } });
    assert.match(renderOtherReqEntryHtml('RequiredFalsePlayed', ['/VO/ZagreusHome_2930']), /<code class="other-req-operand-unmet"[^>]*>"Dusa, you did it!" \(Zagreus\)<\/code>/);
    setOperandMarks(null);
});

// The H2 equivalent: a single-cue SpeechRecord PathTrue / PathFalse gate colours
// its voiceline chip the same way (green when the wanted cue has played, red when
// a forbidden cue has played), driven by the same operand marks
// (``_h2SpeechCueMark`` -> ``_curGreen`` / ``_curRed``).
test('an H2 SpeechRecord voice-line gate is coloured green / red by the loaded save', () => {
    const data = buildFixtureData();
    data.cueTexts = { Artemis_0304: { text: 'Got it', speaker: 'Artemis' } };
    loadData(data);
    const key = 'PathTrue:GameState.SpeechRecord./VO/Artemis_0304';
    const val = [{ PathTrue: ['GameState', 'SpeechRecord', '/VO/Artemis_0304'] }];
    setOperandMarks({ flat: { green: new Set(['/VO/Artemis_0304']), red: new Set(), actuals: new Map() } });
    assert.match(renderOtherReqEntryHtml(key, val), /<code class="other-req-operand-met"[^>]*>"Got it" \(Artemis\)<\/code>/);
    const negKey = 'PathFalse:GameState.SpeechRecord./VO/Artemis_0304';
    const negVal = [{ PathFalse: ['GameState', 'SpeechRecord', '/VO/Artemis_0304'] }];
    setOperandMarks({ flat: { green: new Set(), red: new Set(['/VO/Artemis_0304']), actuals: new Map() } });
    assert.match(renderOtherReqEntryHtml(negKey, negVal), /<code class="other-req-operand-unmet"[^>]*>"Got it" \(Artemis\)<\/code>/);
    // No marks (cue not played, or no save) -> neutral chip, no colour class.
    setOperandMarks(null);
    assert.doesNotMatch(renderOtherReqEntryHtml(key, val), /other-req-operand-(met|unmet)/);
});


test('closing voicelines (endLines) render speaker-prefixed after the main dialogue', () => {
    const data = buildFixtureData();
    data.textlines.EndLineDemo = {
        owner: 'NPC_Orpheus_01',
        section: 'InteractTextLineSets',
        sourceFile: 'X.lua',
        sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_Orpheus_01', text: 'A main line.' }],
        endLines: [
            // Resolved-from-comment: subtitle text plus the cue id for provenance.
            { speaker: 'CharProtag', cue: 'ZagreusHome_2389', text: 'The job\u2019s number one perk... no thanks.' },
            // Non-subtitled audio cue (no text) -> muted cue chip.
            { speaker: 'NPC_Cerberus_01', cue: 'CerberusWhineSad' },
        ],
        requirements: {},
        otherRequirements: {},
    };
    loadData(data);
    renderInfo('EndLineDemo');
    // A distinct "Closing voicelines" sub-section after the main dialogue.
    assert.match(lastHtml, /<div class="end-lines"><div class="end-lines-label"[^>]*>Closing voicelines<\/div>/);
    // A resolved line shows its subtitle text, speaker-prefixed (like the main lines).
    assert.match(lastHtml, /<div class="dialogue-line end-line">.*The job\u2019s number one perk\.\.\. no thanks\.<\/div>/);
    // No cue-id glyph / provenance marker is shown for resolved lines.
    assert.doesNotMatch(lastHtml, /ZagreusHome_2389/);
    // A non-subtitled audio cue shows the trimmed cue id as a muted chip.
    assert.match(lastHtml, /<code class="end-line-cue"[^>]*>CerberusWhineSad<\/code>/);
});


test('conditional closing voicelines group under an "only when" note', () => {
    const data = buildFixtureData();
    data.reqTypeLabels = {
        ...data.reqTypeLabels,
        RequiredTextLines: 'Must have played (ALL)',
        RequiredFalseTextLines: 'Must NOT have played',
    };
    data.textlines.SeenGate01 = {
        owner: 'NPC_X_01', section: 'InteractTextLineSets', sourceFile: 'X.lua', sourceLine: 1,
        dialogueLines: [{ speaker: 'NPC_X_01', text: 'A gating line.' }],
        requirements: {}, otherRequirements: {},
    };
    data.textlines.CondEndDemo = {
        owner: 'NPC_X_01', section: 'InteractTextLineSets', sourceFile: 'X.lua', sourceLine: 2,
        dialogueLines: [{ speaker: 'NPC_X_01', text: 'Main.' }],
        endLines: [
            // Two mutually-exclusive codas, each its own condGroup, gated on
            // whether SeenGate01 has played (the Homer / Inspect_G_Intro_01 shape).
            { speaker: 'PlayerUnit', text: 'Seen it.', condGroup: 0, requirements: { RequiredTextLines: ['SeenGate01'] } },
            { speaker: 'PlayerUnit', text: 'Not seen.', condGroup: 1, requirements: { RequiredFalseTextLines: ['SeenGate01'] } },
        ],
        requirements: {}, otherRequirements: {},
    };
    loadData(data);
    renderInfo('CondEndDemo');
    // Two conditional groups -> two "Only when" notes, each in its own wrapper.
    assert.equal((lastHtml.match(/end-line-cond-note/g) || []).length, 2);
    assert.equal((lastHtml.match(/class="end-line-group"/g) || []).length, 2);
    assert.match(lastHtml, /Only when/);
    // The gating textline is referenced (navigable) inside the note.
    assert.match(lastHtml, /class="choice-link"[^>]*>SeenGate01</);
    // Both coda subtitles still render as end lines.
    assert.match(lastHtml, /<div class="dialogue-line end-line">.*Seen it\./);
    assert.match(lastHtml, /<div class="dialogue-line end-line">.*Not seen\./);
});


test('bare-key {Count} objects collapse to just the count', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    assert.match(lastHtml, /<span class="req-type-name"[^>]*>Min runs since played \(ANY\)<\/span>: <code>8<\/code>/);
});


test('bare-key {Count, Name} object with Count 1 drops the redundant ">= 1"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // Count 1 ("at least one") is implied by the "min ..." label -> name only.
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Required min active meta upgrade level<\/span>: <code>BossDifficultyShrineUpgrade<\/code>/
    );
    assert.doesNotMatch(lastHtml, /BossDifficultyShrineUpgrade<\/code> &gt;= <code>1<\/code>/);
});


test('bare-key {Name, Min} / {Name, Max} objects render as "Name >= Min" / "Name <= Max"', () => {
    loadData(fixtureWithSimplifiedOtherReqs());
    renderInfo('SimplifiedOtherReqDemo');
    // ObjectivesCompleted { Name: "PlayerKills", Min: 8 } -> "PlayerKills >= 8".
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Minimum objective completions<\/span>: <code>PlayerKills<\/code> &gt;= <code>8<\/code>/
    );
    // A Max threshold flips the operator to <=.
    assert.match(
        lastHtml,
        /<span class="req-type-name"[^>]*>Objective max demo<\/span>: <code>Deaths<\/code> &lt;= <code>3<\/code>/
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
    // CurrentEmployeeOfTheMonth is a curated GameState value field, so it reads
    // as a friendly clause ("Employee of the Month is ...") - never with ">=".
    assert.match(lastHtml, /Employee of the Month is <code[^>]*>Dusa<\/code>/);
    assert.match(lastHtml, /Employee of the Month is not <code[^>]*>Achilles<\/code>/);
    // An uncurated GameState value field keeps the generic label but must still
    // use the correct = / != operator (rendering either with >= states the
    // opposite of the equality / negation check).
    const eq = renderOtherReqEntryHtml('RequiredValues', { SomeUncuratedField: 'X' });
    assert.match(eq, /<code>SomeUncuratedField<\/code> = <code>X<\/code>/);
    assert.doesNotMatch(eq, /&gt;=/);
    const neq = renderOtherReqEntryHtml('RequiredFalseValues', { SomeUncuratedField: 'X' });
    assert.match(neq, /<code>SomeUncuratedField<\/code> &ne; <code>X<\/code>/);
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
                {
                    HasAny: '<ref:GameData.AllWeaponAspects>',
                    Path: ['GameState', 'AspectsUnlocked']
                },
            ],
            // IsAny operand list that contains ref strings -> each
            // element strips ``<ref:>`` to the bare identifier.
            'Path:GameState.SelectedAspect': [
                {
                    IsAny: ['<ref:GameData.WeaponAspectA>', 'PlainString'],
                    Path: ['GameState', 'SelectedAspect']
                },
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


test('unlabelled bare-key map values render with the raw key as the label; min-of-1 drops ">= 1"', () => {
    loadData(fixtureForBareKeyAndRefRefinements());
    renderInfo('UnlabelledOtherReqDemo');
    assert.match(
        lastHtml,
        /<span class="req-type-name">RequiredResourcesMin<\/span>: <code>GiftPoints<\/code> \u2022 <code>SuperGiftPoints<\/code>/
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
        /<code class="other-req-path">GameState\.WeaponsUnlocked<\/code> has any of: <code class="other-req-path">GameData\.AllWeaponAspects<\/code>/
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
        /<div class="named-req-expand"><h5 class="named-req-header"><span class="toggle">.<\/span><span class="req-header-text"><code class="named-req-name">HecateMissing<\/code> <span class="named-req-suffix">\(must NOT pass\)<\/span><\/span><\/h5><div class="named-req-children expanded">/
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
        /<div class="named-req-label"><span class="req-header-text"><span class="req-type-name"[^>]*>Named requirements must NOT pass<\/span>/g
    ) || [];
    // Exactly 2 today: 1 for the host, 1 for the nested expansion in
    // ScyllaBalladForced. The host always has 1; the nested count is
    // an artefact of this fixture using ScyllaBalladForced.
    assert.equal(labels.length, 2);
});

test('renderStatusLegendHtml gives every dot-key entry a hover tooltip', () => {
    const html = renderStatusLegendHtml();
    // 3 shape entries + 4 colour entries, each a .status-legend-item carrying a
    // non-empty data-tooltip the floating tooltip layer will surface on hover.
    const items = html.match(/<span class="status-legend-item" data-tooltip="[^"]+"/g) || [];
    assert.equal(items.length, 7);
    // Shape entries explain the node KIND.
    assert.match(html, /atomic condition/);
    assert.match(html, /AND \(all of\) or OR \(any of\)/);
    assert.match(html, /inverted gate/i);
    // Colour entries reuse the canonical verdict wording (groupStatusTooltip).
    assert.match(html, /Satisfied by your save/);
    assert.match(html, /Not satisfied by your save/);
    assert.match(html, /Permanently locked/);
});
