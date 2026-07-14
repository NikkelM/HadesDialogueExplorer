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
import { buildSaveCalloutSteps } from './tour-callouts.js';

// The "load your save" call to action is dropped from the chained replay once a
// save is already loaded (its status indicators replace it); kept as a constant
// so the step and that filter can't drift apart.
const SAVE_UPLOAD_TARGET = '.save-upload-btn';

const HOME_TOUR_STEPS = [
    {
        target: '#search',
        title: 'Search',
        body: 'Welcome! This explorer covers every line of dialogue from Hades and Hades II, the conditions that gate each line, and how lines depend on one another. Start here: search by a line\u2019s name, the words spoken, or the speaker.',
    },
    {
        target: '#game-toggle',
        title: 'Switch games',
        body: 'Toggle between Hades and Hades II. The search, dialogue and everything else follow the game you pick here.',
    },
    {
        target: '#panel-info',
        title: 'Dialogue details',
        body: 'The selected line in full: its text, speaker, dialogue context, narrative-priority and play-once/repeat badges, and the requirements that gate it. Hover badges or dotted text for detail; click a requirement name to open that dialogue.',
        interactive: true,
        blockNavigation: true,
        cardSide: 'right',
    },
    {
        target: ['#panel-upstream', '#panel-downstream'],
        title: 'Prerequisites and dependents',
        body: 'Two dependency trees: prerequisites (what this line needs to play) and dependents (what becomes reachable once it plays). Expand any row to reveal its own requirements.',
        interactive: true,
        blockNavigation: true,
        cardSide: 'left',
    },
    {
        target: SAVE_UPLOAD_TARGET,
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
// has real targets. Guarded against re-navigating to the same state. Async: the
// swap can change games (an async data load), so callers that then read the
// rendered DOM must await it.
async function swapToFeaturedDialogue() {
    const game = defaultGame;
    const name = (defaultDialogue && game) ? defaultDialogue[game] : null;
    if (!name) return false;
    const cur = parseUrlState(window.location.hash);
    if (cur.dialogue === name && cur.game === game) return false;
    await navigateToState({ game, view: 'dialogue', dialogue: name });
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

// Dialogue-view replay: when a save is loaded its status indicators are on
// screen too, so chain the generic walkthrough and the save callout into one
// continuous tour (a single step sequence, so the footer counter sums both).
// The "load your save" step is dropped in that case - the save is already
// loaded, so its status indicators replace that call to action. With no save
// loaded - or nothing save-specific on screen - this is just the home tour.
// When nothing usable is open (the empty home state, or a dialogue not in this
// game) land on the featured dialogue first. Force-starts regardless of the
// seen / disabled flags. Registered as the dialogue-view replay so the floating
// "?" control re-runs the combined walkthrough.
export async function startDialogueTourReplay() {
    // Await the swap: it may switch games (an async data load) before the
    // featured dialogue renders, and buildSaveCalloutSteps below reads the
    // rendered DOM (status badges / tree dots) to decide the callout steps.
    if (!activeDialogueExists()) await swapToFeaturedDialogue();
    const saveSteps = buildSaveCalloutSteps();
    const steps = saveSteps.length
        ? HOME_TOUR_STEPS.filter(s => s.target !== SAVE_UPLOAD_TARGET).concat(saveSteps)
        : HOME_TOUR_STEPS;
    forceStartTour('home', steps);
}
