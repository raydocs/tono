| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MIGRATE-CURRENT-RESTORE | 迁移脚本把 current 挪走之后，若新建符号链接失败，set -e 直接退出，节点失去 current | in-PR | 待开 | 中·推导 | ln 或 mv -T 失败时把原目录移回。未在真实出口上跑迁移。服务重启失败的原 restore 路径未改 |
