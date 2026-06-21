/**
 * Save file upload UI handler.
 * Wires the file input to the save parser and updates the status display.
 */

import {
    parseSaveFile,
    clearSaveProgress,
    getSaveProgress,
    getSaveGameId,
    getSaveRuns,
    getSaveHasBiomesMod,
    saveMatchesActiveGame,
    validateSaveFilename,
    persistSaveProgress,
    restoreSaveProgress,
    clearPersistedSave,
} from './save-parser.js';
import { getActiveGame, gameLabels } from './data.js';

export function initSaveUpload() {
    const input = document.getElementById('save-file-input');
    const status = document.getElementById('save-status');
    const clearBtn = document.getElementById('save-clear');
    if (!input || !status || !clearBtn) return;

    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!validateSaveFilename(file.name)) {
            showStatus('error', 'Invalid file: must be Profile1-4.sav');
            input.value = '';
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            parseSaveFile(buffer);
            clearBtn.hidden = false;
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

    clearBtn.addEventListener('click', () => {
        clearSaveProgress();
        clearPersistedSave();
        status.hidden = true;
        clearBtn.hidden = true;
        window.dispatchEvent(new CustomEvent('save-cleared'));
    });
}

// Re-hydrate a previously cached save on page load. Sets the in-memory
// state and the header chrome (status, clear button) so a restored save is
// indistinguishable from a freshly loaded one. Called during init before the
// first render, so badges appear immediately without needing a ``save-loaded``
// event. Returns true if a save was restored.
export function restoreSavedSave() {
    if (!restoreSaveProgress()) return false;
    const clearBtn = document.getElementById('save-clear');
    if (clearBtn) clearBtn.hidden = false;
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
    if (!saveMatchesActiveGame()) {
        // The save is for the other game (a vanilla H2 save carries no Hades 1
        // progress, so it doesn't apply under Hades 1).
        showStatus('mismatch', `${label} save - switch game to see progress`);
    } else if (gameId === 'hades2' && getActiveGame() === 'hades1' && getSaveHasBiomesMod()) {
        // A Hades II save shown under Hades 1 via the Zagreus' Journey mod -
        // flag the mod since that's what makes the cross-game progress apply.
        showStatus('loaded', `Hades II with Zagreus\u2019 Journey: ${count} dialogues`);
    } else {
        showStatus('loaded', `${label}: ${count} dialogues, ${runs} runs`);
    }
}
