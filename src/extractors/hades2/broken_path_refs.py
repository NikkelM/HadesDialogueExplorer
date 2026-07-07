"""Curated notes for broken path-leaf references in H2 otherRequirements.

A few gates address a save record keyed by an id that can never be set, so the
gate is a broken requirement with no effect on playability. The parser's
unresolved-ref audit only scans textline *requirement* fields (RequiredTextLines,
...), so a bad id that appears only as a dotted-path leaf (e.g. inside
``GameState.UseRecord.<id>``) is not caught there. This map lets the viewer flag
such a gate as a broken requirement so a reader knows it has no effect.

Keyed by the broken leaf id; the value is the note shown on the gate. H1 has no
equivalent (its gates use flat fields, not dotted paths), so this is H2-only.
"""

HADES2_BROKEN_PATH_REFS = {
    # ZeusAboutAres01 gates on ``PathFalse:GameState.UseRecord.ZeusAboutAres02``.
    # UseRecord only ever records interactions with entities (NPCs, boons,
    # upgrades), never dialogue ids - and ZeusAboutAres02 was never even added
    # to the game (only ZeusAboutAres01 exists). So that record can never be
    # set: the "must NOT have interacted" check is always satisfied and the gate
    # has no effect on playability.
    "ZeusAboutAres02": "Broken requirement: UseRecord only tracks interactions "
                       "with entities (NPCs, boons, upgrades), never dialogue "
                       "ids, so this record can never be set - the 'must not "
                       "have interacted' check always passes and has no effect.",
}
