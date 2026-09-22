# Milestone 1 plan: vertical slice, no 3D

Goal: open `https://micrologist.github.io/MicroRadar/` on an iPhone, tap one button,
and see a plain text list of the aircraft within ~40 nm of you, refreshed every few
seconds. No three.js yet. This milestone exists to prove three things before anything
3D is built:

1. A plain browser `fetch()` to the ADS-B aggregators works from GitHub Pages (CORS).
2. Geolocation works in iPhone Safari on the deployed page.
3. The coordinate maths (distance, bearing, altitude) produces sane numbers.

Read `CLAUDE.md` first. Its hard constraints apply to everything below. If this plan
conflicts with `CLAUDE.md`, `CLAUDE.md` wins; stop and say so.

## Scope

In scope:

- Geolocate the user once, with a manual "Refresh position" button.
- Poll the primary API every 8 s, fall back to the secondary API on failure.
- Render a text list of aircraft: callsign, type, altitude, distance, bearing.
- A small status line showing what the app is doing and any error.
- Between polls, extrapolate each aircraft's position from ground speed, track and
  vertical rate so the numbers change smoothly.

Out of scope (later milestones): three.js, camera, device orientation, tapping an
aircraft, altitude colour coding, `localStorage`. Do not pre-build any of it.

## File structure

Everything stays in the existing `index.html`. No new files besides this plan.
No `<script src>` tags at all in this milestone. Keep the existing `<meta viewport>`
line and the dark colour scheme; replace the placeholder `<main>` and `<script>`.

The implementation session should also remove the "Nothing here yet" placeholder text.

## Page layout

Plain HTML, mobile first, one column. From top to bottom:

```
<header>
  <h1>MicroRadar</h1>
  <div id="status">…</div>                  one line, what the app is doing
</header>
<div id="controls">
  <button id="btn-locate">Find me</button>   also used as "Refresh position"
  <button id="btn-source">adsb.lol</button>  shows current source, tap to swap
</div>
<div id="me">…</div>                          your lat/lon, accuracy, fix age
<ol id="aircraft"></ol>                       the list
<footer id="meta">…</footer>                  last poll time, count, next poll
```

Styling: system font, monospace for the numbers, 16px minimum font size so Safari
does not zoom on tap, `padding` respecting `env(safe-area-inset-*)`. Buttons should
be at least 44px tall. Nothing fancy.

Each `<li>` in `#aircraft` is one aircraft, formatted like:

```
DLH4XY   A320   38,000 ft   12.4 km   NE (047°)
  ↑ climbing 1,200 ft/min · 450 kt · seen 3 s ago
```

Exact layout is up to the implementer; the fields are not. Sort the list by distance,
nearest first.

## Constants

Declare these at the top of the script so they are easy to tune:

| Name | Value | Note |
|---|---|---|
| `POLL_MS` | `8000` | Never below 5000. Rate limit is 1 req/s, we stay far under it. |
| `RADIUS_NM` | `40` | Within the 30–60 nm range in `CLAUDE.md`. |
| `SOURCES` | see below | Ordered list, primary first. |
| `FT_TO_M` | `0.3048` | |
| `KT_TO_MPS` | `0.514444` | |
| `FPM_TO_MPS` | `0.00508` | ft/min to m/s |
| `STALE_S` | `60` | Hide aircraft whose `seen_pos` is older than this. |
| `TICK_MS` | `500` | Re-render interval for extrapolation. |

```
SOURCES = [
  { name: 'adsb.lol',       url: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}` },
  { name: 'airplanes.live', url: (lat, lon, r) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}` },
]
```

Round `lat` and `lon` to 4 decimal places when building the URL. That is ~11 m, more
than enough, and it keeps the URL short and cache-friendly.

## State

One plain object, no framework:

```
state = {
  me: null,          // { lat, lon, accuracy, at: Date.now() } or null
  sourceIndex: 0,    // index into SOURCES
  aircraft: [],      // normalised aircraft from the last successful poll
  lastPollAt: 0,     // Date.now() of the last successful poll
  lastError: null,   // string or null
  pollTimer: null,   // setTimeout handle
}
```

## Functions

Implement these, in this order. Names are fixed so the next plan can refer to them.

### `setStatus(text, isError = false)`

Writes `text` into `#status`. If `isError`, add a class that colours it red-ish.
Every user-visible state change goes through this function so problems on the phone
are visible without a console.

### `locate()`

- Wired to `#btn-locate`.
- If `navigator.geolocation` is missing, `setStatus('Geolocation not available', true)`
  and return.
- `setStatus('Finding you…')`.
- Call `navigator.geolocation.getCurrentPosition(onFix, onGeoError, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 })`.
- `onFix` sets `state.me = { lat, lon, accuracy, at: Date.now() }`, calls `renderMe()`,
  then calls `startPolling()`.
- `onGeoError` maps `err.code` to a readable message: 1 → "Location permission denied",
  2 → "Position unavailable", 3 → "Location timed out"; then `setStatus(msg, true)`.
- Do NOT call `locate()` automatically on page load. Geolocation must be triggered by
  a tap. The button label should read "Find me" until the first fix, then
  "Refresh position".

### `startPolling()`

- Clear any existing `state.pollTimer`.
- Call `poll()` immediately, then schedule the next `poll()` with
  `setTimeout(startPolling, POLL_MS)` from inside `poll()`'s `finally`. Use
  `setTimeout`, not `setInterval`, so a slow request never overlaps the next one.

### `poll()`

- If `state.me` is null, return.
- Build the URL from `SOURCES[state.sourceIndex]`.
- `fetch(url, { cache: 'no-store' })` with a 10 s abort via `AbortController`.
- On HTTP not-ok or network error: record `state.lastError`, `setStatus` with the
  source name and the error, then flip `state.sourceIndex` to the other source for
  the next poll. Do not retry immediately.
- On success: parse JSON, run every entry of `json.ac` through `normalise()`, drop the
  ones that return null, store in `state.aircraft`, set `state.lastPollAt`, clear
  `state.lastError`, `setStatus('OK · ' + sourceName)`, call `render()`.
- Log the raw first aircraft object to the console once (`console.log`) so the
  results section below can be filled in from a real response.

### `normalise(raw, now)`

Turns one API entry into what the app needs. Returns `null` if the entry has no
usable position (`lat` or `lon` missing, or `seen_pos > STALE_S`).

```
{
  hex:       raw.hex,
  callsign:  (raw.flight || '').trim() || raw.r || raw.hex,
  type:      raw.t || '',
  reg:       raw.r || '',
  lat:       raw.lat,
  lon:       raw.lon,
  altFt:     altitude in feet (number), 0 for "ground", null if unknown
  onGround:  raw.alt_baro === 'ground',
  gsKt:      raw.gs ?? null,
  track:     raw.track ?? null,
  vsFpm:     raw.baro_rate ?? 0,
  fixedAt:   now - (raw.seen_pos ?? 0) * 1000,   // ms timestamp of the position
}
```

Altitude rule: prefer `alt_geom`; if that is not a number, use `alt_baro`; if
`alt_baro` is the string `"ground"`, altitude is 0 and `onGround` is true; otherwise
`null`. Note that `alt_baro` can also be a number, so check `typeof` rather than
truthiness.

### `toENU(lat, lon, altFt, me)`

Equirectangular local tangent plane, returns metres `{ e, n, u }`:

```
const R = 6371000;
const dLat = (lat - me.lat) * Math.PI / 180;
const dLon = (lon - me.lon) * Math.PI / 180;
const cosLat = Math.cos(me.lat * Math.PI / 180);
e = R * dLon * cosLat
n = R * dLat
u = (altFt ?? 0) * FT_TO_M
```

Milestone 2 will feed these straight into three.js, so keep the function pure and
give it exactly this signature.

### `extrapolate(ac, now)`

Returns a copy of `ac` with `lat`, `lon`, `altFt` advanced by the time since `fixedAt`:

- `dt = (now - ac.fixedAt) / 1000`, clamped to `[0, STALE_S]`.
- If `gsKt` or `track` is null, or `onGround`, return the aircraft unchanged.
- `dist = gsKt * KT_TO_MPS * dt` metres along heading `track`.
- `dN = dist * cos(track°)`, `dE = dist * sin(track°)`.
- `lat += dN / R * 180/π`, `lon += dE / (R * cosLat) * 180/π` (with `cosLat` of the
  aircraft's own latitude).
- `altFt += vsFpm * dt / 60` if `altFt` is a number.

Do not mutate `state.aircraft`; the stored value is the last real fix and is
replaced wholesale on every poll, which is the "reset on each new fix" from
`CLAUDE.md`.

### `describe(ac, me, now)`

Combines the above into display values for one aircraft:

- `p = extrapolate(ac, now)`, `enu = toENU(p.lat, p.lon, p.altFt, me)`.
- `distKm = Math.hypot(enu.e, enu.n) / 1000` (horizontal distance).
- `bearing = (Math.atan2(enu.e, enu.n) * 180/π + 360) % 360`.
- `compass = 16-point label` from bearing (N, NNE, NE, …).
- `ageS = Math.round((now - ac.fixedAt) / 1000)`.
- `vsLabel`: "climbing" if `vsFpm > 200`, "descending" if `< -200`, else "level".
- Returns an object with the formatted strings; `render()` just glues them together.

### `render()`

- Called on every poll success and every `TICK_MS` via a `setInterval` started once
  on page load.
- If `state.me` is null, leave the list empty and return.
- `now = Date.now()`; map `state.aircraft` through `describe`, sort by `distKm`,
  rebuild `#aircraft` innerHTML (escape text with a tiny `esc()` helper, callsigns
  come from the network).
- Update `#meta`: "N aircraft · updated Xs ago · source NAME".
- Keep it dumb: rebuild the whole list each tick. A few dozen `<li>` every 500 ms is
  nothing.

### `renderMe()`

Writes lat, lon (4 dp), accuracy (m) and fix age into `#me`.

### Source toggle

`#btn-source` shows `SOURCES[state.sourceIndex].name`. Tapping it flips the index and
triggers `startPolling()` so the user can force the fallback if the primary looks
wrong. Update the label whenever the index changes, including on automatic fallback.

### Page load

```
document.getElementById('btn-locate').addEventListener('click', locate);
document.getElementById('btn-source').addEventListener('click', toggleSource);
setInterval(render, TICK_MS);
setStatus('Tap "Find me" to start');
```

Also add a `visibilitychange` listener: when the page becomes hidden, clear the poll
timer; when it becomes visible again and `state.me` is set, call `startPolling()`.
iOS suspends timers in background tabs anyway, but this keeps the first poll after
returning prompt and avoids a burst of queued requests.

## Error handling that must exist

- No geolocation API, permission denied, timeout: readable message in `#status`.
- Fetch failure, non-2xx, JSON parse failure, `json.ac` not an array: readable
  message naming the source, then automatic switch to the other source.
- Both sources failing: the status line keeps alternating and the last good list
  stays on screen with its age visible in `#meta`. That is acceptable for M1.
- Never let an exception escape `poll()`; wrap it in try/catch/finally.

## Implementation steps

1. Replace the placeholder markup with the layout above. Commit.
2. Add constants, state, `setStatus`, `locate`, `renderMe`. Verify in desktop Chrome
   that tapping "Find me" shows coordinates (Chrome on localhost will prompt). Commit.
3. Add `poll` and `normalise` with a temporary `console.table` of results. This is the
   CORS check. If the response is blocked by CORS, stop here and report: see Unknowns.
   Commit.
4. Add `toENU`, `describe`, `render`. Verify the list appears and distances look
   plausible (an aircraft directly overhead should be near 0 km; one at the edge of
   the radius should be near 74 km, since 40 nm ≈ 74 km). Commit.
5. Add `extrapolate` and the `TICK_MS` render loop. Verify distances and altitudes
   creep between polls and snap on each poll. Commit.
6. Add source toggle, automatic fallback, `visibilitychange`. Test fallback by
   temporarily setting the primary URL to a bogus host. Commit.
7. Push, wait for Pages, test on the iPhone. Fill in the results section below.

## How to verify from the sandbox

The sandbox cannot reach the API hosts (see Unknowns), so local verification is
limited to what runs without network:

- Serve the folder with `python3 -m http.server 8000` and open it in headless
  Chromium via Playwright (pre-installed) to check the page loads without console
  errors and the buttons exist.
- Unit-check the maths by pasting `toENU`, `extrapolate` and the bearing formula into
  a scratch Node script with a couple of hand-computed cases:
  - Aircraft 0.01° north of the user at the equator: `n ≈ 1112 m`, `e ≈ 0`,
    bearing ≈ 0°.
  - Aircraft 0.01° east of a user at latitude 60°: `e ≈ 556 m`, bearing ≈ 90°.
  - 450 kt due east for 10 s: `dist ≈ 2315 m`.
- Do not fake the API response beyond a hand-written sample object for
  `normalise()`; the point of M1 is the real call.

## Acceptance criteria (check on an iPhone, Safari, via GitHub Pages)

1. Page loads at `https://micrologist.github.io/MicroRadar/` with no visible
   placeholder text.
2. Tapping "Find me" prompts for location; allowing it shows lat/lon and accuracy.
3. Within ~10 s the status reads "OK · adsb.lol" (or airplanes.live) and the list
   shows aircraft with callsign, type, altitude, distance and bearing.
4. Nearest aircraft is at the top. Distances are plausible for where you are.
5. Numbers visibly change between polls (extrapolation) and the "updated Xs ago"
   counter resets roughly every 8 s.
6. Denying location shows a readable error, not a blank page.
7. Turning on airplane mode after a fix shows a readable fetch error and the last
   list stays visible.
8. Tapping the source button switches source and the list keeps working.
9. Locking the phone and coming back resumes polling without a pile of stale
   requests.
10. No horizontal scrolling on an iPhone in portrait; text is readable without zoom.

## Unknowns (cannot be verified from the sandbox)

- **CORS from GitHub Pages.** The sandbox's egress policy blocks both
  `api.adsb.lol` and `api.airplanes.live` (HTTP 403 from the proxy on CONNECT), so
  the planning session could not confirm that either host sends
  `Access-Control-Allow-Origin: *`. Both are widely used from static sites and are
  expected to work, but this is the first thing the implementation session must
  prove, from a real browser. If `fetch()` is blocked by CORS on both hosts,
  stop and report per `CLAUDE.md`; do not add a proxy.
- **Exact response shape.** Field names above come from `CLAUDE.md` and the
  ADSBExchange v2 format. Whether `alt_geom` is usually present, whether `flight`
  is padded, and what `seen_pos` looks like for MLAT-only targets should be noted
  from the real console output in the results section.
- **Rate limiting behaviour.** Whether a 429 comes back as a CORS failure (opaque)
  or a readable status is unknown; treat any failure the same way (switch source).
- **iOS geolocation prompt.** Safari requires the call to come from a user gesture
  and the page to be HTTPS; both hold here. Whether `maximumAge: 60000` returns a
  cached fix instantly on iOS is unverified and harmless either way.
- **Background tab behaviour.** iOS may throttle or freeze `setTimeout` when Safari
  is backgrounded; the `visibilitychange` handler is there to recover cleanly, but
  the actual behaviour should be observed on the device.
- **Font zoom on tap.** iOS Safari zooms into inputs under 16px; there are no inputs
  in M1, but keep body text at 16px anyway.

## Results (fill in after implementation)

_To be written by the implementation session before milestone 2 is planned._

- CORS: 
- Which source answered first, typical response time: 
- Sample raw aircraft object from the console: 
- Fields that were missing or surprising: 
- iPhone Safari observations (geolocation prompt, background behaviour, layout): 
- Anything that had to deviate from this plan and why: 
