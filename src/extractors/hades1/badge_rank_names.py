"""Hades 1 "Resources Director" badge-rank number -> display name.

The House's Resources Director runs a badge / rank system: donating resources
advances ``GameState.BadgeRank`` (1..50), which indexes ``GameData.BadgeOrderData``
in ``BadgeData.lua``. Each entry has a ``DisplayName`` in ``HelpText.en.sjson``.
A few surfaced dialogues gate on ``BadgeRank`` (a ``RequiredMinValues`` threshold),
so the viewer resolves the raw number to the rank the player must have reached.

Order (matches ``BadgeOrderData``): 10 rank nouns (Warden, Fixer, Agent, Cleaner,
Shadow, Dusk, Wraith, Overseer, Specter, One), each in 5 tiers (Alpha, Gamma,
Delta, Sigma, Unseen). Vendored from the game text; regenerate after a data
refresh. Rank 50 ("Unseen One") is the maximum.
"""

HADES1_BADGE_RANK_MANAGER = "Resources Director"

HADES1_BADGE_RANK_NAMES = {
    1: "Alpha Warden",
    2: "Gamma Warden",
    3: "Delta Warden",
    4: "Sigma Warden",
    5: "Unseen Warden",
    6: "Alpha Fixer",
    7: "Gamma Fixer",
    8: "Delta Fixer",
    9: "Sigma Fixer",
    10: "Unseen Fixer",
    11: "Alpha Agent",
    12: "Gamma Agent",
    13: "Delta Agent",
    14: "Sigma Agent",
    15: "Unseen Agent",
    16: "Alpha Cleaner",
    17: "Gamma Cleaner",
    18: "Delta Cleaner",
    19: "Sigma Cleaner",
    20: "Unseen Cleaner",
    21: "Alpha Shadow",
    22: "Gamma Shadow",
    23: "Delta Shadow",
    24: "Sigma Shadow",
    25: "Unseen Shadow",
    26: "Alpha Dusk",
    27: "Gamma Dusk",
    28: "Delta Dusk",
    29: "Sigma Dusk",
    30: "Unseen Dusk",
    31: "Alpha Wraith",
    32: "Gamma Wraith",
    33: "Delta Wraith",
    34: "Sigma Wraith",
    35: "Unseen Wraith",
    36: "Alpha Overseer",
    37: "Gamma Overseer",
    38: "Delta Overseer",
    39: "Sigma Overseer",
    40: "Unseen Overseer",
    41: "Alpha Specter",
    42: "Gamma Specter",
    43: "Delta Specter",
    44: "Sigma Specter",
    45: "Unseen Specter",
    46: "Alpha One",
    47: "Gamma One",
    48: "Delta One",
    49: "Sigma One",
    50: "Unseen One",
}
