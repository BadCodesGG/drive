# Context

Domain glossary for drive. Add terms as they are settled.

- **Circuit**: one of the three real tracks, Spa-Francorchamps, Sebring, Fuji Speedway. Data lives in `src/components/hero/racing/data`.
- **True scale**: circuit geometry matches the real track dimensions.
- **Hero**: the racing scene shown on the landing page (`src/components/hero/racing`).
- **Engine**: the React-free simulation layer: physics, laps, input, track fitting (`engine/`).
- **Scenery**: generated world around the track: ground, sky, trees, barriers (`engine/scenery`).
- **Cockpit**: the first-person camera view (`engine/cockpit.ts`).
- **HUD**: on-screen overlay for speed, lap and timing (`ui/hud.tsx`).
- **Pad**: gamepad and touch input handling (`engine/pad.ts`, `ui/pad.tsx`).
- **Model**: a `.glb` asset in `public/hero/models`, built by `tools/build-models.mjs`.
