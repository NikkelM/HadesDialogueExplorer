"""Tests for :func:`src.speaker_overview.annotate_speaker_aggregates`.

Builds a small synthetic graph fixture so the assertions are
self-contained and don't depend on the real Hades datasets. Real-data
spot checks live alongside ``test_build_viewer.py`` so they can be
gated independently when the inputs change.
"""

import copy

from src.speaker_overview import (
    annotate_speaker_aggregates,
    _priority_bucket,
)


def _make_graph_data() -> dict:
    """A small but representative speaker graph.

    Three speakers: ``Meg`` (4 textlines, two priority tiers), ``Zag``
    (player character; speaks on Meg's textlines but owns nothing of
    its own to start), and ``Than`` (1 textline that gates on a Meg
    textline). Plus an intentionally-omitted-from-the-speakers-map
    owner ``CharProtag`` to exercise the auto-register fallback.
    """
    return {
        "textlines": {
            "MegHello01": {
                "owner": "Meg",
                "section": "TextLineSet",
                "source": "NPCData",
                "sourceFile": "NPCData.lua",
                "dialogueLines": [
                    {"speaker": "Meg", "text": "Hi."},
                    {"speaker": "Zag", "text": "Yo."},
                ],
                "narrativePrioritySectionTier": "super",
                "narrativePrioritySetLevel": None,
                "requirements": {},
            },
            "MegHello02": {
                "owner": "Meg",
                "section": "TextLineSet",
                "source": "NPCData",
                "sourceFile": "NPCData.lua",
                "dialogueLines": [{"speaker": "Meg", "text": "Hey again."}],
                "narrativePrioritySectionTier": None,
                # set-level elevation: should bucket as 'priority' even
                # though section tier is unset.
                "narrativePrioritySetLevel": "priority",
                "requirements": {},
            },
            "MegGift10": {
                "owner": "Meg",
                "section": "GiftTextLineSets",
                "source": "NPCData",
                "sourceFile": "NPCData.lua",
                "dialogueLines": [{"speaker": "Meg", "text": "Thanks."}],
                # 'low' collapses to 'plain'.
                "narrativePrioritySectionTier": "low",
                "narrativePrioritySetLevel": None,
                "requirements": {},
            },
            "MegInteract01": {
                "owner": "Meg",
                "section": "InteractTextLineSets",
                "source": "EncounterData",
                "sourceFile": "RoomDataTartarus.lua",
                "dialogueLines": [{"speaker": "Meg", "text": "What."}],
                "requirements": {
                    "RequiredTextLines": ["ThanGreets01"],
                },
            },
            "ThanGreets01": {
                "owner": "Than",
                "section": "TextLineSet",
                "source": "NPCData",
                "sourceFile": "NPCData.lua",
                "dialogueLines": [
                    {"speaker": "Than", "text": "Hi Zag."},
                    {"speaker": "Zag", "text": "Hey Than."},
                ],
                "requirements": {
                    "RequiredTextLines": ["MegHello01", "MegHello02"],
                },
            },
            # Auto-register case: this textline's owner is missing from
            # the seed speakers map; the pass should auto-create the
            # entry with a fallback friendly name.
            "ZagSoliloquy01": {
                "owner": "CharProtag",
                "section": "TextLineSet",
                "source": "NPCData",
                "sourceFile": "NPCData.lua",
                "dialogueLines": [{"speaker": "CharProtag", "text": "Hmm."}],
                "requirements": {},
            },
        },
        "dependents": {
            "ThanGreets01": [
                {"name": "MegInteract01", "type": "RequiredTextLines"},
            ],
            "MegHello01": [
                {"name": "ThanGreets01", "type": "RequiredTextLines"},
            ],
            "MegHello02": [
                {"name": "ThanGreets01", "type": "RequiredTextLines"},
            ],
        },
        "speakers": {
            "Meg": {"name": "Megaera", "description": "Fury."},
            "Than": {"name": "Thanatos", "description": "Death."},
            "Zag": {"name": "Zagreus", "description": "Prince."},
        },
    }


def test_owned_textlines_lists_every_owned_name_sorted():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    assert g["speakers"]["Meg"]["ownedTextlines"] == [
        "MegGift10",
        "MegHello01",
        "MegHello02",
        "MegInteract01",
    ]
    assert g["speakers"]["Than"]["ownedTextlines"] == ["ThanGreets01"]
    # Zag owns nothing: as-speaker rolls up below, but ownedTextlines
    # must be present and empty so the viewer can render zero-state
    # without guarding the lookup.
    assert g["speakers"]["Zag"]["ownedTextlines"] == []


def test_as_speaker_excludes_owned_textlines_to_avoid_self_inflation():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    # Zag speaks on MegHello01 + ThanGreets01 + (its own) ZagSoliloquy01,
    # but the own-textline must NOT inflate the as-speaker count.
    assert g["speakers"]["Zag"]["asSpeakerTextlines"] == [
        "MegHello01",
        "ThanGreets01",
    ]
    # Meg only speaks on her own textlines - asSpeaker is empty.
    assert g["speakers"]["Meg"]["asSpeakerTextlines"] == []


def test_section_counts_bucket_by_section_key():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    assert g["speakers"]["Meg"]["sectionCounts"] == {
        "TextLineSet": 2,
        "GiftTextLineSets": 1,
        "InteractTextLineSets": 1,
    }
    assert g["speakers"]["Than"]["sectionCounts"] == {"TextLineSet": 1}


def test_priority_counts_bucket_by_strongest_tier():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    pc = g["speakers"]["Meg"]["priorityCounts"]
    # MegHello01 (super tier) -> super
    # MegHello02 (set-level priority) -> priority
    # MegGift10 (low tier) -> plain
    # MegInteract01 (no priority) -> plain
    assert pc == {"super": 1, "priority": 1, "plain": 2}
    # Always emits all three keys, even at zero, so the viewer
    # filter UI doesn't have to guard every lookup.
    than_pc = g["speakers"]["Than"]["priorityCounts"]
    assert set(than_pc) == {"super", "priority", "plain"}
    assert than_pc == {"super": 0, "priority": 0, "plain": 1}


def test_priority_bucket_helper_treats_h2_ordinal_as_priority():
    # H2 has no super/priority tiers - ordinal-only priority should
    # bucket as 'priority' so the viewer filter UI can still
    # surface "ranked vs unranked".
    assert _priority_bucket(
        {"narrativePriorityOrdinal": 3}
    ) == "priority"
    assert _priority_bucket(
        {"narrativePriorityOrdinal": None}
    ) == "plain"
    # Mixed: an H1-style super tier wins over a bare ordinal.
    assert _priority_bucket(
        {
            "narrativePriorityOrdinal": 3,
            "narrativePrioritySectionTier": "super",
        }
    ) == "super"


def test_unknown_owner_auto_registered_with_fallback_friendly_name():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    # CharProtag wasn't in the seed speakers map. The pass must
    # auto-register it so the dataset stays self-consistent (every
    # owner has a speakers entry and every entry has the aggregate
    # fields).
    cp = g["speakers"]["CharProtag"]
    assert cp["name"] == "CharProtag"
    assert cp["description"] == ""
    assert cp["ownedTextlines"] == ["ZagSoliloquy01"]
    assert cp["priorityCounts"] == {"super": 0, "priority": 0, "plain": 1}


def test_idempotent_under_repeat_application():
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    snapshot = copy.deepcopy(g["speakers"])
    annotate_speaker_aggregates(g)
    assert g["speakers"] == snapshot


def test_missing_speakers_map_is_created_on_demand():
    g = _make_graph_data()
    # Strip the entire speakers map to confirm the pass auto-creates
    # it. Realistic for a corrupted / minimal fixture; the viewer
    # never gets a graph_data without a speakers map in practice but
    # the pass must not crash on one.
    del g["speakers"]
    annotate_speaker_aggregates(g)
    assert "speakers" in g
    # Every owner observed in the textlines map is now registered.
    assert set(g["speakers"]) >= {"Meg", "Than", "Zag", "CharProtag"}


def test_empty_graph_data_does_not_raise():
    g: dict = {"textlines": {}, "dependents": {}, "speakers": {}}
    annotate_speaker_aggregates(g)
    assert g["speakers"] == {}


def test_priority_count_bucket_keys_always_present_in_emitted_order():
    """The viewer's filter UI iterates the bucket keys in a fixed
    order; pin the emit order here so a future dict-ordering change
    doesn't quietly reorder the filter pills."""
    g = _make_graph_data()
    annotate_speaker_aggregates(g)
    pc_keys = list(g["speakers"]["Meg"]["priorityCounts"].keys())
    assert pc_keys == ["super", "priority", "plain"]
