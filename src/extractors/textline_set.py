"""
Shared textline-set extraction logic used by every per-source extractor
(NPCData, EnemyData, LootData, DeathLoopData).

A "textline" is the in-game unit that drives a chunk of dialogue. The Lua
representation is the same across all four source files:

    SomeTextlineName = {
        PlayOnce = true,
        RequiredTextLines = { "..." },
        RequiredFalseTextLines = { "..." },
        ...
        { Speaker = "CharProtag", Text = "..." },
        { Cue = "...", Text = "..." },          -- Speaker defaults to owner
        ...
    }

What differs between sources is how to *find* the textline-set sections in
the parsed tree, and what the "owner" of each section is (an NPC, an enemy,
a god boon, an inspect-point id). Those concerns live in the per-source
extractor.
"""

import re

from ..lua_parser import LuaTable, LuaIdentifier, LuaExpression

# Requirement fields that reference other textlines (dialogue dependencies).
# Whenever we add a new source we run an audit (see `audit_requirement_fields`)
# to catch fields matching `Required.*TextLine.*` that are not listed here.
TEXTLINE_REQ_FIELDS = {
    "RequiredTextLines",
    "RequiredAnyTextLines",
    "RequiredAnyOtherTextLines",
    "RequiredFalseTextLines",
    "RequiredFalseQueuedTextLines",
    "RequiredFalseTextLinesThisRun",
    "RequiredFalseTextLinesLastRun",
    "RequiredFalseTextLinesThisRoom",
    "RequiredTextLinesThisRun",
    "RequiredTextLinesLastRun",
    "RequiredTextLinesThisRoom",
    "RequiredAnyTextLinesThisRun",
    "RequiredAnyTextLinesLastRun",
    "RequiredQueuedTextLines",
    "RequiredAnyQueuedTextLines",
}

# Count-based requirement fields with shape:
#   { TextLines = { "...", "..." }, Count = N }
# The inner `TextLines` list is the actual dependency list.
TEXTLINE_REQ_FIELDS_COUNT = {
    "RequiredMinAnyTextLines",
    "RequiredMaxAnyTextLines",
    "MinRunsSinceAnyTextLines",
    "MaxRunsSinceAnyTextLines",
}

# Field names that look like textline requirements but are not. These are
# either typos in the game data (e.g. truncated keys) or unrelated fields
# whose name happens to match the audit pattern.
REQ_TEXTLINE_FIELD_IGNORES = {
    "RequiredTextLinesThis",  # game-data typo, seen once in NPCData.lua
}

NON_DIALOGUE_REQ_PREFIX = "Require"

# Per requirement-field semantics for the "is this textline blocked by
# unresolved refs?" analysis. Values:
#   "all"        every entry must have played -> any unresolved entry
#                blocks the referencing textline outright.
#   "any"        at least one entry must have played -> blocks only when
#                ALL entries are unresolved.
#   "none"       the entry must NOT have played -> unresolved is trivially
#                satisfied (never-defined lines can never play), so never
#                blocking.
#   "count-min"  field shape ``{ TextLines = {...}, Count = N }``: blocks
#                when ``N > number-of-resolved-entries``.
#   "count-permissive"
#                count-based field whose semantics treat "never played"
#                as satisfying the requirement (e.g. MinRunsSinceAnyTextLines:
#                if none of the listed lines ever played, "runs since" is
#                effectively infinite, so the >=N condition is met). Never
#                blocking from unresolved entries alone.
REQUIREMENT_BLOCKING_SEMANTICS = {
    # ALL-required forms
    "RequiredTextLines":                 "all",
    "RequiredTextLinesThisRun":          "all",
    "RequiredTextLinesLastRun":          "all",
    "RequiredTextLinesThisRoom":         "all",
    "RequiredQueuedTextLines":           "all",

    # ANY-required forms
    "RequiredAnyTextLines":              "any",
    "RequiredAnyOtherTextLines":         "any",
    "RequiredAnyTextLinesThisRun":       "any",
    "RequiredAnyTextLinesLastRun":       "any",
    "RequiredAnyQueuedTextLines":        "any",

    # Must-not-have-played forms (always non-blocking for unresolved refs)
    "RequiredFalseTextLines":            "none",
    "RequiredFalseQueuedTextLines":      "none",
    "RequiredFalseTextLinesThisRun":     "none",
    "RequiredFalseTextLinesLastRun":     "none",
    "RequiredFalseTextLinesThisRoom":    "none",

    # Count-based forms (otherRequirements carries the Count param)
    "RequiredMinAnyTextLines":           "count-min",
    "RequiredMaxAnyTextLines":           "count-permissive",
    "MinRunsSinceAnyTextLines":          "count-permissive",
    "MaxRunsSinceAnyTextLines":          "count-permissive",
}

# --- Section-key audit helpers --------------------------------------------
# The viewer-label data itself (req-type labels, edge labels, display
# order) is per-game and lives next to each game's section-key allowlist
# (e.g. ``hades1/req_types.py``). H2's requirement vocabulary is
# disjoint from H1's, so a per-game seam in ``build_viewer.annotate_label_maps``
# merges them rather than shipping a single global map from this module.
#
# The audit helpers below remain here because they are game-agnostic -
# they just compare an allowlist set against a labels mapping and
# surface either direction of drift.


def audit_section_key_labels(section_keys, labels) -> set:
    """Return the subset of ``section_keys`` that have no entry in
    ``labels``.

    Used by ``build_viewer.py`` so a newly-allowlisted key without a
    friendly-name mapping is surfaced as a build-time warning rather
    than silently falling back to the raw camelCase key in the viewer.
    Stale entries (label keys not in ``section_keys``) are also worth
    surfacing - the helper ``audit_section_key_labels_stale`` covers
    that direction.
    """
    return set(section_keys) - set(labels)


def audit_section_key_labels_stale(section_keys, labels) -> set:
    """Return the subset of ``labels`` keys that are not in
    ``section_keys`` (i.e. friendly names defined for keys the
    allowlist no longer contains).
    """
    return set(labels) - set(section_keys)


def audit_req_type_labels(req_fields, labels) -> set:
    """Return the subset of ``req_fields`` that have no entry in
    ``labels``.

    Mirrors ``audit_section_key_labels`` but for the requirement-field
    vocabulary: each entry in a game's req-fields allowlist
    (``TEXTLINE_REQ_FIELDS`` | ``TEXTLINE_REQ_FIELDS_COUNT`` for H1)
    must have a friendly header in the per-game labels map, or the
    viewer falls back to the raw camelCase field name.
    """
    return set(req_fields) - set(labels)


def audit_req_type_labels_stale(req_fields, labels) -> set:
    """Return the subset of ``labels`` keys that are not in
    ``req_fields`` (i.e. friendly names defined for fields the
    allowlist no longer contains - typically left behind by a typo
    fix or a field rename).
    """
    return set(labels) - set(req_fields)


def audit_req_type_edge_labels(req_fields, edge_labels) -> set:
    """Return the subset of ``req_fields`` that have no entry in
    ``edge_labels``.

    Mirrors :func:`audit_req_type_labels` for the tree edge chip
    vocabulary. Missing entries fall back to the literal ``'ALL'``
    chip in the viewer (``reqTypeEdgeLabels[type] || 'ALL'`` in
    ``viewer.js``) which is a silent mislabel for any
    non-``all``-semantics field.
    """
    return set(req_fields) - set(edge_labels)


def audit_req_type_edge_labels_stale(req_fields, edge_labels) -> set:
    """Return the subset of ``edge_labels`` keys that are not in
    ``req_fields``. Reverse direction of
    :func:`audit_req_type_edge_labels`.
    """
    return set(edge_labels) - set(req_fields)


def audit_req_type_display_order(req_fields, display_order) -> set:
    """Return the subset of ``req_fields`` that does not appear in
    ``display_order``.

    Fields missing from the order list sort to the end via the viewer's
    ``reqTypeOrderIndex`` fallback sentinel, breaking the curated
    grouping that puts hard requirements above permissive ones.
    """
    return set(req_fields) - set(display_order)


def audit_req_type_display_order_stale(req_fields, display_order) -> set:
    """Return the subset of ``display_order`` entries that are not in
    ``req_fields``. Reverse direction of
    :func:`audit_req_type_display_order` - a leftover entry from a
    renamed/removed field produces a phantom slot in the merged
    ``reqTypeOrder``.
    """
    return set(display_order) - set(req_fields)

# Regex used by the audit to catch any field that *looks* like a textline
# requirement but isn't in TEXTLINE_REQ_FIELDS.
_REQ_TEXTLINE_PATTERN = re.compile(r"^Required.*TextLine.*$")

# Regex used by ``audit_textline_section_keys`` to catch any field that
# *looks* like a textline-set container - covers all observed shapes
# (``*TextLineSets`` plural-with-Sets, singular ``TextLineSet``, and
# ``*TextLines`` plural-without-Sets like LootData's ``BoughtTextLines``).
# Requirement-field names also match this pattern; the audit excludes them
# explicitly via ``TEXTLINE_REQ_FIELDS`` / ``TEXTLINE_REQ_FIELDS_COUNT``.
_SECTION_KEY_PATTERN = re.compile(r"^[A-Za-z]\w*TextLines?(?:Sets?)?$")

# Pre-compiled tag stripper for dialogue text.
_FORMAT_TAG_RE = re.compile(r"\{#\w+\}")


def extract_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    *,
    section_keys,
    default_speaker: str = None,
    game_data_lists: dict = None,
) -> dict:
    """Extract every textline-set section from a single owner table.

    Returns a dict shaped like::

        {
            "InteractTextLineSets": {
                "LineName01": {...},
                ...
            },
            "GiftTextLineSets": {...},
            ...
        }

    ``section_keys`` is the per-game allowlist of owner-level section names
    (e.g. ``HADES1_TEXTLINE_SECTION_KEYS``). Hardcoding the allowed keys
    per game - rather than matching by suffix - ensures we never silently
    pick up an unexpected field or silently miss a renamed/new container.
    Use ``audit_textline_section_keys`` to surface unrecognized
    section-shaped keys in newly-added source files.

    `default_speaker` overrides the per-line fallback (which is otherwise the
    owner name). Sources where the owner key is not itself a meaningful
    speaker (e.g. LootData's `ZeusUpgrade`) should pass the canonical
    speaker id (`NPC_Zeus_01`).

    `game_data_lists`, when provided, is a ``{"GameData.X": [textline names]}``
    map used to expand bare-identifier references in requirement fields (see
    ``src/extractors/text_line_sets.py``).
    """
    sections = {}
    fallback_speaker = default_speaker or owner_name
    for key, value in owner_table.items():
        if key not in section_keys:
            continue
        if not isinstance(value, LuaTable):
            continue
        section = {}
        for tl_name, tl_table in value.items():
            if not isinstance(tl_table, LuaTable):
                continue
            section[tl_name] = extract_textline(
                tl_name, tl_table, fallback_speaker, source_file,
                game_data_lists=game_data_lists,
            )
            # In-game, picking a dialogue choice records a flag named
            # `<ParentTextline><ChoiceText>`. Those names are then referenced
            # by other textlines' requirements. We surface each choice as a
            # synthetic sibling textline so the graph resolves cleanly.
            for syn_name, syn_data in _extract_choice_variants(
                tl_name, tl_table, fallback_speaker, source_file,
                game_data_lists=game_data_lists,
            ).items():
                _merge_synthetic(section, syn_name, syn_data)
        sections[key] = section
    return sections


def extract_textline(
    tl_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
) -> dict:
    """Extract requirements + dialogue lines from a single textline table."""
    data = {
        "requirements": {},
        "otherRequirements": {},
        "dialogueLines": [],
        "sourceFile": source_file,
        "sourceLine": tl_table.line,
    }

    for key, value in tl_table.items():
        if key in TEXTLINE_REQ_FIELDS:
            sources: list = []
            data["requirements"][key] = _to_string_list(value, game_data_lists, sources_out=sources)
            if any(s is not None for s in sources):
                data.setdefault("requirementSources", {})[key] = sources
        elif key in TEXTLINE_REQ_FIELDS_COUNT:
            inner = value.get("TextLines") if isinstance(value, LuaTable) else None
            if inner is not None:
                sources = []
                data["requirements"][key] = _to_string_list(inner, game_data_lists, sources_out=sources)
                if any(s is not None for s in sources):
                    data.setdefault("requirementSources", {})[key] = sources
            if isinstance(value, LuaTable):
                meta = {
                    k: _normalize_value(v, game_data_lists)
                    for k, v in value.items()
                    if k != "TextLines"
                }
                if meta:
                    data["otherRequirements"][key] = meta
        elif key.startswith(NON_DIALOGUE_REQ_PREFIX):
            data["otherRequirements"][key] = _normalize_value(value, game_data_lists)

    for entry in tl_table.array:
        if not isinstance(entry, LuaTable):
            continue
        text = entry.get("Text")
        if not isinstance(text, str):
            continue
        text = _FORMAT_TAG_RE.sub("", text)
        speaker = entry.get("Speaker")
        if isinstance(speaker, str):
            data["dialogueLines"].append({"speaker": speaker, "text": text})
        else:
            data["dialogueLines"].append({"speaker": fallback_speaker, "text": text})

    return data


def _extract_choice_variants(
    parent_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
) -> dict:
    """Find every ``Choices = {...}`` array nested in the parent's cues and
    materialise each choice as a synthetic child textline.

    Synthetic name is ``<parent_name><ChoiceText>`` (no separator) to match
    the in-game flag the engine records when the player picks that choice.

    Each synthetic textline:
      - reuses ``extract_textline`` on the choice item so any explicit
        requirement fields declared on the choice are preserved
      - gets an *implicit* ``RequiredTextLines: [parent_name]`` dependency
        prepended so the dependency graph is correct
      - carries ``parentTextline`` + ``choiceText`` metadata for the viewer
      - is flagged ``isSynthetic = True`` so collision resolution can
        prefer a real definition when one exists
    """
    variants = {}
    for cue in tl_table.array:
        if not isinstance(cue, LuaTable):
            continue
        choices = cue.get("Choices")
        if not isinstance(choices, LuaTable):
            continue
        for choice_item in choices.array:
            if not isinstance(choice_item, LuaTable):
                continue
            choice_text = choice_item.get("ChoiceText")
            if not isinstance(choice_text, str) or not choice_text:
                continue
            synthetic_name = parent_name + choice_text
            child = extract_textline(
                synthetic_name, choice_item, fallback_speaker, source_file,
                game_data_lists=game_data_lists,
            )
            # Implicit parent dependency so the choice variant is reachable
            # in the graph only via the parent textline.
            existing = child["requirements"].setdefault("RequiredTextLines", [])
            if parent_name not in existing:
                existing.insert(0, parent_name)
                # Keep requirementSources aligned 1:1 if present for this key.
                sources = child.get("requirementSources", {}).get("RequiredTextLines")
                if sources is not None:
                    sources.insert(0, None)
            child["parentTextline"] = parent_name
            child["choiceText"] = choice_text
            child["isSynthetic"] = True
            variants[synthetic_name] = child
    return variants


def _merge_synthetic(section: dict, name: str, data: dict) -> None:
    """Add a synthetic textline to a section, deferring to any real
    definition (synthetic loses) and to the first synthetic when two
    synthetics collide (first-wins, deterministic on source order).
    """
    existing = section.get(name)
    if existing is None:
        section[name] = data
        return
    if not existing.get("isSynthetic"):
        # Real textline already present - keep it, drop the synthetic.
        return
    # Both synthetic: first-wins. (Same parent/choice in the same section
    # would be a source-data quirk; we don't expect it in practice.)
    return


def _walk_lua_tree(root):
    """Yield every ``(key, value)`` pair from every ``LuaTable`` nested
    under ``root``.

    Accepts either a parsed-file ``dict`` (mapping top-level Lua names
    to values) or a raw ``LuaTable``; the former is transparently
    unwrapped so audits can take the parser output directly. Recursion
    descends through both named entries and the array part so any
    ``LuaTable`` reachable from the root has its keys surfaced
    regardless of position.

    Iteration order is DFS but unordered between siblings (a stack-based
    walker, so iteration order is reverse of declaration order). Audits
    collect into a ``set`` so ordering does not matter; if a future
    caller needs deterministic order it should sort the result.
    """
    stack: list = []
    if isinstance(root, dict):
        stack.extend(root.values())
    else:
        stack.append(root)
    while stack:
        node = stack.pop()
        if not isinstance(node, LuaTable):
            continue
        for k, v in node.items():
            yield k, v
            stack.append(v)
        for v in node.array:
            stack.append(v)


def audit_requirement_fields(parsed_root) -> set:
    """Walk a parsed Lua tree and return any field names matching
    Required.*TextLine.* that are NOT in our known TEXTLINE_REQ_FIELDS sets.

    Used by the pipeline to surface silently-dropped dependency edges as new
    source files are added. Fields in REQ_TEXTLINE_FIELD_IGNORES are skipped
    (they look like requirements but aren't - typically game-data typos).
    """
    known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT | REQ_TEXTLINE_FIELD_IGNORES
    return {
        k for k, _ in _walk_lua_tree(parsed_root)
        if isinstance(k, str)
        and _REQ_TEXTLINE_PATTERN.match(k)
        and k not in known
    }


def audit_textline_section_keys(parsed_root, section_keys) -> set:
    """Walk a parsed Lua tree and return any owner-level keys that *look*
    like textline-set containers (match ``*TextLineSets`` / ``TextLineSet`` /
    ``*TextLines``) but aren't in the per-game ``section_keys`` allowlist
    and aren't already known requirement-field names.

    Used by the pipeline to catch newly-added or renamed container keys in
    a future game update before the parser silently drops them. Mirrors
    ``audit_requirement_fields`` but for the section side of the schema.
    """
    req_known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT | REQ_TEXTLINE_FIELD_IGNORES
    section_known = set(section_keys)
    return {
        k for k, v in _walk_lua_tree(parsed_root)
        if isinstance(k, str)
        and _SECTION_KEY_PATTERN.match(k)
        and isinstance(v, LuaTable)
        and any(isinstance(nv, LuaTable) for nv in v.named.values())
        and k not in section_known
        and k not in req_known
    }


def observed_section_keys(parsed_root, section_keys) -> set:
    """Return the subset of ``section_keys`` (allowlist) that actually
    appears as an owner-level section-shaped key in ``parsed_root``.

    Per-source observation: most allowlist entries appear in only one
    or two source files, so individual-file results are noisy. Callers
    union this across all parsed sources and pass the result to
    :func:`audit_section_keys_stale` to identify allowlist entries that
    were never observed in any source (typically left behind by a
    field rename or a renamed extractor target).

    The structural shape filter (named-table value of section-shaped
    key) mirrors :func:`audit_textline_section_keys` so the two
    helpers report consistent observations - any key one finds the
    other can be reasoned about against.
    """
    section_known = set(section_keys)
    return {
        k for k, v in _walk_lua_tree(parsed_root)
        if isinstance(k, str)
        and k in section_known
        and isinstance(v, LuaTable)
        and any(isinstance(nv, LuaTable) for nv in v.named.values())
    }


def audit_section_keys_stale(observed, section_keys) -> set:
    """Return the subset of ``section_keys`` not present in
    ``observed`` (the union of :func:`observed_section_keys` across
    every parsed source).

    Reverse direction of :func:`audit_textline_section_keys`: that
    catches unknown keys appearing in sources; this catches allowlisted
    keys that never appear in any source (typically the leftover of a
    rename or a removed extractor target). Surfacing both directions
    keeps the per-game allowlist tight as the game data evolves.
    """
    return set(section_keys) - set(observed)


def _to_string_list(value, game_data_lists: dict = None, sources_out: list = None) -> list:
    """Convert a value to a list of strings (for requirement fields).

    Expands ``LuaIdentifier`` references that name a known GameData list
    (e.g. ``GameData.AphroditeBasicPickUpTextLines``) into the underlying
    textline names. Unknown identifiers are kept as their bare ``.name``
    so the unresolved-ref audit still surfaces them (cleanly - not as a
    ``LuaIdentifier(name='...')`` repr).

    If ``sources_out`` is provided (a list), it is populated 1:1 with the
    returned name list: each position holds either the GameData group name
    that name came from (e.g. ``"GameData.AphroditeBasicPickUpTextLines"``)
    or ``None`` if the entry was a bare string / unknown identifier. This
    preserves positional provenance so the viewer can group expanded
    entries even when names overlap or duplicate across groups.
    """
    track = sources_out is not None

    def emit_str(s: str):
        result.append(s)
        if track:
            sources_out.append(None)

    def emit_identifier(ident: LuaIdentifier):
        if game_data_lists and ident.name in game_data_lists:
            names = list(game_data_lists[ident.name])
            result.extend(names)
            if track:
                sources_out.extend([ident.name] * len(names))
        else:
            result.append(ident.name)
            if track:
                sources_out.append(None)

    if isinstance(value, str):
        if track:
            sources_out.append(None)
        return [value]
    if isinstance(value, LuaIdentifier):
        if game_data_lists and value.name in game_data_lists:
            names = list(game_data_lists[value.name])
            if track:
                sources_out.extend([value.name] * len(names))
            return names
        if track:
            sources_out.append(None)
        return [value.name]
    if isinstance(value, LuaTable):
        result: list = []
        for v in value.named.values():
            if isinstance(v, str):
                emit_str(v)
            elif isinstance(v, LuaIdentifier):
                emit_identifier(v)
        for v in value.array:
            if isinstance(v, str):
                emit_str(v)
            elif isinstance(v, LuaIdentifier):
                emit_identifier(v)
        return result
    if isinstance(value, list):
        out = [str(v) for v in value]
        if track:
            sources_out.extend([None] * len(out))
        return out
    if track:
        sources_out.append(None)
    return [str(value)]


def _normalize_value(value, game_data_lists: dict = None):
    """Normalize a Lua value for storage in otherRequirements.

    GameData identifiers known to resolve to textline lists are expanded
    here too, so e.g. a non-textline-typed otherRequirement that happens
    to reference one shows the contents instead of the bare name.

    Mixed-shape tables (Lua tables populating BOTH the array part and the
    named part) are intentionally rejected with a hard error. No
    requirement field across the four H1 sources currently uses this
    idiom, and silently flattening to just the named half - which is
    what an earlier version did - would drop array entries without any
    warning. If/when an H2 (or future H1) field needs this shape, choose
    a JSON-friendly representation here explicitly rather than letting
    data vanish through the pipeline.
    """
    if isinstance(value, (str, int, float, bool)):
        return value
    if value is None:
        return None
    if isinstance(value, LuaTable):
        if value.array and value.named:
            raise ValueError(
                "_normalize_value: encountered a mixed-shape LuaTable with "
                f"both array ({len(value.array)} entries) and named "
                f"({len(value.named)} entries) parts populated. This shape "
                "is not currently handled by the pipeline because no "
                "requirement field exercises it; add an explicit "
                "representation here if a new game/field needs it. "
                f"Named keys: {sorted(value.named.keys())}; "
                f"table source line: {value.line}."
            )
        if value.array:
            return [_normalize_value(v, game_data_lists) for v in value.array]
        # Pure-named (or both empty -> {}). Iterating .items() on an
        # empty LuaTable yields nothing, matching the previous behaviour.
        return {k: _normalize_value(v, game_data_lists) for k, v in value.items()}
    if isinstance(value, LuaIdentifier):
        if game_data_lists and value.name in game_data_lists:
            return list(game_data_lists[value.name])
        return value.name
    if isinstance(value, LuaExpression):
        return value.raw
    return str(value)
