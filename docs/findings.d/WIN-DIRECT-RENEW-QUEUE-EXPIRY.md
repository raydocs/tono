| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RENEW-QUEUE-EXPIRY | Windows Service 的 DIRECT 续租在取得 WFP 操作锁之后才判租约是否到期，排在长 WFP 操作后面超过 60 秒期限的续租被拒绝，尽管请求在期限内已到达、App 一直存活 | open | 待开 | 低·推导 | 前提窄：要有操作持有 `WFP_OPERATION` 到租约剩余时间（约 50 秒）之后，发生频率未知，需 Service 日志或实机；修法方向：取锁前记下到达时刻并按它判到期，身份校验（Core 实例、TUN LUID、端点摘要、Locked 模式）仍在取锁后做，且须先确认看门狗的到期回收不会先一步收走租约；属特权路径的租约语义，冻结期后单独 PR 加独立审查 |

2026-10-05 复核 #1395 时记录，源码推导，未复现。`renew_direct_runtime_reload`（`apps/windows/service/src/core/windows_kill_switch.rs`）先等 `WFP_OPERATION`，取到后才取 `now` 与 `lease.expires_at` 比较；到期即走 `reject_direct_renewal_unlocked`，非 strict 会话由 App 选择性放行，strict 保持拦截，都不泄漏。

不采用的修法：缩短 App 端续租超时。Service 不在传输层取消处理函数，App 提前超时再重试只会在同一把锁后面多排一个请求，结果不变；`LIFECYCLE_TIMEOUT`（65 秒）必须长于 Service 单步的 60 秒预算。[WIN-DIRECT-RENEW-AMBIGUITY](WIN-DIRECT-RENEW-AMBIGUITY.md) 的 40 秒宽限只管没有判决的续租，这里是有判决的拒绝，不在它的范围内。
