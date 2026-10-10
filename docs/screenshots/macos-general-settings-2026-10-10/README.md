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

## After (capture pending)

The branch adds production SettingsView captures through the same existing
MacUsabilityRenderTests window workflow. Login Items read/register/unregister IO
is synthetic and preferences use a disposable suite; no host login item, helper,
PF, account endpoint or upload is mutated. The eight requested captures cover
normal, approval, saving, failed/unconfirmed, saved, Chinese 660-point width,
classic appearance and unavailable. After PNGs will be added only after actual
hosted rendering and inspection, with their exact capture source and CI checkout.
No Linux recreation or pretty mock is native evidence.

## Device checks still pending

- Signed installed Tono: real Login Items approval/cancellation and next login.
- Real native error/delayed reply and navigation while unregistering.
- English/Chinese, minimum window height, keyboard focus, VoiceOver, Full Keyboard Access.
- Language cancel/apply while connected, connecting and Protected Offline;
  existing confirmation must still precede quitting/releasing protection.
- Helper permissions, real recovery/update/auth flows and final combined package
  are outside this isolated settings render evidence.
