"""Resolved flavour text for offer/choice cue ``Text`` references (Hades 1).

NPC vendor cues (Eurydice, Patroclus, Sisyphus, Hermes, Orpheus) and a
handful of choice-prompt cues (Megaera, Thanatos, Dusa) declare their
visible dialogue indirectly::

    { Text = "Eurydice_OfferText02", Speaker = "NPC_Eurydice_01" }

At runtime the engine looks the identifier up in
``Game/Text/en/MiscText.en.sjson`` and shows the resolved DisplayName
("Eurydice offers several delectable treats."). Without this map, the
viewer would show the raw identifier - which is meaningless to a
player browsing dialogue.

This is the hand-vendored subset of MiscText.en.sjson that contains
exactly the Ids referenced from cue ``Text`` values across all H1
script files. The same vendoring pattern is used for every other piece
of reference data in this package (``HADES1_SPEAKERS``,
``HADES1_REQ_TYPE_LABELS``, ``LOOT_DEFAULT_SPEAKERS``, etc.):

  * Changes are visible in ``git diff`` if the game's localisation team
    edits a value - we won't silently regenerate against a patched
    install and ship a different viewer.
  * The pipeline has no runtime dependency on the MiscText file
    existing; only ``Scripts/*.lua`` is required.
  * No SJSON parser to maintain.

If a referenced offer/choice Id isn't in this map, the viewer will
surface the raw identifier - which is the same visible failure mode
any other unresolved reference produces. Re-run the audit (scan the
Lua sources for ``Text = "*_OfferText##"`` / ``Text = "*_ChoiceText##"``)
to refresh if a gap is spotted.

DisplayName values are stored with their ``{#...Format}`` runtime
presentation tags already stripped - the viewer renders plain text.
"""

# Keep entries grouped by speaker for review readability; the substitution
# itself is a flat dict lookup so order is irrelevant at runtime.
HADES1_OFFER_TEXT_MAP = {
    # Dusa choice prompt (single occurrence, ``Dusa_ChoiceText01``).
    "Dusa_ChoiceText01":              "Take back the Ambrosia? (She won't mind.)",
    # Eurydice's vendor lines (House of Hades nymph in Asphodel).
    "Eurydice_OfferText01":           "The nymph offers several delectable treats.",
    "Eurydice_OfferText02":           "Eurydice offers several delectable treats.",
    "Eurydice_OfferText03":           "The singers offer several delectable treats.",
    # Hermes mute-prompt cues (the only non-vendor "OfferText" entries).
    "Hermes_OfferText01":             "Mute Hermes next time? (He won't mind.)",
    "Hermes_OfferText02":             "Keep muting Hermes? (He won't ask again.)",
    "Hermes_OfferText03":             "Keep muting Hermes? (He won't ask again.)",
    # Megaera + Thanatos + MegaeraWithThanatos romance prompts.
    "Megaera_ChoiceText01":           "Be with Megaera? (Follow your heart.)",
    "Megaera_ChoiceText02":           "Be with Megaera? (Either way, it will be OK.)",
    "MegaeraWithThanatos_ChoiceText01": "Be with Meg and Than? (If you want.)",
    "Thanatos_ChoiceText01":          "Go to Thanatos? (Follow your heart.)",
    "Thanatos_ChoiceText02":          "Go to Thanatos? (Either way, it will be OK.)",
    # Orpheus music selection prompt.
    "Orpheus_OfferText01":            "Orpheus wishes to know your choice of music.",
    # Patroclus's vendor lines (Elysium).
    "Patroclus_OfferText02":          "Patroclus offers one of several premium goods.",
    "Patroclus_OfferText03":          "The shade offers one of several premium goods.",
    "Patroclus_OfferText04":          "The shade still offers one of his premium goods.",
    "Patroclus_OfferText05":          "Patroclus still offers one of his premium goods.",
    # Sisyphus's vendor line (Tartarus).
    "Sisyphus_OfferText01":           "Sisyphus furtively offers a choice of benefits.",
}
