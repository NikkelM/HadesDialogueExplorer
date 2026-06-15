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
)


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
