"""Attach the viewer's friendly-name lookups (section-key labels,
requirement-type labels, tooltips, display order) to a per-game graph.

The viewer is strictly per-game (one game is rendered at a time;
toggling via the UI swaps datasets wholesale), so the label maps are
also strictly per-game. There is no cross-game union: H1 and H2 each
get their own ``sectionKeyLabels`` / ``reqTypeLabels`` / ``choiceNames``
/ etc. computed solely from their own vocabulary sources.
"""

from src.extractors.hades1 import (
    HADES1_SECTION_KEY_LABELS,
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
    HADES1_REQ_TYPE_LABELS_DEPENDENTS,
    HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS,
    HADES1_OTHER_REQ_LABELS,
    HADES1_OTHER_REQ_TOOLTIPS,
    HADES1_CHOICE_NAMES,
    HADES1_META_UPGRADE_NAMES,
    HADES1_ENTITY_NAMES,
    HADES1_SPEAKERS,
)
from src.extractors.hades2 import (
    HADES2_SECTION_KEY_LABELS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
    HADES2_REQ_TYPE_LABELS_DEPENDENTS,
    HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS,
    HADES2_CHOICE_NAMES,
    HADES2_ENTITY_NAMES,
    HADES2_SPEAKERS,
)
from src.extractors.hades1.hub_rooms import HADES1_HUB_ROOM_NAMES
from src.extractors.hades2.hub_rooms import HADES2_HUB_ROOM_NAMES
from src.extractors.hades1.extra_entities import HADES1_EXTRA_ENTITY_NAMES
from src.extractors.hades2.extra_entities import HADES2_EXTRA_ENTITY_NAMES
from src.extractors.hades2.path_names import (
    HADES2_PATH_SCOPE_NAMES,
    HADES2_PATH_FIELD_NAMES,
    HADES2_PATH_OBJECT_FIELDS,
    HADES2_PATH_FIELD_LEAF_NAMES,
    HADES2_PATH_LITERAL_LEAF_FIELDS,
)
from src.extractors.hades2.broken_path_refs import HADES2_BROKEN_PATH_REFS
from src.extractors.hades1.broken_req_fields import HADES1_BROKEN_REQ_FIELDS
from src.extractors.hades1.badge_rank_names import (
    HADES1_BADGE_RANK_NAMES,
    HADES1_BADGE_RANK_MANAGER,
)
from src.extractors.hades2.badge_rank_names import (
    HADES2_BADGE_RANK_NAMES,
    HADES2_BADGE_RANK_MANAGER,
)
from src.extractors.hades1.flag_names import HADES1_FLAG_NAMES


def _speaker_names(speakers: dict) -> dict:
    """``{speakerId: friendlyName}`` from a HADES*_SPEAKERS map, so speaker /
    NPC / boss ids that appear as ``otherRequirements`` values (e.g. a
    ``Minimum NPC interactions: NPC_Achilles_01`` gate) resolve to the friendly
    name. Entries without a name are skipped."""
    return {sid: e["name"] for sid, e in speakers.items() if e.get("name")}


def _entity_names(sjson_names: dict, speakers: dict, hub_rooms: dict, extra: dict | None = None) -> dict:
    """Compose the viewer's ``entityNames`` lookup from up to four sources, lowest
    priority first: speaker / NPC / boss names, curated hub-room names, curated
    extra entities (resources / kill-source / trap ids with no sjson name), then
    the vendored sjson DisplayName map (boons, keepsakes, weapons, enemies, shrine
    vows, arcana, ...). The sjson map wins on the few id collisions (e.g. a boss
    enemy id shared with its speaker form) because it carries the in-data entity
    name the gate actually refers to."""
    return {**_speaker_names(speakers), **hub_rooms, **(extra or {}), **sjson_names}


# Per-game vocabulary bundles. Each game has its own row and the build
# pipeline calls :func:`annotate_label_maps` once per game with the
# matching ``game`` id.
#
# Adding a new game means:
#   1. Add its extractor exports above.
#   2. Add a new entry to ``_GAME_LABELS`` below.
#   3. Register the game id in ``build_viewer.py``'s game-routing map.
#
# H2 has no meta-upgrade refs in its RequirementSets (only count-based
# ``RequiredMetaUpgradesMin/Max`` gates, no named upgrades), so its
# ``metaUpgradeNames`` is intentionally empty - the viewer's lookup
# falls back to the raw id when an entry is missing.
_GAME_LABELS = {
    "hades1": {
        "sectionKeyLabels": HADES1_SECTION_KEY_LABELS,
        # H1's reqTypeLabels / reqTypeTooltips merge two source maps:
        # the textline-dependency vocabulary (req_types.py) and the
        # non-textline ``otherRequirements`` vocabulary
        # (other_req_types.py). Vocabularies are disjoint by
        # construction (see test_other_req_types.py); the viewer
        # consumes a single flat dict per game.
        "reqTypeLabels": {**HADES1_REQ_TYPE_LABELS, **HADES1_OTHER_REQ_LABELS},
        "reqTypeEdgeLabels": HADES1_REQ_TYPE_EDGE_LABELS,
        "reqTypeTooltips": {**HADES1_REQ_TYPE_TOOLTIPS, **HADES1_OTHER_REQ_TOOLTIPS},
        "reqTypeOrder": HADES1_REQ_TYPE_DISPLAY_ORDER,
        # Dependents-perspective labels / tooltips for the downstream
        # tree view. Only textline-dependency fields appear as
        # downstream edges, so this map is a strict subset of the
        # upstream ``reqTypeLabels``. The viewer falls back to the
        # upstream label (then to the raw field name) when the
        # dependents map has no entry.
        "reqTypeLabelsDependents": HADES1_REQ_TYPE_LABELS_DEPENDENTS,
        "reqTypeTooltipsDependents": HADES1_REQ_TYPE_TOOLTIPS_DEPENDENTS,
        "choiceNames": HADES1_CHOICE_NAMES,
        "metaUpgradeNames": HADES1_META_UPGRADE_NAMES,
        "entityNames": _entity_names(
            HADES1_ENTITY_NAMES, HADES1_SPEAKERS, HADES1_HUB_ROOM_NAMES,
            # Curated extra entities + story-flag / config-option names (both are
            # curated ids with no sjson DisplayName); merged so the operand
            # resolver renders friendly flag names under the flag gate labels.
            {**HADES1_EXTRA_ENTITY_NAMES, **HADES1_FLAG_NAMES},
        ),
        # H1 uses flat named otherRequirements fields, not dotted save-state
        # paths, so it has no path vocabulary.
        "pathScopeNames": {},
        "pathFieldNames": {},
        "pathObjectFields": [],
        "pathFieldLeafNames": {},
        "pathLiteralLeafFields": [],
        "brokenPathRefs": {},
        "brokenReqFields": HADES1_BROKEN_REQ_FIELDS,
        "badgeRankNames": HADES1_BADGE_RANK_NAMES,
        "badgeRankManager": HADES1_BADGE_RANK_MANAGER,
    },
    "hades2": {
        "sectionKeyLabels": HADES2_SECTION_KEY_LABELS,
        "reqTypeLabels": HADES2_REQ_TYPE_LABELS,
        "reqTypeEdgeLabels": HADES2_REQ_TYPE_EDGE_LABELS,
        "reqTypeTooltips": HADES2_REQ_TYPE_TOOLTIPS,
        "reqTypeOrder": HADES2_REQ_TYPE_DISPLAY_ORDER,
        "reqTypeLabelsDependents": HADES2_REQ_TYPE_LABELS_DEPENDENTS,
        "reqTypeTooltipsDependents": HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS,
        "choiceNames": HADES2_CHOICE_NAMES,
        "metaUpgradeNames": {},
        "entityNames": _entity_names(
            HADES2_ENTITY_NAMES, HADES2_SPEAKERS, HADES2_HUB_ROOM_NAMES,
            HADES2_EXTRA_ENTITY_NAMES,
        ),
        "pathScopeNames": HADES2_PATH_SCOPE_NAMES,
        "pathFieldNames": HADES2_PATH_FIELD_NAMES,
        "pathObjectFields": sorted(HADES2_PATH_OBJECT_FIELDS),
        "pathFieldLeafNames": HADES2_PATH_FIELD_LEAF_NAMES,
        "pathLiteralLeafFields": sorted(HADES2_PATH_LITERAL_LEAF_FIELDS),
        "brokenPathRefs": HADES2_BROKEN_PATH_REFS,
        "brokenReqFields": {},
        "badgeRankNames": HADES2_BADGE_RANK_NAMES,
        "badgeRankManager": HADES2_BADGE_RANK_MANAGER,
    },
}


def annotate_label_maps(graph_data: dict, game: str) -> None:
    """Attach ``game``'s friendly-name lookups to the per-game graph
    dataset.

    ``game`` must be a key of :data:`_GAME_LABELS` (currently
    ``"hades1"`` or ``"hades2"``).

    Adds to ``graph_data`` (all sourced from the given game only):
      - ``reqTypeLabels``: ``{field: human-label}`` for the requirement
        groups shown in the details panel.
      - ``reqTypeEdgeLabels``: ``{field: short-chip-label}`` for the
        tree view edge badges.
      - ``reqTypeTooltips``: ``{field: plain-english-blurb}`` shown as
        the second line of the hover tooltip on requirement labels
        (the viewer prepends the internal field name as the first line).
      - ``reqTypeOrder``: ordered list of fields used to sort tree
        children into per-type groups.
      - ``reqTypeLabelsDependents`` / ``reqTypeTooltipsDependents``:
        perspective-flipped labels and tooltips for the downstream
        (dependents) tree view, where each requirement field instead
        describes how the rooted textline gates a list of dependent
        textlines. Restricted to textline-dependency fields (the only
        fields that can surface as downstream edges). The viewer falls
        back to the upstream maps when a key is missing.
      - ``sectionKeyLabels``: ``{key: human-label}`` for textline
        section keys (``InteractTextLineSets``, ``GiftTextLineSets``,
        ...).
      - ``choiceNames``: ``{ChoiceText: friendly-label}`` for choice-id
        friendly labels. The viewer falls back to the raw ChoiceText id
        when a choice isn't in the map, so unmapped choices still
        render (without a tooltip).
      - ``metaUpgradeNames``: ``{MetaUpgradeId: friendly-label}`` for
        Mirror of Night / meta upgrade ids referenced from preset
        choice tables. Empty for games (e.g. H2) that don't reference
        named meta upgrades.
      - ``entityNames``: ``{InternalId: DisplayName}`` for game entities
        (boons/traits, keepsakes, companions, weapon aspects, god boons,
        enemies, items, ...) that appear as ``otherRequirements`` operand
        values. The viewer renders the friendly name with the internal id
        in the row tooltip, falling back to the raw id when unmapped.
    """
    if game not in _GAME_LABELS:
        raise ValueError(
            f"Unknown game id {game!r}; expected one of "
            f"{sorted(_GAME_LABELS)}"
        )
    bundle = _GAME_LABELS[game]
    graph_data["sectionKeyLabels"] = dict(bundle["sectionKeyLabels"])
    graph_data["reqTypeLabels"] = dict(bundle["reqTypeLabels"])
    graph_data["reqTypeEdgeLabels"] = dict(bundle["reqTypeEdgeLabels"])
    graph_data["reqTypeTooltips"] = dict(bundle["reqTypeTooltips"])
    graph_data["reqTypeOrder"] = list(bundle["reqTypeOrder"])
    graph_data["reqTypeLabelsDependents"] = dict(bundle["reqTypeLabelsDependents"])
    graph_data["reqTypeTooltipsDependents"] = dict(
        bundle["reqTypeTooltipsDependents"]
    )
    graph_data["choiceNames"] = dict(bundle["choiceNames"])
    graph_data["metaUpgradeNames"] = dict(bundle["metaUpgradeNames"])
    graph_data["entityNames"] = dict(bundle["entityNames"])
    graph_data["pathScopeNames"] = dict(bundle["pathScopeNames"])
    graph_data["pathFieldNames"] = dict(bundle["pathFieldNames"])
    graph_data["pathObjectFields"] = list(bundle["pathObjectFields"])
    graph_data["pathLiteralLeafFields"] = list(bundle["pathLiteralLeafFields"])
    graph_data["pathFieldLeafNames"] = {
        k: dict(v) for k, v in bundle["pathFieldLeafNames"].items()
    }
    graph_data["brokenPathRefs"] = dict(bundle["brokenPathRefs"])
    graph_data["brokenReqFields"] = dict(bundle["brokenReqFields"])
    graph_data["badgeRankNames"] = dict(bundle["badgeRankNames"])
    graph_data["badgeRankManager"] = bundle["badgeRankManager"]
