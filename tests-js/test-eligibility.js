// Tests for the eligibility tracer's prerequisite grouping
// (``buildPrereqChain`` / ``summarizePrereqs`` in eligibility-view.js).
//
// OR (RequiredAny*) and count-min (RequiredMinAnyTextLines) requirements are
// collapsed into one "play any N of these" group rather than surfaced as N
// separate mandatory prerequisites. ``buildPrereqChain`` takes an injectable
// ``isPlayed`` predicate so the walk is testable without a loaded save.

import { test, before, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { loadData } from '../templates/viewer/data.js';
import { buildPrereqChain, summarizePrereqs, renderOrBranchesHtml, renderTreeHtml, clusterAlternatesHtml } from '../templates/viewer/eligibility-view.js';
import { isUnobtainable, unobtainableReasons } from '../templates/viewer/unobtainable.js';

function tl(requirements, otherRequirements) {
    return { owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements, otherRequirements };
}

before(() => {
    loadData({
        textlines: {
            Root: tl(
                {
                    RequiredTextLines: ['And1'],
                    RequiredAnyTextLines: ['Or1', 'Or2'],
                    RequiredMinAnyTextLines: ['C1', 'C2', 'C3', 'C4', 'C5'],
                },
                { RequiredMinAnyTextLines: { Count: 3 } },
            ),
            And1: tl({ RequiredTextLines: ['And2'] }),
            And2: tl({}),
            Or1: tl({}), Or2: tl({}),
            // C1 has its own prerequisites (an AND dep and a nested OR group)
            // so we can assert group options are walked and nested groups
            // stay conditional.
            C1: tl({ RequiredTextLines: ['C1dep'], RequiredAnyTextLines: ['Or3', 'Or4'] }),
            C1dep: tl({}), Or3: tl({}), Or4: tl({}),
            C2: tl({}), C3: tl({}), C4: tl({}), C5: tl({}),
        },
        speakers: { NPC_Test_01: { name: 'Tester' } },
    });
});

const playedSet = (...names) => {
    const s = new Set(names);
    return (n) => s.has(n);
};

test('OR and count-min requirements become groups; AND stays individual', () => {
    const { chain, groups, mandatory } = buildPrereqChain('Root', playedSet());

    // Two top-level groups on Root (plus a nested one under C1).
    const or = groups.get('Root::RequiredAnyTextLines');
    assert.equal(or.kind, 'any');
    assert.equal(or.quota, 1);
    assert.deepEqual(or.options, ['Or1', 'Or2']);

    const count = groups.get('Root::RequiredMinAnyTextLines');
    assert.equal(count.kind, 'count-min');
    assert.equal(count.quota, 3);
    assert.equal(count.size, 5);

    // AND prerequisites recurse and are individual chain entries.
    assert.ok(chain.has('And1'));
    assert.ok(chain.has('And2'));
    // Group options carry their groupId on the parent edge.
    assert.equal(chain.get('Or1').parents[0].groupId, 'Root::RequiredAnyTextLines');
    assert.equal(chain.get('C1').parents[0].groupId, 'Root::RequiredMinAnyTextLines');

    // Mandatory = reachable from root via non-group (AND) edges only;
    // group options are not mandatory individually.
    assert.ok(mandatory.has('And1') && mandatory.has('And2'));
    assert.equal(mandatory.has('Or1'), false);
    assert.equal(mandatory.has('C1'), false);
});

test('a satisfied OR (one option played) records no group', () => {
    const { groups, chain } = buildPrereqChain('Root', playedSet('Or1'));
    assert.equal(groups.has('Root::RequiredAnyTextLines'), false);
    assert.equal(chain.has('Or2'), false);
    // count-min is still unsatisfied, so its group remains.
    assert.ok(groups.has('Root::RequiredMinAnyTextLines'));
});

test('a satisfied count-min (quota met) records no group', () => {
    const { groups } = buildPrereqChain('Root', playedSet('C1', 'C2', 'C3'));
    assert.equal(groups.has('Root::RequiredMinAnyTextLines'), false);
});

test('count-min adds only the unplayed options to the chain', () => {
    const { chain } = buildPrereqChain('Root', playedSet('C1', 'C2'));
    assert.equal(chain.has('C1'), false);
    assert.equal(chain.has('C2'), false);
    assert.ok(chain.has('C3') && chain.has('C4') && chain.has('C5'));
});

test("group options are walked so their own prerequisites are reachable", () => {
    // C1's AND prerequisite is in the chain (so the tree can expand it) but
    // is NOT mandatory (only reachable through the count-min group).
    const { chain, mandatory } = buildPrereqChain('Root', playedSet());
    assert.ok(chain.has('C1dep'));
    assert.equal(mandatory.has('C1dep'), false);
});

test('summarizePrereqs counts a group as its quota, not its size', () => {
    const isPlayed = playedSet();
    const { chain, groups, mandatory } = buildPrereqChain('Root', isPlayed);
    // 2 mandatory AND nodes (And1, And2) + OR quota 1 + count-min quota 3 = 6.
    const { total, played, stillNeeded } = summarizePrereqs(chain, groups, mandatory, 'Root', isPlayed);
    assert.equal(total, 6);
    assert.equal(played, 0);
    assert.equal(stillNeeded, 6);
});

test('summarizePrereqs credits partially-satisfied groups', () => {
    const isPlayed = playedSet('C1', 'C2', 'And2');
    const { chain, groups, mandatory } = buildPrereqChain('Root', isPlayed);
    // count-min still recorded (2 < 3); 2 of its quota-3 are played.
    // Units: And1 (unplayed), And2 (played) + OR quota1 + count-min quota3 = 6.
    // Played units: And2 (1) + min(2,3) = 3.
    const { total, played, stillNeeded } = summarizePrereqs(chain, groups, mandatory, 'Root', isPlayed);
    assert.equal(total, 6);
    assert.equal(played, 3);
    assert.equal(stillNeeded, 3);
});

test('summarizePrereqs lists the completed prerequisite names', () => {
    const isPlayed = playedSet('C1', 'C2', 'And2');
    const { chain, groups, mandatory } = buildPrereqChain('Root', isPlayed);
    const { completed, played } = summarizePrereqs(chain, groups, mandatory, 'Root', isPlayed);
    // completed.length tracks the played count and names the done items:
    // the individual And2 plus two satisfied options of the count-min group.
    assert.equal(completed.length, played);
    assert.deepEqual([...completed].sort(), ['And2', 'C1', 'C2']);
});

test('summarizePrereqs reports no completed prerequisites for an empty save', () => {
    const isPlayed = playedSet();
    const { chain, groups, mandatory } = buildPrereqChain('Root', isPlayed);
    const { completed, played } = summarizePrereqs(chain, groups, mandatory, 'Root', isPlayed);
    assert.equal(played, 0);
    assert.deepEqual(completed, []);
});

test('summarizePrereqs flags indirect prerequisites and counts immediate ones', () => {
    // Root's only individual AND prerequisite (And1) has its own AND
    // prerequisite (And2), so the total exceeds the immediate count - the
    // exact "why N when there's one immediate requirement?" case.
    const { chain, groups, mandatory } = buildPrereqChain('Root', playedSet());
    const { directCount, hasIndirect, hasGroups } = summarizePrereqs(chain, groups, mandatory, 'Root', playedSet());
    assert.equal(hasIndirect, true);
    // Immediate requirements: And1 (individual) + the two depth-1 groups
    // (RequiredAnyTextLines, RequiredMinAnyTextLines) = 3.
    assert.equal(directCount, 3);
    // Root carries two requirement groups, so the total counts each once.
    assert.equal(hasGroups, true);
});

test('summarizePrereqs reports no indirect prerequisites for a flat one-level chain', () => {
    // And1's only prerequisite (And2) has none of its own, so the chain is
    // a single level: no indirect prerequisites, total == immediate count.
    const { chain, groups, mandatory } = buildPrereqChain('And1', playedSet());
    const { total, directCount, hasIndirect, hasGroups } = summarizePrereqs(chain, groups, mandatory, 'And1', playedSet());
    assert.equal(hasIndirect, false);
    assert.equal(hasGroups, false);
    assert.equal(directCount, 1);
    assert.equal(total, 1);
});

test('conditional groups nested under an option are not counted in the summary', () => {
    // C1dep gates C1's own OR group; that nested group must not inflate the
    // top-level summary (you only reach it if you pick C1).
    const isPlayed = playedSet();
    const { chain, groups, mandatory } = buildPrereqChain('Root', isPlayed);
    const nested = groups.get('C1::RequiredAnyTextLines');
    assert.ok(nested, 'nested group should still be recorded for the tree');
    // Inactive: its parent (C1) is a group option, not a mandatory node.
    assert.equal(nested.parentName === 'Root' || mandatory.has(nested.parentName), false);
    // Summary total is unchanged by the nested group.
    const { total } = summarizePrereqs(chain, groups, mandatory, 'Root', isPlayed);
    assert.equal(total, 6);
});


// --- H2 set-level orBranches in the tracer ---
// A dialogue gated entirely by orBranches has no flat-requirement chain, so
// the tracer renders a dedicated "alternative branches" section instead.

describe('renderOrBranchesHtml', () => {
    before(() => {
        const t = (requirements, otherRequirements, orBranches) => ({
            owner: 'NPC_Test_01', section: 'InteractTextLineSets',
            requirements, otherRequirements, orBranches,
        });
        loadData({
            textlines: {
                // Two alternative branches, each needing two lines together,
                // plus a non-textline-only branch that is trivially satisfied.
                BranchRoot: t({}, {}, [
                    { requirements: { RequiredTextLines: ['A1', 'A2'] } },
                    { requirements: { RequiredTextLines: ['B1', 'B2'] } },
                    { requirements: {}, otherRequirements: { 'PathTrue:GameState.X': {} } },
                ]),
                // A1 has its own prerequisite so its branch node is expandable.
                A1: t({ RequiredTextLines: ['A1dep'] }), A1dep: t({}),
                A2: t({}), B1: t({}), B2: t({}),
                NoBranches: t({ RequiredTextLines: ['A1'] }),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
    });

    test('returns empty string for a dialogue without orBranches', () => {
        assert.equal(renderOrBranchesHtml('NoBranches', new Set()), '');
    });

    test('lists every branch and its prerequisites as tree nodes', () => {
        const html = renderOrBranchesHtml('BranchRoot', new Set());
        assert.match(html, /Alternative requirement branches \(3\)/);
        assert.match(html, /Option 1 of 3/);
        assert.match(html, /Option 2 of 3/);
        for (const ref of ['A1', 'A2', 'B1', 'B2']) {
            assert.ok(html.includes(`>${ref}<`), `expected branch ref ${ref} as a tree node`);
        }
        // The non-textline-only branch (3) has no save-trackable lines but is
        // trivially satisfied.
        assert.match(html, /Option 3 of 3 \u00b7 satisfied/);
        assert.match(html, /No save-trackable prerequisites/);
    });

    test('a branch line with its own prerequisites is expandable (chevron + nested)', () => {
        const html = renderOrBranchesHtml('BranchRoot', new Set());
        // A1 has prereq A1dep, so its branch node is collapsible (chevron)
        // and nests A1dep underneath.
        assert.ok(html.includes('collapsible collapsed'), 'expected an expandable branch node');
        assert.ok(html.includes('\u25B6'), 'expected a chevron on the expandable node');
        assert.ok(html.includes('>A1dep<'), 'expected nested prerequisite A1dep');
    });

    test('marks played branch lines and a fully-played branch satisfied', () => {
        const html = renderOrBranchesHtml('BranchRoot', new Set(['A1', 'A2', 'A1dep']));
        assert.match(html, /Option 1 of 3 \u00b7 satisfied/);
        assert.ok(html.includes('tree-node tree-played'), 'played lines render with the played class');
        // Branch 2 stays unmet (neither of its lines played).
        assert.ok(!/Option 2 of 3 \u00b7 satisfied/.test(html), 'branch 2 must stay unmet');
    });
});


// --- Permanently-unobtainable detection ---
// Once the played set locks the player out (a choice taken differently, or a
// mutually-exclusive line played) a dialogue can never become eligible.

describe('isUnobtainable', () => {
    const tl = (requirements, extra = {}) => ({
        owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements, ...extra,
    });
    const choiceVariant = (parent, choiceText) => tl(
        { RequiredTextLines: [parent] },
        { isSynthetic: true, parentTextline: parent, choiceText },
    );

    before(() => {
        loadData({
            textlines: {
                // Choice dialogue P with two mutually-exclusive variants.
                P: tl({}),
                PChoice_A: choiceVariant('P', 'Choice_A'),
                PChoice_B: choiceVariant('P', 'Choice_B'),
                // Gated on the player having chosen A.
                NeedsChoiceA: tl({ RequiredAnyTextLines: ['PChoice_A'] }),
                // Transitively gated on NeedsChoiceA.
                NeedsChoiceAIndirect: tl({ RequiredTextLines: ['NeedsChoiceA'] }),
                // Mutually-exclusive _A / _B pair (explicit negative gates).
                VariantA: tl({ RequiredFalseTextLines: ['VariantB'] }),
                VariantB: tl({ RequiredFalseTextLines: ['VariantA'] }),
                // Plain blocked-but-obtainable dialogue.
                JustBlocked: tl({ RequiredTextLines: ['NeverPlayed'] }),
                NeverPlayed: tl({}),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
    });

    test('a required choice is unobtainable once a different choice was taken', () => {
        assert.equal(isUnobtainable('NeedsChoiceA', new Set(['P', 'PChoice_B'])), true);
        // The locked choice variant itself is unobtainable.
        assert.equal(isUnobtainable('PChoice_A', new Set(['P', 'PChoice_B'])), true);
    });

    test('the chosen path is obtainable (not locked)', () => {
        // Player chose A: NeedsChoiceA is satisfiable, not unobtainable.
        assert.equal(isUnobtainable('NeedsChoiceA', new Set(['P', 'PChoice_A'])), false);
        // No choice recorded yet: still obtainable.
        assert.equal(isUnobtainable('NeedsChoiceA', new Set(['P'])), false);
    });

    test('choice lock propagates transitively', () => {
        assert.equal(isUnobtainable('NeedsChoiceAIndirect', new Set(['P', 'PChoice_B'])), true);
    });

    test('a negative gate on an already-played line is permanently violated', () => {
        assert.equal(isUnobtainable('VariantA', new Set(['VariantB'])), true);
        // While the forbidden line is unplayed, the dialogue is still obtainable.
        assert.equal(isUnobtainable('VariantA', new Set()), false);
    });

    test('a normally-blocked dialogue is not unobtainable', () => {
        assert.equal(isUnobtainable('JustBlocked', new Set()), false);
    });

    test('a played dialogue is never unobtainable', () => {
        assert.equal(isUnobtainable('NeedsChoiceA', new Set(['NeedsChoiceA', 'PChoice_B'])), false);
    });

    test('reasons: a different choice taken is reported with the parent + choices', () => {
        const reasons = unobtainableReasons('NeedsChoiceA', new Set(['P', 'PChoice_B']));
        assert.deepEqual(reasons, [
            { kind: 'choice', parent: 'P', requiredChoice: 'Choice_A', taken: ['Choice_B'] },
        ]);
    });

    test('reasons: choice lock is reported transitively', () => {
        const reasons = unobtainableReasons('NeedsChoiceAIndirect', new Set(['P', 'PChoice_B']));
        assert.deepEqual(reasons, [
            { kind: 'choice', parent: 'P', requiredChoice: 'Choice_A', taken: ['Choice_B'] },
        ]);
    });

    test('reasons: a violated negative gate names the blocking line', () => {
        const reasons = unobtainableReasons('VariantA', new Set(['VariantB']));
        assert.deepEqual(reasons, [{ kind: 'negative', blocker: 'VariantB' }]);
    });

    test('reasons: empty for an obtainable dialogue', () => {
        assert.deepEqual(unobtainableReasons('JustBlocked', new Set()), []);
    });
});

describe('tree rendering: priority badges + alternates grouping (parity with the dependency tree)', () => {
    const neverPlayed = () => false;

    test('clusterAlternatesHtml wraps mutual alternates in one alternates-group, leaving others inline', () => {
        loadData({
            textlines: { A01: tl({}), A01_B: tl({}), X01: tl({}) },
            speakers: { NPC_Test_01: { name: 'Tester' } },
            alternates: { A01: ['A01_B'], A01_B: ['A01'] },
        });
        const rendered = [
            { name: 'A01', html: '<i>A01</i>' },
            { name: 'A01_B', html: '<i>A01_B</i>' },
            { name: 'X01', html: '<i>X01</i>' },
        ];
        const html = clusterAlternatesHtml(rendered);
        // One alternates box wrapping the two variants.
        assert.equal((html.match(/class="alternates-group /g) || []).length, 1);
        assert.match(html, /alternates-group-count">2</);
        const box = html.slice(html.indexOf('alternates-group-children'), html.indexOf('</div></div>'));
        assert.match(box, /A01</);
        assert.match(box, /A01_B</);
        // The unrelated row stays outside the box.
        assert.doesNotMatch(box, /X01/);
        assert.match(html, /<i>X01<\/i>/);
    });

    test('clusterAlternatesHtml leaves a lone alternate (sibling absent) inline', () => {
        loadData({
            textlines: { A01: tl({}) },
            speakers: { NPC_Test_01: { name: 'Tester' } },
            alternates: { A01: ['A01_B'], A01_B: ['A01'] },
        });
        const html = clusterAlternatesHtml([{ name: 'A01', html: '<i>A01</i>' }]);
        assert.doesNotMatch(html, /alternates-group/);
        assert.equal(html, '<i>A01</i>');
    });

    test('renderTreeHtml shows the priority badge on rows and clusters alternate OR-options', () => {
        loadData({
            defaultGame: 'hades2',
            games: {
                hades2: {
                    textlines: {
                        Root: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements: { RequiredAnyTextLines: ['Alt01', 'Alt01_B'] } },
                        Alt01: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements: {}, narrativePriorityOrdinal: 1, narrativePrioritySectionSize: 2 },
                        Alt01_B: { owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements: {}, narrativePriorityOrdinal: 2, narrativePrioritySectionSize: 2 },
                    },
                    speakers: { NPC_Test_01: { name: 'Tester' } },
                    alternates: { Alt01: ['Alt01_B'], Alt01_B: ['Alt01'] },
                },
            },
        });
        const { chain, groups } = buildPrereqChain('Root', neverPlayed);
        const html = renderTreeHtml(chain, 'Root', groups);
        // The two alternate OR-options are wrapped in one alternates box.
        assert.equal((html.match(/class="alternates-group /g) || []).length, 1);
        assert.match(html, /Alt01</);
        assert.match(html, /Alt01_B</);
        // Each row carries the narrative-priority badge (parity with the
        // dependency tree), here the H2 ordinal badge.
        assert.match(html, /priority-badge/);
    });
});

