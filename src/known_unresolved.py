"""Attach the categorized known-unresolved-refs map to the merged graph
and audit it against the parser's actual unresolved set."""

from src.extractors.hades1 import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
)


# Hardcoded per-game known-unresolved maps in priority order. Each entry is
# ``(game_label, mapping)`` so the audit can identify which game's list is
# drifting; the warning string interpolates the variable-name suffix from
# the game prefix (e.g. ``HADES1`` -> ``HADES1_KNOWN_UNRESOLVED_REFS``).
_KNOWN_UNRESOLVED_SOURCES = [
    ("HADES1", HADES1_KNOWN_UNRESOLVED_REFS),
]


def annotate_known_unresolved(graph_data: dict) -> None:
    """Attach the categorized known-unresolved-refs map to the merged graph
    data and audit it against what the parser actually computed.

    Adds to ``graph_data``:
      - ``knownUnresolvedRefs``: ``{name: {category, reason}}`` for every
        currently-unresolved ref that has a hardcoded entry.
      - ``unresolvedCategoryLabels``: ``{category: human-label}``.
      - ``unresolvedCategoryDescriptions``: ``{category: explainer}``.
      - ``stats.unresolvedByCategory``: ``{category: count}`` (the count of
        unresolved refs in each category, plus ``uncategorized`` for any
        ref the hardcoded list doesn't cover).

    Audits and prints warnings for:
      - hardcoded entries no longer in the unresolved set (parser fix);
      - unresolved refs missing from every hardcoded list (new content).
    """
    unresolved_set = set(graph_data["stats"]["unresolvedRefs"])
    union_known = {}
    for game_label, mapping in _KNOWN_UNRESOLVED_SOURCES:
        stale = sorted(set(mapping) - unresolved_set)
        if stale:
            print(
                f"WARNING: {len(stale)} entry(ies) in "
                f"{game_label}_KNOWN_UNRESOLVED_REFS are now resolved by "
                f"the parser - remove them: {stale}"
            )
        for name, info in mapping.items():
            if name in unresolved_set:
                union_known[name] = info

    untriaged = sorted(unresolved_set - set(union_known))
    if untriaged:
        print(
            f"WARNING: {len(untriaged)} unresolved ref(s) are not "
            f"categorized in any *_KNOWN_UNRESOLVED_REFS map - triage and "
            f"add them: {untriaged}"
        )

    by_category = {"uncategorized": len(untriaged)}
    for info in union_known.values():
        by_category[info["category"]] = by_category.get(info["category"], 0) + 1

    graph_data["knownUnresolvedRefs"] = union_known
    graph_data["unresolvedCategoryLabels"] = dict(UNRESOLVED_CATEGORY_LABELS)
    graph_data["unresolvedCategoryDescriptions"] = dict(UNRESOLVED_CATEGORY_DESCRIPTIONS)
    graph_data["stats"]["unresolvedByCategory"] = by_category
