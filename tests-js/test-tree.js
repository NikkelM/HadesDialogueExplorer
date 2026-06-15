// Tests for ``templates/viewer/tree.js`` ``getChildren``.
//
// Pins the OR-branch dependent-edge tag propagation: when a textline
// is referenced via an OR option group on another textline, the
// downstream-direction ``getChildren`` MUST surface the ``orBranchIndex``
// / ``orBranchTotal`` tags so the renderer can route the dependent
// into the ``.or-downstream-section`` instead of mixing it with the
// AND base block (which would falsely imply a hard requirement).

import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';

import { getChildren } from '../templates/viewer/tree.js';
import { loadData } from '../templates/viewer/data.js';

// Minimal fixture: TextlineA has two dependents pointing back at it.
// ``Dep_Hard`` references it via a base AND requirement (no OR tag);
// ``Dep_Soft`` references it via OR option 2 of 3 in its own OR group.
// The downstream getChildren of TextlineA should return both, with
// only ``Dep_Soft`` carrying the OR tags.
function fixtureWithOrDeps() {
    return {
        textlines: {
            TextlineA: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                dialogueLines: [],
                requirements: {},
                otherRequirements: {},
            },
            Dep_Hard: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                dialogueLines: [],
                requirements: { RequiredTextLines: ['TextlineA'] },
                otherRequirements: {},
            },
            Dep_Soft: {
                owner: 'NPC_X_01',
                section: 'InteractTextLineSets',
                dialogueLines: [],
                requirements: {},
                otherRequirements: {},
                orBranches: [
                    { requirements: {} },
                    { requirements: { RequiredTextLines: ['TextlineA'] } },
                    { requirements: {} },
                ],
            },
        },
        // Mirrors the shape graph.py emits: per-Host entries on the
        // depended-on textline, OR-routed ones tagged with the
        // 1-based branch index + total branch count.
        dependents: {
            TextlineA: [
                { name: 'Dep_Hard', type: 'RequiredTextLines' },
                { name: 'Dep_Soft', type: 'RequiredTextLines', orBranchIndex: 2, orBranchTotal: 3 },
            ],
        },
        stats: { totalTextlines: 3, totalEdges: 2, unresolvedRefs: [] },
        speakers: { NPC_X_01: { name: 'X' } },
        knownUnresolvedRefs: {},
        unresolvedCategoryLabels: {},
        unresolvedCategoryDescriptions: {},
        unresolvedRefBlocks: {},
        reqTypeLabels: { RequiredTextLines: 'Required (ALL)' },
        reqTypeEdgeLabels: { RequiredTextLines: 'ALL' },
        reqTypeTooltips: {},
        reqTypeOrder: ['RequiredTextLines'],
        sectionKeyLabels: { InteractTextLineSets: 'Interact' },
    };
}

before(() => {
    loadData(fixtureWithOrDeps());
});

test('getChildren downstream preserves orBranchIndex / orBranchTotal on OR-routed dep edges', () => {
    const kids = getChildren('TextlineA', 'downstream');
    assert.equal(kids.length, 2);

    const hard = kids.find(k => k.name === 'Dep_Hard');
    assert.ok(hard, 'expected Dep_Hard to be returned');
    assert.equal(hard.orBranchIndex, null, 'AND-routed dep must not carry an OR index');
    assert.equal(hard.orBranchTotal, null, 'AND-routed dep must not carry an OR total');

    const soft = kids.find(k => k.name === 'Dep_Soft');
    assert.ok(soft, 'expected Dep_Soft to be returned');
    assert.equal(soft.orBranchIndex, 2, 'OR-routed dep must surface its 1-based branch index');
    assert.equal(soft.orBranchTotal, 3, 'OR-routed dep must surface its parent branch total');
});

test('getChildren downstream still emits OR-routed deps even when no base AND dep exists', () => {
    // Drop Dep_Hard so only the OR-routed dep is left. Verifies the
    // partition logic in the renderer cannot accidentally swallow
    // OR-only dependents.
    const fixture = fixtureWithOrDeps();
    fixture.dependents.TextlineA = [
        { name: 'Dep_Soft', type: 'RequiredTextLines', orBranchIndex: 2, orBranchTotal: 3 },
    ];
    loadData(fixture);
    const kids = getChildren('TextlineA', 'downstream');
    assert.equal(kids.length, 1);
    assert.equal(kids[0].name, 'Dep_Soft');
    assert.equal(kids[0].orBranchIndex, 2);
    assert.equal(kids[0].orBranchTotal, 3);
});
