"""Vendored preset choice tables for boon-vendor NPC cues (Hades 1).

The boon-vendor NPCs (Sisyphus, Patroclus, Eurydice) end their interactions
with a choice prompt cue that doesn't inline its options::

    {
        Text = "Eurydice_OfferText02",
        Choices = PresetEventArgs.EurydiceBenefitChoices,
        PreLineFunctionName = "ShowUIForDecision",
    },

At runtime the engine resolves the ``PresetEventArgs.<Name>`` Lua reference
to a table of options defined elsewhere in ``NPCData.lua``::

    EurydiceBenefitChoices = {
        { ChoiceText = "ChoiceText_BuffSlottedBoonRarity", ... },
        { ChoiceText = "ChoiceText_BuffMegaPom",           ... },
        { ChoiceText = "ChoiceText_BuffFutureBoonRarity",  ... },
    }

Our Lua parser yields ``LuaIdentifier("PresetEventArgs.X")`` for the
reference - it can't follow the link across the file. We could resolve
the reference dynamically by re-parsing the preset definitions, but
hardcoding the choice lists matches the vendoring pattern used for
every other piece of cross-reference data in this package
(``HADES1_SPEAKERS``, ``HADES1_OFFER_TEXT_MAP``, ``HADES1_CHOICE_NAMES``):

  * Changes are visible in ``git diff`` when the game patches a
    benefit choice list (e.g. adds a new option).
  * No runtime preset-resolution logic to maintain.

Unlike the inline ``Choices = {...}`` choices used by the romance
prompts, boon-vendor choices don't lead to a follow-up dialogue - the
engine immediately calls the choice's ``PostLineFunctionName`` to grant
the benefit. So the viewer renders them as A/B/C lines without
click-through targets.

Maps the preset's bare name (last segment of the ``PresetEventArgs.X``
reference) to an ordered list of choice entries. Each entry is either:

  * A bare ``str`` - the ``ChoiceText`` id, unconditional option.
  * A ``dict`` with required ``id`` plus optional metadata fields:
      - ``requiredMetaUpgrade``: name of the Mirror of Night upgrade
        that must be active for the option to be offered. The viewer
        groups consecutive options that share this restriction (because
        they're mutually exclusive in practice - the player can only
        toggle one variant per mirror row at a time) under a single
        letter with a numeric suffix (A1, A2, ...) and adds a tooltip
        line naming the upgrade. Friendly upgrade names live in
        :data:`HADES1_META_UPGRADE_NAMES`.

Friendly labels for each ``ChoiceText`` id live in
:data:`HADES1_CHOICE_NAMES`.
"""

HADES1_PRESET_CHOICES = {
    # Sisyphus (Tartarus) - three Charon-style resource grants.
    "SisyphusBenefitChoices": [
        "ChoiceText_Healing",
        "ChoiceText_Darkness",
        "ChoiceText_Money",
    ],
    # Patroclus (Elysium) - four buffs. The first two require their
    # respective Mirror of Night upgrades to be active and represent
    # the two halves of the same mirror row (Death Defiance vs
    # Stubborn Defiance); only one is selectable per run, so the
    # viewer renders them as a single grouped choice (A1, A2). The
    # latter two are unconditional.
    "PatroclusBenefitChoices": [
        {"id": "ChoiceText_BuffExtraChance",
         "requiredMetaUpgrade": "ExtraChanceMetaUpgrade"},
        {"id": "ChoiceText_BuffExtraChanceReplenish",
         "requiredMetaUpgrade": "ExtraChanceReplenishMetaUpgrade"},
        "ChoiceText_BuffHealing",
        "ChoiceText_BuffWeapon",
    ],
    # Eurydice (Asphodel) - three boon-related buffs.
    "EurydiceBenefitChoices": [
        "ChoiceText_BuffSlottedBoonRarity",
        "ChoiceText_BuffMegaPom",
        "ChoiceText_BuffFutureBoonRarity",
    ],
}

