## 2026-10-13 · Tailscale sidecar v1.102.4 → v1.104.1

- 归属：ops 工具链漂移 Issue #257（与 #1635 / #1637 / #1638 同一轮）；macOS 用户态 sidecar。
- 来源：基线 `origin/main` `00ba688c2` → 分支 `cursor/tailscale-sidecar-1-104-1-f0e8`；PR 见 GitHub。
- 缺陷修复：无。
- 新增/优化：`tooling/scripts/build-tailscale-sidecar.sh` 的钉从 `v1.102.4` / `bbcd7d1fc2054b9189ebc1531acf74bd880ca0c8` 升到 `v1.104.1` / `9a522a9786c97eb7910c01ccb7bd66557b04c910`。同一脚本用 Go 1.27.2、`CGO_ENABLED=0`、`GOOS=darwin`、`GOARCH=arm64` 重建了 `apps/macos/Tono/Resources/tailscale` 与 `tailscaled`。`THIRD_PARTY_NOTICES.md` 写上版本。
- 工程与测试：核对 v1.104.1 源码里 Tono 实际调用的参数仍在（`--tun=userspace-networking`、`--statedir`、`--socket`、`--socks5-server`、`up --auth-key=file:`、`--hostname`、`--accept-routes`、`--accept-dns`、`--shields-up`、`set --exit-node`、`--exit-node-allow-lan-access`，以及 `status --json` 的 `BackendState` / `Self` / `Peer` / `TailscaleIPs` / `ID` / `HostName` / `Online` / `ExitNodeOption` / `CurAddr` / `Relay` / `PublicKey` / `ExitNodeStatus`）。
- 验证：见 PR。本机跑了构建脚本；`go version -m` 为 `tailscale.com v1.104.1`，产物是 Mach-O arm64。未在本机执行这些 darwin 二进制，也未做 tailnet 注册或出口节点。
- 候选/发布：无新包，仅源码与未签名 sidecar。发布前仍需用 App 同一团队做 codesign。
- 剩余限制：sidecar 的运行时网络行为变了，需要实机核对用户态联网、SOCKS 和 exit node。Issue #257 里其余钉（mihomo、sing-tun、Go、Rust、Sparkle、Xray）在 `00ba688c2` 上已与上游一致，本 PR 不动它们。
