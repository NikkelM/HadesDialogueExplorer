// Onboarding tour for the eligibility tracer view. Triggered the first time the
// tracer renders for a dialogue with a usable save loaded (via the dispatcher
// in navigation.js applyState). Works desktop + mobile.
//
// Several tracer sections share the .eligibility-tree class and are rendered
// conditionally (only the ones relevant to the traced dialogue appear), so the
// unplayed-prerequisites and other-requirements steps use function targets that
// locate the right section by its header text. A section that isn't present for
// the current dialogue degrades to a centred card via the engine.

import { maybeStartTour, forceStartTour } from './tours.js';

// Find the .eligibility-tree whose header contains the given text, or null.
function treeByHeader(text) {
    return () => {
        for (const tree of document.querySelectorAll('.eligibility-tree')) {
            const h = tree.querySelector('.eligibility-tree-header');
            if (h && h.textContent.includes(text)) return tree;
        }
        return null;
    };
}

const ELIGIBILITY_TOUR_STEPS = [
    {
        target: '.eligibility-target',
        title: 'Eligibility tracer',
        body: 'With your save loaded, this works out what a dialogue still needs before it can play - which prerequisites are missing and in what order to get them.',
    },
    {
        target: '.eligibility-summary',
        title: 'Status at a glance',
        body: 'Whether the dialogue is eligible, blocked, or can no longer be obtained in this save, plus how many of its prerequisites you have already played.',
    },
    {
        target: treeByHeader('Unplayed prerequisites'),
        title: 'What to play next',
        body: 'The dialogues still standing in the way, ordered by depth - deepest first, so the list doubles as a play order. Each links through to its own detail.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '.eligibility-tree-section',
        title: 'Prerequisite tree',
        body: 'The full dependency hierarchy. Click a row to expand or collapse it; a met (struck-through) prerequisite opens its dialogue on a single click.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: treeByHeader('Other requirements'),
        title: 'Conditions beyond dialogue',
        body: 'Non-textline gates - game state, unlocks, run modifiers - read from the dialogue\u2019s definition. The tracer lists them but can\u2019t check them against your save.',
    },
];

// First-open auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Call only once the tracer has rendered for a dialogue, so the
// targets exist.
export function maybeStartEligibilityTour() {
    return maybeStartTour('eligibility', ELIGIBILITY_TOUR_STEPS);
}

// Replay entry point: the user is already on the tracer, so just re-run the
// walkthrough regardless of the seen / disabled flags.
export function startEligibilityTourReplay() {
    forceStartTour('eligibility', ELIGIBILITY_TOUR_STEPS);
}
