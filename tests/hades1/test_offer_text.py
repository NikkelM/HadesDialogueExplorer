"""Tests for the offer/choice text substitution wired into
:func:`extract_textline` via :data:`HADES1_OFFER_TEXT_MAP`.

The map itself is hardcoded reference data (see
``src/extractors/hades1/offer_text.py``) - the tests below cover the
substitution call site that consumes it, plus a couple of sanity
checks on the published map.
"""

from src.lua_parser import LuaParser
from src.extractors.hades1.offer_text import HADES1_OFFER_TEXT_MAP
from src.extractors.textline_set import extract_textline


def parse_tl(lua_text):
    """Parse a small Lua source and return the first top-level value
    (a textline table). Test helper for ``extract_textline`` cases."""
    parsed = LuaParser(lua_text).parse_file()
    name, table = next(iter(parsed.items()))
    return name, table


class TestHades1OfferTextMap:
    def test_covers_all_known_offer_text_speakers(self):
        """Smoke check: every speaker that has at least one vendor/choice
        cue in NPCData.lua surfaces in the map. Catches accidental
        deletions when the map is hand-edited."""
        prefixes = {key.split("_", 1)[0] for key in HADES1_OFFER_TEXT_MAP}
        expected = {
            "Dusa", "Eurydice", "Hermes", "Megaera", "MegaeraWithThanatos",
            "Orpheus", "Patroclus", "Sisyphus", "Thanatos",
        }
        assert expected.issubset(prefixes)

    def test_values_have_no_format_tags(self):
        """All values must be presentation-clean (no ``{#...}`` runtime
        directives) since the viewer renders them as plain text."""
        for key, value in HADES1_OFFER_TEXT_MAP.items():
            assert "{#" not in value, f"{key} contains a format tag: {value!r}"


class TestExtractTextlineOfferTextSubstitution:
    def test_id_text_is_substituted_via_map(self):
        """A cue whose ``Text`` is a literal Id in the offer-text map
        should resolve to the mapped flavour text in dialogueLines."""
        _, tl = parse_tl(
            'Line01 = { '
            '{ Text = "Eurydice_OfferText02", Speaker = "NPC_Eurydice_01" }'
            ' }'
        )
        offer_text_map = {
            "Eurydice_OfferText02": "Eurydice offers several delectable treats.",
        }
        result = extract_textline(
            "Line01", tl, "Fallback", "Test.lua",
            offer_text_map=offer_text_map,
        )
        assert result["dialogueLines"] == [
            {
                "speaker": "NPC_Eurydice_01",
                "text": "Eurydice offers several delectable treats.",
                "textId": "Eurydice_OfferText02",
            }
        ]

    def test_non_id_text_passes_through_unchanged(self):
        """Real voice lines must not be touched even if they happen to
        look identifier-like (no match in the map -> unchanged)."""
        _, tl = parse_tl(
            'Line01 = { '
            '{ Text = "Hello there, stranger.", Speaker = "NPC_X_01" }'
            ' }'
        )
        offer_text_map = {"Eurydice_OfferText02": "should-not-fire"}
        result = extract_textline(
            "Line01", tl, "Fallback", "Test.lua",
            offer_text_map=offer_text_map,
        )
        assert result["dialogueLines"] == [
            {"speaker": "NPC_X_01", "text": "Hello there, stranger."}
        ]

    def test_no_map_supplied_leaves_id_text_as_is(self):
        """Backward compatibility: callers that don't pass a map (e.g.
        unit tests that call ``extract_textline`` directly) must see
        unchanged behaviour."""
        _, tl = parse_tl(
            'Line01 = { '
            '{ Text = "Eurydice_OfferText02", Speaker = "NPC_Eurydice_01" }'
            ' }'
        )
        result = extract_textline("Line01", tl, "Fallback", "Test.lua")
        assert result["dialogueLines"] == [
            {"speaker": "NPC_Eurydice_01", "text": "Eurydice_OfferText02"}
        ]

    def test_empty_map_leaves_text_unchanged(self):
        """Empty map must not accidentally substitute anything - tested
        separately from ``None`` because the two go down different code
        paths in :func:`extract_textline`."""
        _, tl = parse_tl(
            'Line01 = { { Text = "Patroclus_OfferText02", Speaker = "NPC_Patroclus_01" } }'
        )
        result = extract_textline(
            "Line01", tl, "Fallback", "Test.lua",
            offer_text_map={},
        )
        assert result["dialogueLines"] == [
            {"speaker": "NPC_Patroclus_01", "text": "Patroclus_OfferText02"}
        ]

    def test_format_tag_strip_still_runs_for_non_substituted_text(self):
        """Existing format-tag-stripping behaviour must be preserved
        for cues that don't go through the substitution path."""
        _, tl = parse_tl(
            'Line01 = { '
            '{ Text = "{#DialogueItalicFormat}whispered words.", Speaker = "NPC_X_01" }'
            ' }'
        )
        offer_text_map = {"Eurydice_OfferText02": "irrelevant"}
        result = extract_textline(
            "Line01", tl, "Fallback", "Test.lua",
            offer_text_map=offer_text_map,
        )
        assert result["dialogueLines"][0]["text"] == "whispered words."

    def test_published_map_substitutes_real_cue_ids(self):
        """Integration sanity check: passing the published
        :data:`HADES1_OFFER_TEXT_MAP` resolves real cue Ids end-to-end
        (i.e. the wiring + the data agree)."""
        _, tl = parse_tl(
            'Line01 = { '
            '{ Text = "Sisyphus_OfferText01", Speaker = "NPC_Sisyphus_01" }, '
            '{ Text = "Dusa_ChoiceText01", Speaker = "NPC_Dusa_01" }'
            ' }'
        )
        result = extract_textline(
            "Line01", tl, "Fallback", "Test.lua",
            offer_text_map=HADES1_OFFER_TEXT_MAP,
        )
        texts = [line["text"] for line in result["dialogueLines"]]
        assert texts == [
            HADES1_OFFER_TEXT_MAP["Sisyphus_OfferText01"],
            HADES1_OFFER_TEXT_MAP["Dusa_ChoiceText01"],
        ]
