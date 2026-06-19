"""Resolved display text for Hades II choice-prompt cue ``Text`` references.

The romance "Becoming Closer" choice prompts declare their visible question
indirectly: the choice-prompt cue's ``Text`` is a ``ScreenText.en.sjson``
identifier rather than the literal subtitle::

    { Text = "Choice_NemesisBecomingCloser01", Choices = {...} }

At runtime the engine looks the identifier up in
``Game/Text/en/ScreenText.en.sjson`` and shows the resolved DisplayName
("Stay with Nemesis? (Follow your heart...)"). Without this map the viewer
shows the raw identifier - meaningless to a player browsing dialogue. (This
is the H2 analogue of H1's ``HADES1_OFFER_TEXT_MAP``; H2's indirection lives
in ScreenText, not MiscText, and only on these choice prompts - regular cues
carry their subtitle inline.)

Hand-vendored here rather than parsed at runtime, consistent with every other
H2 reference table in this package (``HADES2_CHOICE_NAMES``,
``HADES2_SPEAKERS``, ...):

  * Changes are visible in ``git diff`` if the localisation team edits a
    value - we won't silently regenerate against a patched install.
  * The pipeline has no runtime dependency on the ScreenText file existing;
    only ``Scripts/*.lua`` is required.
  * No SJSON parser to maintain.

DisplayName values are stored with their ``{#...}`` runtime presentation tags
already stripped (the same tags ``_FORMAT_TAG_RE`` removes), so the viewer
renders plain text. If a new choice-prompt key isn't in this map the viewer
surfaces the raw identifier - the same visible failure mode any other
unresolved reference produces; add the key here to fix it.
"""

HADES2_OFFER_TEXT_MAP = {
    "Choice_ErisBecomingCloser01":    "Be with Eris? (Follow your heart...)",
    "Choice_IcarusBecomingCloser01":  "Go to Icarus? (Follow your heart...)",
    "Choice_MorosBecomingCloser01":   "Remain with Moros? (Follow your heart...)",
    "Choice_NemesisBecomingCloser01": "Stay with Nemesis? (Follow your heart...)",
}
