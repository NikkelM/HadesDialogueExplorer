// Header stats line above the search bar.

import { stats } from './data.js';

export function initStats() {
    const el = document.getElementById('stats');
    const byCat = stats.unresolvedByCategory || {};
    const uncategorizedCount = byCat.uncategorized || 0;

    let txt =
        `${stats.totalSpeakers} speakers \u00B7 ${stats.totalTextlines} textlines \u00B7 ${stats.totalEdges} relationships`;

    if (uncategorizedCount > 0) {
        txt += ` \u00B7 ${uncategorizedCount} external refs`;
    }
    el.textContent = txt;
}
