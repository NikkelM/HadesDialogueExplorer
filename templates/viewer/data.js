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
export let games, gameIds, gameLabels, defaultGame, defaultDialogue;

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
export let textlines, dependents, alternates, speakers, stats;
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
        const ids = Array.isArray(DATA.gameIds) && DATA.gameIds.length
            ? DATA.gameIds
            : Object.keys(DATA.games);
        return {
            games: DATA.games,
            gameIds: ids,
            gameLabels: DATA.gameLabels || {},
            defaultGame: DATA.defaultGame || ids[0],
            defaultDialogue: DATA.defaultDialogue || {},
        };
    }
    return {
        games: { hades1: DATA || {} },
        gameIds: ['hades1'],
        gameLabels: { hades1: 'Hades' },
        defaultGame: 'hades1',
        defaultDialogue: {},
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
    defaultDialogue = norm.defaultDialogue;
    duplicates = (DATA && DATA.duplicates) || [];
    currentGame = null;
    // Activate a game whose blob is actually present. In the full-payload and
    // single-game-fixture cases the default game is always loaded, so this is
    // just ``setActiveGame(defaultGame)``. In the split build's progressive
    // boot only the initially-requested game's blob has arrived (the others
    // stream in afterwards via ``registerGameData``), and that game may not be
    // the default - so fall back to the first loaded game. Multi-game callers
    // re-activate the URL's game via ``setActiveGame`` immediately after.
    const activate = isGameLoaded(defaultGame)
        ? defaultGame
        : gameIds.find((g) => isGameLoaded(g));
    if (activate) setActiveGame(activate);
}

// --- Progressive (split-build) game loading ------------------------
//
// The split/web build streams the active game's data first to unblock
// interactivity, then loads the remaining game(s) in the background so a later
// toggle is instant. These helpers let the boot code register the freshly
// fetched blobs and let navigation await a not-yet-arrived game. The single
// inline bundle ships every game at once, so none of this fires there.

// In-flight per-game load promises, parked here so concurrent requests reuse a
// single fetch and so a toggle / cross-game link that fires before a load
// finishes can await it instead of erroring on a missing blob.
const _pendingGameLoads = {};

// How to fetch + install a game's data blob (split build). Registered by the
// boot code, which owns the fetch URL + cache-busting. Receives a gameId and
// returns a promise that resolves once the blob has been handed to
// ``registerGameData`` (it may reject on a network / parse failure).
let _gameLoader = null;

export function setGameLoader(fn) {
    _gameLoader = (typeof fn === 'function') ? fn : null;
}

// True once the game's data blob is present (has its textlines map).
export function isGameLoaded(gameId) {
    return !!(games && games[gameId] && games[gameId].textlines);
}

// Start (or reuse) a load for a game; resolves to whether it is now loaded.
// Never rejects. A failed attempt clears its slot so a later call retries -
// so a toggle to a game whose background preload failed re-fetches on demand
// instead of silently doing nothing.
function _loadGame(gameId) {
    if (isGameLoaded(gameId)) return Promise.resolve(true);
    if (_pendingGameLoads[gameId]) return _pendingGameLoads[gameId];
    if (!_gameLoader) return Promise.resolve(false);
    const pr = Promise.resolve()
        .then(() => _gameLoader(gameId))
        .then(() => isGameLoaded(gameId))
        .catch(() => false);
    _pendingGameLoads[gameId] = pr;
    // Drop a failed attempt's slot so a subsequent request can retry. (A
    // success clears it via registerGameData.)
    pr.then((ok) => { if (!ok && _pendingGameLoads[gameId] === pr) delete _pendingGameLoads[gameId]; });
    return pr;
}

// Kick off a background load of a not-yet-active game (boot). Same machinery
// as the on-demand ``ensureGameLoaded`` so a click during the window reuses it.
export function preloadGame(gameId) {
    return _loadGame(gameId);
}

// Resolve once the game's data is available - loading or retrying on demand.
// Resolves ``false`` when it can't be loaded (no loader, or the fetch keeps
// failing) so the caller can surface that rather than throwing on a missing
// blob.
export function ensureGameLoaded(gameId) {
    return _loadGame(gameId);
}

// Merge a fetched game blob into the registry. Idempotent.
export function registerGameData(gameId, blob) {
    if (!games) games = {};
    games[gameId] = blob;
    delete _pendingGameLoads[gameId];
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
    alternates = gd.alternates || {};
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

// The build-time "featured" dialogue for the active game - shown on the
// home / empty state (no ``dialogue=`` in the URL) and used as the
// anchor for the onboarding tour. Returns null when none is configured
// or the configured name isn't present in the active game's data.
export function getDefaultDialogue() {
    const name = (currentGame && defaultDialogue) ? defaultDialogue[currentGame] : null;
    return (name && textlines && textlines[name]) ? name : null;
}

// Resolve a requested game id from a URL hash to a valid id. Unknown
// or missing ids fall back to ``defaultGame`` with a console warning
// so the viewer never lands in an unknown-game limbo state. Validates
// against the known ``gameIds`` (not the loaded blobs) so a deep link to
// a game whose data is still streaming in (split build) resolves to that
// game rather than the default.
export function resolveGame(requested) {
    if (requested && Array.isArray(gameIds) && gameIds.includes(requested)) {
        return requested;
    }
    if (requested) {
        console.warn('Unknown game id ' + JSON.stringify(requested) + '; falling back to ' + defaultGame);
    }
    return defaultGame;
}
