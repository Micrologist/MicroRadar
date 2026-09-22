# MicroRadar

A tiny geo-located 3D flight tracker. Open it on a phone, it finds where you are,
shows the aircraft overhead in 3D relative to you, and (stretch) lets you hold the
phone up as a viewfinder to identify a plane you can see.

Hobby project, one person, built mostly from an iPad via Claude Code cloud sessions.
Keep everything small, boring and finishable.

## Hard constraints

- **Static site only.** Deployed via GitHub Pages from the repo root. No build step,
  no bundler, no npm, no framework. If it doesn't run by opening `index.html`, it's wrong.
  The one exception is the CORS proxy in `proxy/` — see "Data source" below. It is
  the only server-side code in the project and nothing else may be added to it.
- **Single `index.html`** with inline CSS and JS. Split into a couple of files only if
  it genuinely gets unwieldy.
- **Libraries** only via `<script>` tags from a CDN, pinned to an exact version:
  cdnjs, or jsdelivr's npm mirror when cdnjs doesn't carry the files. The 3D
  renderer is **CesiumJS** (decided 2026-09-22, replacing the original three.js
  idea): the global `Cesium.js` build plus its `Widgets/widgets.css`, with
  `CESIUM_BASE_URL` set to the same folder so it finds its `Workers/` and `Assets/`.
  Nothing else unless there's a strong reason.
- **No API keys, no secrets.** Everything except the CORS proxy runs in the browser,
  and the proxy holds no credentials of any kind. That includes Cesium ion: no ion
  token, no ion imagery, no ion terrain, no geocoder. Base map tiles come from
  OpenStreetMap (no key, attribution kept visible); the ground is the plain WGS84
  ellipsoid.
- **Must work in Safari on iPhone and iPad** — that's the real target device.
  Desktop Chrome is for convenience only.
- **HTTPS matters**: geolocation and device orientation only work on HTTPS (GitHub Pages
  is fine) or localhost.

## Data source

Community ADS-B aggregators, free and unauthenticated, ADSBExchange v2 response format:

- `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}`

`api.airplanes.live` was the fallback until 2026-09-22 and was removed: its API is
healthy but gated behind an email to `contact@airplanes.live`, it answered 403
throughout, and a dead fallback cost three polls per adsb.lol 429 instead of one.
If access is ever granted, re-add it (see `proxy/README.md`).

Rate limit is 1 request/second. Poll every 5–10 s, never faster. Radius ~ 30–60 nm.

Useful fields per aircraft in the `ac` array: `hex`, `flight` (callsign, trailing
spaces), `t` (type), `r` (registration), `lat`, `lon`, `alt_baro` (ft, or the string
`"ground"`), `alt_geom` (ft), `gs` (knots), `track` (deg), `baro_rate` (ft/min),
`seen_pos` (seconds since last position).

**CORS: verified 2026-09-22, and it does not work.** Both hosts serve valid JSON
but send no `Access-Control-Allow-Origin` header on `/v2/*`, so a browser is never
allowed to read the response — on iPhone Safari that surfaces as `Load failed`. It
is not origin-allowlisting (adsb.lol's own origin gets no header either) and not a
network problem (a `no-cors` fetch returns an opaque response fine). Full evidence
is in the "API verification" section of `docs/plan-m1.md`.

Because of that, and by an explicit decision on 2026-09-22, requests go through a
small proxy in `proxy/` that forwards to this host and adds the header. It
comes as a Cloudflare Worker (`worker.js`) and an equivalent Val Town val
(`valtown.ts`) — same code, different egress IP, because adsb.lol rate-limited the
Worker. `index.html` has a single `PROXY_BASE` constant pointing at whichever is in
use; see `proxy/README.md` to deploy either. This overrides the original "no
backend" rule, which was written before the CORS behaviour was known.

Keep the proxy dumb: GET only, this upstream only, `/v2/*` only, known
origins only, no keys, no caching, no added features. It must forward a descriptive
`User-Agent` — `api.adsb.lol` answers `403 User-Agent too generic` without one.
If a future aggregator serves proper CORS headers, delete the proxy and go direct.

## Coordinate handling

- Get user position via `navigator.geolocation` once (with a manual refresh button).
- Convert every aircraft to local ENU metres relative to the user:
  east/north via equirectangular approximation (fine at these ranges),
  up = altitude in metres (ft × 0.3048). Prefer `alt_geom`, fall back to `alt_baro`.
  ENU is for the list (distance, bearing) and the extrapolation maths. Cesium takes
  geodetic coordinates directly — `Cartesian3.fromDegrees(lon, lat, altitude_m)`,
  longitude first — so the 3D scene never goes through ENU; there is no terrain,
  so height 0 is the ellipsoid and `alt_geom` (a WGS84 height) fits it as is.
- Between polls, extrapolate positions from `gs`, `track`, `baro_rate` so movement
  is smooth. Reset on each new fix.

## Milestones (do them in order, one PR each)

1. **Vertical slice, no 3D.** Geolocate, poll the API, render a plain text list of
   aircraft (callsign, type, altitude, distance, bearing). Confirm CORS. Confirm it
   works on iPhone Safari via GitHub Pages.
2. **3D scene.** CesiumJS: a globe with OpenStreetMap tiles and no terrain, the
   user marked at their position, aircraft as point markers with a line ahead along
   `track`, a vertical stalk to the ground and a callsign label. Camera orbits
   around the user (`camera.lookAt`). Range rings and compass letters on the ground.
   The text list from milestone 1 stays underneath.
3. **Viewfinder mode.** Use `DeviceOrientationEvent` to aim the camera where the
   phone is pointing: put the Cesium camera at the user's position and set its
   heading/pitch/roll from the device. On iOS this needs
   `DeviceOrientationEvent.requestPermission()` called from a user tap, so add an
   explicit "Enable viewfinder" button. Show a label for whatever aircraft is
   closest to the centre of the view.
4. **Polish, only if still fun.** Tap an aircraft for details, altitude colour
   coding, remembered last position in `localStorage` (guarded with try/catch,
   must work when empty).

## Workflow: plan, then implement

Each milestone is done in two separate sessions:

1. **Planning session** writes `docs/plan-mN.md`: a detailed implementation plan
   another model can follow without further context. Concrete steps, function names,
   file structure, what to verify and how, acceptance criteria checkable on an iPhone,
   plus an "Unknowns" section for anything that can't be verified from the sandbox
   (anything iOS Safari specific). No implementation code in this session.
2. **Implementation session** implements `docs/plan-mN.md` as written. If the plan
   is wrong, ambiguous or conflicts with this file, stop and say so rather than
   improvising around it.

Results from a finished milestone (what worked, what the API actually returned,
what Safari did) get noted at the bottom of that milestone's plan file before the
next one is planned.

## Deployment

Hosted at `https://micrologist.github.io/MicroRadar/`. Because of the `/MicroRadar/`
subpath, all paths must be relative — never `/style.css`, always `style.css`.

## Working style

- Small commits, one milestone per branch/PR. Don't pre-build milestone 3 while
  doing milestone 1.
- Prefer the dumbest thing that works. This is not a product.
- If something on iOS Safari behaves differently from desktop, say so in the PR
  description rather than papering over it.
- Don't add TypeScript, tests, linters, CI or a build pipeline.
