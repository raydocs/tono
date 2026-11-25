## 2026-11-25 · macOS：卡住的已执行更新不再要等 48 小时才能自助恢复
- 归属：macOS 客户端，仅源码，无新候选；不是 G4 发布。高风险路径（更新事务与断网保护）：风险是过早放开一个仍在运行的更新，保持的不变量见下。
- 缺陷：helper 里的更新尝试停在 `consumed`（执行器崩溃、断电或被中断，没走到 `replaced`）且没有 blocked/断开标记时，`AppUpdater.disconnectRetriable` 返回 false，「Disconnect and Retry」不出现；启动时 `reconcile` 又拒绝接管（`no successor grant`），客户卡在登录页，断网保护一直开着，要等回执 48 小时过期。
- 修复：`consumed` 的回执自上次更新起超过 30 分钟（`AppUpdater.executorSilence`）或已过期，视为执行器已不存在，允许 Disconnect and Retry。helper 未改：`retireResolved` 仍要求所有者经验证的显式 Disconnect，且已装组件必须与捕获的原始组件一致，半替换的安装保留证据、仍为 pending；不降低 consumed 高水位。`replaced` 与 `rolledBack` 的规则不变。
- 测试：`NativeUpdateCallerTests` 新增一条：新鲜 consumed 不可重试、静默满 30 分钟或过期可重试、`replaced` 不适用该规则。
- 未运行：本机不跑 xcodebuild，由托管 CI 验证；红测未在本机运行；未真机验证，也未验证真实执行器 30 分钟内不会仍在写回执（依据：代码里替换为秒到分钟级，未实测）。
- 依赖：与 #1859（诊断与启动提示）互补，无文件重叠需合并顺序。
