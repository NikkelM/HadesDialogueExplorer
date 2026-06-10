"""
Semantic extractor for Hades II per-god LootData files.

Where H1 ships all god boons in a single ``LootData.lua`` keyed under
the top-level ``LootData`` container, H2 splits the same data across
one master ``LootData.lua`` (defining ``LootSetData.Loot`` templates
and shared reward stores) plus 12 per-god ``LootData_<God>.lua`` files,
each declaring a top-level ``LootSetData.<God>`` container holding one
or more owner entries.

Owner naming is consistent: ``<God>Upgrade`` (Aphrodite -> AphroditeUpgrade,
Apollo -> ApolloUpgrade, ...), with two exceptions documented in
:data:`LOOT_DEFAULT_SPEAKERS`:

* ``LootSetData.Chaos`` -> ``TrialUpgrade`` (the boon offered by
  Chaos's Trial event, not a regular "<God>Upgrade").
* ``LootSetData.Selene`` -> ``SpellDrop`` (Selene grants Hex spells,
  not boons - the H2 vocabulary keeps the data shape but renames the
  owner accordingly).

The owner key is NOT itself the canonical speaker (the H1 pattern -
see ``LOOT_DEFAULT_SPEAKERS`` in :mod:`src.extractors.hades1.loot_data`),
so each owner is mapped to its god's NPC id for the cue speaker
fallback. The one exception is ``HermesUpgrade``, which is itself a
canonical speaker id (the boon-offer Hermes carries the bulk of his
dialogue, vs the running ``NPC_Hermes_01`` Field variant - see the
:mod:`src.extractors.hades2.speakers` docstring); leaving it
unmapped here lets the textline walker's owner-fallback path emit
``HermesUpgrade`` as the speaker, which matches HADES2_SPEAKERS.
"""

import re

from ...lua_parser import LuaTable
from .textline_set import extract_textline_sections
from .section_keys import HADES2_TEXTLINE_SECTION_KEYS


# Top-level container key pattern. Per-god files use
# ``LootSetData.<God>``; the master ``LootData.lua`` uses
# ``LootSetData.Loot`` which holds only template entries (filtered out
# by the empty-owner drop downstream). Matching both with one regex
# keeps the discovery loop a single pass.
_LOOT_SET_DATA_RE = re.compile(r"^LootSetData\.\w+$")


# Maps the per-owner key to the canonical speaker id used for cue
# lines without an explicit ``Speaker`` field. Owners not in the map
# fall back to the owner key itself - intentional for
# ``HermesUpgrade`` which IS a registered speaker id (see module
# docstring). Other owners produced by the master template file
# (``BaseLoot`` / ``StackUpgrade`` etc.) carry no textlines and are
# dropped by ``_build_owner_entry`` before this map is consulted.
LOOT_DEFAULT_SPEAKERS = {
    "AphroditeUpgrade":   "NPC_Aphrodite_01",
    "ApolloUpgrade":      "NPC_Apollo_01",
    "AresUpgrade":        "NPC_Ares_01",
    "DemeterUpgrade":     "NPC_Demeter_01",
    "HephaestusUpgrade":  "NPC_Hephaestus_01",
    "HeraUpgrade":        "NPC_Hera_01",
    "HestiaUpgrade":      "NPC_Hestia_01",
    "PoseidonUpgrade":    "NPC_Poseidon_01",
    "ZeusUpgrade":        "NPC_Zeus_01",
    # Non-"<God>Upgrade" owners.
    "TrialUpgrade":       "NPC_Chaos_01",   # LootSetData.Chaos
    "SpellDrop":          "NPC_Selene_01",  # LootSetData.Selene
    # ``HermesUpgrade`` intentionally absent - it is itself a canonical
    # speaker id and the owner-fallback path in the textline walker
    # already emits it for unattributed cues.
}


def extract_loot_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
) -> dict:
    """Extract H2 god-boon dialogue data from a parsed Lua file.

    Returns a dict keyed by owner id (``ZeusUpgrade`` etc.) shaped
    identically to :func:`src.extractors.hades2.npc_data.extract_npc_data`'s
    output so the merge pipeline consumes both uniformly::

        {
            "ZeusUpgrade": {
                "source": "Hades 2",
                "InteractTextLineSets": {...},
                "GiftTextLineSets": {...},
                ...
            },
            ...
        }

    Owners with zero non-empty sections are dropped so templates from
    ``LootSetData.Loot`` (``BaseLoot`` / ``StackUpgrade`` / ...) and
    helper entries like ``LootSetData.Apollo.Using`` (which carries
    only animation data) don't pollute the speaker list. Mirrors the
    H1 LootData behaviour.

    The ``game_data_lists`` / ``offer_text_map`` / ``preset_choices``
    parameters are accepted for API compatibility with the generic
    generate-data pipeline; H2 doesn't use them (no
    ``GameData.X`` bare-identifier requirement refs, no
    ``MiscText.en.sjson`` offer-text indirection, no
    ``PresetEventArgs`` boon-choice indirection - inline ``Choices``
    blocks instead, handled directly when ``h2-choices`` lands).
    """
    result = {}
    for key, value in parsed.items():
        if not _LOOT_SET_DATA_RE.match(key):
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
    """Return the owner entry dict, or ``None`` if it has no textlines."""
    sections = extract_textline_sections(
        owner_id, owner_table, source_file,
        section_keys=HADES2_TEXTLINE_SECTION_KEYS,
        default_speaker=LOOT_DEFAULT_SPEAKERS.get(owner_id),
        named_requirements=named_requirements,
    )
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
