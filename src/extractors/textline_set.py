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

# Per-game label maps (req-type labels, edge labels, display order)
# live next to each game's section-key allowlist (e.g.
# ``hades1/req_types.py``). H2's requirement vocabulary is disjoint from
# H1's, so a per-game seam in ``src.label_maps.annotate_label_maps`` merges
# them rather than shipping a single global map from this module.


# Pre-compiled tag stripper for dialogue text.
_FORMAT_TAG_RE = re.compile(r"\{#\w+\}")


def _apply_force_play_once(sections: dict, force_play_once: bool) -> None:
    """Mark every textline in ``sections`` ``playOnce`` when
    ``force_play_once`` is set. Used for inspect-point narration, which
    is consumed once in-game even though the source tables omit the
    ``PlayOnce`` field. No-op when the flag is False.
    """
    if not force_play_once:
        return
    for section in sections.values():
        for tl in section.values():
            tl["playOnce"] = True


def extract_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    *,
    section_keys,
    default_speaker: str = None,
    game_data_lists: dict = None,
    section_priority_tiers: dict = None,
    cue_speaker_resolver=None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    force_play_once: bool = False,
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

    `default_speaker` overrides the per-line fallback (which is otherwise the
    owner name). Sources where the owner key is not itself a meaningful
    speaker (e.g. LootData's `ZeusUpgrade`) should pass the canonical
    speaker id (`NPC_Zeus_01`).

    `game_data_lists`, when provided, is a ``{"GameData.X": [textline names]}``
    map used to expand bare-identifier references in requirement fields (see
    ``src/extractors/text_line_sets.py``).

    `section_priority_tiers`, when provided, is a per-game map of
    ``section_key -> "super" | "priority"`` (e.g.
    ``HADES1_SECTION_KEY_PRIORITY_TIER``). Each extracted textline inside
    a tiered section gets ``narrativePrioritySectionTier`` set, capturing
    the engine's "consult super-tier first" cascade at the call site.

    `cue_speaker_resolver`, when provided, is a callable taking a single
    cue ``LuaTable`` and returning a speaker id (or ``None``). It is
    consulted per-cue when the cue lacks an explicit ``Speaker = ...``
    field; sources where lines from multiple speakers share a single
    textline-set without per-line speakers (e.g. EncounterData / RoomData
    where the speaker has to be derived from the cue path) can use this
    to recover the speaker before the owner-name fallback kicks in.

    `offer_text_map`, when provided, is an ``{Id: DisplayName}`` map
    loaded from ``Game/Text/en/MiscText.en.sjson`` (see
    :func:`src.extractors.hades1.misc_text.load_misc_text`). Cue ``Text``
    values that are exact keys in this map are substituted to the
    mapped flavour text so the viewer shows
    ``"Eurydice offers several delectable treats."`` rather than the raw
    ``"Eurydice_OfferText02"`` identifier. Only exact matches are
    substituted; real voice lines that happen to look identifier-like
    pass through unchanged.

    `preset_choices`, when provided, is a ``{preset_name:
    [ChoiceText id, ...]}`` map (see
    :data:`src.extractors.hades1.preset_choices.HADES1_PRESET_CHOICES`)
    used to resolve boon-vendor cue choice references shaped like
    ``Choices = PresetEventArgs.EurydiceBenefitChoices``. Our Lua
    parser can't follow the reference across the file, so without
    this map those cues would render without their A/B/C choice list.

    `force_play_once`, when True, marks every extracted textline
    ``playOnce`` regardless of the source ``PlayOnce`` field. The
    inspect-point extractors set it: inspect-point narration is consumed
    once in-game even though the tables omit the flag.
    """
    sections = {}
    fallback_speaker = default_speaker or owner_name
    priority_tiers = section_priority_tiers or {}
    for key, value in owner_table.items():
        if key not in section_keys:
            continue
        if not isinstance(value, LuaTable):
            continue
        section = {}
        section_tier = priority_tiers.get(key)
        for tl_name, tl_table in value.items():
            if not isinstance(tl_table, LuaTable):
                continue
            section[tl_name] = extract_textline(
                tl_name, tl_table, fallback_speaker, source_file,
                game_data_lists=game_data_lists,
                cue_speaker_resolver=cue_speaker_resolver,
                offer_text_map=offer_text_map,
                preset_choices=preset_choices,
            )
            if section_tier is not None:
                section[tl_name]["narrativePrioritySectionTier"] = section_tier
            # In-game, picking a dialogue choice records a flag named
            # `<ParentTextline><ChoiceText>`. Those names are then referenced
            # by other textlines' requirements. We surface each choice as a
            # synthetic sibling textline so the graph resolves cleanly.
            for syn_name, syn_data in _extract_choice_variants(
                tl_name, tl_table, fallback_speaker, source_file,
                game_data_lists=game_data_lists,
                cue_speaker_resolver=cue_speaker_resolver,
                offer_text_map=offer_text_map,
                preset_choices=preset_choices,
            ).items():
                if section_tier is not None:
                    syn_data["narrativePrioritySectionTier"] = section_tier
                _merge_synthetic(section, syn_name, syn_data)
        sections[key] = section
    _apply_force_play_once(sections, force_play_once)
    return sections


def extract_textline(
    tl_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
    cue_speaker_resolver=None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
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

    # Set-level narrative priority. SuperPriority wins if both are set
    # (matches engine ordering in `PlayRandomRemainingTextLines`).
    set_level_priority = None
    if tl_table.get("SuperPriority") is True:
        set_level_priority = "super"
    elif tl_table.get("Priority") is True:
        set_level_priority = "priority"
    if set_level_priority is not None:
        data["narrativePrioritySetLevel"] = set_level_priority

    # Play-once flag at the textline-set level. `PlayOnce = true` means
    # the dialogue can only ever play a single time per save - a hard
    # cap that's important to surface because it affects whether a
    # textline is still "available" for the player.
    # (The variants `PlayOnceThisRun` / `PlayOnceFromTableThisRun` only
    # appear on individual voice quips inside the cue array, not on the
    # textline-set table, so they're not surfaced here.)
    if tl_table.get("PlayOnce") is True:
        data["playOnce"] = True

    # `Partner = "NPC_<other>_01"` on the full entry of an `xWithY`
    # partner dialogue names the second NPC involved. The same dialogue
    # is also queued under that partner NPC's textline-set as an empty
    # `Skip = true` stub; the partner-side stub does not declare
    # `Partner` itself. Capturing this lets the viewer surface the
    # dialogue under both NPCs even though the canonical owner remains
    # the side that holds the cues.
    partner_value = tl_table.get("Partner")
    if isinstance(partner_value, str) and partner_value:
        data["partner"] = partner_value

    for entry in tl_table.array:
        if not isinstance(entry, LuaTable):
            continue
        text = entry.get("Text")
        if not isinstance(text, str):
            continue
        # Resolve MiscText.en.sjson Ids (e.g. ``Eurydice_OfferText02``)
        # to their flavour text before tag stripping. Substituted values
        # are already tag-stripped at load time, so the strip below is a
        # no-op for them; bare voice lines still get stripped normally.
        if offer_text_map is not None:
            text = offer_text_map.get(text, text)
        text = _FORMAT_TAG_RE.sub("", text)
        speaker = entry.get("Speaker")
        if isinstance(speaker, str):
            line: dict = {"speaker": speaker, "text": text}
        else:
            derived = cue_speaker_resolver(entry) if cue_speaker_resolver is not None else None
            line = {"speaker": derived or fallback_speaker, "text": text}
        # Choice-prompt cue: when a cue declares a ``Choices = {...}``
        # table (or a ``Choices = PresetEventArgs.<Name>`` reference to
        # a vendored preset) the prompt isn't just narration, it's the
        # runtime branch point. Attach the option metadata so the viewer
        # can render it as a structured choice block rather than a
        # single dialogue line. Inline-choice synthetic naming is
        # ``<parent_name><ChoiceText>`` (mirrors
        # :func:`_extract_choice_variants`); preset-referenced boon
        # choices have no follow-up textline (``targetTextline = None``)
        # because the engine immediately calls the choice's
        # ``PostLineFunctionName`` to grant the benefit.
        choices = _collect_cue_choices(entry, tl_name, preset_choices)
        if choices is not None:
            line["kind"] = "choicePrompt"
            line["choices"] = choices
        data["dialogueLines"].append(line)

    return data


def _collect_cue_choices(cue: LuaTable, parent_name: str, preset_choices: dict = None):
    """Return the list of ``{internal, targetTextline}`` choice entries
    declared on a single cue, or ``None`` when the cue has no
    ``Choices`` field (or the field is an unresolvable reference).

    Two ``Choices`` shapes are recognised:

    * Inline ``Choices = {...}`` table - each ``ChoiceText`` becomes a
      navigable option whose ``targetTextline`` is the synthetic
      textline name :func:`_extract_choice_variants` produces
      (``<parent><ChoiceText>``). The viewer wraps these in
      click-through links.
    * Preset reference ``Choices = PresetEventArgs.<Name>`` - looks
      ``<Name>`` up in ``preset_choices`` (typically
      :data:`HADES1_PRESET_CHOICES`). Each entry becomes a
      non-navigable option (``targetTextline = None``) because the
      engine calls the boon-vendor function directly instead of
      branching into another textline. Returns ``None`` if the
      preset isn't in the map - that's the same visible failure mode
      as an unrecognised ``Text =`` reference: the cue renders as a
      plain dialogue line. Preset entries may be bare ``str`` ids
      (unconditional) or ``dict`` records carrying extra metadata
      (e.g. ``requiredMetaUpgrade``); any non-``id`` keys are passed
      through verbatim to the emitted choice dict so the viewer can
      group and annotate gated options without server-side semantics.

    Choices missing a string ``ChoiceText`` are silently skipped; an
    all-empty list still flags the prompt as a ``choicePrompt`` so the
    viewer can render its structural role even if no usable options
    are declared.
    """
    choices_field = cue.get("Choices")
    # Inline table: extract per-choice ChoiceText + computed synthetic target.
    if isinstance(choices_field, LuaTable):
        out: list = []
        for choice_item in choices_field.array:
            if not isinstance(choice_item, LuaTable):
                continue
            choice_text = choice_item.get("ChoiceText")
            if not isinstance(choice_text, str) or not choice_text:
                continue
            out.append({
                "internal": choice_text,
                "targetTextline": parent_name + choice_text,
            })
        return out
    # Preset reference: look up the vendored choice list. Only the
    # ``PresetEventArgs.<Name>`` namespace is supported - other Lua
    # identifier references aren't preset choice tables.
    if isinstance(choices_field, LuaIdentifier) and preset_choices is not None:
        prefix = "PresetEventArgs."
        if not choices_field.name.startswith(prefix):
            return None
        preset_name = choices_field.name[len(prefix):]
        preset = preset_choices.get(preset_name)
        if preset is None:
            return None
        # Preset entries are either bare ``str`` ids (unconditional
        # option) or ``dict`` records with ``id`` + optional metadata
        # fields like ``requiredMetaUpgrade``. Surface any non-id keys
        # verbatim on the emitted choice so the viewer can render
        # gated options with extra context (grouped letters, tooltip
        # annotations) without the extractor needing to know the
        # semantics. Skip malformed entries silently.
        out: list = []
        for entry in preset:
            if isinstance(entry, str) and entry:
                out.append({"internal": entry, "targetTextline": None})
                continue
            if isinstance(entry, dict):
                cid = entry.get("id")
                if not isinstance(cid, str) or not cid:
                    continue
                choice: dict = {"internal": cid, "targetTextline": None}
                for key, value in entry.items():
                    if key == "id":
                        continue
                    choice[key] = value
                out.append(choice)
        return out
    return None


def _extract_choice_variants(
    parent_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
    cue_speaker_resolver=None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
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

    Preset-referenced ``Choices = PresetEventArgs.X`` cues (boon
    vendors) deliberately do NOT produce synthetic variants - the engine
    branches into a function call rather than another textline, so
    there's no flag to materialise. ``preset_choices`` is accepted for
    signature symmetry with :func:`extract_textline` but unused here.
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
                cue_speaker_resolver=cue_speaker_resolver,
                offer_text_map=offer_text_map,
                preset_choices=preset_choices,
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


def _is_requirement_field(key) -> bool:
    """True if ``key`` names a requirement field on a textline / ancestor
    block (textline-typed, count-based, or any other ``Require*`` field).

    ``GameStateRequirements`` is intentionally excluded - it's the wrapper
    sub-table that owns these fields, not a requirement itself.
    """
    if not isinstance(key, str):
        return False
    if key == "GameStateRequirements":
        return False
    if key in TEXTLINE_REQ_FIELDS or key in TEXTLINE_REQ_FIELDS_COUNT:
        return True
    return key.startswith(NON_DIALOGUE_REQ_PREFIX)


def collect_local_requirements(node: LuaTable) -> LuaTable | None:
    """Return a synthesised ``LuaTable`` of every requirement field gating
    textline-sets defined directly on ``node``.

    Two source-data patterns are unified here:

    * Wrapped form (``EncounterData`` / ``RoomData`` family): all gating
      fields live under an explicit ``GameStateRequirements = { ... }``
      sub-table on the container.
    * Sibling form (most ``DeathLoopData`` inspect points): the same
      ``Required*`` / count-based / ``Require*`` fields are direct siblings
      of the textline-set container (``InteractTextLineSets``, etc.) on
      the inspect-point table itself, with no wrapper sub-table.

    Returns the union (sibling-level wins on key collision, since those
    are more directly attached to the textline-set container). Returns
    ``None`` if neither pattern produced any requirements - the walker
    can then keep its inherited ancestor unchanged.
    """
    if not isinstance(node, LuaTable):
        return None

    combined: dict = {}

    gsr = node.get("GameStateRequirements")
    if isinstance(gsr, LuaTable):
        combined.update(gsr.named)

    for key, value in node.items():
        if _is_requirement_field(key):
            combined[key] = value

    if not combined:
        return None

    return LuaTable(named=combined)


def merge_ancestor_requirements(tl: dict, gsr: LuaTable, game_data_lists: dict | None) -> None:
    """Lift fields from an enclosing block's combined requirements onto a
    single extracted textline.

    ``gsr`` is the ``LuaTable`` returned by ``collect_local_requirements``
    on the nearest enclosing block that declared any requirements
    (typically the inspect-point / encounter / room container).

    Textline-typed fields (``TEXTLINE_REQ_FIELDS`` /
    ``TEXTLINE_REQ_FIELDS_COUNT``) land in ``tl["requirements"]`` and feed
    the dependency graph. Other ``Require*`` fields land in
    ``tl["otherRequirements"]`` as informational metadata.

    Per-textline declarations win on key collision: this function only
    fills in keys the textline hasn't set itself.
    """
    for key, value in gsr.items():
        if key in TEXTLINE_REQ_FIELDS:
            if key in tl["requirements"]:
                continue
            sources: list = []
            tl["requirements"][key] = _to_string_list(value, game_data_lists, sources_out=sources)
            if any(s is not None for s in sources):
                tl.setdefault("requirementSources", {})[key] = sources
        elif key in TEXTLINE_REQ_FIELDS_COUNT:
            if key in tl["requirements"]:
                continue
            inner = value.get("TextLines") if isinstance(value, LuaTable) else None
            if inner is not None:
                sources = []
                tl["requirements"][key] = _to_string_list(inner, game_data_lists, sources_out=sources)
                if any(s is not None for s in sources):
                    tl.setdefault("requirementSources", {})[key] = sources
            if isinstance(value, LuaTable):
                meta = {
                    k: _normalize_value(v, game_data_lists)
                    for k, v in value.items()
                    if k != "TextLines"
                }
                if meta and key not in tl["otherRequirements"]:
                    tl["otherRequirements"][key] = meta
        elif key.startswith(NON_DIALOGUE_REQ_PREFIX):
            if key in tl["otherRequirements"]:
                continue
            tl["otherRequirements"][key] = _normalize_value(value, game_data_lists)
