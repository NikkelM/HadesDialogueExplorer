// Game toggle UI: two side-by-side buttons in the page header that
// swap the viewer's active game (Hades / Hades II). Clicks flow
// through ``navigateToState({ game })`` so the URL stays canonical
// and the per-game data swap goes through the same code path as a
// shared deep link (``navigation.switchToGame``).
//
// Switching games drops the current dialogue selection rather than
// trying to carry it across: textline names aren't unique between
// games (``HermesGift03`` exists in both, but they're entirely
// separate dialogues), so any "preserve selection" behaviour would
// produce the wrong renders. An empty-state on switch matches the
// "strict per-game viewer" model the user asked for.

import { gameIds, gameLabels, getActiveGame } from './data.js';
import { navigateToState } from './navigation.js';
import { escapeHtml } from './utilities.js';

let toggleMount = null;

// Build the toggle buttons inside ``#game-toggle`` and wire a single
// delegated click listener. Idempotent: a second call is a no-op so
// hypothetical hot-reload paths don't double-bind listeners.
//
// The HTML template pre-renders placeholder buttons so the header
// reserves the correct width from the first paint (avoids a layout
// shift). This function upgrades them: syncs labels with the data
// payload, hides the mount for single-game builds, and wires the
// click handler.
export function initGameToggle() {
    if (toggleMount) return;
    toggleMount = document.getElementById('game-toggle');
    if (!toggleMount) return;
    if (!gameIds || gameIds.length <= 1) {
        // Single-game build has nothing to toggle - hide the mount
        // entirely so it doesn't leave an empty slot in the header.
        toggleMount.hidden = true;
        return;
    }
    // Check if placeholder buttons already exist from the HTML template.
    const existing = toggleMount.querySelectorAll('.game-toggle-btn');
    if (existing.length === gameIds.length) {
        // Upgrade in place: sync labels from data (in case they differ
        // from the hardcoded placeholder text).
        for (let i = 0; i < gameIds.length; i++) {
            const gid = gameIds[i];
            const label = gameLabels && gameLabels[gid] ? gameLabels[gid] : gid;
            existing[i].dataset.game = gid;
            existing[i].textContent = label;
        }
    } else {
        // No valid placeholders - build from scratch.
        toggleMount.innerHTML = gameIds.map(gid => {
            const label = gameLabels && gameLabels[gid] ? gameLabels[gid] : gid;
            return (
                '<button type="button" class="game-toggle-btn" role="tab" data-game="'
                + escapeHtml(gid) + '">' + escapeHtml(label) + '</button>'
            );
        }).join('');
    }
    toggleMount.addEventListener('click', (e) => {
        const btn = e.target.closest('.game-toggle-btn');
        if (!btn || !toggleMount.contains(btn)) return;
        const gameId = btn.dataset.game;
        if (!gameId || gameId === getActiveGame()) return;
        navigateToState({ game: gameId });
    });
    renderGameToggle();
}

// Refresh the active-button highlight to match the current game. Called
// after every game switch (including the initial boot and browser
// back/forward navigation across the toggle), so the highlight is
// always in sync with ``getActiveGame()``.
export function renderGameToggle() {
    if (!toggleMount || toggleMount.hidden) return;
    const active = getActiveGame();
    const buttons = toggleMount.querySelectorAll('.game-toggle-btn');
    for (const btn of buttons) {
        const isActive = btn.dataset.game === active;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
}
