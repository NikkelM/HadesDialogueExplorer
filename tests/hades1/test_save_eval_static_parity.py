"""Parity guard: the H1 save-eval static payload built by
``extract_save_eval_static`` (src/extractors/hades1/save_eval_data.py) must
carry exactly the keys the viewer reads off ``h1SaveEvalStatic`` in
``templates/viewer/gamestate-eval-h1.js``.

This payload is the only cross-language contract between the H1 save
evaluator's static tables (assembled in Python at build time) and their JS
consumer. Renaming or reshaping a key on one side without the other previously
had no CI signal; the H1 weapon-aspect work drifted this way and was only
caught by an unrelated test import. This test fails the moment the emitted key
set and the consumed key set diverge.
"""

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SAVE_EVAL_PY = _ROOT / "src" / "extractors" / "hades1" / "save_eval_data.py"
_EVAL_JS = _ROOT / "templates" / "viewer" / "gamestate-eval-h1.js"


def _python_emitted_keys() -> set:
    """The string keys of the dict returned by ``extract_save_eval_static``."""
    text = _SAVE_EVAL_PY.read_text(encoding="utf-8")
    match = re.search(
        r"def extract_save_eval_static\(.*?\breturn \{(.*?)\n    \}",
        text,
        re.DOTALL,
    )
    assert match, "extract_save_eval_static return dict literal not found"
    return set(re.findall(r'"(\w+)":', match.group(1)))


def _js_consumed_keys() -> set:
    """Property names the viewer reads off the static payload, via the imported
    ``h1SaveEvalStatic`` binding or its local ``sd`` aliases (``const sd =
    h1SaveEvalStatic``). Doc-comment references use the same key names, so they
    must stay current too.
    """
    text = _EVAL_JS.read_text(encoding="utf-8")
    return set(re.findall(r"(?:h1SaveEvalStatic|\bsd)\.(\w+)", text))


def test_h1_save_eval_static_keys_match_js_consumer():
    emitted = _python_emitted_keys()
    consumed = _js_consumed_keys()
    assert emitted, "no keys parsed from extract_save_eval_static"
    assert consumed, "no h1SaveEvalStatic accesses parsed from gamestate-eval-h1.js"
    assert emitted == consumed, (
        "h1SaveEvalStatic key drift between Python and JS.\n"
        f"  emitted by Python but not read by JS: {sorted(emitted - consumed)}\n"
        f"  read by JS but not emitted by Python: {sorted(consumed - emitted)}"
    )
