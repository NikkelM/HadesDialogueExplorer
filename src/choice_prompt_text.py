"""Resolve choice-prompt cue ``Text`` ids to their display text (Hades II).

Some H2 choice-prompt cues store their visible question as a
``ScreenText.en.sjson`` identifier rather than inline subtitle text (the
romance "Becoming Closer" prompts; see
:data:`src.extractors.hades2.offer_text.HADES2_OFFER_TEXT_MAP`). The H1
pipeline resolves the equivalent ``MiscText`` ids at extraction time; H2's
extractor leaves the id in ``dialogueLines[*].text``, so this post-merge step
substitutes the display text instead.

Run post-merge (so it sees each textline's final, merged ``dialogueLines``)
and applied to the *whole* line set: the map is the gate, so only the handful
of cues whose ``text`` is a known prompt id are rewritten - everything else,
in either game, is left untouched. Resolving the canonical ``text`` here means
both the dialogue panel and the text search index pick up the readable
question.
"""


def annotate_choice_prompt_text(graph_data: dict, offer_text_map: dict) -> None:
    """Replace any dialogue-line ``text`` that is a key in ``offer_text_map``
    with its resolved display text. Mutates ``graph_data`` in place and
    records ``stats.choicePromptTextResolved`` (the number rewritten).
    """
    resolved = 0
    if offer_text_map:
        for tl in graph_data.get("textlines", {}).values():
            for line in tl.get("dialogueLines") or []:
                key = line.get("text")
                display = offer_text_map.get(key)
                if display is not None:
                    # Retain the original ScreenText/MiscText id as the
                    # localisation key before overwriting with English display
                    # text, so the viewer can re-resolve it per language.
                    line["textId"] = key
                    line["text"] = display
                    resolved += 1
    graph_data.setdefault("stats", {})["choicePromptTextResolved"] = resolved
    if resolved:
        print(f"INFO: resolved {resolved} choice-prompt cue text id(s) to display text.")
