// Hash-based ``key=value`` URL scheme for the viewer.
//
// The viewer encodes its state in ``window.location.hash`` rather
// than a query string. Reasons:
//
//   - The bundled single-file build (``dialogue_explorer.html``) is
//     meant to be opened directly via ``file://``, where query
//     strings can behave unpredictably across browsers and don't
//     round-trip cleanly through bookmarks on some platforms.
//   - On the split build hosted on GitHub Pages, mutating a query
//     string can cause the static host to re-resolve the URL; a
//     hash change never triggers a navigation request.
//   - Keeping a single scheme across both build modes means the
//     same URLs are shareable regardless of how the user is
//     running the viewer.
//
// Scheme (extensible - any unknown keys are preserved when parsing
// and ignored by renderers that don't recognise them):
//
//   #game=<gameId>&view=<viewName>&dialogue=<TextlineName>
//   #game=<gameId>&view=<viewName>&speaker=<SpeakerId>
//   #game=<gameId>&view=<viewName>&dialogue=<TextlineName>&...viewSpecificKeys
//
// Defaults / fallback:
//
//   - Empty / missing hash -> empty state under the build-time
//     default game (``defaultGame`` in the data payload). The
//     viewer renders its placeholder panels (see
//     ``templates/index.html``) so the page matches its first-load
//     appearance.
//   - ``game`` missing -> default game from the data payload (the
//     ``data.js`` ``resolveGame`` helper handles this). Unknown
//     game ids likewise fall back to the default with a console
//     warning so shared deep links never land the viewer in an
//     empty-data limbo.
//   - ``view`` missing but ``dialogue=X`` present -> dialogue
//     detail view of ``X``. This keeps hand-authored URLs short
//     and matches the only ``view`` the viewer implements today.
//   - An unknown ``view`` value still selects the entity in the
//     dialogue detail view if ``dialogue=X`` is present, so links
//     pointing at views that don't exist yet (e.g. ``view=graph``)
//     degrade gracefully.
//
// All keys and values are URL-encoded with ``encodeURIComponent``
// so any special characters in entity names round-trip safely.
//
// Known/canonical keys (currently used or reserved for upcoming
// views) are written in a fixed order so the serialized URL is
// stable across renders. ``game`` comes first because it bounds
// the namespace every other key resolves against (textline names
// are NOT unique cross-game). Extra keys follow in insertion order.
const KEY_ORDER = ['game', 'view', 'dialogue', 'speaker', 'priority', 'sort', 'filter', 'q'];

// Parse a hash fragment (with or without the leading ``#``) into a
// plain object. Returns ``{}`` for an empty / missing hash or for a
// hash that contains no ``key=value`` pairs.
//
// Empty values are dropped so callers can probe ``state.dialogue``
// directly without having to also guard against ``''``.
export function parseUrlState(rawHash) {
    if (!rawHash) return {};
    const stripped = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    if (!stripped) return {};
    const state = {};
    for (const pair of stripped.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const key = _safeDecode(pair.slice(0, eq));
        if (!key) continue;
        const value = _safeDecode(pair.slice(eq + 1));
        if (value === '') continue;
        state[key] = value;
    }
    return state;
}

// Serialize ``{key: value, ...}`` into a hash fragment without the
// leading ``#``. Nullish / empty values are dropped. Known keys are
// emitted in ``KEY_ORDER`` first; unknown keys follow in insertion
// order. The output is canonical: two states that differ only in
// key insertion order produce the same string.
export function serializeUrlState(state) {
    if (!state) return '';
    const parts = [];
    const seen = new Set();
    for (const key of KEY_ORDER) {
        if (!_hasValue(state, key)) continue;
        parts.push(_encodePair(key, state[key]));
        seen.add(key);
    }
    for (const key of Object.keys(state)) {
        if (seen.has(key) || !_hasValue(state, key)) continue;
        parts.push(_encodePair(key, state[key]));
    }
    return parts.join('&');
}

// Canonical identity string for change-detection in the navigation
// layer. Two states are equal iff their serializations are; the
// navigation listener uses this to skip the redundant re-render
// that fires when the viewer itself writes the hash.
export function urlStateKey(state) {
    return serializeUrlState(state || {});
}

function _safeDecode(s) {
    try {
        return decodeURIComponent(s);
    } catch {
        // Malformed escapes - fall back to the raw text so the
        // user still sees something meaningful instead of a blank
        // panel.
        return s;
    }
}

function _hasValue(obj, key) {
    const v = obj[key];
    return v !== undefined && v !== null && v !== '';
}

function _encodePair(key, value) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(value);
}
