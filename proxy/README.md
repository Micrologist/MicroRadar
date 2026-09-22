# MicroRadar CORS proxy

`worker.js` is a Cloudflare Worker that sits in front of the ADS-B aggregators and
adds the CORS header they don't send.

## Why this is here

`https://api.adsb.lol/v2/point/...` returns a perfectly good JSON body, but with no
`Access-Control-Allow-Origin` header, so the browser refuses to let the page read it
— on iPhone Safari that shows up as the unhelpful string `Load failed`. The full
evidence is in the "API verification" section of `docs/plan-m1.md`.

This is a deliberate relaxation of the "no backend" rule in `CLAUDE.md`. It is the
only server-side piece in the project, it holds no keys or secrets, and the site
still works by opening `index.html` once `PROXY_BASE` points at a deployed Worker.

## Deploy (dashboard, no tooling — works from an iPad)

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
