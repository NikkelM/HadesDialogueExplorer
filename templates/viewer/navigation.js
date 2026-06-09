// URL-hash navigation between textlines. Selecting a textline updates
// all three panels (info, upstream, downstream) and pushes the name
// into ``window.location.hash`` so the URL is shareable.

import { renderInfo } from './info-panel.js';
import { renderUpstream, renderDownstream } from './tree-renderers.js';

// Tracks the name currently reflected in window.location.hash so the
// hashchange listener can skip the redundant re-render that fires when
// navigateTo itself sets the hash.
export let urlSelection = null;

export function selectTextline(name) {
    renderInfo(name);
    renderUpstream(name);
    renderDownstream(name);
}

export function navigateTo(name) {
    urlSelection = name;
    selectTextline(name);
    document.getElementById('search').value = name;
    window.location.hash = name;
}

// Read window.location.hash and sync the viewer to whatever name it
// points to. Used on initial load and on every browser back/forward.
export function applyHashFromUrl() {
    const hash = window.location.hash;
    // Normalise to ``null`` so an absent / freshly-cleared hash and the
    // initial ``urlSelection = null`` state compare equal, sparing the
    // redundant first-load clear and preventing ``urlSelection`` from
    // drifting between ``''`` and ``null`` across navigations.
    const name = (hash ? decodeURIComponent(hash.slice(1)) : '') || null;
    if (name === urlSelection) return;
    urlSelection = name;
    if (name) {
        selectTextline(name);
        document.getElementById('search').value = name;
    } else {
        // User cleared the hash (e.g. manually deleted ``#Foo`` from the
        // URL bar). Clear the panels so the previously-selected
        // textline's content doesn't linger as a stale "current
        // selection" the user can no longer link to via the URL.
        clearSelection();
    }
}

// Restore each panel and the search box to the same empty state the
// page starts in (mirrors the placeholder markup in
// ``templates/index.html``). Called by ``applyHashFromUrl`` when the
// location hash is removed so the viewer matches its first-load
// appearance rather than holding onto a stale selection.
export function clearSelection() {
    document.getElementById('info-content').innerHTML =
        '<div class="empty-state">Search for a textline to see its details</div>';
    document.getElementById('upstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see its prerequisites</div>';
    document.getElementById('downstream-content').innerHTML =
        '<div class="empty-state">Select a textline to see what depends on it</div>';
    document.getElementById('search').value = '';
}
