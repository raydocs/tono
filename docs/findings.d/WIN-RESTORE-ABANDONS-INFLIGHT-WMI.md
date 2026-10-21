| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESTORE-ABANDONS-INFLIGHT-WMI | 「恢复正常网络」的 release worker 直接隔离并结束主 Service，若主 Service 正在跑 WMI DNS 批次，这笔批次永远停在账本里，本次开机内只能重启 Windows 才能再连接 | open | 待开 | 中·推导 | 推导自 2026-10-21 客户时间线（02:30 一次恢复/接管顶掉连接后，02:31 起出现进程 9564 的未完成批次），没有服务日志证实；候选修复是 worker 在隔离主 Service 前等待本次开机、调用进程仍在的批次返回（上限约 POWERSHELL_TIMEOUT） |
