## 2026-10-10 · 国内 Windows/macOS 付费上线有限独立审计
- 归属：SHIP_PLAN G1/G2/G3/G4；运维能力现状引用ops plan，不新设整库发布门。
- 来源：核实origin/main [a6ef4580fe3a890338ad2f9a1ae786c3318c31a0](https://github.com/raydocs/tono/commit/a6ef4580fe3a890338ad2f9a1ae786c3318c31a0)；分支 `docs/paid-launch-audit-20261010`，独立docs PR，不合并。
- 缺陷修复：无产品修改；新增确认发现 LOGIN-LOG-UPLOAD-COPY / [#1556](https://github.com/raydocs/tono/issues/1556)：首登承诺opt-in，与默认上传及决定076矛盾，已即时通知协调者；主线程确认Windows同样存在，并开[#1557](https://github.com/raydocs/tono/pull/1557)，规范分片由该修复PR维护，本审计不重复建ID。
- 新增/优化：[报告](../reports/PAID_LAUNCH_AUDIT_2026-10-10.md)绑定SHA，区分已修/待合/设备未验、视觉与网络证据、有限试运营和公开收费，列最短验收和责任人；不按Proton功能数量打分。
- 工程与测试：只读GitHub/源码/现有CI日志/归档PNG；沿用#1506/#1542/#1553/#1555有效head证据，不把旧FAIL套修后版本。CI38094235664实际PR merge checkout0ef555d：app-rust709/0、Service489/0；不是本轮重跑最终组合。
- 验证：实际查看GitHub CI38090719777 @dfb06df7的AppKit首页/离线/登录/支持窗口，Mac源码与审计基线相同；Windows设置/托盘及待合1554截图均synthetic IO。现有nightly38089227621 ops110 failed/235 passed/9 skipped，Mac窗口job成功，不报全绿。docs无需产品测试。
- 候选/发布：仅文档，无新候选、包哈希、签名/真机/CN验收；不部署、不发布、不改SHIP_PLAN老板勾选、不启用auto-merge。
- 剩余限制：A13未合；1071仅部分改善；最终组合/保护解除/首登隐私、运维实收告警/容量/备份恢复/退款支持仍须证据。公开付费就绪6–7、视觉7.5–8.2为人工判断区间，不是验收PASS。
