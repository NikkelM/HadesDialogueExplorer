"""Tests for the dropped-eligibility-gate audit in
:mod:`src.extractors.textline_set`.

``extract_textline``'s flat requirement loop only captures ``Require*``-prefixed
gates (plus the count fields), so a Hades 1 engine eligibility field that uses
neither convention - e.g. ``ConsecutiveClearsOfRoom`` - would be dropped with no
trace. The audit records any such known gate present-but-unsurfaced so the build
can warn instead of silently losing it. These tests pin that behaviour and guard
against the audit either going silent (a real gate slipping through) or firing on
the many benign H1 presentation fields.
"""

from src.lua_parser import LuaParser
from src.extractors.textline_set import (
    extract_textline,
    reset_unrecognised_textline_key_audit,
    get_unrecognised_textline_keys,
    HADES1_NON_PREFIX_ELIGIBILITY_FIELDS,
)


def _parse_tl(lua_text):
    parsed = LuaParser(f"T = {lua_text}").parse_file()
    return parsed["T"]


class TestDroppedEligibilityAudit:
    def test_records_non_prefix_eligibility_field(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveClearsOfRoom = { Name = "B_Boss01", Count = 1 } }')
        data = extract_textline("FuryWinStreak02", tl, "NPC_X_01", "EnemyData.lua")
        # The gate is dropped from the surfaced requirements ...
        assert "ConsecutiveClearsOfRoom" not in data["requirements"]
        assert "ConsecutiveClearsOfRoom" not in data["otherRequirements"]
        # ... but the audit records it so the build can warn.
        assert get_unrecognised_textline_keys() == [
            ("FuryWinStreak02", "ConsecutiveClearsOfRoom", "EnemyData.lua")
        ]

    def test_ignores_presentation_fields(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ TeleportToId = 1, StatusAnimation = "Idle", InteractDistance = 50 }')
        extract_textline("SomeLine01", tl, "NPC_X_01", "NPCData.lua")
        # Presentation / interaction fields are not eligibility gates -> not flagged.
        assert get_unrecognised_textline_keys() == []

    def test_surfaced_require_gate_not_flagged(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ RequiredKills = { "Foo" } }')
        data = extract_textline("Line01", tl, "NPC_X_01", "NPCData.lua")
        assert "RequiredKills" in data["otherRequirements"]
        assert get_unrecognised_textline_keys() == []

    def test_reset_clears_records(self):
        reset_unrecognised_textline_key_audit()
        tl = _parse_tl('{ ConsecutiveDeathsInRoom = { Name = "B_Boss01", Count = 1 } }')
        extract_textline("DusaAboutPressure01", tl, "NPC_X_01", "NPCData.lua")
        assert len(get_unrecognised_textline_keys()) == 1
        reset_unrecognised_textline_key_audit()
        assert get_unrecognised_textline_keys() == []

    def test_field_set_excludes_flags_and_prefixed_gates(self):
        # The set is exactly the non-``Require`` eligibility fields; flags handled
        # elsewhere and the ``Require*`` gates the loop already captures stay out.
        assert "ConsecutiveClearsOfRoom" in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
        assert "HasTraitNameInRoom" in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
        for excluded in ("Force", "Skip", "ChanceToPlay", "RequiredKills", "PlayOnce"):
            assert excluded not in HADES1_NON_PREFIX_ELIGIBILITY_FIELDS
