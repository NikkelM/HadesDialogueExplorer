// Floating help menu (FAB). The "?" toggle folds two action bubbles out upward
// - replay the tutorials and open the GitHub repo - and becomes an X while
// open. The DOM lives in index.html; this only wires the open/close behaviour.
// The replay action is injected (``onReplay``) so the menu stays independent of
// the tour engine.
export function initFabMenu(onReplay) {
    const menu = document.getElementById('fab-menu');
    const toggle = document.getElementById('tour-help');
    if (!menu || !toggle) return;
    const actions = menu.querySelectorAll('.fab-action');

    // Geometry-centred SVGs (not text glyphs, which carry font side-bearings and
    // render a hair off-centre): a question mark when closed, an X when open.
    const ICON_HELP = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    const isOpen = () => menu.classList.contains('open');
    const setOpen = (open) => {
        menu.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.innerHTML = open ? ICON_CLOSE : ICON_HELP;
        toggle.setAttribute('aria-label', open ? 'Close help menu' : 'Open help menu');
        toggle.dataset.tooltip = open ? 'Close menu' : 'Help & links';
        // Only the visible bubbles are tab-reachable.
        actions.forEach(a => a.setAttribute('tabindex', open ? '0' : '-1'));
    };

    toggle.addEventListener('click', (e) => {
        // Stop the document listener below from immediately re-closing it.
        e.stopPropagation();
        setOpen(!isOpen());
    });

    const tourBtn = document.getElementById('fab-tour');
    if (tourBtn) {
        tourBtn.addEventListener('click', () => {
            setOpen(false);
            if (typeof onReplay === 'function') onReplay();
        });
    }
    // The GitHub bubble is a real link (opens in a new tab); just close after.
    const github = document.getElementById('fab-github');
    if (github) github.addEventListener('click', () => setOpen(false));

    // Dismiss on an outside click or Escape.
    document.addEventListener('click', (e) => {
        if (isOpen() && !menu.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            setOpen(false);
            toggle.focus();
        }
    });
}
