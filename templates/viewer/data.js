// Data Layer.
//
// Owns every dataset-derived ``let`` so reads from any other module
// pick up the live binding after ``loadData(DATA)`` mutates them. The
// loader is called once from ``init.js`` during ``init()`` before
// any rendering happens.
//
// Two boot modes are supported by the concatenated script (see
// ``init.js``):
//   - Split build (GH Pages / local HTTP): ``fetch('data.json')``.
//   - Bundled single-file (release artifact, ``file://``): JSON is
//     inlined inside a ``<script type="application/json"
//     id="viewer-data">`` element and read via ``textContent``.

export let textlines, dependents, speakers, stats;
export let knownUnresolved, unresolvedCategoryLabels, unresolvedCategoryDescriptions;
export let unresolvedRefBlocks;
export let reqTypeLabels, reqTypeEdgeLabels, reqTypeTooltips, reqTypeOrder;
export let sectionKeyLabels;
export let allNames;

// Pre-built index for O(1) lookups when sorting tree children into
// per-type groups; falls back to a sentinel so unknown types sort last
// and keep a stable order amongst themselves. Initialised inside
// ``loadData`` once ``reqTypeOrder`` is populated.
export let _reqTypeOrderIndex;

export function loadData(DATA) {
    textlines = DATA.textlines;
    dependents = DATA.dependents;
    speakers = DATA.speakers || {};
    stats = DATA.stats;
    knownUnresolved = DATA.knownUnresolvedRefs || {};
    unresolvedCategoryLabels = DATA.unresolvedCategoryLabels || {};
    unresolvedCategoryDescriptions = DATA.unresolvedCategoryDescriptions || {};
    unresolvedRefBlocks = DATA.unresolvedRefBlocks || {};
    reqTypeLabels = DATA.reqTypeLabels || {};
    reqTypeEdgeLabels = DATA.reqTypeEdgeLabels || {};
    reqTypeTooltips = DATA.reqTypeTooltips || {};
    reqTypeOrder = DATA.reqTypeOrder || [];
    sectionKeyLabels = DATA.sectionKeyLabels || {};
    allNames = Object.keys(DATA.textlines).sort();

    _reqTypeOrderIndex = {};
    reqTypeOrder.forEach((t, i) => { _reqTypeOrderIndex[t] = i; });
}
