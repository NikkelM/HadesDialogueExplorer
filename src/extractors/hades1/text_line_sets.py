"""
Loader for ``Scripts/TextLineSets.lua`` (Hades 1).

TextLineSets.lua defines named lists of textline names that other source
files (NPCData, LootData, etc.) reference via bare Lua identifiers, e.g.

    -- TextLineSets.lua
    GameData.AphroditeBasicPickUpTextLines = {
        "AphroditeFirstPickUp",
        "AphroditeMiscPickup01",
        ...
    }

    -- NPCData.lua
    SomeTextline = {
        RequiredTextLines = GameData.AphroditeBasicPickUpTextLines,
        MinRunsSinceAnyTextLines = {
            TextLines = GameData.MegThanIntermissionTextLines, Count = 11
        },
        RequiredAnyTextLines = { "Foo", GameData.X, "Bar" },
    }

Without resolving these the dependency graph contains 28+ unresolved refs
that look like ``LuaIdentifier(name='GameData.X')``. The map returned here
is passed through every per-source extractor so those identifiers are
expanded into concrete textline names in the requirements lists.

The file also defines a handful of shared *requirement* objects (e.g.
``GameData.PartnerConversationRequirements``). Those are not textline
lists and are deliberately skipped — only entries whose value is a pure
array of strings are returned.
"""

from ...lua_parser import LuaTable


GAME_DATA_PREFIX = "GameData."


def extract_game_data_lists(parsed: dict) -> dict:
    """Return a ``{ "GameData.X": ["TextlineA", "TextlineB", ...] }`` map.

    Only entries whose value is a LuaTable consisting purely of string
    array entries (no named fields, no non-string array entries) are
    included. Empty arrays are skipped as well, because they contribute
    no dependency edges and would just add noise to the audit.
    """
    result = {}
    for key, value in parsed.items():
        if not isinstance(key, str) or not key.startswith(GAME_DATA_PREFIX):
            continue
        if not isinstance(value, LuaTable):
            continue
        if value.named:
            continue
        if not value.array:
            continue
        if not all(isinstance(item, str) for item in value.array):
            continue
        result[key] = list(value.array)
    return result
