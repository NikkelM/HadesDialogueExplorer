"""Attach the categorized known-unresolved-refs map to a per-game graph
and audit it against the parser's actual unresolved set."""

from src.extractors.hades1 import (
    HADES1_KNOWN_UNRESOLVED_REFS,
    UNRESOLVED_CATEGORY_LABELS,
    UNRESOLVED_CATEGORY_DESCRIPTIONS,
)


# Per-game known-unresolved maps. The build pipeline calls
# :func:`annotate_known_unresolved` once per game with the matching
# ``game`` id; each game's audit runs only against that game's parser
# output, so an unresolved ref appearing only in H1 is not "covered"
# by an H2 entry and vice-versa (the strict per-game viewer split
# means cross-game ref bleed-through cannot happen at any layer).
#
# H2 has no curated entries yet; surfacing untriaged H2 refs as
# WARNINGS is the desired signal until they're triaged.
_KNOWN_UNRESOLVED_BY_GAME = {
    "hades1": ("HADES1", HADES1_KNOWN_UNRESOLVED_REFS),
    "hades2": ("HADES2", {}),
}


def annotate_known_unresolved(graph_data: dict, game: str) -> None:
    """Attach the categorized known-unresolved-refs map to ``graph_data``
    and audit it against what the parser actually computed for ``game``.

    Adds to ``graph_data``:
      - ``knownUnresolvedRefs``: ``{name: {category, reason}}`` for every
        currently-unresolved ref that has a hardcoded entry in this
        game's map.
      - ``unresolvedCategoryLabels``: ``{category: human-label}``.
      - ``unresolvedCategoryDescriptions``: ``{category: explainer}``.
      - ``stats.unresolvedByCategory``: ``{category: count}`` (the count of
        unresolved refs in each category, plus ``uncategorized`` for any
        ref the hardcoded list doesn't cover).

    Audits and prints warnings for:
      - hardcoded entries no longer in the unresolved set (parser fix);
      - unresolved refs missing from the game's hardcoded list (new content).
    """
    if game not in _KNOWN_UNRESOLVED_BY_GAME:
        raise ValueError(
            f"Unknown game id {game!r}; expected one of "
            f"{sorted(_KNOWN_UNRESOLVED_BY_GAME)}"
        )
    game_label, mapping = _KNOWN_UNRESOLVED_BY_GAME[game]

    unresolved_set = set(graph_data["stats"]["unresolvedRefs"])

    stale = sorted(set(mapping) - unresolved_set)
    if stale:
        print(
            f"WARNING ({game}): {len(stale)} entry(ies) in "
            f"{game_label}_KNOWN_UNRESOLVED_REFS are now resolved by "
            f"the parser - remove them: {stale}"
        )

    known = {name: info for name, info in mapping.items() if name in unresolved_set}

    untriaged = sorted(unresolved_set - set(known))
    if untriaged:
        print(
            f"WARNING ({game}): {len(untriaged)} unresolved ref(s) are not "
            f"categorized in {game_label}_KNOWN_UNRESOLVED_REFS - triage "
            f"and add them: {untriaged}"
        )

    by_category = {"uncategorized": len(untriaged)}
    for info in known.values():
        by_category[info["category"]] = by_category.get(info["category"], 0) + 1

    graph_data["knownUnresolvedRefs"] = known
    graph_data["unresolvedCategoryLabels"] = dict(UNRESOLVED_CATEGORY_LABELS)
    graph_data["unresolvedCategoryDescriptions"] = dict(UNRESOLVED_CATEGORY_DESCRIPTIONS)
    graph_data["stats"]["unresolvedByCategory"] = by_category
