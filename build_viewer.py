"""
Build the final HTML viewer by combining JSON data with the HTML template.

Usage:
    python build_viewer.py [output_path]

Reads from:
    outputs/*.json      - Generated data files
    styles/*.css        - CSS stylesheets (inlined into output)
    templates/viewer.html - HTML template

Outputs:
    dialogue_explorer.html (or specified path)
"""

import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
TEMPLATE_PATH = PROJECT_DIR / "templates" / "viewer.html"
STYLES_DIR = PROJECT_DIR / "styles"
OUTPUT_DIR = PROJECT_DIR / "outputs"
DEFAULT_OUTPUT = PROJECT_DIR / "dialogue_explorer.html"


def merge_graph_data(datasets: list[dict]) -> dict:
    """Merge multiple graph datasets into one combined dataset."""
    merged_textlines = {}
    merged_dependents = {}
    total_npcs = 0

    for data in datasets:
        # Merge textlines (later datasets override on name collision)
        merged_textlines.update(data["textlines"])
        total_npcs += data["stats"]["totalNPCs"]

        # Merge dependents
        for dep_name, dep_list in data["dependents"].items():
            if dep_name not in merged_dependents:
                merged_dependents[dep_name] = []
            merged_dependents[dep_name].extend(dep_list)

    # Recalculate stats
    all_referenced = set()
    for tl_data in merged_textlines.values():
        for req_list in tl_data["requirements"].values():
            all_referenced.update(req_list)

    stats = {
        "totalNPCs": total_npcs,
        "totalTextlines": len(merged_textlines),
        "totalEdges": sum(len(v) for v in merged_dependents.values()),
        "unresolvedRefs": sorted(all_referenced - set(merged_textlines.keys())),
    }

    return {
        "textlines": merged_textlines,
        "dependents": merged_dependents,
        "stats": stats,
    }


def build_css() -> str:
    """Read and concatenate all CSS files in order."""
    css_files = sorted(STYLES_DIR.glob("*.css"))
    if not css_files:
        print("WARNING: No CSS files found in styles/")
        return ""
    parts = []
    for css_file in css_files:
        parts.append(f"/* --- {css_file.name} --- */")
        parts.append(css_file.read_text(encoding="utf-8").strip())
    return "\n\n".join(parts)


def build_html(graph_data: dict, output_path: Path):
    """Generate the self-contained HTML viewer."""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    json_data = json.dumps(graph_data, separators=(",", ":"))
    css_data = build_css()

    html = template.replace("/* __CSS_PLACEHOLDER__ */", css_data)
    html = html.replace("/* __DATA_PLACEHOLDER__ */", f"const DATA = {json_data};")

    output_path.write_text(html, encoding="utf-8")
    size_kb = output_path.stat().st_size / 1024
    print(f"Generated: {output_path} ({size_kb:.0f} KB)")


def main():
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    # Load all JSON datasets from outputs/
    datasets = []
    json_files = sorted(OUTPUT_DIR.glob("*.json"))

    if not json_files:
        print("ERROR: No JSON files found in outputs/. Run generate_data.py first.")
        sys.exit(1)

    for json_file in json_files:
        print(f"Loading: {json_file.name}")
        with open(json_file, "r", encoding="utf-8") as f:
            datasets.append(json.load(f))

    # Merge datasets
    if len(datasets) == 1:
        graph_data = datasets[0]
    else:
        print(f"Merging {len(datasets)} datasets...")
        graph_data = merge_graph_data(datasets)

    print(f"Total: {graph_data['stats']['totalTextlines']} textlines, "
          f"{graph_data['stats']['totalEdges']} edges, "
          f"{len(graph_data['stats']['unresolvedRefs'])} external refs")

    build_html(graph_data, output_path)


if __name__ == "__main__":
    main()
