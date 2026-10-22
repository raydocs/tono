## 2026-10-22 · Windows 缺上行宽限限域诊断（未修复）
- 归属：SHIP_PLAN §2 item 10，WIN-MISSING-UPLINK-GRACE；仅 Windows 连接恢复源码核验文档。
- 来源：基线 `d1232520a742b3e747f7b9a228361d696f24a172`；`t3/win-missing-uplink-grace` draft PR，未合 main。
- 缺陷修复：无。源码确认第二次事件探测失败进入既定健康处置；普通非 strict 可选择性释放，strict / policy rebuild 走受保护重连。finding 保持 open。
- 新增/优化：记录 DIRECT 上行空列表不区分部分原生查询错误、仅 IPv4 的证据局限；区分 310 秒事务期限、30 分钟阶梯预算与尚未决定的缺上行宽限。
- 工程与测试：无源码/测试更改；未为了制造 RED 改写既有“第二次失败重建”测试。决策 060 的恢复子状态及设备定时长前提尚未完成，诊断详见 `docs/findings.d/WIN-MISSING-UPLINK-GRACE.md`。
- 验证：源码/决策及 #1643/#1668/#1397 只读核对；文档执行 `git diff --check` 与 records findings/changelog 读取。Red check / GREEN / native tests / 实机换网均 Not run，不声称通过。
- 候选/发布：仅诊断文档，无新包、部署、合并或客户发布。
- 剩余限制：需要先明确 recovering 共享状态投影范围、可靠上行观察契约及有依据的固定宽限，再做 hosted RED/GREEN；不碰 PrepareCoreStart 或安装恢复锁/所有权。高风险独立审查待父线程完成。
