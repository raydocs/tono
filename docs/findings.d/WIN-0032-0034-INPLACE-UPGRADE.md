| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-0032-0034-INPLACE-UPGRADE | Windows 0.0.32–0.0.34 的核心文件叫 `verge-mihomo.exe`，0.0.75 安装程序原地升级时 Service 替换要求 `Program Files\Tono\tono-core.exe`（`install_service.rs` `runtime_replacement_candidate`），升级在 Service 步骤失败 | accepted-design | 2026-10-08 发布前审读；本 PR 提前拒绝旧布局 | 中·推导（读码，未实机） | 所有者 2026-10-08：这批用户先卸载再装。0.0.32 普通 Delete 失败仍删除卸载项，可能留下无记录文件；本 PR 保留卸载优先决策，在覆盖前拒绝旧布局，新卸载器删除失败保留记录及重试入口，不能追溯修旧包。不得让客户直接删除程序目录/网卡；见 windows-install-recovery 指引。历史现场：0.0.32 1 个用户 3 台设备（D1 2026-10-08）；2026-10-17 客户卸载后残留尚未取证 |
