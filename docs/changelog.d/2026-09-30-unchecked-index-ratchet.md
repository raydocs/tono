## 2026-09-30 · 未检查下标的类型错误只许变少
- 归属：工程（质量门）；`services/control-plane`、`services/control-plane/admin`、`services/ops-console`、`apps/windows/app`。
- 来源：`origin/main` → 分支 `qg/unchecked-index-ratchet`。
- 缺陷修复：无产品缺陷。
- 新增/优化：无。
- 工程与测试：现有 `tsc --noEmit`（`strict`）仍必须通过。另一次带 `noUncheckedIndexedAccess` 的编译只在错误数高于已提交基线时失败。基线：控制面 521、admin 99、运维台 219、Windows 前端 79。不改 `tsconfig` 的 `strict`。SwiftLint 未配置，不新加。`tono-core` 的 clippy 未打开：本机 rustc 1.83 编不过 edition 2024，不能证明 crate 已经干净，不能把未验证的 `-D warnings` 送进 CI。
- 验证：`node --test services/unchecked-index-ratchet.test.mjs`；各包 `npm run typecheck`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`tono-plugin-core` 未纳入。它没有现成的 typecheck 脚本，依赖 Tauri guest 绑定。
