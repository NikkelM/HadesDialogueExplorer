// Onboarding tour for the eligibility tracer view. Triggered the first time the
// tracer renders for a dialogue with a usable save loaded (via the dispatcher
// in navigation.js applyState). Works desktop + mobile.
//
// Several tracer sections share the .eligibility-tree class and are rendered
// conditionally (only the ones relevant to the traced dialogue appear), so the
// unplayed-prerequisites and other-requirements steps use function targets that
// locate the right section by its header text.
//
// If the dialogue the user opened is already eligible / played it has no
// prerequisite sections, which would leave two steps empty. In that case the
// tour traces a genuinely-blocked example dialogue (found from the loaded save)
// so every section renders, then reverts to the user's dialogue when it ends.

import { maybeStartTour, forceStartTour } from './tours.js';
import { findEligibilityExample } from './eligibility-view.js';
import { navigateToState } from './navigation.js';
import { parseUrlState } from './url.js';

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
        body: 'Non-textline gates - game state, unlocks, run modifiers - read from the dialogue\u2019s definition. Each is checked against your save where possible and marked with a status dot. Make sure you load an in-run or hub save depending on the dialogue you\u2019re viewing.',
    },
];

// Whether the tracer currently shows the unplayed-prerequisites section (and
// hence the prerequisite tree). Absent when the traced dialogue is already
// eligible / played, which would leave those tour steps without a target.
function hasPrereqSections() {
    for (const h of document.querySelectorAll('.eligibility-view .eligibility-tree-header')) {
        if (h.textContent.includes('Unplayed prerequisites')) return true;
    }
    return false;
}

// Set while we navigate the tracer to an example dialogue for the tour, so the
// resulting applyState render doesn't recursively re-enter the auto-start.
let _suppressAutoStart = false;

// Shared start path. When the dialogue currently traced has no prerequisite
// sections (it's already eligible / played), trace a genuinely-blocked example
// so the walkthrough has every section, then revert to the original dialogue
// when the tour ends. ``starter`` is maybeStartTour (auto) or forceStartTour
// (replay); the example swap happens in onBeforeStart so it only fires when the
// tour actually starts (not when the gates suppress it).
function runEligibilityTour(starter) {
    if (hasPrereqSections()) {
        return starter('eligibility', ELIGIBILITY_TOUR_STEPS);
    }
    const example = findEligibilityExample();
    const original = parseUrlState(window.location.hash).dialogue || null;
    if (!example || example === original) {
        // Nothing better to show (e.g. a fully completed save): run as-is.
        return starter('eligibility', ELIGIBILITY_TOUR_STEPS);
    }
    const steps = ELIGIBILITY_TOUR_STEPS.map((s, i) => (i === 0
        ? { ...s, body: `${s.body} We're using this dialogue to show you all of its features now; it returns to yours when the tour ends.` }
        : s));
    let swapped = false;
    // Restore the user's own dialogue. Guarded so it only navigates when the
    // example swap actually happened - idempotent across the tour-end callbacks
    // and the start-failure path below.
    const revert = () => {
        if (!swapped) return;
        swapped = false;
        navigateToState({ view: 'eligibility', dialogue: original });
    };
    const started = starter('eligibility', steps, {
        onBeforeStart() {
            // Suppress the render hook's auto-start while we swap in the example
            // (its re-render would otherwise re-enter and start a second tour
            // before this one opens). try/finally so a throw mid-swap can't leave
            // the flag stuck true and permanently disable the auto-tour.
            _suppressAutoStart = true;
            try {
                navigateToState({ view: 'eligibility', dialogue: example });
                swapped = true;
            } finally {
                _suppressAutoStart = false;
            }
        },
        onDone: revert,
        onSkip: revert,
        onDisableAll: revert,
    });
    // The tour didn't open (e.g. another tour was already on screen) - the swap
    // ran but no tour-end callback will fire, so put the user back on their own
    // dialogue rather than stranding them on the example.
    if (!started) revert();
    return started;
}

// First-open auto-start. Gated by tours.js (once-only, respects the global
// opt-out). Call only once the tracer has rendered for a dialogue, so the
// targets exist.
export function maybeStartEligibilityTour() {
    if (_suppressAutoStart) return false;
    return runEligibilityTour(maybeStartTour);
}

// Replay entry point: the user is already on the tracer, so just re-run the
// walkthrough regardless of the seen / disabled flags.
export function startEligibilityTourReplay() {
    runEligibilityTour(forceStartTour);
}
