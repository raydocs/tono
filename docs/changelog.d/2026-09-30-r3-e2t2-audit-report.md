## 2026-09-30 · E2/T2 独立审查记录与 peer 历史保留决策项

- 归属：SHIP_PLAN §2 item 10；home-agent、节点运维与 core 构建/benchmark 的可靠性复核。
- 来源：报告分支 `hunt/sol-r3ops-audit-report` 从 `origin/main` `1fb29265` 建立；六个独立源码修复见 #995、#996、#997、#998、#1000、#1002。该 PR 仅新增记录，不改变产品行为。
- 缺陷修复：无新增源码修复。登记 `HOME-AGENT-PEER-RETENTION-CAP` 为 open；安全删除历史计数基线需要连续性设计，reporter 尚未部署。
- 新增/优化：完整记录 47 个假设：7 个已确认（6 个修复、1 个未修复），33 个驳回，7 个已知重复；每项记录位置及判定理由。
- 工程与测试：无测试或 CI 修改。报告引用各修复原有失败/通过证据，Ruby hosted checkout 与日志明确列出；不把旧结果声称为报告分支测试。
- 验证：peer 上限问题通过真实 loader/attribution/saver 的隔离临时目录 fixture 重现；新增分片由 `records.mjs findings --id HOME-AGENT-PEER-RETENTION-CAP` 读取，`git diff --check` 检查格式。文档交付不重跑产品套件。
- 候选/发布：仅记录，无新候选、包、签名、部署或发布。
- 剩余限制：#995 仍需独立实机 HY2 验收；真实 systemd/VPS/macOS 网络行为未执行；历史 peer 的安全保留/退休语义未决定。报告创建时尚未完成的 CI 状态见各 PR。
