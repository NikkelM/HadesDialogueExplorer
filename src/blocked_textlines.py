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
_VIEWER_KNOWN_SEMANTICS = frozenset({"all", "any", "count-min", "broken-ref"})

# Tokens that show up in a RequiredSeenRooms gate but are not real rooms, so
# the gate can never be satisfied in any save (seen rooms only ever record real
# room ids). NyxGift06 is a Nyx gift-conversation textline that was mis-filed
# into NyxAboutObscurity01's RequiredSeenRooms instead of RequiredTextLines, so
# that line can never play - a content-author bug, surfaced like cut content.
_IMPOSSIBLE_SEEN_ROOM_TOKENS = frozenset({"NyxGift06"})


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

        # A RequiredSeenRooms gate listing a token that is not a real room can
        # never be satisfied, so the textline can never play. Curated rather
        # than auto-detected (the token resolves as a textline, just not a room).
        seen_rooms = (tl.get("otherRequirements") or {}).get("RequiredSeenRooms") or []
        broken = [r for r in seen_rooms if r in _IMPOSSIBLE_SEEN_ROOM_TOKENS]
        if broken:
            reasons.append({
                "field": "RequiredSeenRooms",
                "semantics": "broken-ref",
                "missingRefs": sorted(set(broken)),
                "totalRefs": len(seen_rooms),
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


def audit_impossible_seen_room_drift(textlines_iter, warn=print):
    """Warn when a curated ``_IMPOSSIBLE_SEEN_ROOM_TOKENS`` entry is no longer
    referenced by any textline's ``RequiredSeenRooms`` gate.

    Each token flags a specific content-author bug (a textline name mis-filed
    into a RequiredSeenRooms list). Once that line is removed or the mis-file is
    corrected in a game update, the token becomes dead curation. ``textlines_iter``
    iterates every textline dict across all games. Emits a build-time WARNING
    listing any unreferenced token so it gets pruned, mirroring the section-key /
    manual-override "surface curated drift" doctrine. Returns the sorted stale
    tokens for tests.
    """
    referenced = set()
    for tl in textlines_iter:
        rooms = (tl.get("otherRequirements") or {}).get("RequiredSeenRooms") or []
        for r in rooms:
            if r in _IMPOSSIBLE_SEEN_ROOM_TOKENS:
                referenced.add(r)
    stale = sorted(_IMPOSSIBLE_SEEN_ROOM_TOKENS - referenced)
    if stale:
        warn(
            f"\nWARNING: {len(stale)} curated impossible-seen-room token(s) in "
            f"_IMPOSSIBLE_SEEN_ROOM_TOKENS are no longer referenced by any "
            f"RequiredSeenRooms gate - dead curation to prune from "
            f"src/blocked_textlines.py: {stale}."
        )
    return stale
