# iOS review handoff for Cursor

G1/G2 companion work in [Draft PR #204](https://github.com/raydocs/tono/pull/204),
branch `feat/ios-native-companion`; qualification tracked by
[#210](https://github.com/raydocs/tono/issues/210). This directory preserves review
material, not a release, native qualification or a new product implementation.

## Start with the source and UI, not the screenshots as evidence

- [Implementation and native acceptance runbook](../../../apps/ios/README.md).
- [UI preview index and limitations](ui/8c4bd2b5/README.md): twelve individual PNGs,
  three overview boards, self-contained HTML renderer and checksums. These are
  **source-derived static reconstructions, not native screenshots**.
- Source used for the previews and latest portable runtime evidence:
  [8c4bd2b50cd4eb75a73b2a6fd902e60a6ea32051](https://github.com/raydocs/tono/commit/8c4bd2b50cd4eb75a73b2a6fd902e60a6ea32051).
  The later documentation upload does not change that UI or runtime source.
- The last source fix prevents active Connect from reattaching terminal or
  superseded generations. Same-generation re-observation preserves its receipt
  replay floor. AppModel/Protection XCTest regressions are authored, **not run**
  in the Linux Orb. Generation fences are instance-local, not persisted revocation.

## Preserved portable evidence, not Apple execution

[portable-tests.txt](runtime/portable-tests.txt) is the unedited output of the
latest `build-mobile.py` run: **11 Go regressions passed**, including actual Worker
producer-to-runtime admission, packet flow/DNS across restart and QUIC DER
negatives. The builder also regenerated/compared the Objective-C ABI, linked and
executed libbox, and checked repeat-build hashes. [receipt.json](runtime/receipt.json)
records exact source/toolchain/patch/ABI and output hashes. It has `apple: null`.

Receipt SHA256: `fb7f97ee3b026888031a7b20956e0d65fd6102df49d74eb114ddc82460cebbb2`.
The receipt's `inputs` are relative to `apps/ios/`. Runtime binaries and caches
are intentionally not checked in; reproduce using the implementation runbook.
A receipt hash is integrity evidence, not signing or independent provenance.

Other checks executed for that source: six Python/static contracts, project
consistency, Worker telemetry/digest checks, exact artifact verification and
wrong-receipt/Linux-as-Apple negatives; clean diff checks. They are prior evidence,
not tests rerun for this docs-only upload. Native Swift/Xcode, XCTest/UI, Apple
importer/linker, signing, NE routing and iPhone acceptance remain **not run**.

## Workflow permission is still required

The GitHub App cannot push `.github/workflows/ios-ci.yml` because it lacks
`workflows` permission. No executable workflow or alternate execution mechanism
is added by this handoff. The complete corrected patch is preserved unchanged in
the [implementation thread](https://ampcode.com/threads/T-01a0a36e-ff49-74fa-9331-558affc4f10f):

- Executor file: `.amp/in/artifacts/ios-reviewed-ci-workflow.patch`.
- SHA256: `65ee99075a0cfec05511e047ef062e2cc74beacec3c19531e57f7cb562cec85c`.
- It is a complete patch, not a delta requiring the earlier workflow patches.
- It pins Node24.18.0 and installs Worker dependencies from the lockfile before
  producer checks in both portable and Apple jobs. It uses disposable hosted
  runners; no signing, persistent-device privileges or publication steps.

Retrieve the patch from that thread and, **only with authorized workflow
credentials**, apply it on a clean checkout after verifying the hash:

```sh
sha256sum /path/to/ios-reviewed-ci-workflow.patch
git fetch origin feat/ios-native-companion
git switch -c feat/ios-ci-delivery origin/feat/ios-native-companion
git apply --check /path/to/ios-reviewed-ci-workflow.patch
git am /path/to/ios-reviewed-ci-workflow.patch
git push origin HEAD:feat/ios-native-companion
```

No force push; reconcile if the remote advances. Do not treat missing CI as green.
Xcode Cloud is not configured by this upload.

## Review before deciding the next implementation

1. Inspect current UI source alongside the reconstructions. Location is a pushed
   navigation page, not a sheet. Existing draft warnings, Automatic/fallback copy
   and hardcoded diagnostics `Unavailable` / `go1.27.1 / 0` are preserved, not
   corrected by the renderer. They must not be read as current runtime capability.
2. Run the pinned Apple framework build, verify its independently reviewed receipt
   with `--require-apple`, and execute Simulator XCTest and unsigned device builds.
   Test the terminal-generation/active-Connect/queued-receipt regression as well as
   valid first attachment and foreground re-observation. Do not substitute a MacBook
   build or a stock framework for the approved execution/build path.
3. Perform separately authorized signed iPhone acceptance: routing/DNS/IPv6, real
   Reality/HY2 and wrong DER, On Demand, revocation, crash/jetsam, network changes,
   Keychain, UI/VoiceOver and memory. The existing runbook has exact build commands.
4. Keep functional limits explicit: home/process-scoped DIRECT refuse; no ordered
   home fallback grant exists; token expiry requires app reopening; 120-second
   renewal interrupts flows; one live provider session only. Licensing/distribution
   and ops history mapping remain unqualified. These are not all Apple-device gates.

The thread still holds convenience ZIPs, superseded review logs/receipts, the
workflow-only patch and historical diagnostics. Current useful UI assets and
portable text evidence are preserved here without caches, executables, framework
binaries, secrets or customer data. No merge, release, TestFlight or feed change.
