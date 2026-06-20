// First-run onboarding tour for the default dialogue detail (home) view.
//
// Anchors on the build-time featured dialogue (the same one the first-visit
// landing lands on), so its detail panel, requirement groups and up/downstream
// trees are all on screen for the walkthrough. Steps that target a panel which
// the featured dialogue happens not to have (e.g. no requirements) degrade to a
// centred card via the engine's missing-target handling.

import { maybeStartTour, forceStartTour } from './tours.js';
import { getDefaultDialogue } from './data.js';
import { navigateToState } from './navigation.js';

const HOME_TOUR_STEPS = [
    {
        target: null,
        title: 'Welcome to the Hades Dialogue Explorer',
        body: 'Explore every line of dialogue from Hades and Hades II, the conditions that gate each line, and how lines depend on one another. This quick tour shows you around - you can skip it at any time.',
    },
    {
        target: '#search',
        title: 'Search',
        body: 'Find dialogue by its name, the words spoken, or the speaker. Start typing to see matches from the active game (and the other game too).',
    },
    {
        target: '#game-toggle',
        title: 'Switch games',
        body: 'Toggle between Hades and Hades II. The search, dialogue and everything else follow the game you pick here.',
    },
    {
        target: '#info-content h3',
        title: 'Dialogue details',
        body: 'The selected line, with badges for its narrative priority (its rank within the set) and whether it plays once or can repeat. Hover a badge to read what it means.',
        interactive: true,
    },
    {
        target: '#info-content .meta',
        title: 'Owner and type',
        body: 'Who speaks the line and which dialogue context it belongs to. Hover or tap the dotted text to reveal the internal game id.',
        interactive: true,
    },
    {
        target: '#info-content .dialogue-section',
        title: 'The dialogue',
        body: 'The spoken lines, in order. Choice prompts and their options appear here too.',
    },
    {
        target: '#info-content .req-section',
        title: 'Requirements',
        body: 'What must - and must not - have happened for this line to play, grouped as all-of, any-of and must-not conditions. Click a group heading to collapse it, hover a row for detail, or click a requirement name to open that dialogue.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '#upstream-content .tree-node.root',
        title: 'Prerequisites',
        body: 'Other dialogue this line depends on. Expand a row to reveal its own requirements; each name links through to that dialogue when you explore on your own.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '#downstream-content .tree-node.root',
        title: 'Dependents',
        body: 'Dialogues that depend on this line - what becomes reachable once it has played. Expand rows the same way.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '#nav-duplicates',
        title: 'Cross-game duplicates',
        body: 'Browse dialogue names that appear in both Hades and Hades II, listed side by side.',
    },
    {
        target: '.save-upload-btn',
        title: 'Load your save',
        body: 'Upload a save file to see which dialogues you have already triggered, and to unlock the Eligibility tracer, which works out exactly what a line still needs in order to play.',
    },
];

// First-visit auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Call only after the first-visit landing has rendered the featured
// dialogue, so the detail-panel targets exist.
export function maybeStartHomeTour() {
    return maybeStartTour('home', HOME_TOUR_STEPS);
}

// Replay entry point: make sure the featured dialogue is on screen, then run
// the tour regardless of the seen / disabled flags. Registered as the replay
// dispatcher so the floating "?" control re-runs this walkthrough.
export function startHomeTourReplay() {
    const featured = getDefaultDialogue();
    if (featured) navigateToState({ view: 'dialogue', dialogue: featured });
    forceStartTour('home', HOME_TOUR_STEPS);
}
