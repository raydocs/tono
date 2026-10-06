# SeaScene visual polish — 2026-10-03

Continuation of `cb0c5e2b`, PR 1 only. MacBook Google Chrome headless, synthetic
phases; not Windows/WebView2/native evidence. Original artifacts are retained.

[Before/after detail](comparison.png): left is the previous component, right the
polished component. Both use explicit static mode and the same crop, `(380,250,
860,490)`, from 920×600. Rows: connected, connecting, failed, idle. Static mode
makes the dock opaque; these are scenery comparisons, not integrated home UI.

| Phase | Minimum | Default | Simulated large viewport |
|---|---|---|---|
| Connected | [860×540](connected-860x540.png) | [920×600](connected-920x600.png) | [1920×1080](connected-1920x1080.png) |
| Connecting | [860×540](connecting-860x540.png) | [920×600](connecting-920x600.png) | [1920×1080](connecting-1920x1080.png) |
| Failed | [860×540](failed-860x540.png) | [920×600](failed-920x600.png) | [1920×1080](failed-1920x1080.png) |
| Idle | [860×540](idle-860x540.png) | [920×600](idle-920x600.png) | [1920×1080](idle-1920x1080.png) |

[Browser checks](browser-checks.json) include two existing water loops attached
to the masked nodes, their transform drift, static fallbacks, reversals and size
bounds. Comparisons use static mode; motion/trace checks use ambient mode.
[Reduced motion](prefers-reduced-motion.png),
[reduced transparency](prefers-reduced-transparency.png).

[Brightness](luminance.json), [real capture completion times](frame-times.json),
[asset hashes](asset-hashes.json), [hidden-transition checks](visibility-visual.json),
[performance counters](performance-visual.json),
[visible trace](ambient-visible-visual.json.gz),
[hidden trace](ambient-hidden-visual.json.gz),
[independent visible trace](ambient-trace.json.gz).

Brightness follows the original PNG→L/crop/resize mean method. Samples are
nominally 300ms apart, not virtual-time frames; completion timestamps include
screenshot overhead, including a delayed sunset capture. No exact 300ms capture
cadence or zero style-work claim. Pacing uses frame intervals / measured elapsed
time rather than frame count / an assumed five seconds.

Review correction: [native frame-swap timestamps](timestamps.json),
[rolling 300ms means/direct pairs](luminance-stamped.json),
[timestamped samples](stamped-frames.png). Call completion is not image time.
Rolling analysis interpolates neighboring native means; direct pairs use actual
native timestamps within 300±5ms. Initial/other gaps remain; no perfect cadence
claim. Raw PNGs were captured separately and retained in the local QA directory,
not all committed as a large archive. The sample montage is downscaled; means
were computed from full 920×664 PNGs using the original crop/resize method.

[Contract and limitations](../../../sea-scene-preview.md).
