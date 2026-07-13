"""
Semantic extractor for Hades II NPC data files.

Where H1 ships a single 12 MB ``NPCData.lua`` registering every NPC
under ``UnitSetData.NPCs``, H2 splits the same data across one master
``NPCData.lua`` (defining templates like ``NPC_Neutral`` /
``NPC_Giftable``, the player-character variants, and shared
``PresetEventArgs``) plus 23 per-character ``NPCData_<Char>.lua`` files,
each declaring a top-level ``UnitSetData.NPC_<Char>`` container holding
one or more owner entries (e.g. ``NPC_Artemis_01`` plus the field
variant ``NPC_Artemis_Field_01``).

This extractor walks every top-level ``UnitSetData.NPC_*`` table in a
parsed Lua file, iterates the owner entries inside, and delegates
section-key extraction to :func:`.textline_set.extract_textline_sections`.
The output dict matches the shape produced by
:func:`src.extractors.hades1.npc_data.extract_npc_data` so the merge /
build pipeline consumes both games uniformly.

Currently in scope for the first H2 NPCData cut:

* ``UnitSetData.NPC_<Char>`` top-level discovery (the only owner
  parent in the per-character files; the master ``NPCData.lua`` adds
  ``UnitSetData.NPCs`` for the player + templates, see below).
* ``VariantSetData.NPC_<Char>_01`` containers for the four
  characters with per-context variants (Eris, Heracles, Icarus,
  Nemesis). Each top-level entry inside is a context-named variant
  (``HeraclesShopping``, ``IcarusHome``, ``NemesisCombat`` etc.)
  that carries its own ``InteractTextLineSets`` / ``GiftTextLineSets``
  / etc. Variant entries are attributed to the genus owner derived
  from the container key (e.g. ``NPC_Heracles_01``) and merged
  section-by-section into any existing UnitSetData entry for the
  same owner. Variant-container fields that are NOT context
  variants (``GameStateRequirements`` / ``Cooldowns`` /
  ``ObjectType`` / bare positional cues etc.) are filtered out by
  the "must yield at least one non-empty textline section" gate
  inside :func:`.textline_set.extract_textline_sections`.
* Per-owner section-key extraction via the H2 textline-set walker
  (which delegates gates to :mod:`.req_extractor`).
* ``HADES2_SPEAKERS`` lookup for "is this owner a real speaker?"
  filtering - owners not in the speaker dict (templates like
  ``NPC_Neutral`` / ``NPC_Giftable``) get extracted but only
  contribute textlines if they happen to declare any (none do in
  the current game data).

Deferred to follow-ups (each has its own todo):

* Inheritance flattening (``InheritFrom = { "NPC_Neutral",
  "NPC_Giftable" }``) - templates rarely add textline sections in
  H2 so most owner entries already carry the complete picture
  without inheritance. Will land when an owner relies on inherited
  sections.
* ``CopyDataFromPartner = true`` partner-stub resolution (the H2
  replacement for H1's ``Skip = true`` partner marker). Affects
  xWithY dialogues; the canonical side ships the cues, the stub
  side gets re-keyed onto it. Surfacing happens via the textline's
  ``partner`` field today; the rehoming step is the follow-up.
* Owner-name aliases for non-canonical entries that inherit from
  another id and only carry a handful of scene-specific lines
  (analogous to H1's ``NPC_Hades_Story_01`` -> ``NPC_Hades_01``
  alias). H2's ``_Story`` / ``_Field`` variants are intentionally
  kept as distinct speaker ids (see the
  :mod:`src.extractors.hades2.speakers` docstring) so they do NOT
  alias.
"""

import re

from ...lua_parser import LuaTable
from .textline_set import extract_textline_sections
from .section_keys import HADES2_TEXTLINE_SECTION_KEYS


# Per-character file pattern: ``UnitSetData.NPC_Artemis``, ``UnitSetData.NPC_Hades``,
# etc. The master ``NPCData.lua`` adds ``UnitSetData.NPCs`` (note the
# plural - H1's container name) holding the player + templates;
# matching both with one regex keeps the discovery loop a single pass.
_UNIT_SET_DATA_RE = re.compile(r"^UnitSetData\.(?:NPCs|NPC_\w+)$")

# ``VariantSetData.NPC_<Char>_01`` holds per-context variants for the
# four characters that use them (Eris, Heracles, Icarus, Nemesis). The
# container key encodes the genus owner id directly; variant entries
# inside (``HeraclesShopping`` / ``NemesisCombat`` etc.) are merged
# section-by-section onto that owner.
_VARIANT_SET_DATA_RE = re.compile(r"^VariantSetData\.(NPC_\w+_\d+)$")


def extract_npc_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
    hero_repeatable_sets: dict = None,
) -> dict:
    """Extract H2 NPC dialogue data from a parsed Lua file.

    Returns a dict keyed by owner id (``NPC_Artemis_01`` etc.) shaped
    like::

        {
            "NPC_Artemis_01": {
                "source": "Hades 2",
                "InteractTextLineSets": {...},
                "GiftTextLineSets": {...},
            },
            "NPC_Artemis_Field_01": {...},
        }

    Owners with zero non-empty section entries are dropped so they
    don't pollute the speaker list (matches H1 ``_build_owner_entry``
    behaviour).

    UnitSetData containers are processed first so their entries
    become the canonical "base" for each owner; VariantSetData
    entries are then merged in section-by-section with
    first-write-wins on per-textline collisions, so a UnitSetData-
    defined textline is never overwritten by a variant-defined one
    with the same name.

    The ``game_data_lists`` / ``offer_text_map`` / ``preset_choices``
    parameters mirror :func:`src.extractors.hades1.npc_data.extract_npc_data`
    for API compatibility with the generic generate-data pipeline.
    They aren't used by the H2 textline walker today (H2 has no
    ``GameData.X`` bare-identifier refs in requirements, no
    ``MiscText.en.sjson`` offer-text indirection, and no
    ``PresetEventArgs`` choice indirection in cues), but accepting
    them keeps :mod:`generate_data` callable with a uniform call
    signature across both games. ``named_requirements`` is H2-only and
    enables inline expansion of ``NamedRequirements`` refs (see the
    :func:`.textline_set.extract_textline_sections` docstring).
    """
    result = {}

    # Pass 1: UnitSetData (canonical owner definitions).
    for key, value in parsed.items():
        if not _UNIT_SET_DATA_RE.match(key):
            continue
        if not isinstance(value, LuaTable):
            continue
        for owner_id, owner_table in value.named.items():
            if not isinstance(owner_table, LuaTable):
                continue
            entry = _build_owner_entry(
                owner_id, owner_table, source_label, source_file,
                named_requirements=named_requirements,
                hero_repeatable_sets=hero_repeatable_sets,
                game_data_lists=game_data_lists,
            )
            if entry is None:
                continue
            # First-write-wins for cross-file owner collisions. In
            # practice each character lives in exactly one
            # ``NPCData_<Char>.lua`` file so this is a no-op, but the
            # guard keeps the master ``NPCData.lua`` template entries
            # (``NPC_Neutral`` etc.) from clobbering per-character
            # owners if a future patch ever re-uses the same id.
            result.setdefault(owner_id, entry)

    # Pass 2: VariantSetData (per-context variants merged onto the
    # genus owner). Run after pass 1 so UnitSetData textlines remain
    # canonical when a variant happens to redefine a same-named one.
    for key, value in parsed.items():
        match = _VARIANT_SET_DATA_RE.match(key)
        if not match:
            continue
        if not isinstance(value, LuaTable):
            continue
        owner_id = match.group(1)
        for variant_name, variant_table in value.named.items():
            if not isinstance(variant_table, LuaTable):
                continue
            variant_sections = extract_textline_sections(
                owner_id, variant_table, source_file,
                section_keys=HADES2_TEXTLINE_SECTION_KEYS,
                default_speaker=owner_id,
                named_requirements=named_requirements,
                hero_repeatable_sets=hero_repeatable_sets,
                game_data_lists=game_data_lists,
            )
            # Skip container-level fields (GameStateRequirements,
            # Cooldowns, ObjectType, etc.) - they yield no textline
            # sections so the "any non-empty" gate filters them out.
            if not any(variant_sections.values()):
                continue
            _merge_variant_sections(result, owner_id, source_label, variant_sections)

    return result


def _merge_variant_sections(
    result: dict, owner_id: str, source_label: str, variant_sections: dict,
) -> None:
    """Merge a variant's extracted sections into the owner entry.

    Creates the owner entry on first call (so an owner that only
    appears in VariantSetData and never in UnitSetData still
    surfaces). Subsequent calls merge per-section, preserving
    existing textlines on name collision (UnitSetData / earlier
    variant wins).
    """
    entry = result.get(owner_id)
    if entry is None:
        entry = {"source": source_label}
        result[owner_id] = entry
    for section_key, textlines in variant_sections.items():
        if not textlines:
            continue
        existing = entry.setdefault(section_key, {})
        for tl_name, tl_data in textlines.items():
            existing.setdefault(tl_name, tl_data)


def _build_owner_entry(
    owner_id: str,
    owner_table: LuaTable,
    source_label: str,
    source_file: str,
    *,
    named_requirements: dict = None,
    hero_repeatable_sets: dict = None,
    game_data_lists: dict = None,
):
    """Return the owner entry dict, or ``None`` if the owner has no textlines.

    Returning ``None`` drops template / skeleton entries
    (``NPC_Neutral`` / ``NPC_Giftable`` / empty stub inheritors) so
    they don't show up as speakerless owners in the merged graph.
    Mirrors the H1 behaviour in
    :func:`src.extractors.hades1.npc_data._build_owner_entry`.
    """
    sections = extract_textline_sections(
        owner_id, owner_table, source_file,
        section_keys=HADES2_TEXTLINE_SECTION_KEYS,
        default_speaker=owner_id,
        named_requirements=named_requirements,
        hero_repeatable_sets=hero_repeatable_sets,
        game_data_lists=game_data_lists,
    )
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
