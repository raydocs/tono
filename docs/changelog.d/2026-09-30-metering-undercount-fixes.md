## 2026-09-30 · 出口计量与节点配额：补齐重启、ACK 失败与跨周期漏计
- 归属：ops 任务（出口计量、吊销与节点流量配额）；`services/exit-agent`、`services/control-plane/src/ops/quota.ts`。
- 来源：main `c0a44053` → 分支 `codex2/metering-undercount`；PR 待开；未合 main。
- 缺陷修复：`EXIT-AGENT-RESTART-BASELINE`：Xray 重启后首读缺席的账户沿用旧原始基线，迟到的首读漏掉旧基线字节；
  改后保留累计总量、把缺席标签的基线归零。`EXIT-AGENT-INVENTORY-ACK-LOSS`：新增客户端后名册 ACK 失败，库存未落盘，
  后续撤销可能漏掉该客户端；改后 ACK 前仅保存对账后的客户端库存，累计量、基线、标记、待报队列和 sourceId 保持原提交顺序。
  `CP-QUOTA-ROLLOVER-GAP`：过期周期关闭后以当前计数初始化新周期，丢掉末次采样到跨界首读的增长；改后新周期的 last
  计数继承旧周期末次计数，经已有重置检测折入新周期，旧周期 used_bytes 不变。
- 新增/优化：无。
- 工程与测试：exit-agent 新增两条 unittest，分别断言 900 → 重启缺席 → 1200 得累计 2100，以及无实时列表时新增/撤除后
  ACK 失败仅更新库存；更新原有 ACK 失败和时钟拒绝测试的库存预期。节点配额新增一条 vitest，断言跨界增长与计数重置均被计入，
  旧周期总量不变。exit-agent README 同步库存保存顺序。
- 验证：本机 Linux worktree、基线 `c0a44053` 上运行两条新增 Python 回归均按预期失败（1200 ≠ 2100；库存仍旧）。
  修改前 `python3 -m unittest test_reconcile_and_report -q` 跑 97 条、2 条 localhost socket PermissionError；修改后跑 99 条，
  仍仅同两条 socket 错误，其余 97 条通过；另以 stdlib unittest 排除这两条 socket 测试，97/97 通过。相关三组 Python 测试 32/32 通过。
  控制面 `npx vitest run test/ops-quota.test.ts` 修改前后均在测试开始前失败（localhost listen EPERM，Wrangler 日志目录只读）；
  `node node_modules/typescript/bin/tsc --noEmit` 通过。临时离线 harness 挂起后取消，无测试结果。
  此处无 Xcode / Windows，未运行相关编译或实机检查；hosted CI 待跑；已逐行复核 diff。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未部署出口 agent 或控制面，未在真实节点验证；跨界区间整段计入新周期，不按实际边界拆分。
  相关未修：对账部分成功后另一客户端操作失败，或完整对账后缓存/计量校验拒绝本轮时，新增库存仍可能不落盘；本轮仅修完整对账后的 ACK 失败路径。
  节点周期关闭与新周期插入仍是两次独立 D1 写入，中间插入失败时下一轮无法沿用旧 last 基线。
