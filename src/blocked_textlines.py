"""Walk every defined textline and flag those whose requirements can
never be satisfied because of unresolved references."""

from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS


# Semantics tags ``annotate_blocked_textlines`` is allowed to emit on
# ``blockingReasons[*]["semantics"]``. ``viewer.js::renderBlockingReason``
# has a finite branch ladder matching these exact strings; any new value
# emitted here without a corresponding viewer-side branch would render
# as a generic fallback line and (historically) hit a
# ``ReferenceError`` on a typo. Kept as a separate constant from
# ``textline_set.REQUIREMENT_BLOCKING_SEMANTICS`` because that map also
# contains ``"none"`` / ``"count-permissive"`` values that are filtered
# out before reaching ``blockingReasons``.
_VIEWER_KNOWN_SEMANTICS = frozenset({"all", "any", "count-min"})


def _assert_viewer_knows_semantics(reasons: list, textline_name: str) -> None:
    """Fail loud if ``reasons`` contains any semantics value the viewer
    doesn't know how to render.

    Called once per textline that gains a ``blockingReasons`` list, so
    that adding a new semantics branch to ``annotate_blocked_textlines``
    forces the contributor to either add the matching viewer-side
    branch or update ``_VIEWER_KNOWN_SEMANTICS`` (which surfaces the
    drift in code review).
    """
    unknown = {r["semantics"] for r in reasons} - _VIEWER_KNOWN_SEMANTICS
    if unknown:
        raise ValueError(
            f"annotate_blocked_textlines emitted unknown semantics "
            f"{sorted(unknown)} for textline {textline_name!r}. "
            f"viewer.js::renderBlockingReason only handles "
            f"{sorted(_VIEWER_KNOWN_SEMANTICS)}; add the new branch(es) "
            f"there before extending the emit set."
        )


def annotate_blocked_textlines(graph_data: dict) -> None:
    """Walk every defined textline and flag those whose requirements can
    never be satisfied because of unresolved references.

    A textline is considered *blocked* when at least one of its requirement
    fields has a hard failure given the unresolved set:

      - ``RequiredTextLines`` and other ALL-semantics fields: ANY unresolved
        entry blocks the textline (every entry must have played).
      - ``RequiredAnyTextLines`` and other ANY-semantics fields: blocks only
        when EVERY entry in the list is unresolved (no satisfying choice
        remains).
      - ``RequiredMinAnyTextLines``: blocks when the requested ``Count``
        exceeds the number of resolved entries.

    Permissive forms (``RequiredFalse*``, ``RequiredMaxAnyTextLines``,
    ``MinRunsSinceAnyTextLines``, ``MaxRunsSinceAnyTextLines``) are never
    blocking from unresolved entries alone - lines that were never defined
    can never play, so a "must not have played" or "permissive count" check
    is trivially satisfied.

    Each affected textline gains:
      ``blocked``: ``True``
      ``blockingReasons``: list of ``{field, semantics, missingRefs, ...}``
        - ``field``         the requirement-field name (e.g. RequiredTextLines)
        - ``semantics``     "all" | "any" | "count-min"
        - ``missingRefs``   the unresolved names that caused the block
        - ``totalRefs``     total entries in the field (for context)
        - ``requiredCount`` (count-min only) the ``Count`` parameter
        - ``resolvedCount`` (count-min only) entries currently resolved

    Stats: ``stats.blockedTextlines`` is the total blocked count.
    """
    textlines = graph_data["textlines"]
    resolved_names = set(textlines.keys())
    blocked_count = 0
    unresolved_blocks: dict = {}

    for name, tl in textlines.items():
        reasons = []
        for field, refs in (tl.get("requirements") or {}).items():
            semantics = REQUIREMENT_BLOCKING_SEMANTICS.get(field)
            if semantics is None or semantics in ("none", "count-permissive"):
                continue

            missing = [r for r in refs if r not in resolved_names]

            if semantics == "all" and missing:
                reasons.append({
                    "field": field,
                    "semantics": "all",
                    "missingRefs": sorted(set(missing)),
                    "totalRefs": len(refs),
                })
            elif semantics == "any":
                if refs and len(missing) == len(refs):
                    reasons.append({
                        "field": field,
                        "semantics": "any",
                        "missingRefs": sorted(set(missing)),
                        "totalRefs": len(refs),
                    })
            elif semantics == "count-min":
                meta = (tl.get("otherRequirements") or {}).get(field) or {}
                count = meta.get("Count", 1) if isinstance(meta, dict) else 1
                resolved_count = len(refs) - len(missing)
                if resolved_count < count:
                    reasons.append({
                        "field": field,
                        "semantics": "count-min",
                        "missingRefs": sorted(set(missing)),
                        "totalRefs": len(refs),
                        "requiredCount": count,
                        "resolvedCount": resolved_count,
                    })

        if reasons:
            _assert_viewer_knows_semantics(reasons, name)
            tl["blocked"] = True
            tl["blockingReasons"] = reasons
            blocked_count += 1
            # Reverse-index: every unresolved ref that contributed to a
            # block is recorded against the blocked textline so the
            # unresolved-ref info-panel can show "blocks: ..." cleanly.
            for reason in reasons:
                for ref in reason["missingRefs"]:
                    unresolved_blocks.setdefault(ref, set()).add(name)

    graph_data["stats"]["blockedTextlines"] = blocked_count
    graph_data["unresolvedRefBlocks"] = {
        ref: sorted(names) for ref, names in unresolved_blocks.items()
    }
    if blocked_count:
        print(
            f"INFO: {blocked_count} textline(s) can never play due to "
            f"unresolved requirement references."
        )
