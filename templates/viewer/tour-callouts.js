// Contextual onboarding callouts: small, single-purpose mini-tours that fire
// the first time a particular badge / interactable first appears, rather than
// on a view change. Each is gated by its own hde.toursSeen id and, like the
// view tours, never stacks on another tour (maybeStartTour no-ops while one is
// already on screen) and respects the global opt-out.

import { maybeStartTour } from './tours.js';

// First save load: per-dialogue status indicators + the now-unlocked tracer.
// Fired from the save-loaded event (after the view has re-rendered with
// badges). Each step is conditional on its target being on screen, so the
// callout only runs (with whatever is relevant) when there's something to show.
export function maybeStartSaveCallout() {
    const steps = [];
    // The traced dialogue's own status badge in the detail panel.
    if (document.querySelector('#info-content .save-progress-pill')) {
        steps.push({
            target: () => document.querySelector('#info-content .save-progress-pill'),
            title: 'Save progress',
            body: 'This dialogue now shows its own status - played, eligible, blocked, indeterminate, or not obtainable in this save.',
        });
    }
    // The same status as a small dot on every row of the prerequisite /
    // dependent trees - leaf rows use .save-badge, group headers use
    // .group-status. Spotlight the tree content (so the card sits just below
    // the rows, as in the dialogue tour) and ring every dot inside it.
    const dotContent = document.querySelector('#upstream-content .save-badge, #upstream-content .group-status') ? 'upstream-content'
        : document.querySelector('#downstream-content .save-badge, #downstream-content .group-status') ? 'downstream-content' : null;
    if (dotContent) {
        steps.push({
            target: '#' + dotContent + ' .tree-node.root',
            emphasize: '#' + dotContent + ' .save-badge, #' + dotContent + ' .group-status',
            title: 'Status at every step',
            body: 'Each prerequisite and dependent carries the same status dot, so you can see which lines are done and which still block this one. Hover a dot for detail, or expand a row to look deeper.',
            interactive: true,
            blockNavigation: true,
        });
    }
    // The eligibility tracer entry point on a dialogue.
    if (document.querySelector('.trace-eligibility-btn')) {
        steps.push({
            target: '.trace-eligibility-btn',
            title: 'Eligibility tracer',
            body: 'Your save also unlocks the eligibility tracer - open it from a dialogue to see exactly what a line still needs before it can play.',
        });
    }
    return maybeStartTour('callout-save', steps);
}

// First "play any N of" / OR-branch group. Looks in the dialogue detail
// requirements first, then the dependency trees. No-op when none is on screen,
// so the callout only fires (and is marked seen) once one actually appears.
function firstOrGroup() {
    return document.querySelector('#info-content .req-section.req-type-or-group')
        || document.querySelector('#panel-upstream .or-group-box, #panel-downstream .or-downstream-section');
}

export function maybeStartOrCallout() {
    if (!firstOrGroup()) return false;
    return maybeStartTour('callout-or', [{
        target: firstOrGroup,
        title: 'Any one of these',
        body: 'A "play any N of" group is satisfied as soon as enough of its options have played - you don\u2019t need all of them.',
    }]);
}

// First time the search dropdown shows results. Fired from the search UI when
// it becomes visible.
export function maybeStartSearchCallout() {
    if (!document.querySelector('#search-results.visible')) return false;
    return maybeStartTour('callout-search', [{
        target: '#search-results',
        title: 'Search results',
        body: 'Matches are grouped by speaker, dialogue name, and spoken text. Names that also exist in the other game appear in their own sections below.',
    }]);
}
