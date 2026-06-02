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
}

# Field names that look like textline requirements but are not. These are
# either typos in the game data (e.g. truncated keys) or unrelated fields
# whose name happens to match the audit pattern.
REQ_TEXTLINE_FIELD_IGNORES = {
    "RequiredTextLinesThis",  # game-data typo, seen once in NPCData.lua
}

NON_DIALOGUE_REQ_PREFIX = "Require"

# Regex used by the audit to catch any field that *looks* like a textline
# requirement but isn't in TEXTLINE_REQ_FIELDS.
_REQ_TEXTLINE_PATTERN = re.compile(r"^Required.*TextLine.*$")

# Pre-compiled tag stripper for dialogue text.
_FORMAT_TAG_RE = re.compile(r"\{#\w+\}")


def extract_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    default_speaker: str = None,
    game_data_lists: dict = None,
) -> dict:
    """Extract every `*TextLineSets` section from a single owner table.

    Returns a dict shaped like::

        {
            "InteractTextLineSets": {
                "LineName01": {...},
                ...
            },
            "GiftTextLineSets": {...},
            ...
        }

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
        if not isinstance(key, str):
            continue
        # `*TextLineSets` (plural) is the common form (a map of named
        # textlines). DeathLoopData also uses bare `TextLineSet` (singular)
        # inside distance/proximity triggers; the inner shape is identical
        # so we treat it as another section type.
        if not (key.endswith("TextLineSets") or key == "TextLineSet"):
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
        # Real textline already present — keep it, drop the synthetic.
        return
    # Both synthetic: first-wins. (Same parent/choice in the same section
    # would be a source-data quirk; we don't expect it in practice.)
    return


def audit_requirement_fields(parsed_root) -> set:
    """Walk a parsed Lua tree and return any field names matching
    Required.*TextLine.* that are NOT in our known TEXTLINE_REQ_FIELDS sets.

    Used by the pipeline to surface silently-dropped dependency edges as new
    source files are added. Fields in REQ_TEXTLINE_FIELD_IGNORES are skipped
    (they look like requirements but aren't - typically game-data typos).
    """
    unknown = set()
    known = TEXTLINE_REQ_FIELDS | TEXTLINE_REQ_FIELDS_COUNT | REQ_TEXTLINE_FIELD_IGNORES

    def visit(node):
        if isinstance(node, LuaTable):
            for k, v in node.items():
                if isinstance(k, str) and _REQ_TEXTLINE_PATTERN.match(k):
                    if k not in known:
                        unknown.add(k)
                visit(v)
            for v in node.array:
                visit(v)

    if isinstance(parsed_root, dict):
        for v in parsed_root.values():
            visit(v)
    else:
        visit(parsed_root)
    return unknown


def _to_string_list(value, game_data_lists: dict = None, sources_out: list = None) -> list:
    """Convert a value to a list of strings (for requirement fields).

    Expands ``LuaIdentifier`` references that name a known GameData list
    (e.g. ``GameData.AphroditeBasicPickUpTextLines``) into the underlying
    textline names. Unknown identifiers are kept as their bare ``.name``
    so the unresolved-ref audit still surfaces them (cleanly — not as a
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
    """
    if isinstance(value, (str, int, float, bool)):
        return value
    if value is None:
        return None
    if isinstance(value, LuaTable):
        if value.array and not value.named:
            return [_normalize_value(v, game_data_lists) for v in value.array]
        if value.named and not value.array:
            return {k: _normalize_value(v, game_data_lists) for k, v in value.items()}
        return {k: _normalize_value(v, game_data_lists) for k, v in value.items()}
    if isinstance(value, LuaIdentifier):
        if game_data_lists and value.name in game_data_lists:
            return list(game_data_lists[value.name])
        return value.name
    if isinstance(value, LuaExpression):
        return value.raw
    return str(value)
