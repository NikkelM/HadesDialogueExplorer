// Hades Dialogue Explorer - usage analytics Worker.
//
// Two same-origin endpoints under ``nikkelm.dev/HadesDialogueExplorer/api/``:
//
//   POST /api/event   the viewer's fire-and-forget beacon. Validates a tiny
//                     ``{type, game, id?}`` body and increments one D1 counter.
//                     Returns 204 and nothing else - it is write-only.
//
//   GET  /api/stats   a private HTML dashboard of the aggregate counts
//                     (top dialogues / speakers per game + session ratios).
//                     Gated by Cloudflare Access (configure it on this path in
//                     the Zero Trust dashboard); an optional DASHBOARD_TOKEN
//                     secret unlocks it via ``?key=`` for local dev.
//
// Privacy: only aggregate counts keyed by CONTENT are stored. No cookies, no
// user id, no IP is ever written to D1 (the client IP is read only transiently
// for abuse checks). The ``save_loaded`` event carries no file data - just the
// game - so the viewer's "your save never leaves your browser" promise holds.

const ALLOWED_GAMES = new Set(['hades1', 'hades2']);

// Events that carry a content id (popularity counters).
const ID_TYPES = new Set(['dialogue_view', 'speaker_view', 'eligibility_view']);
// Aggregate events with no id (session / feature counters). Stored under id ''.
const AGGREGATE_TYPES = new Set([
    'session_start',
    'save_loaded',
]);

// Only our own site may POST events. sendBeacon includes an Origin header on
// same-origin POSTs; a foreign Origin is rejected. A missing Origin is allowed
// (some privacy tools strip it) since this store is internal, low-stakes, and
// the id/type/game are still validated.
const ALLOWED_ORIGINS = new Set(['https://nikkelm.dev']);

// Textline names + speaker ids are Lua-identifier-ish; cap length and charset
// so junk / oversized ids can never be written.
const ID_RE = /^[A-Za-z0-9_.\-]{1,200}$/;

// A valid event body is a few dozen bytes; reject anything larger unread.
const MAX_BODY_BYTES = 1024;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path.endsWith('/api/event')) return handleEvent(request, env);
        if (path.endsWith('/api/stats')) {
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
            }
            return handleStats(request, env, url);
        }
        return new Response('Not found', { status: 404 });
    },
};

async function handleEvent(request, env) {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response('Forbidden', { status: 403 });
    }

    // Size guard before reading the whole body into memory.
    const declared = Number(request.headers.get('Content-Length') || '0');
    if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });

    let body;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
        body = JSON.parse(text);
    } catch {
        return new Response(null, { status: 400 });
    }

    const event = normaliseEvent(body);
    if (!event) return new Response(null, { status: 400 });

    try {
        await env.DB.prepare(
            `INSERT INTO counts (game, type, id, count, updated_at)
             VALUES (?1, ?2, ?3, 1, datetime('now'))
             ON CONFLICT (game, type, id)
             DO UPDATE SET count = count + 1, updated_at = datetime('now')`,
        ).bind(event.game, event.type, event.id).run();
    } catch {
        // Never leak internals; the client ignores the response anyway.
        return new Response(null, { status: 500 });
    }

    return new Response(null, { status: 204 });
}

// Validate + canonicalise an incoming event. Returns ``{game, type, id}`` or
// ``null`` when anything is off. Aggregate types always store id ''; id-bearing
// types require a charset/length-safe id.
function normaliseEvent(body) {
    if (!body || typeof body !== 'object') return null;
    const { type, game } = body;
    if (typeof type !== 'string' || typeof game !== 'string') return null;
    if (!ALLOWED_GAMES.has(game)) return null;

    if (AGGREGATE_TYPES.has(type)) {
        return { game, type, id: '' };
    }
    if (ID_TYPES.has(type)) {
        const id = body.id;
        if (typeof id !== 'string' || !ID_RE.test(id)) return null;
        return { game, type, id };
    }
    return null; // unknown type
}

// --- Dashboard ---------------------------------------------------

async function handleStats(request, env, url) {
    if (!(await isAuthorised(request, env, url))) {
        return new Response('Forbidden - the stats dashboard requires Cloudflare Access (or a dev DASHBOARD_TOKEN).', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }

    // All aggregate totals in one pass, plus the two per-game top-N lists.
    const totalsRows = (await env.DB.prepare(
        'SELECT game, type, SUM(count) AS n FROM counts GROUP BY game, type',
    ).all()).results || [];

    const games = ['hades1', 'hades2'];
    const topLists = {};
    for (const game of games) {
        topLists[game] = {
            dialogue_view: (await topN(env, 'dialogue_view', game)).results || [],
            speaker_view: (await topN(env, 'speaker_view', game)).results || [],
            eligibility_view: (await topN(env, 'eligibility_view', game)).results || [],
        };
    }

    const html = renderDashboard(totalsRows, topLists, games);
    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

function topN(env, type, game, limit = 25) {
    return env.DB.prepare(
        'SELECT id, count FROM counts WHERE type = ?1 AND game = ?2 ORDER BY count DESC LIMIT ?3',
    ).bind(type, game, limit).all();
}

// Authorise a dashboard request. Two accepted paths, both fail-closed:
//   1. Production: a Cloudflare Access JWT (``Cf-Access-Jwt-Assertion`` header)
//      whose signature, issuer, audience and expiry all verify against the
//      team's JWKS. Requires ACCESS_TEAM_DOMAIN + ACCESS_AUD to be set.
//   2. Local dev / pre-Access: a shared secret matched in constant time.
// Merely *presenting* an Access header is NOT enough - the token is verified,
// so a forged header cannot open the dashboard even if the edge Access app is
// (mis)configured or absent.
async function isAuthorised(request, env, url) {
    if (env.DASHBOARD_TOKEN) {
        const provided = url.searchParams.get('key') || '';
        if (timingSafeEqual(provided, env.DASHBOARD_TOKEN)) return true;
    }
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (token && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
        return verifyAccessJwt(token, env);
    }
    return false;
}

// Verify a Cloudflare Access (RS256) JWT: structural checks + issuer/audience/
// expiry claims + an RSASSA-PKCS1-v1_5 signature check against the team JWKS.
// Returns true only when everything checks out; any error -> false.
async function verifyAccessJwt(token, env) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const header = jsonFromB64url(parts[0]);
        const payload = jsonFromB64url(parts[1]);
        if (!header || !payload || header.alg !== 'RS256' || !header.kid) return false;

        const iss = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
        if (payload.iss !== iss) return false;
        const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!auds.includes(env.ACCESS_AUD)) return false;
        const now = Math.floor(Date.now() / 1000);
        if (typeof payload.exp !== 'number' || payload.exp <= now) return false;
        if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return false;

        const jwks = await getAccessJwks(env.ACCESS_TEAM_DOMAIN);
        const jwk = jwks.find((k) => k.kid === header.kid);
        if (!jwk) return false;
        const key = await crypto.subtle.importKey(
            'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
        );
        const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
        const sig = bytesFromB64url(parts[2]);
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
    } catch {
        return false;
    }
}

// Cached JWKS for the Access team (public signing keys rotate rarely). The
// module-level cache survives across requests in a warm isolate.
let _jwksCache = { url: null, at: 0, keys: null };
const JWKS_TTL_MS = 60 * 60 * 1000;
async function getAccessJwks(teamDomain) {
    const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    const now = Date.now();
    if (_jwksCache.keys && _jwksCache.url === url && (now - _jwksCache.at) < JWKS_TTL_MS) {
        return _jwksCache.keys;
    }
    const res = await fetch(url, { cf: { cacheTtl: 3600 } });
    if (!res.ok) throw new Error('JWKS fetch failed: ' + res.status);
    const data = await res.json();
    _jwksCache = { url, at: now, keys: data.keys || [] };
    return _jwksCache.keys;
}

function bytesFromB64url(s) {
    let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function jsonFromB64url(s) {
    try {
        return JSON.parse(new TextDecoder().decode(bytesFromB64url(s)));
    } catch {
        return null;
    }
}

// Length-then-XOR comparison so a matching-length secret can't be recovered by
// timing the response. (The length itself is not treated as secret.)
function timingSafeEqual(a, b) {
    const ab = new TextEncoder().encode(String(a));
    const bb = new TextEncoder().encode(String(b));
    if (ab.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
    return diff === 0;
}

function renderDashboard(totalsRows, topLists, games) {
    // totals[type][game] and per-type overall sums.
    const totals = {};
    const overall = {};
    for (const row of totalsRows) {
        (totals[row.type] = totals[row.type] || {})[row.game] = row.n;
        overall[row.type] = (overall[row.type] || 0) + row.n;
    }
    const sessions = overall.session_start || 0;
    const pct = (n) => (sessions ? ((100 * (n || 0)) / sessions).toFixed(1) + '%' : 'n/a');

    const gameLabel = { hades1: 'Hades', hades2: 'Hades II' };
    const headline = `
        <section class="cards">
          <div class="card"><div class="num">${sessions.toLocaleString()}</div><div class="lbl">sessions</div></div>
          <div class="card"><div class="num">${pct(overall.save_loaded)}</div><div class="lbl">loaded a save</div></div>
          <div class="card"><div class="num">${(overall.eligibility_view || 0).toLocaleString()}</div><div class="lbl">tracer opens</div></div>
        </section>`;

    const perGame = games.map((game) => {
        const s = (totals.session_start && totals.session_start[game]) || 0;
        return `
        <section>
          <h2>${escapeHtml(gameLabel[game] || game)}</h2>
          <p class="sub">${s.toLocaleString()} sessions &middot;
             ${((totals.save_loaded && totals.save_loaded[game]) || 0).toLocaleString()} saves &middot;
             ${((totals.eligibility_view && totals.eligibility_view[game]) || 0).toLocaleString()} tracer opens</p>
          <div class="grid">
            ${renderTable('Top dialogues', topLists[game].dialogue_view)}
            ${renderTable('Top speakers', topLists[game].speaker_view)}
            ${renderTable('Top traced dialogues', topLists[game].eligibility_view)}
          </div>
        </section>`;
    }).join('');

    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>HDE analytics</title>
<style>
  :root { color-scheme: dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem; background: #14110f; color: #ece7e1; }
  h1 { margin: 0 0 1rem; font-size: 1.35rem; }
  h2 { margin: 2rem 0 .25rem; font-size: 1.1rem; }
  .sub { margin: 0 0 .75rem; color: #b7ada1; font-size: .85rem; }
  .cards { display: flex; flex-wrap: wrap; gap: .75rem; }
  .card { background: #201b17; border: 1px solid #33291f; border-radius: 8px; padding: .75rem 1rem; min-width: 8rem; }
  .card .num { font-size: 1.5rem; font-weight: 600; }
  .card .lbl { color: #b7ada1; font-size: .8rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  table { width: 100%; border-collapse: collapse; }
  caption { text-align: left; font-weight: 600; padding: .25rem 0; }
  th, td { text-align: left; padding: .2rem .4rem; border-bottom: 1px solid #2a2119; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; color: #d9b382; }
  .empty { color: #8b8177; font-style: italic; padding: .4rem; }
  footer { margin-top: 2rem; color: #8b8177; font-size: .8rem; }
</style>
</head><body>
<h1>Hades Dialogue Explorer - usage</h1>
${headline}
${perGame}
<footer>Aggregate counts only. Speaker rows show internal ids. Generated ${new Date().toISOString()}.</footer>
</body></html>`;
}

function renderTable(title, rows) {
    if (!rows || rows.length === 0) {
        return `<table><caption>${escapeHtml(title)}</caption><tbody><tr><td class="empty">No data yet</td></tr></tbody></table>`;
    }
    const body = rows.map(
        (r) => `<tr><td>${escapeHtml(r.id)}</td><td class="n">${Number(r.count).toLocaleString()}</td></tr>`,
    ).join('');
    return `<table><caption>${escapeHtml(title)}</caption><tbody>${body}</tbody></table>`;
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
