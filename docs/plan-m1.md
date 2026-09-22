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

## Results

_Bullets written by the implementation session, then corrected on 2026-09-22 by a
session whose sandbox could finally reach the API hosts. The CORS question is now
**answered, and the answer is bad**: see "API verification" below._

- **CORS: VERIFIED — blocked, on every host tried.** `https://api.adsb.lol/v2/point/...`
  answers **HTTP 200 with a full, correct 87 KB JSON body**, but sends **no
  `Access-Control-Allow-Origin` header at all**, so a browser is not allowed to
  read it. A real cross-origin `fetch()` from origin `https://micrologist.github.io`
  in headless Chromium 141 fails with `TypeError: Failed to fetch` and the console
  message: `Access to fetch at 'https://api.adsb.lol/v2/point/51.5/-0.12/40' from
  origin 'https://micrologist.github.io' has been blocked by CORS policy: No
  'Access-Control-Allow-Origin' header is present on the requested resource.`
  `api.airplanes.live` and `api.adsb.one` additionally answer 403, and
  `api.adsb.fi` has no `/v2/point` route (404) — all three likewise with no ACAO.
  This exactly reproduces the phone symptom: Safari's `TypeError` for a
  CORS-blocked `fetch()` reads **"Load failed"** where Chromium's reads "Failed to
  fetch", which is why the status line showed "Load failed" for both sources.
  **Per `CLAUDE.md` this is a stop-and-report, not something to code around.** No
  proxy was added and none should be.
- **Which source answered first, typical response time.** In the browser, **none** —
  all four are blocked before the body is readable. Server-side (plain `curl`, no
  browser), only `api.adsb.lol` answers: 0.74–0.93 s for ~87 KB / 179 aircraft at
  40 nm, measured through the sandbox egress proxy, so treat that as an upper
  bound on the real figure.
- **Sample raw aircraft object: VERIFIED** (captured with `curl`, because no
  browser is permitted to read this body). `api.adsb.lol/v2/point/51.5/-0.12/40`,
  an airliner with the full field set:

  ```json
  {
    "hex": "4ca61d", "type": "adsb_icao", "flight": "RYR7ZW  ",
    "r": "EI-DWP", "t": "B738",
    "alt_baro": 15475, "alt_geom": 16525,
    "gs": 366.2, "ias": 296, "tas": 378, "mach": 0.592,
    "wd": 356, "ws": 14, "oat": -5, "tat": 14,
    "track": 321.1, "track_rate": 0.47, "roll": 8.61,
    "mag_heading": 321.15, "true_heading": 322.1,
    "baro_rate": 1920, "geom_rate": 1920,
    "squawk": "4625", "emergency": "none", "category": "A3",
    "nav_qnh": 1013.6, "nav_altitude_mcp": 16992,
    "nav_altitude_fms": 34000, "nav_heading": 319.22,
    "lat": 51.140706, "lon": -0.973511,
    "nic": 8, "rc": 186, "seen_pos": 0.302, "version": 2,
    "nic_baro": 1, "nac_p": 8, "nac_v": 1, "sil": 3,
    "sil_type": "perhour", "gva": 1, "sda": 2,
    "alert": 0, "spi": 0, "mlat": [], "tisb": [],
    "messages": 8035, "seen": 0.0, "rssi": -8.8,
    "dst": 38.568, "dir": 236.4
  }
  ```

  Top level is `{ "ac": [...], "msg": "No error", "now": 1790082228501,
  "total": 179, "ctime": ..., "ptime": 0 }` — `now`/`ctime` are epoch
  **milliseconds**, and `total` is just the length of `ac`.

- **Fields that were missing or surprising: VERIFIED.** Presence counts over one
  live response, 179 aircraft within 40 nm of 51.5/-0.12:

  | field | present | note |
  | --- | --- | --- |
  | `hex`, `lat`, `lon`, `seen_pos` | 100% | always there — the fields M1 depends on most |
  | `alt_baro` | 99% | **54 of 179 (30%) are the string `"ground"`**, as the plan assumed |
  | `flight` | 97% | space-padded, confirmed (`"RYR7ZW  "`); the 3% without it need the `r`/`hex` fallback |
  | `gs` | 95% | |
  | `r` / `t` | 94% / 93% | |
  | `track` | **68%** | |
  | `alt_geom` | **53%** | |

  Three surprises worth carrying into M2:

  1. **`alt_geom` is the minority case (53%), not the norm.** `CLAUDE.md` says
     "prefer `alt_geom`, fall back to `alt_baro`" — that fallback is the path
     taken for nearly half of all aircraft, so it is the hot path, not an edge case.
  2. **`track` is absent on 32% of aircraft.** Seven of those carry `calc_track`
     (a track the aggregator derived) instead. `extrapolate()` already no-ops
     without `track`, which is correct, but M2 may want `calc_track` as a fallback
     so those targets still point somewhere sensible.
  3. **The API already returns `dst` (nautical miles from the query point) and
     `dir` (bearing from it).** M1 computes both itself via `toENU()`. Observed
     `dst` ranged 2.2–39.98 nm for a 40 nm request, so the radius is honoured
     exactly. These are a free cross-check on the ENU maths, not a replacement —
     M2 needs the full 3D vector regardless.

  Also note `type` (`adsb_icao` 131, `mlat` 32, `adsb_icao_nt` 15, `adsb_other` 1)
  is the *reception* method and has nothing to do with `t`, the airframe type
  (`B738`). Easy to confuse when reading the JSON. `seen_pos` for MLAT targets is
  small (0.6–20 s), so the `STALE_S` filter does not quietly discard them.

- **iPhone Safari observations: still UNVERIFIED**, and now mostly moot for M1 —
  the app cannot get data on any device until the CORS problem is resolved. The
  reported "Load failed" on the phone is fully explained by the finding above.

### API verification (2026-09-22)

A dedicated session with `api.adsb.lol`, `api.airplanes.live`, `api.adsb.one` and
`api.adsb.fi` allowlisted in the environment's egress policy. The earlier
CONNECT 403s are gone; these are real responses.

**Server-side (`curl`, `Origin: https://micrologist.github.io`, `/v2/point/51.5/-0.12/40`):**

| host | status | `Access-Control-Allow-Origin` | body |
| --- | --- | --- | --- |
| `api.adsb.lol` | **200** | **absent** | valid JSON, 179 aircraft, ~87 KB |
| `api.airplanes.live` | 403 | absent | `{"error": "Please contact us at contact@airplanes.live. Your email MUST include any links, a description of the project, and any information you deem appropriate."}` |
| `api.adsb.one` | 403 | absent | Cloudflare "Attention Required!" HTML |
| `api.adsb.fi` | 404 | absent | nginx 404 — no `/v2/point` route (`/v2/lat/../lon/../dist/..` is also 404) |

**In a real browser** (headless Chromium 141, page served at the production origin
`https://micrologist.github.io/MicroRadar/` via request interception, so the
`Origin` is genuinely the deployed one): all four hosts fail with
`TypeError: Failed to fetch` and a "No 'Access-Control-Allow-Origin' header is
present" console error.

Three controls, because "no header" is an easy thing to get wrong:

1. **The sandbox proxy is not stripping the header.** `https://api.adsb.lol/0/me`
   — same host, same proxy, same `curl` — *does* return
   `access-control-allow-origin: https://www.adsb.lol` and
   `access-control-allow-methods: GET, POST, OPTIONS`. So ACAO survives the proxy
   intact; `/v2/point` genuinely sends none. (Responses from the other hosts also
   arrived with `x-frame-options`, `nel`, `report-to` and `alt-svc` untouched.)
2. **The network path is fine — it is CORS and nothing else.** The same browser
   fetch with `mode: 'no-cors'` **succeeds** against all four hosts, returning an
   opaque response. The request leaves, the response comes back, and only the CORS
   policy prevents the page from reading it. Not DNS, not TLS, not connectivity.
3. **It is not origin-allowlisting.** `/v2/point` returns no ACAO for
   `Origin: https://www.adsb.lol` or `https://adsb.lol` either — i.e. not even for
   adsb.lol's own front end. Preflight `OPTIONS /v2/point/...` answers **405**.
   The `/v2/*` routes appear to have no CORS middleware at all, whereas `/0/*`
   does (locked to `https://www.adsb.lol`).

**Caveat on IP-based blocking.** This sandbox is a datacentre IP (Cloudflare
`cf-ray` colo `IAD`), not a UK mobile network. `api.adsb.lol` answering 200 here
does **not** guarantee it answers 200 from the phone, and the 403s from
`airplanes.live` / `adsb.one` may be partly IP/ASN reputation rather than a blanket
public shutdown. What *is* IP-independent is the CORS result: a missing
`Access-Control-Allow-Origin` blocks every browser from every network, so the
phone cannot succeed where this sandbox failed.

**Method note.** Playwright's Chromium does not trust the sandbox's TLS-intercepting
proxy CA by default and first failed with `ERR_CERT_AUTHORITY_INVALID`, which looks
like a fetch failure but is not a CORS result. It was launched with
`--ignore-certificate-errors-spki-list` pinned to the SHA-256 SPKI hashes of the two
CAs in `/root/.ccr/agent-proxy-ca.crt`, so that exact proxy is trusted and every other
certificate is still verified normally. Verification was not disabled. This matters
only inside the sandbox; nothing about it affects the phone.

**A second, unrelated finding: `api.adsb.lol` does enforce a `User-Agent` policy.**
A request with a blank UA, or `User-Agent: node`, gets
`403 User-Agent too generic; include valid contact info.` This confirms the rumour
that was collected earlier — but it is *not* what breaks the phone: an iPhone Safari
UA gets a clean 200, as do `curl/8.5.0` and a descriptive project UA. It only matters
for non-browser callers, which now includes the proxy below. Worth knowing; it was
the first thing to bite when the Worker was tested from Node.

**Conclusion.** `index.html` was not at fault — the URL shape, the polling and the
fallback all behaved correctly; the data was simply unreadable from a browser.

### Resolution (2026-09-22): CORS proxy, by explicit decision

The evidence above was put to the repo owner, who chose to **relax the "no backend"
hard constraint** rather than abandon the named data sources. `CLAUDE.md` has been
updated to say so; it is a deliberate change to the brief, not a workaround smuggled
into the implementation.

`proxy/worker.js` is a Cloudflare Worker that forwards to the two aggregators and
adds the missing header. `index.html` gained a single `PROXY_BASE` constant and now
builds URLs as `PROXY_BASE + /<source>/v2/point/...`; everything else — polling,
normalising, extrapolation, the source toggle — is untouched. Deployment notes are
in `proxy/README.md`. The Worker is GET-only, restricted to these two upstreams,
`/v2/*` paths and known origins, so it is not a general open proxy, and it forwards
a descriptive `User-Agent` because of the finding above.

Verified by running the Worker's handler against the live upstream and driving the
real page with headless Chromium at a 390x844 viewport and a mocked Westminster fix:

- Cross-origin `fetch()` through the Worker returns `type: "cors"`, HTTP 200 and a
  readable body — 162 aircraft, the exact call that failed before.
- The full app renders: `OK · adsb.lol`, **163 aircraft**, sorted nearest first,
  e.g. `VLG368N A320 · 4,198 ft · 2.6 km · SSE (163°) · ↓ descending 576 ft/min`.
  No console errors, no page errors, no horizontal overflow, and rows still creep
  between polls, so extrapolation survived the change.
- Guards behave: a disallowed `Origin` gets 403, an unknown upstream 404, a non
  `/v2/` path 404, a `POST` 405.
- With `PROXY_BASE` left empty (as committed), the app says
  `No proxy configured — set PROXY_BASE in index.html (see proxy/README.md)` in red
  instead of repeating the old mystery failure.
- `airplanes.live` still answers **403** through the proxy, but that 403 is now
  *readable*, so the app reports `airplanes.live: HTTP 403` rather than
  `Load failed`. The fallback source stays dead until they grant access; adsb.lol
  works today.

The Worker was then deployed to
`https://microradar-proxy.throbbing-mountain-edd5.workers.dev` and `PROXY_BASE` set
to it. The committed `index.html` was re-run unmodified and builds
`/adsb.lol/v2/point/51.5007/-0.1246/40` — correct shape, no double slash from a
trailing base — rendering 173 aircraft with no errors.

### On the phone, round 1 (2026-09-22): `HTTP 429` / `HTTP 403`

First run against the deployed Worker gave `adsb.lol: HTTP 429` and
`airplanes.live: HTTP 403`. Both are *readable* statuses, which is itself the
proof that the CORS fix works — the app can only show a status code if it was
allowed to read the response, and only the Worker adds the header that permits
that. The old failure mode was the opaque `Load failed`.

The 429 therefore came through the Worker from adsb.lol, not from Cloudflare's
edge (a Cloudflare error page carries no ACAO and would have read as
`Load failed`). It is also not our request rate: 12 *simultaneous* requests from
a sandbox IP all returned 200, and adsb.lol sends no rate-limit headers. The
remaining difference is the source IP — Cloudflare Workers egress from addresses
shared with every other Workers customer. Unconfirmed, because this sandbox's
egress policy denies `workers.dev` and the live Worker cannot be called from here.

Two client-side faults were found and fixed while investigating:

1. **Poll chains could multiply.** `startPolling()` cleared only the tracked
   timer handle. An older `poll()` still awaiting its fetch would reach its
   `finally` and schedule another timeout, leaving two chains running with one
   handle tracked. Every `visibilitychange` or source tap during an in-flight
   request could add another — and a phone backgrounds constantly. Reproduced:
   three taps gave 6 requests per 30 s where one healthy chain gives 3-4. Fixed
   with a generation counter, so only the current chain schedules; the same test
   now gives 3.
2. **A failure was answered at full cadence.** Errors kept polling every 8 s,
   which is the worst possible response to a rate limit. Now backs off
   8 → 16 → 32 → 60 s and resets on success.

The app also shows the upstream body now, so a failure reads
`adsb.lol: HTTP 429 — {"detail":"..."} · retrying in 16s` rather than a bare code.

Neither fix is known to be the cause of the 429 — they reduce the request rate
and stop it being made worse, but if Cloudflare's shared egress IP is the real
problem they will not resolve it on their own.

**Still unverified:** everything iPhone-specific, plus the deployed Worker itself.
This sandbox's egress policy denies CONNECT to `workers.dev`, so the live Worker
could not be called from here; the runs above stand `proxy/worker.js` in for it
locally, against the live aggregator. All of it is desktop Chromium at phone size.
The remaining step is the owner's: open the Pages site on the phone and run
acceptance criteria 1-10.

### Round 2 (2026-09-22): the same proxy on Val Town — mostly 200, occasional 429

To test the shared-egress-IP theory without touching the Worker, `proxy/valtown.ts`
is `worker.js` with Val Town's export shape, deployed at
`https://micrologist--25362770b69011f19e211607ee4eb77e.web.val.run`, and
`PROXY_BASE` now points at it (the Worker URL is kept in a comment beside it).
`*.val.run` was allowlisted in the sandbox's egress policy, so unlike the Worker
this one was measured live.

Called from the sandbox with `Origin: https://micrologist.github.io`, exactly the
URL the app builds (`/adsb.lol/v2/point/51.5007/-0.1246/40`):

- **At the app's cadence, one request every 8 s for a minute: 7 of 8 returned
  200** with `access-control-allow-origin: https://micrologist.github.io`,
  `vary: Origin`, `cache-control: no-store` and 149–154 aircraft. **One returned
  429.** Its body is a bare nginx `429 Too Many Requests` page and it carries no
  `Retry-After` — so it is adsb.lol's nginx per-IP `limit_req`, not their
  application's JSON rate limiter, and it passed through the val with the CORS
  header intact, exactly as designed.
- A burst of five in ~15 s also produced one 429 (the fifth).
- **Control, same minute, direct from the sandbox's own IP: six requests in six
  seconds, all 200.** So the limit is per source IP, and the val's egress IP is
  shared with other Val Town tenants whose traffic consumes the same bucket.
- Guards: no `Origin` → `403 Origin not allowed`; `http://localhost:8000` is
  echoed back; `airplanes.live` through the val is still its own
  `403 "Please contact us at contact@airplanes.live..."`.
- val.run answers with `server: cloudflare` and `x-ratelimit-limit: 5000` /
  `-remaining` / `-reset` headers. Those are Val Town's own (adsb.lol sends none,
  and the val forwards only `Content-Type`); 5000 per window is Val Town's ceiling
  on the val, against ~450 requests/hour from the app.

**Reading.** The shared-IP theory holds: adsb.lol limits by source IP, a
datacentre IP shared with other tenants trips it, and Val Town's pool is simply
much less busy than Cloudflare Workers' — the Worker 429'd on the phone's first
request, the val 429s roughly one poll in eight. That is workable with the
backoff already in place: a 429 costs one poll, the last list stays on screen
with its age shown, and the next attempt succeeds. It is not fixable from our
side short of a proxy with an IP nobody else uses, and adsb.lol's README says an
API key scheme is coming, which would settle it properly.

One thing worth changing later: on a 429 the app flips to `airplanes.live`, which
is dead (403), so a single 429 currently costs three polls (8 → 16 → 32 s) before
adsb.lol is tried again. Not backing off *and* switching for a 429 would halve
that. Left as is for now; it is a tuning decision, not a fault.

Still unverified: the phone itself.

### Round 3 (2026-09-22): airplanes.live removed

Checked whether the fallback was deprecated: it is not — airplanes.live's status
repo (updated the same day) shows `api.airplanes.live` healthy at 99.95% uptime.
It is *gated*: 403 with "contact us at contact@airplanes.live" until approved, and
their API guide and homepage 403 the sandbox's IP too. By the owner's decision it
was removed rather than kept as a dead fallback, because each adsb.lol 429 flipped
to it, failed, and flipped back — three polls lost per miss instead of one. With a
single source a 429 now costs exactly one poll (8 → 16 s). `SOURCES` became
`SOURCE`, the source toggle button and `setSource`/`toggleSource` are gone, and
both proxy builds forward only `adsb.lol`. It can come back with one email; the
README in `proxy/` says where the lines go.

### What was verified in the sandbox

Headless Chromium (Playwright, 390x844 viewport) against `python3 -m http.server`,
plus the pure functions run in Node with a small DOM stub:

- Cold load: no console errors, no page errors, no placeholder text left, no
  horizontal overflow, body text 16px, buttons 44.4px tall.
- `locate()` with a mocked fix fills `#me` and flips the button to
  "Refresh position". Denying the permission leaves the page intact and shows
  "Location permission denied" in red.
- The polled URL comes out as
  `https://api.adsb.lol/v2/point/51.5007/-0.1246/40` — 4 dp as planned.
- `normalise()` against hand-written entries: padded callsign trimmed, `"ground"`
  becomes altitude 0 with `onGround`, entries with no `lat`/`lon` or
  `seen_pos > 60` dropped, missing callsign falls back to registration then hex.
- `toENU()` and the bearing match the plan's hand-computed cases: 1111.9 m north
  for 0.01° at the equator, 556.0 m east for 0.01° at lat 60, 74080 m for 40 nm,
  11582 m up for 38000 ft.
- `extrapolate()`: 2315 m after 10 s at 450 kt, clamped at `STALE_S`, altitude
  tracks `baro_rate`, input never mutated, unchanged when on the ground or when
  `track`/`gs` are missing.
- Rendering a stubbed response: sorted nearest first, stale entry dropped, and a
  callsign of `<img src=x onerror=alert(1)>` renders as text with no dialog.
- With a stubbed source, distance creeps ~0.23 km every 500 ms and snaps back on
  each 8 s poll — extrapolation and reset both work.
- Automatic fallback: with the primary aborting, the next poll uses
  airplanes.live and the button label follows. Manually toggling back onto the
  broken source shows the error while the last good list stays on screen with its
  age in `#meta`.
- `visibilitychange`: zero requests while hidden, exactly one on return.

### Deviations from the plan

- `describe()` also returns `gsText` and an `ageText`, and formats the vertical
  rate as `↑ climbing 1,200 ft/min`, so the second line of each `<li>` matches the
  sample layout in the plan. The plan left the exact strings to the implementer.
- `render()` calls `renderMe()` each tick so the fix age counts up rather than
  freezing at the value it had when the fix arrived.
- The automatic source switch goes through a small `setSource(i)` helper so the
  button label cannot drift out of sync with `state.sourceIndex`. The plan asked
  for that behaviour without naming a function.
- `FPM_TO_MPS` is declared as the plan's constant table requires but is unused:
  `extrapolate()` works in feet and ft/min throughout and only converts at the
  `toENU()` boundary. Milestone 2 will probably want it.
- `EARTH_R` is the name used for the plan's `R`, to avoid a one-letter global.

### Still to do on the phone

Acceptance criteria 1-10 in this plan have not been run on an iPhone. Criteria
2, 6 and 10 were checked in desktop Chromium at phone viewport size; criteria 3,
4, 5, 7, 8 and 9 were checked against stubbed responses only, so they confirm the
app logic but not the live API.
