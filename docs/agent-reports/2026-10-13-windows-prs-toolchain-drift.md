# Windows PR refresh and toolchain drift (2026-10-13)

Checked `origin/main` at `00ba688c2` before editing, then again at `c046bd088` after the merges below. Did not edit `.github/workflows`. Did not touch #1643, #1605, #1572, #1571, or #1504.

## Windows

| PR | Result | Head CI ran on | Merge |
|---|---|---|---|
| [#1648](https://github.com/raydocs/tono/pull/1648) | Merged. Closes #1052 (issue closed 2026-10-13T21:54:01Z). `needs-hardware`. | `1d339ed49`, [ci-gate 38472742198](https://github.com/raydocs/tono/actions/runs/38472742198) | `ab7a12314` |
| [#1646](https://github.com/raydocs/tono/pull/1646) | Merged. #1280 left open. `needs-hardware`. | `0ab4347a0`, [ci-gate 38472746609](https://github.com/raydocs/tono/actions/runs/38472746609) | `45f8619e5` |

Both branches were merged with current `main` before the rerun. #1648 had no overlapping files. #1646 auto-merged five Windows files with no conflict markers. No review threads and no `CHANGES_REQUESTED` on either.

## Issue #257

Hand check against upstream on 2026-10-13. The open issue body is still the older table (6 behind) from [run 38182900384](https://github.com/raydocs/tono/actions/runs/38182900384). This token cannot edit or comment on issues (`403 Resource not accessible by integration`), and cannot dispatch `toolchain-drift.yml`.

| Component | Pinned on main `c046bd088` | Upstream | |
|---|---|---|---|
| mihomo | `v1.19.32` | `v1.19.32` | ok, #1637 |
| sing-tun | `v0.4.27` | `v0.4.27` (latest mihomo `go.mod`) | ok, #1637 |
| Go | `go1.27.2` | `go1.27.2` (`go.dev/VERSION`) | ok, #1637 |
| Tailscale sidecar | `v1.104.1` (`9a522a978`) | `v1.104.1` | ok, [#1659](https://github.com/raydocs/tono/pull/1659) merged `c046bd088`, [ci-gate 38473437938](https://github.com/raydocs/tono/actions/runs/38473437938) on `c13dea991`. `needs-hardware`. |
| Rust | `1.99.0` | `1.99.0` (channel-rust-stable) | ok, #1635 |
| Sparkle | `2.10.0` | `2.10.0` | ok, #1638 |
| Xray | `v26.3.27` | `v26.3.27` | ok |

No other bump PR. sing-box build scripts still say `go1.27.1` on purpose (artifact digest); that pin is not a #257 row.

Tailscale rebuild used `tooling/scripts/build-tailscale-sidecar.sh` and Go 1.27.2 (`CGO_ENABLED=0`, darwin/arm64). `go version -m` reports `tailscale.com v1.104.1`. SHA-256: `tailscale` `2b21e0ddd537c6bd4ce259703fef077fecaab7ede2a47c656b3c864945d30c80`, `tailscaled` `3840963a115b663af9269a6cb0ad52dbdfd8ad279ae179cebb53dbcad29b5bb1`. The darwin binaries were not executed here. Codesign is still the macOS release path.
