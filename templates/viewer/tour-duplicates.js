// Onboarding tour for the cross-game duplicates view. Triggered the first time
// the duplicates view is opened (via the dispatcher in navigation.js
// applyState), and re-run on demand by the replay control. Works desktop +
// mobile.
//
// The entry-list step blocks navigation (the per-game open buttons would
// otherwise leave the view and strand the tour) while still allowing the user
// to look around.

import { maybeStartTour, forceStartTour } from './tours.js';

const DUPLICATES_TOUR_STEPS = [
    {
        target: '.duplicates-header',
        title: 'Cross-game duplicates',
        body: 'Dialogue names that exist in both Hades and Hades II - use this view to see how some characters talk about each other in different tones across the two games.',
    },
    {
        target: '.duplicates-speakers',
        title: 'Pick a speaker',
        body: 'Browse the speakers that have shared dialogue. Select one to narrow the list on the right to just their duplicates, or keep "All" to see everything.',
        interactive: true,
    },
    {
        target: '.duplicates-detail',
        title: 'Shared dialogue',
        body: 'Each row is a dialogue name found in both games. Use the per-game links to open that dialogue in either game\u2019s detail view.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '.duplicates-controls',
        title: 'Filter',
        body: 'Type to filter the list by dialogue name or speaker.',
    },
];

// First-open auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Call only once the view has rendered, so the targets exist.
export function maybeStartDuplicatesTour() {
    return maybeStartTour('duplicates', DUPLICATES_TOUR_STEPS);
}

// Replay entry point: the user is already on the duplicates view, so just
// re-run the walkthrough regardless of the seen / disabled flags.
export function startDuplicatesTourReplay() {
    forceStartTour('duplicates', DUPLICATES_TOUR_STEPS);
}
