// Onboarding tour for the speaker overview view. Triggered the first time a
// speaker overview is opened (via the dispatcher in navigation.js applyState),
// and re-run on demand by the replay control. Works desktop + mobile.
//
// The adjacency and textline-list steps allow interaction (expand rows /
// sections, hover badges) but block navigation to a different speaker or
// dialogue, so exploring mid-tour can't strand the walkthrough.

import { maybeStartTour, forceStartTour } from './tours.js';

const SPEAKER_TOUR_STEPS = [
    {
        target: '.speaker-overview-header',
        title: 'Speaker overview',
        body: 'Everything about a single speaker in one place - their dialogue, who they interact with, and (once a save is loaded) how far you have unlocked it.',
    },
    {
        target: '.speaker-summary',
        title: 'At a glance',
        body: 'How many dialogues this speaker owns, how often they speak in other speakers\u2019 dialogues, the sections they appear in, and - with a save loaded - your save progress.',
    },
    {
        target: '.speaker-adjacency',
        title: 'Who they interact with',
        body: 'Which other speakers\u2019 dialogues this speaker\u2019s dialogues depends on, and which depend on theirs. Expand a row to see the specific dialogues.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '.speaker-textlines',
        title: 'Every line',
        body: 'All of this speaker\u2019s dialogue, grouped by section. Click a section heading to expand it; each line links through to its full detail.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '.speaker-textline-controls-group',
        title: 'Filter the list',
        body: 'Filter this speaker\u2019s dialogues by name or line content, and narrow the list by repeatability (play-once or repeatable). Load a save to also filter by eligibility - what is played, reachable, or still blocked.',
    },
];

// Open the first dialogue section so the "Every line" step shows real rows
// rather than collapsed headings. Done once up front (before the tour starts)
// so the layout settles before the walkthrough begins, rather than shifting
// the page mid-tour when that step is reached.
function expandFirstSection() {
    const group = document.querySelector('.speaker-textlines .speaker-textline-group');
    if (group && !group.classList.contains('expanded')) {
        const header = group.querySelector('.speaker-textline-group-header');
        if (header) header.click();
    }
}

// First-open auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Call only once a speaker has actually rendered, so the targets
// exist. The first section is expanded only if the tour actually starts (via
// onBeforeStart), so returning users don't get a forced expansion.
export function maybeStartSpeakerTour() {
    return maybeStartTour('speaker', SPEAKER_TOUR_STEPS, { onBeforeStart: expandFirstSection });
}

// Replay entry point: the user is already on the speaker view, so just re-run
// the walkthrough regardless of the seen / disabled flags.
export function startSpeakerTourReplay() {
    forceStartTour('speaker', SPEAKER_TOUR_STEPS, { onBeforeStart: expandFirstSection });
}
