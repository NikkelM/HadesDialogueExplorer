"""Tests for capturing Hades 1 non-``Require`` eligibility gates and the
regression audit that guards them.

``extract_textline``'s flat requirement loop keys off the ``Require*`` prefix, so
H1 engine eligibility fields that use neither that prefix nor the count-field
naming (``ConsecutiveClearsOfRoom``, ``HasTraitNameInRoom``, ...) were historically
dropped with no trace. They are now captured as ``otherRequirements`` from the
curated :data:`HADES1_NON_PREFIX_ELIGIBILITY_FIELDS` set, and a build audit guards
against a regression that stops surfacing them. These tests pin both halves.
"""

from src.lua_parser import LuaParser
from src.extractors.textline_set import (
    extract_textline,
    reset_unrecognised_textline_key_audit,
    get_unrecognised_textline_keys,
    _note_unrecognised_textline_keys,
    HADES1_NON_PREFIX_ELIGIBILITY_FIELDS,
)


def _parse_tl(lua_text):
    parsed = LuaParser(f"T = {lua_text}").parse_file()
    return parsed["T"]


class TestCaptureNonPrefixEligibility:
    def test_consecutive_clears_captured_as_other_requirement(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveClearsOfRoom = { Name = "B_Boss01", Count = 3 } }')
        data = extract_textline("FuryWinStreak02", tl, "NPC_X_01", "EnemyData.lua")
        # Surfaced as a non-textline gate ...
        assert data["otherRequirements"]["ConsecutiveClearsOfRoom"] == {
            "Name": "B_Boss01", "Count": 3,
        }
        # ... so the audit has nothing to flag (the gate is no longer dropped).
        assert get_unrecognised_textline_keys() == []

    def test_scalar_and_string_gates_captured(self):
        tl = _parse_tl('{ IsIdAlive = 427173, HasTraitNameInRoom = "SomeTrait" }')
        data = extract_textline("Line01", tl, "NPC_X_01", "NPCData.lua")
        assert data["otherRequirements"]["IsIdAlive"] == 427173
        assert data["otherRequirements"]["HasTraitNameInRoom"] == "SomeTrait"

    def test_require_prefixed_gate_still_captured(self):
        tl = _parse_tl('{ RequiredKills = { "Foo" } }')
        data = extract_textline("Line01", tl, "NPC_X_01", "NPCData.lua")
        assert "RequiredKills" in data["otherRequirements"]

    def test_presentation_fields_are_not_captured(self):
        tl = _parse_tl('{ TeleportToId = 1, StatusAnimation = "Idle", InteractDistance = 50 }')
        data = extract_textline("SomeLine01", tl, "NPC_X_01", "NPCData.lua")
        # Presentation / interaction fields are not eligibility gates.
        assert data["otherRequirements"] == {}


class TestDroppedEligibilityAuditGuard:
    """The audit fires only if a known eligibility field is present but NOT
    surfaced - i.e. a regression that stops the capture above. Tested directly so
    the guard is exercised even though the live extractor now always surfaces."""

    def test_flags_an_uncaptured_eligibility_field(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveDeathsInRoom = { Name = "B_Boss01", Count = 1 } }')
        # surfaced = empty -> simulate the capture branch having been removed.
        _note_unrecognised_textline_keys("DusaAboutPressure01", tl, set(), "NPCData.lua")
        assert get_unrecognised_textline_keys() == [
            ("DusaAboutPressure01", "ConsecutiveDeathsInRoom", "NPCData.lua")
        ]

    def test_silent_when_field_is_surfaced(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveDeathsInRoom = { Name = "B_Boss01", Count = 1 } }')
        _note_unrecognised_textline_keys(
            "DusaAboutPressure01", tl, {"ConsecutiveDeathsInRoom"}, "NPCData.lua")
        assert get_unrecognised_textline_keys() == []

    def test_ignores_presentation_fields(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ TeleportToId = 1, StatusAnimation = "Idle" }')
        _note_unrecognised_textline_keys("Line01", tl, set(), "NPCData.lua")
        assert get_unrecognised_textline_keys() == []

    def test_reset_clears_records(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveDeathsInRoom = { Name = "B_Boss01", Count = 1 } }')
        _note_unrecognised_textline_keys("DusaAboutPressure01", tl, set(), "NPCData.lua")
        assert len(get_unrecognised_textline_keys()) == 1
        reset_unrecognised_textline_key_audit()
        assert get_unrecognised_textline_keys() == []

    def test_field_set_excludes_flags_and_prefixed_gates(self):
        assert "ConsecutiveClearsOfRoom" in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
        assert "HasTraitNameInRoom" in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
        for excluded in ("Force", "Skip", "ChanceToPlay", "RequiredKills", "PlayOnce"):
            assert excluded not in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
