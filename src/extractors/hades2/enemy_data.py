"""
Semantic extractor for Hades II per-boss EnemyData files.

H2 ships one master ``EnemyData.lua`` (defining shared
``CollisionReactionData`` / ``StatusAnimations`` / ``UnitSetData.Enemies``
container holding mook templates with no dialogue) plus 80+
``EnemyData_<Enemy>.lua`` files - the vast majority of which are
combat-mook stat tables. Only 9 of the per-enemy files carry actual
dialogue: the named bosses with ``BossIntroTextLineSets`` /
``BossOutroTextLineSets`` / ``BossPhaseChangeTextLineSets`` sections.

Each per-boss file follows the same pattern::

    UnitSetData.<BossName> = {
        <BossName> = {
            -- combat stats, animation pins, AI props ...
            BossIntroTextLineSets = {
                <TextlineName> = { ... },
                ...
            },
            BossOutroTextLineSets = {...},
            BossPhaseChangeTextLineSets = {...},
        },
    }

The single owner inside the container shares its name with the
container (``Hecate.Hecate``, ``Chronos.Chronos``, ...). The empty-owner
filter drops the master file's ``UnitSetData.Enemies`` templates and
every mook ``EnemyData_<Mook>.lua`` that has no dialogue sections,
without any per-file gating - any future enemy that grows dialogue
sections will automatically surface.

Speaker mapping (see :data:`ENEMY_DEFAULT_SPEAKERS`): the boss owner
keys are bare names that are explicitly NOT registered as speakers in
:data:`src.extractors.hades2.speakers.HADES2_SPEAKERS` (they are
non-interactive combat-bark tags - the docstring there enumerates
them). Each boss is mapped to its canonical NPC speaker id so cue
lines without an explicit ``Speaker`` field surface under the right
character in the viewer. Special cases:

* ``Polyphemus`` -> ``NPC_Cyclops_01`` (Polyphemus IS the canonical
  Cyclops speaker; the display name "Polyphemus" lives on that id).
* ``InfestedCerberus`` -> ``Speaker_Homer`` (Cerberus does not speak;
  the bulk of unattributed lines on the boss-outro encounter are
  Homer-style narration of Melinoë reuniting with the watchdog).
* ``TyphonHead`` -> ``NPC_Chronos_01`` (Typhon has no NPC speaker;
  the unattributed cues on the alt-fight intro are Chronos taunting
  Melinoë through the apparition. The explicit phase-change lines
  tagged ``Speaker = "PlayerUnit_Flashback"`` resolve via the cue's
  own Speaker field and remain unaffected).
"""

import re

from ...lua_parser import LuaTable
from .textline_set import extract_textline_sections
from .section_keys import HADES2_TEXTLINE_SECTION_KEYS


# Top-level container key pattern. Per-boss files use
# ``UnitSetData.<BossName>``; the master ``EnemyData.lua`` uses
# ``UnitSetData.Enemies`` for mook templates. Matching both with one
# regex keeps the discovery loop a single pass (the empty-owner
# filter drops the master's template owners since none carry
# dialogue sections).
_UNIT_SET_DATA_RE = re.compile(r"^UnitSetData\.\w+$")


# Maps the per-boss owner key to the canonical NPC speaker id used
# for cue lines without an explicit ``Speaker`` field. The owner key
# itself is intentionally NOT a registered speaker id - boss-fight
# bare names like ``Chronos`` / ``Hecate`` / ``Polyphemus`` exist in
# the engine only as combat-bark tags (see HADES2_SPEAKERS docstring).
# Mapping each to its NPC form ensures the dialogue surfaces under
# the right character in the viewer.
ENEMY_DEFAULT_SPEAKERS = {
    "Chronos":          "NPC_Chronos_01",
    "Eris":             "NPC_Eris_01",
    "Hecate":           "NPC_Hecate_01",
    "Polyphemus":       "NPC_Cyclops_01",
    "Prometheus":       "NPC_Prometheus_01",
    "Scylla":           "NPC_Scylla_01",
    "Zagreus":          "NPC_Zagreus_01",
    # Bosses without their own NPC speaker form - mapped to the
    # closest sensible substitute based on the dominant unattributed
    # speaker on the boss's textlines (see module docstring).
    "InfestedCerberus": "Speaker_Homer",
    "TyphonHead":       "NPC_Chronos_01",
}


def extract_enemy_data(
    parsed: dict,
    source_label: str = "",
    source_file: str = "",
    game_data_lists: dict = None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    named_requirements: dict = None,
) -> dict:
    """Extract H2 boss encounter dialogue data from a parsed Lua file.

    Returns a dict keyed by owner id (``Hecate`` / ``Chronos`` / ...)
    shaped like::

        {
            "Hecate": {
                "source": "Hades 2",
                "BossIntroTextLineSets": {...},
                "BossOutroTextLineSets": {...},
            },
            ...
        }

    Owners with zero non-empty sections are dropped so the master
    file's ``UnitSetData.Enemies`` templates and all the mook
    ``EnemyData_<Mook>.lua`` files (which carry no dialogue) don't
    pollute the speaker list. Mirrors the H1 EnemyData behaviour.

    ``game_data_lists`` / ``offer_text_map`` / ``preset_choices`` are
    accepted for pipeline API compatibility (see the NPC extractor's
    docstring for the rationale).
    """
    result = {}
    for key, value in parsed.items():
        if not _UNIT_SET_DATA_RE.match(key):
            continue
        if not isinstance(value, LuaTable):
            continue
        for owner_id, owner_table in value.named.items():
            if not isinstance(owner_table, LuaTable):
                continue
            entry = _build_owner_entry(
                owner_id, owner_table, source_label, source_file,
                named_requirements=named_requirements,
            )
            if entry is None:
                continue
            result.setdefault(owner_id, entry)
    return result


def _build_owner_entry(
    owner_id: str,
    owner_table: LuaTable,
    source_label: str,
    source_file: str,
    *,
    named_requirements: dict = None,
):
    """Return the owner entry dict, or ``None`` if it has no textlines."""
    sections = extract_textline_sections(
        owner_id, owner_table, source_file,
        section_keys=HADES2_TEXTLINE_SECTION_KEYS,
        default_speaker=ENEMY_DEFAULT_SPEAKERS.get(owner_id),
        named_requirements=named_requirements,
    )
    if not any(sections.values()):
        return None
    entry = {"source": source_label}
    entry.update(sections)
    return entry
