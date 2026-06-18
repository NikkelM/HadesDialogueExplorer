// Tests for the in-browser LZ4 block decompressor (save-parser.js).
//
// Focuses on the output-buffer growth path: the save format doesn't store
// the uncompressed size, so the decompressor starts from a hint and must
// grow without truncating or corrupting output when a block exceeds it.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { decompressLz4Block } from '../templates/viewer/save-parser.js';

// Build an LZ4 block of `n` literal bytes (0,1,2,... mod 256), no matches.
function literalBlock(n) {
    const bytes = [];
    let lit = n;
    if (lit < 15) {
        bytes.push(lit << 4);
    } else {
        bytes.push(0xF0); // literalLen nibble = 15 -> needs extension
        lit -= 15;
        while (lit >= 255) { bytes.push(255); lit -= 255; }
        bytes.push(lit);
    }
    for (let i = 0; i < n; i++) bytes.push(i & 0xFF);
    return new Uint8Array(bytes);
}

function expectedLiterals(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = i & 0xFF;
    return out;
}

test('decompresses a small literal block within the initial buffer', () => {
    const out = decompressLz4Block(literalBlock(5), 1024);
    assert.deepEqual([...out], [...expectedLiterals(5)]);
});

test('grows the buffer when output exceeds the initial size (literal path)', () => {
    // 4000 literal bytes but only a 16-byte initial buffer -> must grow.
    const out = decompressLz4Block(literalBlock(4000), 16);
    assert.equal(out.length, 4000);
    assert.deepEqual([...out], [...expectedLiterals(4000)]);
});

test('grows the buffer in the match-copy path', () => {
    // 2 literals "AB" then a back-reference producing "ABABAB" (6 bytes),
    // with a 2-byte initial buffer so the match copy forces growth.
    // token: literalLen=2, matchLen nibble=0 (+4); offset=2 (LE).
    const block = new Uint8Array([0x20, 0x41, 0x42, 0x02, 0x00]);
    const out = decompressLz4Block(block, 2);
    assert.equal(String.fromCharCode(...out), 'ABABAB');
});

test('handles a block exactly at the initial capacity boundary', () => {
    const out = decompressLz4Block(literalBlock(14), 14);
    assert.equal(out.length, 14);
    assert.deepEqual([...out], [...expectedLiterals(14)]);
});
