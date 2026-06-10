"""Friendly display names for Hades 1 ``MetaUpgrade`` (Mirror of Night) ids.

Some boon-vendor choice options are gated on whether the player has a
particular Mirror of Night upgrade active. The Lua source records the
internal upgrade id (e.g. ``ExtraChanceMetaUpgrade``); the in-game
display name (e.g. "Death Defiance") lives in ``HelpText.en.sjson``.

The viewer surfaces the upgrade requirement as an extra tooltip line on
the affected choice option ("Requires Death Defiance (Mirror of
Night)") so a reader can immediately see which mirror upgrade unlocks
the option without leaving the page.

This map only needs to cover meta upgrades that are actually referenced
by a ``RequiredActiveMetaUpgrade`` field in the vendored preset choice
tables (see :data:`HADES1_PRESET_CHOICES`). Other upgrades stay
unmapped: the viewer falls back to the raw internal id so unknown
upgrades still surface correctly with no friendly label.

Vendoring rationale: matches the pattern used for every other
cross-reference data file in this package (``HADES1_SPEAKERS``,
``HADES1_OFFER_TEXT_MAP``, ``HADES1_CHOICE_NAMES``,
``HADES1_PRESET_CHOICES``) - changes are visible in ``git diff`` and
there's no runtime file dependency.
"""

HADES1_META_UPGRADE_NAMES = {
    # Mirror of Night row: the two halves of "Death Defiance".
    # ``ExtraChanceMetaUpgrade`` is the basic/original variant; the
    # ``Replenish`` variant is the alternative side toggled from the
    # mirror's back face. Only one is active at a time.
    "ExtraChanceMetaUpgrade":          "Death Defiance",
    "ExtraChanceReplenishMetaUpgrade": "Stubborn Defiance",
}
