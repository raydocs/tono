## 2026-09-30 · macOS helper：未提交的 PF 失败不再拆掉正在生效的规则
- 归属：SHIP_PLAN §2 item 10（不断网，且正常连接时不放宽 AI 拦截）；macOS root helper。发现 MAC-ARM-PRELOAD-RELEASE、MAC-HEALTH-UNPROVEN-DOWN。
- 来源：基线 `ff81118a` → 分支 `hunt/grok-helper-arm-release-6122`（本分支 PR），未合 main。
- 缺陷修复：再次 arm 或睡眠屏障在 `pfctl -f` 尚未接受新规则时失败，不再 flush 内核里上一份 `tono.killswitch`。`/killswitch/health` 在 pfctl 没有应答时省略 `live`，第一次读到未过滤时要第二次读同意才报 down。已连接 App 因此不会把一次读失败当成「保护被拆」而断开并留下武装的 PF。
- 新增/优化：无。严格杀开关仍不存在；负载已被接受或发出后无应答时仍 fail-open 释放。
- 工程与测试：`--self-test` 增加 `runFailedCommitReleaseSelfTest` 与 `runUnprovenHealthSelfTest`。helper 协议在含窄层的 main 上为 4.52.8 → 4.52.9，`CONTRACT.sha256` 按 `build-core-helper.sh` 的去注释哈希重算（含 `SelectiveFailOpen.swift`）。
- 验证：本机无 Swift 工具链，`swiftc` / `--self-test` 未执行，由托管 macOS CI 跑 helper 自测。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`pfctl -f` 返回非 0 时按「内核未改」处理，未在实机核对；健康检查连续两次失败仍报 down；未实机。
