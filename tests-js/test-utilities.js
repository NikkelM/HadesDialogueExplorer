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
    renderPlayOnceBadgeHtml,
} from '../templates/viewer/utilities.js';
import { loadData } from '../templates/viewer/data.js';
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

test('renderSpeakerHtml emits a title tooltip only when a friendly label exists', () => {
    assert.equal(
        renderSpeakerHtml('NPC_Zeus_01'),
        '<span class="speaker-name" title="NPC_Zeus_01">Zeus</span>',
    );
    assert.equal(
        renderSpeakerHtml('NPC_Unknown_01'),
        '<span class="speaker-name">NPC_Unknown_01</span>',
    );
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
    assert.ok(html.includes('title="Internal name: RequiredTextLines'));
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

test('renderTierBadgeHtml emits the correct icon and class for each section tier', () => {
    const superHtml = renderTierBadgeHtml({ narrativePrioritySectionTier: 'super' });
    assert.ok(superHtml.includes('priority-super'));
    assert.ok(superHtml.includes('super-priority'));
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

test('renderPlayOnceBadgeHtml distinguishes locked vs repeatable variants', () => {
    const locked = renderPlayOnceBadgeHtml({ playOnce: true });
    assert.ok(locked.includes('play-once-locked'));
    assert.ok(locked.includes('PlayOnce'));

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
