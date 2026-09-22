# MicroRadar

A tiny geo-located 3D flight tracker. Open it on a phone, it finds where you are,
shows the aircraft overhead in 3D relative to you, and (stretch) lets you hold the
phone up as a viewfinder to identify a plane you can see.

Hobby project, one person, built mostly from an iPad via Claude Code cloud sessions.
Keep everything small, boring and finishable.

## Hard constraints

- **Static site only.** Deployed via GitHub Pages from the repo root. No build step,
  no bundler, no npm, no framework. If it doesn't run by opening `index.html`, it's wrong.
- **Single `index.html`** with inline CSS and JS. Split into a couple of files only if
  it genuinely gets unwieldy.
- **Libraries** only via `<script>` tags from cdnjs, pinned to an exact version.
  three.js is fine (use the UMD/global build). Nothing else unless there's a strong reason.
- **No API keys, no secrets, no backend.** Everything runs in the browser.
- **Must work in Safari on iPhone and iPad** — that's the real target device.
  Desktop Chrome is for convenience only.
- **HTTPS matters**: geolocation and device orientation only work on HTTPS (GitHub Pages
  is fine) or localhost.

## Data source

Community ADS-B aggregators, free and unauthenticated, ADSBExchange v2 response format:

- Primary: `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}`
- Fallback: `https://api.airplanes.live/v2/point/{lat}/{lon}/{radius_nm}`

Rate limit is 1 request/second. Poll every 5–10 s, never faster. Radius ~ 30–60 nm.

Useful fields per aircraft in the `ac` array: `hex`, `flight` (callsign, trailing
spaces), `t` (type), `r` (registration), `lat`, `lon`, `alt_baro` (ft, or the string
`"ground"`), `alt_geom` (ft), `gs` (knots), `track` (deg), `baro_rate` (ft/min),
`seen_pos` (seconds since last position).

**First thing to verify:** that a plain browser `fetch()` to these endpoints works
(CORS). If it doesn't, stop and report; don't silently add a proxy.

## Coordinate handling

- Get user position via `navigator.geolocation` once (with a manual refresh button).
- Convert every aircraft to local ENU metres relative to the user:
  east/north via equirectangular approximation (fine at these ranges),
  up = altitude in metres (ft × 0.3048). Prefer `alt_geom`, fall back to `alt_baro`.
- Between polls, extrapolate positions from `gs`, `track`, `baro_rate` so movement
  is smooth. Reset on each new fix.

## Milestones (do them in order, one PR each)

1. **Vertical slice, no 3D.** Geolocate, poll the API, render a plain text list of
   aircraft (callsign, type, altitude, distance, bearing). Confirm CORS. Confirm it
   works on iPhone Safari via GitHub Pages.
2. **3D scene.** three.js: flat ground plane, user at origin, aircraft as simple
   markers (e.g. a cone pointing along `track`) with a vertical stalk to the ground
   and a callsign label. Orbit/pan camera. Compass directions on the ground.
3. **Viewfinder mode.** Use `DeviceOrientationEvent` to aim the camera where the
   phone is pointing. On iOS this needs `DeviceOrientationEvent.requestPermission()`
   called from a user tap, so add an explicit "Enable viewfinder" button.
   Show a label for whatever aircraft is closest to the centre of the view.
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
