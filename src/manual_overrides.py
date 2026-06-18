"""Manually-curated, per-textline field overrides.

The extractors derive every textline field mechanically from the game's
Lua / SJSON source. A small number of textlines need a value the source
data doesn't express in a way the extractor can pick up - for example a
line the game treats as play-once through bespoke run logic rather than
the ``PlayOnce`` table flag the extractor reads. Such corrections live
here so they:

  - survive a full re-extraction (they are re-applied on every build),
  - are reviewed and discoverable in a single place, and
  - are validated (a stale or mistyped entry fails the build loudly).

The registry is keyed per game, so each game can carry its own
overrides, and each entry maps a textline name to a dict of
``field -> value`` pairs applied verbatim onto the assembled textline in
``graph_data["textlines"]``. To add an override, drop a new entry under
the relevant game::

    MANUAL_OVERRIDES = {
        "hades2": {
            "SomeTextLine01": {"playOnce": True},
        },
    }

Note on ``playOnce``: the data only carries the flag when truthy (an
absent flag means repeatable), so a play-once correction sets
``{"playOnce": True}``. Applied via :func:`apply_manual_overrides` early
in ``build_viewer._build_game`` so every downstream annotation step sees
the corrected value.
"""

# game -> { textline_name -> { field: value, ... } }
MANUAL_OVERRIDES: dict[str, dict[str, dict]] = {
    "hades1": {},
    "hades2": {
        # Hades' first gift line to Hecate is a one-off story beat that
        # the game gates to a single play through bespoke run logic; the
        # source table omits the ``PlayOnce`` flag the extractor reads.
        "HadesWithHecate01": {"playOnce": True},
    },
}


def apply_manual_overrides(
    graph_data: dict,
    game: str,
    overrides: dict | None = None,
) -> int:
    """Apply the curated field overrides for ``game`` onto the assembled
    textlines in ``graph_data``.

    ``overrides`` defaults to the module-level :data:`MANUAL_OVERRIDES`
    registry; tests pass an explicit table. Returns the number of
    textlines overridden.

    Raises ``ValueError`` if an override targets a textline name that is
    not present in the extracted data, so a typo or an entry left behind
    after a re-extraction surfaces as a build failure rather than a
    silent no-op.
    """
    table = MANUAL_OVERRIDES if overrides is None else overrides
    game_overrides = table.get(game, {})
    if not game_overrides:
        return 0

    textlines = graph_data["textlines"]
    applied = 0
    for name, fields in game_overrides.items():
        tl = textlines.get(name)
        if tl is None:
            raise ValueError(
                f"manual override for {game!r} targets textline {name!r}, "
                f"which is not present in the extracted data. Remove or fix "
                f"the entry in src/manual_overrides.py."
            )
        for field, value in fields.items():
            tl[field] = value
        applied += 1

    if applied:
        print(f"INFO: applied manual override(s) to {applied} textline(s) for {game}.")
    return applied
