"""Hades II-specific extractors and supporting data.

This subpackage mirrors :mod:`src.extractors.hades1` for the second
game. H2 ships per-character Lua files (``NPCData_<Char>.lua`` x 23)
rather than a single ``NPCData.lua`` and uses a different requirement
format (``GameStateRequirements`` list of ``{Path, Operator}`` records
instead of flat ``Required.*TextLines`` fields).

Game-agnostic logic (Lua parsing, generic textline-section extraction,
graph building, merge) lives outside this subpackage and is shared
with H1.

Public API surface (mirrors :mod:`src.extractors.hades1` where
features overlap):

Extractor entry points
    Per-source ``extract_*`` callables consumed by
    :mod:`generate_data` (one per ``.lua`` source family). All
    return ``{owner_id: owner_dict}`` shaped output for the merge /
    build pipeline.

Vocabulary maps (label / display data)
    ``HADES2_TEXTLINE_SECTION_KEYS`` + ``HADES2_SECTION_KEY_LABELS``,
    ``HADES2_REQ_*`` (operators / type labels / edge labels / tooltips
    / display order), ``HADES2_SPEAKERS``, ``HADES2_CHOICE_NAMES``,
    ``LOOT_DEFAULT_SPEAKERS``, ``ENEMY_DEFAULT_SPEAKERS``,
    ``HUB_NARRATOR_SPEAKER``. Registered in
    :mod:`src.label_maps` so the viewer renders both games uniformly.

Owner-routing overrides (H2-specific)
    ``TEXTLINE_OWNER_OVERRIDES`` (per-textline rehomes for set-opener
    speaker corrections) and ``IDMAP_PARENT_OWNER_OVERRIDES`` (idmap
    parent rehomes). Used by encounter / room / deathloop extractors.

Walker primitives
    ``extract_textline`` / ``extract_textline_sections`` (H2 textline
    walker), ``extract_requirements`` (RequirementSet parser),
    ``extract_named_requirements`` (NamedRequirements registry
    loader), ``HADES2_REQUIREMENT_SET_FIELDS`` (the per-textline /
    per-ancestor field allowlist), ``PLAYER_SPEAKER_ID``.

NarrativeData priorities
    ``extract_narrative_priorities`` (parses ``NarrativeData.lua``)
    + ``apply_narrative_priorities`` (in-place attach to extracted
    owner dicts). Optional pass run during ``h2-generate-data``.

H1 features intentionally NOT mirrored:

* ``extract_game_data_lists`` - H1 had ``GameData.X`` bare-identifier
  indirection in cue text and most requirement fields; H2 has nearly
  eliminated this pattern. The exception (~47 occurrences) is
  ``FunctionName: RequireRunsSinceTextLines`` whose ``TextLines``
  argument can be a ``GameData.X`` identifier defined in
  NarrativeData.lua (e.g. ``GameData.AthenaKeepsakeEvents``). These
  currently render in the viewer as raw identifier refs rather than
  expanded dialogue edges; a dedicated resolver would lift them like
  H1 does. See ``h2-function-textline-gamedata`` follow-up.
* ``HADES1_OFFER_TEXT_MAP`` - H2 has no ``MiscText.en.sjson`` offer-
  text indirection on boon vendor lines.
* ``HADES1_PRESET_CHOICES`` - H2 inline ``Choices = {...}`` blocks
  carry their options directly with no ``PresetEventArgs.<Name>``
  indirection. See :mod:`.choice_names` for the H2 label map.
* ``HADES1_META_UPGRADE_NAMES`` - H2 has no named-upgrade refs in
  RequirementSets (only count-based ``RequiredMetaUpgradesMin/Max``
  gates, which require no friendly-label lookup).
* ``HADES1_SECTION_KEY_PRIORITY_TIER`` - H2 drops H1's priority-tier
  system entirely; priority is now ordinal via
  :func:`extract_narrative_priorities` reading
  ``NarrativeData.lua``.
* ``HADES1_KNOWN_UNRESOLVED_REFS`` - the H2 equivalent
  (``HADES2_KNOWN_UNRESOLVED_REFS``) is exported alongside its own
  category label / description maps, see :mod:`.unresolved_refs`.
"""

# Vocabulary / label data
from .section_keys import (
    HADES2_TEXTLINE_SECTION_KEYS,
    HADES2_SECTION_KEY_LABELS,
)
from .speakers import HADES2_SPEAKERS
from .req_types import (
    HADES2_REQ_OPERATORS,
    HADES2_TEXTLINE_DEPENDENCY_FIELDS,
    HADES2_REQ_TYPE_LABELS,
    HADES2_REQ_TYPE_EDGE_LABELS,
    HADES2_REQ_TYPE_TOOLTIPS,
    HADES2_REQ_TYPE_DISPLAY_ORDER,
)
from .choice_names import HADES2_CHOICE_NAMES
from .owner_overrides import (
    HUB_NARRATOR_SPEAKER,
    TEXTLINE_OWNER_OVERRIDES,
    IDMAP_PARENT_OWNER_OVERRIDES,
)

# Walker primitives (shared by all H2 extractors)
from .named_requirements import extract_named_requirements
from .req_extractor import (
    HADES2_REQUIREMENT_SET_FIELDS,
    extract_requirements,
)
from .textline_set import (
    PLAYER_SPEAKER_ID,
    extract_textline,
    extract_textline_sections,
)

# Per-source extractors
from .npc_data import extract_npc_data
from .loot_data import (
    LOOT_DEFAULT_SPEAKERS,
    extract_loot_data,
)
from .enemy_data import (
    ENEMY_DEFAULT_SPEAKERS,
    extract_enemy_data,
)
from .deathloop_data import extract_deathloop_data
from .encounter_room_data import extract_encounter_room_data

# Cross-cutting passes
from .narrative_data import (
    extract_narrative_priorities,
    apply_narrative_priorities,
)
from .gamedata_refs import (
    HADES2_GAMEDATA_REF_SOURCE_FILES,
    extract_gamedata_refs,
)
from .unresolved_refs import (
    HADES2_KNOWN_UNRESOLVED_REFS,
    HADES2_UNRESOLVED_CATEGORY_LABELS,
    HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS,
)


__all__ = [
    # Vocabulary / label data
    "HADES2_TEXTLINE_SECTION_KEYS",
    "HADES2_SECTION_KEY_LABELS",
    "HADES2_SPEAKERS",
    "HADES2_REQ_OPERATORS",
    "HADES2_TEXTLINE_DEPENDENCY_FIELDS",
    "HADES2_REQ_TYPE_LABELS",
    "HADES2_REQ_TYPE_EDGE_LABELS",
    "HADES2_REQ_TYPE_TOOLTIPS",
    "HADES2_REQ_TYPE_DISPLAY_ORDER",
    "HADES2_CHOICE_NAMES",
    "HUB_NARRATOR_SPEAKER",
    "TEXTLINE_OWNER_OVERRIDES",
    "IDMAP_PARENT_OWNER_OVERRIDES",
    # Walker primitives
    "extract_named_requirements",
    "HADES2_REQUIREMENT_SET_FIELDS",
    "extract_requirements",
    "PLAYER_SPEAKER_ID",
    "extract_textline",
    "extract_textline_sections",
    # Per-source extractors
    "extract_npc_data",
    "LOOT_DEFAULT_SPEAKERS",
    "extract_loot_data",
    "ENEMY_DEFAULT_SPEAKERS",
    "extract_enemy_data",
    "extract_deathloop_data",
    "extract_encounter_room_data",
    # Cross-cutting passes
    "extract_narrative_priorities",
    "apply_narrative_priorities",
    "HADES2_GAMEDATA_REF_SOURCE_FILES",
    "extract_gamedata_refs",
    "HADES2_KNOWN_UNRESOLVED_REFS",
    "HADES2_UNRESOLVED_CATEGORY_LABELS",
    "HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS",
]
