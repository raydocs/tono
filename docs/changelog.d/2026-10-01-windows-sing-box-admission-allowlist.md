## 2026-10-01 · Windows sing-box 运行配置改为白名单准入

- 归属：SHIP_PLAN G1；影响 Windows Service（`StartClash` / 运行时替换对 sing-box 文档的准入）。协议版本不变。
- 来源：main `14347158`；分支 `fix/win-singbox-admission-whitelist`；Fixes #1187。未合 main。
- 缺陷修复：#1140 的 `sing_box_runtime.rs` 只拒绝几项（`stack`、非回环控制器、明文 DNS、`insecure: true`），其余都放行给 SYSTEM 核心。改为移植 macOS helper `ownedRuntimeConfigIsSafe` 的白名单：顶层六段、`experimental` 只有 `clash_api`/`cache_file` 且缓存关闭、入站只有 `Tono` TUN 与 127.0.0.1 的 direct/mixed 并要求 Tono-DNS、出站类型限定、`route.final` 为 `Tono-Exit`、DNS `ipv4_only`、全文禁止文件路径/远程规则集/socket mark/`insecure`。键按 Go 解码器折叠后比较，折叠后重复即拒绝。
- 新增/优化：无。
- 工程与测试：既有准入测试改用编译器模板 `tooling/scripts/sing-box/runtime-template.json` 填出的文档；新增 `privileged_files_lan_listeners_and_folded_keys_are_refused`。
- 验证：本机按规定不跑 `cargo`；仅 `rustfmt --check` 通过。Windows CI 是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：高风险（特权路径），合并前需要独立 Codex high 审查。

### 2026-10-01 续记 · 独立审查一轮修复

- Codex（gpt-6-sol，high）审查 `f9919bd6`：major 3 项、minor 1 项。
- 本轮修复：`Tono-Exit` 必须是唯一的 selector，候选和默认只能是 VLESS/Hysteria2 出口（发现 2）；HTTPS DNS 必须 `detour: Tono-Exit`，socks 出站也必须走 `Tono-Exit`（发现 3）；hosts `predefined` 的域名键不再被当作禁用选项（发现 4）。新增测试 `exit_selector_and_doh_must_stay_on_an_exit`。
- 未在本 PR 修：发现 1（DIRECT 规则形状不受限）是 main 上 mihomo 与 sing-box 共有的既有问题，记为 [#1204](https://github.com/raydocs/tono/issues/1204) / `WIN-CORE-DIRECT-RULE-ADMISSION`。
- 验证：本机仅 `rustfmt --check`；Windows CI 是门禁。
