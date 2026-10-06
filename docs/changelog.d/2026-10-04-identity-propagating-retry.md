## 2026-10-04 · 新设备身份未被出口确认：不再下发刚铸造的共享 UUID，客户端短间隔重试
- 归属：SHIP_PLAN §2 第 10 项（连不上且无下一手：新用户第一次连接失败或等 5 分钟）。控制面 `catalog.ts`；Windows `tono-core` `auth.rs`/`customer_failure.rs`、App `catalog_sync.rs`/`state.rs`/`commands/account.rs`；macOS `TonoAPIClient.swift`、`AccountSession*.swift`、`Localizable.xcstrings`。
- 来源：基线 `a97c963e` → 分支 `raydocs/fix-identity-propagating-retry-20261004`；尚未合入 main。
- 缺陷修复：
  - CATALOG-SHARED-UNACKED-MINT：设备凭据未就绪时，目录退回共享 UUID。这个 UUID 可能刚铸造、没有出口确认过。现在共享凭据也要通过同一条就绪判定（本次下发的每个出口在它创建后确认过名册），缺失或未就绪返回 503 `EXIT_IDENTITY_PROPAGATING`，不再铸造。已退休和 device_only 的规则不变。
  - CLIENT-PROPAGATING-SLOW-RETRY：两端保留 `503 + EXIT_IDENTITY_PROPAGATING` 的类型。Windows 同一个周期任务 15 秒后再请求目录（原来 300 秒），1 秒重试不再对它重复。macOS 无缓存启动不进入终止错误，保持非就绪状态每 15 秒重试，最多 20 次；登出、恢复网络会取消等待，账户或状态变化后的结果不被采用。
- 新增/优化：无。产品选择见决策 055（provisional）。
- 工程与测试：`worker.test.ts` 新增回归 `never serves a new dual account an exit identity no served exit has acknowledged`。13 个原有用例依赖旧的「铸造即下发」：其中 11 个只测别的行为，改用 `acknowledgeServedExits` 先登记已确认的出口；`keeps catalogs on an acknowledged legacy user credential while the device credential propagates`（原名 `…while exit nodes are being provisioned`）改为验证已确认的共享凭据仍可下发；吊销用例改为直接写入共享凭据，不再靠目录铸造。Rust 回归 `identity_propagating_schedules_the_next_catalog_request_within_30_s`；XCTest `testPropagatingIdentityWithoutACacheWaitsAndStartsOnALaterCatalog`。
- 验证：本机 `services/control-plane`：新回归在旧代码上失败（`AssertionError: expected 200 to be 503`），修复后通过；`worker.test.ts` 207 通过；全量 vitest 1002 通过，`test/parser-properties.test.ts` 因本机借用的 node_modules 缺 `fast-check` 无法加载（环境问题，与本改动无关）。Rust 和 XCTest 本机未运行，由托管 CI 运行。没有实机验证。仅源码，无新候选。
- 独立审查：Codex `gpt-6.1-sol` high 静态审查 `a97c963e...60c0b077`，无 major。两个 minor 已修：Windows 的短重试不再推迟或跳过已到期的策略同步；手动刷新在 300 秒等待期间遇到传播中，周期任务 15 秒内会发现并改用短重试。措辞 nit 已改：macOS 用完 20 次后的错误文案不再承诺自动重试。
- 剩余限制：macOS 等待期间只显示原有的恢复/登录进度，没有「正在准备安全身份」的专门界面；Windows 在出口长期不确认时会每 15 秒请求一次，没有上限（只在登录会话内）；准入/认证路径改动，合并前需要独立的跨厂商审查。

### 2026-10-06 · 补审与一轮 minor 修正
- Codex `gpt-6.1-sol` high 在当前有效账户下只读补审 `60c0b077...9f9fe41c`：无 major 以上发现；旧账户的 401 任务不计通过。
- 新 minor：短目录重试成功并清旗标后，策略虽有时间戳却不能按自己的期限唤醒，可能等到下一目录 tick；普通目录 tick 又可提前同步策略。已修：同一个周期任务分别选择目录 tick/15 秒重试与策略 deadline；纯策略唤醒不额外取目录，所有策略调用均先检查到期。
- 一条 paused-clock 回归模拟 t=285 目录重试成功/reset，策略仍在 t=300 唤醒而不是 t=585；登出 abort、代际 fence 和历史 Delay catch-up 保持。
- 本机只做 `git diff --check`（无输出）；原生回归未在 MacBook 执行，等待精确 head hosted CI 和窄复审。仅源码，无新候选、无客户源变动。
