## 2026-10-22 · Windows 前端依赖更新保留原生配对约束（#1679）
- 归属：docs/SHIP_PLAN.md G4 的 Windows 候选构建/依赖一致性工程维护；非 ops 部署，不表示发布门或冻结例外已获验收。
- 来源：`main` `d1f948f88efd4e778b92f0df44b3b1f4a0a5ae82`，重放 Dependabot #1679 的 `9d8b3938fa8a7dc831dba1bbe277fb2192c26053`；分支 `t3/fix-windows-app-ci`，最终源码 SHA 见 PR 验证评论，尚未合 main。
- 缺陷修复：无新增客户运行时缺陷声明；CI/依赖工程修正按 finding 总账规则不新增产品 finding。
- 新增/优化：保留原组的 18 项兼容升级；clipboard-manager 采用同 minor 的 2.4.2 patch，clipboard-manager/fs 范围限制为 `~2.4.1`/`~2.6.0`，防止普通重解锁跨越 Rust minor。
- 工程与测试：原 run [39157920559/job117765189982](https://github.com/raydocs/tono/actions/runs/39157920559/job/117765189982) 在 JS clipboard-manager 2.5.0 / Rust 2.4.1 配对断言失败。fs 2.7.1 / Rust 2.6.0、shell 2.5.0 / Rust 2.4.0、updater 2.14.0 / Rust 2.13.1 同样不配对，分别保留 JS 2.6.0、2.4.1、2.13.2。CLI 2.12.3 另触发现有 NSIS 模板同步断言，保留 2.12.1；不修改安装器标记或弱化任何测试。
- 验证：MacBook Node 24 / pnpm 11.26.0，原依赖重放到 main 的 `04d191d55` 上配对回归实跑 RED（`'2.5' !== '2.4'`）；CLI 未拆出时模板回归实跑 RED（`'2.12.1' !== '2.12.3'`）。修正后两个原断言各 1/1 GREEN；`pnpm exec vitest run` 60 文件 / 424 测试通过，`pnpm typecheck` 通过（unchecked indexed access 69，baseline 79），最终 `pnpm install --frozen-lockfile --ignore-scripts` 通过；原始终端日志位置及准确 SHA 见 PR 验证评论。
- 候选/发布：仅源码，无新候选；不部署、不合并、不启用 auto-merge；原 #1679 不关闭，由父线程决定是否采用替代 draft。
- 剩余限制：这 4 项插件 minor 需另作 JS/Rust 成对升级并运行 hosted 原生 CI；CLI 升级需另核 NSIS 上游模板及 Windows 打包。未运行 native Cargo/Swift/Xcode、Tauri/安装器构建、完整 packaging/dev-control 套件、实机或模拟器；最终 head 的 hosted ci-gate 交父线程，不轮询。
