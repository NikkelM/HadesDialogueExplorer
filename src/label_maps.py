"""Attach the viewer's friendly-name lookups (section-key labels,
requirement-type labels, tooltips, display order) to the merged graph."""

from src.extractors.textline_set import (
    TEXTLINE_REQ_FIELDS,
    TEXTLINE_REQ_FIELDS_COUNT,
)
from src.extractors.hades1 import (
    HADES1_TEXTLINE_SECTION_KEYS,
    HADES1_SECTION_KEY_LABELS,
    HADES1_REQ_TYPE_LABELS,
    HADES1_REQ_TYPE_EDGE_LABELS,
    HADES1_REQ_TYPE_TOOLTIPS,
    HADES1_REQ_TYPE_DISPLAY_ORDER,
    HADES1_CHOICE_NAMES,
    HADES1_META_UPGRADE_NAMES,
)
from src.extractors.hades2 import (
    HADES2_TEXTLINE_SECTION_KEYS,
    HADES2_SECTION_KEY_LABELS,
    HADES2_REQ_OPERATORS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
)


# Per-game section-key allowlists and their friendly-name maps. Each
# tuple is ``(game_label, allowed_keys, label_map)``; the merge below
# unions every label_map into ``graph_data["sectionKeyLabels"]``.
_SECTION_KEY_LABEL_SOURCES = [
    ("HADES1", HADES1_TEXTLINE_SECTION_KEYS, HADES1_SECTION_KEY_LABELS),
    ("HADES2", HADES2_TEXTLINE_SECTION_KEYS, HADES2_SECTION_KEY_LABELS),
]

# Per-game requirement-type label data. Tuple shape:
#   (game_label, allowed_fields, labels, edge_labels, tooltips, display_order)
# H1 and H2 use disjoint requirement-field vocabularies (H1: flat
# ``Required.*TextLine.*`` fields; H2: ``GameStateRequirements`` records
# whose primary operator is one of ``HasAny``/``HasAll``/``IsAny``/
# ``Comparison``/``OrRequirements``/``NamedRequirements``/...), so each
# game contributes its own allowlist + maps and the build merges them
# into a single viewer-side lookup. Mirrors
# ``_SECTION_KEY_LABEL_SOURCES``.
_REQ_TYPE_LABEL_SOURCES = [
    (
        "HADES1",
        TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT,
        HADES1_REQ_TYPE_LABELS,
        HADES1_REQ_TYPE_EDGE_LABELS,
        HADES1_REQ_TYPE_TOOLTIPS,
        HADES1_REQ_TYPE_DISPLAY_ORDER,
    ),
    (
        "HADES2",
        HADES2_REQ_OPERATORS,
        HADES2_REQ_TYPE_LABELS,
        HADES2_REQ_TYPE_EDGE_LABELS,
        HADES2_REQ_TYPE_TOOLTIPS,
        HADES2_REQ_TYPE_DISPLAY_ORDER,
    ),
]

# Per-game friendly-name maps for choice ``ChoiceText`` identifiers
# attached to ``Choices = {...}`` cue tables. Same merge-and-attach
# pattern as the section-key / req-type label sources above. H2 has its
# own choice vocabulary so the tuple is per-game.
_CHOICE_NAME_SOURCES = [
    ("HADES1", HADES1_CHOICE_NAMES),
]

# Per-game friendly-name maps for Mirror of Night / meta upgrade ids
# referenced from preset choice tables (see ``HADES1_PRESET_CHOICES``).
# Same merge-and-attach pattern as the choice name sources above.
_META_UPGRADE_NAME_SOURCES = [
    ("HADES1", HADES1_META_UPGRADE_NAMES),
]


def annotate_label_maps(graph_data: dict) -> None:
    """Attach the viewer's friendly-name lookups to the merged graph data.

    Adds to ``graph_data``:
      - ``reqTypeLabels``: ``{field: human-label}`` for the requirement
        groups shown in the details panel - merged across all games.
      - ``reqTypeEdgeLabels``: ``{field: short-chip-label}`` for the tree
        view edge badges - merged across all games.
      - ``reqTypeTooltips``: ``{field: plain-english-blurb}`` shown as
        the second line of the hover tooltip on requirement labels
        (the viewer prepends the internal field name as the first line);
        merged across all games.
      - ``reqTypeOrder``: ordered list of fields used to sort tree
        children into per-type groups - concatenation in game order
        (later games append after earlier ones; duplicates dropped).
      - ``sectionKeyLabels``: ``{key: human-label}`` for the per-game
        union of section-key labels (merged across all games so the
        viewer can do a single lookup regardless of source).
      - ``choiceNames``: ``{ChoiceText: friendly-label}`` for the
        per-game union of choice-id friendly labels - merged across
        all games. The viewer falls back to the raw ChoiceText id when
        a choice isn't in the map, so unmapped choices still render
        (without a tooltip).
      - ``metaUpgradeNames``: ``{MetaUpgradeId: friendly-label}`` for
        the per-game union of Mirror of Night / meta upgrade ids
        referenced from preset choice tables. The viewer surfaces the
        friendly name in the tooltip of any choice option that's
        gated on a particular meta upgrade. Falls back to the raw id
        when unmapped.
    """
    merged_section_labels: dict[str, str] = {}
    for _game_label, _section_keys, labels in _SECTION_KEY_LABEL_SOURCES:
        merged_section_labels.update(labels)

    merged_req_labels: dict[str, str] = {}
    merged_req_edge_labels: dict[str, str] = {}
    merged_req_tooltips: dict[str, str] = {}
    merged_req_order: list[str] = []
    merged_req_order_seen: set[str] = set()
    for _game_label, _allowed_fields, labels, edge_labels, tooltips, display_order in _REQ_TYPE_LABEL_SOURCES:
        merged_req_labels.update(labels)
        merged_req_edge_labels.update(edge_labels)
        merged_req_tooltips.update(tooltips)
        for field in display_order:
            if field not in merged_req_order_seen:
                merged_req_order.append(field)
                merged_req_order_seen.add(field)

    merged_choice_names: dict[str, str] = {}
    for _game_label, names in _CHOICE_NAME_SOURCES:
        merged_choice_names.update(names)

    merged_meta_upgrade_names: dict[str, str] = {}
    for _game_label, names in _META_UPGRADE_NAME_SOURCES:
        merged_meta_upgrade_names.update(names)

    graph_data["reqTypeLabels"] = merged_req_labels
    graph_data["reqTypeEdgeLabels"] = merged_req_edge_labels
    graph_data["reqTypeTooltips"] = merged_req_tooltips
    graph_data["reqTypeOrder"] = merged_req_order
    graph_data["sectionKeyLabels"] = merged_section_labels
    graph_data["choiceNames"] = merged_choice_names
    graph_data["metaUpgradeNames"] = merged_meta_upgrade_names
