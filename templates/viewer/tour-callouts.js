// Contextual onboarding callout: a small, single-purpose mini-tour that fires
// the first time a particular feature first appears, rather than on a view
// change. Gated by its own hde.toursSeen id and, like the view tours, never
// stacks on another tour (maybeStartTour no-ops while one is already on screen)
// and respects the global opt-out.

import { maybeStartTour } from './tours.js';

// Build the save-callout steps for whatever is currently on screen. Each step
// is conditional on its target existing, and those targets (the detail status
// pill, the tree status dots, the tracer entry button) are only rendered when a
// save is loaded - so an empty list doubles as "no save-specific content here".
export function buildSaveCalloutSteps() {
    const steps = [];
    // The traced dialogue's own status badge in the detail panel.
    if (document.querySelector('#info-content .save-progress-pill')) {
        steps.push({
            target: () => document.querySelector('#info-content .save-progress-pill'),
            title: 'Save progress',
            body: 'This dialogue now shows its own status - played, eligible, blocked, or no longer obtainable in this save.',
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
            body: 'Each prerequisite and dependent carries a status dot, so you can see which lines have played and which still block this one. Hover a dot for detail, or expand a row to look deeper.',
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
    return steps;
}

// First save load: per-dialogue status indicators + the now-unlocked tracer.
// Fired from the save-loaded event (after the view has re-rendered with
// badges). No-ops (with whatever is relevant) when there's nothing to show.
export function maybeStartSaveCallout() {
    return maybeStartTour('callout-save', buildSaveCalloutSteps());
}
