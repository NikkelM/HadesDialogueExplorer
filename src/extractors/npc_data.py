"""
Semantic extractor for NPCData.lua files.

Walks the parsed Lua tree and extracts NPC dialogue data including
textline sets, requirements, and dialogue entries with speaker attribution.
"""

import re
from ..lua_parser import LuaTable, LuaIdentifier, LuaExpression

# Requirement fields that reference other textlines (dialogue dependencies)
TEXTLINE_REQ_FIELDS = {
    "RequiredTextLines",
    "RequiredAnyTextLines",
    "RequiredAnyOtherTextLines",
    "RequiredFalseTextLines",
    "RequiredFalseQueuedTextLines",
    "RequiredFalseTextLinesThisRun",
    "RequiredFalseTextLinesLastRun",
    "RequiredTextLinesThisRun",
    "RequiredTextLinesLastRun",
    "RequiredAnyTextLinesThisRun",
    "RequiredAnyTextLinesLastRun",
}

# Known non-dialogue requirement field prefixes
NON_DIALOGUE_REQ_PREFIX = "Require"


def extract_npc_data(parsed: dict, source_label: str = "", source_file: str = "") -> dict:
    """
    Extract NPC dialogue data from a parsed Lua file.

    Args:
        parsed: Dict from lua_parser.parse_file() - top-level assignments
        source_label: Label for this data source (e.g. "Hades 1")
        source_file: Filename of the source (e.g. "NPCData.lua"), recorded on
            each textline so the viewer can show where it is defined.

    Returns:
        Dict of NPC name -> {section_name: {textline_name: textline_data}}
    """
    # Find the NPC data - could be under "UnitSetData.NPCs" or individual NPC_* keys
    npcs_table = None
    for key, value in parsed.items():
        if 'NPC' in key and isinstance(value, LuaTable):
            if any(k.startswith('NPC_') or 'NPC_' in k for k in value.keys()):
                npcs_table = value
                break

    # Also collect individual top-level NPC_* assignments
    individual_npcs = {}
    for key, value in parsed.items():
        if re.match(r'\w*NPC_\w+', key) and isinstance(value, LuaTable):
            individual_npcs[key] = value

    if npcs_table is None and not individual_npcs:
        return {}

    result = {}

    # Process NPCs from the table
    if npcs_table:
        for npc_name, npc_data in npcs_table.items():
            if isinstance(npc_data, LuaTable) and ('NPC_' in npc_name):
                result[npc_name] = _extract_npc(npc_name, npc_data, source_label, source_file)

    # Process individual top-level NPCs
    for npc_name, npc_data in individual_npcs.items():
        if npc_name not in result:
            result[npc_name] = _extract_npc(npc_name, npc_data, source_label, source_file)

    return result


def _extract_npc(npc_name: str, npc_table: LuaTable, source_label: str, source_file: str) -> dict:
    """Extract all textline sets from a single NPC's data."""
    npc_result = {"source": source_label}

    for key, value in npc_table.items():
        if key.endswith('TextLineSets') and isinstance(value, LuaTable):
            section_data = {}
            for tl_name, tl_table in value.items():
                if isinstance(tl_table, LuaTable):
                    section_data[tl_name] = _extract_textline(tl_name, tl_table, npc_name, source_file)
            npc_result[key] = section_data

    return npc_result


def _extract_textline(tl_name: str, tl_table: LuaTable, npc_name: str, source_file: str) -> dict:
    """Extract requirements and dialogue from a single textline set."""
    data = {
        "requirements": {},
        "otherRequirements": {},
        "dialogueLines": [],
        "sourceFile": source_file,
        "sourceLine": tl_table.line,
    }

    # Extract requirements and other fields from named entries
    for key, value in tl_table.items():
        if key in TEXTLINE_REQ_FIELDS:
            data["requirements"][key] = _to_string_list(value)
        elif key.startswith(NON_DIALOGUE_REQ_PREFIX):
            data["otherRequirements"][key] = _normalize_value(value)

    # Extract dialogue entries from anonymous array entries
    for entry in tl_table.array:
        if isinstance(entry, LuaTable):
            text = entry.get('Text')
            if text and isinstance(text, str):
                # Clean formatting tags
                text = re.sub(r'\{#\w+\}', '', text)
                speaker = entry.get('Speaker')
                if isinstance(speaker, str):
                    data["dialogueLines"].append({"speaker": speaker, "text": text})
                else:
                    data["dialogueLines"].append({"speaker": npc_name, "text": text})

    return data


def _to_string_list(value) -> list:
    """Convert a value to a list of strings (for requirement fields)."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, LuaTable):
        result = []
        # Named entries that are strings
        for v in value.named.values():
            if isinstance(v, str):
                result.append(v)
        # Array entries that are strings
        for v in value.array:
            if isinstance(v, str):
                result.append(v)
            elif isinstance(v, LuaIdentifier):
                result.append(v.name)
        return result
    if isinstance(value, list):
        return [str(v) for v in value]
    return [str(value)]


def _normalize_value(value):
    """Normalize a Lua value for storage in otherRequirements."""
    if isinstance(value, (str, int, float, bool)):
        return value
    if value is None:
        return None
    if isinstance(value, LuaTable):
        # Try to represent as simple list or dict
        if value.array and not value.named:
            return [_normalize_value(v) for v in value.array]
        if value.named and not value.array:
            return {k: _normalize_value(v) for k, v in value.items()}
        # Mixed - just return named as dict
        return {k: _normalize_value(v) for k, v in value.items()}
    if isinstance(value, LuaIdentifier):
        return value.name
    if isinstance(value, LuaExpression):
        return value.raw
    return str(value)
