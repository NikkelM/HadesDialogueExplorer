// Boot-time smoke test for the concatenated viewer script.
//
// The viewer is shipped as a single classic browser script built by
// concatenating ``templates/viewer/*.js`` (see ``build_viewer.py``).
// Cross-file top-level calls can hit a TDZ (Temporal Dead Zone) if
// the call dereferences a ``let`` or ``const`` declared in a file
// concatenated AFTER the call site - ``function`` declarations hoist
// across the whole concatenated script, but ``let`` / ``const`` do
// not. When that happens, the script throws ``ReferenceError`` at
// script-eval time, ``boot()`` never runs, the data never loads,
// and the viewer silently does nothing (search returns no results
// because the textlines map is empty).
//
// This test catches that regression class by evaluating the actual
// built ``dist/viewer.js`` under ``vm.runInNewContext`` with
// stubbed browser globals. If the script throws during top-level
// evaluation, the test fails. Async errors from ``boot()`` itself
// (e.g. JSON.parse on a missing inline data block) are caught by
// the script's own try/catch and don't surface here - that's fine,
// we only care that the synchronous TDZ does not strike.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_VIEWER_JS = join(__dirname, '..', 'dist', 'viewer.js');

test('dist/viewer.js evaluates without throwing at script-eval time', () => {
    if (!existsSync(DIST_VIEWER_JS)) {
        // Skip rather than fail when the build has not been run yet;
        // the build is a separate step and CI may run JS tests
        // before producing the dist artifact.
        return;
    }
    const source = readFileSync(DIST_VIEWER_JS, 'utf-8');

    // Minimal stubs that satisfy the surface boot() touches before
    // the inline-data lookup fails and the catch branch runs. The
    // stubs deliberately return empty / null shapes so boot() takes
    // its error path quickly rather than trying to render anything.
    const stubElement = {
        innerHTML: '',
        textContent: null,
        value: '',
        hidden: true,
        style: { cssText: '' },
        addEventListener() {},
        appendChild() {},
        insertBefore() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        getAttribute() { return null; },
        setAttribute() {},
        dataset: {},
    };
    const documentStub = {
        getElementById() { return stubElement; },
        createElement() { return stubElement; },
        addEventListener() {},
        body: stubElement,
    };
    const windowStub = {
        addEventListener() {},
        location: { hash: '' },
    };
    const consoleStub = { log() {}, warn() {}, error() {}, info() {} };
    const fetchStub = () => Promise.resolve({ ok: false, status: 0 });

    const ctx = {
        window: windowStub,
        document: documentStub,
        console: consoleStub,
        fetch: fetchStub,
        setTimeout, clearTimeout, setInterval, clearInterval,
    };

    // If a top-level cross-file call hits a TDZ, this throws
    // synchronously. boot() runs asynchronously and its failure path
    // (missing #viewer-data + failed fetch) is swallowed by its own
    // try/catch, so the assertion only catches script-eval-time
    // errors - which is exactly what we want.
    assert.doesNotThrow(() => runInNewContext(source, ctx));
});
