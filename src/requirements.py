"""Lua-aware line processing and requirement extraction."""

import re
from .constants import TEXTLINE_REQ_FIELDS, NON_DIALOGUE_REQ_PATTERNS


def remove_line_comment(line: str) -> str:
    """Remove -- comments that aren't inside strings."""
    result = []
    in_string = False
    string_char = None
    i = 0
    while i < len(line):
        ch = line[i]
        if in_string:
            if ch == '\\':
                result.append(ch)
                i += 1
                if i < len(line):
                    result.append(line[i])
            elif ch == string_char:
                in_string = False
                result.append(ch)
            else:
                result.append(ch)
        else:
            if ch == '"' or ch == "'":
                in_string = True
                string_char = ch
                result.append(ch)
            elif ch == '-' and i + 1 < len(line) and line[i + 1] == '-':
                break
            else:
                result.append(ch)
        i += 1
    return ''.join(result)


def count_braces(line: str) -> tuple:
    """Count { and } outside of strings. Returns (opens, closes)."""
    opens = 0
    closes = 0
    in_string = False
    string_char = None
    i = 0
    while i < len(line):
        ch = line[i]
        if in_string:
            if ch == '\\':
                i += 1  # skip escaped char
            elif ch == string_char:
                in_string = False
        else:
            if ch == '"' or ch == "'":
                in_string = True
                string_char = ch
            elif ch == '{':
                opens += 1
            elif ch == '}':
                closes += 1
        i += 1
    return opens, closes


def extract_requirements_from_line(line: str, data: dict):
    """Extract requirement fields from a single line into data dict."""
    stripped = line.strip()

    # Match RequiredXxx = { "val1", "val2" } or RequiredXxx = value
    for field in TEXTLINE_REQ_FIELDS:
        pattern = rf'{field}\s*=\s*\{{([^}}]*)\}}'
        m = re.search(pattern, stripped)
        if m:
            values = re.findall(r'"([^"]*)"', m.group(1))
            if values:
                data["requirements"][field] = values
            continue
        # Single value: RequiredXxx = "value"
        pattern = rf'{field}\s*=\s*"([^"]*)"'
        m = re.search(pattern, stripped)
        if m:
            data["requirements"][field] = [m.group(1)]

    # Non-dialogue requirements
    for field in NON_DIALOGUE_REQ_PATTERNS:
        if field in stripped and field not in data.get("otherRequirements", {}):
            # Table value: Field = { ... }
            pattern = rf'{field}\s*=\s*\{{([^}}]*)\}}'
            m = re.search(pattern, stripped)
            if m:
                values = re.findall(r'"([^"]*)"', m.group(1))
                if not values:
                    nums = re.findall(r'\b(\d+)\b', m.group(1))
                    if nums:
                        values = nums
                kvs = re.findall(r'(\w+)\s*=\s*(\w+|"[^"]*")', m.group(1))
                if kvs:
                    data["otherRequirements"][field] = {k: v.strip('"') for k, v in kvs}
                elif values:
                    data["otherRequirements"][field] = values
                else:
                    data["otherRequirements"][field] = m.group(1).strip()
                continue
            # Boolean/number: Field = true/false/number
            pattern = rf'{field}\s*=\s*(true|false|\d+)'
            m = re.search(pattern, stripped)
            if m:
                val = m.group(1)
                if val == "true":
                    data["otherRequirements"][field] = True
                elif val == "false":
                    data["otherRequirements"][field] = False
                else:
                    data["otherRequirements"][field] = int(val)
                continue
            # String value: Field = "value"
            pattern = rf'{field}\s*=\s*"([^"]*)"'
            m = re.search(pattern, stripped)
            if m:
                data["otherRequirements"][field] = m.group(1)
                continue

    # Catch-all for any other Require/Required fields not in our lists
    other_matches = re.findall(r'(Require[sd]\w+)\s*=\s*', stripped)
    for field in other_matches:
        if field not in TEXTLINE_REQ_FIELDS and field not in NON_DIALOGUE_REQ_PATTERNS:
            if field not in data["otherRequirements"]:
                pattern = rf'{field}\s*=\s*\{{([^}}]*)\}}'
                m = re.search(pattern, stripped)
                if m:
                    values = re.findall(r'"([^"]*)"', m.group(1))
                    data["otherRequirements"][field] = values if values else m.group(1).strip()
                else:
                    pattern = rf'{field}\s*=\s*(true|false|\d+|"[^"]*")'
                    m = re.search(pattern, stripped)
                    if m:
                        val = m.group(1).strip('"')
                        if val == "true":
                            data["otherRequirements"][field] = True
                        elif val == "false":
                            data["otherRequirements"][field] = False
                        elif val.isdigit():
                            data["otherRequirements"][field] = int(val)
                        else:
                            data["otherRequirements"][field] = val
