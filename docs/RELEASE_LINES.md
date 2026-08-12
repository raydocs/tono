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

- `release/macos` contains the post-Build-62 trust-monotonicity and exact-source
  release fixes. Build 62 remains the latest notarized artifact; these source
  fixes require a future Mac build and do not rewrite Build 62.
- `release/windows` contains Windows 0.0.29 / Service 2.6.5 / protocol 2.11.
  It fixes the 0.0.28 DNS TCP/UDP port-53 stale Tono-owner failure. Windows
  0.0.27 remains the latest published installer until 0.0.29 passes the signed
  Windows build and real-machine release gates.
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
