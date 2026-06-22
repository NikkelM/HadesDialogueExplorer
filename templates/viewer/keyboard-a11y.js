// Keyboard accessibility for the viewer's inline-``onclick`` controls.
//
// The viewer renders most of its navigational controls as ``<a onclick>`` /
// ``<span onclick>`` / ``<div onclick>`` without an ``href`` (speaker names,
// dialogue refs, requirement links, the duplicates game links, ...). Those are
// mouse-only by default: not reachable by Tab, and Enter / Space don't trigger
// them. Rather than make every one of the ~35 render sites opt in, a single
// delegated listener plus a MutationObserver upgrades them all:
//
//   * focusable - any ``[onclick]`` element that isn't already natively
//     interactive (a real <button>, <a href>, or form control) gets
//     ``tabindex="0"`` + ``role="button"`` so Tab reaches it and assistive tech
//     announces it as activatable;
//   * activatable - a document-level keydown maps Enter / Space on a focused
//     ``[onclick]`` element to a synthetic ``click()`` (the behaviour native
//     buttons get for free), preventing the default Space-scroll.
//
// Native controls (<button>, <a href>, inputs) are left untouched so the
// browser keeps handling them.

const _NATIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

function _isNativelyActivatable(el) {
    if (_NATIVE_TAGS.has(el.tagName)) return true;
    return el.tagName === 'A' && el.hasAttribute('href');
}

// Make a single onclick element focusable + button-semantic if it isn't
// already (and isn't natively interactive).
function _enhance(el) {
    if (_isNativelyActivatable(el)) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
}

// Enhance ``root`` and any ``[onclick]`` descendants it contains.
function _enhanceWithin(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute('onclick')) _enhance(root);
    const nested = root.querySelectorAll('[onclick]');
    for (const el of nested) _enhance(el);
}

export function initKeyboardA11y() {
    if (typeof document === 'undefined' || !document.body) return;

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        const el = e.target;
        if (!el || el.nodeType !== 1 || !el.hasAttribute('onclick')) return;
        if (_isNativelyActivatable(el)) return; // browser already handles these
        e.preventDefault(); // stop Space scrolling the page
        el.click();
    });

    // Stamp the controls present at load (header links, etc.) and everything
    // rendered later (panels re-render their innerHTML on navigation).
    _enhanceWithin(document.body);
    const obs = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const node of m.addedNodes) _enhanceWithin(node);
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}
