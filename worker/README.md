# HDE usage analytics Worker

A small Cloudflare Worker that backs the viewer's privacy-respecting usage
analytics. It lives in this repo but deploys **independently** of the static
site (which ships to GitHub Pages). The client half is
`templates/viewer/analytics.js`; this is the server half.

## What it does

- `POST /api/event` - the viewer's fire-and-forget beacon. Validates a tiny
  `{type, game, id?}` body and increments one counter in D1. Write-only;
  returns `204`.
- `GET /api/stats` - a private HTML dashboard (top dialogues / speakers per
  game + session ratios). Gated by **Cloudflare Access**.

## Data model

One D1 table, `counts`, keyed by the composite `(game, type, id)`. The same
textline name / speaker id exists in **both** games, so `game` is part of the
key. Aggregate events (`session_start`, `save_loaded`) store the empty-string
id; the popularity events (`dialogue_view`, `speaker_view`, `eligibility_view`)
store a real id.

Only aggregate counts keyed by content are stored: **no** cookies, user ids,
or IPs, and the `save_loaded` event carries only the game (never any save
data).

## Why same-origin (no CSP/CORS change)

The route `nikkelm.dev/HadesDialogueExplorer/api/*` is **more specific** than
the main-site Worker's `nikkelm.dev/*` route, so Cloudflare dispatches the
`api/*` sub-path here and everything else still hits the main-site Worker.
Because the viewer is served from the same origin, its relative `api/event`
beacon reaches this Worker under the existing `connect-src 'self'` CSP - no CSP
or CORS changes are needed.

## Costs

Everything sits within Cloudflare's free tiers at hobby scale (**$0/month**):
Workers 100k requests/day, D1 100k writes/day + 5M reads/day + 5 GB, Zero Trust
Access 50 users (we use 1). The tightest limit is D1 **writes** (one per event);
if traffic ever approached 100k events/day the fix is Workers Paid ($5/mo) or
sampling writes. No KV / Durable Objects / Cache API are used.

## One-time setup

Requires [`wrangler`](https://developers.cloudflare.com/workers/wrangler/)
(`npm i -g wrangler` or `npx wrangler`), run from the `worker/` directory.
Concrete values for this deployment (already in `wrangler.toml`): D1 database
`hde-analytics`, Zero Trust team `nikkelm-dev`, route
`nikkelm.dev/HadesDialogueExplorer/api/*`.

1. **Create the D1 database, then paste its id into `wrangler.toml`**
   (`database_id`) *before* applying the schema:
   ```sh
   wrangler d1 create hde-analytics
   ```
   `d1 create` prints the `database_id`; if you already created it, get the id
   with `wrangler d1 list`. **Gotcha:** if `database_id` is still the
   placeholder, the next step fails with `Invalid property: databaseId =>
   Invalid uuid [code: 7400]` - the id is read from `wrangler.toml`, not
   resolved by name.

2. **Apply the schema** to the remote D1 (`--remote` prompts "Ok to proceed?"):
   ```sh
   wrangler d1 execute hde-analytics --remote --file=./schema.sql
   ```
   Verify the `counts` table exists (`d1 list` shows `num_tables`, or):
   ```sh
   wrangler d1 execute hde-analytics --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
   ```

3. **Create the Cloudflare Access application** (before setting the AUD below -
   the AUD only exists once the app is saved). Zero Trust dashboard -> Access ->
   Applications -> Add an application -> **Self-hosted**:
   - **Domain / path:** domain `nikkelm.dev`, path
     `HadesDialogueExplorer/api/stats`. **Use exactly this path** - Access gates
     it and everything beneath it, so a broader path like `.../api` would also
     gate the public `/api/event` beacon and break collection. `/api/event` and
     the tool itself must stay outside this app.
   - **Identity provider:** select **Cloudflare** (built-in one-time PIN / email
     OTP) - no external IdP needed.
   - **Policy:** Action **Allow**, Include -> **Emails** -> your email. This is
     the real gate: anyone can request an OTP for their own email, but only your
     address passes the policy.
   - The random `*.cloudflareaccess.com` team name can be renamed on a fresh
     account with no side effects (no WARP clients / external IdP / custom login
     page to update). This deployment renamed it to `nikkelm-dev`.

4. **Set the two Access-verification vars** so the Worker cryptographically
   verifies the Access JWT (signature + issuer + audience + expiry), not just
   its presence. They are non-secret and live in `[vars]` in `wrangler.toml`:
   ```toml
   [vars]
   ACCESS_TEAM_DOMAIN = "nikkelm-dev"   # just the subdomain of <team>.cloudflareaccess.com
   ACCESS_AUD = "<application Audience (AUD) tag>"
   ```
   The **AUD tag** appears only after the app is saved: Access -> Applications ->
   your app -> **Application Audience (AUD) Tag** (64-char hex). If the UI hides
   it, fetch it via the API:
   ```powershell
   $token = "<API token with Access: Apps and Policies -> Read>"
   (Invoke-RestMethod "https://api.cloudflare.com/client/v4/accounts/<account-id>/access/apps" -Headers @{ Authorization = "Bearer $token" }).result | Select-Object name, aud
   ```
   With both vars set, a forged or absent `Cf-Access-Jwt-Assertion` header
   cannot open the dashboard even if the edge Access app is misconfigured - the
   Worker **fails closed** (403). Do **not** set `DASHBOARD_TOKEN` in production
   (it is a dev-only `?key=` bypass).

5. **Validate, then deploy** (registers the route + bindings):
   ```sh
   wrangler deploy --dry-run   # sanity-check config + bindings, no upload
   wrangler deploy
   ```

### Post-deploy smoke tests
- Beacon returns `204`:
  ```sh
  curl -i -X POST https://nikkelm.dev/HadesDialogueExplorer/api/event \
    -H "Origin: https://nikkelm.dev" -H "Content-Type: application/json" \
    -d '{"type":"session_start","game":"hades2"}'
  ```
- Dashboard: open `https://nikkelm.dev/HadesDialogueExplorer/api/stats` - it
  should bounce to the Access (email OTP) login, then render.

The `POST /api/event` path needs no Access (it must accept anonymous beacons);
it is protected by Origin validation and strict payload validation
(charset/length-capped ids). See the rate-limiting note below.

## Security notes

- **SQL injection**: every query is parameterised (`.bind(...)`); no input is
  interpolated into SQL.
- **XSS**: dashboard values are both input-validated (id charset excludes
  HTML-significant characters) and output-escaped.
- **Dashboard auth is fail-closed**: reads require a verified Access JWT or the
  dev token; a bare/forged header is rejected.
- **Counts are gameable by design**: `POST /api/event` is an anonymous public
  writer, so a non-browser client can spoof the `Origin` header and inflate
  counts. This is acceptable because the data is internal-only (no public
  leaderboard) and strictly validated (only clean, length-capped rows are
  stored). Add the rate-limiting rule below to bound write volume / D1 cost.

### Rate limiting (optional, and constrained on the free plan)

A per-IP **Rate Limiting Rule** on `/HadesDialogueExplorer/api/event` (Security
-> Security rules -> **Rate limiting rules** -> Create rule; count by **IP**,
e.g. 20 requests / 10s -> **Block**) is the platform-native way to blunt abuse.

Caveats found in practice:
- The **free plan allows only one** rate limiting rule, and it may already be
  taken by Cloudflare's default "Leaked credential check" rule (the **Create
  rule** button greys out at `1/1`). Freeing the slot or upgrading usually is
  not worth it here.
- Do **not** use a **Custom rule** with a Block action instead - a custom rule
  blocks *every* matching request (no rate threshold), which would drop all
  beacons and kill collection.

Skipping it is fine: the endpoint is write-only and strictly validated, the data
is internal-only, and D1's free-tier write cap (100k/day) fails safe (it refuses
further writes at no charge), so abuse cannot run up a bill.

## Reading the stats

Open `https://nikkelm.dev/HadesDialogueExplorer/api/stats` in a browser
authenticated to Access. The page shows headline totals (**sessions**, **% that
loaded a save**, **total tracer opens**) and, per game, the top 25 **dialogues**,
**speakers**, and **traced dialogues** by count. Speaker rows show internal ids
(the Worker has no dataset to resolve friendly names). A "session" is one
browser-tab visit (see `templates/viewer/analytics.js`); reloads within a tab do
not re-count it, and a save restored from a prior visit counts as `save_loaded`.

## Local development

`wrangler dev` runs without Cloudflare Access in front, so gate the dashboard
with an optional shared secret instead:

```sh
cd worker
wrangler d1 execute hde-analytics --local --file=./schema.sql   # seed local DB
wrangler secret put DASHBOARD_TOKEN                              # or add to .dev.vars
wrangler dev
```

Then:
- beacon: `curl -X POST localhost:8787/api/event -H 'Origin: https://nikkelm.dev' -H 'Content-Type: application/json' -d '{"type":"dialogue_view","game":"hades2","id":"Hades_0042"}'`
- dashboard: `http://localhost:8787/api/stats?key=<DASHBOARD_TOKEN>`

The `?key=` fallback is dev-only; in production, Cloudflare Access is the gate.

## Optional: auto-deploy

Connect this repo to **Cloudflare Workers Builds** (Workers -> the Worker ->
Settings -> Builds) with the build root set to `worker/`, so a push to the
default branch redeploys the Worker. Alternatively add a GitHub Action running
`wrangler deploy` with a `CLOUDFLARE_API_TOKEN` secret.
