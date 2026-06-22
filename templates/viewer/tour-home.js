// First-run onboarding tour for the default dialogue detail (home) view.
//
// Anchors on the build-time featured dialogue (the same one the first-visit
// landing lands on), so its detail panel, requirement groups and up/downstream
// trees are all on screen for the walkthrough. Steps that target a panel which
// the featured dialogue happens not to have (e.g. no requirements) degrade to a
// centred card via the engine's missing-target handling.

import { maybeStartTour, forceStartTour, toursDisabled, hasSeenTour } from './tours.js';
import { isTourActive } from './tour.js';
import { textlines, defaultGame, defaultDialogue } from './data.js';
import { navigateToState } from './navigation.js';
import { parseUrlState } from './url.js';

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
        blockNavigation: true,
    },
    {
        target: '#info-content .meta',
        title: 'Owner and type',
        body: 'Who speaks the line and which dialogue context it belongs to. Hover or tap the dotted text to reveal the internal game id.',
        interactive: true,
        blockNavigation: true,
    },
    {
        target: '#info-content .dialogue-section',
        title: 'The dialogue',
        body: 'The spoken lines, in order. Choice prompts and their options appear here too.',
    },
    {
        target: '#info-content .requirements-group',
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

// Whether the dialogue currently named in the URL actually exists in the
// active game's data. A deep link can name a dialogue from the other game
// (or a typo), which renders the "not in the game" state with none of the
// detail-panel targets the tour points at.
function activeDialogueExists() {
    const name = parseUrlState(window.location.hash).dialogue;
    return !!name && !!(textlines && textlines[name]);
}

// Navigate to the build-time featured dialogue (in its own game), so the tour
// has real targets. Guarded against re-navigating to the same state.
function swapToFeaturedDialogue() {
    const game = defaultGame;
    const name = (defaultDialogue && game) ? defaultDialogue[game] : null;
    if (!name) return false;
    const cur = parseUrlState(window.location.hash);
    if (cur.dialogue === name && cur.game === game) return false;
    navigateToState({ game, view: 'dialogue', dialogue: name });
    return true;
}

// Whether the home tour would actually start (not opted out, not yet seen,
// nothing else on screen) - used to decide whether to bother swapping the
// dialogue for a tour that isn't going to run anyway.
function homeTourWouldStart() {
    return !toursDisabled() && !hasSeenTour('home') && !isTourActive();
}

// First-open auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Hooked into the dialogue detail render, so it fires both when a
// first-time visitor lands on the bare page (redirected to the featured
// dialogue) and when they arrive via a deep link to a specific dialogue. If
// that deep link names a dialogue not in the active game, swap to the featured
// one first - its render re-enters here with valid targets and starts the tour.
export function maybeStartHomeTour() {
    if (activeDialogueExists()) {
        return maybeStartTour('home', HOME_TOUR_STEPS);
    }
    if (homeTourWouldStart()) swapToFeaturedDialogue();
    return false;
}

// Replay entry point: run the tour on whatever dialogue is currently open.
// When nothing usable is open (the empty home state, or a dialogue not in this
// game) land on the featured dialogue first, then force-start regardless of the
// seen / disabled flags. Registered as the replay dispatcher so the floating
// "?" control re-runs this walkthrough.
export function startHomeTourReplay() {
    if (!activeDialogueExists()) swapToFeaturedDialogue();
    forceStartTour('home', HOME_TOUR_STEPS);
}
