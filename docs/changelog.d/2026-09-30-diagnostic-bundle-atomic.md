## 2026-09-30 · 诊断包完整校验后原子提交
- 归属：control-plane 自动诊断摄取。
- 来源：origin/main `d7e24ec9` → `hunt/sol-cp-diagnostic-bundle-atomic`，本 PR；尚未合 main。
- 缺陷修复：包尾非法字段或派生聚类错误导致失败响应但前半行已提交 → 六段完整校验后一个 D1 batch；派生聚类在提交后逐项 best-effort，不误报已提交上传失败。关联 SOL-CP-DIAGNOSTICS-PARTIAL。
- 新增/优化：无；AI 同意门、段数量/字段边界、故障告警条件保持。
- 工程与测试：非法第二跳、聚类写入失败各一条窄回归，原源码均失败，修改后通过。
- 验证：Linux / Node24；全量 45 文件 / 956 测试通过；随后新增第二条回归并限长错误日志，最终 diagnostics-clusters 12 测试及 typecheck 通过。详见 PR；未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：追加记录重试仍不幂等；聚类不是诊断包事务的一部分。
