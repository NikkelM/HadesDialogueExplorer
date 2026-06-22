// Tests for pure helpers in ``templates/viewer/utilities.js``.
//
// Focus is on the HTML render helpers and label formatters that turn
// dataset entries into the strings displayed throughout the viewer.
// These functions are pure (no DOM, no fetch) so they run unmodified
// under ``node --test``; the fixture in ``./fixtures.js`` populates
// the module-level lets they read from.

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    escapeHtml,
    jsAttr,
    displayName,
    renderSpeakerHtml,
    getEdgeClass,
    reqTypeOrderIndex,
    getEdgeLabel,
    formatReqType,
    reqTypeTitleText,
    renderReqTypeHtml,
    renderTierBadgeHtml,
    renderSetLevelBadgeHtml,
    renderOrdinalBadgeHtml,
    renderPriorityBadgeHtml,
    renderPrimaryPriorityBadgeHtml,
    renderPlayOnceBadgeHtml,
} from '../templates/viewer/utilities.js';
import { loadData, setActiveGame } from '../templates/viewer/data.js';
import { loadFixtureData, buildFixtureData } from './fixtures.js';

before(() => {
    loadFixtureData();
});

test('escapeHtml escapes the four metacharacters and leaves text alone', () => {
    assert.equal(escapeHtml('plain text'), 'plain text');
    assert.equal(escapeHtml('A & B'), 'A &amp; B');
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('he said "hi"'), 'he said &quot;hi&quot;');
    // & must be escaped first so already-escaped entities don't double-encode.
    assert.equal(escapeHtml('<a&b>'), '&lt;a&amp;b&gt;');
});

test('escapeHtml coerces non-strings via String()', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
});

test('jsAttr produces a JSON literal that is also safe inside double-quoted attrs', () => {
    // Outer quotes from JSON.stringify, inner " escaped to &quot;.
    assert.equal(jsAttr('hello'), '&quot;hello&quot;');
    // A name containing a double-quote: JSON.stringify escapes the
    // inner " as \" and escapeHtml turns both quotes into &quot;.
    assert.equal(jsAttr('he"llo'), '&quot;he\\&quot;llo&quot;');
});

test('displayName uses the friendly speaker label, falling back to the id', () => {
    assert.equal(displayName('NPC_Zeus_01'), 'Zeus');
    assert.equal(displayName('NPC_Unknown_01'), 'NPC_Unknown_01');
});

test('renderSpeakerHtml: friendly + description -> "Friendly (id)\\nDescription" tooltip', () => {
    // Zeus has both a friendly label and a description quip in the fixture.
    assert.equal(
        renderSpeakerHtml('NPC_Zeus_01'),
        '<span class="speaker-name clickable" data-tooltip="Zeus (NPC_Zeus_01)\nKing of the Olympians" onclick="event.stopPropagation(); navigateToSpeaker(&quot;NPC_Zeus_01&quot;)">Zeus</span>',
    );
});

test('renderSpeakerHtml: friendly without description -> "Friendly (id)" tooltip', () => {
    // Achilles has a friendly label but no description in the fixture.
    assert.equal(
        renderSpeakerHtml('NPC_Achilles_01'),
        '<span class="speaker-name clickable" data-tooltip="Achilles (NPC_Achilles_01)" onclick="event.stopPropagation(); navigateToSpeaker(&quot;NPC_Achilles_01&quot;)">Achilles</span>',
    );
});

test('renderSpeakerHtml: no friendly, no description -> bare span with click handler (no tooltip)', () => {
    assert.equal(
        renderSpeakerHtml('NPC_Unknown_01'),
        '<span class="speaker-name clickable" onclick="event.stopPropagation(); navigateToSpeaker(&quot;NPC_Unknown_01&quot;)">NPC_Unknown_01</span>',
    );
});

test('renderSpeakerHtml: description without friendly label -> description-only tooltip (id already visible)', () => {
    // Synthetic scenario: an id known to the speaker map but only by
    // its description. Reload the data layer with a minimal override
    // so the rest of the suite keeps the shared fixture state.
    loadData({
        ...buildFixtureData(),
        speakers: { Zagreus: { description: 'Prince of the Underworld' } },
    });
    assert.equal(
        renderSpeakerHtml('Zagreus'),
        '<span class="speaker-name clickable" data-tooltip="Prince of the Underworld" onclick="event.stopPropagation(); navigateToSpeaker(&quot;Zagreus&quot;)">Zagreus</span>',
    );
    // Restore the shared fixture so subsequent tests aren't affected.
    loadFixtureData();
});

test('renderSpeakerHtml: clickable:false -> plain span, no clickable class or navigation', () => {
    // Search results render owner/snippet speaker names non-clickable so
    // clicking them falls through to the row's open-dialogue handler
    // rather than diverting to the speaker overview. The tooltip is kept.
    assert.equal(
        renderSpeakerHtml('NPC_Zeus_01', { clickable: false }),
        '<span class="speaker-name" data-tooltip="Zeus (NPC_Zeus_01)\nKing of the Olympians">Zeus</span>',
    );
});

test('renderSpeakerHtml: tooltip parts are HTML-escaped', () => {
    loadData({
        ...buildFixtureData(),
        speakers: { 'NPC_<X>_01': { name: 'X&Y', description: 'God of "Quotes"' } },
    });
    assert.equal(
        renderSpeakerHtml('NPC_<X>_01'),
        '<span class="speaker-name clickable" data-tooltip="X&amp;Y (NPC_&lt;X&gt;_01)\nGod of &quot;Quotes&quot;" onclick="event.stopPropagation(); navigateToSpeaker(&quot;NPC_&lt;X&gt;_01&quot;)">X&amp;Y</span>',
    );
    loadFixtureData();
});

test('getEdgeClass routes False > Any > default to the right CSS class', () => {
    assert.equal(getEdgeClass('RequiredFalseTextLines'), 'edge-false');
    assert.equal(getEdgeClass('RequiredFalseAnyTextLines'), 'edge-false');
    assert.equal(getEdgeClass('RequiredAnyTextLines'), 'edge-any');
    assert.equal(getEdgeClass('RequiredTextLines'), 'edge-all');
});

test('reqTypeOrderIndex returns the canonical order index, with a sentinel for unknown types', () => {
    assert.equal(reqTypeOrderIndex('RequiredTextLines'), 0);
    assert.equal(reqTypeOrderIndex('RequiredAnyTextLines'), 1);
    assert.equal(reqTypeOrderIndex('RequiredFalseTextLines'), 2);
    assert.equal(reqTypeOrderIndex('SomeUnmappedType'), 999);
});

test('getEdgeLabel and formatReqType fall back to the type name when no mapping exists', () => {
    assert.equal(getEdgeLabel('RequiredAnyTextLines'), 'ANY');
    assert.equal(getEdgeLabel('SomeUnmappedType'), 'ALL');
    assert.equal(formatReqType('RequiredTextLines'), 'Required (ALL)');
    assert.equal(formatReqType('SomeUnmappedType'), 'SomeUnmappedType');
});

test('reqTypeTitleText prefixes the internal name and appends the tooltip blurb on a blank line', () => {
    const text = reqTypeTitleText('RequiredTextLines');
    assert.equal(
        text,
        'Internal name: RequiredTextLines\n\n'
        + 'This dialogue is only eligible if EVERY listed textline has been played at some point in a save.',
    );
});

test('reqTypeTitleText falls back to header-only when no blurb is registered', () => {
    assert.equal(
        reqTypeTitleText('RequiredAnyTextLines'),
        'Internal name: RequiredAnyTextLines',
    );
});

test('reqTypeTitleText returns null when no friendly label exists (rendered span would already be the internal name)', () => {
    assert.equal(reqTypeTitleText('SomeUnmappedType'), null);
});

test('renderReqTypeHtml wraps the friendly label and embeds the prefixed tooltip', () => {
    const html = renderReqTypeHtml('RequiredTextLines');
    assert.ok(html.startsWith('<span class="req-type-name"'));
    assert.ok(html.includes('data-tooltip="Internal name: RequiredTextLines'));
    assert.ok(html.includes('>Required (ALL)<'));
});

test('renderReqTypeHtml falls back to the internal name with no tooltip when no friendly label exists', () => {
    assert.equal(
        renderReqTypeHtml('SomeUnmappedType'),
        '<span class="req-type-name">SomeUnmappedType</span>',
    );
});

test('renderReqTypeHtml applies an extra CSS class when one is passed', () => {
    const html = renderReqTypeHtml('RequiredTextLines', 'unresolved-cat');
    assert.ok(html.includes('class="req-type-name unresolved-cat"'));
});

test('formatReqType returns the dependents-perspective label when direction is downstream', () => {
    assert.equal(
        formatReqType('RequiredTextLines', 'downstream'),
        'Required as prerequisite (in ALL group)',
    );
    // Upstream remains the default - explicit 'upstream' matches no
    // direction arg.
    assert.equal(
        formatReqType('RequiredTextLines', 'upstream'),
        'Required (ALL)',
    );
});

test('formatReqType downstream falls back to the upstream label when no dependents entry exists', () => {
    // RequiredFalseTextLines is in reqTypeLabels but NOT in
    // reqTypeLabelsDependents - downstream must degrade gracefully
    // through the upstream map before degrading to the raw field
    // name.
    assert.equal(
        formatReqType('RequiredFalseTextLines', 'downstream'),
        'Not played (NONE)',
    );
    // Unknown type degrades all the way through to the raw field
    // name in both directions.
    assert.equal(
        formatReqType('SomeUnmappedType', 'downstream'),
        'SomeUnmappedType',
    );
});

test('reqTypeTitleText returns the dependents-perspective blurb when direction is downstream', () => {
    const text = reqTypeTitleText('RequiredTextLines', 'downstream');
    assert.equal(
        text,
        'Internal name: RequiredTextLines\n\n'
        + 'Each dependent below has this textline in its ALL group: every listed textline must have been played for the dependent to be eligible.',
    );
});

test('reqTypeTitleText downstream falls back to header-only when no dependents blurb exists', () => {
    // RequiredAnyTextLines has a dependents label but no dependents
    // tooltip - the header line should appear without an appended
    // blurb (matching the upstream header-only branch behaviour).
    assert.equal(
        reqTypeTitleText('RequiredAnyTextLines', 'downstream'),
        'Internal name: RequiredAnyTextLines',
    );
});

test('reqTypeTitleText downstream falls back to the upstream blurb when no dependents wording exists', () => {
    // RequiredFalseTextLines: no dependents label OR tooltip, but
    // upstream label exists. Fallback chain hands the call off to
    // the upstream maps so the tooltip still renders the upstream
    // wording rather than degrading to header-only or null.
    assert.equal(
        reqTypeTitleText('RequiredFalseTextLines', 'downstream'),
        'Internal name: RequiredFalseTextLines',
    );
});

test('renderReqTypeHtml downstream embeds the dependents-perspective label and tooltip', () => {
    const html = renderReqTypeHtml('RequiredTextLines', null, 'downstream');
    assert.ok(html.startsWith('<span class="req-type-name"'));
    assert.ok(html.includes('data-tooltip="Internal name: RequiredTextLines'));
    assert.ok(html.includes('Each dependent below has this textline in its ALL group'));
    assert.ok(html.includes('>Required as prerequisite (in ALL group)<'));
});

test('renderReqTypeHtml downstream falls back to upstream wording for fields missing from the dependents map', () => {
    const html = renderReqTypeHtml('RequiredFalseTextLines', null, 'downstream');
    assert.ok(html.includes('>Not played (NONE)<'));
});

test('renderTierBadgeHtml emits the correct icon and class for each section tier', () => {
    const superHtml = renderTierBadgeHtml({ narrativePrioritySectionTier: 'super' });
    assert.ok(superHtml.includes('priority-super'));
    assert.ok(superHtml.includes('Super-priority'));
    assert.ok(superHtml.includes('\u2605\u2605'));

    const priorityHtml = renderTierBadgeHtml({ narrativePrioritySectionTier: 'priority' });
    assert.ok(priorityHtml.includes('priority-priority'));
    assert.ok(priorityHtml.includes('\u2605'));

    const lowHtml = renderTierBadgeHtml({ narrativePrioritySectionTier: 'low' });
    assert.ok(lowHtml.includes('priority-low'));

    const normalHtml = renderTierBadgeHtml({ narrativePrioritySectionTier: 'normal' });
    assert.ok(normalHtml.includes('priority-normal'));

    // Unknown / missing tier collapses to normal so every row has a badge.
    const missingHtml = renderTierBadgeHtml({});
    assert.ok(missingHtml.includes('priority-normal'));
});

test('renderSetLevelBadgeHtml emits SP / P / empty for the three input states', () => {
    assert.ok(renderSetLevelBadgeHtml({ narrativePrioritySetLevel: 'super' }).includes('>SP<'));
    assert.ok(renderSetLevelBadgeHtml({ narrativePrioritySetLevel: 'priority' }).includes('>P<'));
    assert.equal(renderSetLevelBadgeHtml({ narrativePrioritySetLevel: null }), '');
    assert.equal(renderSetLevelBadgeHtml({}), '');
});

test('renderOrdinalBadgeHtml renders #N/M for H2 textlines and is empty without ordinal', () => {
    const full = renderOrdinalBadgeHtml({
        narrativePriorityOrdinal: 3,
        narrativePrioritySectionSize: 12,
        section: 'InteractTextLineSets',
        narrativePriorityClusterMembers: ['SiblingA', 'SiblingB'],
    });
    assert.ok(full.includes('priority-ordinal'));
    assert.ok(full.includes('#3/12'));
    // The tooltip names the dialogue type so the rank reads as scoped to
    // this owner AND this section, not the owner's entire output.
    assert.ok(full.includes("among this owner's Interact dialogues"));
    // Cluster members should surface inside the tooltip so the tree
    // row stays compact. User-controlled wording uses a newline-
    // separated list so each member reads on its own line.
    assert.ok(full.includes('Tied at the same rank with:'));
    assert.ok(full.includes('SiblingA'));
    assert.ok(full.includes('SiblingB'));

    const solo = renderOrdinalBadgeHtml({
        narrativePriorityOrdinal: 1,
        narrativePrioritySectionSize: 5,
        narrativePriorityClusterMembers: [],
    });
    assert.ok(solo.includes('#1/5'));
    // Solo entries (no cluster) omit the "Tied at the same rank" hint.
    assert.ok(!solo.includes('Tied at the same rank'));

    // Section size is optional: falls back to bare ordinal.
    const noSize = renderOrdinalBadgeHtml({ narrativePriorityOrdinal: 4 });
    assert.ok(noSize.includes('>#4<'));
    assert.ok(!noSize.includes('#4/'));

    // Missing or invalid ordinal -> empty (H1 textline, or H2 textline
    // not listed in NarrativeData).
    assert.equal(renderOrdinalBadgeHtml({}), '');
    assert.equal(renderOrdinalBadgeHtml(null), '');
    assert.equal(renderOrdinalBadgeHtml({ narrativePriorityOrdinal: 0 }), '');
    assert.equal(renderOrdinalBadgeHtml({ narrativePriorityOrdinal: '2' }), '');
});

test('renderPriorityBadgeHtml dispatches between H1 tier+setlevel and H2 ordinal by active game', () => {
    // Default fixture is single-game (hades1) - dispatch returns the
    // H1 tier + set-level pair, ignoring any ordinal fields that
    // happen to be present.
    const h1Html = renderPriorityBadgeHtml({
        narrativePrioritySectionTier: 'priority',
        narrativePrioritySetLevel: 'super',
        narrativePriorityOrdinal: 7,
        narrativePrioritySectionSize: 9,
    });
    assert.ok(h1Html.includes('priority-priority'));
    assert.ok(h1Html.includes('>SP<'));
    assert.ok(!h1Html.includes('priority-ordinal'));

    // Multi-game fixture: load both games, activate H2, verify
    // dispatch flips to the ordinal badge.
    const h1 = buildFixtureData();
    const h2 = buildFixtureData();
    loadData({
        games: { hades1: h1, hades2: h2 },
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades I', hades2: 'Hades II' },
    });
    setActiveGame('hades2');
    const h2Html = renderPriorityBadgeHtml({
        narrativePrioritySectionTier: 'priority',
        narrativePrioritySetLevel: 'super',
        narrativePriorityOrdinal: 7,
        narrativePrioritySectionSize: 9,
        narrativePriorityClusterMembers: [],
    });
    assert.ok(h2Html.includes('priority-ordinal'));
    assert.ok(h2Html.includes('#7/9'));
    // H1 tier + set-level pair must NOT leak into the H2 dispatch.
    assert.ok(!h2Html.includes('priority-priority'));
    assert.ok(!h2Html.includes('>SP<'));

    // H2 textline with no ordinal renders nothing (not every H2
    // textline is listed in NarrativeData).
    assert.equal(renderPriorityBadgeHtml({}), '');

    // Restore the shared fixture for downstream tests.
    loadFixtureData();
});

test('renderPrimaryPriorityBadgeHtml returns one badge per row, omitting the SP/P pill', () => {
    // Default fixture (hades1) - returns the tier badge only; the
    // set-level pill is reserved for the wider info-panel header.
    const h1Html = renderPrimaryPriorityBadgeHtml({
        narrativePrioritySectionTier: 'priority',
        narrativePrioritySetLevel: 'super',
    });
    assert.ok(h1Html.includes('priority-priority'));
    assert.ok(!h1Html.includes('>SP<'));
    assert.ok(!h1Html.includes('set-priority-super'));

    // Activate H2 and verify the dispatch flips to the ordinal badge.
    const h1 = buildFixtureData();
    const h2 = buildFixtureData();
    loadData({
        games: { hades1: h1, hades2: h2 },
        defaultGame: 'hades1',
        gameLabels: { hades1: 'Hades I', hades2: 'Hades II' },
    });
    setActiveGame('hades2');
    const h2Html = renderPrimaryPriorityBadgeHtml({
        narrativePriorityOrdinal: 2,
        narrativePrioritySectionSize: 6,
        narrativePriorityClusterMembers: [],
    });
    assert.ok(h2Html.includes('priority-ordinal'));
    assert.ok(h2Html.includes('#2/6'));

    // Null textline (e.g. unresolved ref) renders nothing.
    assert.equal(renderPrimaryPriorityBadgeHtml(null), '');

    loadFixtureData();
});

test('renderPlayOnceBadgeHtml distinguishes locked vs repeatable variants', () => {
    const locked = renderPlayOnceBadgeHtml({ playOnce: true });
    assert.ok(locked.includes('play-once-locked'));
    assert.ok(locked.includes('Play-once'));

    const repeatable = renderPlayOnceBadgeHtml({ playOnce: false });
    assert.ok(repeatable.includes('play-once-repeatable'));
    assert.ok(repeatable.includes('Repeatable'));

    // Missing flag treated as repeatable (the safe default - never tag
    // a dialogue as one-shot without explicit evidence).
    const missing = renderPlayOnceBadgeHtml({});
    assert.ok(missing.includes('play-once-repeatable'));
});

test('reqTypeOrderIndex reflects fixture reloads in place', () => {
    // Reassign the lets via a fresh DATA blob: existing imports must
    // still see the updated order because of ES module live bindings.
    loadData({
        ...buildFixtureData(),
        reqTypeOrder: ['RequiredFalseTextLines', 'RequiredTextLines'],
    });
    assert.equal(reqTypeOrderIndex('RequiredFalseTextLines'), 0);
    assert.equal(reqTypeOrderIndex('RequiredTextLines'), 1);
    // Reset for other tests.
    loadFixtureData();
});
