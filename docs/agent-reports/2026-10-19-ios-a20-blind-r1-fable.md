# Tono iOS blind UI/UX review — round 1 of 2

Commit a20b3c1074434a938d6c04da5b43b1f4c5ff3ad7 (verified: `git rev-parse HEAD` in the review checkout matches; `summary.json` and `manifest.csv` record the same SHA). Evidence: `/Users/ruirui/.local/state/devin-cloud/runs/20261019-224452-wait-3c14bd1f7/attachments/` (115 files). Capture verdict there is `blocked` (evidence gaps, below), not pass.

## 1. Score table

| Item | Weight | Floor (70%) | Score | Evidence files behind it |
|---|---|---|---|---|
| D1 Information hierarchy, few words | 20 | 14 | 18 | ios-en-P-default-home-{idle,connected,connecting,degraded,failed,needs-permission,preparing,reconnecting,revoked,unconfirmed,disconnecting,failed-core-stopped,failed-routes-stopped}.png, zh equivalents, ios-en-P-default-details.png, ios-en-P-default-settings.png, settings-scrolled-under-bar.png, details-mode-refused.png, details-mode-unconfirmed.png, details-route-check*.png |
| D2 Coherent one-handed interaction | 20 | 14 | 17 | ios-en-S-default-*.png, ios-en-P-default-lines*.png, ios-en-P-default-details.png, other-line-opens-lines.png, home-mode-refused.png, ui-test-summary.txt (testEverySheetClosesWithASwipeBackToHome, testSettingsReachableFromDetailsAndCloses, testLinePickerSelectsAndCloses pass) |
| D3 Restrained quality, desktop brand consistency | 15 | 10.5 | 12 | all Home captures, ios-en-P-default-signin.png, real-widget-gallery.png, real-widget-home-screen.png, ios-en-P-default-live-activity.png, live-activity-island-{compact,expanded}.png |
| D4 Liquid Glass material | 15 | 10.5 | 12 | ios-en-P-default-home-connected.png, ios-en-P-default-home-idle.png, settings-scrolled-under-bar.png, ios-en-P-default-lines.png; source `App/Views/Theme.swift:188-204` |
| D5 State motion (design/render level only) | 15 | 10.5 | 12 | ios-motion-connect-cycle-frames.png, ios-motion-connect-cycle-reduced-frames.png, motion-results.json |
| D6 Accessibility and adaptation | 10 | 7 | 8 | ios-en-P-AX5-*.png (9 files), ios-en-S-default-*.png, ui-test-summary.txt (testAccessibilityAudit{HomeStates,Sheets,LargestText}, testLargestTextContrastSweep, testPrimaryActionLabelContrastInEveryPhase pass) |
| D7 Authenticity and performance (simulator only) | 5 | 3.5 | 4 | simulator-performance.txt, ui-test-summary.txt (35/35), settings-scrolled-under-bar.png ("test build, not from the App Store"), fixture "Preview" badges on every capture |

All seven items are at or above their 70% floor.

## 2. Vetoes

None.
- State misrepresentation: none found. Unconfirmed tunnel says "Not confirmed / Unconfirmed · not tested" (ios-en-P-default-home-unconfirmed.png, details-unconfirmed.png); refused mode switch keeps "Three-tier" selected with an amber "Couldn't switch to Stable" (details-mode-refused.png, home-mode-refused.png); unanswered switch selects neither segment (details-mode-unconfirmed.png); stale widget says "Status unknown · Last known: Connected at 8:16 PM" (widget-routes-stopped.png); pending line switch spins in the latency slot (home-line-pending.png).
- Primary action: full-width filled capsule at the thumb in every state including AX5 initial viewport (ios-en-P-AX5-home-*.png).
- Unreadable text: none; contrast sweep and label-contrast test passed; AX5 titles are one word per line, not hyphenated.

## 3. Total

18 + 17 + 12 + 12 + 12 + 8 + 4 = **83**. Threshold 85 not met. **FAIL** (on total only; every item clears its floor). The gap is two points of small, concrete fixes; round 2 can pass.

## 4. Findings, ranked by impact on the score

1. **AX5 Home starts scrolled to the top, hiding Settings/Details and clipping the speed line** (D6, also D2). `ios-en-P-AX5-home-connected.png`: "Details" is cut by the home indicator; `ios-en-P-AX5-home-degraded.png`: gear/Details are off-screen and "184 KB/s" is clipped. Cause: `App/Views/HomeView.swift:46` wraps `controls` in `BottomScroll`, and `App/Views/Components.swift:241-245` is a plain `ScrollView` with bottom-aligned content, so when content exceeds the viewport the scroll offset is 0 and the bottom row falls below the fold. Fix: add `.defaultScrollAnchor(.bottom)` to that `ScrollView` (deployment target is iOS 17), or scroll to a bottom anchor on appear and on phase change. Done condition: AX5 connected and degraded captures show the gear and Details pill fully inside the safe area. Raises D6 to 9–10.

2. **Connected status line names a country while the line row names a city** (D1). `ios-en-P-default-home-connected.png`: "Protected · Home exit in United States" directly above "Tokyo 86 ms". The source comment (`HomeView.swift:737-740`, string `status_protected_home` at `App/Resources/en.lproj/Localizable.strings:15`) says this is deliberate to avoid two naming systems, but on screen it reads as a contradiction until Details is opened. Fix: say what the second exit carries, e.g. "Protected · AI via Home (US)" / "已保护 · AI 走家宽（美国）", so the reader learns why both places are shown. Raises D1.

3. **Settings leads with explanatory prose** (D1). `ios-en-P-default-settings.png`, `ios-zh-P-default-settings.png`: "Three-tier is on. Change it in Details, next to where traffic goes." followed by a disclosure row, then a toggle with a sentence, a second disclosure row, and an amber two-line caveat. `App/Views/SettingsView.swift` (routing section and "iOS VPN protection" section). Fix: shorten the routing note to "Three-tier · change in Details"; move "While Tono is off, iOS blocks nothing; some Apple services bypass any VPN." into the "How this works" page and keep one line under the toggle. Raises D1.

4. **Mixed agency on the dropped state** (D1/D2). `ios-en-P-default-home-failed-core-stopped.png`: "Connection dropped · iOS will try to reconnect ›" beside a filled "Retry" button; the reader cannot tell whether to wait or tap. Fix: one sentence that explains the button, e.g. "Tap Retry to reconnect" (keep the iOS note in Details). Raises D1.

5. **About row shows a dash placeholder inside the licence sentence** (D1/D7). `settings-scrolled-under-bar.png`: "Core: sing-box — (GPL-3.0-or-later; source: github.com/SagerNet/sing-box)". `App/Views/SettingsView.swift:109` substitutes "—" when `coreVersion` is empty into `about_core` (`Localizable.strings:112`). Fix: a second string without the version ("Core: sing-box (GPL-3.0-or-later; …)") when the version is unknown. Raises D1 slightly; also matters on a real build if `LibboxVersion()` can be empty.

6. **Arrival hand-over briefly shows a fully filled orange "Disconnect"** (D5, design level). `ios-motion-connect-cycle-frames.png` cell 00:07.100: the capsule is 100% sunrise-filled with the label "Disconnect" and no clock; by 00:08.875 it is the outlined capsule with "47:02". This is the intended sunrise completion (`HomeView.swift:476-481`: fill to 1.0 over 0.9 s, fade over 0.6 s after 0.9 s), but for about 1.5 s the screen presents "Disconnect" in the call-to-action style used for Connect/Retry. Fix: start the fill fade when the title swaps (delay 0.9 → about 0.3 s) or draw the label in `textPrimary` as soon as the phase is `.connected`. Raises D5.

7. **Compact Dynamic Island glyph is green while the mark is orange everywhere else** (D3). `live-activity-island-compact.png` vs `live-activity-island-expanded.png`, `ios-en-P-default-live-activity.png`, `real-widget-home-screen.png`. `Widgets/TonoLiveActivityWidget.swift:66-68` tints `MarkGlyph` with `p.tint` (state colour). Fix: keep the mark in its sun colour and carry state in the trailing text/dot, matching the lock-screen presentation. Raises D3.

8. **Lines sheet shows two rows in a half-empty medium detent** (D2, low). `ios-en-P-default-lines.png`, `ios-zh-P-default-lines.png`: rows occupy the top third of the sheet. `App/Views/LinesSheet.swift:49` uses `[.medium, .large]`. Fix: add a `.height(...)` detent sized to the row count (plus the empty/loading states), keeping `.large` for long catalogs. Raises D2 slightly.

Not a defect (recorded so it is not re-reported): `diagnostic-ios-zh-P-default-live-activity-lock.png` shows English "Connected/Preview" with Chinese "东京". The widget extension does carry `App/Resources` localizations (`apps/ios/project.yml` TonoWidgets sources), but it runs as its own process with the simulator's system language, so the app's `-AppleLanguages` launch argument does not reach it; the content state (city) comes from the app. This is a capture-method artifact, not a localization gap. A real-device zh run with the system language set is the only way to confirm.

## 5. What this evidence cannot show (real-device checklist)

EVIDENCE NOT COVERED (owner-approved gaps; no points subtracted, no credit given):
- No sheet-cycle recording or contact sheet (`-TonoPreviewSheetCycle` does not select the fixture model on this commit, `TonoApp.swift:11-21`, `HomeView.swift:84-96`): the zoom transitions for Lines/Details/Settings and their swipe-close motion are unassessed. Normal and reduced connect-cycle recordings exist and were scored.
- Onboarding, VPN primer, widgets, widgets-light, widgets-routes standalone launch arguments did not activate the intended fixture; all those matrix variants (en/zh, P/S, AX5) are unassessed. Widget appearance was judged only from the in-app gallery (`widget-routes-stopped.png`), the system gallery and one Home Screen placement (`real-widget-gallery.png`, `real-widget-home-screen.png`). Light-mode widgets: unassessed. Connected-offline has no distinct rendered state: unassessed.
- English Live Activity: the native simctl PNG omits the Dynamic Island; the expanded island was judged from the labelled supplemental window capture (`supplemental-ios-en-P-default-live-activity-island-window.png`) and the UI-test captures (`live-activity-island-*.png`). The Chinese Live Activity row is diagnostic only and is not a completed matrix row.

Additionally not shown by any simulator evidence:
- Network Extension behaviour: real tunnel start/stop, permission prompt, "Another VPN took over", reconnect on network change, fail-closed behaviour, actual route confirmation. All phase captures are DEBUG fixtures (`-TonoPreview …`), which the yellow badge states.
- Haptics (`StateFeedback.arrived`, `UIImpactFeedbackGenerator`) and the VoiceOver reading order (the source itself notes it needs a device pass, `HomeView.swift:38-40`).
- Frame pacing, thermal and battery cost of `SeaScene`'s 30 Hz `TimelineView`, Liquid Glass rendering on real hardware, and Dynamic Island on a physical device. D5 and D7 above are design/render-level judgements from contact sheets and `testSimulatorPerformanceSample` (memory 63.7–66.1 MB, CPU time 2.67 s; CPU cycle counters read 0 in the simulator), never product acceptance.
- Real sing-box core version in the About row; real latency, speed figures and line catalog; sign-in code delivery.
- Reduce Transparency and Increase Contrast fallbacks (`Theme.swift:189-192`) have no capture.

## Checks performed

- Source and log inspection only: `git rev-parse HEAD`; `summary.json`, `manifest.csv`, `ui-test-summary.txt`, `verification-summary.txt`, `simulator-performance.txt`, `motion-results.json`, `live-activity-results.json`; 62 PNGs viewed (all P/S/AX5 en Home states, all zh P Home states, all details/lines/settings/sign-in variants, both motion contact sheets, widget/Live Activity captures, the test-generated state captures); `apps/ios/App/Views/HomeView.swift`, `Theme.swift`, `Components.swift`, `LinesSheet.swift`, `SettingsView.swift`, `Widgets/TonoLiveActivityWidget.swift`, `WidgetUI/*`, `App/Resources/en.lproj/Localizable.strings`, `apps/ios/project.yml`; diff scope confirmed as 109 files / 14054 insertions under `apps/ios` (no edits made).
- No tests, builds or captures were executed by this review; test results quoted are the Devin Cloud run's own logs (35/35 UI tests passed on the simulator).
- Not read: `docs/agent-reports/`, `docs/changelog.d/`, PR bodies, earlier reviews.

VERDICT: FAIL 83
