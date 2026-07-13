"""Tests for the build-time dialogue-localisation map generation
(:mod:`src.localization`).

Covers the sjson line-scan reader, text cleaning (tags / escapes / newline
folding), ``InheritFrom`` resolution, used-id collection over the extracted
graph, speaker localisation (qualifier preservation, canonical-id resolution,
masked skip) and the end-to-end ``build_localization`` file emission - all
against small in-memory sjson fixtures written to ``tmp_path``.
"""

import json

from src import localization as loc


# --- text cleaning ---------------------------------------------------

def test_clean_strips_format_and_icon_tags():
    assert loc._clean("{#Emph}Hello{#Prev} there") == "Hello there"
    assert loc._clean("{!Icons.HealthRestore} Healing") == "Healing"
    assert loc._clean("{$Keywords.Boss} X") == "X"


def test_clean_unescapes_brackets_and_folds_newlines():
    # Choice labels wrap the text in escaped brackets.
    assert loc._clean(r"\[ Heilung \]") == "[ Heilung ]"
    # Subtitle line-break escapes collapse to a single space.
    assert loc._clean(r"line one\nline two") == "line one line two"
    assert loc._clean(r"a\n\nb") == "a b"


def test_clean_collapses_whitespace_and_trims():
    assert loc._clean("  spaced   out \n text ") == "spaced out text"


# --- sjson reader ----------------------------------------------------

_SJSON = """{
  lang = "de"
  Texts = [
    {
      Id = "Hades_0089"
      Speaker = "Hades"
      DisplayName = "Geh nur."
    }
    {
      Id = "NPC_Hades_01"
      DisplayName = "Hades"
      Description = "Gott der Toten"
    }
    {
      Id = "Variant_01"
      InheritFrom = "NPC_Hades_01"
    }
  ]
}
"""


def _write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def test_read_sjson_maps_captures_display_desc_inherit(tmp_path):
    p = _write(tmp_path, "_NPCData.de.sjson", _SJSON)
    display, desc, inherit = loc.read_sjson_maps(p)
    assert display["Hades_0089"] == "Geh nur."
    assert display["NPC_Hades_01"] == "Hades"
    assert desc["NPC_Hades_01"] == "Gott der Toten"
    assert inherit["Variant_01"] == "NPC_Hades_01"


def test_read_sjson_maps_missing_file_is_empty(tmp_path):
    display, desc, inherit = loc.read_sjson_maps(tmp_path / "nope.sjson")
    assert display == {} and desc == {} and inherit == {}


_SJSON_TRIPLE = (
    '{\n  Texts = [\n'
    '    {\n      Id = "Quoted_01"\n'
    '      DisplayName = """Perché del \\"nanerottolo\\" mi ferisce. È alto quanto me!"""\n'
    '    }\n'
    '    {\n      Id = "Multi_01"\n'
    '      DisplayName = """Prima riga\n      seconda riga"""\n'
    '    }\n'
    '    {\n      Id = "Normal_01"\n'
    '      DisplayName = "plain value"\n'
    '    }\n'
    '  ]\n}\n'
)


def test_read_sjson_maps_captures_triple_quoted_values(tmp_path):
    """SJSON wraps values containing literal double quotes (or spanning lines) in
    triple quotes; the single-quote regex would capture an empty string and drop
    the translation, so these must be recovered (raw, escapes intact)."""
    p = _write(tmp_path, "_EnemyData.it.sjson", _SJSON_TRIPLE)
    display, _desc, _inh = loc.read_sjson_maps(p)
    # Single-line triple-quote: inner escaped quotes preserved in the raw capture.
    assert display["Quoted_01"] == r'Perché del \"nanerottolo\" mi ferisce. È alto quanto me!'
    # Multi-line triple-quote: body accumulated across lines.
    assert display["Multi_01"] == "Prima riga\n      seconda riga"
    # Normal single-quoted values still work.
    assert display["Normal_01"] == "plain value"


def test_read_lang_text_map_cleans_triple_quoted_values(tmp_path):
    """End-to-end: cleaning unescapes the inner ``\\"`` and folds the multi-line
    body to a single space, so the surfaced translation reads naturally."""
    lang_dir = tmp_path / "it"
    lang_dir.mkdir()
    _write(lang_dir, "_EnemyData.it.sjson", _SJSON_TRIPLE)
    display, _desc = loc._read_lang_text_map(lang_dir)
    assert display["Quoted_01"] == 'Perché del "nanerottolo" mi ferisce. È alto quanto me!'
    assert display["Multi_01"] == "Prima riga seconda riga"


_SJSON_MULTILINE_NORMAL = (
    '{\n  Texts = [\n'
    '    {\n      Id = "Wrapped_01"\n'
    '      DisplayName = "Boss, maybe you thought: {#Italic}Hermes is fast!\n'
    '      {#Prev}I cannot tell you. But know this: I am never late."\n'
    '    }\n'
    '    {\n      Id = "After_01"\n'
    '      DisplayName = "next entry"\n'
    '    }\n'
    '  ]\n}\n'
)


def test_read_sjson_maps_reads_multiline_normal_string(tmp_path):
    """A normal (single-``"``) value can span physical lines - the closing quote
    is on a later line. The naive per-line regex drops it (no closing ``"`` on
    the opening line); the value must be accumulated across lines, and the entry
    after it must still be read correctly."""
    p = _write(tmp_path, "_LootData.ru.sjson", _SJSON_MULTILINE_NORMAL)
    display, _desc, _inh = loc.read_sjson_maps(p)
    assert display["Wrapped_01"] == (
        'Boss, maybe you thought: {#Italic}Hermes is fast!\n'
        '      {#Prev}I cannot tell you. But know this: I am never late.'
    )
    # Parsing the multi-line value must not swallow the following entry.
    assert display["After_01"] == "next entry"


def test_read_lang_text_map_cleans_multiline_normal_string(tmp_path):
    """Cleaning folds the real newline (and the leading indent) to one space and
    strips the format tags, matching how the English inline line renders."""
    lang_dir = tmp_path / "ru"
    lang_dir.mkdir()
    _write(lang_dir, "_LootData.ru.sjson", _SJSON_MULTILINE_NORMAL)
    display, _desc = loc._read_lang_text_map(lang_dir)
    assert display["Wrapped_01"] == "Boss, maybe you thought: Hermes is fast! I cannot tell you. But know this: I am never late."


def test_read_lang_text_map_resolves_inherit_and_cleans(tmp_path):
    lang_dir = tmp_path / "de"
    lang_dir.mkdir()
    _write(lang_dir, "_NPCData.de.sjson", _SJSON)
    display, desc = loc._read_lang_text_map(lang_dir)
    # InheritFrom resolves the variant to its parent's DisplayName.
    assert display["Variant_01"] == "Hades"
    assert display["Hades_0089"] == "Geh nur."


def test_read_lang_text_map_priority_helptext_wins(tmp_path):
    """A HelpText DisplayName wins over a voice-line subtitle reusing the id."""
    lang_dir = tmp_path / "de"
    lang_dir.mkdir()
    _write(lang_dir, "_NPCData.de.sjson",
           '{\n  Texts = [\n    {\n      Id = "Shared"\n      DisplayName = "voice line"\n    }\n  ]\n}\n')
    _write(lang_dir, "HelpText.de.sjson",
           '{\n  Texts = [\n    {\n      Id = "Shared"\n      DisplayName = "canonical"\n    }\n  ]\n}\n')
    display, _ = loc._read_lang_text_map(lang_dir)
    assert display["Shared"] == "canonical"


# --- language discovery ---------------------------------------------

def test_available_languages_excludes_en_and_substitutions(tmp_path):
    for d in ("en", "de", "ja", "substitutions", "zh-CN"):
        (tmp_path / d).mkdir()
    assert loc.available_languages(tmp_path) == ["de", "ja", "zh-CN"]


# --- used-id collection ---------------------------------------------

def test_collect_used_ids_gathers_cue_textid_choice(tmp_path):
    data = {
        "textlines": {
            "A": {
                "dialogueLines": [
                    {"speaker": "NPC_Hades_01", "text": "hi", "cue": "Hades_0001"},
                    {"speaker": "NPC_Zag_01", "text": "prompt", "textId": "Zag_OfferText01",
                     "kind": "choicePrompt",
                     "choices": [{"internal": "Choice_Yes"}, {"internal": "Choice_No"}]},
                    {"kind": "randomGroup", "options": [
                        {"speaker": "S", "text": "r", "cue": "Rand_0001"}]},
                ],
                "endLines": [
                    {"speaker": "NPC_Hades_01", "text": "bye", "cue": "Hades_0009"},
                    {"speaker": "NPC_Hades_01", "cue": "Hades_0010"},
                ],
            }
        }
    }
    p = tmp_path / "hades2_npc.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    text_ids = loc.collect_used_ids([p])
    assert text_ids == {
        "Hades_0001", "Zag_OfferText01", "Choice_Yes", "Choice_No",
        "Rand_0001", "Hades_0009", "Hades_0010",
    }


def test_collect_used_ids_gathers_cuetext_ids(tmp_path):
    # ``cueTexts`` (in the metadata payloads) keys voicelines quoted in
    # "played"-family requirement gates by cue id; those ids must be collected
    # so their subtitle translation ships (the viewer localises the quote).
    meta = {"cueTexts": {
        "HadesField_0584": {"speaker": "Hades", "text": "Do not become too prideful."},
        "ZagreusHome_2930": {"speaker": "Zagreus", "text": "Right, then."},
    }}
    p = tmp_path / "hades1_metadata.json"
    p.write_text(json.dumps(meta), encoding="utf-8")
    text_ids = loc.collect_used_ids([p])
    assert text_ids == {"HadesField_0584", "ZagreusHome_2930"}


# --- speaker localisation -------------------------------------------

def test_localise_speakers_preserves_qualifier_and_resolves_aliases():
    speakers_en = {
        "NPC_Hades_01": {"name": "Hades", "description": "God of the Dead"},
        "NPC_Cerberus_Field_01": {"name": "Cerberus (Field)", "description": "Watchdog"},
        "AphroditeUpgrade": {"name": "Aphrodite", "description": "Goddess of Love"},
        "Hades": {"name": "Hades (Boss)", "description": "God of the Dead"},
        "NPC_Patroclus_Unnamed_01": {"name": "? ? ? (Patroclus)", "description": None},
    }
    display = {
        "NPC_Hades_01": "Hades-DE",
        "NPC_Cerberus_01": "Kerberos",
        "NPC_Aphrodite_01": "Aphrodite-DE",
    }
    desc = {"NPC_Hades_01": "Gott der Toten"}
    out = loc._localise_speakers(speakers_en, display, desc)
    # Base NPC localises name + description.
    assert out["NPC_Hades_01"] == {"name": "Hades-DE", "description": "Gott der Toten"}
    # Variant resolves to its canonical id and keeps the tool qualifier.
    assert out["NPC_Cerberus_Field_01"]["name"] == "Kerberos (Field)"
    # Boon-owner alias -> NPC_<God>_01.
    assert out["AphroditeUpgrade"]["name"] == "Aphrodite-DE"
    # Boss alias -> NPC_Hades_01, qualifier preserved.
    assert out["Hades"]["name"] == "Hades-DE (Boss)"
    # Masked speakers are omitted entirely (kept masked, English fallback).
    assert "NPC_Patroclus_Unnamed_01" not in out


def test_localise_speakers_omits_untranslated():
    speakers_en = {"NPC_Unknown_01": {"name": "Nobody", "description": None}}
    out = loc._localise_speakers(speakers_en, {}, {})
    assert out == {}


def test_localise_speakers_resolves_charprotag_via_playerunit():
    # The protagonist's translated DisplayName is keyed under ``PlayerUnit`` in
    # HelpText, but ``CharProtag`` is the speaker id on most of Zagreus's H1
    # lines. It must alias to PlayerUnit so those lines localise (Russian
    # "Загрей" here) instead of always showing the English "Zagreus".
    assert "PlayerUnit" in list(loc._speaker_lookup_ids("CharProtag"))
    speakers_en = {"CharProtag": {"name": "Zagreus", "description": None}}
    display = {"PlayerUnit": "\u0417\u0430\u0433\u0440\u0435\u0439"}  # Загрей
    out = loc._localise_speakers(speakers_en, display, {})
    assert out.get("CharProtag", {}).get("name") == "\u0417\u0430\u0433\u0440\u0435\u0439"


# --- end-to-end file emission ---------------------------------------

def test_build_localization_emits_filtered_files(tmp_path):
    # Game text root with one non-English language.
    text_root = tmp_path / "Text"
    de = text_root / "de"
    de.mkdir(parents=True)
    (text_root / "en").mkdir()
    _write(de, "_NPCData.de.sjson", _SJSON)
    # Extracted graph referencing one cue + one speaker.
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    graph = {"textlines": {"A": {"dialogueLines": [
        {"speaker": "NPC_Hades_01", "text": "Go.", "cue": "Hades_0089"}]}}}
    gf = out_dir / "hades1_npc.json"
    gf.write_text(json.dumps(graph), encoding="utf-8")

    speakers_en = {"NPC_Hades_01": {"name": "Hades", "description": "God of the Dead"}}
    written = loc.build_localization(text_root, out_dir, "hades1", [gf], speakers_en)
    assert written == ["de"]
    payload = json.loads((out_dir / "loc-hades1-de.json").read_text(encoding="utf-8"))
    assert payload["lang"] == "de"
    # Only the referenced cue id is in the text map (filtered small).
    assert payload["text"] == {"Hades_0089": "Geh nur."}
    assert payload["speakers"]["NPC_Hades_01"]["name"] == "Hades"


def test_build_localization_no_languages(tmp_path):
    text_root = tmp_path / "Text"
    (text_root / "en").mkdir(parents=True)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    written = loc.build_localization(text_root, out_dir, "hades1", [], {})
    assert written == []


def test_build_localization_drops_empty_translations(tmp_path):
    # A subtitle that is blank / pure-markup in this language cleans to an empty
    # string; it must NOT be emitted, or the viewer would render a blank line
    # instead of falling back to the English text.
    text_root = tmp_path / "Text"
    de = text_root / "de"
    de.mkdir(parents=True)
    (text_root / "en").mkdir()
    sjson = """{
  Texts = [
    {
      Id = "Real_0001"
      DisplayName = "Echt."
    }
    {
      Id = "Empty_0001"
      DisplayName = ""
    }
    {
      Id = "Markup_0001"
      DisplayName = "{#Prev}"
    }
  ]
}
"""
    _write(de, "_NPCData.de.sjson", sjson)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    graph = {"textlines": {"A": {"dialogueLines": [
        {"cue": "Real_0001"}, {"cue": "Empty_0001"}, {"cue": "Markup_0001"}]}}}
    gf = out_dir / "hades1_npc.json"
    gf.write_text(json.dumps(graph), encoding="utf-8")

    written = loc.build_localization(text_root, out_dir, "hades1", [gf], {})
    assert written == ["de"]
    payload = json.loads((out_dir / "loc-hades1-de.json").read_text(encoding="utf-8"))
    # Only the non-empty translation survives; empty + pure-markup are dropped.
    assert payload["text"] == {"Real_0001": "Echt."}


# --- Hades 1 subtitle CSVs ------------------------------------------

def test_read_subtitles_map_parses_cue_lines(tmp_path):
    d = tmp_path / "ru"
    d.mkdir()
    # Header row, a real line, an Unused (blank Line) row, and a tagged line.
    csv_text = (
        '"Speaker","ID","ID","ID","","","","Line","","",""\n'
        '"Integrated","HadesField_","0584","HadesField_0584","","","","Do not be prideful, boy.","","",""\n'
        '"Unused","HadesField_","0007","HadesField_0007","","","","","","",""\n'
        '"Darren","Hades_","0002","Hades_0002","","","","{#Prev}Hello there","","",""\n'
    )
    (d / "HadesField.csv").write_text(csv_text, encoding="utf-8")
    m = loc.read_subtitles_map(d)
    assert m["HadesField_0584"] == "Do not be prideful, boy."
    assert "HadesField_0007" not in m           # Unused / blank Line is skipped
    assert m["Hades_0002"] == "Hello there"     # runtime tag stripped by _clean
    # A missing directory (e.g. Hades 2, which has no Subtitles) yields {}.
    assert loc.read_subtitles_map(tmp_path / "nope") == {}


def test_build_localization_fills_missing_cues_from_subtitles_csv(tmp_path):
    # The subtitle CSV supplies a referenced cue the dialogue sjson lacks (the
    # closing / played-gate voicelines that only live in Content/Subtitles).
    content = tmp_path / "Content"
    text_root = content / "Game" / "Text"
    de = text_root / "de"
    de.mkdir(parents=True)
    (text_root / "en").mkdir()
    _write(de, "_NPCData.de.sjson", _SJSON)  # sjson translates Hades_0089
    sub_de = content / "Subtitles" / "de"
    sub_de.mkdir(parents=True)
    (sub_de / "Hades.csv").write_text(
        '"Speaker","ID","ID","ID","","","","Line","","",""\n'
        '"Integrated","Hades_","1101","Hades_1101","","","","Nur aus dem Untergrund.","","",""\n',
        encoding="utf-8")
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    graph = {"textlines": {"A": {"dialogueLines": [
        {"speaker": "NPC_Hades_01", "text": "Go.", "cue": "Hades_0089"},
        {"speaker": "NPC_Hades_01", "text": "Only from below.", "cue": "Hades_1101"}]}}}
    gf = out_dir / "hades1_npc.json"
    gf.write_text(json.dumps(graph), encoding="utf-8")

    written = loc.build_localization(text_root, out_dir, "hades1", [gf], {"NPC_Hades_01": {"name": "Hades"}})
    assert written == ["de"]
    payload = json.loads((out_dir / "loc-hades1-de.json").read_text(encoding="utf-8"))
    # The sjson cue AND the CSV-filled cue are both translated.
    assert payload["text"]["Hades_0089"] == "Geh nur."       # from sjson
    assert payload["text"]["Hades_1101"] == "Nur aus dem Untergrund."  # from CSV


def test_build_localization_prefers_sjson_over_csv(tmp_path):
    # When both sources translate a cue, the sjson wins (it's what we've always
    # shipped and matches the inline English); the CSV only fills gaps.
    content = tmp_path / "Content"
    text_root = content / "Game" / "Text"
    de = text_root / "de"
    de.mkdir(parents=True)
    (text_root / "en").mkdir()
    _write(de, "_NPCData.de.sjson", _SJSON)  # Hades_0089 -> "Geh nur."
    sub_de = content / "Subtitles" / "de"
    sub_de.mkdir(parents=True)
    (sub_de / "Hades.csv").write_text(
        '"Integrated","Hades_","0089","Hades_0089","","","","CSV-Variante.","","",""\n',
        encoding="utf-8")
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    graph = {"textlines": {"A": {"dialogueLines": [
        {"speaker": "NPC_Hades_01", "text": "Go.", "cue": "Hades_0089"}]}}}
    gf = out_dir / "hades1_npc.json"
    gf.write_text(json.dumps(graph), encoding="utf-8")
    loc.build_localization(text_root, out_dir, "hades1", [gf], {"NPC_Hades_01": {"name": "Hades"}})
    payload = json.loads((out_dir / "loc-hades1-de.json").read_text(encoding="utf-8"))
    assert payload["text"]["Hades_0089"] == "Geh nur."  # sjson, not "CSV-Variante."
