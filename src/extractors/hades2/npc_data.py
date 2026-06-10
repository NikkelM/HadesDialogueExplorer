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
* Per-owner section-key extraction via the H2 textline-set walker
  (which delegates gates to :mod:`.req_extractor`).
* ``HADES2_SPEAKERS`` lookup for "is this owner a real speaker?"
  filtering - owners not in the speaker dict (templates like
  ``NPC_Neutral`` / ``NPC_Giftable``) get extracted but only
  contribute textlines if they happen to declare any (none do in
  the current game data).

Deferred to follow-ups (each has its own todo):

* ``VariantSetData.NPC_<Char>_01`` containers (4 characters: Eris,
  Heracles, Icarus, Nemesis) - structurally identical to
  ``UnitSetData`` so the same walker will work once the discovery
  loop adds the second prefix.
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


def extract_npc_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
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
    return result


def _build_owner_entry(
    owner_id: str,
    owner_table: LuaTable,
    source_label: str,
    source_file: str,
    *,
    named_requirements: dict = None,
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
    )
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
