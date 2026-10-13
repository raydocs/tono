| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5-MAC-LIFECYCLE-1303 | 退出登录吞掉钥匙串删除失败导致下次启动还原账号；clearAccount 留下上一账号的诊断残留；`--emergency-reset` 在 AI 层待清除时仍移除 helper | in-PR | [#1303](https://github.com/raydocs/tono/issues/1303)，决定 121 | 低·推导（P3，读码） | 删除、墓碑、采用证明三者都失败时重启仍可能恢复（界面报错）；TelemetryOutbox 未按账号分隔（基线）；实机未验证 |
