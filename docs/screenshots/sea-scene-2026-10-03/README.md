# SeaScene component evidence — 2026-10-03

Captured in Google Chrome headless on the MacBook; 1×, synthetic phases, no
Tauri/VPN/native actions. The four reference states were inspected against the
handoff. Scenery preserves geometry/palette; baked ripples intentionally differ
from live SVG distortion. These are **not** real Windows qualification.

| Phase | Minimum | Default | Simulated large viewport |
|---|---|---|---|
| Connected | [860×540](connected-860x540.png) | [920×600](connected-920x600.png) | [1920×1080](connected-1920x1080.png) |
| Connecting | [860×540](connecting-860x540.png) | [920×600](connecting-920x600.png) | [1920×1080](connecting-1920x1080.png) |
| Failed | [860×540](failed-860x540.png) | [920×600](failed-920x600.png) | [1920×1080](failed-1920x1080.png) |
| Idle | [860×540](idle-860x540.png) | [920×600](idle-920x600.png) | [1920×1080](idle-1920x1080.png) |

[Reduced motion](prefers-reduced-motion.png),
[reduced transparency](prefers-reduced-transparency.png),
[browser checks](browser-checks.json), [brightness](luminance.json),
[steady trace (gzipped JSON)](ambient-trace.json.gz).

Continuation evidence (original artifacts retained):
[visibility freeze / background retarget](visibility-continuation.json),
[performance counters](performance-continuation.json),
[visible trace](ambient-visible-continuation.json.gz),
[simulated hidden trace](ambient-hidden-continuation.json.gz).
The visibility JSON includes the pre-fix destination jump and all transition
clocks; native Windows visibility remains unverified.

[Latest visual polish: comparisons, all sizes, brightness and traces](visual-polish/README.md).

[Contract, methods and limitations](../../sea-scene-preview.md). The default
preview controls switch phases immediately; there is no actual connected state.
