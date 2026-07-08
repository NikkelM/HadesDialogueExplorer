// Capture the "Textline details" panel of the Hades Dialogue Explorer for one
// dialogue, with a save loaded, as the screenshot embedded in the social card
// (see og-image.html). Driven over the Chrome DevTools Protocol so it can load
// a save, navigate, and apply a few card-only presentation tweaks that aren't
// part of the live viewer.
//
// No npm deps: uses Node's built-in global WebSocket (Node >= 22).
//
// Prereq: headless Chrome/Edge already listening on --remote-debugging-port,
// and the built viewer served over HTTP (the repo's usual localhost:8000).
//   & chrome --headless=new --remote-debugging-port=9222 --force-device-scale-factor=2 about:blank
//
// Usage:
//   node capture-panel.mjs [dialogue] [savePath] [outPng] [baseUrl] [game]
// Defaults reproduce the committed panel.png:
//   node capture-panel.mjs OdysseusBathHouse03 "<save>.sav" panel.png http://localhost:8000/ hades2
//
// Card-only tweaks applied before the shot:
//   * dialogue truncated to the first line + a "..." placeholder (the card only
//     needs a taste of the dialogue),
//   * every requirement section expanded (satisfied groups auto-collapse with a
//     save loaded) so the eligibility dots are visible,
//   * the "Dot key" legend and the closing-voicelines block hidden (noise here),
//   * "Other requirements" clauses forced onto one line (cropped on the right),
//   * extra right padding so the right-aligned priority badges aren't jammed
//     against the panel edge.

import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , DLG = 'OdysseusBathHouse03', SAVE = process.env.HDE_SAVE || '', OUT = 'panel.png',
    BASE = 'http://localhost:8000/', GAME = 'hades2'] = process.argv;
const PORT = process.env.CDP_PORT || '9222';
const KEEP_DIALOGUE_LINES = 1;
if (!SAVE) throw new Error('Pass a .sav path as arg 2 (or set HDE_SAVE). It is read locally only.');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('No page target on CDP port ' + PORT);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalx = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then((r) => r.result.value);
const goto = async (url) => { await send('Page.navigate', { url }); await sleep(3200); };

await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });

// Disable the onboarding tour before the visit we screenshot.
await goto(BASE + '?fresh=' + Date.now());
await evalx(`try{localStorage.setItem('hde.tours.disabled','1');localStorage.setItem('hde.onboarding.seen','1');}catch(e){}; 'ok'`);
await goto(BASE);

// Load the save into the hidden file input.
const doc = await send('DOM.getDocument', { depth: 0 });
const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#save-file-input' });
await send('DOM.setFileInputFiles', { files: [SAVE], nodeId: q.nodeId });
for (let i = 0; i < 25; i++) { await sleep(400); const s = await evalx(`(document.getElementById('save-status')||{}).textContent||''`); if (/dialogues played|runs/i.test(s || '')) { console.log('save:', s.trim().slice(0, 70)); break; } }

await evalx(`location.hash = '#game=' + ${JSON.stringify(GAME)} + '&view=dialogue&dialogue=' + ${JSON.stringify(DLG)}; 'ok'`);
await sleep(1600);

// --- card-only presentation tweaks ---
const applied = await evalx(`(() => {
  const info = document.getElementById('info-content');
  if (!info) return 'no #info-content';
  // Expand every requirement section so the eligibility dots show.
  let expanded = 0;
  for (const sec of info.querySelectorAll('.req-section')) {
    const h4 = sec.querySelector(':scope > h4');
    const kids = sec.querySelector(':scope > .req-section-children');
    if (h4 && kids && !kids.classList.contains('expanded')) { h4.click(); expanded++; }
  }
  // Hide the dot-key legend + closing-voicelines block (noise for the card).
  info.querySelectorAll('.status-legend, .end-lines').forEach((e) => { e.style.display = 'none'; });
  // Truncate the dialogue to the first line + an indented "..." placeholder.
  const dsec = info.querySelector('.dialogue-section');
  let hid = 0;
  if (dsec) {
    const lines = [...dsec.querySelectorAll('.dialogue-line')];
    lines.forEach((el, i) => { if (i >= ${KEEP_DIALOGUE_LINES}) { el.style.display = 'none'; hid++; } });
    if (!dsec.querySelector('.og-ellipsis') && lines.length > ${KEEP_DIALOGUE_LINES}) {
      const ph = document.createElement('div');
      ph.className = 'dialogue-line og-ellipsis';
      ph.textContent = '\\u2026';
      ph.style.cssText = 'opacity:.55;letter-spacing:.15em;font-size:1.3em;padding:2px 10px 2px 16px';
      lines[${KEEP_DIALOGUE_LINES} - 1].after(ph);
    }
  }
  // Card-only style overrides: remove the panel's right padding so the long
  // "Other requirements" clauses (nowrap) run all the way to the capture edge
  // and then flow off the right of the card, while the right-aligned priority
  // badges get their own inset so they don't sit right at the card edge.
  const st = document.createElement('style');
  st.textContent = '#info-content{padding-right:0}'
    + '.other-req-item{white-space:nowrap;overflow:visible}'
    + '.other-req-item .other-req-text{white-space:nowrap}'
    + '.req-item{padding-right:48px}';
  document.head.appendChild(st);
  return 'expanded ' + expanded + ', hid ' + hid + ' dialogue lines';
})()`);
console.log('tweaks:', applied);
await sleep(800);

// Clip to the panel content: from the title row (top of the .textline-info
// content wrapper) down through the last requirement section, spanning the
// info panel's width. CDP clip coords are CSS pixels; the deviceScaleFactor=2
// set above already renders the PNG at 2x, so do NOT multiply by dpr here.
const clip = await evalx(`(() => {
  const info = document.getElementById('info-content');
  info.scrollTop = 0;
  const content = info.firstElementChild;                 // .textline-info
  const secs = info.querySelectorAll('.req-section');
  const last = secs[secs.length - 1] || content;
  const top = content.getBoundingClientRect().top - 8;
  const bottom = last.getBoundingClientRect().bottom + 12;
  const ibox = info.getBoundingClientRect();
  return JSON.stringify({
    x: Math.round(ibox.left),
    y: Math.round(top),
    width: Math.round(ibox.width),
    height: Math.round(bottom - top),
  });
})()`);
const c = JSON.parse(clip);
const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: c.x, y: c.y, width: c.width, height: c.height, scale: 1 } });
writeFileSync(OUT, Buffer.from(data, 'base64'));
console.log(`wrote ${OUT} (clip ${c.width}x${c.height} css, 2x png)`);
ws.close();
