# Drive

**Spa-Francorchamps, Sebring and Fuji Speedway, rebuilt close to true scale and drivable in the browser.**
A GT3 car or an F1 car, a chase or cockpit camera, real elevation, and your best laps saved per track and car.

**Live: [drive.badcodes.dev](https://drive.badcodes.dev)**

<!-- demo-video -->

The circuits are traced from OpenStreetMap centrelines at close to their official length (Spa 7.0 km, Sebring 6.0 km, Fuji 4.6 km) and lifted onto real survey elevation, so the climb through Eau Rouge and Raidillon, the Sebring bumps and the long Fuji straight are the real shapes. Around the track stand the real woods, buildings, roads and car parks from the map, and beyond them the real skyline, with Mount Fuji at its true bearing and size. It runs entirely in your browser: no account, nothing to install.

## What you can do

| | |
|---|---|
| **Pick a circuit** | Spa, Sebring or Fuji. The idle view is the whole lap as a miniature with a car running it. |
| **Pick a car** | GT3: heavier, slides more, forgiving on the walls. F1: faster, brakes later, twitchy at low speed. |
| **Drive** | Press Drive. On a keyboard, `W` `A` `S` `D` or the arrows. On a phone, the left or right half of the screen steers, throttle is automatic, hold both halves or the Brake pedal to slow. |
| **Steer by tilt** | On a phone with motion sensors, switch the pad from Touch to Tilt and steer by tilting it. |
| **Change view** | `C`, or the View button on a phone, cycles the chase and cockpit cameras. |
| **Reset or leave** | `R` puts the car back on the track, `Esc` (or Exit) returns to the miniature. |
| **Choose a look** | Low poly builds everything in code at runtime. Detailed loads the car, tree and trackside models and adds detail to the real buildings. |
| **Chase your best** | Laps and sector splits are timed, a ghost runs the reference lap, and your best lap is saved per track and car in your browser. |

There is no gamepad support. Reduced motion is respected: the idle miniature stays a still frame and only a drive runs the loop.

## How it works

```
src/app/                   The Next app: page, layout, the stage that mounts the game, fonts, styles.
src/components/hero/
  scene-guard.tsx          The WebGL 2 probe and the error boundary, kept apart so the page can
                           check before it downloads three.
  racing/
    racing-hero.tsx        The React root: one <Canvas flat>, one useFrame, the controls portalled out.
    data/                  spa.json, sebring.json, fuji.json: track and scenery geometry, plus types.
    engine/                Plain TypeScript, no React in the hot path.
      engine.ts            The engine: phases, cameras, the frame loop, the Detailed look's fallback.
      physics.ts           The car: bicycle-model tyres, walls that stop the whole body, a 1/120 s tick.
      track.ts             The drive track from the traced line, corners, run-off, the reference lap.
      cars.ts              The two cars' dimensions, power, grip and tyre numbers.
      laps.ts, prefs.ts    Lap timing and the saved settings and best laps.
      input.ts, pad.ts     Keyboard, and the phone pad with its touch and tilt steering.
      cockpit.ts           The cockpit camera, rigid on the body.
      mini.ts              The idle miniature and its autopilot.
      detailed.ts          Loads the .glb models once, turns them into vertex-coloured geometry.
      scenery/             The Low poly kit, the miniature's world, and the true-scale drive world:
                           land, woods, buildings, roads, barriers, horizon.
    ui/                    Controls, HUD, loader, phone pad, the data credit.
public/hero/models/        The 16 Detailed models, as .glb.
tools/build-models.mjs     Generates every model in code (see below).
scripts/smoke.mjs          The browser smoke test.
```

**Rendering.** React Three Fiber on three.js r186, with one render path: a single `useFrame` at priority 1 steps the engine and draws its scene. The engine is imperative and lives outside React; React reads its low-frequency state and hands it the HUD's elements, which it writes straight to every frame, so a drive does not re-render the page. three and R3F are a lazy chunk, requested only once WebGL 2 is confirmed.

**Track data.** Each circuit is one JSON chunk, fetched only for the circuit on screen. A chunk holds the traced centreline, an elevation profile, the pit lane, the sector marks and landmarks, the mood (sky, sun, fog), and a ground layer: a survey height grid, a ring of skyline heights, and the OpenStreetMap woods, grass, water, buildings, roads and mapped trees around the track.

**Models.** The 16 models are generated in code by `tools/build-models.mjs`: primitives and lofted profiles exported with three's `GLTFExporter`. No textures, no third-party assets, and nothing carries a manufacturer's, team's or sponsor's name. Run `npm run models` to rewrite `public/hero/models/`.

**Physics.** Throttle, brakes and the tyres act in the car's own frame (forward, sideways, yaw) with a bicycle model per unit mass, the load growing with downforce. Walls stop the car's whole body, scrub speed by how square the hit was and nudge it back. A fixed 1/120 s tick keeps it deterministic whatever the frame rate.

## Things to know

- **`<Canvas flat>`, never `<Canvas shadows>`.** Without `flat`, R3F applies ACES tone mapping and recolours every circuit's mood. `shadows` selects a soft shadow map that three 0.186 replaces with a console warning, so the engine switches shadows on itself, every frame, with the default map.
- **WebGL 2 only.** three dropped WebGL 1 in r163. The probe accepts only a `webgl2` context; widening it makes a WebGL-1-only browser download three and then fail. Without WebGL 2 the page says so instead.
- **The `hero-*` localStorage keys must not be renamed or reformatted** (`hero-track`, `hero-car`, `hero-look`, `hero-camera`, `hero-steer`, `hero-best-lap-v3:<track>:<car>`). Settings and best laps saved in people's browsers depend on them. The models directory, `/hero/models/`, is named once, by `HERO_MODEL_DIR` in `engine/detailed.ts`.
- **One console warning is expected.** R3F 9.8 constructs a `THREE.Clock`, which three 0.186 deprecates. The smoke test allows exactly that and fails on any other warning or error.

## Running it

Node 22 or 24.

```bash
git clone https://github.com/BadCodesGG/drive.git
cd drive
npm install
npm run dev            # http://localhost:3130
```

Checks:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm test               # Vitest: the data, the physics, the engine, the scenery, the models
npm run build          # production build
npm run test:smoke     # serves the build and drives Spa in Chromium, on a desktop and a phone viewport
npm run models         # regenerates public/hero/models from tools/build-models.mjs
```

The smoke test needs a build first and Playwright's Chromium (`npx playwright install chromium`). It checks that every model is served, the miniature draws, Drive enters the drive world, the car moves, and `Esc` comes back, with no page error or console warning beyond the one above. It drives in Low poly, because Detailed under a software renderer takes minutes. Set `DRIVE_URL` to test a server that is already running.

## Data and licence

The circuit and scenery data in `src/components/hero/racing/data/*.json` are the source of truth: they are committed, and the game reads only those files. The scripts that originally fetched OpenStreetMap and the elevation sources and packed them are not part of this repo.

- **OpenStreetMap.** Track centrelines, woods, land use, buildings, roads and mapped trees: © OpenStreetMap contributors, available under the [Open Database Licence (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The JSON files are a derived database and stay under the ODbL; see [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright). The game credits it on screen.
- **USGS 3DEP** (Sebring ground heights). Public domain: all 3DEP products from The National Map may be used without restriction. The USGS asks for credit: "3DEP data courtesy of the U.S. Geological Survey". [usgs.gov/3d-elevation-program](https://www.usgs.gov/3d-elevation-program)
- **SPW Wallonia LiDAR DTM** (Spa ground heights). The Service public de Wallonie publishes its airborne LiDAR terrain models under CC BY 4.0: you may use and modify them provided you cite the source, "Service public de Wallonie (SPW)". Both the [2013-2014](https://geoportail.wallonie.be/catalogue/218033a9-b755-4a93-b812-e97475935c62.html) and [2021-2022](https://geoportail.wallonie.be/catalogue/3ef17388-54cd-4034-baad-d247243123c2.html) campaigns say so in their Conditions section on the Géoportail de la Wallonie. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **GSI Japan elevation tiles** (Fuji ground heights). The Geospatial Information Authority of Japan's content is under its [terms of use](https://www.gsi.go.jp/ENGLISH/page_e30286.html), which apply the Japanese government's Public Data License (version 1.0). You must cite the source (for example "出典：国土地理院", "Source: Geospatial Information Authority of Japan"), and if you edit or process the data you must say so, and not present the result as if GSI made it. The heights here are resampled and merged into the track data, which is that kind of processing. The Japanese text is at [gsi.go.jp/kikakuchousei/kikakuchousei40182.html](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html); the tiles' own usage notes are at [maps.gsi.go.jp/development/ichiran.html](https://maps.gsi.go.jp/development/ichiran.html).
- **Terrain Tiles** (the distant skyline). The open Mapzen/AWS Terrarium tiles combine SRTM, Copernicus EU-DEM, USGS 3DEP and other datasets. Their [attribution notes](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) ask, among others, for "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers" and "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey", and say you must check each provider's terms. Only skyline heights on a ring around each circuit are taken from them.
- **Fonts.** Hanken Grotesk and Manrope, SIL Open Font License 1.1; the licence texts are beside the files in `src/app/fonts/`.
- **Code and models.** The code is MIT, see [LICENSE](LICENSE). The 3D models are original work, generated by `tools/build-models.mjs`, and are MIT too.

Files that are not covered by the MIT licence, and the terms for the BadCodes name and logo, are listed in [NOTICE](NOTICE).

Built by [BadCodes](https://badcodes.dev).
