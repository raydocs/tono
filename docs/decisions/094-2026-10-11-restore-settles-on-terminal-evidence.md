## 2026-10-11 · 什么证据才能让“恢复正常网络”显示“已恢复”
- Status: provisional
- Chosen: 一个分项只有在有“终结证据”时才算 settled：能改动它的每个写入者都已证明结束，并且不能被重新拉起。各平台的证据如下。
  - Windows WFP：写入者进程已结束。BFE 会中止已结束客户端的未提交事务，过滤器只在事务里添加。
  - Windows NRPT、DoH 和注册表：由写入者进程内同步写入，进程结束即终结。
  - 内核：进程已不存在。
  - Mac DNS：写入者和 Tono 的 `networksetup` 子进程都已结束，并且存储的网络偏好里已经没有 127.0.0.1。configd 应用的是已提交的偏好（configd-1405 的 SCPCommit/SCPApply/prefsmon）。
  - Mac PF 和路由：Tono 的 `pfctl`、`route` 子进程都已结束，按参数识别。参数读不出的进程，或在扫描时正在运行的其他 `pfctl`/`networksetup`/`route` 写入者，都让对应分项不算 settled。
  - Windows 适配器 IPv4 DNS 经 WmiPrvSE 执行，任何 Job 都管不到，所以每批改动在进程创建前先记入账本，只有脚本走到最后、每个 CIM 调用都有答复才删除。Connect 准入在机器锁下直接读账本。旧版本没有账本，所以账本第一次使用时为它们记一个属于当前开机的条目。
  - Windows 的 Job：解除服务证明 Job 里没有进程、并再读一次全部分项之后，记录才写成 completed。持有 Job 的解除服务死掉不算证明。

  重启的作用（Sol 第二轮审查 R2-F3）：重启只证明旧进程都已结束，不证明持久状态干净。上一次开机留下的未完成解除、没 settle 的分项、丢失的历史、无主的 Job、账本条目，都要在新的开机里再做一次“恢复正常网络”，读回全部 settle 后才清除。本次开机的 WMI 条目和无主 Job，只有重启之后再恢复一次才能清除。开机身份任何一部分读不出，都按同一次开机处理。

  被拒绝的方案：两次读回一致即算 settled。它只说明两次采样时没看到变化，不能证明之后不会有迟到写入（Sol 审查 R-F1）。
- Why stricter: “已恢复”需要的证据更多，不放宽任何保护。代价是可用性：某些情况下用户必须重启 Windows、再点一次恢复，才能再次连接；首次从旧版本升级后的那次开机里做恢复也是这样。期间网络保持已解除状态，不会被重新挡住。
- Applied in: PR #1569（`apps/windows/service/src/core/dns/broker_ledger.rs`、`core/release/{mod,worker,daemon}.rs`，以及 Mac `ReleaseAuthority.swift`、`ReleaseWorker.swift`）
