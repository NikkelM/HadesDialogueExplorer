"""
Semantic extractor for Hades II ``DeathLoopData.lua``.

H2's hub-room content lives under ``HubRoomData.<HubName>`` (data is
injected via the top-level ``OverwriteTableKeys( HubRoomData, { ... } )``
call, which the parser unwraps automatically). The dialogue-bearing
nodes are:

* ``HubRoomData.<Hub>.InspectPoints.<NumericId>.InteractTextLineSets``
  - the ambient "examine this object/place" narration spoken by Homer
  as the storyteller. Every cue in this surface is unattributed
  (no ``Speaker`` field, no ``UsePlayerSource``) and reads as descriptive
  ``{#Emph}``-wrapped prose; ~44 textlines across the three hub variants.
* ``HubRoomData.<Hub>.OnLoadEvents[i].Args.PresentationFunctionArgs.PostPortraitTextLines``
  - story-beat textlines triggered on hub load, gated by the event's
  own ``GameStateRequirements``. Only one textline in current data
  (the true-ending finale response on ``Hub_Main``).
* ``HubRoomData.<Hub>.{Start,}UnthreadedEvents[i].Args.TextLineSet.<TextLineName>``
  - rare flashback narrative beats embedded directly inside event
  ``Args`` blocks (two textlines: ``HecateHideAndSeekIntro01`` and
  ``HadesWithHecate01``). Each carries an inline single named
  textline rather than a textline-set map.

The InspectPoints + PostPortrait narrator surface collapses to a
single :data:`HUB_NARRATOR_SPEAKER` (``Speaker_Homer``) owner -
mirrors H1's ``InspectPoints -> Storyteller`` rule. The flashback
``TextLineSet`` entries are routed via the shared
:data:`TEXTLINE_OWNER_OVERRIDES` table so they end up on the natural
NPC owner (e.g. ``HadesWithHecate01`` -> ``NPC_LordHades_01``)
alongside the rest of that character's dialogue.

Inspect-point-level ``SetupGameStateRequirements`` and event-level
``GameStateRequirements`` are lifted onto each contained textline via
:func:`merge_ancestor_requirements_h2` so the graph picks up the
container-level gates that the engine evaluates alongside the
textline's own requirements.
"""

from ...lua_parser import LuaTable
from .textline_set import (
    extract_textline_sections,
    merge_ancestor_requirements_h2,
)
from .section_keys import HADES2_TEXTLINE_SECTION_KEYS
from .owner_overrides import (
    HUB_NARRATOR_SPEAKER,
    TEXTLINE_OWNER_OVERRIDES,
)


# ``StartUnthreadedEvents`` and ``UnthreadedEvents`` are the two
# event-list keys on a hub table that have been observed to carry
# inline ``Args.TextLineSet`` flashback entries. Walking both keeps
# the extractor future-proof against the engine reshuffling events
# between the two lists (it does this routinely in H1 / H2 patches).
_HUB_EVENT_KEYS = ("StartUnthreadedEvents", "UnthreadedEvents")


def extract_deathloop_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
) -> dict:
    """Extract H2 hub-room narration from a parsed ``DeathLoopData.lua``.

    Returns a multi-owner dict shaped like::

        {
            "Speaker_Homer": {
                "source": "Hades 2",
                "InteractTextLineSets": {...},
                "PostPortraitTextLines": {...},
            },
            "NPC_LordHades_01": {
                "source": "Hades 2",
                "TextLineSet": {"HadesWithHecate01": {...}},
            },
            ...
        }

    Most textlines end up under ``Speaker_Homer`` (narrator collapse
    for InspectPoints + PostPortrait). Flashback ``TextLineSet``
    entries route via :data:`TEXTLINE_OWNER_OVERRIDES` to the
    relevant NPC. Returns ``{}`` when no dialogue-bearing nodes are
    found.

    ``game_data_lists`` / ``offer_text_map`` / ``preset_choices`` are
    accepted for pipeline API compatibility (see the NPC extractor's
    docstring).
    """
    hub_root = parsed.get("HubRoomData")
    if not isinstance(hub_root, LuaTable):
        return {}

    narrator_sections: dict = {}
    rerouted: list = []  # list[(owner_name, section_key, tl_name, tl_data)]
    for hub_table in hub_root.named.values():
        if not isinstance(hub_table, LuaTable):
            continue
        _collect_inspect_points(hub_table, narrator_sections, source_file, named_requirements)
        _collect_on_load_events(hub_table, narrator_sections, source_file, named_requirements)
        _collect_event_textline_sets(
            hub_table, narrator_sections, rerouted,
            source_file, named_requirements,
        )

    result: dict = {}
    if narrator_sections:
        entry = {"source": source_label}
        entry.update(narrator_sections)
        result[HUB_NARRATOR_SPEAKER] = entry

    for owner_name, section_key, tl_name, tl_data in rerouted:
        owner_entry = result.setdefault(owner_name, {"source": source_label})
        owner_section = owner_entry.setdefault(section_key, {})
        if tl_name not in owner_section:
            owner_section[tl_name] = tl_data

    return result


def _collect_inspect_points(
    hub_table: LuaTable,
    collapsed: dict,
    source_file: str,
    named_requirements: dict = None,
) -> None:
    """Walk one hub's ``InspectPoints`` map and merge each inspect point's
    textline sections into the collapsed owner dict."""
    inspect_points = hub_table.named.get("InspectPoints")
    if not isinstance(inspect_points, LuaTable):
        return
    for inspect_point in inspect_points.named.values():
        if not isinstance(inspect_point, LuaTable):
            continue
        sections = extract_textline_sections(
            HUB_NARRATOR_SPEAKER, inspect_point, source_file,
            section_keys=HADES2_TEXTLINE_SECTION_KEYS,
            default_speaker=HUB_NARRATOR_SPEAKER,
            named_requirements=named_requirements,
        )
        _lift_and_collapse(sections, inspect_point, collapsed, named_requirements)


def _collect_on_load_events(
    hub_table: LuaTable,
    collapsed: dict,
    source_file: str,
    named_requirements: dict = None,
) -> None:
    """Walk a hub's ``OnLoadEvents`` list and merge each event's nested
    ``PostPortraitTextLines`` (under ``Args.PresentationFunctionArgs``)
    into the collapsed owner dict. The event-level
    ``GameStateRequirements`` (sibling of ``Args``) is lifted onto each
    contained textline so the gating that the engine evaluates before
    firing the event is reflected on the textline."""
    events = hub_table.named.get("OnLoadEvents")
    if not isinstance(events, LuaTable):
        return
    for event in events.array:
        if not isinstance(event, LuaTable):
            continue
        args = event.named.get("Args")
        if not isinstance(args, LuaTable):
            continue
        presentation_args = args.named.get("PresentationFunctionArgs")
        if not isinstance(presentation_args, LuaTable):
            continue
        sections = extract_textline_sections(
            HUB_NARRATOR_SPEAKER, presentation_args, source_file,
            section_keys=HADES2_TEXTLINE_SECTION_KEYS,
            default_speaker=HUB_NARRATOR_SPEAKER,
            named_requirements=named_requirements,
        )
        _lift_and_collapse(sections, event, collapsed, named_requirements)


def _collect_event_textline_sets(
    hub_table: LuaTable,
    narrator_sections: dict,
    rerouted: list,
    source_file: str,
    named_requirements: dict = None,
) -> None:
    """Walk a hub's ``StartUnthreadedEvents`` and ``UnthreadedEvents``
    lists, picking up any ``Args.TextLineSet`` entries (rare inline
    flashback narrative beats).

    Each found textline is routed via :data:`TEXTLINE_OWNER_OVERRIDES`
    to its natural NPC owner if listed, otherwise it collapses to
    :data:`HUB_NARRATOR_SPEAKER` like the rest of the hub narration.

    Event-level ``GameStateRequirements`` (sibling of ``Args``) is
    lifted onto each contained textline via
    :func:`merge_ancestor_requirements_h2`.
    """
    for event_list_key in _HUB_EVENT_KEYS:
        events = hub_table.named.get(event_list_key)
        if not isinstance(events, LuaTable):
            continue
        for event in events.array:
            if not isinstance(event, LuaTable):
                continue
            args = event.named.get("Args")
            if not isinstance(args, LuaTable):
                continue
            tl_set = args.named.get("TextLineSet")
            if not isinstance(tl_set, LuaTable):
                continue
            sections = extract_textline_sections(
                HUB_NARRATOR_SPEAKER, args, source_file,
                section_keys={"TextLineSet"},
                default_speaker=HUB_NARRATOR_SPEAKER,
                named_requirements=named_requirements,
            )
            tl_map = sections.get("TextLineSet")
            if not tl_map:
                continue
            for tl_data in tl_map.values():
                merge_ancestor_requirements_h2(tl_data, event, named_requirements)
            for tl_name in list(tl_map.keys()):
                tl_data = tl_map.pop(tl_name)
                override = TEXTLINE_OWNER_OVERRIDES.get(tl_name)
                if override is not None:
                    owner = override["owner"]
                    partner = override.get("partner")
                    if partner is not None:
                        tl_data.setdefault("partner", partner)
                    if owner == HUB_NARRATOR_SPEAKER:
                        existing = narrator_sections.setdefault("TextLineSet", {})
                        if tl_name not in existing:
                            existing[tl_name] = tl_data
                    else:
                        rerouted.append((owner, "TextLineSet", tl_name, tl_data))
                else:
                    # No override - default to the narrator collapse.
                    existing = narrator_sections.setdefault("TextLineSet", {})
                    if tl_name not in existing:
                        existing[tl_name] = tl_data


def _lift_and_collapse(
    sections: dict,
    ancestor: LuaTable,
    collapsed: dict,
    named_requirements: dict = None,
) -> None:
    """Lift ancestor-level requirements onto each textline in ``sections``
    and merge into ``collapsed`` (insert-if-absent so the first
    definition wins on textline-name collision across hubs / events)."""
    for section_key, tl_map in sections.items():
        if not tl_map:
            continue
        for tl_data in tl_map.values():
            merge_ancestor_requirements_h2(tl_data, ancestor, named_requirements)
        existing = collapsed.setdefault(section_key, {})
        for tl_name, tl_data in tl_map.items():
            if tl_name not in existing:
                existing[tl_name] = tl_data
