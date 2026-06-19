// Objective mobile audit via Chrome DevTools Protocol (no deps).
// Emulates a phone viewport, loads a URL, and reports:
//   - horizontal overflow: documentElement.scrollWidth vs innerWidth
//   - undersized tap targets: interactive elements whose rendered box is
//     smaller than the 44x44 CSS-px touch guideline (visible ones only)
// Exit code 1 if any check fails, so it can gate a mobile change.
//
// Prereq: headless Edge/Chrome on --remote-debugging-port (default 9222).
// NOTE: relaunch the browser after rebuilding the site - a reused page
// target can keep a stale parsed stylesheet even with the network cache
// disabled, so the audit can lag the latest build.
// Usage: node mobile-check.mjs <url> [width=360] [height=740] [dpr=3] [waitMs=3500]

import { setTimeout as sleep } from 'node:timers/promises';

const [, , url, w = '360', h = '740', dpr = '3', waitMs = '3500'] = process.argv;
const PORT = process.env.CDP_PORT || '9222';

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
let loaded = false;
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'Page.loadEventFired') { loaded = true; }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: +dpr, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
loaded = false;
await send('Page.navigate', { url });
for (let i = 0; i < 100 && !loaded; i++) await sleep(50);
await sleep(+waitMs);

const audit = `(() => {
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    const sel = 'a,button,input,[role=option],[role=tab],[onclick],.search-item,.toggle,.tree-label,.chevron,.npc-tag,.priority-chip,.game-toggle-btn';
    const small = [];
    for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;            // hidden
        if (r.bottom < 0 || r.top > window.innerHeight*4) continue; // far off-screen
        if (r.width < 44 || r.height < 44) {
            small.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,40), w: Math.round(r.width), h: Math.round(r.height), txt: (el.textContent||'').trim().slice(0,24) });
        }
    }
    return JSON.stringify({ docW, winW, small: small.slice(0, 40), smallCount: small.length });
})()`;
const { result } = await send('Runtime.evaluate', { expression: audit, returnByValue: true });
const r = JSON.parse(result.value);
ws.close();

// A responsive page honours the emulated device width: both the layout
// viewport (innerWidth) and the content (scrollWidth) must fit the target.
// A desktop-only page can't fit device-width, so mobile emulation zooms the
// layout viewport OUT to the content width - innerWidth ends up > target.
const target = +w;
const fits = r.winW <= target + 1 && r.docW <= target + 1;
console.log(`\n[${w}x${h} dpr${dpr}] ${url}`);
console.log(`  fits device width ${target}: innerWidth=${r.winW} scrollWidth=${r.docW} -> ${fits ? 'ok' : 'FAIL'}`);
console.log(`  undersized tap targets (<44px): ${r.smallCount}`);
for (const t of r.small.slice(0, 12)) console.log(`    - <${t.tag}.${t.cls}> ${t.w}x${t.h} "${t.txt}"`);
if (r.smallCount > 12) console.log(`    ... and ${r.smallCount - 12} more`);
process.exit(fits ? 0 : 1);
