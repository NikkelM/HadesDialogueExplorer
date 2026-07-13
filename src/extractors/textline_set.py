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

# "Require*"-prefixed keys that are NOT dialogue-eligibility gates and must
# never be surfaced as ``otherRequirements``:
#   - ``RequiredMinElapsedTime`` - an EndCue timing parameter (minimum seconds
#     the line must have played before its ``EndCue`` fires), sitting alongside
#     ``EndCue`` / ``EndWait``.
#   - ``RequiresLinked`` - a room-selection field (read off ``nextRoomData`` in
#     IsRoomForced, RunManager.lua:696); it gates whether a *room* appears, not
#     whether a dialogue is eligible. It leaks onto textlines only because the
#     room table that owns the dialogue also carries this room-level field.
# Neither gates whether the dialogue is eligible to play, so both are excluded.
NON_ELIGIBILITY_REQ_FIELDS = frozenset({"RequiredMinElapsedTime", "RequiresLinked"})

# Hades 1 engine eligibility fields that do NOT use the ``Require*`` naming the
# flat extraction loop keys off, so they slip past it and (historically) dropped
# silently. Sourced from ``IsGameStateEligible`` (RunManager.lua) - every gate it
# reads as ``requirements.<X>`` where ``<X>`` neither starts with ``Require`` nor
# is one of the already-handled ``*RunsSinceAnyTextLines`` count fields. Flags /
# play-chance keys consumed elsewhere (``Force``, ``Skip``, ``ChanceToPlay``) are
# excluded - they are not eligibility gates. The unrecognised-key audit below
# uses this to flag a genuine dropped gate (e.g. ``ConsecutiveClearsOfRoom`` on
# the Fury win-streak lines) without drowning in H1's many presentation fields
# (``TeleportToId``, ``StatusAnimation``, ...), which are not eligibility.
HADES1_NON_PREFIX_ELIGIBILITY_FIELDS = frozenset({
    "AllQuestsWithStatus", "AnyAffordableGhostAdminItem", "AnyQuestWithStatus",
    "AreAnyIdsAlive", "AreIdsAlive", "AreIdsNotAlive",
    "AssistUpgradeLevel",
    "ConsecutiveClearsOfRoom", "ConsecutiveDeathsInRoom",
    "CurrentEncounterValueFalse", "CurrentEncounterValueTrue",
    "CurrentRoomValueFalse", "CurrentRoomValueTrue",
    "CurrentRunValueFalse", "CurrentRunValueTrue",
    "EliteShrineUpgradeMinBiomeDepth",
    "HasAnyTraitNamesInRoom", "HasTraitNameInRoom",
    "IsElite", "IsIdAlive",
    "MaxRunsSinceSquelchedHermes", "MinRunsSinceSquelchedHermes",
    "MaxThanatosSpawnsThisRun", "MaxUnitsByType",
    "MinRequiredLootPickups", "MinRequiredRunLootPickups",
    "NotMaxLastStands",
    "ObjectiveCompletedLastOffer", "ObjectiveFailedLastOffer",
    "ObjectivesCompleted", "ObjectivesFailed",
    "PlayerMaxHealthFraction",
    "ReachedShrineSoftCapWithAllWeapons", "ReachedShrineSoftCapWithAnyWeaponName",
    "ReachedShrineSoftCapWithWeaponName",
    "ValuableUpgradeInRoom",
})

# Hades 1 game constants the requirement data references by name: the engine
# stores e.g. ``MinRunsSinceSquelchedHermes = ConstantsData.SquelchedHermesRunCount``.
# The Lua parser can't resolve a cross-file global, so the value arrives as the
# bare dotted ref; resolve the known ones to their numeric value so the gate's
# threshold is a real number for both display and save evaluation. Sourced from
# the game's ConstantsData definitions (AudioData.lua:1).
HADES1_GAME_CONSTANTS = {
    "ConstantsData.SquelchedHermesRunCount": 5,
}


def _resolve_h1_constants(value):
    """Replace any known ``ConstantsData.*`` ref (see HADES1_GAME_CONSTANTS) with
    its numeric value, recursing into dict / list values. Other values pass
    through unchanged."""
    if isinstance(value, str):
        return HADES1_GAME_CONSTANTS.get(value, value)
    if isinstance(value, dict):
        return {k: _resolve_h1_constants(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_h1_constants(v) for v in value]
    return value


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

# Leading ``/VO/`` scope on a voiceline cue id (e.g. ``/VO/ZagreusHome_2389``).
# Stripped for display, matching how cue ids are shown elsewhere in the tool.
_VO_PREFIX_RE = re.compile(r"^/VO/")

# A cue-only closing-voiceline reference whose subtitle text lives in the dev
# comment on the line above it. Hades 1 records the spoken line as a ``--``
# comment over each ``EndCue = "/VO/<id>"`` and each ``{ Cue = "/VO/<id>", ... }``
# entry that carries no inline ``Text`` (the cue plays as audio). The reference
# may carry trailing fields on the same line (requirements, function hooks), so
# this only anchors on the cue itself; the comment-above requirement is what
# selects the cue-only entries (inline-``Text`` lines never carry a subtitle
# comment and are skipped via the ``Text =`` guard in the scanner).
_END_CUE_REF_RE = re.compile(r'(?:EndCue\s*=|\{\s*Cue\s*=)\s*"(/VO/[^"]+)"')
_LINE_COMMENT_RE = re.compile(r'^\s*--\s?(.*\S)\s*$')


def build_cue_comment_map(source_text: str) -> dict:
    """Recover ``{trimmed_cue_id: subtitle_text}`` from a Lua source file.

    A cue-only closing voiceline (``EndCue`` / a ``{ Cue = ... }`` entry with no
    inline ``Text``) has no subtitle in the parsed data - the engine plays it as
    audio - but Hades 1 records the spoken line in a ``--`` comment on the line
    directly above. We scan the raw source (comments are stripped by the parser)
    so the viewer can show the actual line instead of the cue id. Lines carrying
    an inline ``Text =`` are skipped (their subtitle is the inline text, and the
    comment above such a line is not a subtitle). Format tags are stripped to
    match the inline-``Text`` treatment.
    """
    out = {}
    lines = source_text.splitlines()
    for i in range(1, len(lines)):
        if "Text =" in lines[i] or "Text=" in lines[i]:
            continue
        m = _END_CUE_REF_RE.search(lines[i])
        if not m:
            continue
        cm = _LINE_COMMENT_RE.match(lines[i - 1])
        if not cm:
            continue
        cue = _VO_PREFIX_RE.sub("", m.group(1))
        text = _FORMAT_TAG_RE.sub("", cm.group(1)).strip()
        if text:
            out.setdefault(cue, text)
    return out


# An inline-``Text`` voice cue (Hades 2). Unlike H1's ``--`` comment convention,
# H2 records the spoken line as a ``Text = "..."`` property on the same cue
# table, so a regex over the raw source recovers ``{cue_id: text}`` directly.
# The ``[^}]*?`` between the two allows other cue fields (``PlayFirst`` etc.) but
# stops at the cue table's closing brace so it can't wander into the next entry.
_H2_CUE_TEXT_RE = re.compile(
    r'Cue\s*=\s*"(/VO/[^"]+)"[^}]*?\bText\s*=\s*"((?:[^"\\]|\\.)*)"'
)


def build_h2_cue_text_map(source_text: str) -> dict:
    """Recover ``{trimmed_cue_id: text}`` from an H2 Lua source file's inline
    ``{ Cue = "/VO/<id>", Text = "..." }`` voice cues (the H2 analogue of
    :func:`build_cue_comment_map`). Format tags are stripped to match the
    dialogue-line treatment; the first non-empty text wins per cue id.
    """
    out = {}
    for m in _H2_CUE_TEXT_RE.finditer(source_text):
        cue = _VO_PREFIX_RE.sub("", m.group(1))
        text = _FORMAT_TAG_RE.sub("", m.group(2)).replace("\\n", " ").strip()
        if text and cue not in out:
            out[cue] = text
    return out


def apply_cue_comment_texts(textlines: dict, comment_map: dict) -> None:
    """Fill in the subtitle ``text`` of cue-only closing voicelines from
    ``comment_map`` (built by :func:`build_cue_comment_map`), in place.

    Walks each textline's ``endLines`` and any per-variant ``endLines``; a
    cue-only entry whose cue id has a recovered comment gains a ``text`` field
    (the ``cue`` id is kept for provenance). Entries that already have ``text``
    or whose cue isn't in the map are left untouched.
    """
    if not comment_map:
        return

    def _fill(end_lines):
        for entry in end_lines or []:
            if "text" in entry:
                continue
            text = comment_map.get(entry.get("cue"))
            if text:
                entry["text"] = text

    for tl in textlines.values():
        if not isinstance(tl, dict):
            continue
        _fill(tl.get("endLines"))
        for variant in tl.get("variants") or []:
            if isinstance(variant, dict):
                _fill(variant.get("endLines"))


def drop_textless_end_cues(textlines: dict) -> int:
    """Remove cue-only closing voicelines that carry no subtitle text, in place.

    After :func:`apply_cue_comment_texts` (dev-comment + subtitle-CSV fallback)
    has had every chance to recover a subtitle, an ``endLines`` entry that still
    has a ``cue`` but no ``text`` - and no condition group - is an audio-only
    *sound* cue (e.g. Cerberus's ``CerberusWhineSad`` whimper), not a spoken
    closing line; showing it as a bare cue chip is misleading. Drop such entries.
    When a textline's ``endLines`` becomes empty it is removed entirely, matching
    the convention that textlines with no closing voiceline omit the key. Returns
    the number of entries dropped.
    """
    dropped = 0

    def _keep(entry) -> bool:
        if not isinstance(entry, dict):
            return True
        if entry.get("text"):
            return True
        # A conditional closing group still carries display info without text.
        if entry.get("requirements") or entry.get("otherRequirements") or entry.get("condGroup"):
            return True
        # A pure ``{cue, speaker}`` audio cue has nothing to show.
        return not entry.get("cue")

    def _filter(container):
        nonlocal dropped
        end_lines = container.get("endLines")
        if not end_lines:
            return
        kept = [e for e in end_lines if _keep(e)]
        dropped += len(end_lines) - len(kept)
        if kept:
            container["endLines"] = kept
        else:
            container.pop("endLines", None)

    for tl in textlines.values():
        if not isinstance(tl, dict):
            continue
        _filter(tl)
        for variant in tl.get("variants") or []:
            if isinstance(variant, dict):
                _filter(variant)
    return dropped


# A cue entry is a table carrying an inline ``Cue`` and/or ``Text``.
_NUM_KEY_RE = re.compile(r"^\d+$")


def _is_cue_entry(e) -> bool:
    return isinstance(e, LuaTable) and (
        isinstance(e.get("Cue"), str) or isinstance(e.get("Text"), str))


def _group_speaker(group):
    """Group-level speaker attribution for a voice-line group: the actor a
    nested / positional group's cues are spoken by, declared as a group-level
    ``Speaker`` / ``Source`` / ``ObjectType`` (all canonical speaker ids).
    Returns ``None`` when the group carries no such id (the caller then applies
    its own ``UsePlayerSource`` handling and/or the owner fallback)."""
    if not isinstance(group, LuaTable):
        return None
    for k in ("Speaker", "Source", "ObjectType"):
        v = group.get(k)
        if isinstance(v, str) and v:
            return v
    return None


def iter_top_segments(container):
    """Yield a voice-line container's top-level segments in play order (array
    entries first, then explicit ``[N] =`` numeric-index keys), WITHOUT
    flattening. Unlike :func:`iter_voice_cues`, this preserves each segment as a
    unit so the caller can tell a flat cue from a group (and decide sequential
    vs random-pick handling) and see cross-file identifier references."""
    if not isinstance(container, LuaTable):
        return
    for el in container.array:
        yield el
    for k in sorted(
        (k for k in container.named if isinstance(k, str) and _NUM_KEY_RE.match(k)),
        key=int):
        yield container.named[k]


def iter_voice_cues(container, _depth: int = 0):
    """Yield ``(cue_entry, group)`` for every cue line in a voice-line container,
    flattening the two "voice-line group" shapes the engine allows.

    A container's lines live in its array part and/or under explicit numeric
    index keys (``[1] = {...}, [2] = {...}`` - Lua index assignment, which the
    parser stores as string-keyed ``"1"`` / ``"2"`` named fields, NOT array
    entries). Each element is either a *cue entry* (``{Cue/Text}``) or a *group*
    (timing / ``RandomRemaining`` / speaker params alongside its own nested cue
    entries). Groups are recursed into so their cues surface. ``group`` is the
    nearest enclosing group table (for group-level speaker attribution such as
    ``ObjectType`` / ``UsePlayerSource``), or ``container`` for a top-level cue.

    Flat containers (the common case: cues directly in the array part) yield
    exactly their array cues, so this is a no-op superset of the old
    ``for entry in table.array`` walk.
    """
    if not isinstance(container, LuaTable) or _depth > 8:
        return
    numeric_keys = sorted(
        (k for k in container.named if isinstance(k, str) and _NUM_KEY_RE.match(k)),
        key=int)
    elements = list(container.array) + [container.named[k] for k in numeric_keys]
    for el in elements:
        if _is_cue_entry(el):
            yield el, container
        elif isinstance(el, LuaTable):
            # A group (no inline cue of its own) - recurse so its nested cues
            # surface, attributed to the group itself.
            yield from iter_voice_cues(el, _depth + 1)


def _gsr_records(gsr):
    """The requirement records inside a ``GameStateRequirements`` table (its
    array part). ``[]`` for a missing / non-table gate."""
    return list(gsr.array) if isinstance(gsr, LuaTable) else []


# Path segment marking a per-textline dialogue-choice-outcome lookup: the engine
# records ``TextLinesChoiceRecord[<setName>] = <ChoiceText>`` when the player
# picks an option, and closing-line gates read it back to branch the coda.
_CHOICE_RECORD_KEY = "TextLinesChoiceRecord"


def _choice_target_from_record(rec, parent_name):
    """If ``rec`` is a *pure* single choice-outcome gate on ``parent_name`` -
    ``{Path=[..,"TextLinesChoiceRecord",<parent>], IsAny=[<one ChoiceText>]}``
    with no other keys - return the synthetic choice-child name
    ``<parent><ChoiceText>`` whose branch that coda belongs to; else ``None``.

    Multi-value ``IsAny`` (an OR across choices) and records carrying any extra
    condition fall through to ``None`` so their coda stays a labelled
    conditional on the parent rather than being mis-routed to one branch.
    """
    if not isinstance(rec, LuaTable):
        return None
    if set(rec.named.keys()) != {"Path", "IsAny"}:
        return None
    path = rec.get("Path")
    isany = rec.get("IsAny")
    if not isinstance(path, LuaTable) or not isinstance(isany, LuaTable):
        return None
    parts = [p for p in path.array if isinstance(p, str)]
    if len(parts) < 2 or parts[-2] != _CHOICE_RECORD_KEY or parts[-1] != parent_name:
        return None
    picks = [c for c in isany.array if isinstance(c, str)]
    if len(picks) != 1:
        return None
    return parent_name + picks[0]


def build_end_lines(tl_table, resolve_text, resolve_speaker, end_cue_speaker,
                    *, parent_name=None, extract_group_reqs=None):
    """Build a textline's closing voicelines (the ``endLines`` it plays after
    its main dialogue), honouring per-group ``GameStateRequirements``.

    Captures:
      * ``EndCue`` (H1 only) - a single bare ``/VO/<id>`` cue string (audio-only,
        no subtitle), stored as a trimmed cue id.
      * ``EndVoiceLines`` (both games) - a table whose top-level segments are
        flat cue entries and/or *voice-line groups*. A table-level
        ``GameStateRequirements`` gates every segment; a group may add its own.

    Each closing line is ``{speaker, text}`` (subtitle available) else
    ``{speaker, cue}`` (trimmed ``/VO/`` id). The engine plays *every* eligible
    group, so gated groups are surfaced individually:

      * A group gated *solely* on a dialogue-choice outcome
        (``TextLinesChoiceRecord.<parent> IsAny [<ChoiceText>]``) plays only
        after that choice, so its lines are ROUTED to the choice child
        ``<parent><ChoiceText>`` with the now-implied choice gate dropped (they
        are unconditional within that branch). See ``walk_textline_sections``.
      * A group gated on any other state stays on the parent; each of its lines
        gets a ``condGroup`` id plus the group's extracted ``requirements`` /
        ``otherRequirements`` so the viewer can label it "plays if ...".
      * An ungated group / cue (the overwhelming majority) yields plain
        ``{speaker, text|cue}`` lines, so the ``endLines`` shape is unchanged.

    Returns ``(parent_lines, routed)``; ``routed`` is ``{child_name: [lines]}``
    and is empty unless ``parent_name`` + ``extract_group_reqs`` enable the
    choice / requirement handling. H1 passes neither (and has no
    ``EndVoiceLines`` gates), so it keeps the old flat behaviour with an empty
    ``routed``.

    Callbacks (per game, matching the main-line extraction):
      * ``resolve_text(entry)`` -> subtitle ``str`` or ``None``.
      * ``resolve_speaker(entry, group)`` -> speaker id.
      * ``end_cue_speaker(cue_str)`` -> speaker id for a bare ``EndCue``.
      * ``extract_group_reqs(gsr_tables)`` -> ``{requirements, otherRequirements,
        ...}`` merged across the given ``GameStateRequirements`` tables (the
        per-game requirement extractor; omit to skip requirement surfacing).
    """
    parent_lines = []
    routed = {}
    next_cond = [0]
    # Signature (GameStateRequirements table identities) + id of the last
    # conditional group placed, so consecutive segments sharing one condition -
    # e.g. several flat cues under a single table-level gate (ChronosReveal01) -
    # collapse into one group and render under a single "only when" note rather
    # than repeating it per line. Reset on any ungated / routed segment so a run
    # is always contiguous.
    last_sig = [None]
    last_gid = [None]

    def make_line(entry, group):
        text = resolve_text(entry)
        speaker = resolve_speaker(entry, group)
        cue = entry.get("Cue")
        cue_id = _VO_PREFIX_RE.sub("", cue) if isinstance(cue, str) and cue else None
        if isinstance(text, str) and text:
            # Subtitle present: keep the trimmed cue id too (localisation key)
            # so a closing line can also be swapped to the active language.
            line = {"speaker": speaker, "text": text}
            if cue_id:
                line["cue"] = cue_id
            return line
        if cue_id:
            return {"speaker": speaker, "cue": cue_id}
        return None

    def place(lines, gsr_tables):
        lines = [ln for ln in lines if ln]
        if not lines:
            return
        records = [r for t in gsr_tables for r in _gsr_records(t)]
        if not records:
            parent_lines.extend(lines)
            last_sig[0] = None
            return
        # Pure single choice-outcome gate -> route the coda to the choice child.
        if parent_name is not None and len(records) == 1:
            target = _choice_target_from_record(records[0], parent_name)
            if target is not None:
                routed.setdefault(target, []).extend(lines)
                last_sig[0] = None
                return
        # Any other gate -> a labelled conditional coda kept on the parent.
        # Consecutive segments under the same gate(s) share one group id.
        sig = tuple(id(t) for t in gsr_tables)
        if sig == last_sig[0]:
            gid = last_gid[0]
        else:
            gid = next_cond[0]
            next_cond[0] += 1
            last_sig[0] = sig
            last_gid[0] = gid
        reqs = extract_group_reqs(gsr_tables) if extract_group_reqs else {}
        other = reqs.get("otherRequirements") or {}
        req = reqs.get("requirements") or {}
        for ln in lines:
            ln["condGroup"] = gid
            if other:
                ln["otherRequirements"] = other
            if req:
                ln["requirements"] = req
        parent_lines.extend(lines)

    end_cue = tl_table.get("EndCue")
    if isinstance(end_cue, str) and end_cue:
        parent_lines.append({
            "speaker": end_cue_speaker(end_cue),
            "cue": _VO_PREFIX_RE.sub("", end_cue),
        })

    end_voice = tl_table.get("EndVoiceLines")
    if isinstance(end_voice, LuaTable):
        table_gsr = end_voice.get("GameStateRequirements")
        table_gsr = table_gsr if isinstance(table_gsr, LuaTable) else None
        for seg in iter_top_segments(end_voice):
            if _is_cue_entry(seg):
                place([make_line(seg, end_voice)], [table_gsr] if table_gsr else [])
            elif isinstance(seg, LuaTable):
                group_gsr = seg.get("GameStateRequirements")
                group_gsr = group_gsr if isinstance(group_gsr, LuaTable) else None
                lines = [make_line(c, g) for c, g in iter_voice_cues(seg)]
                place(lines, [t for t in (table_gsr, group_gsr) if t])
    return parent_lines, routed


# --- Section-key audit (see generate_data.py) ------------------------
# Owner-level keys whose name follows the textline-set convention
# (``*TextLines`` / ``*TextLineSet(s)``) but which are NOT in the
# per-game allowlist. Both walkers record any such key that still
# carries real textline data, so the generator can surface a
# silently-dropped section rather than dropping it on the floor - the
# "audits over silent skips" doctrine the README documents. The
# collector is module-level because the walker is called from deep
# inside every per-source extractor; threading an accumulator through
# all of them would be far more invasive than reset-then-read around
# each game's pass (generate_data.py drives this).
_SECTION_KEY_NAME_RE = re.compile(r"(?:TextLineSets?|TextLines)$")
_unlisted_section_keys: dict = {}


def reset_section_key_audit() -> None:
    """Clear the accumulated unlisted-section-key records. Call once
    before each game's extraction pass (and in tests for isolation)."""
    _unlisted_section_keys.clear()


def _note_unlisted_section_key(owner_name, key, value, source_file) -> None:
    """Record ``key`` when it looks like a textline-set section by name
    and carries at least one textline-shaped entry. Called by the
    walkers only for keys already known to be outside the allowlist.

    An empty section-shaped key (e.g. H1 ``EnemyData``'s
    ``BossPresentationNextStageRepeatableTextLineSets``) drops no data,
    so it is ignored - the audit flags genuine loss, not frozen stubs.
    """
    if not isinstance(key, str) or not _SECTION_KEY_NAME_RE.search(key):
        return
    if not isinstance(value, LuaTable):
        return
    if not any(isinstance(v, LuaTable) for v in value.values()):
        return
    _unlisted_section_keys.setdefault((owner_name, key), source_file)


def get_unlisted_section_keys() -> list:
    """Return the recorded unlisted-but-populated section keys as a
    sorted ``[(owner, key, source_file), ...]`` list."""
    return sorted(
        (owner, key, src)
        for (owner, key), src in _unlisted_section_keys.items()
    )


# --- Dropped-eligibility-gate audit ---------------------------------
# The section-key audit above catches a whole dropped *section*; this catches a
# dropped *eligibility field* on a kept textline. ``extract_textline``'s flat
# requirement loop only recognises ``Require*``-prefixed gates (plus the two
# count-field sets), so an engine eligibility field using neither convention -
# H1 has ~35, e.g. ``ConsecutiveClearsOfRoom`` / ``HasTraitNameInRoom`` /
# ``ValuableUpgradeInRoom`` - slips past it and is dropped with no trace. This
# records any :data:`HADES1_NON_PREFIX_ELIGIBILITY_FIELDS` member present on a
# textline but not surfaced, so the gate surfaces as a build warning for triage
# instead of silently vanishing (the "audits over silent skips" doctrine).
_unrecognised_textline_keys: dict = {}


def reset_unrecognised_textline_key_audit() -> None:
    """Clear the accumulated dropped-eligibility-gate records. Call once before
    each game's extraction pass (and in tests for isolation)."""
    _unrecognised_textline_keys.clear()


def _note_unrecognised_textline_keys(tl_name, tl_table, surfaced, source_file) -> None:
    """Record any known engine eligibility field present on ``tl_table`` that the
    extractor failed to surface. ``surfaced`` is the set of keys this textline's
    requirements / otherRequirements already cover."""
    for key in tl_table.named:
        if not isinstance(key, str) or key in surfaced:
            continue
        if key in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS:
            _unrecognised_textline_keys.setdefault((tl_name, key), source_file)


def get_unrecognised_textline_keys() -> list:
    """Return the recorded dropped eligibility gates as a sorted
    ``[(textline, key, source_file), ...]`` list."""
    return sorted(
        (tl_name, key, src)
        for (tl_name, key), src in _unrecognised_textline_keys.items()
    )


def apply_force_play_once(sections: dict, force_play_once: bool) -> None:
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


def is_inspect_point(path) -> bool:
    """True when a DeathLoop / EncounterRoom walker ``path`` resolves its
    owner through the ``InspectPoints`` idmap collapse - i.e. the
    innermost ``("idmap", id, parent_name)`` segment's parent map is
    ``InspectPoints``. Inspect-point narration is consumed once in-game,
    so the walkers pass ``force_play_once`` for these owners even though
    the source tables omit the ``PlayOnce`` flag. Shared by the H1
    deathloop / encounter and H2 encounter walkers, which use the same
    path-segment convention.
    """
    for segment in reversed(path):
        if segment[0] == "idmap":
            return segment[2] == "InspectPoints"
    return False


def walk_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    *,
    section_keys,
    extract_one,
    extract_variants,
    priority_tiers: dict = None,
    force_play_once: bool = False,
    defer_variants: bool = False,
) -> dict:
    """Game-agnostic section-iteration skeleton shared by both games'
    ``extract_textline_sections`` walkers.

    Iterates the owner table's allowlisted section keys, building each
    section from its ``name -> textline_table`` map. The per-game deltas
    are injected as callbacks so the loop structure (and its
    audit/priority/synthetic-merge bookkeeping) lives in one place:

    * ``extract_one(tl_name, tl_table) -> dict`` extracts a single
      textline (each game binds its own ``extract_textline`` with the
      right keyword args - flat req fields for H1, structured
      RequirementSets for H2).
    * ``extract_variants(tl_name, tl_table) -> {syn_name: child}``
      materialises the per-choice synthetic children for a textline
      (binds the per-game ``_extract_choice_variants``).

    ``priority_tiers`` (H1 only) maps a section key to ``"super"`` /
    ``"priority"``; when set, every textline and synthetic in that
    section gets ``narrativePrioritySectionTier`` stamped. ``None`` (H2)
    skips the stamp entirely.

    ``defer_variants`` controls *when* the synthetic choice variants are
    merged into the section, which only affects their relative position
    in the section dict (and hence the downstream ``dependents`` edge
    order - the data is otherwise identical):

    * ``False`` (H1): merge each textline's variants inline, right after
      the textline itself - giving ``real1, syn1, real2, syn2, ...``.
    * ``True`` (H2): extract every real textline first, then merge all
      variants in a second pass - giving ``real1, real2, ..., syn1,
      syn2, ...``.

    The split is preserved because each game's existing output (and the
    deployed viewer's edge ordering) was generated with its own
    structure; de-forking the loop must not reshuffle the shipped data.

    Non-allowlisted owner-level keys are reported to the section-key
    audit before being skipped (see :func:`_note_unlisted_section_key`).
    """
    sections = {}
    tiers = priority_tiers or {}

    def merge_variants(section, tl_name, tl_table, section_tier):
        # In-game, picking a dialogue choice records a flag named
        # `<ParentTextline><ChoiceText>`. Those names are then referenced
        # by other textlines' requirements, so each choice is surfaced as
        # a synthetic sibling textline so the graph resolves cleanly.
        # `_merge_synthetic` keeps any real definition of the same name.
        variants = extract_variants(tl_name, tl_table)
        # Route any choice-gated closing voicelines the parent set aside (see
        # `build_end_lines`) onto the matching choice child: a coda gated solely
        # on `TextLinesChoiceRecord.<parent> IsAny [ChoiceText]` plays only after
        # that choice, so it belongs on `<parent><ChoiceText>`, not the parent.
        # The now-implied choice gate is already dropped. A target with no
        # materialised child (a choice without a follow-up textline) falls back
        # to the parent so the coda is never silently dropped.
        parent = section.get(tl_name)
        routed = parent.pop("_choiceEndLines", None) if isinstance(parent, dict) else None
        if routed:
            for child_name, lines in routed.items():
                child = variants.get(child_name)
                if isinstance(child, dict):
                    child.setdefault("endLines", []).extend(lines)
                elif isinstance(parent, dict):
                    parent.setdefault("endLines", []).extend(lines)
        for syn_name, syn_data in variants.items():
            if section_tier is not None:
                syn_data["narrativePrioritySectionTier"] = section_tier
            _merge_synthetic(section, syn_name, syn_data)

    for key, value in owner_table.items():
        if key not in section_keys:
            _note_unlisted_section_key(owner_name, key, value, source_file)
            continue
        if not isinstance(value, LuaTable):
            continue
        section = {}
        section_tier = tiers.get(key)
        textline_tables = [
            (tl_name, tl_table)
            for tl_name, tl_table in value.items()
            if isinstance(tl_table, LuaTable)
        ]
        for tl_name, tl_table in textline_tables:
            data = extract_one(tl_name, tl_table)
            if section_tier is not None:
                data["narrativePrioritySectionTier"] = section_tier
            section[tl_name] = data
            if not defer_variants:
                merge_variants(section, tl_name, tl_table, section_tier)
        if defer_variants:
            for tl_name, tl_table in textline_tables:
                merge_variants(section, tl_name, tl_table, section_tier)
        sections[key] = section
    apply_force_play_once(sections, force_play_once)
    return sections


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
    end_cue_speaker_resolver=None,
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
    fallback_speaker = default_speaker or owner_name

    def extract_one(tl_name, tl_table):
        return extract_textline(
            tl_name, tl_table, fallback_speaker, source_file,
            game_data_lists=game_data_lists,
            cue_speaker_resolver=cue_speaker_resolver,
            offer_text_map=offer_text_map,
            preset_choices=preset_choices,
            end_cue_speaker_resolver=end_cue_speaker_resolver,
        )

    def extract_variants(tl_name, tl_table):
        return _extract_choice_variants(
            tl_name, tl_table, fallback_speaker, source_file,
            game_data_lists=game_data_lists,
            cue_speaker_resolver=cue_speaker_resolver,
            offer_text_map=offer_text_map,
            preset_choices=preset_choices,
            end_cue_speaker_resolver=end_cue_speaker_resolver,
        )

    return walk_textline_sections(
        owner_name, owner_table, source_file,
        section_keys=section_keys,
        extract_one=extract_one,
        extract_variants=extract_variants,
        priority_tiers=section_priority_tiers,
        force_play_once=force_play_once,
    )


def extract_textline(
    tl_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
    cue_speaker_resolver=None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    end_cue_speaker_resolver=None,
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
        elif key.startswith(NON_DIALOGUE_REQ_PREFIX) and key not in NON_ELIGIBILITY_REQ_FIELDS:
            data["otherRequirements"][key] = _normalize_value(value, game_data_lists)
        elif key in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS:
            # Hades 1 engine eligibility gates that don't use the ``Require*``
            # naming the branch above keys off (``ConsecutiveClearsOfRoom``,
            # ``HasTraitNameInRoom``, ...). Surfaced as otherRequirements so the
            # gate is visible; the H1 save evaluator resolves the ones it can and
            # marks the live-only ones indeterminate. Known ConstantsData refs in
            # the value (e.g. SquelchedHermesRunCount) resolve to their number.
            data["otherRequirements"][key] = _resolve_h1_constants(
                _normalize_value(value, game_data_lists))

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

    # `Skip = true` retires a dialogue revision without deleting it: the
    # engine's eligibility gate (`IsGameStateEligible` in RunManager.lua)
    # short-circuits to ineligible on `Skip` before it even evaluates
    # `Force`, so a skipped line can never play through any normal or
    # debug code path. Supergiant leave the dead version in place so its
    # name stays valid in other lines' Required*TextLines checks and in
    # old saves' TextLinesRecord. We surface the flag so the viewer can
    # mark these lines permanently unplayable rather than showing them as
    # normal dialogue. (Empty `Skip = true` xWithY partner stubs also
    # carry this, but they lose to their cue-bearing canonical side in
    # `resolve_duplicate`, so the flag never reaches the final entry.)
    if tl_table.get("Skip") is True:
        data["skip"] = True

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

    for entry, group in iter_voice_cues(tl_table):
        text = entry.get("Text")
        if not isinstance(text, str):
            continue
        # Resolve MiscText.en.sjson Ids (e.g. ``Eurydice_OfferText02``)
        # to their flavour text before tag stripping. Substituted values
        # are already tag-stripped at load time, so the strip below is a
        # no-op for them; bare voice lines still get stripped normally.
        # The original id is retained as ``textId`` so the viewer can
        # re-localise the line from the per-language MiscText map.
        text_id = None
        if offer_text_map is not None and text in offer_text_map:
            text_id = text
            text = offer_text_map[text]
        text = _FORMAT_TAG_RE.sub("", text)
        # Trimmed cue id (no ``/VO/``) is the localisation key for the
        # per-language dialogue map (sjson ``Id`` == this value).
        cue_val = entry.get("Cue")
        cue_id = _VO_PREFIX_RE.sub("", cue_val) if isinstance(cue_val, str) and cue_val else None
        speaker = entry.get("Speaker")
        if isinstance(speaker, str):
            line: dict = {"speaker": speaker, "text": text}
        else:
            derived = cue_speaker_resolver(entry) if cue_speaker_resolver is not None else None
            if not derived:
                # A voice-line group can attribute its cues via a group-level
                # ObjectType / Speaker / Source (used by ``[N] =`` positional
                # groups); fall back to it before the owner default.
                derived = _group_speaker(group)
            line = {"speaker": derived or fallback_speaker, "text": text}
        if cue_id:
            line["cue"] = cue_id
        if text_id is not None:
            line["textId"] = text_id
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

    # Closing voicelines (EndCue / EndVoiceLines) the textline plays after its
    # main dialogue. These are typically cross-speaker reactions (e.g. a Zagreus
    # quip closing an NPC's dialogue), so the speaker is recovered from the cue
    # id prefix (``end_cue_speaker_resolver``) before the owner fallback - an
    # explicit per-entry ``Speaker`` still wins.
    def _end_text(entry):
        t = entry.get("Text")
        if not isinstance(t, str):
            return None
        if offer_text_map is not None:
            t = offer_text_map.get(t, t)
        return _FORMAT_TAG_RE.sub("", t)

    def _end_speaker(entry, group):
        sp = entry.get("Speaker")
        if isinstance(sp, str):
            return sp
        cue = entry.get("Cue")
        if end_cue_speaker_resolver is not None and isinstance(cue, str):
            resolved = end_cue_speaker_resolver(cue)
            if resolved:
                return resolved
        derived = cue_speaker_resolver(entry) if cue_speaker_resolver is not None else None
        return derived or _group_speaker(group) or fallback_speaker

    def _end_cue_speaker(cue_str):
        if end_cue_speaker_resolver is not None:
            resolved = end_cue_speaker_resolver(cue_str)
            if resolved:
                return resolved
        derived = cue_speaker_resolver({"Cue": cue_str}) if cue_speaker_resolver is not None else None
        return derived or fallback_speaker

    # H1 EndVoiceLines carry no GameStateRequirements (verified across the H1
    # scripts), so ``routed`` is always empty here - the flat behaviour holds.
    end_lines, _ = build_end_lines(tl_table, _end_text, _end_speaker, _end_cue_speaker)
    if end_lines:
        data["endLines"] = end_lines

    # Audit: flag any top-level key the flat requirement loop neither surfaced
    # nor recognised as a known non-requirement field, so a future engine gate
    # that doesn't follow the ``Require*`` naming can't drop silently.
    _note_unrecognised_textline_keys(
        tl_name,
        tl_table,
        set(data["requirements"]) | set(data["otherRequirements"]),
        source_file,
    )

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


def build_synthetic_variants(parent_name: str, tl_table: LuaTable, build_child) -> dict:
    """Game-agnostic cue-choice loop shared by both games'
    ``_extract_choice_variants``.

    Scans every inline ``Choices = {...}`` block nested in
    ``tl_table``'s cues and materialises each option as a synthetic
    child textline keyed ``<parent_name><ChoiceText>`` (no separator -
    matches the engine flag recorded when the player picks the option).
    ``build_child(synthetic_name, choice_item) -> dict`` extracts the
    child (each game binds its own ``extract_textline`` with the right
    keyword args); this helper then:

      - prepends an implicit ``RequiredTextLines: [parent_name]`` so the
        variant is reachable only via its parent (keeping
        ``requirementSources`` aligned 1:1 when present - H1 only);
      - stamps ``parentTextline`` / ``choiceText`` / ``isSynthetic`` so
        the viewer can render it and :func:`_merge_synthetic` can defer
        to a real definition of the same name.

    Preset-referenced ``Choices = PresetEventArgs.X`` cues (H1 boon
    vendors) carry no inline ``ChoiceText`` items and so produce no
    variants - the engine branches into a function call, not another
    textline.
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
            child = build_child(synthetic_name, choice_item)
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


def _extract_choice_variants(
    parent_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    game_data_lists: dict = None,
    cue_speaker_resolver=None,
    offer_text_map: dict = None,
    preset_choices: dict = None,
    end_cue_speaker_resolver=None,
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
    def build_child(synthetic_name, choice_item):
        return extract_textline(
            synthetic_name, choice_item, fallback_speaker, source_file,
            game_data_lists=game_data_lists,
            cue_speaker_resolver=cue_speaker_resolver,
            offer_text_map=offer_text_map,
            preset_choices=preset_choices,
            end_cue_speaker_resolver=end_cue_speaker_resolver,
        )

    return build_synthetic_variants(parent_name, tl_table, build_child)


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

        def emit_member(v):
            if isinstance(v, str):
                emit_str(v)
            elif isinstance(v, LuaIdentifier):
                emit_identifier(v)
            else:
                # Loud-on-surprise, matching _normalize_value's stance:
                # silently skipping would drop a dependency edge without it
                # ever showing up in the unresolved-ref audit. No requirement
                # field across the H1/H2 sources currently nests a
                # LuaExpression / table here; add an explicit representation
                # if a new game/field needs one.
                raise ValueError(
                    "_to_string_list: encountered an unsupported member of "
                    f"type {type(v).__name__} in a requirement-field table. "
                    "Only str and LuaIdentifier members are handled; add "
                    f"explicit support if needed. Value repr: {v!r}."
                )

        for v in value.named.values():
            emit_member(v)
        for v in value.array:
            emit_member(v)
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
    return key.startswith(NON_DIALOGUE_REQ_PREFIX) and key not in NON_ELIGIBILITY_REQ_FIELDS


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
        elif key.startswith(NON_DIALOGUE_REQ_PREFIX) and key not in NON_ELIGIBILITY_REQ_FIELDS:
            if key in tl["otherRequirements"]:
                continue
            tl["otherRequirements"][key] = _normalize_value(value, game_data_lists)
