# Linkroom — a self-hosted link management & tracking tool

A small, self-contained clone of Pretty Link's core feature set: branded short
links, four redirect modes, click analytics (referrer/device/browser/geo), a
conversion tracking pixel, UTM pass-through, and a dashboard with charts and
CSV export.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite via `better-sqlite3` (single file, zero setup, handles
  thousands of clicks/day comfortably on one small VM)
- **Frontend:** Vanilla HTML/CSS/JS + Chart.js (no build step, no framework)
- **Auth:** Single-admin session login (cookie + bcrypt password hash)

This is intentionally boring. A link redirector's job is: look up a row, log
a row, send a redirect — fast and reliably. You don't need a queue, a
microservice, or a SPA framework for that. If you outgrow SQLite (very high
volume, multiple app servers), swap `better-sqlite3` for Postgres — the
queries in `src/routes/*.js` are plain SQL and port over directly.

## Project layout

```
src/
  server.js           Express app entry point
  db.js               SQLite connection + migration runner
  schema.sql           Table definitions
  create-admin.js      CLI to generate your admin password hash
  routes/
    redirect.js         Public: GET /:slug (redirect) + GET /pixel/:slug.gif
    auth.js              POST /api/auth/login|logout, GET /api/auth/me
    api.js               Authenticated CRUD + analytics + CSV export
  lib/
    useragent.js         Device/browser/OS parsing + basic bot filtering
    geolocation.js        IP -> country/region/city lookup, cached
    hash.js               Salted hashing for IPs / unique-visitor keys
    csv.js                CSV serialization
public/               Dashboard (static, served at /dashboard)
data/                 SQLite database file lives here (gitignored)
```

## Quick start (local)

```bash
npm install
cp .env.example .env
node src/create-admin.js "a-strong-password"   # paste the output hash into .env
node src/db.js --migrate                        # creates data/prettylink.db
npm start                                        # http://localhost:3000/dashboard
```

Log in with `ADMIN_EMAIL` / the password you just hashed.

## How redirects work

`GET /:slug` is the hot path (`src/routes/redirect.js`):

1. Look up the link by slug (indexed). If missing/inactive, fall through to
   a 404.
2. Parse the User-Agent (device/browser/OS), hash the client IP (never
   stored raw — see **Privacy** below), and check whether this
   IP+UA combination has been seen for this link within the "unique click"
   window (default 24h) to flag the click as unique or repeat.
3. Look up coarse geolocation for the IP (cached in memory; fails open —
   a geolocation timeout never blocks the redirect).
4. Insert a `clicks` row (skipped for detected bots, so campaign numbers
   aren't inflated by crawlers/preview fetchers).
5. Build the destination URL, forwarding UTM/query params if the link has
   `pass_utm` enabled and the destination doesn't already set that param.
6. Respond according to `redirect_type`:
   - `301` — `Location` header, permanent (default; best for SEO link
     equity and is cacheable by browsers/CDNs)
   - `302` — `Location` header, temporary (use for time-limited promos,
     A/B tests, or anything you'll repoint later — 301s can get cached
     hard by browsers, so changing the target later is unreliable)
   - `meta` — serves an HTML page with `<meta http-equiv="refresh">`
   - `js` — serves an HTML page with `window.location.replace(...)`

`meta` and `js` exist because Pretty Link offers them, but they're an
interstitial page, not a true HTTP redirect — see **Compliance** below
before using them for paid or affiliate traffic.

## Tracking pixel (conversions)

Each link gets a pixel URL: `https://yourdomain.com/pixel/<slug>.gif`.
Embed it on a thank-you/confirmation page:

```html
<img src="https://yourdomain.com/pixel/promo1.gif" width="1" height="1" style="display:none" alt="">
```

The pixel always returns a valid 1x1 GIF immediately, then logs a
`conversions` row in the background (matched to the visitor's most recent
click on that link, if any, via the same IP+UA hash used for unique-click
detection). It never blocks or errors visibly, even if logging fails.

This is a simple, cookieless matching approach — it will under-count
conversions that happen on a different device than the click, and over
long gaps between click and conversion. If you need cross-device or
long-window attribution, you'd add a server-side click ID passed through
your own site (out of scope here, but the schema's `click_id` foreign key
on `conversions` is where it would plug in).

## Analytics captured per click

`total clicks`, `unique clicks` (IP+UA hash, windowed), `timestamp`,
`referrer` + `referrer host`, `device type`, `browser`, `OS`, `country /
region / city` (coarse, via IP), and any `utm_*` query params present on
the click. All of this is queryable per-link (`/dashboard` → click a link)
or in aggregate (Overview tab), and exportable as CSV.

## Dashboard

- **Links tab:** table of all links with live click/unique/conversion
  counts, create/edit/pause/delete.
- **Overview tab:** clicks-over-time across all links, totals, top links.
- **Link detail:** clicks-over-time, top referrers, device breakdown
  (doughnut chart), top UTM campaigns, top locations, CSV export button,
  and the ready-to-paste pixel snippet.

## Deployment

### Option A — a small VM (DigitalOcean/Linode/Hetzner/EC2) with a process manager

```bash
git clone <your-repo> && cd linkroom
npm install --production
cp .env.example .env   # fill in real values, especially SESSION_SECRET
node src/create-admin.js "your-password"
node src/db.js --migrate
npm install -g pm2
pm2 start src/server.js --name linkroom
pm2 save && pm2 startup
```

Put nginx or Caddy in front for TLS termination and to point your branded
domain at the app:

```nginx
server {
  listen 443 ssl http2;
  server_name go.yourdomain.com;
  ssl_certificate     /etc/letsencrypt/live/go.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/go.yourdomain.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

`app.set('trust proxy', 1)` is already set in `server.js` so `X-Forwarded-For`
is honored — just make sure nothing untrusted sits between the internet and
nginx, or an attacker could spoof that header and pollute your analytics.

Back up `data/prettylink.db` on a schedule (it's a single file — `sqlite3
data/prettylink.db ".backup backup.db"` or just copy it while the app is
idle/using WAL mode, which is already enabled).

### Option B — Render / Railway / Fly.io (PaaS)

All three run a Node app from a `Procfile`/`fly.toml` with a persistent
volume for `data/`. The steps are the same as Option A: set env vars in
their dashboard, mount a volume at `./data`, run `node src/db.js --migrate`
once (a release/init command), then `npm start`. Attach your branded domain
via their custom-domain feature (they issue TLS certs automatically).

### Scaling past one server

SQLite is single-writer; it's fine for one app instance. If you need
multiple app servers behind a load balancer, migrate to Postgres:
swap `better-sqlite3` for `pg`, adjust the `datetime('now', ...)` calls to
Postgres's `now() - interval`, and everything else — routes, schema shape,
dashboard — carries over unchanged.

## WordPress plugin (real Pretty Link) vs. this standalone app

| | **Pretty Link (WP plugin)** | **This standalone app** |
|---|---|---|
| Setup | Minutes, if you already run WordPress | You provision and deploy a small Node service |
| Hosting cost/complexity | Rides on your existing WP hosting | One more service to patch, monitor, and back up |
| Performance | Every redirect boots WordPress (plugins, DB queries, theme) unless you use their special "lite" redirect mode — this is the classic complaint about WP-based redirectors | Redirect handler is a single indexed lookup + insert; consistently low latency, no WP overhead |
| Customization | Constrained by the plugin's UI/data model and WP's plugin ecosystem; can conflict with other plugins | Full control of schema, redirect logic, analytics, and UI |
| Analytics depth | Good out of the box; deeper stats often gated behind the paid tier | Whatever you build — this app already covers the brief's requirements, but nothing beyond it (no A/B testing, no rotation links, no dynamic redirects by geo/device out of the box) |
| Multi-site / scale | Each WP site needs its own install unless you architect a network | One service can serve links for as many domains/brands as you point at it |
| Maintenance burden | WordPress core + plugin + theme updates, common target for automated attacks if neglected | Smaller attack surface (one Node app, one dependency tree) but you own patching Node/npm packages yourself |
| Best fit | You already run WordPress and want something working today without touching code | You want a dedicated, fast, fully-owned tool, are comfortable running a small service, and want the data model and features on your terms |

If you're already deep in WordPress and traffic volume is modest, the real
Pretty Link plugin is genuinely the pragmatic choice — don't stand up a
separate service just to reinvent it. This build makes sense once you want
redirect latency decoupled from WordPress, data you fully control, or you
don't run WordPress at all.

## Compliance & misuse considerations

This tool moves traffic between a short URL and a destination URL — that's
inherently the kind of feature ad networks, affiliate programs, and privacy
law pay attention to. A few things worth building in and worth you knowing
before you use it for paid or affiliate traffic:

- **Cloaking risk (meta/JS redirect types).** A true HTTP 301/302 is
  transparent — the browser's address bar and any network tool shows the
  real destination immediately. `meta` and `js` redirect types show an
  interstitial page with *your* short URL in the address bar for a moment
  before moving on. Google Ads, Facebook/Meta Ads, and most affiliate
  networks (Amazon Associates included) explicitly prohibit "cloaking" —
  showing reviewers/crawlers a different destination than real users, or
  obscuring the true destination. The dashboard surfaces a warning when you
  pick these modes; treat them as a UX/branding choice for organic links,
  not a way to hide affiliate or ad destinations. When in doubt, use 301/302.
- **Affiliate disclosure.** If a link is an affiliate link, FTC guidance
  (and most affiliate program terms, e.g. Amazon Associates) requires clear
  disclosure *near the link*, on the page where people see it — a
  redirector doesn't satisfy that requirement by itself. This tool doesn't
  and can't add that disclosure for you; it lives in your content, not your
  link infrastructure.
- **IP geolocation and PII.** Raw IP addresses can be personal data under
  GDPR/CCPA. This app never stores a raw IP — `lib/hash.js` salts and
  hashes it before it touches the database, and geolocation is coarse
  (country/region/city, not precise coordinates). If your visitors are in
  the EU/UK, you likely still need this disclosed in a privacy policy
  (IP-based analytics is common but not exempt from disclosure), and if you
  add cookies later (e.g. for cross-session attribution) you'd need consent
  banners under ePrivacy/GDPR.
- **Bot/crawler filtering.** Basic User-Agent pattern matching excludes
  obvious bots from click counts (`lib/useragent.js`), but this is not
  fraud-proof — treat click counts as directionally accurate, not a legal
  or billing-grade metric, especially if you're paying for traffic based on
  clicks reported elsewhere.
- **Open redirect risk.** By default this app will redirect to any
  http(s) URL you configure — that's the point of the tool, but it also
  means anyone with dashboard access can turn it into a phishing relay.
  Set `ALLOWED_TARGET_DOMAINS` in `.env` if you only ever link to a known
  set of destinations (your own site, a handful of partner domains); leave
  it blank only if you genuinely need arbitrary destinations and trust
  everyone with login access.
- **Access control.** The dashboard is behind a password; put it behind
  HTTPS (see nginx config above) so that password and the session cookie
  are never sent in the clear.

None of the above blocks you from using any feature — they're the things
to get right (disclosure text, which redirect type, domain allowlisting)
before you point paid or affiliate traffic at it.

## Environment variables

See `.env.example` for the full list with inline explanations
(`PORT`, `BASE_URL`, `DB_PATH`, `SESSION_SECRET`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD_HASH`, `GEO_PROVIDER`, `GEO_API_KEY`,
`UNIQUE_WINDOW_HOURS`, `ALLOWED_TARGET_DOMAINS`).
