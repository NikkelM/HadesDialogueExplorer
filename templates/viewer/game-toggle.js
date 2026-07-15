// Game toggle UI: two side-by-side buttons in the page header that
// swap the viewer's active game (Hades / Hades II). A click hands off
// to ``switchGameRestoringDialogue``: from a dialogue view it reopens
// the target game's last-viewed dialogue (or the empty view), and from
// any other view (speaker / duplicates / eligibility) it carries the
// current selection across, letting the viewer's not-found handling
// cover an entity the other game lacks.

import { gameIds, gameLabels, getActiveGame } from './data.js';
import { switchGameRestoringDialogue } from './navigation.js';
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
                '<button type="button" class="game-toggle-btn" aria-pressed="false" data-game="'
                + escapeHtml(gid) + '">' + escapeHtml(label) + '</button>'
            );
        }).join('');
    }
    toggleMount.addEventListener('click', (e) => {
        const btn = e.target.closest('.game-toggle-btn');
        if (!btn || !toggleMount.contains(btn)) return;
        const gameId = btn.dataset.game;
        if (!gameId || gameId === getActiveGame()) return;
        switchGameRestoringDialogue(gameId);
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
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
}

// Swap the page favicon to the active game's icon. The ``<link
// rel="icon" id="favicon">`` carries one ``data-<gameId>`` attribute per
// game (a file path in the split build, an inlined data URI in the
// single-file bundle), so this stays build-agnostic. No-op when the
// element or the game's attribute is missing.
export function updateFavicon(gameId) {
    const link = document.getElementById('favicon');
    if (!link) return;
    const href = link.getAttribute('data-' + gameId);
    if (href && link.getAttribute('href') !== href) {
        link.setAttribute('href', href);
    }
}
