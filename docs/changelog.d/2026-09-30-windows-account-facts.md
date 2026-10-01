## 2026-09-30 · Windows 账号页显示套餐、有效期和已用流量
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 6 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 Windows 账号页。
- 来源：基线 main `d2363002` → 分支 `cursor/windows-account-facts-b9f5`；未合 main。草稿：`tono.json` 和 `services/tono.ts` 与 #706 重叠。
- 缺陷修复：无。
- 新增/优化：`/api/v1/me` 早就返回 `plan`、`quotaBytes`、`usageBytes`、`expiresAt`，`tono-core` 的 `User` 也已解析，但 `TonoAccountInfo` 只把邮箱、停用状态和设备上限交给前端。现在四个字段也带上（离线时为 `null`）。账号卡片在邮箱下面加一行：套餐（缺省显示 Tono）、有效期至（没有则显示「长期有效」）、已用流量「37.4 GB / 200 GB」（只有配额和用量都有时才显示）。与 macOS 账号设置里的「Plan / Expires / Usage」对应。只显示、不做任何判断：停用、过期、超额仍由原有服务器逻辑决定。
- 工程与测试：新增 Rust 单测 `account_info_carries_plan_usage_and_expiry_for_display` 和 vitest `TonoAccountCard.test.tsx`；桌面预览新增 `#/account` 路由和账号 fixture。
- 验证：`pnpm exec vitest run src/tono-ui` 通过（9 个文件，40 个测试）；`eslint --max-warnings=0`、`tsc --noEmit` 通过。Rust `cargo test` 未运行：此 Linux 主机缺 Tauri 所需的 webkit2gtk 系统库，交给托管 Windows CI。前后截图见 PR。
- 候选/发布：仅源码，无新候选。
- 剩余限制：用量是服务器记账周期的累计值，页面上不写周期；控制面现在没有下发周期信息。
