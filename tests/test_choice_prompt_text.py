"""Tests for ``annotate_choice_prompt_text``: resolving choice-prompt cue
``Text`` ids (Hades II ScreenText references) to their display text."""

from src.choice_prompt_text import annotate_choice_prompt_text

OFFER_MAP = {
    "Choice_NemesisBecomingCloser01": "Stay with Nemesis? (Follow your heart...)",
    "Choice_ErisBecomingCloser01": "Be with Eris? (Follow your heart...)",
}


def _tl(*lines):
    return {"owner": "NPC_Test_01", "requirements": {}, "dialogueLines": list(lines)}


class TestAnnotateChoicePromptText:
    def test_mapped_prompt_id_is_resolved(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl(
                {"speaker": "NPC_Nemesis_01", "text": "Real subtitle here."},
                {"speaker": "NPC_Nemesis_01", "kind": "choicePrompt",
                 "text": "Choice_NemesisBecomingCloser01", "choices": []},
            ),
        })
        annotate_choice_prompt_text(gd, OFFER_MAP)
        lines = gd["textlines"]["A"]["dialogueLines"]
        assert lines[0]["text"] == "Real subtitle here."   # untouched
        assert lines[1]["text"] == "Stay with Nemesis? (Follow your heart...)"
        assert gd["stats"]["choicePromptTextResolved"] == 1

    def test_unmapped_text_is_left_alone(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"text": "Choice_UnknownPrompt99", "kind": "choicePrompt"}),
            "B": _tl({"text": "An ordinary line."}),
        })
        annotate_choice_prompt_text(gd, OFFER_MAP)
        assert gd["textlines"]["A"]["dialogueLines"][0]["text"] == "Choice_UnknownPrompt99"
        assert gd["textlines"]["B"]["dialogueLines"][0]["text"] == "An ordinary line."
        assert gd["stats"]["choicePromptTextResolved"] == 0

    def test_counts_every_occurrence(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"text": "Choice_NemesisBecomingCloser01", "kind": "choicePrompt"}),
            "B": _tl({"text": "Choice_NemesisBecomingCloser01", "kind": "choicePrompt"}),
            "C": _tl({"text": "Choice_ErisBecomingCloser01", "kind": "choicePrompt"}),
        })
        annotate_choice_prompt_text(gd, OFFER_MAP)
        assert gd["stats"]["choicePromptTextResolved"] == 3

    def test_empty_map_is_a_noop(self, make_graph_data):
        gd = make_graph_data(textlines={
            "A": _tl({"text": "Choice_NemesisBecomingCloser01", "kind": "choicePrompt"}),
        })
        annotate_choice_prompt_text(gd, {})
        assert gd["textlines"]["A"]["dialogueLines"][0]["text"] == "Choice_NemesisBecomingCloser01"
        assert gd["stats"]["choicePromptTextResolved"] == 0
