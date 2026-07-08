// Mobile dialogue-view accordion.
//
// On desktop the three dialogue panels (Details / Prerequisites / Dependents)
// sit side by side, so content growth in one never moves the others. On mobile
// they stack vertically (see the responsive.css foundation), which made the
// tall Dependents tree get shoved down as the Details + Prerequisites content
// streamed in on load - a large Cumulative Layout Shift (0.382 on Lighthouse
// mobile, all attributed to ``#panel-downstream``).
//
// This turns the stacked panels into an accordion: each panel's ``<h2>``
// heading toggles its body, and only Details is open on first paint (the CSS
// default keys off the ``acc-open`` class ``#panel-info`` carries in the static
// markup; the other two start collapsed). With the heavy trees collapsed to
// just their headers on load, only thin headers can shift, so the CLS stays
// small; expanding a panel also gives it the full page width, which relieves
// the tree / requirement-group horizontal overflow.
//
// Scoped to mobile via ``matchMedia`` + the ``body.layout-dialogue`` layout (the
// CSS rules live under a max-width media query and that body class), so the
// single-panel speaker / duplicates / eligibility views and the desktop
// side-by-side columns are untouched.

// Mirror the responsive.css ``tablet`` breakpoint (documented there as the
// single source of truth). CSS media queries can't read custom properties, so
// the value is repeated as a literal in both places.
const MOBILE_QUERY = '(max-width: 1024px)';
const PANEL_IDS = ['panel-info', 'panel-upstream', 'panel-downstream'];

// Wire the three dialogue panels as a mobile accordion. Idempotent-ish: safe to
// call once at boot. No-ops under the test DOM stub (no ``matchMedia`` /
// ``querySelector``) and off the dialogue layout.
export function initMobileAccordion() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const mql = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
        ? window.matchMedia(MOBILE_QUERY)
        : null;
    const panels = PANEL_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    if (panels.length === 0) return;

    const isMobile = () => (mql ? mql.matches : false);

    const toggle = (panel) => {
        const open = panel.classList.toggle('acc-open');
        const h2 = panel.querySelector('h2');
        if (h2) h2.setAttribute('aria-expanded', String(open));
    };

    // Wire click / keyboard once. The handlers are gated on ``isMobile()`` so a
    // stray click on a desktop heading (where the accordion CSS is inert) does
    // nothing - the ``acc-open`` class only has a visual effect under the mobile
    // media query.
    for (const panel of panels) {
        const h2 = panel.querySelector('h2');
        if (!h2) continue;
        h2.addEventListener('click', () => { if (isMobile()) toggle(panel); });
        h2.addEventListener('keydown', (e) => {
            if (!isMobile()) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                toggle(panel);
            }
        });
    }

    // Reflect the current mode onto the headings: on mobile they become toggle
    // buttons (role + focusability + expanded state); on desktop the accordion
    // semantics are removed so the headings read as plain headings again. Also
    // clears any inline ``display`` the desktop column-collapse logic
    // (resize-panels.js / the pre-paint script in index.html) may have set on a
    // body - an inline ``display:none !important`` would otherwise beat the
    // accordion's CSS and wedge a panel shut with no way to reopen it on mobile.
    const sync = () => {
        const mobile = isMobile();
        for (const panel of panels) {
            const h2 = panel.querySelector('h2');
            if (!h2) continue;
            if (mobile) {
                const body = panel.querySelector('.panel-body');
                if (body && body.style) body.style.removeProperty('display');
                h2.setAttribute('role', 'button');
                h2.setAttribute('tabindex', '0');
                h2.setAttribute('aria-expanded', String(panel.classList.contains('acc-open')));
            } else {
                h2.removeAttribute('role');
                h2.removeAttribute('tabindex');
                h2.removeAttribute('aria-expanded');
            }
        }
    };

    sync();
    if (mql) {
        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', sync);
        else if (typeof mql.addListener === 'function') mql.addListener(sync); // Safari < 14
    }
}
