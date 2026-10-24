| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TELEMETRY-429-LOSS | Windows 上传诊断收到 429 时既不保存新报告，也会从 outbox 删除待重试报告 | in-PR | fix/t5-windows | 中·已复现（P1，生产队列回归） | `telemetry_outbox.rs:20-41,97-98,169-178` 接受 RateLimited/429；`telemetry.rs:270-295,358-363` 初次失败与 drain 均保留报告；`auth.rs:1731`/`transport.rs:970-972` 传递 Retry-After，至少等待服务端秒数，本地退避仍有上限；[RED/GREEN](../agent-reports/2026-10-24-t5-windows/README.md)。Windows 原生 App、真实 429 服务及安装机未验证；服务端分桶由 T6 负责 |
