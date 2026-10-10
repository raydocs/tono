## 2026-10-10 · Windows 登录失败面板列出每条控制面路径（A3）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A3](../ops/amp-backlog-2026-10-10.md)
  （§1，接 #1462–#1467）；Windows `apps/windows/app` 登录页、`src-tauri/src/tono/transport.rs`、`crates/tono-core`。
- 来源：基线 4e373f06（main）→ 分支 `amp/a3-windows-login-paths`，实现 3d372172；PR 草稿（UI 变更，待所有者看图）；未合 main。
- 缺陷修复：无（体验对齐）。
- 新增/优化：所有路径都失败时，传输错误改用 macOS（#1464）的写法 `label[detail]` 以 `; ` 连接，并在 detail 前加该路径耗时：
  `pinned[10012ms connect: …]; system_dns[30001ms timeout: …]; relay[4003ms <中继>: connect: …]`
  （`tono_core::auth::path_failure`；`system-dns` 改为与 `X-Tono-Path` 和 mac 一致的 `system_dns`；系统 DNS 先于固定地址试过时按实际顺序列出）。
  登录页在错误下方列出「已尝试的连接路径 / Paths tried」：每行路径名（系统 DNS / 固定地址 / Tono 中继）、分类原因、耗时（秒）。
  「复制给客服」的 `Transport: pinned=…, system-dns=…` 一行改为 `Paths: pinned[10012ms connect]; system_dns[30001ms timeout]; relay[4003ms connect]`。
  屏幕和剪贴板只取路径标签、毫秒数和分类词，错误链里的 URL、地址等其余内容不显示、不复制（原有白名单规则不变）。
  外观沿用现有排版（12 px、text.secondary / primary / tertiary、等宽数字），无新视觉样式。
- 工程与测试：新增 `#[test] each_path_failure_carries_its_label_and_elapsed_time`（tono-core）；vitest
  `lists every path the failed sign-in tried with its reason and elapsed time`；原复制用例改用新格式；
  `transport.rs` 的 `a_total_failure_reports_both_paths` 断言改为 `system_dns[`。shell 预览加 `?unreachable` 合成失败。
  i18n 生成类型（`src/types/generated/i18n-*.ts`）随 `scripts/generate-i18n-keys.mjs` 更新。
- 验证（Linux orb，Node 24）：`npx vitest run`（apps/windows/app）399 passed；`pnpm typecheck` 通过（unchecked index 79 = 基线）；
  改动文件 eslint 0 警告。截图：shell 预览（`vite.shell-preview.config.mts`，
  `?route=/login&account=signedOut&unreachable&lang=zh|en[&appearance=old]`）
  [sea-zh](../ops/evidence/2026-10-10-windows-login-paths/sea-zh.png)、[sea-en](../ops/evidence/2026-10-10-windows-login-paths/sea-en.png)、
  [classic-zh](../ops/evidence/2026-10-10-windows-login-paths/classic-zh.png)。
  未执行：Rust 测试（本机 rustc 1.95 < tono-core 要求的 1.98，不装工具链；交 hosted Windows CI）；真机/真实网络登录失败。
- 候选/发布：仅源码，无新候选。
- 剩余限制：DoH、备用端口、隧道这几步失败不进入合并消息（与改前相同），面板只列固定地址、系统 DNS、中继；
  单路径失败（例如不可重发的 POST 超时）仍只显示一行原因（`Transport: <kind>`），无路径列表。
