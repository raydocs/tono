## 2026-09-30 · Windows 更新准备失败后放行
- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；Windows Service 原生更新与 WFP/DNS。
- 来源：main `378c165d` → 分支 `codex2/win-update-prepare-fail-open`；PR #793；未合 main。
- 缺陷修复：Prepare 开始停止 Core 后任一步报错，原先直接返回，留下 Staged 尝试、bootstrap WFP 全阻断与可能仍指向已停止解析器的 DNS。现在非严格模式先按更新 Disconnect 的顺序记录 disconnect-requested、核验 WFP owner，再尽力停止 Core、退休运行意图与清理 active owner，调用同一 `wfp::release()`（内含有界 DNS 恢复）；运行意图写入失败不阻止这次释放。仍向 App 返回原始 Prepare 错误，清理也失败时附上错误；保留尝试证据和原 requiredRecovery，不改成 Unprotected 或 committed。关联 [WIN-UPDATE-PREPARE-FAIL-KEEPS-BLOCK](../findings.d/WIN-UPDATE-PREPARE-FAIL-KEEPS-BLOCK.md)。
- 新增/优化：无。严格杀开关保持原行为；Core 停止前的失败不走这次释放。健康连接保护不变；复用标准释放路径，选择性 AI 阻断由另行的 #738 接入，不在本次实现。
- 工程与测试：`core/update.rs` 新增一条决策回归 `update_prepare_failure_releases_only_after_stop_without_strict_kill_switch`，覆盖非严格且已开始停止 Core 才释放；`windows_kill_switch.rs` 只增加严格意图的只读查询。`server/handlers.rs` 将可能释放的 Prepare 同样登记为 ReleaseKillSwitch 操作，更新原有操作标记回归，避免并发状态读取误称保护保留；错误响应不再声称释放未完成。`update_wire.rs` 注释将「Err 表示没有完成释放」限定为 Disconnect，不改协议。App 现有最终 Service 快照重读会投影已释放状态，无需改 App。
- 验证：本工作树静态复核 Prepare、更新 Disconnect、WFP/DNS 释放与 App 调用链；`git diff --check` 通过，记录读取工具检查通过；逐行复核 Rust 类型、借用、await、错误传播与 cfg。此 Linux 环境没有可用的 Windows Rust 编译环境或 Swift/Xcode，Windows Rust 编译和单元测试、Xcode 与实机均未执行；hosted Windows CI 待跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware；需 Windows 真机故障注入验证停止后 DNS/WFP/身份检查失败和严格模式。标准释放若仍无法证明 DNS 恢复，或无法持久化 disconnect-requested，仍会报清理错误并可能保持阻断；不绕过既有释放规则。尝试保留 pending，后续显式更新 Disconnect 才验证并退休证据。App 的旧错误文案仍写「evidence and protection retained」，连接状态以 Service 重读为准；未改该文案。未重复 #769 的 DNS 快照删除修复或 #779 的停止 Core 前 App 收敛修复。
