"""Hades 1 voice-over cue-path -> canonical speaker resolution.

The cue ids the game uses for voicelines encode the speaker in their path
prefix (``/VO/<Prefix>_NNNN``): ``Poseidon`` -> ``NPC_Poseidon_01``,
``ZagreusHome`` -> ``CharProtag``, and so on. Narrative-variant tags
(``MegaeraField`` vs ``MegaeraHome``) collapse to a single speaker.

This is used in two places, so it lives in its own dependency-free module to
keep the H1 extractors from importing one another:

* ``encounter_room_data`` derives the per-cue speaker for multi-speaker
  EncounterData / RoomData textlines whose cues lack an explicit ``Speaker``.
* every H1 source recovers the speaker of a cue-only closing voiceline
  (``EndCue`` / ``EndVoiceLines`` entries with no inline text), where the owner
  fallback would otherwise mis-attribute a cross-speaker reaction (e.g. a
  Zagreus quip closing an NPC's gift dialogue).
"""

import re

# Cue path prefix -> canonical speaker id. ``ZagreusScratch`` is scratch-recording
# variants reusing the protagonist's cues.
CUE_PATH_SPEAKERS = {
    "Achilles":       "NPC_Achilles_01",
    "Alecto":         "NPC_FurySister_02",
    "Charon":         "NPC_Charon_01",
    "Eurydice":       "NPC_Eurydice_01",
    "Hades":          "NPC_Hades_01",
    "MegaeraField":   "NPC_FurySister_01",
    "MegaeraHome":    "NPC_FurySister_01",
    "Patroclus":      "NPC_Patroclus_01",
    "Poseidon":       "NPC_Poseidon_01",
    "Sisyphus":       "NPC_Sisyphus_01",
    "Storyteller":    "Storyteller",
    "Thanatos":       "NPC_Thanatos_01",
    "ThanatosField":  "NPC_Thanatos_01",
    "Tisiphone":      "NPC_FurySister_03",
    "ZagreusField":   "CharProtag",
    "ZagreusHome":    "CharProtag",
    "ZagreusScratch": "CharProtag",
}

# Accepts a raw ``/VO/<Prefix>_NNNN`` cue or one with the ``/VO/`` scope already
# stripped (``<Prefix>_NNNN``), so it resolves both the raw cues seen at
# extraction time and the trimmed ids stored on closing voicelines.
_CUE_PATH_RE = re.compile(r"^(?:/VO/)?([A-Za-z]+?)_\d")


def resolve_cue_prefix_speaker(cue):
    """Return the canonical speaker id for a cue id, or ``None`` when the cue
    has no recognised ``/VO/<Prefix>_NNNN`` path."""
    if not isinstance(cue, str):
        return None
    m = _CUE_PATH_RE.match(cue)
    if not m:
        return None
    return CUE_PATH_SPEAKERS.get(m.group(1))
