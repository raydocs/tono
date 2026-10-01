## 2026-09-30 · macOS 切换目标目录轮换补排运行时重载
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）；影响 macOS App 目录安装与出口切换。
- 来源：main `80f4b4d0` → 分支 `codex2/mac-catalog-switch-target`；PR #802；未合 main。
- 缺陷修复：A→B 切换仍在验证或等待 PF 收敛时，目录只更新 B 的端点或凭据，原安装器因 A 与住宅路由未变而跳过应用，切换随后继续使用旧 B。改后同时比较切换目标的拨号身份，通过现有 `applyManagedCatalogToRuntime()` 补排重载；`reloadCoreConfig()` 将请求合并到切换后，以已提交的 B 与最新目录重建运行时和 PF 端点，例行轮换不主动断开或解除保护。关联 [MAC-CATALOG-SWITCH-TARGET-STALE](../findings.d/MAC-CATALOG-SWITCH-TARGET-STALE.md)。
- 新增/优化：无；保留既有流式连接延后与有界重试机制，不另建 AI 阻断层。旧目标按 ID 或名称查找；重解析后只在找到新 ID 时重映射，目标缺失仍保留切换标记，避免提前允许并发运行时变更。
- 工程与测试：在现有 `MacUsabilityTests.swift` 增加一条纯决策 XCTest，覆盖 A 不变而 B 轮换须重载、B 不变无需重载、无切换时按当前选择决定；移除先前的释放网络方案与大型异步 fixture。未改 `AppState+Proxy.swift`，避开 #782 的 pins-refresh PF/TUN 等待代码。
- 验证：Linux 工作树 `git diff --check` exit 0，逐行静态复核 Swift 类型、默认参数、可选值与既有重载队列；Swift/XCTest 未编译、未运行，本机无 Swift/Xcode，需 hosted macOS CI 执行；Windows 未运行（未改 Windows）。路由与 PF 端点尚无实机证据，`needs-hardware`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：流式连接可延后补排，届时由连接监视器按既有上限重试，不能宣称每次都在切换提交后立即重载；纯决策测试不覆盖真实 PF/TUN、切换与重载失败恢复。拨号身份比较未覆盖仅 `clientFingerprint` 变化的既有缺口，本次未扩展。未实机验证，未合 main、未发布。
