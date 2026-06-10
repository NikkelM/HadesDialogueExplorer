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

import re

from ...lua_parser import LuaTable
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


# Pre-compiled format-tag stripper. H2 tags are shorter than H1's
# (``{#Emph}`` / ``{#Prev}`` vs ``{#DialogueItalicFormat}`` /
# ``{#PreviousFormat}``) but the regex matches both vocabularies.
_FORMAT_TAG_RE = re.compile(r"\{#\w+\}")


def extract_textline_sections(
    owner_name: str,
    owner_table: LuaTable,
    source_file: str,
    *,
    section_keys,
    default_speaker: str = None,
    named_requirements: dict = None,
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
                named_requirements=named_requirements,
            )
        # Synthesise per-choice child textlines (one per ChoiceText) for
        # every cue in this section that declares an inline
        # ``Choices = {...}`` block. Synthetic names are
        # ``<parent><ChoiceText>`` (no separator) to match the
        # ``TextLinesChoiceRecord`` key the engine records when the
        # player picks that option, so requirement gates that reference
        # it (``IsAny = { "Choice_NemesisAccept" }``) line up.
        # A real (hand-written) textline with the same name always
        # wins via _merge_synthetic - none currently exist for H2 but
        # the safety net mirrors H1.
        for tl_name in list(section.keys()):
            tl_table = value.get(tl_name)
            if not isinstance(tl_table, LuaTable):
                continue
            variants = _extract_choice_variants(
                tl_name, tl_table, fallback_speaker, source_file,
                named_requirements=named_requirements,
            )
            for syn_name, syn_data in variants.items():
                _merge_synthetic(section, syn_name, syn_data)
        sections[key] = section
    return sections


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

    # Cue array -> dialogue lines (with optional choice-prompt attachment).
    for entry in tl_table.array:
        if not isinstance(entry, LuaTable):
            continue
        text = entry.get("Text")
        if not isinstance(text, str):
            continue
        text = _FORMAT_TAG_RE.sub("", text)
        speaker = _resolve_cue_speaker(entry, fallback_speaker)
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
    3. Fallback to the owner's id (passed in by the caller).

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


def _collect_cue_choices(cue: LuaTable, parent_name: str):
    """Return the list of ``{internal, targetTextline}`` choice entries
    declared on a single cue, or ``None`` when the cue has no
    ``Choices`` field.

    H2 only supports the inline-table shape::

        Choices = {
            { ChoiceText = "Choice_<NPC>Accept",  ... cue array ... },
            { ChoiceText = "Choice_<NPC>Decline", ... cue array ... },
        },

    Unlike H1, there is NO ``Choices = PresetEventArgs.<Name>``
    indirection in H2 (every observed Choices block embeds its
    options inline; ``PresetEventArgs.X`` is reserved for other
    callsites like ``PostLineFunctionArgs``).

    Each option's ``targetTextline`` is the synthetic name
    ``<parent_name><ChoiceText>`` (matches what
    :func:`_extract_choice_variants` produces and what the engine
    records under ``GameState.TextLinesChoiceRecord.<parent>`` when
    the player picks the option). The viewer wraps these as
    click-through links.

    Choices missing a string ``ChoiceText`` are silently skipped; an
    empty Choices block still returns ``[]`` (rather than None) so
    the cue is flagged as a ``choicePrompt`` even when no usable
    options are declared - matches the H1 walker.
    """
    choices_field = cue.get("Choices")
    if not isinstance(choices_field, LuaTable):
        return None
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

    Each synthetic textline:

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
    variants: dict = {}
    for cue in tl_table.array:
        if not isinstance(cue, LuaTable):
            continue
        choices_field = cue.get("Choices")
        if not isinstance(choices_field, LuaTable):
            continue
        for choice_item in choices_field.array:
            if not isinstance(choice_item, LuaTable):
                continue
            choice_text = choice_item.get("ChoiceText")
            if not isinstance(choice_text, str) or not choice_text:
                continue
            synthetic_name = parent_name + choice_text
            child = extract_textline(
                synthetic_name, choice_item, fallback_speaker, source_file,
                named_requirements=named_requirements,
            )
            existing = child["requirements"].setdefault("RequiredTextLines", [])
            if parent_name not in existing:
                existing.insert(0, parent_name)
            child["parentTextline"] = parent_name
            child["choiceText"] = choice_text
            child["isSynthetic"] = True
            variants[synthetic_name] = child
    return variants


def _merge_synthetic(section: dict, name: str, data: dict) -> None:
    """Add a synthetic textline to a section, deferring to any real
    definition (synthetic loses) and to the first synthetic when two
    synthetics collide (first-wins, deterministic on source order).

    The "real wins" rule guards the (currently theoretical for H2 but
    long-standing for H1) case where a future game patch hand-defines
    a textline with a name that happens to match a synthetic the
    extractor would produce - the hand-written definition is always
    canonical.
    """
    existing = section.get(name)
    if existing is None:
        section[name] = data
        return
    # Real beats synthetic.
    if not existing.get("isSynthetic"):
        return
    # Two synthetics: first wins (deterministic on iteration order).
    return
