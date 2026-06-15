"""Friendly labels for Hades II ``Choice_*`` identifiers.

H2 cues that declare a ``Choices = {...}`` table use a ``ChoiceText``
identifier to label each option::

    {
        ChoiceText = "Choice_NemesisAccept",
        { Cue = ..., Text = "..." },
    },

The viewer used to render those identifiers verbatim ("Choices:
``Choice_NemesisAccept`` / ``Choice_NemesisDecline``"). This map
provides the human-readable display labels (sourced from
``ScreenText.en.sjson`` in the game install - vendored here rather
than parsed at runtime, consistent with every other H2 label table
in this package).

The renderer falls back to the raw identifier whenever the id isn't
in this map, so unmapped choices remain visible (a forward-compat
safety net for future game patches that introduce new options before
the map is updated).

Current H2 inventory: 4 NPCs (Eris, Icarus, Moros, Nemesis) each with
one ``Accept`` / ``Decline`` "Becoming Closer" romance prompt = 8 ids
total. New families will be added here as the game adds them; the
``Choice_<NPC><Action>`` naming convention is the canonical pattern.
"""

HADES2_CHOICE_NAMES = {
    "Choice_ErisAccept":     "Accept",
    "Choice_ErisDecline":    "Decline",
    "Choice_IcarusAccept":   "Accept",
    "Choice_IcarusDecline":  "Decline",
    "Choice_MorosAccept":    "Accept",
    "Choice_MorosDecline":   "Decline",
    "Choice_NemesisAccept":  "Accept",
    "Choice_NemesisDecline": "Decline",
}
