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

## Files

- `worker.js` — the proxy itself, written against the web platform
  (`Request`/`Response`/`URL`/`fetch`). Single source of truth for the logic.
- `server.mjs` — bridges `node:http` to `worker.js` for hosts that run a Node
  process. No dependencies, no build step.
- `Dockerfile` — for hosts that take a container.

## Which host

The proxy was first deployed as a Cloudflare Worker, and adsb.lol answered
**HTTP 429** to it: their nginx rate-limits per IP, and Workers egress from
addresses shared with every other Cloudflare customer, so the limit was already
spent by strangers. Measured 2026-09-22: 5 of 6 requests through the Worker were
429 while 6 of 6 direct requests from an ordinary datacentre IP were 200. It is
Cloudflare's shared egress specifically, not cloud IPs in general — so a host
that gives the proxy its own outbound address fixes it.

| host | deploy from | cold start | cost |
| --- | --- | --- | --- |
| **Render** | browser, GitHub-connected | free tier sleeps after ~15 min idle, then ~50 s to wake | free |
| **Railway** | browser, GitHub-connected | no sleep on the hobby plan | ~$5/mo |
| **Fly.io** | `flyctl` CLI | ~1 s with `auto_start_machines` | free allowance |

Render is the easiest from an iPad and Fly.io wakes fastest. On Render's free
tier the first load after a quiet spell will show a couple of failed polls while
the service wakes — the app backs off and recovers on its own, so it heals, it
just looks ugly for a minute.

### Render / Railway (browser only)

1. New **Web Service**, connect this GitHub repo.
2. Root directory `proxy`, environment **Node**.
3. Build command: leave empty. Start command: `node server.mjs`.
4. Health check path `/health`.
5. Deploy, then copy the service URL.

(Both can equally use the `Dockerfile` — pick Docker as the environment and
leave the commands blank.)

### Fly.io (needs the CLI)

```sh
cd proxy
fly launch --no-deploy      # accept the Dockerfile, skip databases
fly deploy
```

### Then, in both cases

Put the URL in `index.html` as `PROXY_BASE`, **without a trailing slash**:

```js
const PROXY_BASE = 'https://microradar-proxy.onrender.com';
```

Commit and push; GitHub Pages redeploys and the aircraft list should fill in.
Check the host is up first by opening `<url>/health`, which needs no `Origin`
header and should return `{"ok":true,...}`.

### Cloudflare Workers (kept for reference)

`worker.js` still runs unmodified on Workers — dashboard → **Workers & Pages** →
**Create Worker** → paste → **Deploy**. Usable as a fallback, but expect the 429s
described above.

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
