// Language picker: a header dropdown that swaps the language dialogue text,
// choice labels and speaker names are shown in. English is the inline default
// (no fetch); other languages lazy-load their ``loc-<game>-<lang>.json`` map
// (split build) or read the inlined one (bundle). The selection is a persisted
// preference (localStorage), not URL state, so shared links stay clean and
// language-neutral.
//
// The set of offered languages is per-game (Hades ships fewer than Hades II),
// so the options re-render on a game switch and a language the new game lacks
// falls back to English.
//
// Module-private identifiers are ``lang``-prefixed because every viewer module
// is concatenated into one classic script (see viewer_bundle.py) - a bare
// ``STORAGE_KEY`` / ``mount`` / ``onChange`` would clash with another module's.

import {
    getAvailableLanguages, getActiveLang, setActiveLang, ensureLangLoaded,
    getActiveGame, isLangLoaded,
} from './data.js';
import { refreshForLanguageChange, rebuildSearchIndexes } from './navigation.js';
import { escapeHtml } from './utilities.js';

const LANG_STORAGE_KEY = 'hde:lang';
let langPickerMount = null;

// The last language the user explicitly picked. Persisted so it carries across
// sessions and games (re-applied per game when that game offers it).
export function getSavedLang() {
    try {
        return localStorage.getItem(LANG_STORAGE_KEY) || 'en';
    } catch {
        return 'en';
    }
}

function saveLangPref(lang) {
    try {
        if (!lang || lang === 'en') localStorage.removeItem(LANG_STORAGE_KEY);
        else localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch { /* private mode / storage disabled - selection just won't persist */ }
}

function availableLangCodes() {
    return getAvailableLanguages().map((l) => l.code);
}

// Build (or rebuild) the ``<select>`` for the active game's language list and
// reflect the active selection. Hidden when the game offers no translations.
//
// Upgrades the existing <select> IN PLACE (repopulating its <option>s) rather
// than replacing the whole picker's innerHTML: the static markup ships a
// placeholder <select> (index.html) so the control paints immediately, and
// tearing it down here would blink the visible label out and back on boot. The
// selected value is preserved, so the displayed label never changes visibly.
function renderLanguageOptions() {
    if (!langPickerMount) return;
    const langs = getAvailableLanguages();
    if (!langs || langs.length <= 1) {
        langPickerMount.hidden = true;
        langPickerMount.innerHTML = '';
        return;
    }
    langPickerMount.hidden = false;
    const active = getActiveLang();
    let select = langPickerMount.querySelector('#language-select');
    if (!select) {
        // No placeholder present (e.g. a customised shell) - build the structure.
        langPickerMount.innerHTML = (
            '<label class="language-picker-label" for="language-select">'
            + '<span class="visually-hidden">Dialogue language</span>'
            + '<select id="language-select" class="language-select" '
            + 'data-tooltip="Show dialogue text, choices and speaker names in this language">'
            + '</select></label>'
        );
        select = langPickerMount.querySelector('#language-select');
    }
    // Only (re)build the <option> list when the SET of languages changes (boot's
    // one-option placeholder -> full list, or a game switch) - never on a mere
    // selection change. Mark the active option ``selected`` in the HTML so the
    // rebuilt list shows it atomically, with no flash of the first option. A
    // selection change (same set) skips the rebuild entirely and just sets
    // ``value`` - so switching language never touches the option list.
    const sig = langs.map((l) => l.code).join(',');
    if (select.dataset.langsSig !== sig) {
        select.innerHTML = langs.map((l) => (
            '<option value="' + escapeHtml(l.code) + '"'
            + (l.code === active ? ' selected' : '') + '>'
            + escapeHtml(l.label) + '</option>'
        )).join('');
        select.dataset.langsSig = sig;
    }
    if (select.value !== active) select.value = active;
    if (!select.dataset.wired) {
        select.addEventListener('change', onLanguageChange);
        select.dataset.wired = '1';
    }
}

// Apply a chosen language: persist it, ensure its map is loaded (English needs
// none), activate it, and re-render. Falls back to English if the load fails.
function applyLanguageChoice(lang, { persist = true } = {}) {
    const game = getActiveGame();
    if (persist) saveLangPref(lang);
    if (lang === 'en') {
        setActiveLang('en');
        renderLanguageOptions();
        refreshForLanguageChange();
        return;
    }
    if (isLangLoaded(game, lang)) {
        setActiveLang(lang);
        renderLanguageOptions();
        refreshForLanguageChange();
        return;
    }
    // Reflect the pending choice immediately; render stays English until loaded.
    setLangPickerBusy(true);
    ensureLangLoaded(game, lang).then((ok) => {
        setLangPickerBusy(false);
        // The user may have switched game/language while the fetch was in
        // flight; only apply if this is still the intended selection.
        if (getSavedLang() !== lang || getActiveGame() !== game) return;
        setActiveLang(ok ? lang : 'en');
        if (!ok) saveLangPref('en');
        renderLanguageOptions();
        refreshForLanguageChange();
    });
}

function onLanguageChange(e) {
    applyLanguageChoice(e.target.value);
}

function setLangPickerBusy(busy) {
    if (!langPickerMount) return;
    const select = langPickerMount.querySelector('#language-select');
    if (select) select.disabled = busy;
    langPickerMount.classList.toggle('language-picker-busy', busy);
}

// One-time setup: read the saved language, apply it for the initial game (its
// map is preloaded during boot so the first render is already localised), and
// wire the dropdown.
export function initLanguagePicker() {
    langPickerMount = document.getElementById('language-picker');
    if (!langPickerMount) return;
    const codes = availableLangCodes();
    const saved = getSavedLang();
    const initial = codes.includes(saved) ? saved : 'en';
    // Apply synchronously if already available (boot preloads the saved lang;
    // the bundle inlines it); otherwise applyLanguageChoice kicks off the fetch.
    if (initial === 'en' || isLangLoaded(getActiveGame(), initial)) {
        setActiveLang(initial);
        // ``switchToGame`` built the search indexes before this ran, while
        // English was still active; rebuild them for a non-English boot language
        // so speaker search matches and shows the localised names (not English).
        // No re-render here - the first render (applyHashFromUrl) is still ahead.
        if (initial !== 'en') rebuildSearchIndexes();
        renderLanguageOptions();
    } else {
        applyLanguageChoice(initial, { persist: false });
    }
}

// Re-sync after a game switch: the offered languages differ per game, so
// re-render the options and reconcile the active language. A language the new
// game doesn't offer falls back to English; one it offers but hasn't loaded is
// fetched (then the view re-renders). ``setActiveGame`` has already re-applied
// the overlay for whatever is currently loaded, so the panels are consistent
// meanwhile.
export function syncLanguagePicker() {
    if (!langPickerMount) return;
    const codes = availableLangCodes();
    const saved = getSavedLang();
    const want = codes.includes(saved) ? saved : 'en';
    const active = getActiveLang();
    if (want !== active) {
        applyLanguageChoice(want, { persist: false });
    } else if (want !== 'en' && !isLangLoaded(getActiveGame(), want)) {
        applyLanguageChoice(want, { persist: false });
    } else {
        renderLanguageOptions();
    }
}
