"""
Walker that classifies a Hades II ``RequirementSet`` into dialogue
graph edges + bottom-of-panel "other requirements" metadata, mirroring
the shape H1 produces so the existing graph builder consumes both
games' output uniformly.

H1 stores its requirements in a flat per-field shape that the graph
builder reads directly::

    data["requirements"]["RequiredTextLines"] = ["TextlineA", "TextlineB"]
    data["otherRequirements"]["RequiredKills"] = 5

H2's evaluator (``Content/Scripts/RequirementsLogic.lua::IsGameStateEligible``)
treats the same data as a RequirementSet with two AND'd levels:

* **Set-level keys** at the top of the value: ``Skip`` / ``Force`` /
  ``ChanceToPlay`` (short-circuits or probability gates),
  ``NamedRequirements`` / ``NamedRequirementsFalse`` (registry references
  - see :mod:`.named_requirements`), ``OrRequirements`` (composition).
* **Per-record array entries**, each carrying a primary operator
  (``PathTrue`` / ``Path`` + ``HasAny`` / ``Comparison`` / ...) plus
  modifiers and parameters from the 28 LegalGenericRequirementKeys
  enumerated in :mod:`.req_types`.

This walker translates each per-record entry into one of two buckets:

1. **Dialogue edges** (``requirements``) - when the record references
   ``GameState`` / ``CurrentRun`` / ``PrevRun`` ``TextLinesRecord``
   the textline names get hoisted into an H1-compatible synthetic
   field (``RequiredTextLines`` / ``RequiredAnyTextLinesThisRun`` /
   ...). The graph builder then creates a dialogue dependency edge
   exactly as it does for H1. Both container-form
   (``Path = { ..., TextLinesRecord }, HasAll = { "A", "B" }``) and
   direct-path form (``PathTrue = { ..., TextLinesRecord, "A" }``) are
   handled - the direct-path single-name form maps to a one-element
   list under the same synthetic key, and multiple records into the
   same key are merged because per-record entries on a RequirementSet
   are AND'd by the engine.
2. **Other requirements** (``otherRequirements``) - everything else
   (FunctionName, room-name path comparisons, biome state, trait
   dictionary, weapon flags, story flags, etc.). These get rendered
   verbatim in the bottom-of-detail-panel section the viewer surfaces
   for non-dialogue gates (mirroring H1's
   :data:`NON_DIALOGUE_REQ_PREFIX` -> ``otherRequirements`` routing in
   :mod:`src.extractors.textline_set`).

Composition keys handled at the set level:

* ``Skip = true`` / ``Force = true`` -> ``flags["skip"]`` /
  ``flags["force"]`` so downstream code can decide whether to render
  the textline at all.
* ``ChanceToPlay = 0.5`` -> ``flags["chanceToPlay"]``.
* ``NamedRequirements = { "Name" }`` -> recursively expand the named
  RequirementSet (looked up in the registry from
  :mod:`.named_requirements`) and merge its outputs in. Cycle
  protection via a ``visited`` frozenset on each call: a name that's
  already on the resolution stack is silently skipped to avoid
  infinite recursion in the (theoretical) case of a self-referential
  chain.
* ``NamedRequirementsFalse = { "Name" }`` -> surfaced as an
  ``otherRequirements`` entry rather than inlined, because the engine
  semantics is "this named set must FAIL" - blindly inlining would
  invert dialogue-edge directions in a way the graph builder can't
  represent today. The viewer renders the name list at the bottom.
* ``OrRequirements = { branch1, branch2 }`` -> each branch is walked
  in isolation; their outputs land in a separate ``orBranches`` list
  on the result so a future graph-OR-node feature (see ``h2-graph-or``
  todo) can render alternatives. Until then the caller can decide
  whether to flatten or hide them.

Module-private constants pin the empirical TextLinesRecord path
prefixes to the H1 synthetic keys above. They were derived from a
walker audit across every H2 ``Content/Scripts/*.lua`` file (~21k
requirement records total, with ~1300 dialogue-edge records using
these prefixes).
"""

from ...lua_parser import LuaTable, LuaIdentifier, LuaExpression


# RequirementSet-bearing fields - the only fields on a parent table whose
# value is treated by the engine as a RequirementSet (i.e. legal input
# to ``IsGameStateEligible``). Derived from grepping
# ``IsGameStateEligible(*, x.<Field>)`` callsites across every H2 script.
# Not every field whose name ends in ``Requirements`` qualifies - e.g.
# ``EnemyData_Boar.BoarRush.Requirements`` is AI behaviour data
# (``MinAttacksBetweenUse`` etc.), NOT a RequirementSet.
HADES2_REQUIREMENT_SET_FIELDS = frozenset({
    "GameStateRequirements",
    "GameStateRequirementsAdditional",
    "SetupGameStateRequirements",
    "CompleteGameStateRequirements",
    "CompletedGameStateRequirements",
    "CompletedRequirements",
    "PurchaseRequirements",
    "AcquireRequirements",
    "OnAcquireRequirements",
    "MusicMixerRequirements",
    "BoughtTextLinesRequirements",
    "TextLinesRequirements",
    "CueRequirements",
    "RetrieveGameStateRequirements",
    "UnlockGameStateRequirements",
    "UnlockRequirements",
    "PreFinishGameStateRequirements",
    "OnSpawnGameStateRequirements",
    "OnSelectRequirements",
    "EndConditionGameStateRequirements",
    "EncounterStartGameStateRequirements",
    "EncounterEndGameStateRequirements",
    "ZagreusContractRequirement",      # singular - lives on ChronosGameOverPresentation
    "MaxedRequirement",                # singular - lives on TraitData entries
    "PartnerCueGameStateRequirements",
    "OnUseGameStateRequirements",
    "OnUsedGameStateRequirements",     # gates obstacle / NPC interaction (Q_Story01 ObstacleData; NPCData_Nemesis OnQueuedFunctionArgs)
    "OnGiveGameStateRequirements",
    "OnFireGameStateRequirements",
    "PlayerReactionRequirements",
    "PlayerActionGameStateRequirements",
    "PlayerActionRequirements",
    "StealRequirements",
    "StoryStateRequirements",
})


# Container-form ``Path`` -> H1 synthetic key per primary operator.
# Each entry's key is the tuple of path segments before the operator's
# value list; the value is a per-operator H1 field name. Direct-path
# form (PathTrue/PathFalse ending in the textline name) reuses the
# HasAll / HasNone columns respectively, with the single name wrapped
# in a one-element list.
_TEXTLINE_PATH_PREFIXES = {
    # Cross-run history
    ("GameState", "TextLinesRecord"): {
        "HasAll":  "RequiredTextLines",
        "HasAny":  "RequiredAnyTextLines",
        "HasNone": "RequiredFalseTextLines",
    },
    # Current-run only
    ("CurrentRun", "TextLinesRecord"): {
        "HasAll":  "RequiredTextLinesThisRun",
        "HasAny":  "RequiredAnyTextLinesThisRun",
        "HasNone": "RequiredFalseTextLinesThisRun",
    },
    # Last completed run only
    ("PrevRun", "TextLinesRecord"): {
        "HasAll":  "RequiredTextLinesLastRun",
        "HasAny":  "RequiredAnyTextLinesLastRun",
        "HasNone": "RequiredFalseTextLinesLastRun",
    },
    # Queued for play this run (cue-queued / not yet drained)
    ("CurrentRun", "QueuedTextLines"): {
        "HasAll":  "RequiredQueuedTextLines",
        "HasAny":  "RequiredAnyQueuedTextLines",
        "HasNone": "RequiredFalseQueuedTextLines",
    },
    # Choice-record container form: the values are the *parent* dialogue
    # names whose choice the player recorded (made any choice in). The
    # parent is itself a textline, so "has a choice record for <parent>"
    # is a dependency on having played <parent>. (The direct form -
    # ``Path = { ..., TextLinesChoiceRecord, <parent> }, IsAny = {
    # <ChoiceText> }`` - which gates on a *specific* choice is handled by
    # :func:`_try_classify_choice_record`, mapping to the
    # ``<parent><ChoiceText>`` synthetic variant.)
    ("GameState", "TextLinesChoiceRecord"): {
        "HasAll":  "RequiredTextLines",
        "HasAny":  "RequiredAnyTextLines",
        "HasNone": "RequiredFalseTextLines",
    },
}


# PathTrue/PathFalse direct-path form (last segment is the textline
# name) - we re-key by the prefix WITHOUT the leaf to find the synthetic
# field. The True/False half picks the HasAll/HasNone column.
_DIRECT_PATH_OP_TO_CONTAINER_OP = {
    "PathTrue":  "HasAll",
    "PathFalse": "HasNone",
}


# Choice-record form: ``Path = { GameState, TextLinesChoiceRecord,
# <parent> }`` with ``IsAny`` / ``IsNone`` listing ChoiceText ids. H2
# records the option the player picked in ``<parent>`` under
# ``GameState.TextLinesChoiceRecord.<parent>`` (a single ChoiceText
# string), rather than H1's approach of writing a ``<parent><ChoiceText>``
# entry straight into ``TextLinesRecord``. The synthetic textline our
# walker emits for that inline cue choice IS ``<parent><ChoiceText>``
# (see :func:`src.extractors.textline_set.build_synthetic_variants`), so a
# "chose Choice_X in <parent>" gate is exactly a dependency on that
# synthetic variant. Routing it to a dialogue edge (``IsAny`` ->
# ``RequiredAnyTextLines``, ``IsNone`` -> ``RequiredFalseTextLines``)
# surfaces the choice relationship in the dependency graph instead of
# burying it in ``otherRequirements`` as an opaque GameState path.
_CHOICE_RECORD_KEY = "TextLinesChoiceRecord"
_CHOICE_RECORD_OP_TO_FIELD = {
    "IsAny":  "RequiredAnyTextLines",
    "IsNone": "RequiredFalseTextLines",
}


# Per-record keys that the walker considers helpers / parameters
# (modify the primary check rather than starting a new one). Listed
# here only so we can skip them when picking the primary key.
_HELPER_KEYS = frozenset({
    "PathFromArgs", "PathFromSource", "HintId",
    "UseLength", "Modulo", "CountOf", "SumOf", "MaxOf",
    "TableValuesToCount", "ValuesToCount", "CountPathTrue",
    "SumPrevRuns", "SumPrevRooms", "IgnoreCurrentRun",
    "Value", "ValuePath", "ValuePathAddition",
    "FunctionArgs",
})


# Non-operator data-merge directives that can appear inside a
# RequirementSet but are ignored by the evaluator. The walker silently
# skips them so they don't leak into otherRequirements as bogus gates.
_INHERITANCE_DIRECTIVES = frozenset({
    "Append", "DeepInheritance", "PlayFirst",
})


def extract_requirements(req_set, named_requirements=None, *, _visited=frozenset()):
    """Walk a single H2 ``RequirementSet`` value and return classified output.

    ``req_set`` is a :class:`LuaTable` whose ``named`` carries set-level
    keys (Skip / Force / ChanceToPlay / NamedRequirements / ... ) and
    whose ``array`` carries per-record entries. ``named_requirements``
    is the registry returned by
    :func:`src.extractors.hades2.named_requirements.extract_named_requirements`;
    pass ``None`` (or ``{}``) to leave ``NamedRequirements`` references
    unresolved (each name will appear as a string in
    ``otherRequirements`` instead of being inlined).

    Returns a fresh dict shaped like::

        {
            "requirements":      { synthetic_key: [textline_names] },
            "otherRequirements": { synthetic_key: structured_value },
            "orBranches":        [ <result-shaped dict>, ... ],
            "flags":             { "skip": bool, "force": bool,
                                   "chanceToPlay": float | None },
        }

    Empty containers are omitted - a result with no edges and no other
    requirements yields all-empty values. The output is JSON-serialisable
    (LuaTable values are normalised to plain dicts/lists before being
    stored in ``otherRequirements``).
    """
    result = {
        "requirements": {},
        "otherRequirements": {},
        "orBranches": [],
        "flags": {},
    }
    if not isinstance(req_set, LuaTable):
        return result

    named_requirements = named_requirements or {}

    # --- Set-level short-circuits & flags ----------------------------------
    if req_set.named.get("Skip") is True:
        result["flags"]["skip"] = True
    if req_set.named.get("Force") is True:
        result["flags"]["force"] = True
    chance = req_set.named.get("ChanceToPlay")
    if isinstance(chance, (int, float)):
        result["flags"]["chanceToPlay"] = float(chance)

    # --- Set-level NamedRequirements (inline-expand recursively) -----------
    for name in _string_list(req_set.named.get("NamedRequirements")):
        if name in _visited:
            # Cycle: leave a breadcrumb in otherRequirements so the
            # author can investigate, but don't recurse.
            _add_other(result, "NamedRequirementsCycle", name)
            continue
        target = named_requirements.get(name)
        if target is None:
            # Unresolved: keep the name on the host so the viewer can
            # surface it (mirrors H1's behaviour for unresolved refs).
            _add_other(result, "NamedRequirements", name)
            continue
        nested = extract_requirements(
            target, named_requirements, _visited=_visited | {name})
        _merge(result, nested)

    # --- Set-level NamedRequirementsFalse (surfaced, NOT inlined) ----------
    # Inlining would require flipping operators (De Morgan), which can't
    # be expressed in the H1-compatible graph. Surface the name list so
    # the viewer renders it at the bottom.
    for name in _string_list(req_set.named.get("NamedRequirementsFalse")):
        _add_other(result, "NamedRequirementsFalse", name)

    # --- Set-level OrRequirements (each branch -> orBranches entry) --------
    or_reqs = req_set.named.get("OrRequirements")
    if isinstance(or_reqs, LuaTable):
        for branch in or_reqs.array:
            if isinstance(branch, LuaTable):
                branch_result = extract_requirements(
                    branch, named_requirements, _visited=_visited)
                # Drop empty branches (no constraints expressed).
                if (branch_result["requirements"]
                        or branch_result["otherRequirements"]
                        or branch_result["orBranches"]
                        or branch_result["flags"]):
                    # Prune empty containers from each per-branch
                    # payload before it lands on ``result["orBranches"]``
                    # so the serialised JSON stays compact (the viewer
                    # uses ``branch.requirements`` / ``branch.flags``
                    # with ``?.`` checks, so absent keys are fine).
                    for k in ("requirements", "otherRequirements", "orBranches", "flags"):
                        if not branch_result[k]:
                            del branch_result[k]
                    result["orBranches"].append(branch_result)

    # --- Per-record array entries ------------------------------------------
    for record in req_set.array:
        if isinstance(record, LuaTable):
            _classify_record(record, result)

    return result


def _classify_record(record, result):
    """Bucket a single record into ``requirements`` or ``otherRequirements``.

    Tries the dialogue-edge mappings first (container-form Path then
    direct-path PathTrue/PathFalse, then a small allowlist of
    ``FunctionName`` calls that gate on textline records). Falls back
    to a structured ``otherRequirements`` entry for everything else.
    """
    # Container-form: Path = { prefix..., TextLinesRecord }, HasX = { ... }
    path_segs = _string_path(record.named.get("Path"))
    if path_segs is not None:
        prefix = tuple(path_segs)
        prefix_map = _TEXTLINE_PATH_PREFIXES.get(prefix)
        if prefix_map is not None:
            for op_name, syn_key in prefix_map.items():
                names = _string_list(record.named.get(op_name))
                if names:
                    _extend_requirements(result, syn_key, names)
                    return
        # Path matched a TextLines prefix but no recognised container op
        # (e.g. Comparison/SumPrevRuns aggregator), or the prefix isn't a
        # textline path - fall through to otherRequirements.

    # Direct-path form: PathTrue/PathFalse = { prefix..., TextLinesRecord, "Name" }
    for direct_op, container_op in _DIRECT_PATH_OP_TO_CONTAINER_OP.items():
        path = _string_path(record.named.get(direct_op))
        if path is None or len(path) < 2:
            continue
        prefix = tuple(path[:-1])
        leaf = path[-1]
        prefix_map = _TEXTLINE_PATH_PREFIXES.get(prefix)
        if prefix_map is not None and container_op in prefix_map:
            syn_key = prefix_map[container_op]
            _extend_requirements(result, syn_key, [leaf])
            return

    # Choice-record form: Path = { GameState, TextLinesChoiceRecord, <parent> },
    # IsAny / IsNone = { "Choice_X", ... } -> dependency on the synthetic
    # <parent><Choice_X> textline (see _CHOICE_RECORD_OP_TO_FIELD).
    if _try_classify_choice_record(record, result):
        return

    # FunctionName-based predicates with textline semantics route to
    # dialogue edges (see ``_TEXTLINE_FUNCTION_HANDLERS``).
    if _try_classify_textline_function(record, result):
        return

    # Everything else goes to otherRequirements as a structured blob.
    _add_record_as_other(record, result)


def _try_classify_choice_record(record, result):
    """Route a ``GameState.TextLinesChoiceRecord.<parent>`` choice gate to
    a dialogue edge on the matching ``<parent><ChoiceText>`` synthetic
    variant. Returns True if the record was consumed.

    ``IsAny`` (the player picked one of the listed options) becomes a
    ``RequiredAnyTextLines`` edge; ``IsNone`` (did not pick any) becomes
    ``RequiredFalseTextLines``. A record carrying neither is left for the
    ``otherRequirements`` fallback.
    """
    path = _string_path(record.named.get("Path"))
    if path is None or len(path) != 3 or path[1] != _CHOICE_RECORD_KEY:
        return False
    parent = path[2]
    consumed = False
    for op_name, syn_key in _CHOICE_RECORD_OP_TO_FIELD.items():
        choices = _string_list(record.named.get(op_name))
        if choices:
            _extend_requirements(result, syn_key, [parent + c for c in choices])
            consumed = True
    return consumed


# ---------------------------------------------------------------------------
# FunctionName-based textline gates
# ---------------------------------------------------------------------------
# A small allowlist of custom requirement functions (defined in
# Hades II's ``RequirementsLogic.lua``) whose semantics gate the parent
# dialogue on textline-record state. Each handler is allowed to mutate
# ``result`` and return True if it consumed the record (no fallthrough).
#
# Why route these into the H1-compatible ``requirements`` bucket
# instead of leaving them in ``otherRequirements``:
#
# * The textlines referenced in ``FunctionArgs.TextLines`` (etc.) are
#   real dialogue dependencies - the parent dialogue is gated on those
#   textlines having (or not having) been played. Surfacing them as
#   dialogue edges puts them in the tree alongside other dependency
#   requirements rather than burying them in the Other Requirements
#   section.
# * H1 has equivalent first-class fields for the same semantics
#   (``MinRunsSinceAnyTextLines`` / ``MaxRunsSinceAnyTextLines`` /
#   ``RequiredAnyQueuedTextLines`` / ``RequiredFalseQueuedTextLines``).
#   Routing H2 into the same field names keeps both games' dependency
#   graphs uniform and reuses H1's friendly labels via the borrowed
#   ``HADES2_TEXTLINE_DEPENDENCY_FIELDS`` set in
#   :mod:`.req_types`.


def _set_count_extreme(result, syn_key, value, strict):
    """Stash a ``Count`` metadata value under ``otherRequirements[syn_key]``,
    composing across multiple records on the same parent. ``strict`` is
    either ``max`` (for Min thresholds: larger = stricter) or ``min``
    (for Max thresholds: smaller = stricter)."""
    bucket = result["otherRequirements"].setdefault(syn_key, {})
    if isinstance(bucket, dict):
        existing = bucket.get("Count")
        bucket["Count"] = value if existing is None else strict(existing, value)


def _try_classify_textline_function(record, result):
    """Re-route a ``FunctionName`` record into the dialogue-edge graph
    when its semantics gate on textline records. Returns ``True`` if
    the record was consumed (no otherRequirements fallthrough)."""
    fn = record.named.get("FunctionName")
    if not isinstance(fn, str):
        return False
    args_table = record.named.get("FunctionArgs")
    if not isinstance(args_table, LuaTable):
        return False

    if fn == "RequireRunsSinceTextLines":
        # Semantics (RequirementsLogic.lua::RequireRunsSinceTextLines):
        # for each textline in ``TextLines``, walk GameState.RunHistory
        # backwards. If ``Min = N`` is set, the textline must either
        # not appear in any prev run or last appear at least N runs
        # ago. If ``Max = N`` is set, the textline must appear within
        # the last N runs (else returns false).
        #
        # H1 analogues:
        #   Min -> MinRunsSinceAnyTextLines (Count = N)
        #   Max -> MaxRunsSinceAnyTextLines (Count = N)
        textlines = _string_list(args_table.named.get("TextLines"))
        if not textlines:
            return False
        consumed = False
        min_val = args_table.named.get("Min")
        if isinstance(min_val, (int, float)):
            _extend_requirements(result, "MinRunsSinceAnyTextLines", textlines)
            _set_count_extreme(result, "MinRunsSinceAnyTextLines", int(min_val), max)
            consumed = True
        max_val = args_table.named.get("Max")
        if isinstance(max_val, (int, float)):
            _extend_requirements(result, "MaxRunsSinceAnyTextLines", textlines)
            _set_count_extreme(result, "MaxRunsSinceAnyTextLines", int(max_val), min)
            consumed = True
        return consumed

    if fn == "RequiredQueuedTextLine":
        # Semantics (RequirementsLogic.lua::RequiredQueuedTextLine):
        # ``IsAny`` requires at least one of the listed textlines to be
        # queued on an active enemy unit (NextInteractLines /
        # QueuedBossIntroTextLines). ``IsNone`` requires none of them
        # to be queued.
        #
        # H1 analogues:
        #   IsAny  -> RequiredAnyQueuedTextLines
        #   IsNone -> RequiredFalseQueuedTextLines
        is_any = _string_list(args_table.named.get("IsAny"))
        is_none = _string_list(args_table.named.get("IsNone"))
        consumed = False
        if is_any:
            _extend_requirements(result, "RequiredAnyQueuedTextLines", is_any)
            consumed = True
        if is_none:
            _extend_requirements(result, "RequiredFalseQueuedTextLines", is_none)
            consumed = True
        return consumed

    return False


# Synthetic H1-shaped requirement field names this module produces
# from ``FunctionName`` records via
# :func:`_try_classify_textline_function`. Keep in sync with the
# handler body above; pinned by
# :func:`tests.hades2.test_req_types.test_textline_dependency_fields_match_extractor_outputs`.
_FUNCTION_TEXTLINE_SYNTHETIC_KEYS = frozenset({
    "MinRunsSinceAnyTextLines",
    "MaxRunsSinceAnyTextLines",
    "RequiredAnyQueuedTextLines",
    "RequiredFalseQueuedTextLines",
})


def _add_record_as_other(record, result):
    """Stuff a non-dialogue record into ``otherRequirements`` with a
    stable synthesised key so the viewer can render every gate."""
    # Skip pure inheritance directives and obviously empty records.
    if not record.named:
        return
    if all(k in _INHERITANCE_DIRECTIVES for k in record.named):
        return

    normalised = _normalise_lua(record)
    if not isinstance(normalised, dict) or not normalised:
        return
    # Drop inheritance directives from the normalised view.
    for directive in _INHERITANCE_DIRECTIVES:
        normalised.pop(directive, None)
    if not normalised:
        return

    # Synthesised key chosen to keep adjacent similar gates grouped in
    # the viewer (path prefix wins, else FunctionName, else "Requirement").
    key = _synth_other_key(normalised)
    # Multiple records can share a synthesised key (e.g. several
    # FunctionName="RequiredAlive" gates on the same set). Stack them
    # under the same key as a list so none are lost, but skip a record
    # identical to one already present: AND-combined gates read X AND X
    # as X, and the same clause routinely arrives twice - once directly
    # on the host and once from an inline-expanded NamedRequirements
    # block - which would otherwise render as a duplicate row. Mirrors
    # the dedup ``_add_other`` already does for its name lists.
    bucket = result["otherRequirements"].setdefault(key, [])
    if isinstance(bucket, list):
        if normalised not in bucket:
            bucket.append(normalised)
    else:
        # First write put a scalar in - upgrade to list.
        if bucket != normalised:
            result["otherRequirements"][key] = [bucket, normalised]


def _synth_other_key(normalised):
    """Pick a deterministic key for an otherRequirements entry."""
    for path_op in ("PathTrue", "PathFalse", "PathEmpty", "PathNotEmpty", "Path"):
        path = normalised.get(path_op)
        if isinstance(path, list) and path:
            head = ".".join(str(s) for s in path)
            return f"{path_op}:{head}"
    fn = normalised.get("FunctionName")
    if isinstance(fn, str):
        return f"FunctionName:{fn}"
    return "Requirement"


def _extend_requirements(result, syn_key, names):
    """Append textline names under a synthetic key, preserving order &
    de-duplicating so multiple AND'd records into the same key compose
    cleanly (the engine reads ``valueToCheck[name]`` so duplicates are
    no-ops; storing one copy keeps the graph clean)."""
    existing = result["requirements"].setdefault(syn_key, [])
    seen = set(existing)
    for n in names:
        if n in seen:
            continue
        seen.add(n)
        existing.append(n)


def _add_other(result, key, value):
    """Append ``value`` to the list at ``otherRequirements[key]``.
    Used for set-level metadata (NamedRequirementsFalse, etc.) where we
    accumulate a flat list of names."""
    bucket = result["otherRequirements"].setdefault(key, [])
    if isinstance(bucket, list):
        if value not in bucket:
            bucket.append(value)
    else:
        result["otherRequirements"][key] = [bucket, value]


def _merge(into, other):
    """Merge a nested walker result into a parent's result (used when
    expanding NamedRequirements)."""
    for syn_key, names in other["requirements"].items():
        _extend_requirements(into, syn_key, names)
    for key, val in other["otherRequirements"].items():
        if isinstance(val, list):
            for item in val:
                _add_other(into, key, item)
        else:
            _add_other(into, key, val)
    into["orBranches"].extend(other["orBranches"])
    # Set-level flags propagate: a Skip / Force inside an expanded named
    # requirement still short-circuits the host's eligibility.
    for flag_key, flag_val in other["flags"].items():
        into["flags"].setdefault(flag_key, flag_val)


# --- Lua-value helpers ----------------------------------------------------


def _string_list(value):
    """Return ``value.array`` filtered to strings, or ``[]`` if not a LuaTable."""
    if not isinstance(value, LuaTable):
        return []
    return [s for s in value.array if isinstance(s, str)]


def _string_path(value):
    """Return ``value.array`` filtered to strings IF it looks like a path
    (all entries are strings, table has no named keys). Returns
    ``None`` otherwise so callers can distinguish "no path here" from
    "empty path"."""
    if not isinstance(value, LuaTable):
        return None
    if value.named:
        return None
    out = []
    for item in value.array:
        if not isinstance(item, str):
            return None
        out.append(item)
    return out


def _normalise_lua(value):
    """Convert a LuaTable tree into plain dict/list values for storage
    in ``otherRequirements``. Unresolved identifiers / expressions
    become string-tagged placeholders so the result is JSON-safe."""
    if isinstance(value, LuaTable):
        if value.named and not value.array:
            return {k: _normalise_lua(v) for k, v in value.named.items()}
        if value.array and not value.named:
            return [_normalise_lua(v) for v in value.array]
        # Mixed: surface both halves on the same dict so nothing is dropped.
        out = {k: _normalise_lua(v) for k, v in value.named.items()}
        if value.array:
            out["_array"] = [_normalise_lua(v) for v in value.array]
        return out
    if isinstance(value, LuaIdentifier):
        return f"<ref:{value.name}>"
    if isinstance(value, LuaExpression):
        return f"<expr:{value.raw}>"
    return value
