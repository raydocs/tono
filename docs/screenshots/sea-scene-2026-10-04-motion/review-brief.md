# SeaScene review and polish list — 2026-10-04

Reviewed: PR #1375 at `9f266c99` (`raydocs/feat-sea-scene-pr1`), dev preview on `:3000`, headless Chrome on a
MacBook, real-time frames over CDP. Evidence in this folder: `film-set/rise/day/fail.png` (13 frames each,
0–6.6 s), `closeups.png` (2× crops: connected, connecting / idle, failed), `film.mjs`, `hidden.mjs`.
Nothing here was run on Windows.

## What holds

- Hidden-page fix verified independently (`hidden.mjs`): hidden at 1.2 s into a sunset, the sun stays at 79 px
  for 1.5 s, resumes from 79 px, ends at 290 px with moon and stars at 1.
- Sunset brightness 73.5 → 26.0, monotonic, largest 300 ms step 7.1. Sunrise 26.0 → 59.5. Arrival 59.4 → 73.4.
- One DOM, transform/opacity only, baked ripple masks, no SVG filter.

## Measured weakness: the steady states are nearly still images

Pixels that change by more than 5/255 between two frames of the same phase:

| Phase | Sky | Water (330–490) |
|---|---|---|
| connected | 0.00 % | about 5 % (glitter path only) |
| connecting | 0.3 % (halo) | about 6 % |
| idle | 0.02 % | 0.5 % |
| failed | static after 1.8 s | glitter at half strength |

The transitions are good; everything between them is frozen. Most items below address that.

Constraints for every item: transform and opacity only, baked textures, every loop carries `.sea-loop` so the
existing pause logic covers it, static fallbacks unchanged, sunset/sunrise brightness stays monotonic
(re-measure after each change), palette unchanged unless the item says so.

## A. Things that look wrong now (fix first)

1. **Connecting reflection is a hard-edged striped oval.** The mirrored disc outline is crisp, so the ribbons
   read as a striped egg. Feather the mirrored disc (radial mask, about 14 px), let the ribbons break up and
   widen with distance from the horizon, and make the reflection dimmer and redder than the sun (about 60 %).
2. **Connected: a dark red striped trapezoid under the glitter path** (the mirror at 0.3 opacity). Drop the
   striped mirror to about 0.1 in `connected` and keep only the soft glow; the glitter path carries the state.
3. **Clouds are two ruler-straight dark lines across the sun.** They read as broken scan lines. Replace with two
   or three baked cloud bands with irregular soft edges and a warm underside near the sun.
4. **Glitter path is 14 rounded rectangles.** Replace with two tiled baked speck textures drifting in opposite
   directions inside a wedge mask (narrow at the horizon, wide near the viewer); the overlap twinkles.
5. **Sun edge is razor sharp.** Add a 1–2 px feather and a second wider glow. Within about 60 px of the horizon
   squash it slightly (`scaleY` 0.94) as real refraction does.
6. **Horizon is a hard bright line across the full width.** Make it a 12–20 px haze band, bright only near the sun.
7. **Crescent edge is jagged** (inset `box-shadow`). Use an SVG path or a mask.
8. **Idle water keeps a dark red patch where the sun was, with no light source.** Fade it out fully or turn it
   into cool moonlight.
9. **Large windows.** At 1920×1080 the 190 px sun is small and the top third of the sky is empty. Scale the sun
   and glow with height, for example `clamp(190px, 26vh, 300px)`, and travel distances with it.

## B. Life in the steady states

10. **Whole-water swell.** Two very faint wide baked wave layers across the full width, drifting in opposite
    directions (about 40 s and 65 s). Today only the column under the sun moves.
11. **Reflection waves should travel, not slide.** The two ripple masks only shift ±5 px sideways. Scroll a
    vertically tiling mask toward the viewer and counter-translate the disc inside it.
12. **Sun glow breathing in `connected`.** 7–8 s, opacity 0.9 ↔ 1, scale 1 ↔ 1.03.
13. **Clouds that actually cross.** 32 px over 23 s is invisible. One-direction drift, 90–140 s per pass.
14. **Stars.** 37 identical white dots, 12 twinkle. Three sizes and brightness levels, slight warm/cool tint,
    periods 3–9 s; scale the count with window area. One shooting star every 40–90 s (one-shot, about 700 ms).
15. **Moon path.** Five bars. Use the speck treatment from item 4 in a cool colour; let the moon glow breathe.
16. **Failed is static after 1.8 s.** Let the sun bob on the horizon (±3 px, about 5 s) with a slow ember pulse
    in the red glow. Calm, not an alarm.
17. **Pointer parallax (optional).** Sun ±4 px, stars ±2 px, clouds ±6 px, water ±8 px, damped. Runs only while
    the pointer moves; off under reduced motion.

## C. Choreography

18. **Tie the sun height to connect progress** (PR 2, `connect-stages.ts`). Today the sun reaches the half-risen
    pose in 1.5 s and then waits. Each stage lifts it a step; success completes the rise. A stalled stage must
    not keep creeping.
19. **Arrival has no moment.** On `connected`, once: glow bloom (scale 1 → 1.12 → 1, 900 ms) and a light sweep
    down the glitter path (600 ms).
20. **Empty second in the sunset.** At 3.0–3.6 s the sun is gone and the moon has not started. Keep a narrow
    afterglow where the sun set for about 2 s more, and bring the brightest stars in from 1.5 s.
21. **Moon and sun overlap on connect.** At 900 ms the sun is half up and the crescent is still fading in place.
    Let the moon sink and fade in about 500 ms, before the sun's top edge appears (about 600 ms).
22. **Stars leave by brightness** at dawn (dim first), not as one uniform fade.
23. **Linger at the horizon.** In the sunset the sun is out of sight by 2.4 s of 4.6 s. Use a `linear()` easing
    that slows while the disc crosses the horizon, the best part of the scene. Re-measure brightness.
24. **Failure hesitation (optional).** 6 px more upward for 200 ms, then the fall.
25. **Title text** in the preview switches hard. PR 2 needs the prototype's 240 ms cross-fade with a small rise.

## D. The interface follows the light (PR 2 and later)

26. Dock glass: tint and top highlight change with phase (warm by day, cool at night).
27. Title legibility over the bright sky: a soft shadow or local scrim, not heavier type.
28. Lines page and tray flyout share the same phase.
29. Title-bar mark dims with the phase (small sun at night becomes a dim ember).

## E. Engineering notes

30. Reduced transparency and missing `backdrop-filter` currently freeze the whole scene. That came from my
    handoff §6 and is too strict: they should only make the dock opaque. Reduced motion, forced colours and the
    explicit `paused` prop remain the static cases.
31. VF1 / VF2 (timing and colour deviations Codex listed): acceptable as they are; no visible fault in the films.
32. Real Windows / WebView2 pacing is still not run. Items 4, 10, 11 and 14 add layers; measure after each.

## Suggested order

A1–A4, then B10–B11, then C18–C21. The rest after the owner has seen those.

## Owner decisions still open

Connected sky colour (brown now; navy → rose → amber was offered), the moon, and handoff §7 questions 1–3 and 5.
