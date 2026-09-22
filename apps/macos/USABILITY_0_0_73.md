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

## Catalog history ownership regression

Independent review identified a same-name catalog replacement during held
verification: completion recaptured the new digest and incorrectly credited
the old verification to that catalog. Both connect and switch now capture the
catalog digest beside the account owner before suspension. History recording
requires that admitted digest to be present and still current; it omits changed
identity rather than relabelling old proof. Protection/lifecycle decisions are
unchanged. The one new test exercises real
catalog validation/publication, `verifyProtectedConnection` classification and
history insertion. Only network origin I/O is a held continuation; the caller's
already-verified runtime commit is represented locally, not a real helper/core
installation. Same account/generation must not let C1 proof credit C2, while a
new unchanged-C2 verification must still record success.

Red evidence: [09cff3d2](https://github.com/raydocs/tono/commit/09cff3d2abac0080d1958cc818b7a93657fb9009),
ordinary push run [35716447221](https://github.com/raydocs/tono/actions/runs/35716447221),
build job `106709410256`, completed 356 tests with one existing opt-in skip and
exactly one failure: `testHeldVerificationCannotCreditASameNameReplacementCatalog`
reported **C1 verification must not mark the same-name C2 route as proven**.
The unchanged-C2 control passed. Native render test and all other tests passed;
the runtime-bytes step was skipped because XCTest failed. Green evidence must
be matched to the published fix SHA in the PR/thread, not inferred from this doc.

## Native render review

`MacUsabilityRenderTests.testNativeUsabilityStatesProduceReviewableAttachments`
uses AppKit `NSHostingView` and the production SwiftUI views with synthetic
state. It does not sign in, scan browsers, query the helper, connect or upload.
The displayed synthetic receipt is labelled as such and is not server evidence.
Nodes route choices and Dashboard wake feedback are **production-component**
captures, not full-page renders. The complete menu-bar view includes its existing
recovery action. No product glass effects are disabled for the test.

The existing hosted `macos-26` workflow runs its unchanged unsigned Release
build and Debug `TonoTests` command, now with
`-resultBundlePath apps/macos/test-results/TonoTests.xcresult`.
The 7-day artifact `tono-macos-tests-<github.sha>` contains that bundle and
bounded direct PNG copies under `renders/`:

- `health-unknown-helper.png`, `build-unverified.png`
- `report-preview.png`, `report-receipt.png`, `report-no-receipt.png`
- `nodes-route-choices-favorite-component.png`, `nodes-region-unavailable-component.png`
- `dashboard-wake-notice-component.png`, `menubar-wake-paused.png`, `network-recovery-running.png`
- `activity-cloud-and-unknown.png`

Outputs are gitignored. Tests check bounded PNG output and opacity samples on
the intentionally opaque canvas; a person or agent must still inspect content
and layout. Run/job/head/checkout and artifact identity must
be recorded in the PR/thread after execution; configuring captures is not proof
they rendered correctly. Linux source checks cannot run XCTest or SwiftUI.

Initial native run [35712148855](https://github.com/raydocs/tono/actions/runs/35712148855)
tested [d8cfa095](https://github.com/raydocs/tono/commit/d8cfa095fa6b7da6d92ebd68fa65510ee68bbf1e)
via a push checkout: unsigned Release build/package, policy tests and privileged
helper tests passed, but XCTest **compilation failed**, so no tests or renders ran.
The capture harness attempted to write the read-only `accessibilityReduceMotion`
environment key. The follow-up uses SwiftUI's animation-disabled transaction
instead.

Follow-up push run [35713898492](https://github.com/raydocs/tono/actions/runs/35713898492)
tested [f84ed4b3](https://github.com/raydocs/tono/commit/f84ed4b3cd15607267d645099cf0b54e203ea85d)
on macOS 26.6.2 arm64, Xcode 26.6 / SDK 26.5. All four jobs passed, including
355 XCTest cases with zero failures and one existing opt-in install-script
emission skip. Artifact `10688412480` contains 11 PNGs and the xcresult.
Actual image inspection found eight readable captures, but the full Dashboard
bitmap was entirely transparent and both whole Nodes images omitted content.
Those three images are **not** visual acceptance despite the test's success.

The narrow harness correction captures `RouteChoicesView` and `RecoveryNotice`
directly, allows one bounded AppKit layout/display turn, and rejects transparent
output rather than relying on PNG byte size. `NSView.cacheDisplay` does not prove
full-page Liquid Glass compositor fidelity; no screen-recording permission or
extra signing/device privilege is requested to work around that limitation.
The red run's artifact `10690501018` contains the corrected components. Direct
image inspection confirmed a readable US picker/recent-success/review action,
a retained unavailable-region picker with no recommendation action, and the
paused-wake notice without clipping. This render result does not turn the
deliberately failing catalog test into a pass. Final corrected-source artifacts
must be matched to the published SHA in PR #278 / the thread.
The report preview's mid-line bottom edge is its normal bounded
180–260pt JSON ScrollView, with spacing before sibling status/actions; the
product UI is not expanded to force all scrollable content into a screenshot.

Not covered by these fixtures: real-account server storage, signed Helper
authorization, installed Core identity, actual network handoffs/sleep, PF/DNS
device protection or customer-channel readiness. Parent owns final combined-SHA
CI and integration. No merge, signing, deployment, tag or feed promotion.
