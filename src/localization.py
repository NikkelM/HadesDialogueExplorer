"""Build-time dialogue localisation map generation.

The games ship every spoken line, choice label and character name translated
into 11 (Hades) / 15 (Hades II) languages under ``Content/Game/Text/<lang>/``.
Each translated entry is keyed by the same id the viewer already retains:

  * dialogue / closing lines -> the trimmed voice cue id (``line.cue``); the
    per-language ``_NPCData*`` / ``_EnemyData*`` / ``_LootData*`` /
    ``_DeathLoopData*`` / ``_RoomData*`` / ``_EncounterData*`` sjson keys each
    line by ``Id`` (== the cue id) with the translation in ``DisplayName``.
  * offer / choice-prompt lines -> the MiscText / ScreenText id (``line.textId``).
  * choice option labels -> the ``ChoiceText`` id (``choice.internal``).
  * speaker names + descriptions -> ``HelpText`` ``DisplayName`` / ``Description``
    keyed by the character id.

This module reads those sjson files (a line-scan mirroring
``scripts/gen_entity_names.py``, since SGG's sjson is regular enough that a full
parser is unnecessary here) and emits one ``loc-<game>-<lang>.json`` per language
containing only the ids the current build actually references, so each file
stays small. English is never emitted: it is the inline default in the base data.

Generated locally (the game text folders are not available in CI) into
``outputs/`` alongside the extracted graph data, then baked into ``dist/`` by
``build_viewer.py``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

# Runtime markup that never belongs in displayed text: ``{#Format}`` colour /
# emphasis tags, ``{$Macro.Ref}`` substitutions, ``{!Icons.X}`` glyphs.
_TAG_RE = re.compile(r"\{[^}]*\}")
# SGG escapes literal brackets/braces in sjson strings (choice labels wrap the
# text in ``\[ ... \]``); unescape them so the label reads naturally.
_ESCAPED_PUNCT_RE = re.compile(r"\\([\[\]{}])")
_WS_RE = re.compile(r"\s+")

_ID_RE = re.compile(r'^\s*Id\s*=\s*"((?:[^"\\]|\\.)*)"')
_DISPLAY_NAME_RE = re.compile(r'^\s*DisplayName\s*=\s*"((?:[^"\\]|\\.)*)"')
_DESCRIPTION_RE = re.compile(r'^\s*Description\s*=\s*"((?:[^"\\]|\\.)*)"')
_INHERIT_RE = re.compile(r'^\s*InheritFrom\s*=\s*"((?:[^"\\]|\\.)*)"')

# The dialogue-bearing sjson prefixes (per language). HelpText / MiscText /
# ScreenText are read separately (speaker names + choice/offer labels).
_DIALOGUE_PREFIXES = (
    "_NPCData", "_EnemyData", "_LootData", "_DeathLoopData",
    "_RoomData", "_EncounterData", "_HeroData", "_QuestData",
)

# Trailing narrative-context qualifier the tool appends to a speaker display
# name (``Hades (Boss)``, ``Cerberus (Field)``, ``? ? ? (Chaos)``). Localisation
# translates the base character name and re-appends this tool-authored suffix.
_QUALIFIER_RE = re.compile(r"\s*(\([^)]*\))\s*$")

# Speaker-id variants that share a canonical HelpText character entry:
# ``NPC_Cerberus_Field_01`` / ``NPC_Persephone_Home_01`` -> ``NPC_<X>_01``.
_SPEAKER_VARIANT_RE = re.compile(
    r"^(NPC_[A-Za-z]+)_(?:Field|Home|Story|Unnamed|Palace|Past)_(\d+)$")
# God boon-offer owners (``AphroditeUpgrade`` / ``HermesUpgradeRare``) are the
# same character as the ``NPC_<God>_01`` speaker.
_SPEAKER_UPGRADE_RE = re.compile(r"^([A-Z][a-z]+)Upgrade(?:Rare)?$")
# Enemy / boss / alias speaker ids whose HelpText character id isn't derivable
# by rule.
_SPEAKER_ID_ALIASES = {
    "Hades": "NPC_Hades_01", "Charon": "NPC_Charon_01",
    "Harpy": "NPC_FurySister_01", "Harpy2": "NPC_FurySister_02",
    "Harpy3": "NPC_FurySister_03", "TrainingMelee": "NPC_Skelly_01",
    "SkellyBackstory": "NPC_Skelly_01",
    # The protagonist's translated DisplayName is keyed under ``PlayerUnit`` /
    # ``PlayerUnit_Intro`` in HelpText, NOT ``CharProtag`` - yet ``CharProtag``
    # is the speaker id on the vast majority of Zagreus's H1 lines (~2700 of
    # them). Alias it to ``PlayerUnit`` so those lines localise instead of always
    # showing the English "Zagreus" (only visible in transliterating languages -
    # e.g. Russian "Загрей" - since it stays "Zagreus" in Latin scripts).
    "CharProtag": "PlayerUnit",
    "TrialUpgrade": "NPC_Chaos_01", "ChaosUpgrade": "NPC_Chaos_01",
}


def _speaker_lookup_ids(sid: str):
    """Yield candidate HelpText ids for a speaker id, most specific first."""
    yield sid
    if sid in _SPEAKER_ID_ALIASES:
        yield _SPEAKER_ID_ALIASES[sid]
    m = _SPEAKER_VARIANT_RE.match(sid)
    if m:
        yield f"{m.group(1)}_{m.group(2)}"
    m = _SPEAKER_UPGRADE_RE.match(sid)
    if m:
        yield f"NPC_{m.group(1)}_01"


def _clean(raw: str) -> str:
    """Strip runtime markup, unescape literal punctuation, collapse whitespace."""
    s = _TAG_RE.sub("", raw)
    s = _ESCAPED_PUNCT_RE.sub(r"\1", s)
    # Subtitle line-break / tab escapes (SGG uses ``\n`` for manual wraps, common
    # in the CJK translations) -> a space; the final whitespace collapse then
    # matches how the inline-English lines render (real newlines fold to a space
    # in HTML). These are literal two-char ``\n`` sequences, not real newlines,
    # so the ``\s`` collapse below would not otherwise catch them.
    s = s.replace("\\n", " ").replace("\\r", " ").replace("\\t", " ")
    s = s.replace('\\"', '"').replace("\\\\", "\\")
    return _WS_RE.sub(" ", s).strip()


def read_sjson_maps(path: Path) -> tuple[dict, dict, dict]:
    """Scan one sjson text file, returning ``(raw_display, raw_desc, inherit)``.

    Entries list ``Id`` first, then ``DisplayName`` / ``Description`` /
    ``InheritFrom`` within the block, so the most-recent ``Id`` owns them. Values
    are the *raw* (un-cleaned) capture so ``InheritFrom`` can be resolved before
    cleaning. The first definition of an id wins.
    """
    raw_display: dict = {}
    raw_desc: dict = {}
    inherit: dict = {}
    if not path.exists():
        return raw_display, raw_desc, inherit
    pending = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _ID_RE.match(line)
        if m:
            pending = m.group(1)
            continue
        if pending is None:
            continue
        m = _DISPLAY_NAME_RE.match(line)
        if m:
            raw_display.setdefault(pending, m.group(1))
            continue
        m = _DESCRIPTION_RE.match(line)
        if m:
            raw_desc.setdefault(pending, m.group(1))
            continue
        m = _INHERIT_RE.match(line)
        if m:
            inherit.setdefault(pending, m.group(1))
    return raw_display, raw_desc, inherit


def _resolve_display(rid, raw_display, inherit, _seen=None):
    """Resolve an id's DisplayName, following ``InheritFrom`` when it has none."""
    if _seen is None:
        _seen = set()
    if rid in _seen:
        return None
    _seen.add(rid)
    dn = raw_display.get(rid)
    if dn is not None:
        return dn
    parent = inherit.get(rid)
    return _resolve_display(parent, raw_display, inherit, _seen) if parent else None


def _lang_dir(text_root: Path, lang: str) -> Path:
    return text_root / lang


def available_languages(text_root: Path) -> list[str]:
    """Language codes present under ``Game/Text`` (excluding ``en`` and the
    non-language ``substitutions`` helper folder), sorted."""
    if not text_root.exists():
        return []
    skip = {"en", "substitutions"}
    langs = [d.name for d in text_root.iterdir() if d.is_dir() and d.name not in skip]
    return sorted(langs)


def _read_lang_text_map(lang_dir: Path) -> tuple[dict, dict]:
    """Merge every ``*.sjson`` in a language dir into ``(display, desc)`` maps of
    ``{Id: cleaned text}``. HelpText / MiscText / ScreenText are scanned first so
    a canonical name wins over any voice-line subtitle that reuses the id."""
    raw_display: dict = {}
    raw_desc: dict = {}
    inherit: dict = {}
    files = sorted(lang_dir.glob("*.sjson"))
    pri = [f for f in files if f.name.split(".")[0] in ("HelpText", "TraitText", "MiscText", "ScreenText")]
    rest = [f for f in files if f not in pri]
    for f in pri + rest:
        d, desc, inh = read_sjson_maps(f)
        for k, v in d.items():
            raw_display.setdefault(k, v)
        for k, v in desc.items():
            raw_desc.setdefault(k, v)
        for k, v in inh.items():
            inherit.setdefault(k, v)
    display = {}
    for rid in raw_display.keys() | inherit.keys():
        resolved = _resolve_display(rid, raw_display, inherit)
        if resolved is not None:
            display[rid] = _clean(resolved)
    desc = {rid: _clean(v) for rid, v in raw_desc.items()}
    return display, desc


def collect_used_ids(output_files: list[Path]) -> tuple[set, set]:
    """Walk a game's per-source output JSONs, returning ``(text_ids, speaker_ids)``:

    * ``text_ids`` - every id the viewer can swap for a translation: dialogue /
      closing cue ids (``line.cue``), offer / choice-prompt ids (``line.textId``)
      and choice option label ids (``choice.internal``).
    * ``speaker_ids`` - every speaker id referenced by a line (for name lookup).
    """
    text_ids: set = set()
    speaker_ids: set = set()

    def _visit_line(line):
        if not isinstance(line, dict):
            return
        if isinstance(line.get("cue"), str):
            text_ids.add(line["cue"])
        if isinstance(line.get("textId"), str):
            text_ids.add(line["textId"])
        if isinstance(line.get("speaker"), str):
            speaker_ids.add(line["speaker"])
        for opt in (line.get("choices") or []):
            if isinstance(opt, dict) and isinstance(opt.get("internal"), str):
                text_ids.add(opt["internal"])
        # randomGroup nests its lines under ``options``.
        for opt in (line.get("options") or []):
            _visit_line(opt)

    for path in output_files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for tl in (data.get("textlines") or {}).values():
            for line in (tl.get("dialogueLines") or []):
                _visit_line(line)
            for line in (tl.get("endLines") or []):
                _visit_line(line)
    return text_ids, speaker_ids


def _localise_speakers(speakers_en: dict, display: dict, desc: dict) -> dict:
    """Build ``{speakerId: {name, description}}`` for one language.

    The tool's English display name bakes in a narrative-context qualifier
    (``(Field)`` / ``(Boss)`` / ``? ? ? (X)``); only the base character name is
    translated (via ``HelpText`` ``DisplayName`` keyed by the speaker's canonical
    id - see :func:`_speaker_lookup_ids`), then the tool qualifier is re-appended.
    Description is the localised ``HelpText`` ``Description``. Speakers whose base
    name has no translation, and masked (``? ? ?``) speakers, are omitted (the
    viewer falls back to the English base).
    """
    out = {}
    for sid, meta in speakers_en.items():
        en_name = meta.get("name") or ""
        # Masked speakers keep their ``? ? ?`` cover unlocalised.
        if en_name.startswith("?"):
            continue
        loc_name = loc_desc = None
        for lookup in _speaker_lookup_ids(sid):
            if loc_name is None and display.get(lookup):
                loc_name = display[lookup]
            if loc_desc is None and desc.get(lookup):
                loc_desc = desc[lookup]
            if loc_name is not None and loc_desc is not None:
                break
        entry = {}
        if loc_name:
            qm = _QUALIFIER_RE.search(en_name)
            qualifier = qm.group(1) if qm else ""
            entry["name"] = f"{loc_name} {qualifier}" if qualifier else loc_name
        if loc_desc:
            entry["description"] = loc_desc
        if entry:
            out[sid] = entry
    return out


def build_localization(text_root: Path, output_dir: Path, game: str,
                       output_files: list[Path], speakers_en: dict) -> list[str]:
    """Generate ``loc-<game>-<lang>.json`` for every non-English language.

    Returns the list of language codes written.
    """
    text_ids, _speaker_ids = collect_used_ids(output_files)
    langs = available_languages(text_root)
    written = []
    for lang in langs:
        display, desc = _read_lang_text_map(_lang_dir(text_root, lang))
        if not display:
            continue
        # Drop ids whose translation cleaned to empty (blank / pure-markup
        # subtitles in this language): an empty value would otherwise render as
        # a blank line in the viewer instead of falling back to the English
        # text. Absent == untranslated == English fallback (+ the EN marker).
        text_map = {tid: display[tid] for tid in text_ids if display.get(tid)}
        speakers = _localise_speakers(speakers_en, display, desc)
        payload = {"lang": lang, "text": text_map, "speakers": speakers}
        out_path = output_dir / f"loc-{game}-{lang}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
            f.write("\n")
        written.append(lang)
    return written
