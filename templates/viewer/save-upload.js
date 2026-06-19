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
            const result = parseSaveFile(buffer);
            const label = gameLabels[result.gameId] || result.gameId;
            const short = `${label} save loaded`;

            // H2 saves are valid for both games (mod ports H1 dialogues into H2)
            if (result.gameId !== getActiveGame() && result.gameId !== 'hades2') {
                showStatus('mismatch',
                    `${label} save (${result.count} dialogues) - switch game to see progress`,
                    short);
            } else {
                showStatus('loaded',
                    `${label}: ${result.count} dialogues, ${result.completedRuns} runs`,
                    short);
            }
            clearBtn.hidden = false;
            setEligibilityNavVisible(true);
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
        setEligibilityNavVisible(false);
        window.dispatchEvent(new CustomEvent('save-cleared'));
    });
}

// Re-hydrate a previously cached save on page load. Sets the in-memory
// state and the header chrome (status, clear button, eligibility nav) so
// a restored save is indistinguishable from a freshly loaded one. Called
// during init before the first render, so badges appear immediately
// without needing a ``save-loaded`` event. Returns true if a save was
// restored.
export function restoreSavedSave() {
    if (!restoreSaveProgress()) return false;
    const clearBtn = document.getElementById('save-clear');
    if (clearBtn) clearBtn.hidden = false;
    setEligibilityNavVisible(true);
    refreshSaveStatus();
    return true;
}

function showStatus(type, text, shortText) {
    const status = document.getElementById('save-status');
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
    status.className = 'save-status save-' + type;
    // A compact "<game> save loaded" label for the phone header, where the
    // full text overflows. CSS swaps it in via attr(data-short) under the
    // mobile breakpoint; desktop ignores it and shows textContent. Cleared
    // for statuses without a short form (e.g. errors) so they stay full.
    if (shortText) status.dataset.short = shortText;
    else delete status.dataset.short;
}

// Called by navigation when game switches to update mismatch state
export function refreshSaveStatus() {
    if (!getSaveProgress()) return;
    const gameId = getSaveGameId();
    const label = gameLabels[gameId] || gameId;
    const count = getSaveProgress().size;
    const runs = getSaveRuns();
    const short = `${label} save loaded`;
    // H2 saves are valid for both games (mod ports H1 dialogues into H2)
    if (gameId !== getActiveGame() && gameId !== 'hades2') {
        showStatus('mismatch',
            `${label} save (${count} dialogues) - switch game to see progress`,
            short);
    } else {
        showStatus('loaded', `${label}: ${count} dialogues, ${runs} runs`, short);
    }
}

function setEligibilityNavVisible(visible) {
    const el = document.getElementById('nav-eligibility');
    if (el) el.hidden = !visible;
}
