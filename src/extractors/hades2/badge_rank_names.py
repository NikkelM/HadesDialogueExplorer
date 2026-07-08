"""Hades 2 "Spirit Mixer" badge-rank number -> display name.

The Spirit Mixer runs a badge / rank system: donating resources advances
``GameState.BadgeRank`` (1..50), which indexes ``BadgeOrderData`` in
``BadgeData.lua``. Each entry has a ``DisplayName`` in ``HelpText.en.sjson``.
A few surfaced dialogues gate on ``BadgeRank`` (a ``Comparison == 50`` path
record), so the viewer resolves the raw number to the rank the player reached.

Order (matches ``BadgeOrderData``): 5 rank nouns (Wraith, Specter, Revenant,
Nightmare, Unseen), each in 10 tiers counting down X -> I (I is highest within a
rank). Vendored from the game text; regenerate after a data refresh. Rank 50
("Unseen I") is the maximum.
"""

HADES2_BADGE_RANK_MANAGER = "Spirit Mixer"

HADES2_BADGE_RANK_NAMES = {
    1: "Wraith X",
    2: "Wraith IX",
    3: "Wraith VIII",
    4: "Wraith VII",
    5: "Wraith VI",
    6: "Wraith V",
    7: "Wraith IV",
    8: "Wraith III",
    9: "Wraith II",
    10: "Wraith I",
    11: "Specter X",
    12: "Specter IX",
    13: "Specter VIII",
    14: "Specter VII",
    15: "Specter VI",
    16: "Specter V",
    17: "Specter IV",
    18: "Specter III",
    19: "Specter II",
    20: "Specter I",
    21: "Revenant X",
    22: "Revenant IX",
    23: "Revenant VIII",
    24: "Revenant VII",
    25: "Revenant VI",
    26: "Revenant V",
    27: "Revenant IV",
    28: "Revenant III",
    29: "Revenant II",
    30: "Revenant I",
    31: "Nightmare X",
    32: "Nightmare IX",
    33: "Nightmare VIII",
    34: "Nightmare VII",
    35: "Nightmare VI",
    36: "Nightmare V",
    37: "Nightmare IV",
    38: "Nightmare III",
    39: "Nightmare II",
    40: "Nightmare I",
    41: "Unseen X",
    42: "Unseen IX",
    43: "Unseen VIII",
    44: "Unseen VII",
    45: "Unseen VI",
    46: "Unseen V",
    47: "Unseen IV",
    48: "Unseen III",
    49: "Unseen II",
    50: "Unseen I",
}
