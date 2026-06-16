// Data Layer.
//
// Owns every dataset-derived ``let`` so reads from any other module
// pick up the live binding after ``loadData(DATA)`` (called once at
// boot) and ``setActiveGame(gameId)`` (called on game toggle) mutate
// them.
//
// The viewer is strictly per-game: H1 and H2 are loaded as two
// entirely separate datasets stored under ``games[gameId]``. The
// per-binding ``let``s (``textlines``, ``dependents``, ``speakers``,
// ...) point at the currently-active game's blob; toggling games
// swaps every binding wholesale to the other game's blob in one go.
// No cross-game state ever coexists in the same binding.
//
// Two boot modes are supported by the concatenated script (see
// ``init.js``):
//   - Split build (GH Pages / local HTTP): ``fetch('data.json')``.
//   - Bundled single-file (release artifact, ``file://``): JSON is
//     inlined inside a ``<script type="application/json"
//     id="viewer-data">`` element and read via ``textContent``.

// Top-level multi-game registry, populated once by ``loadData``.
// ``games`` is the full {gameId: <full graph dataset>} map; ``gameIds``
// the ordered list (insertion order from the JSON, matching the
// build's preferred toggle order); ``gameLabels`` the display-label
// dict; ``defaultGame`` the build-time fallback when no ``game=`` URL
// hash key is present.
export let games, gameIds, gameLabels, defaultGame;

// Cross-game duplicate textline names. Populated once by ``loadData``
// from the top-level ``duplicates`` array in the JSON payload. Each
// entry is ``{name, hades1: {owner, section}, hades2: {owner, section}}``.
export let duplicates;

// Currently-active game id. ``null`` until ``setActiveGame`` is
// first called (during boot). Consumers MUST go through
// ``getActiveGame()`` rather than reading this binding directly, so
// the access pattern stays consistent with the swap-on-toggle
// semantics.
export let currentGame;

// Per-game bindings: every read from another module resolves against
// whichever game's blob ``setActiveGame`` last wired in. Initialised
// empty so unit tests that exercise pure helpers without a
// ``loadFixtureData`` call still get sane defaults.
export let textlines, dependents, speakers, stats;
export let knownUnresolved, unresolvedCategoryLabels, unresolvedCategoryDescriptions;
export let unresolvedRefBlocks;
export let reqTypeLabels, reqTypeEdgeLabels, reqTypeTooltips, reqTypeOrder;
export let reqTypeLabelsDependents, reqTypeTooltipsDependents;
export let sectionKeyLabels;
export let choiceNames;
export let metaUpgradeNames;
export let gameDataRefs;
export let namedRequirements;
export let allNames;

// Pre-built index for O(1) lookups when sorting tree children into
// per-type groups; falls back to a sentinel so unknown types sort last
// and keep a stable order amongst themselves. Initialised by
// ``setActiveGame`` from the active game's ``reqTypeOrder``.
export let _reqTypeOrderIndex;

// Backwards-compat single-game shape: if a caller passes a flat
// dataset (no ``games`` key) we treat it as the legacy single-game
// payload and wrap it under a synthetic ``"hades1"`` id. Lets old
// fixtures and ad-hoc tests keep working unchanged.
function _normalizePayload(DATA) {
    if (DATA && typeof DATA === 'object' && DATA.games) {
        return {
            games: DATA.games,
            gameIds: Object.keys(DATA.games),
            gameLabels: DATA.gameLabels || {},
            defaultGame: DATA.defaultGame || Object.keys(DATA.games)[0],
        };
    }
    return {
        games: { hades1: DATA || {} },
        gameIds: ['hades1'],
        gameLabels: { hades1: 'Hades' },
        defaultGame: 'hades1',
    };
}

// One-time boot. Populates the multi-game registry but does NOT pick
// an active game - the caller (``init.js``) decides which game to
// activate based on the URL hash, then calls ``setActiveGame``.
//
// Tests that don't care about the game toggle can call
// ``loadData(flatDATA)`` with a single-game blob; the registry will
// auto-wrap it and ``setActiveGame('hades1')`` will activate it.
export function loadData(DATA) {
    const norm = _normalizePayload(DATA);
    games = norm.games;
    gameIds = norm.gameIds;
    gameLabels = norm.gameLabels;
    defaultGame = norm.defaultGame;
    duplicates = (DATA && DATA.duplicates) || [];
    currentGame = null;
    // Single-game fixtures that don't call setActiveGame themselves
    // expect the per-binding state to be live after loadData returns,
    // so activate the default eagerly. Multi-game callers will
    // override this via setActiveGame(initialGame) immediately after.
    setActiveGame(defaultGame);
}

// Swap every per-game binding to the requested game's blob. Throws on
// an unknown id so a bug surfaces at the call site instead of
// silently presenting an empty viewer.
export function setActiveGame(gameId) {
    const gd = games && games[gameId];
    if (!gd) {
        throw new Error('Unknown game id: ' + gameId);
    }
    currentGame = gameId;
    textlines = gd.textlines || {};
    dependents = gd.dependents || {};
    speakers = gd.speakers || {};
    stats = gd.stats || {};
    knownUnresolved = gd.knownUnresolvedRefs || {};
    unresolvedCategoryLabels = gd.unresolvedCategoryLabels || {};
    unresolvedCategoryDescriptions = gd.unresolvedCategoryDescriptions || {};
    unresolvedRefBlocks = gd.unresolvedRefBlocks || {};
    reqTypeLabels = gd.reqTypeLabels || {};
    reqTypeEdgeLabels = gd.reqTypeEdgeLabels || {};
    reqTypeTooltips = gd.reqTypeTooltips || {};
    reqTypeOrder = gd.reqTypeOrder || [];
    reqTypeLabelsDependents = gd.reqTypeLabelsDependents || {};
    reqTypeTooltipsDependents = gd.reqTypeTooltipsDependents || {};
    sectionKeyLabels = gd.sectionKeyLabels || {};
    choiceNames = gd.choiceNames || {};
    metaUpgradeNames = gd.metaUpgradeNames || {};
    gameDataRefs = gd.gameDataRefs || {};
    namedRequirements = gd.namedRequirements || {};
    allNames = Object.keys(textlines).sort();

    _reqTypeOrderIndex = {};
    reqTypeOrder.forEach((t, i) => { _reqTypeOrderIndex[t] = i; });
}

// Returns the currently-active game id (``null`` before
// ``setActiveGame`` is first called).
export function getActiveGame() {
    return currentGame;
}

// Resolve a requested game id from a URL hash to a valid id. Unknown
// or missing ids fall back to ``defaultGame`` with a console warning
// so the viewer never lands in an unknown-game limbo state.
export function resolveGame(requested) {
    if (requested && games && games[requested]) {
        return requested;
    }
    if (requested) {
        console.warn('Unknown game id ' + JSON.stringify(requested) + '; falling back to ' + defaultGame);
    }
    return defaultGame;
}
