## 2026-10-07 · macOS stale web pins 修复边界再核实
- 归属：SHIP_PLAN §2 item 10；MAC-WEB-PINS-SUFFIX-STALE。
- 来源：main f2cb79522；仅重新锚定 open finding，不改运行时，独立记录 PR 待编号。
- 缺陷修复：无。当前局部 pins 输入仍通过 /core/sync 重启 Core，不能交付为“不拆其他流的必要钉选热更新”。
- 新增/优化：更新源码位置与延期原因，删掉旧“#958 正在修改”时效性说法；保留 open。
- 工程与测试：文档 only；读 scheduler/decision/emitter/实际 Core sync 的限定路径；不执行原生测试，不声称 stale 地址/流重载已用运行时复现。
- 验证：`git diff --check` 与 findings/changelog records 解析；源码行为与已有证据明确区分。
- 候选/发布：无新包、tag、安装、发布或 release 线变更。
- 剩余限制：需要受授权端口/后缀覆盖边界约束的冗余解析移除方案，或真实局部热更新接口；不能简单启用全量周期重载、扩大 DIRECT 或绕过 PF。三条需实机 finding 未改、保持 open。
