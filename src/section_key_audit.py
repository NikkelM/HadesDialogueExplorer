"""Audit each game's owner-level textline-set section-key allowlist
against the data it actually matched and against its label map.

The textline walkers extract only allowlisted section keys, so two
silent failure modes are possible and are surfaced here as warnings
(consistent with :func:`src.known_unresolved.annotate_known_unresolved`,
the bidirectional ref audit this is modelled on):

1. Dead allowlist entry - an allowlisted section key that no extracted
   textline carries (it matched zero containers across every source).
   This is the check that catches a long-dead entry such as the H2
   ``BathHouseIntroTextLines`` key that referenced a shared cue snippet
   rather than a real owner-level section.
2. Label parity - ``SECTION_KEY_LABELS`` must cover exactly the
   allowlist. A newly-allowlisted key with no friendly label renders as
   its raw id in the viewer; a stale label points at a removed key.
   Both ``section_keys.py`` modules document this audit explicitly.

This is the allowlist->data half of the section-key audit. The
data->allowlist half - source data carrying a section-shaped key that
is *not* allowlisted, i.e. silently dropped dialogue - is surfaced by
``generate_data.py`` via the walker collector in
:mod:`src.extractors.textline_set`.

These are maintenance signals, not build-breaking errors, so the
checks print warnings rather than raising; ``test_section_key_audit``
asserts the shipped maps stay clean so CI catches drift without needing
the game installs.
"""

from src.extractors.hades1 import HADES1_SECTION_KEY_LABELS
from src.extractors.hades1.section_keys import HADES1_TEXTLINE_SECTION_KEYS
from src.extractors.hades2 import HADES2_SECTION_KEY_LABELS
from src.extractors.hades2.section_keys import HADES2_TEXTLINE_SECTION_KEYS


# Per-game (label-prefix, allowlist, label-map) rows. The build pipeline
# calls :func:`audit_section_keys` once per game with the matching id so
# each game's audit runs only against its own vocabulary (the strict
# per-game viewer split means cross-game bleed-through cannot happen).
_SECTION_KEYS_BY_GAME = {
    "hades1": ("HADES1", set(HADES1_TEXTLINE_SECTION_KEYS), HADES1_SECTION_KEY_LABELS),
    "hades2": ("HADES2", set(HADES2_TEXTLINE_SECTION_KEYS), HADES2_SECTION_KEY_LABELS),
}


def audit_section_keys(graph_data: dict, game: str) -> None:
    """Audit ``game``'s section-key allowlist against ``graph_data`` (the
    merged per-game graph) and its label map, printing a warning for each
    drift it finds. No-op-quiet when everything lines up.

    Surfaces:
      - allowlisted section keys that matched zero textlines;
      - allowlisted keys with no entry in ``SECTION_KEY_LABELS``;
      - label entries with no matching allowlist key.
    """
    if game not in _SECTION_KEYS_BY_GAME:
        raise ValueError(
            f"Unknown game id {game!r}; expected one of "
            f"{sorted(_SECTION_KEYS_BY_GAME)}"
        )
    game_label, allowlist, labels = _SECTION_KEYS_BY_GAME[game]

    used = {
        tl["section"]
        for tl in graph_data.get("textlines", {}).values()
        if tl.get("section")
    }
    dead = sorted(allowlist - used)
    if dead:
        print(
            f"WARNING ({game}): {len(dead)} allowlisted section key(s) matched "
            f"zero textlines in any source - remove them, or confirm the "
            f"source still defines them: {dead}"
        )

    label_keys = set(labels)
    unlabelled = sorted(allowlist - label_keys)
    if unlabelled:
        print(
            f"WARNING ({game}): {len(unlabelled)} allowlisted section key(s) "
            f"have no entry in {game_label}_SECTION_KEY_LABELS - the viewer "
            f"will show the raw id: {unlabelled}"
        )
    stale_labels = sorted(label_keys - allowlist)
    if stale_labels:
        print(
            f"WARNING ({game}): {len(stale_labels)} entry(ies) in "
            f"{game_label}_SECTION_KEY_LABELS have no matching allowlist key - "
            f"remove them: {stale_labels}"
        )
