# MicroRadar CORS proxy

A tiny proxy that sits in front of the ADS-B aggregators and adds the CORS header
they don't send. Two interchangeable builds of the same ~100 lines:

- `worker.js` — Cloudflare Worker (the original; still deployed, its URL is in a
  comment next to `PROXY_BASE`).
- `valtown.ts` — Val Town HTTP val, currently what `PROXY_BASE` points at.
  adsb.lol rate-limits by source IP, and Cloudflare Workers' outbound IPs are
  shared with every other Workers customer: through the Worker the phone got
  `HTTP 429` on its first request. Val Town's egress is shared too, but far less
  busy — measured at the app's cadence, about one poll in eight gets a 429, which
  the app's backoff absorbs (see `docs/plan-m1.md`, "Round 2").

They differ only in the export at the bottom. Keep them in step.

## Why this is here

`https://api.adsb.lol/v2/point/...` returns a perfectly good JSON body, but with no
`Access-Control-Allow-Origin` header, so the browser refuses to let the page read it
— on iPhone Safari that shows up as the unhelpful string `Load failed`. The full
evidence is in the "API verification" section of `docs/plan-m1.md`.

This is a deliberate relaxation of the "no backend" rule in `CLAUDE.md`. It is the
only server-side piece in the project, it holds no keys or secrets, and the site
still works by opening `index.html` once `PROXY_BASE` points at a deployed proxy.

## Deploy A: Cloudflare Worker (dashboard, no tooling — works from an iPad)

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Workers** → **Create Worker**.
2. Name it something like `microradar-proxy`, then **Deploy** the placeholder.
3. **Edit code**, select everything in the editor, paste the contents of
   `worker.js` over it, and **Deploy** again.
4. Copy the worker URL — `https://microradar-proxy.<your-subdomain>.workers.dev`.
5. Put it in `index.html` as `PROXY_BASE`, **without a trailing slash**:

   ```js
   const PROXY_BASE = 'https://microradar-proxy.yourname.workers.dev';
   ```

6. Commit and push. GitHub Pages redeploys and the aircraft list should fill in.

The free plan allows 100,000 requests/day. MicroRadar polls every 8 s, so it uses
about 450/hour — you would have to leave it open for nine hours a day to notice.

## Deploy B: Val Town (browser only — also works from an iPad)

1. Sign in at <https://www.val.town> → **New** → **HTTP val**.
2. Name it something like `microradarProxy`, delete the placeholder code, and
   paste the contents of `valtown.ts` over it. It saves and deploys as you type.
3. Copy the val's URL — Val Town shows it above the editor, ending in
   `.web.val.run` (or `.val.run`; take whatever it displays).
4. Put it in `index.html` as `PROXY_BASE`, **without a trailing slash**, exactly as
   for the Worker. Nothing else in `index.html` changes: the val serves the same
   `/<source>/v2/...` path shape at the root of its own hostname.
5. Commit and push. To go back, set `PROXY_BASE` to the Worker URL again.

Quick check before touching `index.html`: in Safari, open the val's URL with the
path `/adsb.lol/v2/point/51.5/-0.12/40` appended. It will say `Origin not allowed`
— that is the origin guard working, and it proves the val is up. To see what
adsb.lol actually returns through it you need a request that carries
`Origin: https://micrologist.github.io` — the app itself is the easiest way, and
since the status line shows the upstream body, a 429 will explain itself there.

Limits: val.run answers every request with `x-ratelimit-limit: 5000` and a
`remaining`/`reset` pair, so that is Val Town's per-window ceiling on the val. For
scale, MicroRadar's polling is ~450 requests/hour while the page is open and zero
when it isn't. Check the pricing page for the plan's daily total; it could not be
read from the sandbox that wrote this.

## What it allows

Deliberately not an open proxy:

- **GET only.** Anything else gets 405.
- **Two upstreams only**, `adsb.lol` and `airplanes.live` (the ones named in
  `CLAUDE.md`), selected by the first path segment.
- **`/v2/*` paths only.**
- **Known origins only** — `https://micrologist.github.io` plus
  `http://localhost:*` / `http://127.0.0.1:*` for local work. Anything else gets
  403. If you serve the site from somewhere else, add it to `ALLOWED_ORIGINS`.

It forwards a descriptive `User-Agent`. That matters: `api.adsb.lol` answers
`403 User-Agent too generic; include valid contact info.` to a blank or generic
one. Don't remove it.

Upstream status codes are passed through untouched, so an aggregator problem now
reads as `adsb.lol: HTTP 403` in the app instead of a mystery network failure.

## URL shape

```
https://<worker>/adsb.lol/v2/point/51.5/-0.12/40
https://<worker>/airplanes.live/v2/point/51.5/-0.12/40
        └─ upstream ─┘└──────── forwarded verbatim ────────┘
```

## Note on airplanes.live

As of 2026-09-22 `api.airplanes.live` answers **403** to this sandbox with
`Please contact us at contact@airplanes.live...`, so the fallback source is
currently dead no matter what the proxy does. The Worker still routes it, so it
will start working if you mail them and get access. `adsb.lol` works today.
