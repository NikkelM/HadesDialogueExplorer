"""Hades II ``NarrativeData.lua`` priority extractor.

Unlike Hades I, which encodes narrative priority via wrapping container
shapes (``PrioritizedTextLineSet`` / ``SuperPrioritizedTextLineSet``)
attached directly to the data containers in each
``NPCData_<Char>.lua`` / ``LootData_<God>.lua`` etc., Hades II keeps
priority ordering in a separate registry file:
``Content/Scripts/NarrativeData.lua``.

That file is one large ``OverwriteTableKeys( NarrativeData, { ... } )``
call whose body is a dict keyed by owner id (matching the owner id
emitted by :func:`extract_npc_data` / :func:`extract_loot_data` /
:func:`extract_enemy_data`) - e.g. ``NPC_Hecate_01``, ``HermesUpgrade``,
``Chronos``. Each owner contains zero or more
``<SectionStem>TextLinePriorities`` keys, whose value is an *ordered*
list of textline-name entries; the list defines the order in which the
game's eligibility check walks candidate textlines (earlier = higher
priority).

Each list entry is either:

* a bare string - a single textline name occupying its own priority
  slot;
* an inline sub-table ``{"NameA", "NameB", ...}`` - a *cluster* of
  textlines that share a single priority slot (the game's eligibility
  walker will pick one of them at random / based on its own internal
  rules).

The output of :func:`extract_narrative_priorities` is shaped to be
applied as a per-textline annotation by the merge pipeline (see the
H1 ``narrativePrioritySectionTier`` / ``narrativePrioritySetLevel``
fields for the H1 analogue surfaced in the viewer):

.. code-block:: python

    {
        "NPC_Hecate_01": {
            "InteractTextLineSets": {
                "HecateBathHouseEpilogue01": {
                    "narrativePriorityOrdinal": 1,
                    "narrativePrioritySectionSize": 47,
                    "narrativePriorityClusterMembers": [],
                },
                "HecatePostTrueEnding01": {
                    "narrativePriorityOrdinal": 2,
                    "narrativePrioritySectionSize": 47,
                    "narrativePriorityClusterMembers": [],
                },
                ...
            },
            "GiftTextLinePriorities": {...},
        },
        "Chronos": {
            "BossIntroTextLineSets": {
                "ChronosBossAboutTyphon01": {
                    "narrativePriorityOrdinal": 18,
                    "narrativePrioritySectionSize": 42,
                    "narrativePriorityClusterMembers": [],
                },
                "ChronosBossAboutHades02": {
                    "narrativePriorityOrdinal": 19,
                    "narrativePrioritySectionSize": 42,
                    "narrativePriorityClusterMembers": ["ChronosBossAboutGameplayTimer02"],
                },
                "ChronosBossAboutGameplayTimer02": {
                    "narrativePriorityOrdinal": 19,
                    "narrativePrioritySectionSize": 42,
                    "narrativePriorityClusterMembers": ["ChronosBossAboutHades02"],
                },
                ...
            },
        },
    }

Section-key remap
-----------------

NarrativeData uses ``<Stem>TextLinePriorities`` keys; the matching
data-section keys emitted by the H2 textline extractors are
``<Stem>TextLineSets`` (most cases) or ``<Stem>TextLines`` (the *Lines*
plurals). :func:`_section_key_for` resolves the mapping by checking
both candidates against :data:`HADES2_TEXTLINE_SECTION_KEYS` so the
output uses the same key the merge pipeline already keys textlines on.

Comment-cluster markers (Lua ``-- foo`` lines preceding groups of
priority entries) are *not* extracted by this module - they live in
the raw Lua source, not in the parsed value tree, and the
purely-structural priority information is the primary value. They
remain available for a future raw-text pre-pass should the viewer
ever need to display them as cluster headers.
"""

from typing import Dict, Optional

from src.lua_parser import LuaTable

from .section_keys import HADES2_TEXTLINE_SECTION_KEYS


# Suffix attached to every priority-list key in NarrativeData.lua.
_PRIORITIES_SUFFIX = "TextLinePriorities"


def _section_key_for(priority_key: str) -> Optional[str]:
    """Resolve a NarrativeData ``<Stem>TextLinePriorities`` key to the
    matching textline-section key used by the textline extractors.

    Returns ``None`` if the key doesn't look like a priority list, or
    if neither the ``<Stem>TextLineSets`` nor ``<Stem>TextLines``
    candidate is in :data:`HADES2_TEXTLINE_SECTION_KEYS` (defensive
    against future game patches introducing a new family without our
    extractor having a matching section key yet).
    """
    if not priority_key.endswith(_PRIORITIES_SUFFIX):
        return None
    stem = priority_key[: -len(_PRIORITIES_SUFFIX)]
    for candidate in (stem + "TextLineSets", stem + "TextLines"):
        if candidate in HADES2_TEXTLINE_SECTION_KEYS:
            return candidate
    return None


def _iter_priority_slots(priority_list):
    """Yield ``(ordinal, [textline_names])`` tuples from a parsed
    NarrativeData priority list.

    Accepts either a :class:`LuaTable` (parser output - positional
    entries live in ``.array``) or a plain :class:`list` (for test
    fixtures and callers operating on already-converted data).

    Each yielded slot represents one priority rank. Solo entries yield
    a single-element name list; cluster sub-tables yield the full
    list of cluster siblings. Non-string / non-table entries (Lua
    ``nil`` placeholders, etc.) are silently skipped - they would
    only appear via malformed data and shouldn't crash the
    extractor.
    """
    if isinstance(priority_list, LuaTable):
        entries = list(priority_list.array)
    elif isinstance(priority_list, list):
        entries = list(priority_list)
    else:
        return
    ordinal = 0
    for entry in entries:
        if isinstance(entry, str):
            ordinal += 1
            yield ordinal, [entry]
        elif isinstance(entry, LuaTable):
            members = [m for m in entry.array if isinstance(m, str)]
            if not members:
                continue
            ordinal += 1
            yield ordinal, members
        elif isinstance(entry, list):
            members = [m for m in entry if isinstance(m, str)]
            if not members:
                continue
            ordinal += 1
            yield ordinal, members


def extract_narrative_priorities(parsed) -> Dict[str, Dict[str, Dict[str, dict]]]:
    """Extract per-textline narrative priority metadata from a parsed
    ``NarrativeData.lua``.

    Parameters
    ----------
    parsed:
        Output of :class:`src.lua_parser.LuaParser.parse_file` over
        ``Content/Scripts/NarrativeData.lua``. Must contain a
        top-level ``NarrativeData`` table (the
        ``OverwriteTableKeys`` call unwrapping populated by the
        parser).

    Returns
    -------
    dict
        ``{owner_id: {section_key: {textline_name: priority_data}}}``.
        ``priority_data`` carries three fields per textline:

        * ``narrativePriorityOrdinal`` - 1-based rank in the priority
          list (entries inside a cluster sub-table share their
          cluster's ordinal).
        * ``narrativePrioritySectionSize`` - the total number of
          ordinal slots in this owner / section's priority list (i.e.
          the highest ordinal that occurs).
        * ``narrativePriorityClusterMembers`` - the *other* textline
          names tied at this ordinal (excluding this textline). Empty
          list for solo entries.

    Owners whose priority value is malformed (not a table) are
    skipped silently; section keys that don't resolve to a known
    textline section key are also skipped.
    """
    result: Dict[str, Dict[str, Dict[str, dict]]] = {}
    narrative_data = parsed.get("NarrativeData") if isinstance(parsed, (dict, LuaTable)) else None
    if narrative_data is None:
        return result
    owners = narrative_data.items() if isinstance(narrative_data, LuaTable) else narrative_data.items()
    for owner_id, owner_data in owners:
        if not isinstance(owner_id, str):
            continue
        if not isinstance(owner_data, (dict, LuaTable)):
            continue
        sections_iter = owner_data.items() if isinstance(owner_data, LuaTable) else owner_data.items()
        owner_out: Dict[str, Dict[str, dict]] = {}
        for priority_key, priority_list in sections_iter:
            if not isinstance(priority_key, str):
                continue
            section_key = _section_key_for(priority_key)
            if section_key is None:
                continue
            slots = list(_iter_priority_slots(priority_list))
            if not slots:
                continue
            section_size = slots[-1][0]
            section_out: Dict[str, dict] = {}
            for ordinal, members in slots:
                for name in members:
                    siblings = [m for m in members if m != name]
                    section_out[name] = {
                        "narrativePriorityOrdinal": ordinal,
                        "narrativePrioritySectionSize": section_size,
                        "narrativePriorityClusterMembers": siblings,
                    }
            if section_out:
                owner_out[section_key] = section_out
        if owner_out:
            result[owner_id] = owner_out
    return result


def iter_priority_keys(
    priorities: Dict[str, Dict[str, Dict[str, dict]]],
):
    """Yield every ``(owner_id, section_key, textline_name)`` tuple present
    in a ``priorities`` mapping.

    Pairs with the ``attached_keys`` accumulator parameter on
    :func:`apply_narrative_priorities` so the caller can compute the
    difference (priority records that no source ever consumed) at the
    end of the H2 generation pass.

    See :func:`find_unattached_priority_groups` for the noise-filtered
    audit variant that is what callers usually want; this raw iterator
    is exposed for tests and ad-hoc diagnostics.
    """
    for owner_id, sections in priorities.items():
        for section_key, textline_map in sections.items():
            for textline_name in textline_map:
                yield (owner_id, section_key, textline_name)


def find_unattached_priority_groups(
    priorities: Dict[str, Dict[str, Dict[str, dict]]],
    attached_keys: set,
) -> list:
    """Return ``(owner_id, section_key, textline_name)`` tuples for
    priority records whose entire cluster failed to attach to any
    source.

    Cluster sub-entries are expected orphans when their cluster leader
    has a dialogue body but they don't (a pure ordering hint). Filtering
    those out keeps the surfaced list focused on records that likely
    indicate real drift between NarrativeData and the per-source
    extractors (renamed owner, renamed section key, renamed textline,
    or extractor not yet wired).

    Sorted for deterministic build output. Returns an empty list when
    every priority record is accounted for either directly or via a
    cluster sibling.
    """
    unattached = []
    for owner_id, sections in priorities.items():
        for section_key, textline_map in sections.items():
            for textline_name, record in textline_map.items():
                key = (owner_id, section_key, textline_name)
                if key in attached_keys:
                    continue
                cluster_members = record.get("narrativePriorityClusterMembers") or []
                if any(
                    (owner_id, section_key, sibling) in attached_keys
                    for sibling in cluster_members
                ):
                    continue
                unattached.append(key)
    unattached.sort()
    return unattached


def apply_narrative_priorities(
    owners_data: Dict[str, dict],
    priorities: Dict[str, Dict[str, Dict[str, dict]]],
    attached_keys: Optional[set] = None,
) -> int:
    """Attach narrative-priority annotations from ``priorities`` onto
    each matching textline in ``owners_data`` in place.

    Parameters
    ----------
    owners_data:
        Cross-owner extracted textline data of the shape produced by
        :func:`extract_npc_data` / :func:`extract_loot_data` /
        :func:`extract_enemy_data` / etc. -
        ``{owner_id: {section_key: {textline_name: textline_data,
        ...}, 'source': str}}``.
    priorities:
        Output of :func:`extract_narrative_priorities`.
    attached_keys:
        Optional mutable set into which every successfully-attached
        ``(owner_id, section_key, textline_name)`` tuple is recorded.
        The build pipeline passes a shared accumulator across all H2
        sources so unattached priority records can be reported at the
        end of the pass (see :func:`iter_priority_keys`). Omitted by
        the unit tests, which only assert the return-value count.

    Returns
    -------
    int
        Count of textlines that received a priority annotation. Useful
        for build-pipeline diagnostics ("attached N of M priority
        records").

    Per-call mismatches are expected: ``apply_narrative_priorities`` is
    invoked once per H2 source file with the *global* ``priorities``
    dict but only the *per-source* ``owners_data``. A priority record
    correctly attaches to whichever single source ships its target
    textline; the global cross-source orphan check happens in the
    caller via ``iter_priority_keys`` minus the accumulated
    ``attached_keys`` set.
    """
    attached = 0
    for owner_id, sections in priorities.items():
        owner_data = owners_data.get(owner_id)
        if not isinstance(owner_data, dict):
            continue
        for section_key, textline_map in sections.items():
            section_data = owner_data.get(section_key)
            if not isinstance(section_data, dict):
                continue
            for textline_name, priority_record in textline_map.items():
                textline_data = section_data.get(textline_name)
                if not isinstance(textline_data, dict):
                    continue
                textline_data.update(priority_record)
                attached += 1
                if attached_keys is not None:
                    attached_keys.add((owner_id, section_key, textline_name))
    return attached
