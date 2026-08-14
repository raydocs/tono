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
  snapshotting `127.0.0.1` as the original resolver. Build 62 remains the
  latest published Sparkle artifact until 64 is notarised from a clean
  `release/macos` commit that contains only this line's sources.
- `release/windows` contains Windows 0.0.32 (source) on top of the 0.0.31
  Service pin fix. 0.0.32 adds a pin file at install, proactive token
  refresh, learned control-plane addresses (Service ProgramData via
  `/bootstrap-pins`, mid-session HTTP refresh, NSIS `core-sha256.txt`),
  optional Authenticode publisher thumbprint, broader WeChat/Claude/ChatGPT
  process matching, signed traffic-policy acceptance, a per-app Activity
  view, and human-readable connect errors.
  It retains the stale-runtime repair from 0.0.30: startup replaces an inactive
  but still supervised Tono Core that owns DNS TCP/UDP `127.0.0.1:53`, while
  leaving third-party owners untouched. The 0.0.30 draft is superseded because
  its release workflow compiled Service before the packaged Mihomo was known,
  so neither privileged Service binary carried the required Core SHA-256 pin.
  The 0.0.31 workflow prepares the exact Core first, injects its digest into
  Service 2.6.7 and the install helper, then extracts the final NSIS package and
  verifies both binaries against the packaged Core. The signed customer-candidate
  installer comes from `2fba985` and has SHA-256
  `ce8bacef927d3b44e737a5deff61f0c985d4d03cf037091851153cca2bbc4c37`.
  Windows 0.0.27 remains the latest published installer; 0.0.31 remains a draft
  until one real Windows install/connect/disconnect/reconnect gate passes.
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
