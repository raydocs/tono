# macOS 0.0.73 usability acceptance scope

G1 connection/recovery usability and G3 build identity/support evidence. The
owner authorized all six capabilities in this batch. Version remains
0.0.73/build73. This is not release or device acceptance.

Baseline: [046849f22493562ec346013ab639c7479f51f6e1](https://github.com/raydocs/tono/commit/046849f22493562ec346013ab639c7479f51f6e1),
published on `fix/g3-candidate-install-20260922`, not `main`.
Implementation branch: `feat/macos-073-usability-20260922`.
Mode: parent reports creation-tool selection of `gpt-6-astra-max`; absent
environment markers are not mode evidence. One implementation thread, no children.

## Behavior and evidence boundaries

| Capability | Production boundary and focused regression |
|---|---|
| One-click local health | `AppState.collectLocalHealth` reads existing account/catalog/attempt state and observational helper version/Core/DNS endpoints. `testLocalHealthKeepsUnknownsAndDoesNotStartOrRetireConnectionWork` checks unknowns, redaction and late-attempt rejection. Never query healing `/killswitch/status`; live PF remains unknown. |
| Preview and one-shot report | `AccountSession.previewSupportReport` / `confirmSupportReport` use the existing strict schemaVersion=1 `{report}` endpoint. Three `AccountSessionRequestTests.testSupportReport…` regressions exercise real transport encoding, frozen preview/receipt, held 401 retirement and absent reference. Raw-log and remote-action consent are independent. Build/attempt identity is local only. |
| Build/runtime identity | Xcode bundles actual checkout SHA/dirty/configuration. `testBuildIdentityReadsBundledSourceWithoutClaimingReleaseAttestation` reads that production bundle resource. Debug/Release is not signing, notarization, channel or live-binary attestation. Helper protocol is observed; helper/Core binary identity stays unknown. |
| Local route choices | `LocalRoutePreferences` plus `AppState` production selection binding. Favorites are account-hashed, bounded (8 accounts, 32 favorites, 16 success records, 64KiB), catalog-filtered, with shared hy2 base identity. Only proven connect/switch completion records success; an owned failed attempt retires it. Recommendations require confirmation and never switch a healthy exit. Success evidence expires at 24h and must match the catalog digest; otherwise the choice is explicitly untested. Two focused `MacUsabilityTests` check corrupt storage, isolation, bounds, stale evidence, and existing connect admission. |
| Fixed-region preference | An optional two-letter region in the same account-local store constrains **all** recommendation candidates, including untested fallbacks; it never changes manual selection. The picker offers recognized catalog geography, not guessed card initials or the hy2 category. Removed regions remain selected and block recommendations until explicitly changed/cleared. Confirmation also rechecks the preference. `testFixedRegionNeverFallsBackToAnOutsideSuccessWhenRegionIsUnavailable` uses a proven US route, an untested JP route, vendor-blocked JP hy2, misleading JP display initials, account isolation, removal/reload, and explicit clearing. No wire changes or data migration. |
| Recovery feedback | `RecoveryNotice` is presentation derived from existing state; it owns no tasks. Existing wake/network-change entry points set context and successful explicit release clears it. Dashboard/menu retain the existing Retry / Repair and reconnect action. `testRecoveryFeedbackUsesExistingOwnerAndReleaseClearsIt` drives that owner with only OS I/O substituted. |
| Activity explanation | Real `AppState.updateConnections` binds terminal-first chain evidence to each flow. App rows and flow details explain rule/chain, including absent/selector-only unknowns. No rule editor. `testActivityExplanationUsesTerminalEvidenceNotTheSelectedNodeOrRule` distinguishes cloud terminal from a residential member later in the chain and a rule without terminal evidence. |

## Native render review

`MacUsabilityRenderTests.testNativeUsabilityStatesProduceReviewableAttachments`
uses AppKit `NSHostingView` and the production SwiftUI views with synthetic
state. It does not sign in, scan browsers, query the helper, connect or upload.
The displayed synthetic receipt is labelled as such and is not server evidence.

The existing hosted `macos-26` workflow runs its unchanged unsigned Release
build and Debug `TonoTests` command, now with
`-resultBundlePath apps/macos/test-results/TonoTests.xcresult`.
The 7-day artifact `tono-macos-tests-<github.sha>` contains that bundle and
bounded direct PNG copies under `renders/`:

- `health-unknown-helper.png`, `build-unverified.png`
- `report-preview.png`, `report-receipt.png`, `report-no-receipt.png`
- `nodes-favorite-recommendation.png`, `nodes-region-unavailable.png`
- `dashboard-wake-paused.png`, `menubar-wake-paused.png`, `network-recovery-running.png`
- `activity-cloud-and-unknown.png`

Outputs are gitignored. Tests only check that images were emitted; a person or
agent must inspect the images. Run/job/head/checkout and artifact identity must
be recorded in the PR/thread after execution; configuring captures is not proof
they rendered correctly. Linux source checks cannot run XCTest or SwiftUI.

Initial native run [35712148855](https://github.com/raydocs/tono/actions/runs/35712148855)
tested [d8cfa095](https://github.com/raydocs/tono/commit/d8cfa095fa6b7da6d92ebd68fa65510ee68bbf1e)
via a push checkout: unsigned Release build/package, policy tests and privileged
helper tests passed, but XCTest **compilation failed**, so no tests or renders ran.
The capture harness attempted to write the read-only `accessibilityReduceMotion`
environment key. The follow-up uses SwiftUI's animation-disabled transaction
instead. Its native results and image review remain pending until recorded with
the exact follow-up SHA in PR #278 / the thread; source inspection is not a pass.

Not covered by these fixtures: real-account server storage, signed Helper
authorization, installed Core identity, actual network handoffs/sleep, PF/DNS
device protection or customer-channel readiness. Parent owns final combined-SHA
CI and integration. No merge, signing, deployment, tag or feed promotion.
