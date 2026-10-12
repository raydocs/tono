# Release lines and immutable history

Tono has two product release lines and one integration/deployment branch.

| Ref | Owns | May publish |
| --- | --- | --- |
| `release/macos` | `apps/macos/**`, macOS release notes and macOS packaging | `tono-macos-<version>-build<build>` prereleases and Sparkle entries |
| `release/windows` | `apps/windows/**` and Windows packaging | `v<version>` Windows releases and the audited `windows-updates` channel |
| `main` | Reviewed merges from both product lines plus shared services/tooling | The production control plane only |
| `windows-updates` | Machine-generated `latest.json` history | Nothing else; never use it for development |

Platform work is committed and tested on its release line, then merged into
`main` with a normal merge commit. Do not rebase or force-push published release
history. Shared service changes travel with the platform change that requires
them, but production deployment happens only after that change is present at the
exact pushed `main` commit. `npm run deploy` enforces this rule and records the
source SHA in the Cloudflare Worker version metadata.

## Legacy macOS Build 61 and 62 tag audit

The immutable GitHub releases and their signed assets are retained. Their tags
were accidentally created with GitHub's default target because the old release
script omitted `--target`:

| Tag | Immutable tag commit | Reconstructed macOS source | Status |
| --- | --- | --- | --- |
| `tono-0.0.61-build61` | `0cd038d7f3c48cb31e4f0884f7575605e3ee9071` | `531bd228852c92700930b80b8a1379c8a55fcab4` | legacy tag points at Windows 0.0.27 source |
| `tono-0.0.62-build62` | `0cd038d7f3c48cb31e4f0884f7575605e3ee9071` | `82d9a8a8b793a3af74d76ab594e862c1e9c07c7d` | artifact verified; legacy tag points at Windows 0.0.27 source |

Do not move those tags. Future macOS releases use the platform-qualified tag
format and the release script passes and verifies the exact source commit.

## Current source and published state

Source versions in this tree are **macOS 0.0.75 (build 75)** and **Windows
0.0.75**. That is not a claim that either candidate is notarised, signed for
customers, or present on a live update feed. Publication and channel
promotion are separate gated operations; see
`apps/macos/release-notes/build75.md` and
`apps/windows/release-notes/0.0.75.md`. The customer release is 0.0.75: 0.0.74 was
frozen and built (candidate 7403) but never accepted on the owner's devices or
published, and the owner retargeted on 2026-10-05 ([decision 061](decisions/061-2026-10-05-release-is-0075.md)). Its `v0.0.74`
draft, `tono-macos-0.0.73-build73` (older source `bdc75a4e`) and the `v0.0.73` draft
are not moved or reused.

In-tree customer feeds in this checkout (what a control-plane deploy of
*this* commit would serve) are Sparkle `public/appcast.xml` at **0.0.67**
and Windows `public/windows/latest.json` at **0.0.34**. Do not infer a
newer published installer from the source version.

The first customer publication after 0.0.67 / 0.0.34 is gated by
[SHIP_PLAN.md](SHIP_PLAN.md): Connected-means-usable, a next step on
connect failure, a proven protected update journal, then feed promotion
as **0.0.75**. Sparkle and `windows-updates` advance only after the owner
has recorded G1–G3 evidence (for 0.0.75: G1 and G2; G3 moves to 0.0.76, see
[0.0.74 defers G3](decisions/019-2026-09-26-release-0074-defers-g3.md) carried by [decision 061](decisions/061-2026-10-05-release-is-0075.md)) in SHIP_PLAN §6; agents then run G4 per
[AGENTS.md](../AGENTS.md). GitHub `v0.0.72` / `tono-macos-0.0.72-build72`
tags are not those feeds.

- `release/macos` contains the post-Build-62 product line. **Build 64 is the
  macOS rollback baseline**: the last-known-good Sparkle successor to 62
  (`Tono-macOS-0.0.64-build64.zip`) before later feature work. Keep this
  tagged commit immutable. Sparkle will not install a lower `CFBundleVersion`,
  so a bad later build is recovered by shipping this source again as a *new
  higher* build (65+), not by asking users to downgrade. WeChat stays on
  the China-direct path and is found by signature; Claude, ChatGPT, Perplexity
  and Gemini product hosts ride the catalog home hop, including Anthropic's
  first-party IPv4 (`160.79.104.0/21`); IPv6 stays off; Activity is a per-app
  route split with Chinese chrome; connecting no longer drops every connection
  or fails a superseded arm. Helper protocol **3.12.0** restores DNS without
  snapshotting `127.0.0.1` as the original resolver.
- `release/windows` source is 0.0.73 on top of the 0.0.31 Service pin fix
  (Core SHA-256 is injected after the exact Mihomo is prepared, then both
  Service binaries are verified against the packaged Core). Later source
  adds a pin file at install, proactive token refresh, learned control-plane
  addresses (Service ProgramData via `/bootstrap-pins`, mid-session HTTP
  refresh, NSIS `core-sha256.txt`), optional Authenticode publisher
  thumbprint, broader WeChat/Claude/ChatGPT process matching, signed
  traffic-policy acceptance, a per-app Activity view, and human-readable
  connect errors. Startup still replaces an inactive but still supervised
  Tono Core that owns DNS TCP/UDP `127.0.0.1:53`, while leaving third-party
  owners untouched. The 0.0.30 draft is superseded because its workflow
  compiled Service before the packaged Mihomo was known.
- `main` integrates both lines and is the only source allowed to deploy the
  shared control plane.

## Going back to an older Windows build

From 0.0.73 the Windows installer refuses to run over a newer installed
version (`allowDowngrades: false`) and says so. An older build cannot undo
system changes a newer build made. 0.0.73+ suppresses encrypted DNS and
installs a catch-all NRPT rule while protected, and the 0.0.72 Service and
uninstaller know neither (H15-F5, #507). To go back, uninstall the newer
version first (keep application data; its uninstaller restores NRPT and
encrypted DNS), then run the older installer. Never run a 0.0.72 installer
over 0.0.73+: that installer predates this block and allows the downgrade.
If it already happened, reinstalling 0.0.73+ repairs NRPT and encrypted DNS.

## Merge and release gates

1. Run the affected platform CI and Services CI on the release line.
2. Merge the release line into `main`; do not cherry-pick an opaque release tip.
3. Deploy shared services only from clean, pushed `main`.
4. Publish macOS only from clean, pushed `release/macos`; publish Windows only
   from `release/windows`.
5. Verify the immutable tag resolves to the source SHA before advancing an
   update feed or channel.

## Auditing a release package (build provenance)

Each package a release workflow builds gets a GitHub build provenance attestation
([decision 079](decisions/079-2026-10-10-amp-backlog-defaults.md) D8-A: generated and
audited; Tono clients do not check it): the zip from `macos-release.yml` (release and
candidate), the image from `macos-dmg.yml`, the installer and its updater `.sig` from
`windows-release.yml`, the installer from `windows-candidate.yml`, and the signed v1
`manifest.json` with both `.sig` files from `desktop-update-sign.yml` (the package
copies in that bundle keep their producer's attestation). A separate `attest` job, the
only one holding `id-token: write` and `attestations: write`, runs no repository code.
A failed attestation fails the run, so `macos-dmg.yml` (given a run id) and
`desktop-update-sign.yml` refuse that run as a producer.

```sh
gh attestation verify <file> -R raydocs/tono
# Also pin the producing workflow and line:
gh attestation verify Tono-<v>-build<n>-arm64.zip -R raydocs/tono \
  --signer-workflow raydocs/tono/.github/workflows/macos-release.yml \
  --source-ref refs/heads/release/macos
```

An attestation names the workflow run, commit and ref that produced the bytes. It does
not say they are Developer ID signed, notarized, or signed for Sparkle or Tauri. For
macOS, also check the notarization ticket: `tooling/scripts/verify-macos-notarization.sh
<zip>` (`xcrun stapler validate` plus `spctl -a -t exec` on the zip's Tono.app; the
release build and `release-macos.sh` already run it on the zip they ship), and for the
image `xcrun stapler validate <dmg>` and
`spctl -a -t open --context context:primary-signature -v <dmg>` (`make-macos-dmg.sh`
runs both before upload).

## Customer publish (G4)

When an agent may start is set in [AGENTS.md](../AGENTS.md) (owner-written G1–G3
evidence in SHIP_PLAN §6; for 0.0.75 G1 and G2 only). Record each step's run URL, SHA and artifact hashes in the publish's
`docs/changelog.d/` entry ([format](changelog.d/README.md)).

- **Candidate identity.** Before customer promotion, match the release's source SHA,
  version/build and package hashes to the candidate the owner's G1–G3 evidence (0.0.75: G1–G2) names.
  A changed candidate does not reuse that acceptance; it needs new owner evidence.
  The one exception is rebuilding an already-published good source as a higher build
  for rollback.
- **Order (SHIP_PLAN §5).** G4.1 freeze → G4.2 on the owner's internal devices
  first (through internal feeds if the customer feeds do not point there yet) →
  G4.3 customer feeds (Windows: the back-office release row has `verifiedAt` before
  promotion) → G4.4 small group. Checking the customer feed after G4.3 is a follow-up
  check, not a substitute for G4.2.

Both platforms publish the accepted bytes; nothing is rebuilt at publish time. Release
builds are dispatched with `update_release_sequence` (both workflows refuse an empty
value, because bytes without a v1 installed floor refuse every later v1 update). For
0.0.75 the tags are `tono-macos-0.0.75-build75` and `v0.0.75`.

**macOS.** This composite is documented in `macos-release.yml`'s step summary and
has not yet run end to end.

1. The accepted candidate is a `macos-release.yml` run dispatched on pushed
   `release/macos` with `version` and `update_release_sequence`. It signs and
   notarises, and uploads the zip plus `macos-release-proof-<sha>` (holding
   `enclosure.sig`) as Actions artifacts that expire after 7 days; keep copies. The
   workflow has no tag trigger, so creating the tag below starts no build.
2. Tag only now: `gh release create tono-macos-<version>-build<build> --prerelease
   --target <sha> <accepted zip>`, after checking the zip's SHA-256 against the owner's
   evidence. Confirm it is not a draft and that
   `gh api repos/raydocs/tono/commits/<tag> --jq .sha` is the built SHA.
   Then dispatch `macos-dmg.yml` with that tag (or the run id while its artifacts
   last) and the accepted zip's SHA-256: it
   wraps the zip's Tono.app, unchanged and proven file for file, in the signed,
   notarized first-install disk image (a drag-to-Applications window). Download its
   artifact and `gh release upload <tag> <name>.dmg`. Sparkle keeps the zip; the
   release centre links the image for first installs once the tag carries it.
3. `node tooling/scripts/upload-release-asset.mjs --tag <tag>`, run from the root of
   the checkout bound to the `tono` wrangler profile.
4. `node tooling/scripts/publish-macos-appcast.mjs` with the argv of the workflow's
   "Validate the appcast entry" step (`--signature-file` pointing at that run's
   `enclosure.sig`), without `--dry-run`.
5. `git fetch origin windows-updates`, then `node tooling/scripts/generate-release-center.mjs`
   (the deploy script refuses a stale release centre); commit
   `services/control-plane/public/` on `main`; deploy per AGENTS.md.

The proven path is `tooling/scripts/release-macos.sh --version <v> --build <n>
--release-sequence <n> --publish --lifecycle-token <token>`, which does steps 2–5
except the deploy and the disk image (dispatch `macos-dmg.yml` with the tag it creates). It refuses a missing or invalid sequence and checks that the
bundle it publishes carries that sequence. It
builds and packages natively, so it runs on the Mac Studio, never the MacBook. Its
bytes are a new candidate, so it does not publish an accepted workflow candidate; use
it only where the candidate identity rule above allows a rebuild. The
token comes from `sudo tooling/scripts/test-helper-install-lifecycle.sh`, which is
the owner's step.

**Windows.**

1. `windows-release.yml` on `release/windows`, dispatched with `version` and
   `update_release_sequence`, builds the signed draft `v<version>`; its job waits on
   environment `windows-release`. Each run for a version overwrites that draft, so the
   accepted run must be the last one for its version.
2. Check the draft's installer and `.sig` hashes against the owner's evidence, then
   `gh release edit v<version> --draft=false`, then
   `node tooling/scripts/upload-release-asset.mjs --tag v<version>`.
3. `windows-update-promote.yml` validates the bytes, advances `windows-updates` and
   commits `services/control-plane/public/windows/latest.json` to `main`; its job
   waits on environment `windows-update-channel`. Then deploy per AGENTS.md.

Both environments list reviewer `raydocs`, the same account as the agents' token,
so an agent approving them removes the only human check there. Whether that token
can approve its own deployment was confirmed on 2026-09-26 for `windows-release` only (kit
runs recorded in `docs/changelog.d/2026-09-26-kit-0-0-74.md`); `windows-update-channel` is
configured separately and is still untested. By owner decision of 2026-09-28
([agents approve GHA environments](decisions/023-2026-09-28-agents-approve-gha-environments.md)), agents approve GitHub Actions environment approvals
themselves (`windows-release` for any candidate, `windows-update-channel` at G4); none waits
for the owner. Record each approval (run URL, environment, candidate SHA and release
sequence) in the changelog. The customer-publish precondition is unchanged: the owner's
`[x]` for G1–G2 in SHIP_PLAN §6 (0.0.75), and only the candidate that evidence names.

**Rollback.** Moving a feed back to the last good entry only stops machines that
have not updated yet. Updated machines refuse a lower build or release sequence on
both platforms, so recover them by shipping the last good source as a higher macOS
build or a higher Windows version. Worker rollback is `npx wrangler rollback` for
each Worker config; migrations never roll back.
