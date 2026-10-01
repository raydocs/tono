## 2026-09-30 · 延迟故障上传不倒退最后发生时间
- 归属：control-plane 自动诊断故障聚类。
- 来源：origin/main `17580a26` → `hunt/sol-cp-cluster-last-seen`，本 PR；尚未合 main。
- 缺陷修复：延迟故障倒退 last_seen，下一次当前事件错误另开集群 → 两条 join 路径原子取最大时间。关联 SOL-CP-CLUSTER-LAST-SEEN。
- 新增/优化：无；静默间隔、告警和原子计数保持。
- 工程与测试：新增一条当前/延迟/当前事件回归，修复前集群 ID 分裂，修复后通过。
- 验证：Linux / Node24；完整 diagnostics-clusters 文件及 typecheck，详见 PR；未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不回并历史已分裂的集群。
