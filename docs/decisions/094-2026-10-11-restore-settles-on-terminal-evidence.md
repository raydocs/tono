## 2026-10-11 · 什么证据才能让“恢复正常网络”显示“已恢复”
- Status: provisional
- Chosen: 一个分项只有在有“终结证据”时才算 settled：能改动它的每个写入者都已证明结束，并且不能被重新拉起。各平台的证据如下。
  - Windows WFP：写入者进程已结束。BFE 会中止已结束客户端的未提交事务，过滤器只在事务里添加。
  - Windows NRPT、DoH 和注册表：由写入者进程内同步写入，进程结束即终结。
  - 内核：进程已不存在。
  - Mac DNS：写入者和 Tono 的 `networksetup` 子进程都已结束，并且存储的网络偏好里已经没有 127.0.0.1。configd 应用的是已提交的偏好（configd-1405 的 SCPCommit/SCPApply/prefsmon）。
  - Mac PF 和路由：Tono 的 `pfctl`、`route` 子进程都已结束，按参数识别。参数读不出的进程，或在扫描时正在运行的其他 `pfctl`/`networksetup`/`route` 写入者，都让对应分项不算 settled。
  - Windows 适配器 IPv4 DNS 经 WmiPrvSE 执行，任何 Job 都管不到，所以每批改动先记入账本，PowerShell 返回后才删除。本次开机里只要还有未销账的批次，就报 unknown，并阻挡 Connect 直到重启。

  被拒绝的方案：两次读回一致即算 settled。它只说明两次采样时没看到变化，不能证明之后不会有迟到写入（Sol 审查 R-F1）。
- Why stricter: “已恢复”需要的证据更多，不放宽任何保护。代价是可用性：某些情况下用户必须重启 Windows 才能再次连接，期间网络保持已解除状态，不会被重新挡住。
- Applied in: PR #1569（`apps/windows/service/src/core/dns/broker_ledger.rs`、`core/release/worker.rs`，以及 Mac `ReleaseWorker.swift`）
