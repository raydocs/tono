| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESTORE-ABANDONS-INFLIGHT-WMI | 「恢复正常网络」的 release worker 直接隔离并结束主 Service，若主 Service 正在跑 WMI DNS 批次，这笔批次永远停在账本里，本次开机内只能重启 Windows 才能再连接 | open | 待开 | 中·推导 | 推导自 2026-10-21 客户时间线（02:30 一次恢复/接管顶掉连接后，02:31 起出现进程 9564 的未完成批次），没有服务日志证实；已按 B-prime 提交源码阶段实现：quarantine 后封闸并有限礼让精确实例的 protocol1 正常批次；尚缺原生 RED/GREEN、独立审查与实机证据（见下） |

### 2026-10-23 · B-prime 源码实现（尚未取得原生执行证据）
- 基线 `acafd91c5c6089b68b66f99ddf6550ff44ef95f2`；RED 脚手架 `a3bdd0619f818287dbf9fe9d9ea8dcf459b78f81`，其下一 FIX 提交启用独立短锁 D、精确 PID+creation-time 单向持久墓碑，以及全目标/重扫共用、最多 10 秒的正常在途礼让。无 C 准入依赖、租约重开或墓碑 GC。
- engine 的初次、retry、native fallback 共用真实 recorded-run。D 下先检查自身墓碑并落账，再放 D 执行；自身完整 settled marker 仍是本次开机条目的唯一退休依据。worker 保持 owner→C→Released durable record→SCM/task quarantine→fence/drain/identity termination→原 cleanup/readback/restart/全量 terminal proof；保留 Core sweep。
- 新 strict scan 只供 worker，显式报告不可检查候选/不完整枚举；其他调用方原行为不动。有界重扫中的新 incarnation 仍封闸并在同一 deadline 内排空，最后 churn pass 保守终止并降级 coverage；没有排空后的无条件 writer sweep。
- 恰好一个 staged 回归通过上述真实生产边界，定义了正常 marker 先于 kill、拒绝 A retry（runner 不被调用）、持 C 时 W 与同 PID 不同 birth 的 R 可运行、genesis/legacy 保留，以及 deadline/模拟终止仍留账。RED/FIX 的整个测试块逐字节相同。**只做了静态/语法检查；没有声称编译通过、观察到行为 RED 或 GREEN。**
- 状态仍 `open`：父线程须取得 windows-2025 上精确 RED/FIX 的编译与行为证据、独立高风险审查。旧/混装/未知协议、abandoned、未知 boot/身份、D/文件失败、真实 SCM/ACL/跨进程争用/PID reuse/迟到 spawn 及 25/32/90 秒边界仍需 Windows 安装机验证；未知/损坏/进程死亡/宽限超时绝不新增退休权限，也不据此显示已恢复。
