| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TELEMETRY-429-LOSS | Windows 上传诊断收到 429 时既不保存新报告，也会从 outbox 删除待重试报告 | in-PR | fix/t5-windows | 中·已复现（P1，生产队列回归） | `telemetry_outbox.rs:20-27` 接受 RateLimited/429；`telemetry.rs:356-360` 保留并推进有上限退避；[RED/GREEN](../agent-reports/2026-10-24-t5-windows/README.md)。Windows 原生 App、真实 429 服务及安装机未验证；服务端分桶由 T6 负责 |
