"""Audit tests for the :mod:`src.extractors.hades2` public API surface.

These tests pin the package-level export contract so the merge /
build pipeline and the H2-specific generate-data block can rely on
import paths that won't drift. Three rules are enforced:

1. Every name in ``__all__`` must be a real attribute on the package
   (no typos, no removed-but-still-listed entries).
2. Every name in ``__all__`` must be importable via the package-
   level ``from src.extractors.hades2 import X`` style (verified by
   loading it through the module dict, which mirrors how
   ``generate_data.py`` consumes the API).
3. The set of exported names must cover the per-extractor entry
   points + label maps + walker primitives that the rest of the
   codebase relies on (snapshotted as the ``CRITICAL_EXPORTS`` set
   below) - removing one of these should fail this test
   explicitly rather than producing a silent ``ImportError`` at
   pipeline runtime.

The audit deliberately does NOT check for a complete H1 mirror -
H2 intentionally omits some H1-only modules (``preset_choices``,
``offer_text``, ``text_line_sets``, ``meta_upgrades``) per the
module docstring. Those omissions are documented inline in
:mod:`src.extractors.hades2`.
"""

import src.extractors.hades2 as h2


# Names that the merge / build pipeline depends on. Removing one is
# an explicit breaking change; adding new exports is fine (no upper
# bound on the package surface).
CRITICAL_EXPORTS = frozenset({
    # Per-source extractor entry points.
    "extract_npc_data",
    "extract_loot_data",
    "extract_enemy_data",
    "extract_deathloop_data",
    "extract_encounter_room_data",
    # Cross-cutting pass.
    "extract_narrative_priorities",
    "apply_narrative_priorities",
    "HADES2_KNOWN_UNRESOLVED_REFS",
    "HADES2_UNRESOLVED_CATEGORY_LABELS",
    "HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS",
    # Label / vocabulary maps consumed by src.label_maps.
    "HADES2_TEXTLINE_SECTION_KEYS",
    "HADES2_SECTION_KEY_LABELS",
    "HADES2_REQ_OPERATORS",
    "HADES2_REQ_TYPE_LABELS",
    "HADES2_REQ_TYPE_EDGE_LABELS",
    "HADES2_REQ_TYPE_TOOLTIPS",
    "HADES2_REQ_TYPE_DISPLAY_ORDER",
    "HADES2_REQ_TYPE_LABELS_DEPENDENTS",
    "HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS",
    "HADES2_CHOICE_NAMES",
    "HADES2_SPEAKERS",
    # Per-extractor default-speaker maps consumed by generate_data.
    "LOOT_DEFAULT_SPEAKERS",
    "ENEMY_DEFAULT_SPEAKERS",
    "HUB_NARRATOR_SPEAKER",
    # Owner-routing overrides used by encounter / room / deathloop.
    "TEXTLINE_OWNER_OVERRIDES",
    "IDMAP_PARENT_OWNER_OVERRIDES",
    # Walker primitives used by both extractors and tests.
    "PLAYER_SPEAKER_ID",
    "extract_textline",
    "extract_textline_sections",
    "extract_requirements",
    "extract_named_requirements",
    "HADES2_REQUIREMENT_SET_FIELDS",
})


class TestAllNamesResolve:
    """Every name listed in ``__all__`` must exist on the module."""

    def test_no_typos_in_dunder_all(self):
        missing = [name for name in h2.__all__ if not hasattr(h2, name)]
        assert missing == [], (
            f"Names listed in __all__ but missing from module: {missing}"
        )

    def test_dunder_all_has_no_duplicates(self):
        # Duplicate entries usually indicate a copy-paste mistake.
        seen = set()
        dups = []
        for name in h2.__all__:
            if name in seen:
                dups.append(name)
            seen.add(name)
        assert dups == [], f"Duplicate names in __all__: {dups}"


class TestCriticalExports:
    """The pipeline-critical export set must remain stable."""

    def test_all_critical_exports_present(self):
        missing = CRITICAL_EXPORTS - set(h2.__all__)
        assert missing == set(), (
            f"Critical pipeline exports missing from __all__: {sorted(missing)}"
        )

    def test_all_critical_exports_importable(self):
        # Mirrors ``from src.extractors.hades2 import X`` for each name -
        # catches circular-import bugs and accidental shadowing.
        for name in CRITICAL_EXPORTS:
            attr = getattr(h2, name, None)
            assert attr is not None, f"{name} is None at package level"


class TestExportShape:
    """Light type checks on the exported objects so a swap to the
    wrong attribute (e.g. exporting a sentinel module instead of the
    callable inside it) is caught at audit time."""

    def test_extractor_entry_points_are_callable(self):
        for name in (
            "extract_npc_data",
            "extract_loot_data",
            "extract_enemy_data",
            "extract_deathloop_data",
            "extract_encounter_room_data",
            "extract_narrative_priorities",
            "apply_narrative_priorities",
            "extract_textline",
            "extract_textline_sections",
            "extract_requirements",
            "extract_named_requirements",
        ):
            assert callable(getattr(h2, name)), f"{name} not callable"

    def test_vocabulary_maps_are_dicts(self):
        for name in (
            "HADES2_SECTION_KEY_LABELS",
            "HADES2_REQ_TYPE_LABELS",
            "HADES2_REQ_TYPE_EDGE_LABELS",
            "HADES2_REQ_TYPE_TOOLTIPS",
            "HADES2_REQ_TYPE_LABELS_DEPENDENTS",
            "HADES2_REQ_TYPE_TOOLTIPS_DEPENDENTS",
            "HADES2_CHOICE_NAMES",
            "HADES2_SPEAKERS",
            "LOOT_DEFAULT_SPEAKERS",
            "ENEMY_DEFAULT_SPEAKERS",
            "TEXTLINE_OWNER_OVERRIDES",
            "IDMAP_PARENT_OWNER_OVERRIDES",
            "HADES2_KNOWN_UNRESOLVED_REFS",
            "HADES2_UNRESOLVED_CATEGORY_LABELS",
            "HADES2_UNRESOLVED_CATEGORY_DESCRIPTIONS",
        ):
            assert isinstance(getattr(h2, name), dict), f"{name} not a dict"

    def test_set_like_vocabularies(self):
        # frozenset / set for membership-test allowlists.
        for name in (
            "HADES2_TEXTLINE_SECTION_KEYS",
            "HADES2_REQ_OPERATORS",
            "HADES2_REQUIREMENT_SET_FIELDS",
        ):
            attr = getattr(h2, name)
            assert isinstance(attr, (set, frozenset)), (
                f"{name} not a set / frozenset"
            )

    def test_speaker_id_constants_are_strings(self):
        for name in ("PLAYER_SPEAKER_ID", "HUB_NARRATOR_SPEAKER"):
            attr = getattr(h2, name)
            assert isinstance(attr, str) and attr, f"{name} not a non-empty str"
