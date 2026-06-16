"""Eligibility tracer API for coding agents.

Accepts a save file + dialogue name and returns a structured JSON result
showing which prerequisite chains are still needed for that dialogue to
become eligible.

Usage (CLI):
    python api.py <save_file> <dialogue_name> [--game hades1|hades2]

Usage (HTTP server):
    python api.py --serve [--port 8081]

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
import sys
from pathlib import Path

from src.save_parser import parse_save, extract_text_lines_record

# Requirement type classifications (mirrors eligibility-view.js)
AND_REQ_TYPES = {
    "RequiredTextLines",
    "RequiredTextLinesThisRun",
    "RequiredQueuedTextLines",
}
OR_REQ_TYPES = {
    "RequiredAnyTextLines",
    "RequiredAnyTextLinesLastRun",
    "RequiredAnyQueuedTextLines",
    "RequiredAnyOtherTextLines",
}


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
    played_set = extract_text_lines_record(save_data)
    detected_game = save_data["gameId"]

    all_data = load_game_data(data_path)

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

    # Determine status
    if dialogue_name in played_set:
        status = "played"
    else:
        # Check if all direct AND reqs are met
        tl = textlines[dialogue_name]
        reqs = tl.get("requirements", {})
        blocked = False
        for req_type, refs in reqs.items():
            if not isinstance(refs, list):
                continue
            if req_type in AND_REQ_TYPES:
                if any(ref not in played_set for ref in refs if ref != dialogue_name):
                    blocked = True
                    break
            elif req_type in OR_REQ_TYPES:
                if not any(ref in played_set for ref in refs if ref != dialogue_name):
                    blocked = True
                    break
        status = "blocked" if blocked else "eligible"

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
    """Run as a CLI tool."""
    result = check_eligibility(
        save_path=args.save_file,
        dialogue_name=args.dialogue,
        game=args.game,
    )
    print(json.dumps(result, indent=2))


def run_server(port: int):
    """Run as an HTTP server."""
    try:
        from http.server import HTTPServer, BaseHTTPRequestHandler
    except ImportError:
        print("Failed to import http.server", file=sys.stderr)
        sys.exit(1)

    import cgi

    all_data = load_game_data()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/eligibility":
                self.send_error(404)
                return

            content_type = self.headers.get("Content-Type", "")

            if "multipart/form-data" in content_type:
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={
                        "REQUEST_METHOD": "POST",
                        "CONTENT_TYPE": content_type,
                    },
                )
                save_field = form["save"]
                save_bytes = save_field.file.read()
                dialogue = form.getvalue("dialogue", "")
                game = form.getvalue("game", None)
            elif "application/json" in content_type:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
                save_path = body.get("savePath", "")
                dialogue = body.get("dialogue", "")
                game = body.get("game", None)
                save_bytes = Path(save_path).read_bytes()
            else:
                self.send_error(415, "Use multipart/form-data or application/json")
                return

            try:
                save_data = parse_save(save_bytes)
                played_set = extract_text_lines_record(save_data)
                detected_game = save_data["gameId"]

                target_game = game or detected_game
                textlines = all_data["games"].get(target_game, {}).get("textlines", {})

                if not textlines:
                    self._json_response({"error": f"No data for '{target_game}'"}, 400)
                    return

                if dialogue not in textlines:
                    other = "hades2" if target_game == "hades1" else "hades1"
                    other_tls = all_data["games"].get(other, {}).get("textlines", {})
                    if dialogue in other_tls:
                        textlines = other_tls
                        target_game = other
                    else:
                        self._json_response({"error": f"'{dialogue}' not found"}, 404)
                        return

                if dialogue in played_set:
                    status = "played"
                else:
                    tl = textlines[dialogue]
                    reqs = tl.get("requirements", {})
                    blocked = False
                    for rt, refs in reqs.items():
                        if not isinstance(refs, list):
                            continue
                        if rt in AND_REQ_TYPES:
                            if any(r not in played_set for r in refs if r != dialogue):
                                blocked = True
                                break
                        elif rt in OR_REQ_TYPES:
                            if not any(r in played_set for r in refs if r != dialogue):
                                blocked = True
                                break
                    status = "blocked" if blocked else "eligible"

                chain = build_prereq_chain(dialogue, textlines, played_set)
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
                tree = build_tree(dialogue, chain)

                result = {
                    "dialogue": dialogue,
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
                self._json_response(result)

            except Exception as e:
                self._json_response({"error": str(e)}, 500)

        def _json_response(self, data, code=200):
            body = json.dumps(data, indent=2).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def log_message(self, format, *args):
            pass

    server = HTTPServer(("", port), Handler)
    print(f"Eligibility API running on http://localhost:{port}/eligibility")
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
