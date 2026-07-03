"""
H2-specific textline-set walker.

Mirrors the public shape produced by :mod:`src.extractors.textline_set`
(the shared H1 walker) so the downstream graph builder consumes both
games' textline dicts uniformly. The H2 walker is a separate module
because H2's requirement schema is disjoint from H1's:

* H1 textlines carry flat fields like ``RequiredTextLines = { ... }``
  directly on the textline table; the H1 walker pattern-matches the
  known field names and routes them to ``requirements`` or
  ``otherRequirements``.
* H2 textlines wrap their gates in a ``GameStateRequirements`` (and a
  handful of other) RequirementSet value (see
  :data:`src.extractors.hades2.req_extractor.HADES2_REQUIREMENT_SET_FIELDS`);
  every gate is a structured record inside that list. The walker
  delegates the per-record classification to
  :func:`src.extractors.hades2.req_extractor.extract_requirements`,
  which produces an H1-compatible ``requirements`` map (so the graph
  builder needs no per-game seam).

Only the per-textline requirement walk (:func:`extract_textline`) and
cue-speaker resolution are genuinely H2-specific. The game-agnostic
skeleton - the section-iteration loop, the cue-choice / synthetic-variant
loop, ``_collect_cue_choices`` and ``_merge_synthetic`` - is imported from
:mod:`src.extractors.textline_set` and parametrised with the H2
``extract_textline`` so the two games cannot silently drift.

Per-textline output shape (matches H1 for the fields the graph builder
reads)::

    {
        "requirements":      { synthetic_key: [textline_names] },
        "otherRequirements": { synthetic_key: structured_value },
        "orBranches":        [ <sub-result>, ... ],     # H2-only
        "flags":             { skip, force, chanceToPlay },  # H2-only
        "dialogueLines":     [{ "speaker": id, "text": str }, ...],
        "sourceFile":        str,
        "sourceLine":        int,
        "playOnce":          True,                       # only when set
        "partner":           "NPC_X_01",                 # only when set
    }

The ``orBranches`` and ``flags`` keys are H2-specific extras the H1
graph builder ignores; the eventual ``h2-graph-or`` rendering pass will
consume ``orBranches`` to draw OR-alternative boxes.

H2 cue speaker resolution chain (subtitle-label precedence -
documented in the project plan):

    UsePlayerSource = true   -> ``PlayerUnit`` (Melinoe)
    Speaker = "Bare"          -> the literal string from the cue
    Source = "NPC_X_01"       -> the per-cue actor override (resolved
                                 via ``HADES2_SPEAKERS`` in the viewer)
    /VO/<Char>_NNNN cue id    -> deferred (handled by a future
                                 cue_speaker_resolver hook, mirroring
                                 the H1 EncounterRoomData pattern)
    fallback                 -> the owner's resolved id (e.g.
                                 ``NPC_Artemis_01``)

The bare-name ``Speaker = "Artemis"`` form is rare in NPCData files
(~2 occurrences out of 307 cues in NPCData_Artemis.lua) but common in
EnemyData / RoomData. Bare-name to canonical-id mapping is deferred
to a follow-up; for the first H2 cut the literal string flows through
unchanged so it surfaces in the viewer as the raw speaker id.

Format tags ({#Emph}, {#Prev}, {#PrevFormat}, ...) are stripped from
the rendered text using the same regex as H1 (``\\{#\\w+\\}``).
"""

from ...lua_parser import LuaTable
from ..textline_set import (
    build_synthetic_variants,
    walk_textline_sections,
    _collect_cue_choices,
    build_end_lines,
    iter_voice_cues,
    _group_speaker,
    _FORMAT_TAG_RE,
)
from .req_extractor import (
    HADES2_REQUIREMENT_SET_FIELDS,
    extract_requirements,
)


# Speaker id used when a cue carries ``UsePlayerSource = true``. Matches
# the protagonist key in :data:`src.extractors.hades2.speakers.HADES2_SPEAKERS`
# (``"PlayerUnit"`` is the canonical id; ``PlayerUnit_Flashback`` is the
# young-Melinoe flashback variant which must be specified explicitly via
# ``Speaker = "PlayerUnit_Flashback"`` since it isn't the default).
PLAYER_SPEAKER_ID = "PlayerUnit"


def extract_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    *,
    section_keys,
    default_speaker: str = None,
    named_requirements: dict = None,
    force_play_once: bool = False,
) -> dict:
    """Extract every textline-set section from a single H2 owner table.

    Returns a dict shaped like::

        {
            "InteractTextLineSets": {
                "ArtemisHubFirstMeeting01": {...},
                ...
            },
            "GiftTextLineSets": {...},
            ...
        }

    ``section_keys`` is the per-game allowlist of owner-level section
    names (typically
    :data:`src.extractors.hades2.section_keys.HADES2_TEXTLINE_SECTION_KEYS`).
    Sections not in the allowlist are silently skipped so the walker
    never accidentally picks up unrelated owner-level fields (combat
    behaviour data, UI props, etc.).

    ``default_speaker`` overrides the per-line fallback (otherwise the
    owner's id is used). The H1 walker uses this for sources where the
    owner key isn't itself a speaker (e.g. LootData's ``ZeusUpgrade``);
    H2 has analogous cases (``HermesUpgrade`` etc. once the H2 LootData
    extractor lands), so the seam exists from day one.

    ``named_requirements``, when provided, is the registry returned by
    :func:`src.extractors.hades2.named_requirements.extract_named_requirements`.
    Passing it enables inline expansion of ``NamedRequirements`` refs in
    textline gates so the graph picks up the implied textline edges
    (e.g. ``ArtemisOpened`` -> the textlines it depends on transitively).
    Passing ``None`` (or ``{}``) leaves named-requirement refs
    unresolved - they surface as strings under ``otherRequirements``.

    ``force_play_once``, when True, marks every extracted textline
    ``playOnce`` regardless of the source field. The inspect-point
    extractors set it: inspect-point narration is consumed once in-game
    even though the tables omit the flag.
    """
    fallback_speaker = default_speaker or owner_name

    def extract_one(tl_name, tl_table):
        return extract_textline(
            tl_name, tl_table, fallback_speaker, source_file,
            named_requirements=named_requirements,
        )

    def extract_variants(tl_name, tl_table):
        return _extract_choice_variants(
            tl_name, tl_table, fallback_speaker, source_file,
            named_requirements=named_requirements,
        )

    return walk_textline_sections(
        owner_name, owner_table, source_file,
        section_keys=section_keys,
        extract_one=extract_one,
        extract_variants=extract_variants,
        force_play_once=force_play_once,
        defer_variants=True,
    )


def extract_textline(
    tl_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    *,
    named_requirements: dict = None,
) -> dict:
    """Extract requirements + dialogue lines from a single H2 textline table."""
    data = {
        "requirements": {},
        "otherRequirements": {},
        "orBranches": [],
        "flags": {},
        "dialogueLines": [],
        "sourceFile": source_file,
        "sourceLine": tl_table.line,
    }

    # Walk every RequirementSet-bearing field on the textline. In
    # practice ``GameStateRequirements`` is the only one that appears
    # on textlines (the others land on rooms / encounters / cues /
    # contracts), but we use the full allowlist so any future shifts
    # surface automatically without a code change. Each set's outputs
    # are merged in - per-record entries across multiple RequirementSet
    # fields are independently AND-evaluated by the engine, so merging
    # their dialogue edges into one bucket preserves the gate semantics
    # for the graph (which only models conjunctive edges anyway).
    for field in HADES2_REQUIREMENT_SET_FIELDS:
        req_set = tl_table.get(field)
        if not isinstance(req_set, LuaTable):
            continue
        result = extract_requirements(req_set, named_requirements)
        _merge_requirement_result(data, result)

    # Set-level engine flag that hard-caps the textline to one play
    # per save. Surfaced so the viewer can mark "play-once" textlines
    # visually (matches H1).
    if tl_table.get("PlayOnce") is True:
        data["playOnce"] = True

    # ``Partner = "NPC_<other>_01"`` declares the partner side of an
    # xWithY two-speaker dialogue. H2 still uses this field on the
    # canonical side; the partner side ships an empty stub with
    # ``CopyDataFromPartner = true`` instead of H1's ``Skip = true``
    # marker (see the project plan's H2 deltas section).
    partner_value = tl_table.get("Partner")
    if isinstance(partner_value, str) and partner_value:
        data["partner"] = partner_value

    # Speaker for a cue, honouring per-cue attribution first, then the enclosing
    # voice-line group's (a nested / ``[N] =`` group can attribute its cues via a
    # group-level ``UsePlayerSource`` / ``Speaker`` / ``Source`` / ``ObjectType``),
    # then the owner fallback. Shared by the main lines and the closing lines.
    def _cue_speaker(entry, group):
        own = _resolve_cue_speaker(entry, None)  # UsePlayerSource > Speaker > Source, else None
        if own is not None:
            return own
        if isinstance(group, LuaTable) and group.get("UsePlayerSource") is True:
            return PLAYER_SPEAKER_ID
        return _group_speaker(group) or fallback_speaker

    # Cue array -> dialogue lines (with optional choice-prompt attachment).
    # ``iter_voice_cues`` flattens nested / ``[N] =`` positional voice-line
    # groups (e.g. the Bath House / Fishing / Taverna repeatable sets store
    # their lines under numeric index keys), so those no longer render empty.
    for entry, group in iter_voice_cues(tl_table):
        text = entry.get("Text")
        if not isinstance(text, str):
            continue
        text = _FORMAT_TAG_RE.sub("", text)
        speaker = _cue_speaker(entry, group)
        line = {"speaker": speaker, "text": text}
        # Choice-prompt cue: attach the option metadata so the viewer
        # can render the prompt as a structured choice block rather
        # than a single dialogue line. Synthetic target name is
        # ``<parent><ChoiceText>`` (matches the
        # ``TextLinesChoiceRecord`` engine key) so the option's
        # follow-up dialogue is reachable via click-through to the
        # corresponding synthetic child textline produced by
        # :func:`_extract_choice_variants`.
        choices = _collect_cue_choices(entry, tl_name)
        if choices is not None:
            line["kind"] = "choicePrompt"
            line["choices"] = choices
        data["dialogueLines"].append(line)

    # Closing voicelines (EndVoiceLines; H2 has no EndCue). Resolve text +
    # speaker the same way the main lines do (``_cue_speaker`` handles the
    # per-cue / group-level / owner attribution, including a group-level
    # ``UsePlayerSource`` routing through the player's subtitle stream).
    def _end_text(entry):
        t = entry.get("Text")
        if not isinstance(t, str):
            return None
        return _FORMAT_TAG_RE.sub("", t)

    end_lines = build_end_lines(tl_table, _end_text, _cue_speaker, lambda c: fallback_speaker)
    if end_lines:
        data["endLines"] = end_lines

    # Drop empty containers so downstream code's
    # ``data.get("orBranches") or []`` idiom keeps working and merged
    # JSON stays small.
    if not data["orBranches"]:
        del data["orBranches"]
    if not data["flags"]:
        del data["flags"]

    return data


def _resolve_cue_speaker(cue: LuaTable, fallback_speaker: str) -> str:
    """Return the speaker id for a single cue.

    Resolution precedence (matches H2 engine behaviour for the subtitle
    label):

    1. ``UsePlayerSource = true`` -> ``PlayerUnit`` (Melinoe). Wins
       over an explicit ``Speaker = ...`` on the same cue because the
       engine routes the line through the player's subtitle stream
       regardless of what's declared. ``Speaker = "PlayerUnit_Flashback"``
       is the documented way to override this for the young-Melinoe
       variant (the explicit speaker would still be returned here
       because the engine doesn't override it when the speaker is
       explicitly a PlayerUnit variant - but in current data this is
       always paired with ``UsePlayerSource = true`` so the
       precedence simplifies to "UsePlayerSource wins" without losing
       fidelity).
    2. Explicit ``Speaker = "..."`` field. May be a bare name string
       (``"Artemis"``) which will need a bare-name-to-id map in a
       follow-up; for now the literal flows through.
    3. Explicit ``Source = "<NPC_X_01>"`` field. The engine uses this
       to attach the cue to a non-owner actor's entity (commonly a
       second NPC sharing a scene, e.g. Chronos cues inside the Hecate
       boss textline ``HecateBossKidnapped01``). The string value is
       itself a canonical speaker id, so it flows through unchanged
       and the viewer maps it to the friendly name via
       ``HADES2_SPEAKERS``. Sits below ``Speaker`` because the latter
       is a more explicit subtitle-label override; sits above the
       owner fallback because per-cue ``Source`` should beat the
       containing textline's default speaker whenever both are set.
    4. Fallback to the owner's id (passed in by the caller).

    A future hook for cue-id-prefix resolution (``/VO/<Char>_NNNN`` ->
    canonical id) mirroring H1's ``cue_speaker_resolver`` parameter
    will land alongside the H2 RoomData extractor where it's actually
    needed (multi-speaker rooms); NPC files don't need it because the
    owner fallback already covers the unattributed cues.
    """
    if cue.get("UsePlayerSource") is True:
        return PLAYER_SPEAKER_ID
    speaker = cue.get("Speaker")
    if isinstance(speaker, str) and speaker:
        return speaker
    source = cue.get("Source")
    if isinstance(source, str) and source:
        return source
    return fallback_speaker


def _merge_requirement_result(data: dict, result: dict) -> None:
    """Merge one ``extract_requirements`` output into the textline data dict.

    Multiple RequirementSet-bearing fields on a single textline (rare
    but possible) and the per-record entries inside each set are all
    AND-evaluated by the engine, so dialogue edges get unioned into
    one bucket per synthetic key (de-duplicating while preserving
    insertion order) and other-requirement entries are appended to a
    per-key list (mirroring :mod:`.req_extractor`'s same-key handling).
    OR branches accumulate verbatim; flags are last-write-wins (the
    only sensible merge for booleans / a single probability number,
    and the only way multiple sets can produce flags is the
    pathological case where two RequirementSet fields both set
    ``Skip = true``, in which case the value is the same anyway).
    """
    for key, names in result.get("requirements", {}).items():
        existing = data["requirements"].setdefault(key, [])
        seen = set(existing)
        for name in names:
            if name not in seen:
                existing.append(name)
                seen.add(name)
    for key, value in result.get("otherRequirements", {}).items():
        existing = data["otherRequirements"].get(key)
        if existing is None:
            data["otherRequirements"][key] = value
            continue
        # Existing wins when both are lists of records; flatten to one
        # list so the detail panel renders them as siblings.
        if isinstance(existing, list) and isinstance(value, list):
            existing.extend(value)
        elif isinstance(existing, list):
            existing.append(value)
        elif isinstance(value, list):
            data["otherRequirements"][key] = [existing] + value
        else:
            data["otherRequirements"][key] = [existing, value]
    for branch in result.get("orBranches", []):
        data["orBranches"].append(branch)
    for flag_key, flag_value in result.get("flags", {}).items():
        data["flags"][flag_key] = flag_value


def merge_ancestor_requirements_h2(
    tl_data: dict,
    ancestor: LuaTable,
    named_requirements: dict = None,
) -> None:
    """Lift RequirementSet-bearing fields from an ancestor container onto
    a single extracted textline.

    H2's structured-record requirement schema is identical whether the
    fields live on the textline itself or on an enclosing container, so
    the merge logic is the same as the per-textline path: each
    ``HADES2_REQUIREMENT_SET_FIELDS`` entry on the ancestor is walked
    through :func:`extract_requirements` and the result merged into the
    textline's data via :func:`_merge_requirement_result`. All
    requirements (ancestor-level and textline-level alike) are
    AND-evaluated by the engine, so unioning is the correct merge.

    Used by extractors whose data shape places gating on the container
    one (or more) levels up from the textline itself:

    * DeathLoopData inspect points carry ``SetupGameStateRequirements``
      as a sibling of ``InteractTextLineSets``.
    * Encounter / room blocks carry encounter-level
      ``GameStateRequirements`` as a sibling of any nested textline
      containers.

    :func:`extract_textline` prunes the ``orBranches`` and ``flags``
    keys when empty so the JSON stays small; this function honours that
    convention by re-pruning after the merge if it didn't actually add
    anything.
    """
    had_or_branches = "orBranches" in tl_data
    had_flags = "flags" in tl_data
    tl_data.setdefault("orBranches", [])
    tl_data.setdefault("flags", {})

    for field in HADES2_REQUIREMENT_SET_FIELDS:
        req_set = ancestor.get(field)
        if not isinstance(req_set, LuaTable):
            continue
        result = extract_requirements(req_set, named_requirements)
        _merge_requirement_result(tl_data, result)

    if not tl_data["orBranches"] and not had_or_branches:
        del tl_data["orBranches"]
    if not tl_data["flags"] and not had_flags:
        del tl_data["flags"]


def has_local_h2_requirements(node) -> bool:
    """Return True if ``node`` declares at least one field in
    :data:`HADES2_REQUIREMENT_SET_FIELDS` (with a ``LuaTable`` value).

    Used by tree-walking extractors (encounter / room) to identify the
    nearest enclosing block carrying requirements so its fields can be
    lifted onto contained textlines via
    :func:`merge_ancestor_requirements_h2`.

    Bare presence is enough; empty RequirementSet tables (which the
    engine treats as "no constraint") still count - the merge is a
    no-op in that case and updating the ancestor pointer keeps the
    walker semantics simple.
    """
    if not isinstance(node, LuaTable):
        return False
    for field in HADES2_REQUIREMENT_SET_FIELDS:
        if isinstance(node.get(field), LuaTable):
            return True
    return False


def _extract_choice_variants(
    parent_name: str,
    tl_table: LuaTable,
    fallback_speaker: str,
    source_file: str,
    *,
    named_requirements: dict = None,
) -> dict:
    """Find every inline ``Choices = {...}`` block nested in the
    parent's cues and materialise each option as a synthetic child
    textline.

    The synthetic name is ``<parent_name><ChoiceText>`` (no
    separator) to match the engine flag recorded under
    ``GameState.TextLinesChoiceRecord.<parent>`` when the player
    picks that option. Requirements that gate on the pick (e.g.
    ``IsAny = { "Choice_NemesisAccept" }``) thus reference the same
    name the synthetic carries.

    The shared :func:`src.extractors.textline_set.build_synthetic_variants`
    drives the cue-choice loop and the synthetic naming / parent-dep /
    metadata bookkeeping; this wrapper only binds the H2
    :func:`extract_textline` (structured RequirementSets, no
    ``game_data_lists`` / ``offer_text_map``) as the per-choice child
    builder. Each synthetic textline:

    * reuses :func:`extract_textline` on the choice item so any
      explicit requirement fields declared on the choice option are
      preserved verbatim (a choice option may itself carry
      ``GameStateRequirements`` to model "only show this option if
      ...");
    * gets an implicit ``RequiredTextLines: [parent_name]``
      dependency prepended so the variant is reachable in the graph
      only via the parent textline;
    * carries ``parentTextline`` + ``choiceText`` metadata for the
      viewer (rendered as a "Variant of <parent>" header with the
      choice label as the subtitle);
    * is flagged ``isSynthetic = True`` so :func:`_merge_synthetic`
      can prefer a real (hand-written) definition when one exists.
    """
    def build_child(synthetic_name, choice_item):
        return extract_textline(
            synthetic_name, choice_item, fallback_speaker, source_file,
            named_requirements=named_requirements,
        )

    return build_synthetic_variants(parent_name, tl_table, build_child)
