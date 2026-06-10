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

Owner routing (mirrors H1's :mod:`src.extractors.hades1.enemy_data`):

* The bare owner key (``Hecate``, ``Chronos``, ``Polyphemus``, ...)
  is kept as the dict key, and the speaker fallback for unattributed
  cues defaults to :data:`ENEMY_DEFAULT_SPEAKERS[owner]` if present
  or the owner id itself otherwise (see ``_resolve_cue_speaker`` in
  :mod:`.textline_set`).
* For bosses whose character also appears as a walking NPC (Hecate,
  Eris, Chronos, Zagreus) the bare owner key is its own speaker
  entry in :data:`src.extractors.hades2.speakers.HADES2_SPEAKERS`
  with display name ``"<Char> (Boss)"`` - this keeps the boss-fight
  dialogue distinct from the walking-NPC form's
  ``NPC_<Char>_01`` / etc. The Surface alt-fight container
  ``TyphonHead`` is similarly registered, with display name
  ``"Chronos (Summit)"`` because Typhon never speaks and every
  unattributed cue is Chronos via the apparition.
* Boss-only owners (``Polyphemus`` / ``Prometheus`` / ``Scylla``) are
  routed onto the canonical NPC speaker via
  :data:`ENEMY_DEFAULT_SPEAKERS` - those characters have no separate
  hub-NPC / boss split worth distinguishing, the NPC form carries
  the same voice / description.
* ``InfestedCerberus`` is the special case: Cerberus does not speak,
  and the unattributed lines on the boss-outro encounter are
  Homer-style narration of Melinoë reuniting with the watchdog, so
  the default speaker maps to ``Speaker_Homer``.

Explicit per-cue ``Speaker = "..."`` and ``UsePlayerSource = true``
tags always win over the owner / default-speaker fallback (see
``_resolve_cue_speaker`` in :mod:`.textline_set`).
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


# Override for the speaker attribution of unattributed cue lines on
# bosses whose bare owner-key fallback isn't appropriate. Bosses NOT
# listed here use their bare owner id as the cue speaker (registered
# as a disambiguated ``"<Char> (Boss)"`` / ``"Chronos (Summit)"``
# entry in :data:`HADES2_SPEAKERS` for the walking-NPC overlap cases,
# or as a bare-name entry otherwise).
ENEMY_DEFAULT_SPEAKERS = {
    # Polyphemus IS the Cyclops; Prometheus / Scylla similarly have no
    # walking-NPC vs boss distinction worth a separate speaker entry,
    # so unattributed cues attribute to the canonical NPC form.
    "Polyphemus":       "NPC_Cyclops_01",
    "Prometheus":       "NPC_Prometheus_01",
    "Scylla":           "NPC_Scylla_01",
    # Cerberus does not speak; the unattributed lines on the
    # boss-outro encounter are Homer-style narration of Melinoë
    # reuniting with the watchdog.
    "InfestedCerberus": "Speaker_Homer",
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

    Returns a dict keyed by the bare boss owner id, shaped like::

        {
            "Hecate": {
                "source": "Hades 2",
                "BossIntroTextLineSets": {...},
                "BossOutroTextLineSets": {...},
            },
            ...
        }

    The bare owner key is also the speaker id for unattributed cues
    (except where :data:`ENEMY_DEFAULT_SPEAKERS` overrides it). The
    viewer's friendly display name is resolved separately via
    :data:`HADES2_SPEAKERS` and disambiguates boss-fight forms from
    walking-NPC forms with a ``"(Boss)"`` / ``"(Summit)"`` qualifier
    where needed.

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
