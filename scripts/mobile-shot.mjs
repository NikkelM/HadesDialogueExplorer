// Mobile-emulation screenshot via Chrome DevTools Protocol.
// No npm deps: uses Node's built-in global WebSocket (Node >= 22) to drive
// headless Edge/Chrome with true device emulation - mobile viewport width
// (so width media queries fire), device-pixel-ratio, touch input, and
// hover:none / pointer:coarse media (so touch-only CSS activates).
//
// Prereq: an Edge/Chrome already listening on --remote-debugging-port.
//   & msedge --headless=new --remote-debugging-port=9222 about:blank
// NOTE: relaunch the browser after rebuilding the site - a reused page
// target can keep a stale parsed stylesheet even with the network cache
// disabled, so screenshots/measurements lag the latest build.
//
// Usage:
//   node mobile-shot.mjs <url> <outPng> [width] [height] [dpr] [waitMs] [full]
// Example (iPhone-ish portrait, full scroll height):
//   node mobile-shot.mjs http://localhost:8000/ shot.png 390 844 3 3500 full

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , url, out, w = '390', h = '844', dpr = '3', waitMs = '3500', full = ''] = process.argv;
const PORT = process.env.CDP_PORT || '9222';

// Find a "page" target's debugger WebSocket URL.
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target on CDP port ' + PORT);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
const loaded = { fired: false };
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Page.loadEventFired') {
        loaded.fired = true;
    }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
    width: Number(w), height: Number(h), deviceScaleFactor: Number(dpr), mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }],
});

loaded.fired = false;
await send('Page.navigate', { url });
// Wait for the load event, then a fixed settle for the async data.json fetch + render.
for (let i = 0; i < 100 && !loaded.fired; i++) await sleep(50);
await sleep(Number(waitMs));

let clip;
if (full === 'full') {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
}
const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full === 'full',
    ...(clip ? { clip } : {}),
});
writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`wrote ${out} (${w}x${h} dpr=${dpr}${full === 'full' ? ' full-page' : ''})`);
ws.close();
