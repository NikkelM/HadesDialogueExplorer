"""Regenerate the vendored entity-name maps used by the viewer's
Other-Requirements value resolution.

The maps translate internal game-entity ids (boons/traits, keepsakes,
companions, weapon aspects, god boons, enemies, cosmetics, items, ...) that
appear as ``otherRequirements`` operand values into their friendly DisplayName,
so the panel shows e.g. "Must have weapon equipped: Stygian Blade" instead of
the raw ``SwordWeapon`` (the internal id is kept in the row's hover tooltip).

Source: each game's ``Game/Text/en/*.sjson`` DisplayName entries (path read from
``config.toml``). The result is filtered to the ids that actually appear as
otherRequirements values in the current build (``dist/data-<game>.json``) to
keep the vendored map small and relevant - rerun after a data refresh.

Usage (from the repo root):
    python scripts/gen_entity_names.py            # report only (mapped/unmapped)
    python scripts/gen_entity_names.py --write     # rewrite the vendored modules

Writes ``src/extractors/<game>/entity_names.py``. Unmapped ids (used as values
but with no DisplayName - flags, paths, room codes, ...) are reported with usage
counts so gaps are visible; those simply keep rendering their raw id.
"""
import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_TAG = re.compile(r"\{[^}]*\}")          # {#Format}, {$Var}, {!Icon} runtime tags
_ID = re.compile(r'^\s*Id\s*=\s*"((?:[^"\\]|\\.)*)"')
_DN = re.compile(r'^\s*DisplayName\s*=\s*"((?:[^"\\]|\\.)*)"')

# Structural path tokens that are never entities, so they never get an
# (accidental) friendly name even if some text file reuses the id.
_STRUCT = {
    "GameState", "CurrentRun", "PrevRun", "Hero", "TraitDictionary", "Name",
    "Rarity", "CurrentRoom", "Encounter", "Spawns", "Kills", "EnemyKills",
    "UseRecord", "SpeechRecord", "LootTypeHistory", "LastReward", "ActiveBounty",
    "Weapons", "BiomesReached", "EncountersCompletedCache",
    "EncountersOccurredCache", "ProjectileRecord", "MetGods", "LastStands",
    "ClearTime", "EncounterClearStats", "AudioState", "AmbientTrackName",
    "MusicName", "ConfigOptionCache", "MusicVolume", "RoomSetName",
    "BiomeDepthCache", "ActiveBountyAttempts", "GameplayTime", "RoomsEntered",
    "ExorcismSuccesses", "FishingSuccessesManual", "UpgradableHammerCount",
    "Cleared", "BountyCleared", "IsDreamRun", "ActiveShrineBounty",
    "Epic", "Heroic", "Common", "Rare", "Legendary",
    "TextLinesRecord", "Flags", "EquippedFamiliar", "WorldUpgradesAdded",
}

_IDLIKE = re.compile(r"^[A-Z][A-Za-z0-9_]+$")


def _parse_id_displaynames(path: Path) -> dict:
    """Scan an sjson text file for ``Id`` / ``DisplayName`` pairs. Each entry
    block lists Id before DisplayName; brace-counting is avoided (Description
    strings embed ``{#...}`` tags), so the most-recent Id is paired with the
    next DisplayName. Runtime format tags are stripped; blank names skipped."""
    out = {}
    pending = None
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _ID.match(line)
        if m:
            pending = m.group(1)
            continue
        m = _DN.match(line)
        if m and pending is not None:
            name = _TAG.sub("", m.group(1)).strip()
            if name:
                out.setdefault(pending, name)
            pending = None
    return out


def _all_text_names(text_dir: Path) -> dict:
    """Merge id->DisplayName across every ``*.sjson`` in the text dir. The
    canonical item files (HelpText / TraitText / MiscText) are read first so
    their entity names win over any voice-line subtitle reusing the same id."""
    merged = {}
    files = sorted(text_dir.glob("*.sjson"))
    pri_names = ("HelpText.en.sjson", "TraitText.en.sjson", "MiscText.en.sjson")
    pri = [f for f in files if f.name in pri_names]
    rest = [f for f in files if f not in pri]
    for f in pri + rest:
        for k, v in _parse_id_displaynames(f).items():
            merged.setdefault(k, v)
    return merged


def _collect_value_ids(data_path: Path) -> dict:
    """Return ``{id: textline-count}`` for id-like operand values across every
    textline's ``otherRequirements`` (path heads/operators excluded)."""
    d = json.loads(data_path.read_text(encoding="utf-8"))
    counts = {}

    def walk(v, acc):
        if isinstance(v, str):
            if _IDLIKE.match(v) and v not in _STRUCT:
                acc.add(v)
        elif isinstance(v, list):
            for x in v:
                walk(x, acc)
        elif isinstance(v, dict):
            for k, x in v.items():
                if k in ("FunctionArgs", "Comparison", "FunctionName"):
                    continue
                walk(x, acc)

    for t in d["textlines"].values():
        seen = set()
        for val in (t.get("otherRequirements") or {}).values():
            walk(val, seen)
        for vid in seen:
            counts[vid] = counts.get(vid, 0) + 1
    return counts


def _emit_module(game: str, mapped: dict) -> str:
    var = "HADES1_ENTITY_NAMES" if game == "hades1" else "HADES2_ENTITY_NAMES"
    pretty = "Hades 1" if game == "hades1" else "Hades 2"
    lines = [
        '"""Internal entity id -> friendly DisplayName for the viewer\'s',
        'Other-Requirements value resolution (boons/traits, keepsakes, companions,',
        'weapon aspects, god boons, enemies, cosmetics, items and more).',
        '',
        f'Vendored from {pretty}\'s ``Game/Text/en`` sjson DisplayName entries,',
        'filtered to the ids that appear as ``otherRequirements`` operand values.',
        'Regenerate with ``scripts/gen_entity_names.py --write`` after a data',
        'refresh; the internal id is always kept in the row tooltip, so a missing',
        'entry just falls back to showing the raw id.',
        '"""',
        '',
        f'{var} = {{',
    ]
    for k in sorted(mapped):
        v = mapped[k].replace('\\', '\\\\').replace('"', '\\"')
        lines.append(f'    "{k}": "{v}",')
    lines.append('}')
    lines.append('')
    return "\n".join(lines)


def main():
    write = "--write" in sys.argv
    paths = tomllib.loads((ROOT / "config.toml").read_text(encoding="utf-8"))["paths"]
    for game, scripts_key in (("hades1", "hades1_scripts"), ("hades2", "hades2_scripts")):
        text_dir = Path(paths[scripts_key]).parent / "Game" / "Text" / "en"
        names = _all_text_names(text_dir)
        used = _collect_value_ids(ROOT / "dist" / f"data-{game}.json")
        mapped = {k: names[k] for k in used if k in names}
        # Elite enemy variants. H2 spawns share the base enemy's DisplayName via
        # an ``<id>_Elite`` id (e.g. ``SentryBot_Elite`` -> "Auto-Seeker"), so a
        # spawn list reads "Auto-Seeker, Auto-Seeker"; disambiguate by appending
        # " (Elite)". H1 instead fuses the suffix (``...Elite``) AND gives elites
        # a distinct "Dire X" name, so only the underscored H2 form is tagged.
        for k in list(mapped):
            if k.endswith("_Elite") and not mapped[k].endswith("(Elite)"):
                mapped[k] = f"{mapped[k]} (Elite)"
        unmapped = {k: used[k] for k in used if k not in names}
        print(f"\n===== {game} =====")
        print(f"text ids: {len(names)} | value ids used: {len(used)} | "
              f"mapped: {len(mapped)} | unmapped: {len(unmapped)}")
        if write:
            out = ROOT / "src" / "extractors" / game / "entity_names.py"
            out.write_text(_emit_module(game, mapped), encoding="utf-8")
            print(f"  wrote {out.relative_to(ROOT)} ({len(mapped)} entries)")
        print(f"--- unmapped ids used as values, by usage "
              f"(total {len(unmapped)}, sum {sum(unmapped.values())}) ---")
        for k, c in sorted(unmapped.items(), key=lambda kv: -kv[1]):
            print(f"  {c:4d}  {k}")


if __name__ == "__main__":
    main()
