"""Tests for engine-name-collision variant surfacing.

When two definitions of the same textline name appear in the game's
source data, the engine's ``CurrentRun.TextLinesRecord`` is keyed by
name and so only the first variant to trigger plays - the rest are
blocked. We surface this via ``nameCollision`` + ``variants`` on the
canonical entry; the helpers under test live in :mod:`src.graph` and
the merge wiring in :mod:`src.graph_merge`.
"""

from src.graph import (
    attach_variant,
    make_variant_summary,
    split_name_collisions,
    _is_substantive_variant,
    _variant_already_present,
)
from src.graph_merge import merge_graph_data
from tests.test_merge import _make_textline, _make_dataset


def _entry(owner, *, source_file="X.lua", source_line=1, dialogue=None,
           requirements=None, other=None, synthetic=False, partner=None,
           variants=None):
    e = {
        "owner": owner,
        "section": "InteractTextLineSets",
        "sourceFile": source_file,
        "sourceLine": source_line,
        "dialogueLines": dialogue or [],
        "requirements": requirements or {},
        "otherRequirements": other or {},
    }
    if synthetic:
        e["isSynthetic"] = True
    if partner is not None:
        e["partner"] = partner
    if variants is not None:
        e["variants"] = variants
    return e


class TestIsSubstantiveVariant:
    """The substantive filter keeps the variants block focused on
    real distinct content. Synthetic choice placeholders and empty
    partner stubs (the xWithY pattern in NPCData.lua) are excluded so
    they do not flood the viewer with noise rows."""

    def test_entry_with_dialogue_is_substantive(self):
        assert _is_substantive_variant(_entry("A", dialogue=[{"text": "x"}]))

    def test_entry_with_requirements_is_substantive(self):
        assert _is_substantive_variant(
            _entry("A", requirements={"RequiredTextLines": ["X"]}))

    def test_entry_with_only_other_requirements_is_substantive(self):
        assert _is_substantive_variant(
            _entry("A", other={"RequiredMinBiomeDepth": 2}))

    def test_synthetic_entry_is_not_substantive(self):
        assert not _is_substantive_variant(
            _entry("A", dialogue=[{"text": "x"}], synthetic=True))

    def test_empty_stub_is_not_substantive(self):
        assert not _is_substantive_variant(_entry("A"))

    def test_existing_variants_keep_entry_substantive(self):
        e = _entry("A", variants=[{"sourceFile": "X.lua", "sourceLine": 1}])
        assert _is_substantive_variant(e)


class TestVariantAlreadyPresent:
    def test_dedup_by_source_file_and_line(self):
        variants = [{"sourceFile": "X.lua", "sourceLine": 10}]
        assert _variant_already_present(
            variants, {"sourceFile": "X.lua", "sourceLine": 10})
        assert not _variant_already_present(
            variants, {"sourceFile": "X.lua", "sourceLine": 11})
        assert not _variant_already_present(
            variants, {"sourceFile": "Y.lua", "sourceLine": 10})


class TestMakeVariantSummary:
    def test_includes_optional_fields_when_set(self):
        data = _entry("A", dialogue=[{"text": "x"}], partner="B")
        v = make_variant_summary(data, "A", "InteractTextLineSets")
        assert v["partner"] == "B"
        assert v["owner"] == "A"
        assert v["section"] == "InteractTextLineSets"
        assert v["dialogueLines"] == [{"text": "x"}]

    def test_omits_optional_fields_when_unset(self):
        data = _entry("A", dialogue=[{"text": "x"}])
        v = make_variant_summary(data, "A", "InteractTextLineSets")
        assert "partner" not in v
        assert "playOnce" not in v
        assert "isSynthetic" not in v

    def test_preserves_h1_priority_fields(self):
        data = _entry("A", dialogue=[{"text": "x"}])
        data["narrativePrioritySectionTier"] = "super"
        data["narrativePrioritySetLevel"] = "priority"
        v = make_variant_summary(data, "A", "InteractTextLineSets")
        assert v["narrativePrioritySectionTier"] == "super"
        assert v["narrativePrioritySetLevel"] == "priority"

    def test_preserves_h2_priority_fields(self):
        # H2 textlines pick up ordinal priority via the NarrativeData
        # post-extraction merge. When dedup discards a duplicate that
        # carried the only copy of those fields, the variant summary
        # must retain them so the viewer can still render the badge
        # on the kept side via the variant trail.
        data = _entry("A", dialogue=[{"text": "x"}])
        data["narrativePriorityOrdinal"] = 3
        data["narrativePrioritySectionSize"] = 12
        data["narrativePriorityClusterMembers"] = ["Sib1", "Sib2"]
        v = make_variant_summary(data, "A", "InteractTextLineSets")
        assert v["narrativePriorityOrdinal"] == 3
        assert v["narrativePrioritySectionSize"] == 12
        assert v["narrativePriorityClusterMembers"] == ["Sib1", "Sib2"]


class TestAttachVariant:
    def test_seeds_variants_with_kept_then_appends_dropped(self):
        kept = _entry("A", source_line=10,
                      dialogue=[{"speaker": "A", "text": "first"}])
        dropped = _entry("B", source_line=20,
                         dialogue=[{"speaker": "B", "text": "second"}])
        attach_variant(kept, dropped)
        assert kept["nameCollision"] is True
        assert len(kept["variants"]) == 2
        assert kept["variants"][0]["owner"] == "A"
        assert kept["variants"][0]["sourceLine"] == 10
        assert kept["variants"][1]["owner"] == "B"
        assert kept["variants"][1]["sourceLine"] == 20

    def test_noop_when_dropped_is_synthetic(self):
        kept = _entry("A", dialogue=[{"text": "x"}])
        dropped = _entry("B", dialogue=[{"text": "y"}], synthetic=True)
        attach_variant(kept, dropped)
        assert "nameCollision" not in kept
        assert "variants" not in kept

    def test_noop_when_dropped_is_empty_stub(self):
        # Partner-stub pattern: full kept side, empty stub dropped side.
        kept = _entry("A", dialogue=[{"text": "x"}], partner="B")
        dropped = _entry("B")
        attach_variant(kept, dropped)
        assert "nameCollision" not in kept
        assert "variants" not in kept

    def test_dedup_when_attaching_same_source_location_twice(self):
        kept = _entry("A", source_line=10, dialogue=[{"text": "x"}])
        dropped = _entry("B", source_line=20, dialogue=[{"text": "y"}])
        attach_variant(kept, dropped)
        attach_variant(kept, dropped)
        assert len(kept["variants"]) == 2

    def test_chained_collisions_lift_dropped_variants(self):
        # ``dropped`` already carries a variants list from an earlier
        # merge pass; attaching it to a third sibling must lift the
        # existing variants in rather than re-summarising ``dropped``
        # itself (which would lose data).
        prior = _entry("A", source_line=10,
                       dialogue=[{"text": "first"}])
        sibling = _entry("B", source_line=20,
                         dialogue=[{"text": "second"}])
        attach_variant(prior, sibling)
        third = _entry("C", source_line=30, dialogue=[{"text": "third"}])
        attach_variant(third, prior)
        assert third["nameCollision"] is True
        owners = [v["owner"] for v in third["variants"]]
        assert owners == ["C", "A", "B"]

    def test_chained_stub_drop_preserves_existing_variants(self):
        # Once a chain has variants, a later empty-stub drop must not
        # erase them; the substantive-filter early-return is bypassed
        # for the kept side specifically because its own existing
        # variants make it substantive.
        kept = _entry("A", source_line=10, dialogue=[{"text": "x"}])
        sibling = _entry("B", source_line=20, dialogue=[{"text": "y"}])
        attach_variant(kept, sibling)
        empty = _entry("C", source_line=30)
        attach_variant(kept, empty)
        # Empty drop was filtered out; existing variants survive.
        assert len(kept["variants"]) == 2

    def test_explicit_owner_section_kwargs_used_for_raw_extractor_data(self):
        # ``extract_encounter_room_data`` calls attach_variant on raw
        # ``tl_data`` dicts that don't carry owner/section themselves.
        kept = {"sourceFile": "X.lua", "sourceLine": 10,
                "dialogueLines": [{"text": "x"}], "requirements": {},
                "otherRequirements": {}}
        dropped = {"sourceFile": "X.lua", "sourceLine": 20,
                   "dialogueLines": [{"text": "y"}], "requirements": {},
                   "otherRequirements": {}}
        attach_variant(
            kept, dropped,
            kept_owner="RoomA", kept_section="InteractTextLineSets",
            dropped_owner="RoomB", dropped_section="InteractTextLineSets",
        )
        assert kept["variants"][0]["owner"] == "RoomA"
        assert kept["variants"][1]["owner"] == "RoomB"


class TestSplitNameCollisions:
    """``split_name_collisions`` converts each ``nameCollision`` entry
    into N suffixed sibling textlines. The original name is removed
    from the map and each new entry carries the rename-aware fields
    the viewer needs to surface the warning and link siblings."""

    def _make_collision_entry(self, name, *variants):
        # Reuse the runtime helper to seed the collision shape so the
        # test exercises the same code path the merger uses.
        kept = dict(variants[0])
        kept["nameCollision"] = True
        kept["variants"] = [
            make_variant_summary(v, v["owner"], v["section"]) for v in variants
        ]
        kept["source"] = "TestGame"
        return {name: kept}

    def test_splits_two_variant_collision_into_suffixed_pair(self):
        textlines = self._make_collision_entry(
            "Shared",
            _entry("OwnerA", source_file="A.lua", source_line=10,
                   dialogue=[{"text": "alpha"}]),
            _entry("OwnerB", source_file="B.lua", source_line=20,
                   dialogue=[{"text": "beta"}]),
        )
        result = split_name_collisions(textlines)
        assert "Shared" not in result
        assert set(result.keys()) == {"Shared_1", "Shared_2"}

    def test_each_split_entry_carries_collision_metadata(self):
        textlines = self._make_collision_entry(
            "Shared",
            _entry("OwnerA", source_file="A.lua", source_line=10,
                   dialogue=[{"text": "alpha"}]),
            _entry("OwnerB", source_file="B.lua", source_line=20,
                   dialogue=[{"text": "beta"}]),
        )
        split_name_collisions(textlines)
        first = textlines["Shared_1"]
        assert first["collisionOriginalName"] == "Shared"
        assert first["collisionIndex"] == 1
        assert first["collisionTotal"] == 2
        assert first["collisionSiblings"] == ["Shared_1", "Shared_2"]
        # Variant content is hoisted onto the split entry; the
        # ``nameCollision`` / ``variants`` book-keeping is purged.
        assert first["owner"] == "OwnerA"
        assert first["dialogueLines"] == [{"text": "alpha"}]
        assert "nameCollision" not in first
        assert "variants" not in first

    def test_split_carries_source_label_from_canonical(self):
        textlines = self._make_collision_entry(
            "Shared",
            _entry("OwnerA", source_file="A.lua", source_line=10,
                   dialogue=[{"text": "alpha"}]),
            _entry("OwnerB", source_file="B.lua", source_line=20,
                   dialogue=[{"text": "beta"}]),
        )
        split_name_collisions(textlines)
        assert textlines["Shared_1"]["source"] == "TestGame"
        assert textlines["Shared_2"]["source"] == "TestGame"

    def test_ordering_is_stable_by_source_location(self):
        # Inputs deliberately in reverse-source order; the split must
        # re-sort so the suffix is reproducible across builds.
        textlines = self._make_collision_entry(
            "Shared",
            _entry("OwnerB", source_file="B.lua", source_line=20,
                   dialogue=[{"text": "beta"}]),
            _entry("OwnerA", source_file="A.lua", source_line=10,
                   dialogue=[{"text": "alpha"}]),
        )
        split_name_collisions(textlines)
        assert textlines["Shared_1"]["sourceFile"] == "A.lua"
        assert textlines["Shared_2"]["sourceFile"] == "B.lua"

    def test_does_not_split_when_only_one_variant_remains(self):
        # A collision that the substantive-filter has reduced to a
        # single survivor shouldn't be split (no real collision).
        textlines = {"Solo": {
            "owner": "A", "section": "X", "source": "Test",
            "sourceFile": "x.lua", "sourceLine": 1,
            "dialogueLines": [{"text": "only"}],
            "requirements": {}, "otherRequirements": {},
            "nameCollision": True,
            "variants": [{"owner": "A", "section": "X",
                          "sourceFile": "x.lua", "sourceLine": 1,
                          "dialogueLines": [{"text": "only"}],
                          "requirements": {}, "otherRequirements": {}}],
        }}
        split_name_collisions(textlines)
        assert "Solo" in textlines
        assert "Solo_1" not in textlines

    def test_does_not_touch_non_collision_entries(self):
        textlines = {"Normal": {
            "owner": "A", "section": "X", "source": "Test",
            "sourceFile": "x.lua", "sourceLine": 1,
            "dialogueLines": [], "requirements": {}, "otherRequirements": {},
        }}
        split_name_collisions(textlines)
        assert "Normal" in textlines
        assert "collisionOriginalName" not in textlines["Normal"]


class TestMergePropagatesVariants:

    def test_cross_file_collision_splits_into_suffixed_siblings(self):
        ds1 = _make_dataset(_make_textline(
            "Shared", "OwnerA", source_file="A.lua", source_line=10,
            dialogue_lines=[{"speaker": "OwnerA", "text": "alpha"}],
        ))
        ds2 = _make_dataset(_make_textline(
            "Shared", "OwnerB", source_file="B.lua", source_line=20,
            dialogue_lines=[{"speaker": "OwnerB", "text": "beta"}],
        ))
        merged = merge_graph_data([ds1, ds2])
        assert "Shared" not in merged["textlines"]
        assert "Shared_1" in merged["textlines"]
        assert "Shared_2" in merged["textlines"]
        first = merged["textlines"]["Shared_1"]
        assert first["collisionOriginalName"] == "Shared"
        assert first["collisionIndex"] == 1
        assert first["collisionTotal"] == 2
        assert first["collisionSiblings"] == ["Shared_1", "Shared_2"]
        # Sorted by (sourceFile, sourceLine) for stable ordering.
        assert first["owner"] == "OwnerA"
        assert merged["textlines"]["Shared_2"]["owner"] == "OwnerB"

    def test_partner_stub_collision_does_not_split(self):
        # The xWithY pattern: full entry on one side, empty stub on the
        # other. The merge picks the full entry but must NOT promote
        # the empty stub into a variant (and therefore must NOT split).
        ds1 = _make_dataset(_make_textline(
            "NyxWithHades03", "NPC_Nyx_01", source_file="NPCData.lua",
            source_line=100, partner="NPC_Hades_01",
            dialogue_lines=[{"speaker": "NPC_Nyx_01", "text": "Hi"}],
        ))
        ds2 = _make_dataset(_make_textline(
            "NyxWithHades03", "NPC_Hades_01", source_file="NPCData.lua",
            source_line=200,
        ))
        merged = merge_graph_data([ds1, ds2])
        # Original name survives; no suffixed siblings created.
        assert "NyxWithHades03" in merged["textlines"]
        assert "NyxWithHades03_1" not in merged["textlines"]
        shared = merged["textlines"]["NyxWithHades03"]
        assert "collisionOriginalName" not in shared
