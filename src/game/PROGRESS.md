# Game easter egg — progress notes

Entry point (final, per user): inside the existing walk mode ("Visite", V), pressing **T**
lazily imports `src/game/index.ts` and hands over the walker (position, yaw, pitch,
adult/child, sound). Hook = one commented block in `src/interaction/walk/walk-mode.ts`
("// game easter egg — remove this block + src/game/ to extract"). No other app file
imports `src/game/`. No toolbar / keyboard / shortcuts / i18n changes in the app.

## Status
- Phase 1 (scene conversion, PBR, sky + skyline, movement, handover): done, QA'd.
- Phase 2 (fists / shotgun viewmodels, sounds, hit detection, FX): done, QA'd.
- Phase 3 (pre-fracture, debris physics, falls, completion, WIN / Rejouer / Sortir): done, QA'd.
- QA (Playwright, swiftshader): handover V→T keeps position/heading; T cycle; 4-stage fist
  destruction; one-shot shotgun; debris sleep + fade (removed after 6–10 s); stack falls
  (2x1 → 1x1 + plant + lamp drop 118 cm); WIN after 15 shots; Rejouer restores 17 items;
  Esc/Esc and Sortir → app screenshot byte-identical, settings unchanged, 2 canvases;
  app shortcuts blocked while playing; extraction (rm src/game + hook) builds.
- Main bundle delta ≈ 4.3 KB raw / 1.4 KB gzip (MeshStandardMaterial + Vite preload helper).
- Test scripts: /tmp/kqa/p1–p6.mjs (lib.mjs). Use `simulate()` + `freeze()` hooks: swiftshader
  renders ~1.5 fps, so real-time waits don't advance the simulation.

## Files
- `index.ts` entry · `game.ts` controller (renderer, loop, input, weapons, phases, debug hook)
- `scene-build.ts` doc → meshes + pieces · `materials.ts` · `textures.ts` (procedural)
- `environment.ts` sky / skyline / ground · `geom.ts` (custom geometries: keep extra three
  classes out of the app's main bundle) · `world.ts` (copy of walk-world + item ids)
- `viewmodel.ts` fists / shotgun · `fx.ts` particles + decals · `destruction.ts`
- `audio.ts` (CC0 samples in public/game-audio + WebAudio synth) · `hud.ts` overlay / WIN · `i18n.ts`

## Notes
- Main bundle delta must stay small: avoid new three.js classes in src/game (they land in
  the shared `three` module of the main chunk). Measure: /tmp/kmeasure/measure.sh.
- Debug hook: localStorage 'kallax-designer:debug'='1' → `window.__kd.game`.
