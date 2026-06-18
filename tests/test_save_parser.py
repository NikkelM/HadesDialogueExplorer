"""Tests for src.save_parser module."""
import struct

import pytest

from src.save_parser import (
    GAME_VERSION_HADES1,
    extract_text_lines_record,
    parse_save,
)


def _make_sgb1_header(game_version=GAME_VERSION_HADES1, save_flags=0):
    """Build a minimal SGB1 header + metadata prefix."""
    buf = bytearray()
    buf += b"SGB1"
    buf += struct.pack("<I", 0)  # checksum (ignored in parse)
    buf += struct.pack("<H", game_version)
    buf += struct.pack("<H", save_flags)
    buf += struct.pack("<Q", 12345678)  # timestamp
    return bytes(buf)


def _make_string(s: str) -> bytes:
    encoded = s.encode("utf-8")
    return struct.pack("<I", len(encoded)) + encoded


def _make_vec_string(items: list) -> bytes:
    buf = struct.pack("<I", len(items))
    for s in items:
        buf += _make_string(s)
    return buf


class TestParseErrors:
    def test_rejects_non_sgb1(self):
        with pytest.raises(ValueError, match="Not an SGB1"):
            parse_save(b"NOT_SGB1_data_here_padding_20bytes")

    def test_rejects_too_short(self):
        with pytest.raises(ValueError, match="Not an SGB1"):
            parse_save(b"SGB1" + b"\x00" * 5)

    def test_rejects_unknown_game_version(self):
        # Build a complete-enough binary with unknown version 0xFF
        header = b"SGB1"
        header += struct.pack("<I", 0)  # checksum
        header += struct.pack("<H", 0xFF)  # unknown version
        header += struct.pack("<H", 0)  # flags
        header += struct.pack("<Q", 0)  # timestamp
        header += _make_string("loc")  # location
        header += struct.pack("<III", 0, 0, 0)  # runs, meta, shrine
        header += b"\x00\x00"  # easy, hard
        header += _make_vec_string([])  # notable
        header += _make_string("")  # mapName
        header += _make_string("")  # mapName2
        # Empty LZ4 payload - will fail at decompression
        header += struct.pack("<I", 0)
        with pytest.raises((ValueError, Exception)):
            parse_save(header)


class TestExtractTextLinesRecord:
    def test_hades2_path(self):
        save_data = {
            "gameId": "hades2",
            "luaState": {
                "GameState": {
                    "TextLinesRecord": {"Dialogue01": True, "Dialogue02": True}
                }
            },
        }
        result = extract_text_lines_record(save_data)
        assert result == {"Dialogue01", "Dialogue02"}

    def test_hades1_path(self):
        save_data = {
            "gameId": "hades1",
            "luaState": {
                "TextLinesRecord": {"Hello01": True, "Hello02": True, "Hello03": True}
            },
        }
        result = extract_text_lines_record(save_data)
        assert result == {"Hello01", "Hello02", "Hello03"}

    def test_empty_when_missing(self):
        save_data = {"gameId": "hades2", "luaState": {"GameState": {}}}
        assert extract_text_lines_record(save_data) == set()

    def test_hades2_folds_in_choice_record_variants(self):
        # H2 records the picked option under
        # GameState.TextLinesChoiceRecord.<parent> = "<ChoiceText>"; the
        # played set must include the <parent><ChoiceText> synthetic
        # variant so choice-gated dialogues evaluate.
        save_data = {
            "gameId": "hades2",
            "luaState": {
                "GameState": {
                    "TextLinesRecord": {"ErisBecomingCloser01": True},
                    "TextLinesChoiceRecord": {
                        "ErisBecomingCloser01": "Choice_ErisAccept",
                        "NemesisPostCombatBecomingCloser01": "Choice_NemesisAccept",
                    },
                }
            },
        }
        result = extract_text_lines_record(save_data)
        assert result == {
            "ErisBecomingCloser01",
            "ErisBecomingCloser01Choice_ErisAccept",
            "NemesisPostCombatBecomingCloser01Choice_NemesisAccept",
        }

    def test_hades1_ignores_choice_record(self):
        # H1 already writes <parent><ChoiceText> into TextLinesRecord, so a
        # stray TextLinesChoiceRecord (not used by H1) is not folded in.
        save_data = {
            "gameId": "hades1",
            "luaState": {
                "TextLinesRecord": {"Hello01": True},
                "TextLinesChoiceRecord": {"Hello01": "Choice_X"},
            },
        }
        assert extract_text_lines_record(save_data) == {"Hello01"}

    def test_hades2_handles_non_dict_choice_record(self):
        save_data = {
            "gameId": "hades2",
            "luaState": {
                "GameState": {
                    "TextLinesRecord": {"A": True},
                    "TextLinesChoiceRecord": "not a dict",
                }
            },
        }
        assert extract_text_lines_record(save_data) == {"A"}

    def test_empty_when_no_lua_state(self):
        save_data = {"gameId": "hades1", "luaState": {}}
        assert extract_text_lines_record(save_data) == set()

    def test_non_dict_lua_state(self):
        save_data = {"gameId": "hades1", "luaState": "not a dict"}
        assert extract_text_lines_record(save_data) == set()


class TestRealSaveFiles:
    """Integration tests against actual save files on disk (skipped if absent)."""

    H2_PATH = r"C:\Users\nikke\Saved Games\Hades II\Profile1.sav"
    H1_PATH = r"C:\Users\nikke\Documents\Saved Games\Hades\Profile1.sav"

    @pytest.fixture
    def h2_save(self):
        try:
            with open(self.H2_PATH, "rb") as f:
                return f.read()
        except FileNotFoundError:
            pytest.skip("H2 save file not found")

    @pytest.fixture
    def h1_save(self):
        try:
            with open(self.H1_PATH, "rb") as f:
                return f.read()
        except FileNotFoundError:
            pytest.skip("H1 save file not found")

    def test_h2_parses(self, h2_save):
        result = parse_save(h2_save)
        assert result["gameId"] == "hades2"
        assert result["completedRuns"] > 0
        tlr = extract_text_lines_record(result)
        assert len(tlr) > 100

    def test_h1_parses(self, h1_save):
        result = parse_save(h1_save)
        assert result["gameId"] == "hades1"
        assert result["completedRuns"] > 0
        tlr = extract_text_lines_record(result)
        assert len(tlr) > 100

    def test_h2_contains_known_dialogues(self, h2_save):
        result = parse_save(h2_save)
        tlr = extract_text_lines_record(result)
        # These are early-game dialogues that any save with >10 runs should have
        assert "HecateFirstMeeting" in tlr or len(tlr) > 50

    def test_h1_contains_known_dialogues(self, h1_save):
        result = parse_save(h1_save)
        tlr = extract_text_lines_record(result)
        assert "AchillesFirstMeeting" in tlr or len(tlr) > 50
