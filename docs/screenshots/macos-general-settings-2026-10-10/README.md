# macOS General settings · 2026-10-10

This folder archives reviewed PNGs, not caches, builds or personal data.

## Before

`before-sea-grouped.png`: source [1697303b4526d1482284c5315eb6f9f9097e085f](https://github.com/raydocs/tono/commit/1697303b4526d1482284c5315eb6f9f9097e085f),
[macOS CI 38080854027](https://github.com/raydocs/tono/actions/runs/38080854027),
artifact `tono-macos-tests-1697303b4526d1482284c5315eb6f9f9097e085f`,
`renders/settings-sea-grouped-native-window.png`.
Production SwiftUI SettingsView, exact AppKit window capture on hosted macos-26,
synthetic account, 760×820 points. Visible General has no effect explanation or
explicit Save/approval recovery actions. The cropped next card is scrollable.

## After (native render captured; corrected OCR CI pending)

The nine original production SettingsView/AppKit window PNGs come from head
[f699a661afba06ccfad73f9061a8ab8738cd0d84](https://github.com/raydocs/tono/commit/f699a661afba06ccfad73f9061a8ab8738cd0d84),
[CI 38083546959](https://github.com/raydocs/tono/actions/runs/38083546959), PR merge checkout
[8f3a6a60605e39436cba79643631b523fa62b594](https://github.com/raydocs/tono/commit/8f3a6a60605e39436cba79643631b523fa62b594),
artifact `tono-macos-tests-8f3a6a60605e39436cba79643631b523fa62b594`,
`renders/settings-general-<state>-native-window.png`. PNGs are unedited, not scaled
or composited, 760×920 pixels/points (Chinese 660×920). All were visually inspected.
Login Items read/register/unregister IO is synthetic and preferences use a
disposable suite; no host login item, helper, PF, endpoint or upload is mutated.

| State | Native PNG |
|---|---|
| Normal | [after-normal.png](after-normal.png) |
| Requires macOS approval | [after-approval.png](after-approval.png) |
| Saving, language disabled | [after-saving.png](after-saving.png) |
| Failed/unconfirmed, explicit refresh | [after-error.png](after-error.png) |
| Failed after unavailable refresh/remount | [after-error-after-unavailable.png](after-error-after-unavailable.png) |
| Confirmed Saved | [after-saved.png](after-saved.png) |
| Chinese, 660-point narrow window | [after-zh-narrow.png](after-zh-narrow.png) |
| Classic native appearance | [after-classic.png](after-classic.png) |
| Login Items unavailable | [after-unavailable.png](after-unavailable.png) |

This run is **red**: 688 tests executed, 1 skipped, 1 failure. Only the Chinese
content witness failed: Vision was fixed to en-US and read visible Han glyphs as
Latin gibberish. Original Chinese PNG is visibly localized and readable; its OCR
acceptance is not claimed passed. The correction selects zh-Hans/en-US for required
Han labels and leaves English fixtures/thresholds/content checks unchanged; its
accurate-head native rerun remains necessary. The General card is complete; following
Privacy content extends below the scroll viewport. Classic uses native control sizing.
No Linux recreation or pretty mock is native evidence.

## Device checks still pending

- Signed installed Tono: real Login Items approval/cancellation and next login.
- Real native error/delayed reply and navigation while unregistering.
- English/Chinese, minimum window height, keyboard focus, VoiceOver, Full Keyboard Access.
- Language cancel/apply while connected, connecting and Protected Offline;
  existing confirmation must still precede quitting/releasing protection.
- Helper permissions, real recovery/update/auth flows and final combined package
  are outside this isolated settings render evidence.
