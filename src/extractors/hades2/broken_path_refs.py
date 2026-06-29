"""Curated notes for cut / broken path-leaf references in H2 otherRequirements.

A few gates address a save record keyed by a textline / event id that was cut
from the final game. The parser's unresolved-ref audit only scans textline
*requirement* fields (RequiredTextLines, ...), so a cut id that appears only as
a dotted-path leaf (e.g. inside ``GameState.UseRecord.<id>``) is not caught
there. This map lets the viewer surface a short note on such a gate so a reader
knows the reference is broken and the gate has no effect, mirroring the
known-unresolved cut-content handling used for requirement refs.

Keyed by the broken leaf id; the value is the note shown on the gate. H1 has no
equivalent (its gates use flat fields, not dotted paths), so this is H2-only.
"""

HADES2_BROKEN_PATH_REFS = {
    # ZeusAboutAres01 gates on ``PathFalse:GameState.UseRecord.ZeusAboutAres02``,
    # but ZeusAboutAres02 was never added to the game (only ZeusAboutAres01
    # exists). A "must NOT have interacted with" check on a record that can never
    # be set is always satisfied, so the gate has no effect on playability.
    "ZeusAboutAres02": "Cut content: this id was never added to the game, so "
                       "this 'must not have interacted' check is always "
                       "satisfied and has no effect.",
}
