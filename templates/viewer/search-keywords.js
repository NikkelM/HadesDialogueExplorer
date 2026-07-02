// Keyword / "buzzword" search mappings.
//
// A player often knows what a dialogue is ABOUT ("Eris romance",
// "Thanatos relationship", "Zeus gift") without knowing its internal
// name (``ErisBecomingCloser01``). This module maps each dialogue to a
// set of concept terms - derived from its section key and its name -
// so the name search can surface it when the user types one of those
// terms. These are matched at the lowest ranking tier (see
// ``rankSearchToken`` in ``search-name.js``), so a keyword hit only
// ever appears BELOW every literal name / owner match.
//
// The rules are intentionally a single, hand-curated table so the
// mappings are easy to audit and extend. Each rule fires when the
// dialogue's section OR its name matches, and then contributes its
// ``terms`` (the words a user might actually type) to that dialogue's
// keyword set. ``sectionIncludes`` / ``namePatterns`` are lowercased
// substrings tested against the lowercased section key / name.
//
// A dialogue can match several rules (e.g. a fishing gift line matches
// both ``gift`` and ``fishing``) and gains the union of their terms.
// The ``fishing`` / ``taverna`` / ``bathhouse`` activities are also
// listed under ``gift``'s ``namePatterns`` so a search for "gift"
// surfaces these "alternate gift options" too, while their own
// concepts keep a bare "fishing" search from dragging in every gift.
//
// Deliberately NOT used as name patterns to avoid substring collisions:
//   - ``lure`` (inside "Fai-lure-") -> a ``fishing`` term only.
//   - ``salt`` (inside "Bos-sAlt-Fight") -> a ``bathhouse`` term only.

export const KEYWORD_RULES = [
    {
        concept: 'romance',
        terms: ['romance', 'romantic', 'relationship', 'relationships', 'dating', 'love', 'lover'],
        namePatterns: ['becomingcloser', 'relationship', 'romance'],
    },
    {
        concept: 'gift',
        terms: ['gift', 'gifts', 'gifting', 'nectar', 'ambrosia', 'present', 'presents', 'offering'],
        sectionIncludes: ['gift'],
        namePatterns: ['gift', 'nectar', 'ambrosia', 'fishing', 'taverna', 'bathhouse', 'hotsprings'],
    },
    {
        concept: 'fishing',
        terms: ['fishing', 'lure'],
        namePatterns: ['fishing'],
    },
    {
        concept: 'taverna',
        terms: ['taverna', 'drinking'],
        namePatterns: ['taverna'],
    },
    {
        concept: 'bathhouse',
        terms: ['bathhouse', 'bath', 'hotsprings', 'springs', 'bathsalts', 'salts'],
        namePatterns: ['bathhouse', 'hotsprings'],
    },
    {
        concept: 'boss',
        terms: ['boss', 'bossfight', 'guardian'],
        sectionIncludes: ['boss'],
        namePatterns: ['boss'],
    },
    {
        concept: 'combat',
        terms: ['combat', 'fight', 'fighting', 'battle', 'encounter', 'encounters'],
        sectionIncludes: ['combat'],
        namePatterns: ['encounter', 'combat', 'altfight'],
    },
    {
        concept: 'death',
        terms: ['death', 'defeat', 'defeated', 'died', 'dying', 'killed'],
        sectionIncludes: ['death'],
        namePatterns: ['death', 'defeat'],
    },
    {
        concept: 'rejection',
        terms: ['rejection', 'rejected', 'refused', 'spurned'],
        sectionIncludes: ['rejection'],
        namePatterns: ['rejection'],
    },
    {
        concept: 'reconciliation',
        terms: ['makeup', 'reconcile', 'reconciliation', 'apology', 'forgiveness'],
        sectionIncludes: ['makeup'],
        namePatterns: ['makeup'],
    },
    {
        concept: 'quest',
        terms: ['quest', 'quests', 'prophecy', 'prophecies', 'fate', 'fated', 'fates'],
        namePatterns: ['quest', 'prophecy', 'fate'],
    },
    {
        concept: 'reunion',
        terms: ['reunion', 'reunite', 'reunited'],
        namePatterns: ['reunion'],
    },
    {
        concept: 'purchase',
        terms: ['bought', 'buy', 'purchase', 'purchased', 'shop', 'store'],
        sectionIncludes: ['bought'],
        namePatterns: ['bought'],
    },
    {
        concept: 'pickup',
        terms: ['pickup', 'pickups', 'reward', 'boon', 'boons'],
        sectionIncludes: ['pickup'],
        namePatterns: ['pickup'],
    },
];

// The minimum query-token length that can match a keyword. Short prefixes
// (``ro``, ``re``) are almost always mid-typing a literal name, so gating
// keyword matches to 3+ characters keeps early keystrokes free of buzzword
// noise while still catching ``rom`` -> romance, ``gif`` -> gift, ``duo`` etc.
export const MIN_KEYWORD_TOKEN_LENGTH = 3;

// Compute the concept-term set for one dialogue from its name and
// section key. Returns a ``Set`` of lowercased terms (empty when no
// rule fires). Pure - the caller (``buildNameIndex``) memoises the
// result per dialogue.
export function computeDialogueKeywords(name, section) {
    const nameLower = (name || '').toLowerCase();
    const sectionLower = (section || '').toLowerCase();
    const out = new Set();
    for (const rule of KEYWORD_RULES) {
        let matched = false;
        if (rule.sectionIncludes) {
            for (const s of rule.sectionIncludes) {
                if (sectionLower.includes(s)) { matched = true; break; }
            }
        }
        if (!matched && rule.namePatterns) {
            for (const p of rule.namePatterns) {
                if (nameLower.includes(p)) { matched = true; break; }
            }
        }
        if (matched) {
            for (const t of rule.terms) out.add(t);
        }
    }
    return out;
}

// Whether ``token`` (a lowercased query token) matches any term in a
// dialogue's keyword ``set``. Prefix-based so mid-typing works
// (``rom`` -> ``romance``); gated by ``MIN_KEYWORD_TOKEN_LENGTH`` so
// one- / two-letter prefixes don't fire. Returns false for an empty
// set or a too-short token.
export function keywordSetMatches(set, token) {
    if (!set || set.size === 0) return false;
    if (!token || token.length < MIN_KEYWORD_TOKEN_LENGTH) return false;
    for (const term of set) {
        if (term.startsWith(token)) return true;
    }
    return false;
}
