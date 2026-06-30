"""Curated notes for broken / typo'd requirement field KEYS in H1
otherRequirements.

A handful of H1 textlines carry a requirement field whose KEY is misspelled, so
it does not match any field the engine's ``IsGameStateEligible`` actually reads.
The engine silently ignores an unknown key, so the gate is never evaluated and
has no effect on eligibility - but the key (and its operand value) still appears
in the extracted data. This map lets the viewer flag such a gate clearly: the
problem is the requirement *key*, not its value, so the value is not surfaced.

Keyed by the broken field key; the value is the note shown on the gate. H2 has
no known equivalent.
"""

HADES1_BROKEN_REQ_FIELDS = {
    # NyxAboutAres04_B carries ``RequiredTextLinesThis`` - a truncated typo (the
    # real fields are ``RequiredTextLinesThisRun`` / ``...ThisRoom``). No engine
    # field matches, so the key is never checked and the gate has no effect.
    "RequiredTextLinesThis":
        "Misspelled requirement key (a truncated form of "
        "RequiredTextLinesThisRun / ThisRoom). The engine has no such field, so "
        "it is never evaluated and the gate has no effect on eligibility.",
    # MegaeraMirrorProgress02 / _B / _C carry ``RequiredActiveMetaPointMax``,
    # missing the plural ``s`` of the real ``RequiredActiveMetaPointsMax``. The
    # engine never reads the misspelled key, so the threshold has no effect.
    "RequiredActiveMetaPointMax":
        "Misspelled requirement key (should be RequiredActiveMetaPointsMax). The "
        "engine has no such field, so it is never evaluated and the gate has no "
        "effect on eligibility.",
}
