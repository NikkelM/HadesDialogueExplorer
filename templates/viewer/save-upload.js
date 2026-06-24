/**
 * Save file upload UI handler.
 * Wires the file input to the save parser and updates the status display.
 */

import {
    parseSaveFile,
    getSaveProgress,
    getSaveGameId,
    getSaveRuns,
    getSaveHasBiomesMod,
    saveMatchesActiveGame,
    validateSaveFilename,
    persistSaveProgress,
    restoreSaveProgress,
} from './save-parser.js';
import { gameLabels } from './data.js';

// A genuine ProfileX.sav is only a few MB; reject larger files outright rather
// than reading them into memory.
const MAX_SAVE_FILE_BYTES = 64 * 1024 * 1024;

export function initSaveUpload() {
    const input = document.getElementById('save-file-input');
    const status = document.getElementById('save-status');
    if (!input || !status) return;

    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!validateSaveFilename(file.name)) {
            showStatus('error', 'Invalid file: must be Profile1-4.sav');
            input.value = '';
            return;
        }

        // A real ProfileX.sav is a few MB at most; reject anything absurd
        // before reading the whole file into memory.
        if (file.size > MAX_SAVE_FILE_BYTES) {
            showStatus('error', 'Invalid file: too large to be a save');
            input.value = '';
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            parseSaveFile(buffer, file.name);
            // Status text + colour are derived from the parsed state, the same
            // as on a game switch, so the message stays in one place.
            refreshSaveStatus();
            // Cache the parsed save so it survives a page reload.
            persistSaveProgress(file.name);
            // Trigger re-render of current view to show badges
            window.dispatchEvent(new CustomEvent('save-loaded'));
        } catch (err) {
            console.error('Save parse error:', err);
            showStatus('error', `Parse error: ${err.message}`);
        }
        input.value = '';
    });

    // Keyboard activation. A ``<label for>`` opens the file picker on mouse
    // click but isn't reachable by keyboard; with the label made focusable
    // (role="button", tabindex=0) wire Enter / Space to trigger the hidden
    // input so keyboard and screen-reader users can load a save too.
    const trigger = document.querySelector('.save-upload-btn');
    if (trigger) {
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                input.click();
            }
        });
    }
}

// Re-hydrate a previously cached save on page load. Sets the in-memory
// state and the header status so a restored save is indistinguishable from a
// freshly loaded one. Called during init before the first render, so badges
// appear immediately without needing a ``save-loaded`` event. Returns true if
// a save was restored.
export function restoreSavedSave() {
    if (!restoreSaveProgress()) return false;
    refreshSaveStatus();
    return true;
}

function showStatus(type, text) {
    const status = document.getElementById('save-status');
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
    status.className = 'save-status save-' + type;
}

// Called by navigation when game switches to update mismatch state
export function refreshSaveStatus() {
    if (!getSaveProgress()) return;
    const gameId = getSaveGameId();
    const label = gameLabels[gameId] || gameId;
    const count = getSaveProgress().size;
    const runs = getSaveRuns();
    const moddedH2 = gameId === 'hades2' && getSaveHasBiomesMod();
    if (!saveMatchesActiveGame()) {
        // The save is for the other game (a vanilla H2 save carries no Hades 1
        // progress, so it doesn't apply under Hades 1).
        showStatus('mismatch', `${label} save - switch game to see progress`);
    } else if (moddedH2) {
        // A Hades II save with the Zagreus' Journey mod, which ports Hades 1
        // content into it so its progress applies under both games. The figures
        // describe the whole save (they aren't re-scoped per active game), so
        // show them identically in either view rather than silently dropping
        // runs on a game switch. Non-breaking spaces keep each "N unit" pair
        // together when the pill wraps.
        showStatus('loaded', `Hades II with Zagreus\u2019 Journey: ${count}\u00A0dialogues, ${runs}\u00A0runs`);
    } else {
        showStatus('loaded', `${label}: ${count}\u00A0dialogues, ${runs}\u00A0runs`);
    }
}
