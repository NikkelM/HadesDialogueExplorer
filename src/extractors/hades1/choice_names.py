"""Friendly display labels for choice ``ChoiceText`` identifiers (Hades 1).

Hades 1 dialogue cues that present a runtime choice carry a
``Choices = {...}`` table where each option declares::

    ChoiceText = "Than_GoToHim"

The string is both the human-author's label inside the Lua source and
the in-game flag the engine records when the player picks that option.
The viewer used to render those identifiers verbatim ("Choices:
Than_BackOff · Than_GoToHim"), which is unreadable to a player
browsing dialogue.

This map hand-authors a friendly label for every romance-prompt choice
id, every boon-vendor (Sisyphus/Patroclus/Eurydice) benefit choice id,
Hermes's voiceline-squelch toggle prompts, and Orpheus's jukebox song
picker. Choice ids without an entry here fall back to the raw
identifier (see below).

When the viewer renders a choice id it falls back to the raw
identifier whenever the id isn't in this map, so unmapped choices
still surface (with no friendly label or tooltip) rather than going
missing.
"""

# Same vendoring pattern as ``HADES1_SPEAKERS`` / ``HADES1_OFFER_TEXT_MAP``:
# changes are reviewable in ``git diff`` and there's no runtime file
# dependency. Grouped by character for review readability; lookups are
# flat-dict at runtime so ordering doesn't matter.
#
# Romance labels are plain ("Back Off"); boon-vendor labels mirror the
# in-game ``ChoiceText_*`` MiscText display names verbatim so the
# tooltip-internal pairing stays useful even though the MiscText
# values include flavour icon glyphs that we don't render here.
HADES1_CHOICE_NAMES = {
    # Dusa romance aftermath (return-the-ambrosia choice).
    "Dusa_Accept":      "Accept",
    "Dusa_Decline":     "Decline",
    # Megaera romance / bedroom choice.
    "Meg_BackOff":      "Back Off",
    "Meg_GoToHer":      "Go to Her",
    # Thanatos romance / bedroom choice.
    "Than_BackOff":     "Back Off",
    "Than_GoToHim":     "Go to Him",
    # Threesome (Megaera + Thanatos) bedroom choice.
    "MegThan_BackOff":  "Back Off",
    "MegThan_GoToThem": "Go to Them",
    # Sisyphus benefit choices (Tartarus boon vendor).
    "ChoiceText_Healing":                "Healing",
    "ChoiceText_Darkness":               "Darkness",
    "ChoiceText_Money":                  "Charon's Obol",
    # Patroclus benefit choices (Elysium boon vendor).
    "ChoiceText_BuffExtraChance":          "Kiss of Styx Premium",
    "ChoiceText_BuffExtraChanceReplenish": "Touch of Styx Dark",
    "ChoiceText_BuffHealing":              "HydraLite Gold",
    "ChoiceText_BuffWeapon":               "Cyclops Jerky Select",
    # Eurydice benefit choices (Asphodel boon vendor).
    "ChoiceText_BuffSlottedBoonRarity":  "Ambrosia Delight",
    "ChoiceText_BuffMegaPom":            "Pom Porridge",
    "ChoiceText_BuffFutureBoonRarity":   "Refreshing Nectar",
    # Hermes voiceline-frequency squelch prompts (Tartarus boon
    # popups). Two paired ``HermesSquelch01/03B`` ("currently chatty
    # -> mute him?") and ``HermesSquelch02/03`` ("currently muted ->
    # bring him back?") variants of the same toggle, with mirrored
    # option ordering.
    "Squelch_KeepTalking":     "Keep Talking",
    "Squelch_BeQuietAWhile":   "Be Quiet a While",
    "Squelch_ResumeTalking":   "Resume Talking",
    "Squelch_KeepQuiet":       "Keep Quiet",
    # Orpheus jukebox song picker (``OrpheusMiscMeeting03``). All
    # three picks share the same Orpheus reply ("Alas, I've not the
    # heart to sing it anymore."); the option label names the song
    # Zagreus suggests, matching the in-game italicised song title.
    "OrpheusJukebox_00":       "The Lament",
    "OrpheusJukebox_01":       "In the Blood",
    "OrpheusJukebox_02":       "Argonauts",
}
