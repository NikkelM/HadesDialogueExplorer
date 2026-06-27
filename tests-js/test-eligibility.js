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
import { buildPrereqChain, summarizePrereqs, renderOrBranchesHtml, renderTreeHtml, clusterAlternatesHtml, renderBlockingGatesHtml, renderOtherConditionsHtml } from '../templates/viewer/eligibility-view.js';
import { isUnobtainable, unobtainableReasons, isGroupUnobtainable, isRequirementSetUnobtainable, namedRequirementGroupVerdict } from '../templates/viewer/unobtainable.js';

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

test('a played AND prerequisite is a leaf: its own prerequisites are not walked (regression)', () => {
    // ``And1`` (a direct AND prereq of Root) requires ``And2``. With ``And1``
    // already played it is satisfied, so it is recorded (shown ticked in the
    // tree) but its own prerequisite ``And2`` must NOT be pulled into the
    // chain / counted as still needed.
    const { chain, mandatory } = buildPrereqChain('Root', playedSet('And1'));
    assert.ok(chain.has('And1'));
    assert.equal(chain.get('And1').played, true);
    assert.equal(chain.has('And2'), false);
    assert.equal(mandatory.has('And2'), false);
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
                    { requirements: {}, otherRequirements: { 'PathTrue:GameState.X': [{ PathTrue: ['GameState', 'X'] }] } },
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
        // Branch 3 is gated only on a non-dialogue GameState condition. With no
        // save loaded it can't be resolved, so it reads indeterminate and the
        // condition is listed (a dot + the path) rather than hidden.
        assert.match(html, /Option 3 of 3 \u00b7 can\u2019t determine/);
        assert.match(html, /Conditions:/);
        assert.match(html, /group-status group-status-unknown/);
        assert.match(html, /GameState\.X/);
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
                // Run-count locks: a play-once line gated on having played
                // within 3 runs. Once it slips past the window it can never
                // replay, so the gate is permanently lost - unlike a
                // repeatable line, which can replay to recover.
                PlayOnceFoe: tl({}, { playOnce: true }),
                RepFoe: tl({}),
                MaxGatePOnce: tl(
                    { MaxRunsSinceAnyTextLines: ['PlayOnceFoe'] },
                    { otherRequirements: { MaxRunsSinceAnyTextLines: { Count: 3 } } },
                ),
                MaxGateRep: tl(
                    { MaxRunsSinceAnyTextLines: ['RepFoe'] },
                    { otherRequirements: { MaxRunsSinceAnyTextLines: { Count: 3 } } },
                ),
                // Count-max gate: at most 1 of these may have played, ever.
                MaxAnyGate: tl(
                    { RequiredMaxAnyTextLines: ['M1', 'M2', 'M3'] },
                    { otherRequirements: { RequiredMaxAnyTextLines: { Count: 1 } } },
                ),
                M1: tl({}), M2: tl({}), M3: tl({}),
                // Transitive-group fixtures: ``Locked`` is unobtainable (a
                // negative gate on a played line), so an AND group requiring
                // it, an OR group whose only option is it, and a count-min
                // group needing more than its still-obtainable options, are
                // all permanently unsatisfiable.
                Locked: tl({ RequiredFalseTextLines: ['Blocker'] }),
                Blocker: tl({}),
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

    test('reasons: a violated negative gate names the blocking line and its host', () => {
        const reasons = unobtainableReasons('VariantA', new Set(['VariantB']));
        assert.deepEqual(reasons, [{ kind: 'negative', blocker: 'VariantB', host: 'VariantA' }]);
    });

    test('reasons: empty for an obtainable dialogue', () => {
        assert.deepEqual(unobtainableReasons('JustBlocked', new Set()), []);
    });

    test('a MaxRunsSince gate on a play-once line now past the window is unobtainable', () => {
        // Played 5 runs ago, gate wants within 3 -> out, and play-once can't replay.
        assert.equal(isUnobtainable('MaxGatePOnce', new Set(['PlayOnceFoe']), { PlayOnceFoe: 5 }), true);
        // Still within the window -> obtainable.
        assert.equal(isUnobtainable('MaxGatePOnce', new Set(['PlayOnceFoe']), { PlayOnceFoe: 1 }), false);
        // Played, but beyond the tracked run history (absent from runsAgo) -> permanent.
        assert.equal(isUnobtainable('MaxGatePOnce', new Set(['PlayOnceFoe']), {}), true);
        // Never played -> a Max gate passes (never-played is "in range") -> obtainable.
        assert.equal(isUnobtainable('MaxGatePOnce', new Set(), {}), false);
    });

    test('a MaxRunsSince gate on a repeatable line is recoverable, not unobtainable', () => {
        assert.equal(isUnobtainable('MaxGateRep', new Set(['RepFoe']), { RepFoe: 5 }), false);
    });

    test('without runs-ago data a play-once Max gate is not claimed unobtainable', () => {
        assert.equal(isUnobtainable('MaxGatePOnce', new Set(['PlayOnceFoe'])), false);
    });

    test('a count-max gate that has overflowed its quota is unobtainable', () => {
        assert.equal(isUnobtainable('MaxAnyGate', new Set(['M1', 'M2'])), true);  // 2 > 1
        assert.equal(isUnobtainable('MaxAnyGate', new Set(['M1'])), false);        // 1 <= 1
        assert.equal(isUnobtainable('MaxAnyGate', new Set()), false);
    });

    test('reasons: a play-once run-count lock names the line, runs-ago and window', () => {
        assert.deepEqual(
            unobtainableReasons('MaxGatePOnce', new Set(['PlayOnceFoe']), { PlayOnceFoe: 5 }),
            [{ kind: 'runcount', blocker: 'PlayOnceFoe', count: 3, ago: 5 }],
        );
        // Beyond the tracked depth -> ago reported as null.
        assert.deepEqual(
            unobtainableReasons('MaxGatePOnce', new Set(['PlayOnceFoe']), {}),
            [{ kind: 'runcount', blocker: 'PlayOnceFoe', count: 3, ago: null }],
        );
    });

    test('reasons: a count-max overflow lists the played blockers and the cap', () => {
        assert.deepEqual(
            unobtainableReasons('MaxAnyGate', new Set(['M1', 'M2'])),
            [{ kind: 'maxany', blockers: ['M1', 'M2'], count: 1 }],
        );
    });

    // --- transitive group / set unobtainability (dependency-tree dots) ---

    test('isGroupUnobtainable: an AND group requiring an unobtainable line is locked', () => {
        const played = new Set(['Blocker']); // makes ``Locked`` unobtainable
        assert.equal(isGroupUnobtainable('RequiredTextLines', ['Locked'], played, null, 1), true);
        // A normally-unplayed (still obtainable) ref is not a permanent lock.
        assert.equal(isGroupUnobtainable('RequiredTextLines', ['NeverPlayed'], played, null, 1), false);
        // An already-played ref satisfies the AND, so not unobtainable.
        assert.equal(isGroupUnobtainable('RequiredTextLines', ['Blocker'], played, null, 1), false);
    });

    test('isGroupUnobtainable: an OR group is locked only when every option is unobtainable', () => {
        const played = new Set(['Blocker']);
        assert.equal(isGroupUnobtainable('RequiredAnyTextLines', ['Locked'], played, null, 1), true);
        // One still-obtainable option keeps the OR group satisfiable.
        assert.equal(isGroupUnobtainable('RequiredAnyTextLines', ['Locked', 'NeverPlayed'], played, null, 1), false);
    });

    test('isGroupUnobtainable: a count-min group is locked when too few options remain obtainable', () => {
        const played = new Set(['Blocker']);
        // Need 2 of {Locked, NeverPlayed}: only 1 is still obtainable -> locked.
        assert.equal(isGroupUnobtainable('RequiredMinAnyTextLines', ['Locked', 'NeverPlayed'], played, null, 2), true);
        // Need 1 of the same: still satisfiable -> not locked.
        assert.equal(isGroupUnobtainable('RequiredMinAnyTextLines', ['Locked', 'NeverPlayed'], played, null, 1), false);
    });

    test('isGroupUnobtainable: negative / count-max fields are not transitive-locked here', () => {
        // Those direct permanent-lock cases are handled by reqGroupLocked, not this helper.
        assert.equal(isGroupUnobtainable('RequiredFalseTextLines', ['Blocker'], new Set(['Blocker']), null, 1), false);
    });

    test('isGroupUnobtainable: a positive queued gate is locked once its operand can never be queued again', () => {
        // A play-once operand that already played can never be set as an NPC's
        // next line again -> the queued gate is permanently unsatisfiable.
        assert.equal(isGroupUnobtainable('RequiredQueuedTextLines', ['PlayOnceFoe'], new Set(['PlayOnceFoe']), null, 1), true);
        // Not yet played -> can still be queued -> not locked.
        assert.equal(isGroupUnobtainable('RequiredQueuedTextLines', ['PlayOnceFoe'], new Set(), null, 1), false);
        // Repeatable operand can be re-queued even after playing -> not locked.
        assert.equal(isGroupUnobtainable('RequiredQueuedTextLines', ['RepFoe'], new Set(['RepFoe']), null, 1), false);
        // A transitively-unobtainable operand can never play, so never be queued.
        assert.equal(isGroupUnobtainable('RequiredQueuedTextLines', ['Locked'], new Set(['Blocker']), null, 1), true);
        // OR queued: locked only when EVERY operand can never be queued again.
        assert.equal(isGroupUnobtainable('RequiredAnyQueuedTextLines', ['PlayOnceFoe', 'RepFoe'], new Set(['PlayOnceFoe', 'RepFoe']), null, 1), false);
        assert.equal(isGroupUnobtainable('RequiredAnyQueuedTextLines', ['PlayOnceFoe'], new Set(['PlayOnceFoe']), null, 1), true);
    });

    test('isRequirementSetUnobtainable: a host gated on a played-out queued line is unobtainable', () => {
        assert.equal(
            isRequirementSetUnobtainable({ requirements: { RequiredQueuedTextLines: ['PlayOnceFoe'] } }, null, new Set(['PlayOnceFoe']), null),
            true,
        );
        // Operand not yet played -> still satisfiable in a future room.
        assert.equal(
            isRequirementSetUnobtainable({ requirements: { RequiredQueuedTextLines: ['PlayOnceFoe'] } }, null, new Set(), null),
            false,
        );
    });

    test('isRequirementSetUnobtainable: a branch requiring an unobtainable line is locked', () => {
        const played = new Set(['Blocker']);
        assert.equal(
            isRequirementSetUnobtainable({ requirements: { RequiredTextLines: ['Locked'] } }, null, played, null),
            true,
        );
        // A branch gated only on non-dialogue otherRequirements is not a
        // permanent lock (it's indeterminate, not unobtainable).
        assert.equal(
            isRequirementSetUnobtainable({ otherRequirements: { 'PathTrue:GameState.X': [{}] } }, null, played, null),
            false,
        );
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

describe('renderBlockingGatesHtml: situational gates the prereq chain omits', () => {
    const gate = (reqs, other) => ({ owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements: reqs, otherRequirements: other });

    test('surfaces a Min run-count gate blocked by a too-recent ref', () => {
        loadData({
            textlines: {
                Root: gate({ MinRunsSinceAnyTextLines: ['Foe'] }, { MinRunsSinceAnyTextLines: { Count: 8 } }),
                Foe: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // Foe played 2 runs ago -> too recent for an 8-run gate.
        const html = renderBlockingGatesHtml('Root', { played: new Set(['Foe']), runsAgo: { Foe: 2 } });
        assert.match(html, /Situational gates \(1\)/);
        assert.match(html, /Foe<\/a> - last played 2 runs ago, too recent \(needs at least 8 runs since\)/);
    });

    test('surfaces a run-scoped negative blocked by a line played this run', () => {
        loadData({
            textlines: {
                Root: gate({ RequiredFalseTextLinesThisRun: ['Foe'] }, {}),
                Foe: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // Foe played this run -> violates the "must not have played this run" gate.
        const html = renderBlockingGatesHtml('Root', { played: new Set(), thisRun: new Set(['Foe']) });
        assert.match(html, /Situational gates \(1\)/);
        assert.match(html, /Foe<\/a> - played this run/);
    });

    test('surfaces a run-scoped positive AND missing a line this run', () => {
        loadData({
            textlines: {
                Root: gate({ RequiredTextLinesThisRun: ['Foe'] }, {}),
                Foe: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        const html = renderBlockingGatesHtml('Root', { played: new Set(), thisRun: new Set() });
        assert.match(html, /Foe<\/a> - not played this run/);
    });

    test('highlights an option played in the save but not in the gate scope', () => {
        loadData({
            textlines: {
                Root: gate({ RequiredAnyTextLinesLastRun: ['Seen', 'Unseen'] }, {}),
                Seen: { owner: 'NPC_Test_01', requirements: {} },
                Unseen: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // Seen played in the save (global) but not last run; Unseen never.
        const html = renderBlockingGatesHtml('Root', { played: new Set(['Seen']), lastRun: new Set() });
        // The near-miss option gets the distinct class + its own tooltip.
        assert.match(html, /<span class="gate-ref-elsewhere" data-tooltip="[^"]*Played in your save[^"]*">- played in the save, but not last run<\/span>/);
        // The never-played option stays a plain reason.
        assert.match(html, /Unseen<\/a> - not played last run/);
        // The gate head gains the near-miss explainer tooltip.
        assert.match(html, /eligibility-gate-head" data-tooltip="[^"]*Highlighted options have played in your save but not in the last run/);
    });

    test('is silent for a run-scoped gate the save cannot resolve (no record)', () => {
        loadData({
            textlines: {
                Root: gate({ RequiredFalseTextLinesThisRun: ['Foe'] }, {}),
                Foe: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // No this-run record -> indeterminate, not a reported block.
        assert.equal(renderBlockingGatesHtml('Root', { played: new Set(), thisRun: null }), '');
    });

    test('is empty when the run-count gate is satisfied', () => {
        loadData({
            textlines: {
                Root: gate({ MinRunsSinceAnyTextLines: ['Foe'] }, { MinRunsSinceAnyTextLines: { Count: 3 } }),
                Foe: { owner: 'NPC_Test_01', requirements: {} },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // Foe played 5 runs ago -> satisfies a 3-run gate.
        assert.equal(renderBlockingGatesHtml('Root', { played: new Set(['Foe']), runsAgo: { Foe: 5 } }), '');
    });

    test('omits a permanent (play-once) lock - that is an unobtainable reason instead', () => {
        loadData({
            textlines: {
                Root: gate({ MaxRunsSinceAnyTextLines: ['POnce'] }, { MaxRunsSinceAnyTextLines: { Count: 3 } }),
                POnce: { owner: 'NPC_Test_01', requirements: {}, playOnce: true },
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        // Play-once line 5 runs ago, window 3 -> permanently out, so it is not
        // listed here (the unobtainable reasons cover it).
        assert.equal(renderBlockingGatesHtml('Root', { played: new Set(['POnce']), runsAgo: { POnce: 5 } }), '');
    });

    test('is empty for a dialogue with no situational gates', () => {
        loadData({
            textlines: { Root: gate({ RequiredTextLines: ['Foe'] }, {}), Foe: { owner: 'NPC_Test_01', requirements: {} } },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
        assert.equal(renderBlockingGatesHtml('Root', { played: new Set(), runsAgo: {} }), '');
    });
});

describe('renderOtherConditionsHtml (non-textline requirements section)', () => {
    const withReqs = (requirements, otherRequirements) => ({
        owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements, otherRequirements,
    });

    before(() => {
        loadData({
            textlines: {
                // A non-textline condition that is NOT a requirement key -> surfaces.
                HasOther: withReqs({ RequiredTextLines: ['Dep'] }, { MustHaveAllWeapons: true }),
                // otherRequirements key IS a requirement key (Count metadata) -> skipped.
                OnlyReqMeta: withReqs(
                    { RequiredMinAnyTextLines: ['Dep'] },
                    { RequiredMinAnyTextLines: { Count: 2 } },
                ),
                NoOther: withReqs({ RequiredTextLines: ['Dep'] }, {}),
                Dep: withReqs({}, {}),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
            reqTypeOrder: ['RequiredTextLines', 'RequiredMinAnyTextLines'],
        });
    });

    test('renders a labelled section for non-textline conditions', () => {
        const html = renderOtherConditionsHtml('HasOther');
        assert.match(html, /Other requirements \(1\)/);
        assert.match(html, /eligibility-tree-hint/);
        assert.match(html, /other-req-item/);
    });

    test('is empty when there are no otherRequirements', () => {
        assert.equal(renderOtherConditionsHtml('NoOther'), '');
    });

    test('is empty when every otherRequirements key is also a requirement key', () => {
        // RequiredMinAnyTextLines Count metadata is surfaced inline with the
        // requirement group, not as a standalone "other" condition.
        assert.equal(renderOtherConditionsHtml('OnlyReqMeta'), '');
    });

    test('is empty for an unknown dialogue name', () => {
        assert.equal(renderOtherConditionsHtml('DoesNotExist'), '');
    });
});


describe('renderOtherConditionsHtml NamedRequirements expansion', () => {
    const withReqs = (requirements, otherRequirements) => ({
        owner: 'NPC_Test_01', section: 'InteractTextLineSets', requirements, otherRequirements,
    });

    before(() => {
        loadData({
            textlines: {
                // Host gated on a NamedRequirementsFalse set -> the named
                // requirement's inner chain must render as an expander.
                Host: withReqs({}, { NamedRequirementsFalse: ['MyNamed'] }),
                InnerDep: withReqs({}, {}),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
            reqTypeOrder: ['RequiredTextLines'],
            namedRequirements: {
                MyNamed: {
                    requirements: { RequiredTextLines: ['InnerDep'] },
                    otherRequirements: {}, orBranches: [],
                },
            },
        });
    });

    test('renders the named requirement as an expander listing its inner requirements', () => {
        const html = renderOtherConditionsHtml('Host');
        // No longer the flat "Must not satisfy" chip.
        assert.doesNotMatch(html, /Must not satisfy/);
        assert.match(html, /named-req-item/);
        assert.match(html, /named-req-expand/);
        assert.match(html, /MyNamed/);
        assert.match(html, /must NOT pass/);
        // The inner requirement chain is evaluated and listed.
        assert.match(html, /InnerDep/);
    });
});


// Permanent ("set-and-forget") gates: a dialogue gated on monotonic GameState -
// directly, or via a named requirement that can never become ineligible again -
// is unobtainable, not merely blocked. The canonical case is
// ``ChronosBossAboutFates01`` gated ``NamedRequirementsFalse: [ReachedEpilogue]``:
// once a save reaches the true ending (and has played the epilogue line),
// ReachedEpilogue is permanently satisfied, so the host can never play.
describe('isUnobtainable: permanent GameState + named-requirement gates', () => {
    const tl = (requirements, otherRequirements = {}, extra = {}) => ({
        owner: 'NPC_Test_01', section: 'InteractTextLineSets',
        requirements, otherRequirements, ...extra,
    });
    // A GameState slice carrying the monotonic true-ending flag.
    const ENDED = { gameState: { ReachedTrueEnding: true } };
    const FRESH = { gameState: {} };

    before(() => {
        loadData({
            textlines: {
                FatesEpilogue01: tl({}, {}, { playOnce: true }),
                // "Must NOT pass ReachedEpilogue" (the Chronos pattern).
                ChronosLike: tl({}, { NamedRequirementsFalse: ['ReachedEpilogue'] }),
                // Direct monotonic negative gate: must NOT have reached the ending.
                PreEndingOnly: tl({}, {
                    'PathFalse:GameState.ReachedTrueEnding': [{ PathFalse: ['GameState', 'ReachedTrueEnding'] }],
                }),
                // Negative gate on a NON-monotonic GameState path -> recoverable.
                LiveGate: tl({}, {
                    'PathFalse:GameState.ActiveShrineBounty': [{ PathFalse: ['GameState', 'ActiveShrineBounty'] }],
                }),
                // Negative gate on a CurrentRun path -> transient, never permanent.
                CurrentRunGate: tl({}, {
                    'PathFalse:CurrentRun.Foo': [{ PathFalse: ['CurrentRun', 'Foo'] }],
                }),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
            namedRequirements: {
                // Needs the epilogue line played AND the (monotonic) true-ending flag.
                ReachedEpilogue: {
                    requirements: { RequiredTextLines: ['FatesEpilogue01'] },
                    otherRequirements: {
                        'PathTrue:GameState.ReachedTrueEnding': [{ PathTrue: ['GameState', 'ReachedTrueEnding'] }],
                    },
                    orBranches: [], flags: {},
                },
            },
        });
    });

    test('a NamedRequirementsFalse gate on a permanently-met named set is unobtainable', () => {
        // Epilogue played + ending reached -> ReachedEpilogue permanently met ->
        // the host can never play again.
        assert.equal(isUnobtainable('ChronosLike', new Set(['FatesEpilogue01']), {}, ENDED), true);
    });

    test('the same gate is merely blocked (not unobtainable) before it is permanent', () => {
        // Nothing reached yet.
        assert.equal(isUnobtainable('ChronosLike', new Set(), {}, FRESH), false);
        // Only one of the two conditions holds -> the named set is not yet
        // permanently met, so the host is still recoverable.
        assert.equal(isUnobtainable('ChronosLike', new Set(), {}, ENDED), false);
        assert.equal(isUnobtainable('ChronosLike', new Set(['FatesEpilogue01']), {}, FRESH), false);
    });

    test('a direct monotonic PathFalse gate flips to unobtainable once the flag is set', () => {
        assert.equal(isUnobtainable('PreEndingOnly', new Set(), {}, ENDED), true);
        assert.equal(isUnobtainable('PreEndingOnly', new Set(), {}, FRESH), false);
    });

    test('a negative gate on a non-monotonic / CurrentRun path is never unobtainable', () => {
        const live = { gameState: { ActiveShrineBounty: 'something' } };
        assert.equal(isUnobtainable('LiveGate', new Set(), {}, live), false);
        assert.equal(isUnobtainable('CurrentRunGate', new Set(), {}, { gameState: { } }), false);
    });

    test('without a save context (no GameState slice) GameState gates never lock', () => {
        assert.equal(isUnobtainable('ChronosLike', new Set(['FatesEpilogue01'])), false);
        assert.equal(isUnobtainable('PreEndingOnly', new Set()), false);
    });

    test('namedRequirementGroupVerdict upgrades the group dot to unobtainable', () => {
        const ended = { played: new Set(['FatesEpilogue01']), gameState: { ReachedTrueEnding: true }, runsAgo: {} };
        assert.equal(
            namedRequirementGroupVerdict('NamedRequirementsFalse', ['ReachedEpilogue'], ended, 'NPC_Test_01'),
            'unobtainable');
        // Before it is permanent the gate reads as currently satisfiable (met):
        // the host can still play while the epilogue has not been reached.
        const fresh = { played: new Set(), gameState: {}, runsAgo: {} };
        assert.equal(
            namedRequirementGroupVerdict('NamedRequirementsFalse', ['ReachedEpilogue'], fresh, 'NPC_Test_01'),
            'met');
    });
});

// Hades 1 flat "max" gates over monotonic counters: surpassing the cap is a
// permanent lock (the counter only grows), so the dialogue is unobtainable, not
// merely blocked. The fixtures are loaded as the default (hades1) game.
describe('isUnobtainable: Hades 1 monotonic max gates', () => {
    const tl = (otherRequirements = {}) => ({
        owner: 'NPC_Test_01', section: 'InteractTextLineSets',
        requirements: {}, otherRequirements,
    });
    before(() => {
        loadData({
            textlines: {
                MaxRunsLine: tl({ RequiredMaxCompletedRuns: 2 }),
                MaxSpentLine: tl({ RequiredLifetimeResourcesSpentMax: { Gems: 100 } }),
                PerRunLine: tl({ RequiredMaxDepth: 1 }),
            },
            speakers: { NPC_Test_01: { name: 'Tester' } },
        });
    });

    test('a surpassed run-count cap makes the dialogue unobtainable', () => {
        const over = { gameState: { RunHistory: [{}, {}, {}] } };   // 3 > 2
        assert.equal(isUnobtainable('MaxRunsLine', new Set(), null, over), true);
        const under = { gameState: { RunHistory: [{}, {}] } };      // 2 <= 2
        assert.equal(isUnobtainable('MaxRunsLine', new Set(), null, under), false);
    });

    test('a surpassed lifetime-resource cap is unobtainable, but a per-run cap is not', () => {
        const over = { gameState: { LifetimeResourcesSpent: { Gems: 250 } } };
        assert.equal(isUnobtainable('MaxSpentLine', new Set(), null, over), true);
        // RequiredMaxDepth is per-run (resets each run) -> never permanent.
        assert.equal(isUnobtainable('PerRunLine', new Set(), null, { gameState: { RunHistory: [{}, {}, {}] } }), false);
    });

    test('without a GameState slice the max gate never locks', () => {
        assert.equal(isUnobtainable('MaxRunsLine', new Set()), false);
    });
});
