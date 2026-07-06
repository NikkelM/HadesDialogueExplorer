// Desktop scroll-shadow affordance for the horizontally scrollable
// prerequisite / dependent trees.
//
// Deep dependency chains make tree rows wider than their column, so the far
// side gets clipped at the panel edge with no hint that scrolling sideways
// reveals more. The visual fade itself lives in panels.css as an on-top
// overlay (``.panel::before`` / ``::after``); it can't be a plain CSS
// ``background`` on the scroll box because a background paints behind the
// panel's own children, so opaque badges / priority pills at the clipped edge
// would hide it. This module supplies the only thing CSS can't compute on its
// own - whether there is more content to scroll to in each direction - by
// toggling the ``can-scroll-left`` / ``can-scroll-right`` classes that reveal
// each edge's fade.
//
// The overlay CSS is scoped to the desktop dialogue layout, so toggling the
// classes on mobile (where the panels stack) is a harmless no-op; we keep the
// logic unconditional to avoid a matchMedia dance and stay correct across
// breakpoint changes.

const CONTENT_IDS = ['upstream-content', 'downstream-content'];

// Reflect ``content``'s horizontal scroll position onto its panel as the
// ``can-scroll-*`` classes. The 1px slack absorbs sub-pixel rounding so the
// far edge's fade reliably clears at the very end of the scroll range. When
// there is no horizontal overflow (or the panel is collapsed / hidden, giving a
// zero client width) both classes come off and neither fade shows.
export function updateTreeScrollShadow(content) {
    if (!content) return;
    const panel = typeof content.closest === 'function' ? content.closest('.panel') : null;
    if (!panel || !panel.classList) return;
    const max = content.scrollWidth - content.clientWidth;
    const x = content.scrollLeft;
    panel.classList.toggle('can-scroll-left', x > 1);
    panel.classList.toggle('can-scroll-right', x < max - 1);
}

// Wire the scroll-shadow class toggling for both tree panels. Safe to call once
// at boot; no-ops under the test DOM stub (no ``getElementById``).
export function initTreeScrollShadow() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;

    for (const id of CONTENT_IDS) {
        const content = document.getElementById(id);
        if (!content || typeof content.addEventListener !== 'function') continue;

        const update = () => updateTreeScrollShadow(content);

        content.addEventListener('scroll', update, { passive: true });

        // ``clientWidth`` changes: dragging the column resizer, window resize.
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(update).observe(content);
        }

        // ``scrollWidth`` changes without a scroll or resize event: expanding /
        // collapsing tree nodes, or a new dialogue re-rendering the panel.
        // Coalesce the burst of mutations a re-render fires into a single
        // measure on the next frame.
        if (typeof MutationObserver !== 'undefined') {
            const raf = (typeof requestAnimationFrame === 'function')
                ? requestAnimationFrame
                : (fn) => setTimeout(fn, 0);
            let pending = false;
            const mo = new MutationObserver(() => {
                if (pending) return;
                pending = true;
                raf(() => { pending = false; update(); });
            });
            mo.observe(content, { childList: true, subtree: true });
        }

        update();
    }
}
