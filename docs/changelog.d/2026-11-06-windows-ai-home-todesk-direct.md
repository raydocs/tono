## 2026-11-06 · Windows AI Home 路由模式、Home 域名网关放行与 ToDesk 直连后缀

- 归属：SHIP_PLAN G1（已连接=能用；Decision 130 / 131：AI Home 模式下名单内 AI 流量失败关闭且绝不退回直连，普通业务、UDP P2P、STUN/NAT 穿透、局域网与原生 IPv6 直连不过滤；稳定模式与三层路由的整机失败关闭保护保持不变）。影响 Windows 核心/服务/桌面客户端、macOS 与控制面直连后缀、iOS 桌面路由摘要同步。
- 来源：`main` `519afda4` → `feat/windows-ai-home-remote-desktop`。
- 缺陷修复：Windows `three_tier.rs` 原先只允许公网 IPv4 作为 Home SOCKS5 网关地址，遇到真实账号下发的供应商域名网关（如 `isp.decodo.com`）会在三层路由与 AI Home 下拒绝启动；桌面直连后缀名单原先含向日葵（`oray.com`、`sunlogin.com`）与网易 UU 远程（`163.com`、`netease.com`），但缺少 ToDesk 官方域名（`todesk.com`、`todesk.cn`）。
- 新增/优化：
  1. 在 Windows `tono-core`、macOS `ConfigPipeline` 与 `services/control-plane` 同步加入 `todesk.com`、`todesk.cn` 直连后缀（继续排除 `oray.net`、`orayer.com` 动态域名边界），并同步 `apps/ios` 桌面路由摘要。
  2. 将 macOS `#1702` 的 `public_hostname` Home SOCKS5 网关准入移植到 Windows `tono-core/src/three_tier.rs`，经由 `Tono-Exit` 转发域名目标并拒绝保留后缀与裸数字主机名。
  3. 端到端落地 Windows `AI Home`（`"ai-home"`）路由模式：`tono-core` 编译与校验 `ai-home-template.json` 并拒绝混合路由标签；`tono-service` 升级协议修订号 `22 -> 23`（`MIN_SERVICE_REVISION_FOR_AI_HOME = 23`），新增 `ai_home_scoped` WFP 窄域保护（仅放行回环与锁定后的 WinTUN LUID，持久阻断 Anthropic/AI 裸 IP 段 `160.79.104.0/21` 与 `2607:6bc0::/48`，不安装整机 `WEIGHT_BLOCK_ALL`，收紧整机保护前先提交 WFP 再移除窄域意图，并拒绝运行期端点数目变更）；`apps/windows/app` 新增 `DesktopSessionMode`（有 `home_socks5` 时默认 `AiHome`，无家宽线路时自动回退 `Stable`）、连接阶段/健康探针/冷切换与活动页直连标签识别，以及设置页中英双语三档模式切换。
- 工程与测试：`.github/workflows/windows-ci.yml` 增加 `tooling/scripts/sing-box/ai-home-template.json` 触发路径并同步 `ci-gate-changes.test.mjs`。
- 验证：`cargo test --locked -p tono-core`（369 项单测 + 7 个集成测试二进制全部通过）与 `cargo clippy --locked -p tono-core --all-targets -- -D warnings` 通过；`TMPDIR` 隔离下 `apps/windows/service` `cargo test --locked --features standalone,client,test --lib` 612 项通过；`services/control-plane` `npm run typecheck` 与 `vitest run test/worker-traffic-policy.test.ts`（18 项）通过；`apps/windows/app` `pnpm i18n:types`、`pnpm i18n:check`、`pnpm typecheck`、`pnpm test`、`pnpm test:dev-control`（126 项）及跨平台路由同步检查（`sync-routing-domains.mjs --check`、iOS/Android `sync-desktop-routing.py --check`、`ci-gate-changes.test.mjs`、`windows-ci-paths.test.cjs`）全部通过。Linux 环境无 `webkit2gtk-4.1` 头文件与 Windows 交叉工具链，`src-tauri` 原生测试由 GitHub Actions `windows-2025` 执行。
- 候选/发布：仅源码与 PR，无新候选包、签名产物或生产部署。
- 剩余限制：`src-tauri` 与 Windows WFP 真机行为需经 CI `windows-2025` 及 Windows 实机（ToDesk / UU 远程直连与 AI Home 阻断演练）进一步验证。
