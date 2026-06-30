"""Derive the play-once flag from the self-negative requirement idiom.

A textline plays at most once when it gates on *its own name* under the
global ``RequiredFalseTextLines`` field ("plays only while it has not itself
played"): the first play records the line, which permanently violates that
gate, so it can never play again. The game data encodes single-play lines two
ways - an explicit ``PlayOnce = true`` table flag (already read by the
extractors into ``playOnce``) and this self-reference idiom - so this step
folds the second into the same ``playOnce`` flag the viewer reads.

Run post-merge (so it sees each textline's final merged requirements) and
before the speaker aggregates / eligibility consumers, which all key off
``playOnce``: the repeatability filter, the play-once badge, the run-count
tooltips, and the "permanently unobtainable" save check (a play-once line
past a ``MaxRunsSinceAnyTextLines`` window can never come back).
"""


def is_self_play_once(name: str, requirements: dict) -> bool:
    """True when ``name`` lists itself under the global
    ``RequiredFalseTextLines`` field.

    Only the global field counts: the scoped negative variants
    (``...ThisRun`` / ``...ThisRoom`` / ``...LastRun`` / queued) reset each
    run or room, so a self-reference there is a per-run cooldown, not a
    permanent single-play lock.
    """
    refs = (requirements or {}).get("RequiredFalseTextLines")
    return isinstance(refs, list) and name in refs


def annotate_play_once(graph_data: dict) -> None:
    """Set ``playOnce = True`` on every textline that uses the self-negative
    play-once idiom but lacks the explicit flag. Mutates ``graph_data`` in
    place and records ``stats.playOnceFromSelfNegative`` (the number newly
    flipped) for build visibility.
    """
    textlines = graph_data.get("textlines", {})
    flipped = 0
    for name, tl in textlines.items():
        if tl.get("playOnce"):
            continue
        if is_self_play_once(name, tl.get("requirements")):
            tl["playOnce"] = True
            flipped += 1
    graph_data.setdefault("stats", {})["playOnceFromSelfNegative"] = flipped
    if flipped:
        print(
            f"INFO: marked {flipped} textline(s) play-once from the "
            f"self-negative RequiredFalseTextLines idiom."
        )
    # Finally, propagate play-once to choice variants whose parent prompt is
    # play-once - now that every parent's final ``playOnce`` (explicit flag,
    # inspect-point force, merged definition, or the self-negative idiom folded
    # just above) is known.
    propagate_parent_play_once(textlines)


def propagate_parent_play_once(textlines: dict) -> None:
    """Mark a synthetic choice variant ``playOnce`` when its parent prompt is.

    ``IsTextLineEligible`` (Narrative.lua) gates a line on
    ``line.PlayOnce or parentLine.PlayOnce``, and a choice variant is reachable
    only via its parent anyway - so a variant of a play-once prompt is itself
    play-once even when it doesn't declare the flag. Mutates ``textlines`` in
    place; run after the parent's final ``playOnce`` is resolved."""
    for entry in textlines.values():
        if not entry.get("isSynthetic") or entry.get("playOnce"):
            continue
        parent = textlines.get(entry.get("parentTextline"))
        if parent is not None and parent.get("playOnce"):
            entry["playOnce"] = True
