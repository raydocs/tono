| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-0032-0034-INPLACE-UPGRADE | Windows 0.0.32–0.0.34 的核心文件叫 `verge-mihomo.exe`，0.0.75 安装程序原地升级时 Service 替换要求 `Program Files\Tono\tono-core.exe`（`install_service.rs` `runtime_replacement_candidate`），升级在 Service 步骤失败 | accepted-design | 2026-10-08 发布前审读 | 中·推导（读码，未实机） | 所有者 2026-10-08：这批用户先卸载再装 0.0.75。0.0.32 卸载器删 `Tono.exe`/`verge-mihomo.exe` 不带 /REBOOTOK，删除失败也照样删卸载项，留下文件但无安装记录时 0.0.75 停在 `invalid_existing_version`（需手动删 `C:\Program Files\Tono`）；卸载时仍连着会多一次「仍装有网络拦截」确认。现场：0.0.32 1 个用户 3 台设备（D1 2026-10-08） |
