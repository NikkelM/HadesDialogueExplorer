"""Eligibility tracer API for coding agents.

Accepts a save file + dialogue name and returns a structured JSON result
showing which prerequisite chains are still needed for that dialogue to
become eligible.

Usage (CLI):
    python api.py check <save_file> <dialogue_name> [--game hades1|hades2]

Usage (HTTP server):
    python api.py serve [--port 8081]

    POST /eligibility
    Content-Type: multipart/form-data
    Fields: save (file), dialogue (string), game (optional: hades1|hades2)

    Returns JSON:
    {
      "dialogue": "OrpheusSingsAgain02",
      "game": "hades1",
      "status": "blocked" | "eligible" | "played",
      "totalPrereqs": 24,
      "playedPrereqs": 20,
      "unplayedPrereqs": 4,
      "unplayed": [
        {
          "name": "OrpheusTallTale06",
          "owner": "NPC_Orpheus_01",
          "depth": 1,
          "reqTypes": ["RequiredTextLines"],
          "neededBy": ["OrpheusSingsAgain02"]
        }
      ],
      "tree": { ... nested structure ... }
    }

Requires: lz4, luabins-py (pip install lz4 luabins-py)
"""
import argparse
import json
import re
import sys
from pathlib import Path

from src.save_parser import parse_save, extract_text_lines_record
from src.extractors.textline_set import REQUIREMENT_BLOCKING_SEMANTICS

# Requirement-type classifications, derived from the generator's single
# source of truth (``REQUIREMENT_BLOCKING_SEMANTICS``) so the API can never
# silently drift from the data pipeline's semantics. The shared viewer copy
# lives in ``templates/viewer/requirements.js`` and is parity-checked
# against the same map by ``tests/test_requirement_semantics_parity.py``.
AND_REQ_TYPES = {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == "all"}
OR_REQ_TYPES = {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == "any"}
NEGATIVE_REQ_TYPES = {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == "none"}
# "At least Count of these must have played" (Count lives in
# otherRequirements); the only count-based field evaluable from the save's
# played set.
COUNT_MIN_REQ_TYPES = {f for f, s in REQUIREMENT_BLOCKING_SEMANTICS.items() if s == "count-min"}


def _count_from(other_requirements, req_type: str) -> int:
    """The ``Count`` parameter of a count-based field, read from an
    ``otherRequirements`` map. Defaults to 1 when absent."""
    meta = (other_requirements or {}).get(req_type)
    if isinstance(meta, dict) and isinstance(meta.get("Count"), int):
        return meta["Count"]
    return 1


def _required_count(textline: dict, req_type: str) -> int:
    """The ``Count`` parameter of a count-based field on a textline (read
    from its ``otherRequirements``), defaulting to 1 when absent."""
    return _count_from(textline.get("otherRequirements"), req_type)


def _requirements_satisfied(requirements, other_requirements, played_set, name) -> bool:
    """Return True if a single requirement set (a textline's base
    requirements, or one H2 ``orBranches`` alternative) is satisfied by
    ``played_set``.

    AND fields need all refs played, OR fields need at least one, negative
    (``RequiredFalse*``) fields need none, and count-min
    (``RequiredMinAnyTextLines``) fields need at least their ``Count``
    played (read from ``other_requirements``). Run-count / cooldown fields
    depend on run counts the save can't resolve and are treated as
    satisfied. ``name`` is the host dialogue's own name, used to ignore
    self-references.
    """
    for req_type, refs in (requirements or {}).items():
        if not isinstance(refs, list):
            continue
        others = [r for r in refs if isinstance(r, str) and r != name]
        if req_type in AND_REQ_TYPES:
            if not all(r in played_set for r in others):
                return False
        elif req_type in OR_REQ_TYPES:
            if others and not any(r in played_set for r in others):
                return False
        elif req_type in NEGATIVE_REQ_TYPES:
            if any(r in played_set for r in others):
                return False
        elif req_type in COUNT_MIN_REQ_TYPES:
            played_count = sum(1 for r in others if r in played_set)
            if played_count < _count_from(other_requirements, req_type):
                return False
    return True


def is_directly_satisfied(textline: dict, played_set: set, name: str = None) -> bool:
    """Return True if ``textline`` is *directly* eligible given ``played_set``.

    Shallow by design (immediate requirements only): this is the
    eligible/blocked decision. A dialogue is directly eligible when its base
    requirements are satisfied AND, if it carries H2 set-level ``orBranches``
    (alternative requirement sets), at least one branch is satisfied.
    ``name`` is the dialogue's own name, used to ignore self-references.
    """
    if not _requirements_satisfied(
        textline.get("requirements"), textline.get("otherRequirements"), played_set, name
    ):
        return False
    branches = textline.get("orBranches") or []
    if branches and not any(
        _requirements_satisfied(
            b.get("requirements"), b.get("otherRequirements"), played_set, name
        )
        for b in branches
    ):
        return False
    return True


def load_game_data(data_path: Path = None) -> dict:
    """Load the generated data.json."""
    if data_path is None:
        data_path = Path(__file__).parent / "dist" / "data.json"
    with open(data_path, encoding="utf-8") as f:
        return json.load(f)


def build_prereq_chain(
    root_name: str, textlines: dict, played_set: set
) -> dict:
    """Build the prerequisite chain for a dialogue, respecting AND/OR semantics.

    Returns a dict mapping dialogue name -> {depth, parents, played}.
    """
    chain = {}
    visited = set()

    def walk(name, depth):
        if name in visited:
            return
        visited.add(name)

        tl = textlines.get(name)
        if not tl or "requirements" not in tl:
            return

        for req_type, refs in tl["requirements"].items():
            if not isinstance(refs, list):
                continue

            if req_type in AND_REQ_TYPES:
                for ref in refs:
                    if ref == name:
                        continue
                    _add_to_chain(ref, name, req_type, depth)
                    walk(ref, depth + 1)

            elif req_type in OR_REQ_TYPES:
                any_played = any(
                    ref != name and ref in played_set for ref in refs
                )
                if any_played:
                    continue

                # Pick cheapest option
                cheapest = None
                cheapest_cost = float("inf")
                for ref in refs:
                    if ref == name:
                        continue
                    ref_tl = textlines.get(ref)
                    cost = (
                        sum(len(v) for v in (ref_tl.get("requirements") or {}).values() if isinstance(v, list))
                        if ref_tl
                        else 999
                    )
                    if cost < cheapest_cost:
                        cheapest_cost = cost
                        cheapest = ref
                if cheapest:
                    _add_to_chain(cheapest, name, req_type, depth)
                    walk(cheapest, depth + 1)

            elif req_type in COUNT_MIN_REQ_TYPES:
                # "At least Count of these must have played." Surface the
                # unplayed options as needed prerequisites when the gate
                # isn't met (leaf alternatives; not recursed, to keep the
                # count group readable).
                played_count = sum(
                    1 for ref in refs if ref != name and ref in played_set
                )
                if played_count < _required_count(tl, req_type):
                    for ref in refs:
                        if ref == name or ref in played_set:
                            continue
                        _add_to_chain(ref, name, req_type, depth)

    def _add_to_chain(ref, parent_name, req_type, depth):
        if ref not in chain:
            chain[ref] = {
                "depth": depth + 1,
                "parents": [{"name": parent_name, "reqType": req_type}],
                "played": ref in played_set,
            }
        else:
            chain[ref]["parents"].append({"name": parent_name, "reqType": req_type})
            chain[ref]["depth"] = max(chain[ref]["depth"], depth + 1)

    walk(root_name, 0)
    return chain


def build_tree(root_name: str, chain: dict) -> dict:
    """Build a nested tree structure from the flat chain."""
    children_of = {}
    for name, info in chain.items():
        for p in info["parents"]:
            children_of.setdefault(p["name"], []).append(
                {"name": name, "reqType": p["reqType"]}
            )

    visited = set()

    def build_node(name):
        if name in visited:
            return None
        visited.add(name)

        kids = children_of.get(name, [])
        result = []
        for child in kids:
            info = chain.get(child["name"])
            if not info:
                continue
            node = {
                "name": child["name"],
                "reqType": child["reqType"],
                "played": info["played"],
                "depth": info["depth"],
            }
            if not info["played"]:
                subtree = build_node(child["name"])
                if subtree:
                    node["children"] = subtree
            result.append(node)
        return result if result else None

    return build_node(root_name)


def check_eligibility(
    save_path: str,
    dialogue_name: str,
    game: str = None,
    data_path: Path = None,
) -> dict:
    """Main API function: check eligibility for a dialogue given a save file.

    Args:
        save_path: Path to the .sav file
        dialogue_name: Internal name of the dialogue to check
        game: Force game id (hades1/hades2). Auto-detected if None.
        data_path: Path to data.json. Uses dist/data.json if None.

    Returns:
        Structured dict with eligibility information.
    """
    save_bytes = Path(save_path).read_bytes()
    save_data = parse_save(save_bytes)
    all_data = load_game_data(data_path)
    return _assemble_result(save_data, dialogue_name, game, all_data)


def _assemble_result(
    save_data: dict, dialogue_name: str, game: str, all_data: dict
) -> dict:
    """Build the eligibility result for ``dialogue_name`` from a parsed
    ``save_data``.

    Shared by the CLI (:func:`check_eligibility`) and the HTTP server so the
    status logic and result shape live in exactly one place. Returns an
    ``{"error": ...}`` dict for unknown games / dialogues.
    """
    played_set = extract_text_lines_record(save_data)
    detected_game = save_data["gameId"]

    # For H2 saves, also check H1 dialogues (Biomes mod support)
    target_game = game or detected_game
    textlines = all_data["games"].get(target_game, {}).get("textlines", {})

    if not textlines:
        return {"error": f"No game data found for '{target_game}'"}

    if dialogue_name not in textlines:
        # Try the other game if not found
        other_game = "hades2" if target_game == "hades1" else "hades1"
        other_tls = all_data["games"].get(other_game, {}).get("textlines", {})
        if dialogue_name in other_tls:
            textlines = other_tls
            target_game = other_game
        else:
            return {"error": f"Dialogue '{dialogue_name}' not found in game data"}

    # Determine status from the direct requirements (AND / OR / negative).
    if dialogue_name in played_set:
        status = "played"
    elif is_directly_satisfied(textlines[dialogue_name], played_set, dialogue_name):
        status = "eligible"
    else:
        status = "blocked"

    chain = build_prereq_chain(dialogue_name, textlines, played_set)

    played_count = sum(1 for v in chain.values() if v["played"])
    unplayed = [
        {
            "name": name,
            "owner": textlines.get(name, {}).get("owner", "unknown"),
            "depth": info["depth"],
            "reqTypes": list({p["reqType"] for p in info["parents"]}),
            "neededBy": [p["name"] for p in info["parents"]],
        }
        for name, info in chain.items()
        if not info["played"]
    ]
    unplayed.sort(key=lambda x: -x["depth"])

    tree = build_tree(dialogue_name, chain)

    return {
        "dialogue": dialogue_name,
        "game": target_game,
        "saveGame": detected_game,
        "completedRuns": save_data["completedRuns"],
        "status": status,
        "totalPrereqs": len(chain),
        "playedPrereqs": played_count,
        "unplayedPrereqs": len(chain) - played_count,
        "unplayed": unplayed,
        "tree": tree,
    }


def run_cli(args):
    """Run as a CLI tool.

    Prints the result as JSON and exits non-zero on any error (unknown
    dialogue, unreadable or invalid save) so callers can branch on the exit
    code instead of parsing stdout.
    """
    try:
        result = check_eligibility(
            save_path=args.save_file,
            dialogue_name=args.dialogue,
            game=args.game,
        )
    except FileNotFoundError:
        result = {"error": f"Save file not found: {args.save_file}"}
    except ValueError as e:
        result = {"error": f"Could not parse save file: {e}"}
    print(json.dumps(result, indent=2))
    if "error" in result:
        sys.exit(1)


_SAVE_FILENAME_RE = re.compile(r"^Profile[1-4](_Temp)?\.sav$", re.IGNORECASE)


def _is_allowed_save_path(save_path: str) -> bool:
    """Whether ``save_path`` is allowed for the JSON ``savePath`` branch.

    Restricts reads to files whose basename looks like a Hades save
    (``ProfileN.sav``) so the server can't be coaxed into reading arbitrary
    local files.
    """
    return bool(save_path) and bool(_SAVE_FILENAME_RE.match(Path(save_path).name))


def _parse_multipart_form(content_type: str, body: bytes) -> dict:
    """Minimal ``multipart/form-data`` parser (stdlib only - ``cgi`` was
    removed in Python 3.13).

    Returns ``{field_name: value}`` where file fields are ``bytes`` and plain
    fields are ``str``. Only the small fixed set of fields this API expects
    (``save``, ``dialogue``, ``game``) needs to parse; this is not a
    general-purpose implementation.
    """
    m = re.search(r'boundary=(?:"([^"]+)"|([^";,]+))', content_type)
    if not m:
        raise ValueError("multipart/form-data missing boundary")
    delimiter = b"--" + (m.group(1) or m.group(2)).strip().encode()
    fields = {}
    for part in body.split(delimiter):
        if not part or part.startswith(b"--"):
            continue
        # Each part is framed by exactly one leading and trailing CRLF; strip
        # only those so binary payloads ending in \r\n survive intact.
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        head, sep, payload = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = head.decode("utf-8", "replace")
        name_m = re.search(r'name="([^"]*)"', headers)
        if not name_m:
            continue
        name = name_m.group(1)
        if 'filename="' in headers:
            fields[name] = payload
        else:
            fields[name] = payload.decode("utf-8", "replace")
    return fields


def _handle_eligibility_request(content_type: str, body: bytes, all_data: dict):
    """Parse a POST body and return ``(http_status, result_dict)``.

    Pure (no socket I/O) so the request handling - including the malformed-
    input and invalid-save paths - is unit-testable. Error responses use
    generic messages rather than echoing file bytes or parser internals.
    """
    try:
        if "multipart/form-data" in content_type:
            fields = _parse_multipart_form(content_type, body)
            save_bytes = fields.get("save")
            if not isinstance(save_bytes, bytes):
                return 400, {"error": "Missing 'save' file field"}
            dialogue = fields.get("dialogue", "")
            game = fields.get("game") or None
        elif "application/json" in content_type:
            payload = json.loads(body or b"{}")
            save_path = payload.get("savePath", "")
            dialogue = payload.get("dialogue", "")
            game = payload.get("game") or None
            if not _is_allowed_save_path(save_path):
                return 400, {"error": "savePath must be a ProfileN.sav save file"}
            save_bytes = Path(save_path).read_bytes()
        else:
            return 415, {"error": "Use multipart/form-data or application/json"}
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as e:
        return 400, {"error": f"Malformed request: {e}"}
    except FileNotFoundError:
        return 404, {"error": "Save file not found"}

    try:
        save_data = parse_save(save_bytes)
    except Exception:
        return 400, {"error": "Not a valid Hades save file"}

    result = _assemble_result(save_data, dialogue, game, all_data)
    if "error" in result:
        return (404 if "not found" in result["error"] else 400), result
    return 200, result


def run_server(port: int):
    """Run as an HTTP server, bound to localhost only."""
    from http.server import HTTPServer, BaseHTTPRequestHandler

    all_data = load_game_data()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/eligibility":
                self.send_error(404)
                return
            content_type = self.headers.get("Content-Type", "")
            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                length = 0
            body = self.rfile.read(length) if length > 0 else b""
            try:
                status, result = _handle_eligibility_request(
                    content_type, body, all_data
                )
            except Exception as e:
                status, result = 500, {"error": f"Internal error: {type(e).__name__}"}
            self._json_response(result, status)

        def _json_response(self, data, code=200):
            body = json.dumps(data, indent=2).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            pass

    # Bind to loopback only: this is a local dev tool, not a network service.
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Eligibility API running on http://127.0.0.1:{port}/eligibility")
    print("POST with multipart (save file + dialogue) or JSON (savePath + dialogue)")
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(
        description="Dialogue eligibility tracer API"
    )
    sub = parser.add_subparsers(dest="command")

    # CLI mode
    check = sub.add_parser("check", help="Check eligibility for a dialogue")
    check.add_argument("save_file", help="Path to ProfileX.sav file")
    check.add_argument("dialogue", help="Internal dialogue name")
    check.add_argument("--game", choices=["hades1", "hades2"], help="Force game")

    # Server mode
    serve = sub.add_parser("serve", help="Run as HTTP API server")
    serve.add_argument("--port", type=int, default=8081, help="Port (default: 8081)")

    args = parser.parse_args()

    if args.command == "check":
        run_cli(args)
    elif args.command == "serve":
        run_server(args.port)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
