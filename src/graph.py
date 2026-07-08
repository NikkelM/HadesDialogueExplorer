"""Build the per-source dependency-graph data structure consumed by the
viewer.

Public API:

- :func:`build_graph_data` -- assemble the textlines / dependents /
  speakers / stats payload from one extractor's owner -> sections
  output. The single entry point used by :mod:`generate_data`.
- :func:`resolve_duplicate` and :func:`dup_summary` -- helpers for the
  same-textline-name collision case. Re-exported across module
  boundaries because the cross-source merge in
  ``src.graph_merge.merge_graph_data`` reuses them when stitching
  per-source datasets together; keep them stable as part of the
  contract.
- :func:`count_distinct_speakers` -- character-aware owner-count
  helper. Reused by :mod:`src.graph_merge` so the per-source and
  merged stats use identical dedup logic.
"""

import itertools
import re
from collections import defaultdict


_VARIANT_SUFFIX_RE = re.compile(r"\s*\([^()]*\)\s*$")


# The five narrative-priority fields (H1 intrinsic tier / set-level, H2
# extrinsic ordinal / section-size / cluster-members) travel together
# everywhere a textline's priority annotation is forwarded into the graph,
# carried in a variant payload, or transferred off a dropped duplicate.
# Defined once so the three usages below can't drift apart (adding a sixth
# field to only one of them silently dropped the badge on the other paths).
_NARRATIVE_PRIORITY_FIELDS = (
    "narrativePrioritySectionTier",
    "narrativePrioritySetLevel",
    "narrativePriorityOrdinal",
    "narrativePrioritySectionSize",
    "narrativePriorityClusterMembers",
)


def count_distinct_speakers(owner_ids, speakers_map: dict | None = None) -> int:
    """Count the number of distinct *characters* represented by a set of
    owner ids.

    Several owner ids can refer to the same character: e.g. the in-house
    NPC, the field-encounter variant, and the boss form of Hades each
    use a different internal id but share one character identity. The
    speakers map encodes that grouping via display names like ``"Hades"``,
    ``"Hades (Boss)"``, and ``"Hades (Field)"`` - same base name, the
    parenthetical suffix marks the variant.

    Grouping by stripped base display name lets the viewer's header stat
    reflect how many actual characters own dialogue, instead of the
    larger raw owner-id count. Owner ids without a speakers-map entry
    fall back to the id itself as the key so they still contribute to
    the count exactly once.
    """
    chars = set()
    smap = speakers_map or {}
    for oid in owner_ids:
        disp = (smap.get(oid) or {}).get("name") or oid
        chars.add(_VARIANT_SUFFIX_RE.sub("", disp).strip() or oid)
    return len(chars)


def build_graph_data(
    owners: dict,
    speakers: dict | None = None,
) -> dict:
    """
    Build the final data structure for the viewer from per-source extractor
    output.

    Args:
        owners: Dict of owner_name -> {section: {textline: data}}. The owner
            may be an NPC, an enemy, a god boon, an inspect point, etc.
        speakers: Optional dict of ``internal_id -> {"name": str,
            "description": str | None}``. The viewer uses this to
            render friendly names and the hover-tooltip character quip
            while keeping internal IDs canonical in the data. ``None``
            (the default) is treated as an empty mapping; pass an
            explicit dict to populate ``speakers`` in the result. The
            two fields are intentionally kept together because the set
            is strictly 1:1 with the internal id - splitting into
            parallel maps invites silent drift. Entries with
            ``description = None`` are emitted with the description
            field omitted so consumers can use a truthy check; entries
            without a name fall through the same way.

    Returns a dict with:
      - textlines: flat dict of textline name -> metadata (incl. `owner`)
      - dependents: reverse lookup of what depends on each textline
      - speakers: optional ``id -> {name?, description?}`` map (each
        sub-field is omitted when the source had ``None``)
      - stats: summary statistics (incl. `totalSpeakers` - a
        character count that collapses display-name variants like
        ``"Hades"`` / ``"Hades (Boss)"`` onto one bucket)
    """
    textlines = {}
    duplicates = []

    for owner_name, owner_data in owners.items():
        source = owner_data.get("source", "Unknown")
        for section_key, section_data in owner_data.items():
            # The extractor already filtered to known textline-set sections
            # for this game; the only non-section key at owner level is
            # ``source`` (a string), filtered out by the isinstance check.
            if not isinstance(section_data, dict):
                continue
            for tl_name, tl_data in section_data.items():
                if not isinstance(tl_data, dict):
                    continue
                new_entry = {
                    "name": tl_name,
                    "owner": owner_name,
                    "section": section_key,
                    "source": source,
                    "sourceFile": tl_data.get("sourceFile", ""),
                    "sourceLine": tl_data.get("sourceLine"),
                    "requirements": tl_data.get("requirements", {}),
                    "otherRequirements": tl_data.get("otherRequirements", {}),
                    "dialogueLines": tl_data.get("dialogueLines", []),
                }
                # H2 alternative requirement groups (set-level
                # ``OrRequirements`` on the source RequirementSet). Each
                # branch is itself a {requirements, otherRequirements,
                # flags} record produced by the H2 req walker. The
                # viewer renders them as collapsible OR-group boxes
                # alongside the base AND requirements; the dependent
                # builder also walks them so OR-branch textline edges
                # remain navigable downstream (tagged with branch index
                # for visual disambiguation).
                if tl_data.get("orBranches"):
                    new_entry["orBranches"] = tl_data["orBranches"]
                # Per-requirement-type provenance: each entry in
                # `requirements[type]` is paired 1:1 with an entry here that
                # is either a "GameData.X" group name (the expansion source)
                # or None for bare/unknown entries. Only present when at
                # least one expansion happened.
                if "requirementSources" in tl_data:
                    new_entry["requirementSources"] = tl_data["requirementSources"]
                # Synthetic choice-variant metadata, when present.
                for opt_key in ("parentTextline", "choiceText", "isSynthetic"):
                    if opt_key in tl_data:
                        new_entry[opt_key] = tl_data[opt_key]
                # Narrative-priority fields, when present. Each game uses
                # a different model and the fields are mutually exclusive
                # per textline:
                #   H1 (intrinsic, encoded by container shape):
                #   - section-tier: which container the textline lives in
                #     (the engine cascades super-tier sections before
                #     priority-tier sections before plain).
                #   - set-level: `Priority`/`SuperPriority` boolean on the
                #     textline-set table itself (biases random selection
                #     within whichever section is being consulted).
                #   H2 (extrinsic, looked up from NarrativeData.lua):
                #   - ordinal: 1-based rank in the priority registry list
                #     for this owner+section.
                #   - section-size: total number of priority slots in the
                #     list (so the viewer can render "#1/47").
                #   - cluster-members: sibling textline names tied at the
                #     same ordinal (inline sub-array in the priority list).
                for opt_key in _NARRATIVE_PRIORITY_FIELDS:
                    if opt_key in tl_data:
                        new_entry[opt_key] = tl_data[opt_key]
                # PlayOnce flag (once per save). Surfaced in the details
                # panel only.
                if tl_data.get("playOnce"):
                    new_entry["playOnce"] = True
                # `Skip = true` retired line - permanently unplayable (see
                # extract_textline). Surfaced so the viewer can flag it. H1
                # sets it top-level; H2 carries it under ``flags.skip`` (no
                # H2 dialogue currently uses it, but read both so the flag is
                # honoured wherever it appears).
                if tl_data.get("skip") or (tl_data.get("flags") or {}).get("skip"):
                    new_entry["skip"] = True
                # `Partner = "NPC_..."` on xWithY partner dialogues. Names
                # the second NPC; the same textline name also exists as
                # an empty `Skip = true` stub under that partner NPC.
                # `resolve_duplicate` uses the presence of `partner` to
                # pick the canonical (cue-bearing) side over the stub.
                if tl_data.get("partner"):
                    new_entry["partner"] = tl_data["partner"]
                # Closing voicelines (EndCue / EndVoiceLines) played after the
                # main dialogue. Surfaced in the details-panel preview.
                if tl_data.get("endLines"):
                    new_entry["endLines"] = tl_data["endLines"]
                # Variants pre-populated by the extractor (within-owner
                # name collisions caught by ``encounter_room_data.py``).
                # Surfaced verbatim so the cross-file merge layer can
                # chain additional variants onto the same entry.
                if tl_data.get("nameCollision"):
                    new_entry["nameCollision"] = True
                if tl_data.get("variants"):
                    new_entry["variants"] = list(tl_data["variants"])
                existing = textlines.get(tl_name)
                if existing is not None:
                    chosen, dropped = resolve_duplicate(existing, new_entry)
                    duplicates.append({
                        "name": tl_name,
                        # `intra-file` = same source file. Within a single
                        # source (e.g. NPCData.lua) the historic cause is
                        # the xWithY partner-stub pattern; the encounter
                        # /room walker now also flags same-name-different
                        # -owner collisions inside a single file here.
                        # `cross-file` is emitted by
                        # ``graph_merge.merge_graph_data`` for collisions
                        # detected when stitching different per-source
                        # datasets together.
                        "scope": "intra-file",
                        "kept": dup_summary(chosen),
                        "dropped": dup_summary(dropped),
                    })
                    transfer_orphan_annotations(chosen, dropped)
                    attach_variant(chosen, dropped)
                    textlines[tl_name] = chosen
                else:
                    textlines[tl_name] = new_entry

    resolve_skip_replacements(textlines)
    dependents = build_dependents(textlines)
    alternates = build_alternates(textlines)

    all_referenced = collect_referenced_textlines(textlines)

    stats = {
        "totalSpeakers": count_distinct_speakers(
            {tl["owner"] for tl in textlines.values()}, speakers
        ),
        "totalTextlines": len(textlines),
        "totalEdges": sum(len(v) for v in dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(textlines.keys())),
        "duplicates": duplicates,
    }

    return {
        "textlines": textlines,
        "dependents": dependents,
        "alternates": alternates,
        "speakers": _filter_speakers(speakers),
        "stats": stats,
    }


# Suffix priority for locating the live replacement of a retired
# (`Skip = true`) textline. A retired line and its replacement share a
# base name; the replacement is the canonical live sibling (`_A`/`_Alt`)
# or the un-suffixed base. `_B`/`_C` siblings are deliberately excluded:
# they are alternates of the replacement (or distinct lines in the same
# retired set), not the primary replacement. Verified against H1
# NPCData: gift chains (XGiftNN -> XGiftNN_A), DusaGift05 ->
# DusaGift05_Alt, HadesRevealsBadgeSeller01_B -> HadesRevealsBadgeSeller01.
# Retired lines with no canonical live sibling/base (early-access
# HadesRunCleared*, PersephoneChat12) get no link.
_SKIP_REPLACEMENT_SUFFIXES = ("_A", "_Alt")


def resolve_skip_replacements(textlines: dict) -> None:
    """Annotate each retired (``skip``) textline with ``skipReplacement``:
    the name of the live line that superseded it, when derivable from the
    shared base name. Mutates ``textlines`` in place; leaves the field
    absent when no live replacement exists."""
    def is_live(name: str) -> bool:
        entry = textlines.get(name)
        return entry is not None and not entry.get("skip")

    for name, entry in textlines.items():
        if not entry.get("skip"):
            continue
        replacement = next(
            (name + suf for suf in _SKIP_REPLACEMENT_SUFFIXES if is_live(name + suf)),
            None,
        )
        if replacement is None and "_" in name:
            base = name.rsplit("_", 1)[0]
            if is_live(base):
                replacement = base
        if replacement is not None:
            entry["skipReplacement"] = replacement


def _filter_speakers(speakers: dict | None) -> dict:
    """Strip empty/None subfields from a speakers map so consumers can
    use a truthy check against ``speakers[id]?.name`` /
    ``speakers[id]?.description`` instead of comparing to ``None``."""
    out = {}
    for sid, entry in (speakers or {}).items():
        if not isinstance(entry, dict):
            continue
        slim = {k: v for k, v in entry.items() if v}
        if slim:
            out[sid] = slim
    return out


def resolve_duplicate(existing: dict, new: dict) -> tuple:
    """When the same textline name appears under two owners, pick the one
    with more content (more dialogue lines + more requirements). This matches
    the game's pattern where shared dialogues have one "stub" entry (queue
    trigger only) and one "full" entry with the actual content / dependencies.

    Two explicit signals override the richness heuristic so the rule is
    documented and robust against future game-data changes:

    - Synthetic choice-variant entries always lose to a real definition
      (the engine only ever fires the real cue-bearing textline; the
      synthetic exists purely to model the choice flag's name in the
      dependency graph).
    - The xWithY partner pattern: the side declaring ``Partner = "..."``
      is by definition the cue-bearing canonical entry; the partner-NPC
      side is a queue-only stub that never declares ``Partner``. Prefer
      the side with ``partner`` set whenever exactly one side has it.
      This handles the (hypothetical but possible) case where future
      game data ships stubs with enough placeholder metadata to outscore
      the canonical side under the plain richness comparison.

    Returns (kept, dropped). Ties go to the existing entry (first-wins).

    Public alongside :func:`dup_summary` because the merge pipeline in
    ``src.graph_merge.merge_graph_data`` reuses these helpers across module
    boundaries when stitching per-source datasets together.
    """
    existing_synth = bool(existing.get("isSynthetic"))
    new_synth = bool(new.get("isSynthetic"))
    if existing_synth and not new_synth:
        return new, existing
    if new_synth and not existing_synth:
        return existing, new
    existing_partner = bool(existing.get("partner"))
    new_partner = bool(new.get("partner"))
    if existing_partner and not new_partner:
        return existing, new
    if new_partner and not existing_partner:
        return new, existing
    if _richness(new) > _richness(existing):
        return new, existing
    return existing, new


def _richness(entry: dict) -> int:
    lines = len(entry.get("dialogueLines") or [])
    reqs = sum(len(v) for v in (entry.get("requirements") or {}).values())
    other = len(entry.get("otherRequirements") or {})
    return lines * 100 + reqs * 10 + other


def dup_summary(entry: dict) -> dict:
    """Compact descriptor for one half of a duplicate pair, written into
    ``stats.duplicates`` so the viewer can surface which definition won
    and which lost when the same textline name appeared twice across
    parsed source files. Public counterpart to :func:`resolve_duplicate`.

    The ``partner`` field is preserved when present so consumers can
    distinguish the well-known xWithY partner-stub pattern (kept side
    declares ``Partner``) from accidental cross-file collisions
    (neither side declares ``Partner``).
    """
    summary = {
        "owner": entry["owner"],
        "section": entry["section"],
        "sourceFile": entry.get("sourceFile", ""),
        "sourceLine": entry.get("sourceLine"),
        "dialogueLines": len(entry.get("dialogueLines") or []),
        "requirementCount": sum(len(v) for v in (entry.get("requirements") or {}).values()),
    }
    if entry.get("partner"):
        summary["partner"] = entry["partner"]
    return summary


# Per-entry fields that participate in a variant payload. Both
# graph-shape entries (with ``owner``/``section`` set) and raw extractor
# ``tl_data`` (with the outer dict supplying owner/section) flow through
# :func:`make_variant_summary`; the optional set is kept here so the
# extractor and the merge layers stay in sync about which fields a
# variant carries.
_VARIANT_OPTIONAL_FIELDS = (
    "requirementSources",
    "orBranches",
    "playOnce",
    "partner",
    "parentTextline",
    "choiceText",
    "isSynthetic",
    "endLines",
) + _NARRATIVE_PRIORITY_FIELDS


def make_variant_summary(data: dict, owner: str, section: str) -> dict:
    """Build a variant payload from either a graph-shape entry or a raw
    extractor ``tl_data``.

    The variant carries the per-definition fields that differ across
    name-collision siblings: owner, section, source location, dialogue
    lines, and requirements (textline + non-textline). ``source`` is
    intentionally omitted because a name collision only happens within a
    single parsed dataset; the game label is set on the canonical entry.
    """
    v = {
        "owner": owner,
        "section": section,
        "sourceFile": data.get("sourceFile", ""),
        "sourceLine": data.get("sourceLine"),
        "dialogueLines": data.get("dialogueLines", []),
        "requirements": data.get("requirements", {}),
        "otherRequirements": data.get("otherRequirements", {}),
    }
    for opt_key in _VARIANT_OPTIONAL_FIELDS:
        if data.get(opt_key):
            v[opt_key] = data[opt_key]
    return v


def attach_variant(
    kept: dict,
    dropped: dict,
    *,
    kept_owner: str | None = None,
    kept_section: str | None = None,
    dropped_owner: str | None = None,
    dropped_section: str | None = None,
) -> None:
    """Promote a duplicate-textline drop into a sibling variant on the
    kept entry. Mutates ``kept`` in place.

    The viewer renders ``kept["variants"]`` as a single per-textline
    block with one sub-block per variant, plus a banner explaining the
    engine's "first variant to trigger wins, others are blocked" rule.
    The first entry in ``variants`` is always the seed variant (the
    canonical's own data) so the renderer can iterate variants
    uniformly without special-casing the canonical.

    Chained collisions are handled by lifting any pre-existing
    ``variants`` array on ``dropped`` (set when the extractor already
    detected a within-owner collision, or when an earlier
    merge-layer pass already attached siblings) onto the kept entry,
    deduplicated by ``(sourceFile, sourceLine)``.

    ``kept_owner`` / ``kept_section`` (and the ``dropped_*`` pair) are
    consulted only when the corresponding entry lacks an ``owner`` /
    ``section`` field, which happens when this is called from inside an
    extractor on raw ``tl_data``. Graph-shape entries already carry
    both, so the merge layers can omit the keyword arguments entirely.

    No-op when the dropped side is not a substantive variant:

    * **Synthetic choice variants** are routed through the parent's
      choice-link UI, not the variant block, so they are intentionally
      excluded.
    * **Empty placeholder stubs** (the xWithY partner-stub pattern in
      ``NPCData.lua``: ``Skip = true`` with no dialogue and no
      requirements) are the same logical textline registered under the
      partner NPC so the engine can find it from either side. They
      carry no distinct content and would just pollute the variant
      list with empty rows.
    """
    if not _is_substantive_variant(dropped):
        return
    kept["nameCollision"] = True
    if "variants" not in kept:
        kept["variants"] = [make_variant_summary(
            kept,
            kept.get("owner", kept_owner),
            kept.get("section", kept_section),
        )]
    dropped_variants = dropped.get("variants")
    if dropped_variants:
        candidates = list(dropped_variants)
    else:
        candidates = [make_variant_summary(
            dropped,
            dropped.get("owner", dropped_owner),
            dropped.get("section", dropped_section),
        )]
    for cand in candidates:
        if not _variant_already_present(kept["variants"], cand):
            kept["variants"].append(cand)


def _is_substantive_variant(entry: dict) -> bool:
    """A variant is substantive when it carries content distinct enough
    to be worth surfacing in the viewer's variant block. Synthetic
    choice placeholders and empty partner stubs are both excluded; see
    :func:`attach_variant` for why."""
    if entry.get("isSynthetic"):
        return False
    if entry.get("dialogueLines"):
        return True
    if entry.get("requirements"):
        return True
    if entry.get("otherRequirements"):
        return True
    # An entry whose ``variants`` list has already been populated by an
    # earlier dedup pass is substantive by definition (each of those
    # variants was itself substantive when added). Without this branch
    # a chained merge would lose previously-recorded siblings the
    # moment a stub drops into the chain.
    if entry.get("variants"):
        return True
    return False


def _variant_already_present(variants: list, candidate: dict) -> bool:
    """Variants are uniquely identified by ``(sourceFile, sourceLine)``.

    Two textline-set tables can never share a source location, and the
    pair survives any later re-parse of the same source, so it is a
    stable key for the chained-merge dedup loop in :func:`attach_variant`.
    """
    key = (candidate.get("sourceFile"), candidate.get("sourceLine"))
    return any(
        (v.get("sourceFile"), v.get("sourceLine")) == key
        for v in variants
    )


# Annotation fields that can legitimately live on either side of a
# duplicate pair and must not be silently dropped when ``resolve_duplicate``
# picks one side as the canonical entry. All five are H2 NarrativeData
# priority fields: ``NarrativeData_<NPC>.lua`` registers each textline
# name under exactly one NPC's owner table, and for the xWithY partner
# pattern that NPC is sometimes the partner-stub side (zero dialogue,
# zero requirements) rather than the cue-bearing canonical side. The
# stub then loses to the canonical entry under ``resolve_duplicate``'s
# richness comparison, and the priority annotation rides off with it
# unless we transfer it across first. H1 is unaffected (its priority
# data is intrinsic to the canonical entry's container shape, so the
# transfer is a no-op there).
_TRANSFERABLE_ORPHAN_FIELDS = _NARRATIVE_PRIORITY_FIELDS


def transfer_orphan_annotations(kept: dict, dropped: dict) -> None:
    """Copy annotation fields from a dropped duplicate onto the kept
    entry whenever the kept entry lacks them. Mutates ``kept`` in place.

    Currently scoped to H2 NarrativeData priority fields (see
    :data:`_TRANSFERABLE_ORPHAN_FIELDS` for the list and rationale).
    Fields already populated on the kept side are never overwritten:
    the dedup pipeline picks ``kept`` as the canonical entry first,
    so its annotations always win when both sides supply a value.

    Called from both :func:`build_graph_data` (intra-file dedup) and
    :func:`src.graph_merge.merge_graph_data` (cross-file dedup) right
    after :func:`resolve_duplicate` and before :func:`attach_variant`:

    * After ``resolve_duplicate`` -- so we know which side won.
    * Before ``attach_variant`` -- so the variant payload generated from
      ``dropped`` reflects its original annotation state; the transfer
      onto ``kept`` is a separate concern from preserving the dropped
      entry as a distinct-content sibling.
    """
    for key in _TRANSFERABLE_ORPHAN_FIELDS:
        if key not in kept and key in dropped:
            kept[key] = dropped[key]


def split_name_collisions(textlines: dict) -> dict:
    """Replace each ``nameCollision`` entry with one suffixed entry per
    variant. Mutates ``textlines`` in place and returns it.

    The collisions are real distinct content - different rooms, inspect
    points or boon sources happen to share a textline name in the
    game's source data, the engine treats them as the same logical
    textline (only the first to trigger plays), but to a player they
    are clearly separate dialogues with separate texts. Surfacing them
    as separate textlines under suffixed names (``Foo_1``, ``Foo_2``)
    is more faithful to the player-visible content than merging them
    into one entry with a variants list. Each new entry carries the
    rename-aware fields the viewer uses to surface the warning label
    and link siblings:

    * ``collisionOriginalName`` - the un-suffixed source-data name.
    * ``collisionIndex`` / ``collisionTotal`` - this entry's 1-based
      position in the sibling list.
    * ``collisionSiblings`` - the full ordered list of suffixed names
      (including this entry) so the viewer can render sibling-link UI
      without scanning the textline map.

    The original (un-suffixed) name is removed from the map. We
    verified that no dialogue in the parsed data references any of
    the colliding names from its requirements, so dropping the
    original name does not strand any edges; if a future game ships
    a requirement that DOES reference one, it will surface in
    ``unresolvedRefs`` and we can revisit the policy.

    Sorted by ``(sourceFile, sourceLine)`` so the suffix is stable
    across builds even if the upstream dict iteration order changes.
    """
    to_add = {}
    to_remove = []
    for name, entry in textlines.items():
        if not entry.get("nameCollision"):
            continue
        variants = entry.get("variants") or []
        if len(variants) < 2:
            continue
        sorted_variants = sorted(
            variants,
            key=lambda v: (v.get("sourceFile") or "", v.get("sourceLine") or 0),
        )
        total = len(sorted_variants)
        siblings = [f"{name}_{i + 1}" for i in range(total)]
        for i, variant in enumerate(sorted_variants):
            to_add[siblings[i]] = _entry_from_variant(
                entry, variant, name, i + 1, total, siblings,
            )
        to_remove.append(name)
    for name in to_remove:
        del textlines[name]
    # The synthetic sibling names (``Foo_1``, ``Foo_2`` ...) must not collide
    # with a textline that already exists, or ``update`` would silently
    # overwrite real data. No clash occurs in either game's data; fail loud
    # if a future split ever produces one rather than dropping a textline.
    clash = set(to_add) & set(textlines)
    if clash:
        raise ValueError(
            f"split_name_collisions: synthetic sibling name(s) "
            f"{sorted(clash)} already exist as textlines; refusing to overwrite."
        )
    textlines.update(to_add)
    return textlines


def _entry_from_variant(canonical: dict, variant: dict, original_name: str,
                        index: int, total: int, siblings: list) -> dict:
    """Build a fresh textline entry from one collision variant.

    Carries over the canonical's stable shared fields (``source`` game
    label) plus the variant-specific content (owner, section, source
    location, dialogue lines, requirements). Strips the
    ``nameCollision`` / ``variants`` book-keeping (no longer relevant
    after the split) and adds the rename-aware fields the viewer
    consumes.
    """
    new_entry = {
        "owner": variant["owner"],
        "section": variant["section"],
        "source": canonical.get("source", "Unknown"),
        "sourceFile": variant.get("sourceFile", ""),
        "sourceLine": variant.get("sourceLine"),
        "requirements": variant.get("requirements", {}),
        "otherRequirements": variant.get("otherRequirements", {}),
        "dialogueLines": variant.get("dialogueLines", []),
    }
    for opt_key in _VARIANT_OPTIONAL_FIELDS:
        if variant.get(opt_key):
            new_entry[opt_key] = variant[opt_key]
    new_entry["collisionOriginalName"] = original_name
    new_entry["collisionIndex"] = index
    new_entry["collisionTotal"] = total
    new_entry["collisionSiblings"] = list(siblings)
    return new_entry


def collect_referenced_textlines(textlines: dict) -> set:
    """Collect every textline name referenced by any textline's requirements,
    including those reached through H2 ``orBranches``.

    Shared by :func:`build_graph_data` and
    ``src.graph_merge.merge_graph_data`` so the per-source and merged
    unresolved-ref accounting stay in lockstep: an OR alternative pointing
    at a missing textline is just as broken as a base requirement, and both
    passes must report it identically.
    """
    referenced = set()
    for tl_data in textlines.values():
        for req_list in (tl_data.get("requirements") or {}).values():
            referenced.update(req_list)
        for branch in tl_data.get("orBranches") or []:
            for req_list in (branch.get("requirements") or {}).values():
                referenced.update(req_list)
    return referenced


def build_dependents(textlines: dict) -> dict:
    """Reverse-index requirements: dep_name -> [{name, type, ...}, ...].

    Self-references are intentionally excluded. They always come from
    cooldown / PlayOnce-style fields (``MinRunsSinceAnyTextLines``,
    ``RequiredFalseTextLines*``) and never from hard-prereq fields, so
    they are idiomatic game-data patterns rather than real graph edges.
    Including them would inflate ``stats.totalEdges`` and produce
    misleading "cycle" markers in the viewer's tree.

    H2 ``orBranches`` (alternative requirement groups) are walked as
    well so OR-branch textline edges remain navigable from the
    downstream side. Each OR-branch edge carries ``orBranchIndex``
    (1-based) and ``orBranchTotal`` so the viewer can tag the
    dependent as "(OR alt N of M)" rather than a hard requirement.
    """
    dependents = defaultdict(list)
    for tl_name, tl_data in textlines.items():
        for req_type, req_list in tl_data["requirements"].items():
            for dep in req_list:
                if dep == tl_name:
                    continue
                dependents[dep].append({"name": tl_name, "type": req_type})
        or_branches = tl_data.get("orBranches") or []
        total_branches = len(or_branches)
        for branch_index, branch in enumerate(or_branches, start=1):
            branch_reqs = (branch or {}).get("requirements") or {}
            for req_type, req_list in branch_reqs.items():
                for dep in req_list:
                    if dep == tl_name:
                        continue
                    dependents[dep].append({
                        "name": tl_name,
                        "type": req_type,
                        "orBranchIndex": branch_index,
                        "orBranchTotal": total_branches,
                    })
    return dict(dependents)


# Regex for detecting alternate-suffix names. Two naming conventions appear in
# the game data:
#   * a stem plus a single trailing uppercase letter, optionally underscore-
#     separated (e.g. PatroclusAboutBracer01A, 01B; SomeLine_A), and
#   * a stem plus an explicit ``_Alt`` marker (e.g.
#     DusaLoungeRenovationQuest02 vs DusaLoungeRenovationQuest02_Alt).
_ALTERNATE_SUFFIX_RE = re.compile(r"^(.+?)(?:_Alt|_?[A-Z])$")

# Choice-outcome suffixes. Some alternates are gated on opposite branches of a
# one-time choice (e.g. ErisAboutRelationship03 needs ..._ErisAccept while its
# _B sibling needs ..._ErisDecline), so they never name each other directly.
_CHOICE_OUTCOMES = ("Accept", "Decline")

# Hades 1 ``GameState.Flags`` gates (RequiredTrueFlags / RequiredFalseFlags) whose
# value is fixed for the whole life of a save, so a "must be F" sibling and a
# "must NOT be F" sibling can never both become eligible - a genuine alternate
# partition. Only ``HardMode`` qualifies: Hell Mode is read once at save creation
# (RunManager.lua StartNewGame) and never reassigned. The one-way unlocks
# (ShrineUnlocked / AspectsUnlocked) deliberately do NOT qualify: they flip
# false -> true once, so the "false" sibling is eligible before the unlock and
# the "true" sibling after, letting both play across a save's lifetime.
_FIXED_PER_SAVE_FLAGS = frozenset({"HardMode"})

# Manually-confirmed content-based alternate groups (issue #133): textlines
# whose spoken content is identical (same ordered cue signature) but whose names
# differ enough that the name-stem heuristic below misses them. Reviewed and
# confirmed from a one-off cue-id content analysis. Each inner list is a set of
# mutually-alternate textline names; ``build_alternates`` only links members
# present in the game being processed, so the H1 and H2 groups coexist here.
_CONTENT_ALTERNATE_GROUPS = [
    # Hades 1
    ["AchillesAboutMegAndThanRelationship01", "AchillesAboutMegaeraRelationship01", "AchillesAboutThanatosRelationship01"],
    ["CharonFirstMeeting", "CharonFirstMeeting_Alt"],
    ["MegaeraMeeting01", "MegaeraMeeting01_Alt", "MegaeraMeeting01_Alt_B", "MegaeraMeeting01_B"],
    ["MinotaurFirstAppearance_MetTheseus", "MinotaurFirstAppearance_NotMetTheseus"],
    ["OrpheusSingsAgain01", "OrpheusSingsAgain01_B", "OrpheusSingsAgain01_C", "OrpheusSingsAgain01_D"],
    ["OrpheusSingsAgain03", "OrpheusSingsAgain03_B"],
    ["PatroclusAboutAchilles01C_01", "PatroclusAboutAchilles01C_02"],
    ["TheseusFirstAppearance_MetBeatMinotaur", "TheseusFirstAppearance_MetNotBeatMinotaur", "TheseusFirstAppearance_NotMetMinotaur"],
    ["TheseusSecondEncounter01_IfYouLost", "TheseusSecondEncounter01_IfYouWon"],
    # Hades 2
    ["ErisAboutRelationship02", "ErisBossAboutRelationship02"],
    ["HecateAboutChronos01", "HecateAboutChronosAnomaly01", "HecateAboutChronosBossEarlyL01"],
    ["HecateAboutTyphonFight01", "HecateAboutTyphonFight01_B", "HecateBossAboutTyphonFight01", "HecateBossAboutTyphonFight01_B"],
    ["HecateAboutUltimateProgress04", "HecateBossAboutEndingPath04"],
    ["HecateBossFirstAppearance", "HecateBossFirstAppearanceAlt"],
    ["HeraFirstPickUp", "HeraFirstPickUpAlt", "HeraFirstPickUpPostPalace", "HeraFirstPickUpPostPalaceAlt"],
    ["IcarusAboutFlying01", "IcarusAboutFlying01_B", "IcarusHomeAboutFlying01", "IcarusHomeAboutFlying01_B"],
    ["Inspect_Q_Boss01_03", "Inspect_Q_Boss02_03"],
    ["ZagreusPastMeeting06", "ZagreusPastMeeting06_B"],
    ["ZeusPalaceFirstMeeting", "ZeusPalaceFirstMeetingAlt"],
]


def _merge_overlapping_sets(sets: list) -> list:
    """Union-find over a list of name sets: merge any that share a member into
    one cluster. Lets a textline that belongs to both a name-based confirmed
    group and a manual content group (or two content groups) land in a single
    consistent alternate cluster. Returns clusters (as sets) with 2+ members."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    for st in sets:
        members = list(st)
        for m in members[1:]:
            parent[find(m)] = find(members[0])
    clusters = {}
    for st in sets:
        for n in st:
            clusters.setdefault(find(n), set()).add(n)
    return [c for c in clusters.values() if len(c) >= 2]


def _choice_complement(ref: str):
    """Return ``(prefix, outcome)`` if ``ref`` is a choice Accept/Decline line.

    Two refs with the same prefix but different outcome are complementary
    branches of the same one-time choice, so the lines gated on them are
    mutually exclusive.
    """
    for outcome in _CHOICE_OUTCOMES:
        if ref.endswith(outcome) and len(ref) > len(outcome):
            return ref[: -len(outcome)], outcome
    return None


def _confirming_refs(textline: dict, types: set) -> set:
    """Collect a textline's confirming references of the given requirement
    ``types``, looking both at its top-level ``requirements`` and inside each
    ``orBranches`` clause.

    Some alternates carry their mutually-exclusive gate inside an OR branch
    rather than at the top level - e.g. MorosAboutRelationship03 requires the
    *Accept* branch of the one-time MorosBecomingCloser01 choice and its ``_B``
    sibling the *Decline* branch, each expressed as a ``RequiredAnyTextLines``
    inside an ``orBranches`` clause while the top-level ``requirements`` is
    empty. Gathering branch refs lets the complementary-choice / cross-reference
    confirmation see them.
    """
    refs = set()
    hosts = [textline.get("requirements") or {}]
    for branch in textline.get("orBranches") or []:
        hosts.append(branch.get("requirements") or {})
    for reqs in hosts:
        for t, rs in reqs.items():
            if t in types:
                refs.update(rs)
    return refs


def build_alternates(textlines: dict) -> dict:
    """Detect mutually exclusive alternate dialogues using two-step confirmation.

    Step 1: Group textlines by name stem (regex strips a trailing _Alt or
    _?[A-Z]).
    Step 2: Confirm that members are mutually exclusive. Beyond a direct
    RequiredFalse/RequiredAny cross-reference, three indirect patterns are
    recognised: complementary choice branches (Accept vs Decline of the same
    choice), HasAny-vs-HasNone over the same referenced set, and a complementary
    fixed-per-save flag gate (one sibling needs flag F true, the other false).
    Confirming references are read from each textline's top-level ``requirements``
    and from every ``orBranches`` clause, so a gate that lives only inside an OR
    branch (as the Moros relationship choice does) still confirms.

    Returns a dict mapping textline name -> list of sibling alternate names
    (excluding self). Only textlines with confirmed alternates are included.
    """
    # Step 1: Group candidates by stem
    stem_groups = {}
    for name in textlines:
        m = _ALTERNATE_SUFFIX_RE.match(name)
        if m:
            stem = m.group(1)
            stem_groups.setdefault(stem, set()).add(name)

    # The base (no-suffix) form is also a candidate if it exists
    for stem, members in list(stem_groups.items()):
        if stem in textlines:
            members.add(stem)

    # Only consider groups with 2+ members
    stem_groups = {s: m for s, m in stem_groups.items() if len(m) >= 2}

    # Step 2: Confirm via requirement co-occurrence
    _CONFIRMING_TYPES = {
        "RequiredFalseTextLines",
        "RequiredFalseTextLinesLastRun",
        "RequiredFalseTextLinesThisRun",
        "RequiredFalseQueuedTextLines",
        "RequiredAnyTextLines",
        "RequiredAnyTextLinesLastRun",
        "RequiredAnyQueuedTextLines",
        "RequiredAnyOtherTextLines",
    }
    _ANY_TYPES = {t for t in _CONFIRMING_TYPES if "Any" in t}
    _FALSE_TYPES = {t for t in _CONFIRMING_TYPES if "False" in t}

    confirmed_sets = []
    for stem, candidates in stem_groups.items():
        # Per-candidate "needs one of" and "needs none of" reference sets.
        any_refs = {}
        false_refs = {}
        true_flags = {}
        false_flags = {}
        for name in candidates:
            any_refs[name] = _confirming_refs(textlines[name], _ANY_TYPES)
            false_refs[name] = _confirming_refs(textlines[name], _FALSE_TYPES)
            other = textlines[name].get("otherRequirements", {})
            true_flags[name] = set(other.get("RequiredTrueFlags") or [])
            false_flags[name] = set(other.get("RequiredFalseFlags") or [])

        confirmed = set()
        names = sorted(candidates)

        # Direct cross-reference to a sibling.
        for name in names:
            refs = any_refs[name] | false_refs[name]
            for sib in candidates.intersection(refs):
                confirmed.update((name, sib))

        # Complementary gates that never name each other directly.
        for a, b in itertools.combinations(names, 2):
            a_choices = {_choice_complement(r) for r in any_refs[a]} - {None}
            b_choices = {_choice_complement(r) for r in any_refs[b]} - {None}
            if any(pa == pb and oa != ob for pa, oa in a_choices for pb, ob in b_choices):
                confirmed.update((a, b))
            if any_refs[a] and any_refs[a] == false_refs[b]:
                confirmed.update((a, b))
            if any_refs[b] and any_refs[b] == false_refs[a]:
                confirmed.update((a, b))
            # Complementary fixed-per-save flag gate: one sibling needs flag F
            # true, the other needs it false, and F never changes within a save.
            if (true_flags[a] & false_flags[b] & _FIXED_PER_SAVE_FLAGS) \
                    or (true_flags[b] & false_flags[a] & _FIXED_PER_SAVE_FLAGS):
                confirmed.update((a, b))

        if len(confirmed) >= 2:
            confirmed_sets.append(confirmed)

    # Manually-confirmed content-based alternates (issue #133): add each group
    # whose members are present in this textline set. Overlapping sets (a member
    # shared with a name-based group or another content group) are unioned so the
    # cluster stays a single, symmetric alternate group.
    for group in _CONTENT_ALTERNATE_GROUPS:
        present = {n for n in group if n in textlines}
        if len(present) >= 2:
            confirmed_sets.append(present)

    alternates = {}
    for cluster in _merge_overlapping_sets(confirmed_sets):
        for name in cluster:
            alternates[name] = sorted(cluster - {name})
    return alternates
