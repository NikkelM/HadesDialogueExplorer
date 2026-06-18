"""Parse Hades/Hades II SGB1 save files and extract TextLinesRecord.

Binary format (based on TheNormalnij/Hades-SavesExtractor, MIT licence):
- Header: SGB1(4) + checksum(u32) + gameVersion(u16) + saveFlags(u16) + timestamp(u64)
- Metadata: location(string) + completedRuns(u32) + accumulatedMetaPoints(u32)
  + activeShrinePoints(u32) [+ metaUpgradeLevel(u32) for H2] [+ cosmeticsPoints(u32)
  for H2 patch11] + easyMode(u8) + hardMode(u8) + notableLuaData(vec<string>)
  + mapName(string) + mapName2(string)
- Payload: LZ4-compressed luabins blob (length-prefixed bytes)

Strings are u32_LE length + raw bytes. Vectors are u32_LE count + items.
Luabins is decoded via the luabins-py package (pip install luabins-py).
"""
import struct
from io import BytesIO

import lz4.block
from lz4.block import LZ4BlockError
from luabins import decode_luabins

GAME_VERSION_HADES1 = 0x10
GAME_VERSION_HADES2 = 0x11
GAME_VERSION_HADES2_PATCH11 = 0x12

_GAME_ID_MAP = {
    GAME_VERSION_HADES1: "hades1",
    GAME_VERSION_HADES2: "hades2",
    GAME_VERSION_HADES2_PATCH11: "hades2",
}

# Initial decompression buffer (~6 MB, mirrors the C++ tool constant). The
# save format doesn't store the uncompressed size, so the buffer is grown on
# demand up to a safety cap if a save (e.g. a 100%-completion file) exceeds it.
_LZ4_INITIAL_BUFFER_SIZE = 3129344 * 2
_LZ4_MAX_BUFFER_SIZE = 128 * 1024 * 1024


def _lz4_decompress(compressed: bytes) -> bytes:
    """Decompress an LZ4 block whose uncompressed size isn't stored, growing
    the output buffer until it fits (or the safety cap is hit)."""
    size = _LZ4_INITIAL_BUFFER_SIZE
    while True:
        try:
            return lz4.block.decompress(compressed, uncompressed_size=size)
        except LZ4BlockError:
            size *= 2
            if size > _LZ4_MAX_BUFFER_SIZE:
                raise ValueError("LZ4 payload exceeds the maximum supported size")


def parse_save(data: bytes) -> dict:
    """Parse an SGB1 save file and return metadata + decoded Lua state.

    Returns a dict with keys: gameId, gameVersion, location, completedRuns,
    easyMode, hardMode, luaState (the full decoded Lua table).
    Raises ValueError on invalid/unsupported format.
    """
    if len(data) < 20 or data[0:4] != b"SGB1":
        raise ValueError(f"Not an SGB1 save file (magic: {data[0:4]!r})")

    pos = 4
    _checksum = struct.unpack_from("<I", data, pos)[0]; pos += 4
    game_version = struct.unpack_from("<H", data, pos)[0]; pos += 2

    # Validate the version before reading the rest: the H2-only fields below
    # are applied based on it, so an unknown version would otherwise fail with
    # a cryptic offset/decompression error instead of this clear message.
    game_id = _GAME_ID_MAP.get(game_version)
    if game_id is None:
        raise ValueError(f"Unknown game version: 0x{game_version:02X}")

    _save_flags = struct.unpack_from("<H", data, pos)[0]; pos += 2
    _timestamp = struct.unpack_from("<Q", data, pos)[0]; pos += 8

    # location (length-prefixed string)
    loc_len = struct.unpack_from("<I", data, pos)[0]; pos += 4
    location = data[pos:pos + loc_len].decode("utf-8", errors="replace"); pos += loc_len

    completed_runs = struct.unpack_from("<I", data, pos)[0]; pos += 4
    _accumulated_meta = struct.unpack_from("<I", data, pos)[0]; pos += 4
    _active_shrine = struct.unpack_from("<I", data, pos)[0]; pos += 4

    # H2-only fields
    if game_version in (GAME_VERSION_HADES2, GAME_VERSION_HADES2_PATCH11):
        pos += 4  # metaUpgradeLevel
    if game_version == GAME_VERSION_HADES2_PATCH11:
        pos += 4  # cosmeticsPoints

    easy_mode = data[pos]; pos += 1
    hard_mode = data[pos]; pos += 1

    # notableLuaData: vec<string>
    vec_count = struct.unpack_from("<I", data, pos)[0]; pos += 4
    for _ in range(vec_count):
        slen = struct.unpack_from("<I", data, pos)[0]; pos += 4 + slen

    # mapName, mapName2
    slen = struct.unpack_from("<I", data, pos)[0]; pos += 4 + slen
    slen = struct.unpack_from("<I", data, pos)[0]; pos += 4 + slen

    # LZ4-compressed luabins payload
    compressed_len = struct.unpack_from("<I", data, pos)[0]; pos += 4
    compressed = data[pos:pos + compressed_len]

    decompressed = _lz4_decompress(compressed)
    stream = BytesIO(decompressed)
    lua_values = decode_luabins(stream, respect_max_items=False)

    lua_state = lua_values[0] if lua_values else {}

    return {
        "gameId": game_id,
        "gameVersion": game_version,
        "location": location,
        "completedRuns": completed_runs,
        "easyMode": bool(easy_mode),
        "hardMode": bool(hard_mode),
        "luaState": lua_state,
    }


def extract_text_lines_record(save_data: dict) -> set:
    """Extract the set of played dialogue names from a parsed save.

    H1 stores TextLinesRecord at the top level of the Lua state.
    H2 stores it under GameState.TextLinesRecord.
    Both are flat dicts {dialogueName: true}.
    """
    lua_state = save_data.get("luaState", {})
    if not isinstance(lua_state, dict):
        return set()

    game_id = save_data.get("gameId", "")

    if game_id == "hades2":
        game_state = lua_state.get("GameState", {})
        tlr = game_state.get("TextLinesRecord", {}) if isinstance(game_state, dict) else {}
    else:
        # H1: top-level TextLinesRecord
        tlr = lua_state.get("TextLinesRecord", {})

    return set(tlr.keys()) if isinstance(tlr, dict) else set()
