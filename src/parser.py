"""
Lua NPC data file parser.

Parses Hades-style NPCData.lua files using a brace-aware state machine.
Handles both same-line (`Key = {`) and next-line (`Key =\n{`) formats.
"""

import re
from .requirements import remove_line_comment, count_braces, extract_requirements_from_line


def parse_lua_file(filepath: str) -> dict:
    """
    Parse an NPCData.lua file and extract textline sets with requirements.

    Returns a dict of NPC name -> {InteractTextLineSets: {...}, RepeatableTextLineSets: {...}}
    """
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    npcs = {}
    current_npc = None
    current_section = None
    current_textline = None
    current_textline_data = {}

    # Brace depth tracking
    npc_depth = 0
    section_depth = 0
    textline_depth = 0

    state = "top"  # top -> in_npc -> in_section -> in_textline

    in_multiline_string = False
    in_block_comment = False

    # For handling "Key =\n{" pattern
    pending_npc_name = None
    pending_section_name = None
    pending_textline_name = None
    pending_textline_line = None

    # Track current speaker within a textline's dialogue entries
    current_speaker = None
    in_dialogue_entry = False
    dialogue_entry_depth = 0

    for line_num, raw_line in enumerate(lines, 1):
        line = raw_line

        # Handle block comments
        if in_block_comment:
            if "]]" in line:
                in_block_comment = False
                line = line[line.index("]]") + 2:]
            else:
                continue

        if in_multiline_string:
            if "]]" in line:
                in_multiline_string = False
                line = line[line.index("]]") + 2:]
            else:
                continue

        # Remove block comments starting on this line
        while "--[[" in line:
            start = line.index("--[[")
            if "]]" in line[start + 4:]:
                end = line.index("]]", start + 4) + 2
                line = line[:start] + line[end:]
            else:
                line = line[:start]
                in_block_comment = True
                break

        # Remove single-line comments (but be careful of strings)
        stripped = remove_line_comment(line)

        # Count braces (outside of strings)
        opens, closes = count_braces(stripped)
        net = opens - closes

        # Check for pending assignments (Key =\n{)
        if pending_npc_name and stripped.strip() == '{':
            current_npc = pending_npc_name
            if current_npc not in npcs:
                npcs[current_npc] = {"InteractTextLineSets": {}, "RepeatableTextLineSets": {}}
            npc_depth = net
            state = "in_npc"
            pending_npc_name = None
            continue
        elif pending_npc_name:
            pending_npc_name = None

        if pending_section_name and stripped.strip() == '{':
            current_section = pending_section_name
            section_depth = net
            npc_depth += net
            state = "in_section"
            pending_section_name = None
            continue
        elif pending_section_name:
            pending_section_name = None

        if pending_textline_name and stripped.strip() == '{':
            current_textline = pending_textline_name
            current_textline_data = {"line": pending_textline_line, "requirements": {}, "otherRequirements": {}, "dialogueLines": []}
            textline_depth = net
            section_depth += net
            npc_depth += net
            state = "in_textline"
            in_dialogue_entry = False
            pending_textline_name = None
            pending_textline_line = None
            continue
        elif pending_textline_name:
            pending_textline_name = None
            pending_textline_line = None

        if state == "top":
            # Look for NPC definitions
            m = re.match(r'\s*(\w*NPC_\w+)\s*=\s*\{', stripped)
            if m:
                current_npc = m.group(1)
                if current_npc not in npcs:
                    npcs[current_npc] = {"InteractTextLineSets": {}, "RepeatableTextLineSets": {}}
                npc_depth = net
                state = "in_npc"
                continue
            # Next-line pattern
            m = re.match(r'\s*(\w*NPC_\w+)\s*=\s*$', stripped)
            if m:
                pending_npc_name = m.group(1)
                continue

        elif state == "in_npc":
            npc_depth += net
            if npc_depth <= 0:
                state = "top"
                current_npc = None
                continue

            # Look for InteractTextLineSets or RepeatableTextLineSets (same-line)
            m = re.search(r'(InteractTextLineSets|RepeatableTextLineSets)\s*=\s*\{', stripped)
            if m:
                current_section = m.group(1)
                section_depth = net
                state = "in_section"
                continue
            # Next-line pattern
            m = re.search(r'(InteractTextLineSets|RepeatableTextLineSets)\s*=\s*$', stripped)
            if m:
                pending_section_name = m.group(1)
                continue

        elif state == "in_section":
            section_depth += net
            npc_depth += net
            if section_depth <= 0:
                state = "in_npc"
                current_section = None
                continue

            # Look for textline set name (same-line)
            m = re.match(r'\s*(\w+)\s*=\s*\{', stripped)
            if m:
                name = m.group(1)
                if not name.isdigit() and name not in ("GameStateRequirements", "Requirements", "InheritFrom"):
                    depth_before = section_depth - net
                    if depth_before == 1:
                        current_textline = name
                        current_textline_data = {"line": line_num, "requirements": {}, "otherRequirements": {}, "dialogueLines": []}
                        textline_depth = net
                        state = "in_textline"
                        in_dialogue_entry = False
                        extract_requirements_from_line(stripped, current_textline_data)
                        continue
            # Next-line pattern
            m = re.match(r'\s*(\w+)\s*=\s*$', stripped)
            if m:
                name = m.group(1)
                if not name.isdigit() and name not in ("GameStateRequirements", "Requirements", "InheritFrom"):
                    depth_before = section_depth - net
                    if depth_before == 1:
                        pending_textline_name = name
                        pending_textline_line = line_num
                        continue

        elif state == "in_textline":
            textline_depth += net
            section_depth += net
            npc_depth += net
            if textline_depth <= 0:
                # Save the textline
                if current_npc and current_section and current_textline:
                    npcs[current_npc][current_section][current_textline] = current_textline_data
                state = "in_section"
                current_textline = None
                in_dialogue_entry = False
                continue

            # Track dialogue entry braces for speaker attribution
            if not in_dialogue_entry and opens > 0 and (textline_depth - net) == 1:
                in_dialogue_entry = True
                dialogue_entry_depth = 1
                current_speaker = None
                speaker_match = re.search(r'Speaker\s*=\s*"([^"]*)"', stripped)
                if speaker_match:
                    current_speaker = speaker_match.group(1)
            elif in_dialogue_entry:
                dialogue_entry_depth += net
                if dialogue_entry_depth <= 0:
                    in_dialogue_entry = False
                    current_speaker = None

            # Extract requirements
            extract_requirements_from_line(stripped, current_textline_data)

            # Extract Speaker field
            if in_dialogue_entry and current_speaker is None:
                speaker_match = re.search(r'Speaker\s*=\s*"([^"]*)"', stripped)
                if speaker_match:
                    current_speaker = speaker_match.group(1)

            # Extract dialogue text with speaker
            text_match = re.search(r'Text\s*=\s*"((?:[^"\\]|\\.)*)"', stripped)
            if text_match:
                text = text_match.group(1).replace(r'\"', '"')
                text = re.sub(r'\{#\w+\}', '', text)
                speaker = current_speaker if current_speaker else current_npc
                current_textline_data["dialogueLines"].append({"speaker": speaker, "text": text})

    return npcs
