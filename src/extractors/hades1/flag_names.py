"""Internal H1 story-flag / config-option id -> friendly name.

Some ``otherRequirements`` gates test a boolean ``GameState.Flags.<id>`` (via
``RequiredTrueFlags`` / ``RequiredFalseFlags``) or a game setting (via
``RequiredTrueConfigOptions`` / ``RequiredFalseConfigOptions``). These ids have
no systematic friendly form, so curated names are kept here and merged into the
viewer's ``entityNames`` lookup, letting the existing operand resolver render the
friendly name (with the raw id in the hover tooltip) while the gate's own label
("Must have flag" / "Game setting must be disabled") supplies the set/unset
sense. Unlisted flags fall back to the raw id.

Names describe the flag's *set* state, so they read correctly under both the
"Must have ..." and "Must NOT have ..." wrappers. Meanings verified against the
Hades 1 scripts + ``HelpText.en.sjson``.
"""

HADES1_FLAG_NAMES = {
    # --- GameState.Flags (story flags) ---
    "InFlashback": "In a flashback",
    "AllowFlashback": "Flashback available",
    "DusaFiredFromJob": "Dusa was fired",
    "DusaNotYetReHired": "Dusa not yet rehired",
    "HardMode": "Hell Mode turned on",
    "ShrineUnlocked": "Pact of Punishment unlocked",
    "AspectsUnlocked": "Weapon Aspects unlocked",
    "NyxChaosReunionInProgress": "Nyx and Chaos reunion in progress",
    "PersephoneAway": "Persephone is away",
    "PersephoneGoingAway": "Persephone is leaving",
    "PersephoneJustReturned": "Persephone just returned",
    # --- config options (game settings) ---
    "EasyMode": "God Mode",
    "ShowGameplayTimer": "In-game timer",
}
