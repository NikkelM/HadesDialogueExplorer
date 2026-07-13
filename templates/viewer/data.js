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

// --- Dialogue localisation state -----------------------------------
//
// Dialogue text, choice labels and speaker names can be shown in any of the
// languages the games ship (English is the inline default). ``languages`` is
// the per-game picker manifest ``{game: [{code,label}]}`` from the meta; the
// active selection is ``currentLang`` (``'en'`` = the inline default, no
// overlay). ``locText`` maps an id (cue / offer-text / choice-label) to its
// translation for the active game+language; ``locSpeakers`` maps a speaker id
// to its localised ``{name, description}``. Both are ``{}`` under English.
//
// Split build: each ``loc-<game>-<lang>.json`` is lazy-fetched on first use.
// Bundle: the selected languages are inlined in the payload's ``localization``
// and pre-registered at boot. English needs neither - it is already inline.
export let languages = {};
export let currentLang = 'en';
export let locText = {};
export let locSpeakers = {};

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
export let entityNames;
export let pathScopeNames, pathFieldNames, pathObjectFields, pathFieldLeafNames, pathLiteralLeafFields, brokenPathRefs, brokenReqFields;
export let badgeRankNames, badgeRankManager;
export let cueTexts;
export let gameDataRefs;
export let namedRequirements;
export let godTraitNames;
export let restrictBoonChoiceTraitNames;
// Hades 1 static save-eval tables (see src/extractors/hades1/save_eval_data.py):
// { metaUpgradeOrderLength, shrineUpgradeOrder, strikeThroughChangeValue,
//   weaponUpgradeSlots, cosmeticVisibleValue }. Empty {} for H2.
export let h1SaveEvalStatic;
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
    languages = (DATA && DATA.languages) || {};
    // A fresh load resets the localisation registry + live overlay bindings so
    // stale language maps from a previous dataset can't leak in.
    _resetLocalizations();
    // Bundle build inlines the selected languages under ``localization``
    // (``{game: {lang: {text, speakers}}}``); pre-register them so no fetch is
    // needed offline. The split build omits this key and lazy-fetches instead.
    if (DATA && DATA.localization) {
        for (const g in DATA.localization) {
            for (const l in DATA.localization[g]) {
                registerLocData(g, l, DATA.localization[g][l]);
            }
        }
    }
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

// Subscribers notified when a game's data blob becomes available (the
// split build streams the non-active game(s) in after boot). Lets the
// search UI refresh its cross-game sections once the other game's data
// arrives, so a search run during the load window isn't stuck showing no
// cross-game matches until the query is edited.
const _gameDataListeners = [];

export function onGameData(fn) {
    if (typeof fn === 'function') _gameDataListeners.push(fn);
}

// Merge a fetched game blob into the registry. Idempotent.
export function registerGameData(gameId, blob) {
    if (!games) games = {};
    games[gameId] = blob;
    delete _pendingGameLoads[gameId];
    for (const fn of _gameDataListeners) {
        try { fn(gameId); } catch { /* a listener must not break data loading */ }
    }
}

// --- Dialogue localisation registry + lazy loading -----------------
//
// Mirrors the per-game load machinery above. ``_localizations`` holds
// ``{game: {lang: {text, speakers}}}``; split-build language maps are fetched
// on demand via ``_locLoader`` (set by the boot code), bundle maps are
// pre-registered from the inline payload. English is never stored - it is the
// inline default.
const _localizations = {};
const _pendingLocLoads = {};
let _locLoader = null;

// Clear the localisation registry + reset the active-language state. Called by
// ``loadData`` so a fresh dataset starts from a clean slate (English default).
function _resetLocalizations() {
    for (const k in _localizations) delete _localizations[k];
    for (const k in _pendingLocLoads) delete _pendingLocLoads[k];
    currentLang = 'en';
    locText = {};
    locSpeakers = {};
}

export function setLocLoader(fn) {
    _locLoader = (typeof fn === 'function') ? fn : null;
}

// Install a fetched (or inlined) language map. Idempotent.
export function registerLocData(game, lang, blob) {
    if (!_localizations[game]) _localizations[game] = {};
    _localizations[game][lang] = blob || { text: {}, speakers: {} };
    delete _pendingLocLoads[game + ':' + lang];
    // If this is the language currently being shown for the active game, wire
    // it into the live bindings so an in-flight selection takes effect.
    if (game === currentGame && lang === currentLang) _applyLocalization();
}

// True once a language map is available for a game (English is always ready:
// it is the inline default with no overlay).
export function isLangLoaded(game, lang) {
    return lang === 'en' || !!(_localizations[game] && _localizations[game][lang]);
}

// The registered localisation blob for a game+language, or null. Boot uses this
// to carry a language it preloaded (before ``loadData``) into the payload's
// ``localization`` so ``loadData``'s ``_resetLocalizations`` doesn't drop it and
// force a redundant re-fetch. English has no blob (inline default).
export function getLocData(game, lang) {
    return (_localizations[game] && _localizations[game][lang]) || null;
}

// Start (or reuse) a language-map load; resolves to whether it is now loaded.
// Never rejects - a failed fetch clears its slot so a later retry re-fetches.
export function ensureLangLoaded(game, lang) {
    if (isLangLoaded(game, lang)) return Promise.resolve(true);
    const key = game + ':' + lang;
    if (_pendingLocLoads[key]) return _pendingLocLoads[key];
    if (!_locLoader) return Promise.resolve(false);
    const pr = Promise.resolve()
        .then(() => _locLoader(game, lang))
        .then(() => isLangLoaded(game, lang))
        .catch(() => false);
    _pendingLocLoads[key] = pr;
    pr.then((ok) => { if (!ok && _pendingLocLoads[key] === pr) delete _pendingLocLoads[key]; });
    return pr;
}

// The picker manifest for the active game (defaults to English-only).
export function getAvailableLanguages() {
    return (languages && languages[currentGame]) || [{ code: 'en', label: 'English' }];
}

// Background-warm the loc map of ``lang`` for every game that offers it and
// hasn't loaded it yet, skipping ``exceptGame`` (typically the active game,
// whose map loads on the normal path). Fire-and-forget and deduped via
// ``ensureLangLoaded``'s in-flight tracking, so a game switch that fires
// mid-flight simply awaits the same promise instead of flashing English then
// swapping to the language once its map arrives. No-op for English (the inline
// default) or when no loader is set (the bundle build inlines every map).
export function warmLangForGames(lang, exceptGame) {
    if (!lang || lang === 'en' || !_locLoader) return;
    for (const g in languages) {
        if (g === exceptGame) continue;
        if (!(languages[g] || []).some((l) => l.code === lang)) continue;
        if (!isLangLoaded(g, lang)) ensureLangLoaded(g, lang);
    }
}

export function getActiveLang() {
    return currentLang;
}

// True when a non-English language is active (so render code should localise).
export function isLocalized() {
    return currentLang !== 'en';
}

// Localized display name for a speaker id in a SPECIFIC game (which may differ
// from the active game). Returns null under English, when that game's loc map
// isn't loaded, or when the id has no translation. Used by cross-game surfaces
// (the duplicates view) that render a speaker owned in a game that may not be
// active; same-game display uses the overlaid ``speakers`` map instead. The
// active game reads the live ``locSpeakers`` binding; another game reads its
// registered map via ``getLocData``.
export function localizedSpeakerName(game, speakerId) {
    if (currentLang === 'en' || !game || !speakerId) return null;
    const spk = (game === currentGame) ? locSpeakers : (getLocData(game, currentLang) || {}).speakers;
    const tr = spk && spk[speakerId];
    return (tr && tr.name) || null;
}

// Wire the active game+language localisation into the live bindings:
// ``locText`` / ``locSpeakers`` for render-time lookups, and an overlaid
// ``speakers`` map so every existing ``speakers[id].name`` read shows the
// localised character name (and description) without per-call-site changes.
// Reverts to the base (English) speakers under English or a missing map.
function _applyLocalization() {
    const loc = (currentLang !== 'en' && _localizations[currentGame])
        ? _localizations[currentGame][currentLang]
        : null;
    locText = (loc && loc.text) || {};
    locSpeakers = (loc && loc.speakers) || {};
    const base = (games && games[currentGame] && games[currentGame].speakers) || {};
    if (currentLang === 'en' || !loc) {
        speakers = base;
        return;
    }
    const overlaid = {};
    for (const id in base) {
        const tr = locSpeakers[id];
        overlaid[id] = tr ? { ...base[id], ...tr } : base[id];
    }
    speakers = overlaid;
}

// Set the active language and re-apply the localisation overlay. The caller
// persists the choice and triggers a re-render; the map must already be loaded
// (via ``ensureLangLoaded``) for a non-English language to actually show.
export function setActiveLang(lang) {
    currentLang = lang || 'en';
    _applyLocalization();
}

// Translated text for an id (cue / offer-text / choice-label), or ``fallback``
// (the English text) when English is active or the id has no usable translation.
// A translation that cleaned to an empty string (some shipped subtitles are
// blank / pure-markup in a given language) counts as "no translation": it
// falls back to English rather than rendering an empty line.
export function localizeText(id, fallback) {
    if (currentLang === 'en' || !id) return fallback;
    const t = locText[id];
    return (typeof t === 'string' && t !== '') ? t : fallback;
}

// True when a non-English language is active but the given id has no usable
// translation (a dev-comment-only line, a cue with no shipped subtitle, or a
// subtitle that is blank in this language), so the viewer can mark the
// English-fallback line. A line with no id at all (pure inline narration /
// choice prompt) is also untranslated. Kept in lock-step with ``localizeText``
// so a line is flagged EN iff it actually shows the English fallback.
export function isUntranslated(id) {
    if (currentLang === 'en') return false;
    const t = id ? locText[id] : undefined;
    return !(typeof t === 'string' && t !== '');
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
    entityNames = gd.entityNames || {};
    pathScopeNames = gd.pathScopeNames || {};
    pathFieldNames = gd.pathFieldNames || {};
    pathObjectFields = new Set(Array.isArray(gd.pathObjectFields) ? gd.pathObjectFields : []);
    pathFieldLeafNames = gd.pathFieldLeafNames || {};
    pathLiteralLeafFields = new Set(Array.isArray(gd.pathLiteralLeafFields) ? gd.pathLiteralLeafFields : []);
    brokenPathRefs = gd.brokenPathRefs || {};
    brokenReqFields = gd.brokenReqFields || {};
    badgeRankNames = gd.badgeRankNames || {};
    badgeRankManager = gd.badgeRankManager || '';
    cueTexts = gd.cueTexts || {};
    gameDataRefs = gd.gameDataRefs || {};
    namedRequirements = gd.namedRequirements || {};
    godTraitNames = new Set(Array.isArray(gd.godTraitNames) ? gd.godTraitNames : []);
    restrictBoonChoiceTraitNames = new Set(Array.isArray(gd.restrictBoonChoiceTraitNames) ? gd.restrictBoonChoiceTraitNames : []);
    h1SaveEvalStatic = (gd.h1SaveEvalStatic && typeof gd.h1SaveEvalStatic === 'object') ? gd.h1SaveEvalStatic : {};
    allNames = Object.keys(textlines).sort();

    _reqTypeOrderIndex = {};
    reqTypeOrder.forEach((t, i) => { _reqTypeOrderIndex[t] = i; });

    // Overlay the active language onto the freshly-wired ``speakers`` map (and
    // refresh ``locText`` for the new game) so a game switch keeps the chosen
    // language. No-op under English.
    _applyLocalization();
}

// Returns the currently-active game id (``null`` before
// ``setActiveGame`` is first called).
export function getActiveGame() {
    return currentGame;
}

// The active game's UNMODIFIED (English) speakers map. The localisation
// overlay reassigns the exported ``speakers`` binding to a translated copy but
// never touches ``games[currentGame].speakers``, so this always yields the
// language-neutral names. Used for anything that must stay stable across
// languages - notably the speaker id<->name mapping written into the URL hash.
export function getBaseSpeakers() {
    return (games && games[currentGame] && games[currentGame].speakers) || {};
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
