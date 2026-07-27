// Play-order model: which textline within a context the game would pick
// next, and how many currently-eligible siblings rank ahead of a given
// one. Single-sources the per-game ordering rules shared by the speaker
// overview (within-section sort) and the eligibility tracer ("will play
// before this" note).
//
// Both games resolve a single textline per trigger from the eligible
// members of one owner+context group:
//   - Hades II: an explicit priority list (NarrativeData ``*TextLinePriorities``)
//     gives each member a 1-based ``narrativePriorityOrdinal``; the lowest
//     ordinal that is eligible plays first. Members without an ordinal only
//     surface via the random fallback, so they rank last.
//   - Hades 1: a priority-tier cascade (SuperPriority > Priority > Normal),
//     with repeatable lines as the final fallback after every play-once
//     tier. ``narrativePrioritySectionTier`` carries the tier; the same
//     ranking the speaker view sorts by.
// In both, equally-ranked members are a tie (random among them), so they
// do NOT count as "ahead" of each other.

import { textlines, getActiveGame } from './data.js';
import { directSatisfaction } from './requirements.js';
import { isDialoguePlayed } from './save-parser.js';

// H1 same-context section-key families. Several Lua section tables form a
// single in-game selection cascade for one owner (e.g. the three god-boon
// pickup priority tiers, or the four boss-intro tiers). Collapsing them to
// one canonical key groups the lines that actually compete on a trigger.
// (Mirrors the speaker overview's section merging - kept here as the single
// source so both surfaces agree.)
export const MERGED_SECTION_KEYS = {
    // "God boon pickup"
    PickupTextLineSets: 'PickupTextLineSets',
    PriorityPickupTextLineSets: 'PickupTextLineSets',
    SuperPriorityPickupTextLineSets: 'PickupTextLineSets',
    // "NPC interaction" (interact + repeatable fallback + on-death / trophy)
    InteractTextLineSets: 'InteractTextLineSets',
    RepeatableTextLineSets: 'InteractTextLineSets',
    OnDeathTextLineSets: 'InteractTextLineSets',
    OnTrophyRevealedTextLineSets: 'InteractTextLineSets',
    OnTrophyUnlockedTextLineSets: 'InteractTextLineSets',
    // "Misc. interaction"
    TextLineSet: 'TextLineSet',
    OnUsedTextLineSets: 'TextLineSet',
    // "Boss introduction" (four intro tiers + repeatable fallback)
    BossPresentationIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationPriorityIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationSuperPriorityIntroTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationTextLineSets: 'BossPresentationIntroTextLineSets',
    BossPresentationRepeatableTextLineSets: 'BossPresentationIntroTextLineSets',
    // "Boss outro" (+ repeatable fallback)
    BossPresentationOutroTextLineSets: 'BossPresentationOutroTextLineSets',
    BossPresentationOutroRepeatableTextLineSets: 'BossPresentationOutroTextLineSets',
};

export function mergedSectionKey(sectionKey) {
    return MERGED_SECTION_KEYS[sectionKey] || sectionKey;
}

// Locked display order for a speaker's textline-set sections, by relevance /
// in-game flow rather than dialogue counts, so the order never changes when the
// repeatability or eligibility filters shrink a section. Keyed on the (merged)
// section key; both games' keys are listed because an owner only ever belongs to
// one game, so the H1 / H2 variants of a concept can safely share a rank.
// Sections not listed fall to the default rank and order alphabetically by label
// (a stable tiebreak). Shared by the speaker overview's section order and the
// cross-game duplicates view's category order so the two surfaces agree.
//
// Grouping: conversational core -> gifting -> god-boon flow -> the
// "Trial of the Gods" / "Family Dispute" pair -> boss/combat encounter
// flow (intro -> combat intro -> phase change -> outro -> death) ->
// misc / edge tables.
export const SECTION_ORDER = {
    // Conversational core
    InteractTextLineSets: 1,                       // NPC interaction
    OnHitTextLineSets: 2,                           // NPC interaction (on hit)
    GiftTextLineSets: 3,                            // NPC gifting
    // God-boon flow
    PickupTextLineSets: 4,                          // God boon pickup
    DuoPickupTextLineSets: 5,                        // Duo boon pickup (H1)
    DuoPickupTextLines: 5,                           // Duo boon pickup (H2)
    BoughtTextLines: 6,                              // God boon shop purchase
    // Trial of the Gods (H1) / Family Dispute (H2) pair
    RejectionTextLines: 7,                           // ... Displeased
    MakeUpTextLines: 8,                              // ... Completion
    // Boss / combat encounter flow
    BossPresentationIntroTextLineSets: 9,            // Boss introduction (H1)
    BossIntroTextLineSets: 9,                        // Boss introduction (H2)
    CombatIntroTextLineSets: 10,                     // Combat introduction (H2)
    BossPresentationNextStageTextLineSets: 11,       // Boss phase transition (H1)
    BossPhaseChangeTextLineSets: 11,                 // Boss phase transition (H2)
    BossPresentationOutroTextLineSets: 12,           // Boss outro (H1)
    BossOutroTextLineSets: 12,                        // Boss outro (H2)
    DeathPresentationTextLineSets: 13,               // Death presentation (H2)
    // Misc / edge
    TextLineSet: 14,                                 // Misc. interaction / Event narrative
    ForcedTextLines: 15,                             // Forced room dialogue (H1)
    PostPortraitTextLines: 16,                        // Post-portrait dialogue (H2)
};
const SECTION_ORDER_DEFAULT = 100;

export function sectionOrderRank(key) {
    // Every explicit rank is >= 1, so ``||`` safely supplies the default.
    return SECTION_ORDER[key] || SECTION_ORDER_DEFAULT;
}

// H1 narrative-priority tier as a sortable rank (lower plays first):
// super-priority, then priority, then normal, then low (the final
// fallback). Mirrors the tier the per-row badge shows
// (``narrativePrioritySectionTier``).
export function h1TierRank(tl) {
    const sec = tl && tl.narrativePrioritySectionTier;
    if (sec === 'super') return 0;
    if (sec === 'priority') return 1;
    if (sec === 'low') return 3;
    return 2;
}

// H1 play-order rank for a textline within its section. Play-once lines
// rank by narrative-priority tier (0..3); repeatable lines are the
// lowest-priority fallback and rank after every play-once tier.
export function h1SortRank(tl) {
    if (!(tl && tl.playOnce)) return 4;
    return h1TierRank(tl);
}

// Comparable play-order rank for a textline (lower plays first). H2 uses
// the narrative ordinal (rank-less lines sort last); H1 uses the tier
// cascade. ``game`` defaults to the active game.
export function playRank(tl, game) {
    if ((game || getActiveGame()) === 'hades2') {
        return Number.isInteger(tl && tl.narrativePriorityOrdinal) ? tl.narrativePriorityOrdinal : Infinity;
    }
    return h1SortRank(tl);
}

// The context group key a textline competes in: owner + section, with the
// H1 tier-variant sections collapsed to their shared cascade. H2 sections
// each carry their own priority list, so no merge is applied there.
function contextKey(tl, game) {
    const section = (tl && tl.section) || '';
    const sec = (game === 'hades2') ? section : mergedSectionKey(section);
    return `${(tl && tl.owner) || ''}\u0000${sec}`;
}

// Currently-eligible, not-yet-played siblings that rank strictly ahead of
// ``rootName`` in its play context - i.e. the dialogues the game would
// resolve before this one on a trigger, as far as the save lets us tell.
//
// Returns ``{ ahead, hasOrdinal }`` where ``ahead`` is a name+repeatable
// list sorted by play rank, or ``null`` when the dialogue is unknown or
// ownerless. ``saveCtx`` is the shared eligibility context (the played set
// plus run-scoped records) the tracer already builds.
//
// Caveats baked into the disclaimer at the call site: a sibling whose
// ordering hinges on run-scoped / timing requirements the save can't
// resolve is treated as eligible-or-not by ``directSatisfaction`` alone,
// and ties (equal rank) are random in-game, so the count is a best-effort
// lower bound rather than a guarantee.
export function computePlayAhead(rootName, saveCtx, game) {
    const g = game || getActiveGame();
    const root = textlines[rootName];
    if (!root || !root.owner) return null;

    const rootCtx = contextKey(root, g);
    const rootRank = playRank(root, g);

    const ahead = [];
    for (const name in textlines) {
        if (name === rootName) continue;
        const tl = textlines[name];
        if (!tl || tl.owner !== root.owner) continue;
        if (contextKey(tl, g) !== rootCtx) continue;
        if (playRank(tl, g) >= rootRank) continue;
        if (isDialoguePlayed(name) === true) continue;
        if (directSatisfaction(tl, saveCtx, name) !== 'met') continue;
        ahead.push({ name, repeatable: !tl.playOnce });
    }
    ahead.sort((a, b) => {
        const ra = playRank(textlines[a.name], g);
        const rb = playRank(textlines[b.name], g);
        return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
    return { ahead, hasOrdinal: Number.isInteger(root.narrativePriorityOrdinal) };
}
