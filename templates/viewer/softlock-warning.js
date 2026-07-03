// Softlock-warning modal.
//
// Surfaces the known Hades II story-softlock (see ``detectH2Softlock`` in
// save-parser.js) as a dismissible popup when such a save is loaded. Purely a
// warning + a pointer to the community fix mod; it never touches the save.

import { navigateToState } from './navigation.js';

const SAVE_SAVER_URL = 'https://thunderstore.io/c/hades-ii/p/ReadEmAndWeep/Save_Saver/';

// The Hades II dialogue whose absence (alongside the Gigaros item) defines the
// softlock; the popup links straight to it.
const SOFTLOCK_DIALOGUE = 'ZagreusPastMeeting06';

// Guard so a single load can't stack duplicate modals (restore + a re-render
// both calling in), and so dismissing it keeps it closed for the session.
let _open = false;

// Show the softlock warning modal. No-op if one is already open. The modal is a
// simple overlay + card with a dismiss button, a link to the offending
// dialogue (which opens it and closes the modal), and an outbound link to the
// fix mod; Escape and a click on the backdrop also close it.
export function showSoftlockWarning() {
    if (_open) return;
    if (typeof document === 'undefined' || !document.body) return;
    _open = true;

    const overlay = document.createElement('div');
    overlay.className = 'softlock-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'softlock-title');

    const card = document.createElement('div');
    card.className = 'softlock-card';
    card.innerHTML =
        `<h2 id="softlock-title" class="softlock-title">\u26A0 Possible story softlock detected</h2>`
        + `<p>This Hades II save has <strong>Gigaros</strong> (Hades\u2019 spear) in the `
        + `inventory, but the dialogue that normally grants it `
        + `(<a class="softlock-dialogue-link" href="#" role="button">${SOFTLOCK_DIALOGUE}</a>) `
        + `hasn\u2019t played. This can happen if you've used a mod or save editor and granted yourself `
        + `this resource manually, and it can <strong>soft-lock further story progress</strong>.</p>`
        + `<p>The <a class="softlock-link" href="${SAVE_SAVER_URL}" `
        + `target="_blank" rel="noopener noreferrer">Save Saver</a> mod can help repair this, `
        + `by allowing you to use the fountain to reset all story progress.</p>`
        + `<div class="softlock-actions">`
        + `<button type="button" class="softlock-dismiss">Dismiss</button>`
        + `</div>`;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => {
        if (!overlay.parentNode) return;
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    card.querySelector('.softlock-dismiss').addEventListener('click', close);
    // The dialogue link opens the dialogue (always the Hades II one, switching
    // game if needed) and dismisses the popup in the same click.
    card.querySelector('.softlock-dialogue-link').addEventListener('click', (e) => {
        e.preventDefault();
        close();
        navigateToState({ game: 'hades2', view: 'dialogue', dialogue: SOFTLOCK_DIALOGUE });
    });
    document.addEventListener('keydown', onKey);

    // Move focus to the dismiss button so keyboard / screen-reader users land
    // inside the dialog.
    const dismiss = card.querySelector('.softlock-dismiss');
    if (dismiss && dismiss.focus) dismiss.focus();
}

