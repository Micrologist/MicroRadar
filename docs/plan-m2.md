# Milestone 2 plan: 3D scene with CesiumJS

Goal: after "Find me", the page shows a 3D view of the sky around you — a map of
where you are, the aircraft from the milestone 1 list drawn at their real position
and altitude, each with a heading line, a stalk to the ground and a callsign — and
you can orbit, tilt and zoom it with your fingers. The text list stays underneath.

**Decision (2026-09-22): the renderer is CesiumJS, not three.js.** The owner asked
for this change and `CLAUDE.md` has been updated to match. Cesium is a virtual globe,
so it takes latitude, longitude and altitude directly and gives us the ground, the
map and the camera controls for free; the ENU maths from milestone 1 stays for the
distances and bearings in the list. The cost is a 6 MB library (1.75 MB compressed)
and the discipline of using it without a Cesium ion account, which is worked out
below and was verified in the sandbox.

Read `CLAUDE.md` first. Its hard constraints apply to everything below. If this plan
conflicts with `CLAUDE.md`, `CLAUDE.md` wins; stop and say so.

## Scope

In scope:

- Load CesiumJS from a CDN by `<script>` tag, pinned to `1.145.0`, with no ion
  token and no ion assets.
- A `Viewer` in a fixed-height box between the header and the controls: a globe
  with OpenStreetMap tiles (no key), no terrain, no widgets, no atmosphere.
- The user drawn at their position, with range rings and N/E/S/W on the ground.
- Each aircraft as a point, a line ahead along its track, a stalk to the ground and
  a callsign label. Positions extrapolated every frame, reset on every poll.
- Orbit camera centred on the user, plus a "Recentre" button.
- Graceful fallback: if the library or WebGL fails, the milestone 1 list still works
  and the status line says why there is no 3D.

Out of scope (later milestones): device orientation, tapping an aircraft, altitude
colour coding, `localStorage`, terrain, 3D aircraft models. Do not pre-build any of it.

## Feasibility probe (sandbox, 2026-09-22)

The planning session ran a throwaway page — not app code — against the `cesium`
npm package (1.145.0, published 2026-09-15), served from a second local origin so
that it behaved like a CDN, in headless Chromium at 390×844 with WebGL 2 via
SwiftShader. Findings the plan below relies on:

- **Cesium works without ion.** With `baseLayer: false` (or the OSM provider), no
  terrain and the geocoder/base-layer picker off, the page made **no request to any
  host** other than its own origin, the Cesium origin and (OSM variant)
  `tile.openstreetmap.org`. `Cesium.Ion.defaultAccessToken = ''` caused no error
  and no warning. The token built into 1.145.0 is labelled "Delete on November 1,
  2026" — one more reason never to depend on it.
- **Cross-origin loading works, and needs CORS on the CDN.** Cesium creates its web
  workers from a blob `import "…/Workers/x.js"` when the base URL is another
  origin, and fetches `Assets/approximateTerrainHeights.json`,
  `Assets/IAU2006_XYS/IAU2006_XYS_18.json`, ~25 `Workers/*.js` chunks and
  `Assets/Images/ion-credit.png` by XHR. With `Access-Control-Allow-Origin: *`
  on the Cesium origin everything loaded and the globe's tiles were ready in
  **2.1 s**; without it the JSON assets are blocked and the globe never appears.
  Public CDNs send that header; a plain file server does not (see verification).
- **What a first load downloads:** `Cesium.js` 6,018,837 B raw / 1,753,483 B gzip,
  `Widgets/widgets.css` 30 KB / 6 KB, the two JSON assets 300 KB + 65 KB raw
  (98 KB + 28 KB gzip), plus the worker chunks (~1.3 MB folder, a fraction used).
  Budget ~2.2 MB compressed on first visit, cached afterwards.
- **Primitives are cheap.** 200 fake aircraft as `PointPrimitiveCollection` +
  `LabelCollection` + two `PolylineCollection` lines each, all four positions
  rewritten every frame from the extrapolation maths: **1.4–1.9 ms of JS per
  frame**. A phone will be slower, but nowhere near a 33 ms frame budget.
- Range rings drawn as 72-segment polylines at height 0, compass letters as
  labels and the user as a point render correctly from a 45° orbit view.
- `Widgets/widgets.css` already sets `touch-action: none` on the canvas.
- `viewer.camera.lookAt(userPosition, HeadingPitchRange)` gives an orbit centred
  on the user with the default controller.
- Cesium's credit display shows a "Cesium ion" logo even when ion is unused. It
  is Cesium's own attribution (Apache-2.0); keep it, but put it in the footer.

Not verifiable from the sandbox: cdnjs and jsdelivr are both blocked by its egress
policy, `tile.openstreetmap.org` too, and there is no iPhone. See Unknowns.

## File structure

Everything stays in `index.html`. No new files besides this plan. Two external
resources, both from the same pinned CDN folder, and one global set before the
script loads:

```html
<!-- in <head> -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cesium/1.145.0/Widgets/widgets.css">
<script>window.CESIUM_BASE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/cesium/1.145.0/';</script>

<!-- at the end of <body>, immediately before the app's own <script> -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/cesium/1.145.0/Cesium.js"></script>
```

Rules:

- The `CESIUM_BASE_URL` folder must be the one that contains `Cesium.js`,
  `Widgets/`, `Workers/` and `Assets/` side by side (the npm package's
  `Build/Cesium/`). Cesium loads workers and assets relative to it.
- The script tag goes at the end of `<body>`, not in `<head>`, so the header,
  status line and list markup paint before the 1.75 MB download. Give `#status`
  the initial HTML text `Loading 3D library…`; the app script overwrites it.
- `cdnjs` is the CDN `CLAUDE.md` names. If it does not carry `1.145.0` with the
  `Workers/` and `Assets/` folders (see Unknowns), use jsdelivr's mirror of the npm
  package instead — `https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium/`
  as the base and the same three tags — and say so in the PR and in `CLAUDE.md`.
  Check by opening `<base>Widgets/widgets.css`, `<base>Cesium.js`,
  `<base>Workers/createVerticesFromHeightmap.js` and
  `<base>Assets/approximateTerrainHeights.json` in a browser: all four must be 200.
- No `defer`, no `type="module"`, no ES imports. The global `Cesium` is the API.

## Page layout

Same single column as milestone 1, with the scene inserted under the header:

```
<header>                      unchanged (h1 + #status; #status starts as "Loading 3D library…")
<div id="scene"></div>        the Cesium container, 60vh tall, min 300px, rounded corners
<div id="controls">
  <button id="btn-locate">    Find me / Refresh position (unchanged)
  <button id="btn-recentre">  Recentre — puts the camera back on the user
</div>
<div id="me">                 unchanged
<ol id="aircraft">            unchanged list, still sorted nearest first
<footer id="meta">            unchanged text
<div id="credits"></div>      Cesium's credit container (OSM attribution + Cesium logo), small, dim
```

CSS notes: `#scene { height: 60vh; min-height: 300px; border-radius: 10px;
overflow: hidden; background: #1b2a1e; }`. Cesium's own `.cesium-viewer` fills its
container. `#credits` gets the `#meta` monospace styling at 12px; Cesium injects
`.cesium-credit-*` markup into it. Do not use `100vh` for the scene: iOS Safari's
toolbars make `100vh` taller than the visible area. The page still scrolls when a
finger starts outside the scene; inside it Cesium owns the touches (its CSS sets
`touch-action: none` on the canvas).

## Constants

Add to the existing table at the top of the script:

| Name | Value | Note |
|---|---|---|
| `IMAGERY_URL` | `'https://tile.openstreetmap.org/'` | OSM tiles, no key. Set to `''` for a plain coloured globe. |
| `TARGET_FPS` | `30` | `viewer.targetFrameRate`. Enough for smooth movement, half the battery of 60. |
| `CAMERA_RANGE_M` | `60000` | Distance from the user for the initial/recentred view. |
| `CAMERA_PITCH_DEG` | `-45` | Looking down at 45°. |
| `MIN_ZOOM_M` / `MAX_ZOOM_M` | `300` / `400000` | Zoom limits on the screen-space camera controller. |
| `RING_KM` | `[10, 25, 50]` | Range rings on the ground. |
| `RING_HEIGHT_M` | `5` | Rings sit slightly above the ellipsoid so their chords never dip below it. |
| `RING_SEGMENTS` | `72` | Points per ring. |
| `NOSE_S` | `30` | Heading line length: where the aircraft will be in this many seconds. |
| `AC_COLOR` | `'#ffa500'` | Airborne aircraft. |
| `GROUND_COLOR` | `'#8b93ad'` | Aircraft on the ground or with unknown altitude. |
| `ME_COLOR` | `'#6ea8ff'` | The user marker; same as the CSS accent. |

Keep every milestone 1 constant as it is, including `POLL_MS`, `RADIUS_NM`,
`TICK_MS` and `STALE_S`. `FPM_TO_MPS` may be deleted; nothing uses it.

## State

`state` (data) is unchanged. Add a second module-level object for the 3D side so
data and rendering do not mix:

```
view3d = {
  ready: false,       // true once initScene() succeeded
  viewer: null,       // Cesium.Viewer
  points: null,       // PointPrimitiveCollection — aircraft dots
  labels: null,       // LabelCollection — aircraft callsigns
  lines: null,        // PolylineCollection — stalks and heading lines
  ground: null,       // PolylineCollection — range rings
  groundLabels: null, // LabelCollection — N/E/S/W and ring distances
  mePoint: null,      // the user's point primitive
  marks: new Map(),   // hex -> { point, label, stalk, nose }
  stalkMaterial: null, noseMaterial: null,  // shared Color materials, created once
}
```

## Functions

Milestone 1 functions keep their names and signatures. Changes to existing ones are
listed first, then the new ones in implementation order.

### Changes to existing functions

- `normalise(raw, now)`: track becomes `raw.track`, else `raw.calc_track`, else
  `null` — with `typeof === 'number'` checks, as for the other fields. Milestone 1
  found `track` missing on 32% of aircraft and `calc_track` present on some of
  those. Nothing else changes.
- `extrapolate(ac, now)`: keep its behaviour and signature exactly, but move the
  "advance by `dt` seconds along `track`" maths into `advance(ac, dtS)` (below)
  and have `extrapolate` compute the clamped `dt` and call it. The 3D heading line
  needs the same maths with a fixed `dt`.
- `onFix(pos)`: after `renderMe()`, and before `startPolling()`, call
  `buildGround(state.me)` and `resetCamera()` if `view3d.ready`.
- `poll(gen)`: after `state.aircraft = …` and before `render()`, call `syncMarks()`.
- `render()`: unchanged. It still rebuilds the list every `TICK_MS`. The 3D side
  is updated per frame by `updateScene()`, not by `render()`.
- Page load: wire `#btn-recentre` to `resetCamera`, call `initScene()` once before
  the existing `setStatus(...)` line, and let that status text depend on the
  outcome (below).

### `offsetLatLon(lat, lon, eM, nM)`

Pure. The inverse of `toENU`: returns `{ lat, lon }` moved `eM` metres east and
`nM` metres north on the equirectangular approximation:

```
lat' = lat + (nM / EARTH_R) * 180/π
lon' = lon + (eM / (EARTH_R * cos(lat°))) * 180/π
```

Used by `advance` and `buildGround`.

### `advance(ac, dtS)`

Pure. Returns a copy of `ac` moved `dtS` seconds along its track, or `ac` itself
when `gsKt` or `track` is null or `onGround`:

```
dist = ac.gsKt * KT_TO_MPS * dtS
{ lat, lon } = offsetLatLon(ac.lat, ac.lon, dist * sin(track°), dist * cos(track°))
altFt = typeof ac.altFt === 'number' ? ac.altFt + ac.vsFpm * dtS / 60 : ac.altFt
```

`extrapolate(ac, now)` becomes `advance(ac, clamp((now - ac.fixedAt) / 1000, 0, STALE_S))`.

### `cartesianOf(lat, lon, altFt)`

`Cesium.Cartesian3.fromDegrees(lon, lat, (altFt ?? 0) * FT_TO_M)`. **Note the
argument order: Cesium takes longitude first.** Every position handed to Cesium
goes through this one function so the order is wrong in at most one place. No
terrain is loaded, so height 0 is the WGS84 ellipsoid; ADS-B `alt_geom` is a
GNSS height above that same ellipsoid, and `alt_baro` is close enough at this
scale (tens of metres of geoid and QNH error against thousands of metres of
altitude). The user is drawn at height 0 too — see Unknowns for what iOS reports.

### `initScene()`

Creates the viewer. Must never throw; returns `true`/`false` and sets `view3d.ready`.

- If `typeof Cesium === 'undefined'`, hide `#scene` (`display: none`) and return
  `false`. The status line at page load then reads
  `3D library failed to load — list only. Tap "Find me" to start` in red.
- `Cesium.Ion.defaultAccessToken = ''` — first line, before any Cesium object is
  created, so that nothing can fall back to the built-in demo token.
- Wrap the constructor in try/catch: Cesium throws a `RuntimeError` when WebGL is
  unavailable. On catch, same fallback as above with the text
  `3D unavailable (<err.message>) — list only`.

```
new Cesium.Viewer('scene', {
  baseLayer: IMAGERY_URL
    ? new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({ url: IMAGERY_URL }))
    : false,
  terrain: undefined,                 // plain ellipsoid; Cesium World Terrain needs ion
  animation: false, timeline: false, geocoder: false, homeButton: false,
  sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false,
  fullscreenButton: false, infoBox: false, selectionIndicator: false,
  skyBox: false, skyAtmosphere: false,
  creditContainer: 'credits',
  targetFrameRate: TARGET_FPS,
})
```

Then:

- `scene.globe.baseColor = Color.fromCssColorString('#1b2a1e')` (what shows before
  tiles arrive and everywhere when `IMAGERY_URL` is empty);
  `scene.globe.showGroundAtmosphere = false`; `scene.fog.enabled = false`;
  `scene.backgroundColor = Color.fromCssColorString('#0b1020')`.
- `scene.screenSpaceCameraController.minimumZoomDistance = MIN_ZOOM_M`,
  `.maximumZoomDistance = MAX_ZOOM_M`. Leave `enableCollisionDetection` on so the
  camera cannot go under the ground.
- Create the collections in `view3d` with `scene.primitives.add(new Cesium.X())`:
  `ground` and `groundLabels` first, then `lines`, `points`, `labels`.
- `view3d.stalkMaterial = Cesium.Material.fromType('Color', { color: Color.fromCssColorString(AC_COLOR).withAlpha(0.4) })`,
  `view3d.noseMaterial` the same at full alpha. One material instance shared by
  all polylines of a kind is what lets the collection batch them.
- `scene.preUpdate.addEventListener(updateScene)`.
- Point the camera at Europe-ish from far away until a fix arrives (whatever
  `camera.setView` default; not important), `view3d.ready = true`, return `true`.

Leave `useBrowserRecommendedResolution` at its default (`true`): Cesium then
renders at CSS pixels, not device pixels, which is the right trade on a phone.
Leave `requestRenderMode` off; positions change every frame anyway.

### `buildGround(me)`

Called on every fix. `removeAll()` on `view3d.ground` and `view3d.groundLabels`,
remove `view3d.mePoint` from `view3d.points` if set, then:

- `view3d.mePoint = view3d.points.add({ position: cartesianOf(me.lat, me.lon, 0), pixelSize: 10, color: ME_COLOR, outlineColor: black, outlineWidth: 1 })`.
- For each `km` in `RING_KM`: `RING_SEGMENTS + 1` positions around the user
  (`offsetLatLon(me.lat, me.lon, r·sin θ, r·cos θ)` at height `RING_HEIGHT_M`,
  closing back on the first), added to `view3d.ground` as one polyline, width 1,
  colour white at alpha 0.35. Plus one label `"${km} km"` at the ring's northern
  point in `view3d.groundLabels`, 12px, dim, `verticalOrigin: Cesium.VerticalOrigin.BOTTOM`.
- Compass letters N, E, S, W as labels at `RING_KM[last] * 1.1` km along bearings
  0/90/180/270, bold 16px white with a black outline
  (`style: Cesium.LabelStyle.FILL_AND_OUTLINE`, `outlineWidth: 2`), height `RING_HEIGHT_M`.

All ground labels get `disableDepthTestDistance: Number.POSITIVE_INFINITY` so the
globe never hides them at low tilt.

### `resetCamera()`

```
viewer.camera.lookAt(
  cartesianOf(state.me.lat, state.me.lon, 0),
  new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(CAMERA_PITCH_DEG), CAMERA_RANGE_M)
);
```

`lookAt` also installs a transform centred on the user, so the default controller
orbits around them: one finger drags rotate the view around you, pinch zooms,
two-finger drag tilts (desktop: left drag, wheel, middle/ctrl-drag). Heading 0
means the camera sits south of the user looking north, so north is up on first
view. No-op when `!view3d.ready || !state.me`.

### `syncMarks()`

Called once per successful poll. Reconciles `view3d.marks` with `state.aircraft`
by `hex`:

- For each aircraft without a mark: add one — `point` (`pixelSize: 8`),
  `label` (`text: callsign`, `font: '13px -apple-system, system-ui, sans-serif'`,
  `style: Cesium.LabelStyle.FILL_AND_OUTLINE`, white with 2px black outline,
  `pixelOffset: new Cesium.Cartesian2(0, -12)`, `verticalOrigin: Cesium.VerticalOrigin.BOTTOM`,
  `disableDepthTestDistance: Number.POSITIVE_INFINITY`), `stalk` and `nose`
  (`positions: [p, p]` placeholders, width 1 / 2, the shared materials).
- For each existing mark: update `label.text` (a callsign can appear after the
  first sighting) and the colour: `AC_COLOR` when airborne with a numeric altitude,
  `GROUND_COLOR` otherwise.
- For each mark whose hex is no longer in `state.aircraft`: remove its four
  primitives from their collections and delete the map entry. Since milestone 1
  already drops aircraft with `seen_pos > STALE_S`, this is what makes departed
  aircraft disappear.

Positions are not set here; `updateScene` does that on the next frame.

### `updateScene()`

Runs every frame from `scene.preUpdate`. Returns immediately when `!state.me`.

```
now = Date.now()
for each ac in state.aircraft:
  m = view3d.marks.get(ac.hex); if (!m) continue
  p = extrapolate(ac, now)
  pos = cartesianOf(p.lat, p.lon, p.altFt)
  m.point.position = pos
  m.label.position = pos
  airborne = !p.onGround && typeof p.altFt === 'number'
  m.stalk.show = airborne
  if (airborne) m.stalk.positions = [pos, cartesianOf(p.lat, p.lon, 0)]
  hasTrack = p.gsKt !== null && p.track !== null && !p.onGround
  m.nose.show = hasTrack
  if (hasTrack) { q = advance(p, NOSE_S); m.nose.positions = [pos, cartesianOf(q.lat, q.lon, p.altFt)] }
```

Note the heading line ends at the aircraft's *current* altitude, not the climbed
one, so it stays level and reads as a direction. `extrapolate` already clamps to
`STALE_S`, so an aircraft that stops reporting freezes after a minute instead of
flying off; with the data lost entirely, the last poll's list stays, exactly as in
milestone 1. Because `state.aircraft` is replaced on every poll, the frame after a
poll snaps every mark to its new fix — the "reset on each new fix" from `CLAUDE.md`.

Keep this function allocation-light but do not optimise beyond that: the probe
measured ~1.5 ms for 200 aircraft doing exactly this.

### Page load

```
$('btn-locate').addEventListener('click', locate);
$('btn-recentre').addEventListener('click', resetCamera);
document.addEventListener('visibilitychange', onVisibilityChange);
setInterval(render, TICK_MS);
const has3d = initScene();
setStatus(!PROXY_BASE ? '<existing proxy message>'
        : has3d ? 'Tap "Find me" to start'
        : '<the failure text initScene stored>', !PROXY_BASE || !has3d);
```

`initScene()` should stash its failure text somewhere simple (`view3d.error`) so the
status line can show it.

## Error handling that must exist

- Library missing (CDN down, content blocker): list works, scene hidden, red
  status naming the cause. Test by pointing the script tag at a bogus host.
- WebGL unavailable: same, with Cesium's error message.
- OSM tiles failing: the globe shows `baseColor` where tiles are missing; nothing
  else breaks. Cesium retries tile loads on its own; do not add code for it.
- Aircraft with `altFt === null`: drawn at height 0 in `GROUND_COLOR` with no
  stalk, so it is still visible and still in the list with `alt ?`.
- Never let an exception escape `updateScene()` — it runs every frame. A single
  bad aircraft must not stop the scene: wrap the per-aircraft body in try/catch
  and `console.warn` once per hex.

## Implementation steps

1. **Loader and empty scene.** Tags, `#scene`, `#credits`, `#btn-recentre`,
   constants, `view3d`, `initScene()`, the page-load wiring. Verify in the sandbox
   (recipe below) that the globe appears, that the only external host contacted
   besides the CDN mirror is `tile.openstreetmap.org`, and that a bogus script URL
   gives the list-only fallback with a red status. Commit.
2. **Ground.** `offsetLatLon`, `buildGround`, `resetCamera`, `onFix` changes.
   Verify with a mocked fix: user dot, three rings with their labels, N/E/S/W
   around it, camera looking north from 45°. Commit.
3. **Aircraft.** `advance` refactor, `calc_track`, `cartesianOf`, `syncMarks`,
   `updateScene`, `poll` change. Verify with a stubbed response (see M1 results for
   a real aircraft object): dots at plausible places, stalk to ground, heading line
   pointing along `track`, label on each, marks removed when an aircraft drops out
   of the stub, smooth per-frame motion that snaps on the next poll. Commit.
4. **Phone tuning.** Scene height, credit styling, `targetFrameRate`, atmosphere
   and fog off, zoom limits. Screenshot at 390×844 and 844×390. Commit.
5. Push, wait for Pages, test on the iPhone. Fill in the results section below.

## How to verify from the sandbox

The CDNs are blocked by the sandbox's egress policy but `registry.npmjs.org` is
allowed, so mirror the package locally and stand it in for the CDN:

```
curl -sS -o cesium.tgz https://registry.npmjs.org/cesium/-/cesium-1.145.0.tgz
mkdir -p cdn && tar -xzf cesium.tgz -C cdn --strip-components=1 package/Build/Cesium
```

Serve `cdn/Build/Cesium` on a second port **with a CORS header** — Cesium fetches
its assets and workers cross-origin, and without `Access-Control-Allow-Origin` the
globe never loads (the probe hit exactly this). Ten lines of Python:

```python
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 8001), H).serve_forever()
```

Then make a scratch copy of `index.html` with the CDN base replaced by
`http://127.0.0.1:8001/Build/Cesium/` (the three tags and nothing else), serve it
with `python3 -m http.server 8000`, and drive it with the globally installed
Playwright (`NODE_PATH=$(npm root -g) node …`). Launch Chromium with
`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` for
WebGL 2 in software, viewport 390×844, `deviceScaleFactor: 2`. Log `request`,
`requestfailed`, `console` and `pageerror`. Wait for
`viewer.scene.globe.tilesLoaded` (2 s in the probe) and screenshot. Mock
geolocation with `context.grantPermissions(['geolocation'])` +
`context.setGeolocation(...)`, and stub the poll by routing the `PROXY_BASE` URL to
a canned `{ ac: [...] }` body. The maths (`offsetLatLon`, `advance`) can be checked
in Node with a DOM stub as milestone 1 did: `offsetLatLon` must invert `toENU` to
within a metre at 50 km, and `advance(ac, 30)` at 400 kt must move ~6,173 m.

Do not commit any of the probe tooling.

## Acceptance criteria (check on an iPhone, Safari, via GitHub Pages)

1. Page loads; the status goes from "Loading 3D library…" to "Tap "Find me" to
   start" and the scene box shows a globe with map tiles within ~10 s on Wi-Fi.
2. "Find me" centres the map on you: blue dot, three rings labelled 10/25/50 km,
   N/E/S/W around them, north at the top, tilted view.
3. Aircraft appear as orange dots with a stalk to the ground, a short line ahead
   and a callsign, and their number matches the list.
4. Dots move smoothly (no 2 Hz stepping) and do not jump wildly on the poll.
5. One-finger drag orbits around you, pinch zooms between the limits, two-finger
   drag tilts, and "Recentre" restores the first view.
6. Dragging outside the scene scrolls the page; double-tapping inside it does not
   zoom the page.
7. Rotating to landscape resizes the scene without distortion; rotating back too.
8. Locking the phone and coming back resumes the scene with no error overlay, and
   polling resumes as in milestone 1.
9. Airplane mode after a fix: red status, the last aircraft stay drawn and freeze
   after a minute, the list stays.
10. The OpenStreetMap attribution and the Cesium logo are visible in the footer,
    not on top of the map.
11. After ten minutes on the page the phone is not hot and Safari has not reloaded
    the page for using too much memory.
12. Milestone 1 criteria 1–10 still hold.

## Unknowns (cannot be verified from the sandbox)

- **Does cdnjs carry Cesium 1.145.0 with the `Workers/` and `Assets/` folders?**
  The sandbox cannot reach cdnjs or jsdelivr. cdnjs sometimes lags npm and
  sometimes omits large asset folders. The four-URL check in "File structure" is
  the first thing the implementation session does, from any browser. jsdelivr
  mirrors npm verbatim and is the fallback. Vendoring 23 MB of Cesium into the
  Pages repo is a last resort and needs the owner's say-so.
- **OpenStreetMap tiles from a phone via GitHub Pages.** The provider requests
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, which is right, but the
  sandbox could not fetch any. OSM's tile usage policy allows light use like this
  with attribution, which the credit container provides; if tiles ever come back
  4xx, set `IMAGERY_URL = ''` for the plain globe rather than adding a key.
- **iOS Safari memory.** Parsing 6 MB of JS plus WebGL is the heaviest thing this
  page will ever do. Safari kills and reloads pages under memory pressure. If that
  happens, the knobs are `scene.globe.maximumScreenSpaceError` (2 → 4),
  `viewer.resolutionScale` (< 1) and `IMAGERY_URL = ''`; note which one helped.
- **Gestures on iOS with a `lookAt` transform.** Rotate/zoom/tilt mapping is from
  Cesium's documentation and the probe was mouse-less. Check criterion 5 and write
  down what each gesture actually does.
- **Label sharpness.** With `useBrowserRecommendedResolution` on, the canvas is
  rendered at CSS pixels on a 3× display; labels may look soft. If so, try
  `resolutionScale = 2` and watch criterion 11.
- **Battery at 30 fps.** Unknown; criterion 11 is the proxy.
- **What `coords.altitude` means on iOS** (ellipsoid or MSL, and how often it is
  null). The user is drawn at height 0; record the value so milestone 4 can decide.
- **Whether `touch-action: none` on the canvas stops the double-tap zoom** on iOS
  Safari (criterion 6).
- **Landscape resize** (criterion 7): Cesium resizes with its container; iOS
  orientation change sometimes leaves stale `vh` values.

## Results

_Written by the implementation session, 2026-09-22. Everything below is headless
Chromium 141 at 390x844 (deviceScaleFactor 2, WebGL 2 via SwiftShader) against the
real cdnjs and the real OpenStreetMap tiles, with a mocked Westminster fix and a
stubbed poll response. **Nothing here is an iPhone.** See "Still to do on the
phone"._

### The CDN question is settled: cdnjs

The sandbox's egress policy now allows `cdnjs.cloudflare.com` and
`tile.openstreetmap.org`, so the plan's main unknown was answered directly rather
than through the npm mirror. All four check URLs answer **200 with
`access-control-allow-origin: *`**:

| URL under `https://cdnjs.cloudflare.com/ajax/libs/cesium/1.145.0/` | result |
| --- | --- |
| `Widgets/widgets.css` | 200, `text/css` |
| `Cesium.js` | 200, **6,018,837 B** — byte-identical in size to the npm build the probe measured |
| `Workers/createVerticesFromHeightmap.js` | 200, `application/javascript` |
| `Assets/approximateTerrainHeights.json` | 200, `application/json` |
| `Assets/IAU2006_XYS/IAU2006_XYS_18.json` | 200, `application/json` |

So the three tags point at cdnjs, the jsdelivr fallback is not used, and
`CLAUDE.md` needs no change.

### What the browser did

- **Cold load:** globe up with OSM tiles in **4.3 s** (first visit, nothing
  cached, through the sandbox's egress proxy).
- **Hosts contacted:** `cdnjs.cloudflare.com` (28 requests: the library, the CSS,
  the JSON assets and ~25 worker chunks), `tile.openstreetmap.org`, the page's own
  origin, and two blob worker URLs. **No ion, no other host.**
  `Cesium.Ion.defaultAccessToken` reads `""` at runtime.
- **Ground:** one user point, 3 ring polylines, 7 ground labels (3 distances +
  N/E/S/W), camera at heading 0, pitch -45.4 deg, 42,567 m up — i.e. 60,000 m
  from the user, north up.
- **Aircraft**, from a stubbed response built from the milestone 1 sample:

  | case | result |
  | --- | --- |
  | airliner, `alt_geom` 16,525 ft, 366 kt, track 321 | orange dot at 5,065 m, stalk shown, nose line 5,664 m (366 kt x 30 s = 5,652 m), label `RYR7ZW` |
  | `alt_baro: "ground"` | grey dot at height 0, **no stalk, no nose line**, does not move between polls |
  | no `track`, only `calc_track` | moves 169 m in 3 s at 110 kt (expected 170 m) — the `calc_track` fallback works |
  | no altitude at all | grey dot at height 0, no stalk, still listed as `alt ?` |
  | present in poll 1, absent from poll 2 | mark gone: 4 marks, 5 points (4 + the user), 4 labels, 8 lines |

- **Movement:** positions advance every frame and snap on each poll; measured
  563 m in 3 s for a 366 kt target (expected 565 m).
- **Cost:** `updateScene()` with **200 aircraft is 0.8 ms median, 8.6 ms worst**
  of 50 calls, in software-rendered Chromium. The plan's 1.4-1.9 ms estimate was
  pessimistic. A phone's GPU does the drawing; this is the JS.
- **Camera:** left-drag orbits (range to the user stays exactly 60,000 m while
  latitude/longitude change), wheel zooms and clamps at **299 m** and
  **397,813 m** against limits of 300 m and 400,000 m, and "Recentre" restores
  the initial camera **exactly** (same position, height, heading and pitch).
  A flick leaves Cesium's inertia running for a moment, so a recentre pressed
  during the spin lands a degree or two off and settles.
- **Resize:** portrait 366x506 CSS px, landscape 712x300 (the `min-height: 300px`
  wins over `60vh` at 390 px tall), back to 366x506. The drawing buffer always
  matches the CSS size exactly and the frustum aspect ratio follows, so no
  distortion; no horizontal page overflow in either orientation.
  `touch-action` computes to `none` on the canvas, from Cesium's own CSS.
- **Backgrounding:** zero polls while `document.hidden`, exactly one on return,
  no Cesium error panel afterwards.
- **Network loss after a fix:** red status
  `adsb.lol: Failed to fetch · retrying in 16s`, marks and list both stay, and
  the marks keep extrapolating until `STALE_S` and then freeze.
- **Fallbacks**, each one exercised:

  | failure | at page load | after that |
  | --- | --- | --- |
  | script tag pointed at a bogus host | red `3D library failed to load — list only` | scene `display: none`, list polls and renders normally |
  | Chromium launched with `--disable-3d-apis` | red `3D unavailable (The browser supports WebGL, but initialization failed.) — list only` | same |
  | `tile.openstreetmap.org` blocked | normal | globe shows `baseColor` and the rings, labels, user and aircraft all still read — this is what `IMAGERY_URL = ''` would look like |

### Deviations from the plan

1. **Ring colour and width.** The plan says white, alpha 0.35, width 1. On the
   screenshot that is *invisible* over OSM tiles — only the "10 km" labels showed.
   Changed to black at alpha 0.5, width 2, which reads over map, sea and the plain
   globe. Acceptance criterion 2 needs the rings to be visible; the constant was
   the thing in the way.
2. **The credit container needed CSS.** `widgets.css` gives
   `.cesium-widget-credits` `position: absolute; bottom: 0; left: 0` unless it is
   inside a `.cesium-viewer` element. Ours is not, so it anchored to the page and
   sat on top of the map and the list. `#credits .cesium-widget-credits {
   position: static }` puts it back in the flow, and criterion 10 then holds.
3. **The OSM credit is created explicitly**, with `showOnScreen: true`:
   `credit: new Cesium.Credit('© <a ...>OpenStreetMap</a> contributors', true)`.
   Without it Cesium hides the attribution behind its "Data attribution" lightbox
   link, which is not "visible" in the sense OSM's tile policy means.
4. **`RING_HEIGHT_FT`** exists because `cartesianOf()` takes feet and
   `RING_HEIGHT_M` is metres; it is just `RING_HEIGHT_M / FT_TO_M` computed once.
5. **`AC_COLOR`/`GROUND_COLOR` are parsed into `Cesium.Color` once**
   (`view3d.airColor`, `view3d.groundColor`) instead of per aircraft per poll.
6. **`view3d.warned`** is the `Set` behind "console.warn once per hex".
7. `FPM_TO_MPS` was deleted, as the plan allows.

### Unknowns, updated

| Unknown | Now |
| --- | --- |
| Does cdnjs carry 1.145.0 with `Workers/` and `Assets/`? | **Answered: yes**, with `ACAO: *`. |
| OSM tiles from a phone | Tiles fetch fine from the sandbox and render. The phone is still untested, but the blocked-tile path was exercised and degrades cleanly. |
| iOS Safari memory | **Still unknown.** Knobs unchanged: `globe.maximumScreenSpaceError`, `viewer.resolutionScale`, `IMAGERY_URL = ''`. |
| Gestures on iOS with a `lookAt` transform | Desktop equivalents confirmed (left-drag orbits at constant range, wheel zooms within the limits). Touch mapping still unverified. |
| Label sharpness | `useBrowserRecommendedResolution` confirmed: the drawing buffer is 366x506 at `deviceScaleFactor: 2`, i.e. CSS pixels. So labels *will* be rendered at 1x on a 3x phone screen. Whether that looks soft is still a phone question. |
| Battery at 30 fps | **Still unknown.** `targetFrameRate` reads 30 at runtime. |
| `coords.altitude` on iOS | **Still unknown**; the user is drawn at height 0. |
| Double-tap zoom on iOS | `touch-action: none` is confirmed on the canvas. Whether that is enough for Safari is still unverified. |
| Landscape resize | Confirmed in Chromium: canvas, drawing buffer and frustum all follow the container, both ways. iOS `vh` behaviour still unverified. |

### Still to do on the phone

Acceptance criteria 1-12 have not been run on an iPhone. Criteria 2, 3, 4, 8, 9,
10 and 12 were checked in desktop Chromium at phone viewport size against stubbed
data; criteria 5 and 7 were checked with a mouse and a viewport resize, which is
not a finger and not an orientation change; criteria 1, 6 and 11 (first-load time
on a phone network, double-tap zoom, and heat/memory after ten minutes) can only
be answered on the device.
