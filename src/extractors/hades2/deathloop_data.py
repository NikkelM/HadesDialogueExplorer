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

H1 used an idmap-collapse rule to send all inspect-point textlines to
a single ``Storyteller`` owner; H2 mirrors that pattern but the
canonical speaker id is :data:`HUB_NARRATOR_SPEAKER` (``Speaker_Homer``).
Inspect points and ``OnLoadEvents`` ``PostPortraitTextLines`` therefore
both collapse to one owner: surfacing each numeric inspect-point id as
its own entry would flood the viewer with hundreds of meaningless ids
without adding signal (the per-textline ``sourceFile:sourceLine``
pointer preserved by :func:`extract_textline` is the traceback path
back to the originating container).

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


# Canonical speaker id for the hub narrator. Matches the registered
# ``Speaker_Homer`` entry in :data:`HADES2_SPEAKERS`. Mirrors the H1
# DeathLoopData ``InspectPoints -> Storyteller`` collapse rule, just
# renamed to the H2 vocabulary (H2 has no ``Storyteller``).
HUB_NARRATOR_SPEAKER = "Speaker_Homer"


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

    Returns a single-owner dict shaped like::

        {
            "Speaker_Homer": {
                "source": "Hades 2",
                "InteractTextLineSets": {...},
                "PostPortraitTextLines": {...},
            }
        }

    Returns ``{}`` when no dialogue-bearing nodes are found (defensive
    against future structural shifts; current data always yields
    ~45 textlines).

    ``game_data_lists`` / ``offer_text_map`` / ``preset_choices`` are
    accepted for pipeline API compatibility (see the NPC extractor's
    docstring).
    """
    hub_root = parsed.get("HubRoomData")
    if not isinstance(hub_root, LuaTable):
        return {}

    collapsed = {}
    for hub_table in hub_root.named.values():
        if not isinstance(hub_table, LuaTable):
            continue
        _collect_inspect_points(hub_table, collapsed, source_file, named_requirements)
        _collect_on_load_events(hub_table, collapsed, source_file, named_requirements)

    if not collapsed:
        return {}

    entry = {"source": source_label}
    entry.update(collapsed)
    return {HUB_NARRATOR_SPEAKER: entry}


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
