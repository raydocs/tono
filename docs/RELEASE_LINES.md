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

Source versions in this tree are **macOS 0.0.73 (build 73)** and **Windows
0.0.73**. That is not a claim that either candidate is notarised, signed for
customers, or present on a live update feed. Publication and channel
promotion are separate gated operations; see
`apps/macos/release-notes/build73.md` and
`apps/windows/release-notes/0.0.73.md`.

In-tree customer feeds in this checkout (what a control-plane deploy of
*this* commit would serve) are Sparkle `public/appcast.xml` at **0.0.67**
and Windows `public/windows/latest.json` at **0.0.34**. Do not infer a
newer published installer from the source version.

The first customer publication after 0.0.67 / 0.0.34 is gated by
[SHIP_PLAN.md](SHIP_PLAN.md): Connected-means-usable, a next step on
connect failure, a proven protected update journal, then feed promotion
as **0.0.73**. Sparkle and `windows-updates` advance only after the owner
has recorded G1–G3 evidence in SHIP_PLAN §6; agents then run G4 per
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

## Merge and release gates

1. Run the affected platform CI and Services CI on the release line.
2. Merge the release line into `main`; do not cherry-pick an opaque release tip.
3. Deploy shared services only from clean, pushed `main`.
4. Publish macOS only from clean, pushed `release/macos`; publish Windows only
   from `release/windows`.
5. Verify the immutable tag resolves to the source SHA before advancing an
   update feed or channel.

## Customer publish (G4)

When an agent may start is set in [AGENTS.md](../AGENTS.md) (owner-written G1–G3
evidence in SHIP_PLAN §6). Record each step's run URL, SHA and artifact hashes in
[INTERNAL_CHANGELOG.md](INTERNAL_CHANGELOG.md).

- **Candidate identity.** Before customer promotion, match the release's source SHA,
  version/build and package hashes to the candidate the owner's G1–G3 evidence names.
  A changed candidate does not reuse that acceptance; it needs new owner evidence.
  The one exception is rebuilding an already-published good source as a higher build
  for rollback.
- **Order (SHIP_PLAN §5).** G4.1 freeze → G4.2 on the owner's internal devices
  first (through internal feeds if the customer feeds do not point there yet) →
  G4.3 customer feeds (Windows: the back-office release row has `verifiedAt` before
  promotion) → G4.4 small group. Checking the customer feed after G4.3 is a follow-up
  check, not a substitute for G4.2.

**macOS.** This composite is documented in `macos-release.yml`'s step summary and
has not yet run end to end.

1. Tag `tono-macos-<version>-build<build>` on pushed `release/macos`.
   `macos-release.yml` signs and notarises, and uploads the zip plus
   `macos-release-proof-<sha>` (holding `enclosure.sig`) as Actions artifacts that
   expire after 7 days.
2. `gh release create <tag> --prerelease --target <sha> <zip>`; confirm it is not a
   draft and that `gh api repos/raydocs/tono/commits/<tag> --jq .sha` is the built SHA.
3. `node tooling/scripts/upload-release-asset.mjs --tag <tag>`, run from the root of
   the checkout bound to the `tono` wrangler profile.
4. `node tooling/scripts/publish-macos-appcast.mjs` with the argv of the workflow's
   "Validate the appcast entry" step (`--signature-file` pointing at that run's
   `enclosure.sig`), without `--dry-run`.
5. `git fetch origin windows-updates`, then `node tooling/scripts/generate-release-center.mjs`
   (the deploy script refuses a stale release centre); commit
   `services/control-plane/public/` on `main`; deploy per AGENTS.md.

The proven path is `tooling/scripts/release-macos.sh --version <v> --build <n>
--publish --lifecycle-token <token>`, which does steps 2–5 except the deploy. It
builds and packages natively, so it runs on the Mac Studio, never the MacBook. The
token comes from `sudo tooling/scripts/test-helper-install-lifecycle.sh`, which is
the owner's step.

**Windows.**

1. `windows-release.yml` on `release/windows` builds the signed draft; its job waits
   on environment `windows-release`.
2. `gh release edit v<version> --draft=false`, then
   `node tooling/scripts/upload-release-asset.mjs --tag v<version>`.
3. `windows-update-promote.yml` validates the bytes, advances `windows-updates` and
   commits `services/control-plane/public/windows/latest.json` to `main`; its job
   waits on environment `windows-update-channel`. Then deploy per AGENTS.md.

Both environments list reviewer `raydocs`, the same account as the agents' token,
so an agent approving them removes the only human check there. Whether that token
can approve its own deployment is untested as of 2026-09-24. Self-approve only for
the G4 publish; a signed candidate for G3 waits for the owner's approval. Record
each approval (environment, run URL, SHA) in the changelog.

**Rollback.** Moving a feed back to the last good entry only stops machines that
have not updated yet. Updated machines refuse a lower build or release sequence on
both platforms, so recover them by shipping the last good source as a higher macOS
build or a higher Windows version. Worker rollback is `npx wrangler rollback` for
each Worker config; migrations never roll back.
