"""
Loader for ``Scripts/RequirementsData.lua`` (Hades II).

H2 factors reusable requirement sets out into a top-level registry,
``NamedRequirementsData``, which other data files (NPCData, RoomData,
LootData, EncounterData, etc.) reference by name through two set-level
gate keys on any ``GameStateRequirements``-family field::

    GameStateRequirements = {
        NamedRequirements      = { "FirstSurfaceVisit" },   -- all must pass
        NamedRequirementsFalse = { "AllWeaponsUnlocked" },  -- none must pass
    }

The engine evaluator (``Content/Scripts/RequirementsLogic.lua::IsGameStateEligible``,
lines 42-57) looks each name up in ``NamedRequirementsData`` and
recursively evaluates the resulting RequirementSet against the current
GameState. So each value in the registry is itself a RequirementSet -
the same shape that any ``GameStateRequirements`` field carries::

    NamedRequirementsData =
    {
        FirstSurfaceVisit =
        {
            { Path = { "CurrentRun", "CurrentRoom", "Name" }, IsAny = { "N_Opening01" } },
            { Path = { "GameState", "RoomsEntered", "N_Opening01" }, Comparison = "==", Value = 1 },
        },
        OlympianOnSpawnVoiceLinesAllowed =
        {
            { Path = ..., IsNone = ... },                       -- per-record entry
            { FunctionName = "RequiredAlive", ... },            -- per-record entry
            NamedRequirementsFalse = { "FirstSurfaceVisit" },   -- set-level gate
        },
        ...
    }

The H2 requirement extractor (forthcoming, ``hades2.req_extractor``)
will inline-expand these references when it walks a ``GameStateRequirements``
so the rendered dependency graph surfaces the underlying conditions
rather than opaque name strings.

Loaded entries are dialogue-agnostic: this module does not classify
named requirements as "dialogue" vs "other". The downstream extractor
makes that split per-record - records targeting ``GameState.TextLinesRecord``
(or ``SpeechRecord``, choice records, etc.) become first-class graph
edges; everything else (e.g. ``AllWeaponsUnlocked`` /
``IsDevotionEncounter`` / ``QuestLogUnlocked``) goes into the textline's
``otherRequirements`` bucket that the viewer renders at the bottom of
the detail panel (mirroring H1's :data:`NON_DIALOGUE_REQ_PREFIX`
handling in :mod:`src.extractors.textline_set`).

Note for the req extractor: ~40% of named requirements (73 / 179 in
the shipped game) contain textline references via
``TextLinesRecord`` / ``SpeechRecord`` paths, and 14 named requirements
chain into OTHER named requirements via set-level
``NamedRequirements`` / ``NamedRequirementsFalse`` keys
(e.g. ``ScyllaBalladForced`` -> ``ScyllaBalladUnlocked`` +
``ScyllaEMActiveAndNotCleared``). The extractor must therefore
recursively walk each referenced RequirementSet so the textline refs
buried inside it surface as graph edges on the host textline (with
cycle protection - the recursion is finite because the registry is
finite, but a chain of references through the same name should be
short-circuited).

Out of scope for this loader: the same file's tail-end
``DebugData.LegalGenericRequirementKeys`` /
``DebugData.LegalNonGenericRequirementKeys`` enumerations. Those are
already vendored as the operator allowlist in
:mod:`src.extractors.hades2.req_types` and are silently ignored here.
"""

from ...lua_parser import LuaTable


NAMED_REQUIREMENTS_KEY = "NamedRequirementsData"


def extract_named_requirements(parsed: dict) -> dict:
    """Return a ``{ name: RequirementSet }`` map from a parsed RequirementsData.lua.

    ``parsed`` is the ``dict`` returned by
    :func:`src.lua_parser.parse_lua_file` on the source file. Each value
    in the returned map is a :class:`LuaTable` holding the named
    RequirementSet exactly as the engine would evaluate it.

    Returns an empty dict when the file doesn't define
    ``NamedRequirementsData`` so the pipeline still runs - the H2
    requirement extractor will simply surface the bare name as
    unresolved instead of inlining the conditions.
    """
    table = parsed.get(NAMED_REQUIREMENTS_KEY)
    if not isinstance(table, LuaTable):
        return {}
    result = {}
    for name, value in table.named.items():
        if not isinstance(name, str) or not isinstance(value, LuaTable):
            continue
        result[name] = value
    return result
