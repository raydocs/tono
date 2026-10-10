# Windows tray · bounded UIUX round, 2026-10-10

Production TrayPanel/SeaTray rendered by Linux Chromium, synthetic native IO,
`vite.shell-preview.config.mts`, 320×232 CSS pixels, DPR2 (640×464 PNGs).
Not native WebView2, Segoe UI, hardware protection or real traffic evidence.
All images inspected; only PNGs and this description are retained.

## Source

- Closed before: [e1d5118c99cf94c020de5683e607e379e925c2f9](https://github.com/raydocs/tono/commit/e1d5118c99cf94c020de5683e607e379e925c2f9), Windows tray tree identical to then-main2ad39dba.
- Open picker before: [c520197a96853ff91d4206e516389a67360d9d0a](https://github.com/raydocs/tono/commit/c520197a96853ff91d4206e516389a67360d9d0a), preserved #1495 history plus main merge; old unbounded picker.
- All after: [7ecdbbd535ea284ae96b63f7ac0f8d15e83c0a78](https://github.com/raydocs/tono/commit/7ecdbbd535ea284ae96b63f7ac0f8d15e83c0a78).
- Documentation-only archival commit does not change rendering code. Historical images in `docs/ops/evidence/2026-10-10-sea-ui-followups/windows/` are superseded by this set, not fresh evidence.

## Before / after

| State | Before | After |
|---|---|---|
| Connected English | [PNG](before-connected-en.png) | [PNG](after-connected-en.png) |
| Connected Chinese | [PNG](before-connected-zh.png) | [PNG](after-connected-zh.png) |
| Protected Offline | [PNG](before-protectedOffline-en.png) | [English](after-protectedOffline-en.png), [Chinese](after-protectedOffline-zh.png) |
| Keyboard picker | [3 routes clipped](before-picker-keyboard-en.png) | [9 routes, entry focused](after-picker-keyboard-en.png), [last route focused](after-picker-last-route-en.png) |

Additional inspected affected states: [idle](after-idle-en.png),
[connecting/disabled](after-connecting-en.png), [failure English](after-failed-en.png),
[failure Chinese](after-failed-zh.png), [long selected name](after-connected-en-long.png),
[offline protection unknown](after-protectedUnknown-en.png), [connected protection unknown](after-unknown-en.png).
Unknown states must say “Protection not verified”, not “Protected”.

## Executed browser checks

For 11 closed states: tray width320, height/scrollHeight232, footer bottom216.
Before: connected scrollHeight236/239, offline242, width312; footer glyphs still
visible, so this is unwanted scrolling/gutter evidence, not proof of clipped buttons.
For the picker use `?route=/tray&scenario=connected&lang=en&count=9`:
Tab×3 → summary, Enter opens; Tab×9 reaches last route and scrolls106px,
focused button bounds143…171 stay within the panel. Offscreen earlier rows may
be partially visible at its scroll edge; the focused last row is complete.
Escape closes and returns summary focus; no native command was called.
The known protected-offline fixture and unknown fixture execute production mapping;
they do not prove PF/WFP is held on a device.

## Final-package/device gaps

- Windows WebView2 with Segoe UI, 100/150/200% DPI, multiple displays/taskbar edges.
- Real tray placement, opening/closing via keyboard and Narrator/Full Keyboard Access.
- Long live errors, unavailable catalog entries and route switching with real IPC.
- Real protection/release/cancel behavior: no state mapping or native handlers changed here.
- Owner visual review and exact-head ci-gate precede merge; no package/release produced.
