# 诊断上传不要再默认关掉

`a68d4e76`（2026-09-03）把周期诊断时间线默认关掉，并用一次性迁移把已经开启的安装强制关掉。发布版的失败上报跟着这个开关，崩溃注解也搭在同一份快照上。结果是用户不手动发诊断时，控制面几乎收不到失败。

这条必须保持默认开启：

- Windows：`periodic_telemetry_enabled` 缺省为开。`periodic_telemetry_default_v2` 只标记旧迁移已经跑过，**不得**在该分支里把开关写成 false。用户关闭时写 `periodic_telemetry_user_chosen`，之后保持关闭。
- 失败上报使用时间线开关。时间线开着，失败就上报。不要再加一个默认关闭的第二开关。
- 上传走已经钉扎的控制面客户端。断网保护开着时，这条直连仍然允许。失败进 `telemetry-outbox.json`（最多 32 条或 256 KiB），下次周期再试。超时不重发。
- 不要把原始主机名日志（`diagnostics/logs`）改成默认上传。那条仍要用户同意，并且服务端没有操作员窗口时不入库。
- AI 服务只认 `claude` / `openai`。主机名不落盘。`routingLeak` 和 `exitSwitched` 还没有实测之前，不要把它们填成 false 再上传。

对应测试：`periodic_telemetry_defaults_on_and_an_explicit_opt_out_sticks`。它在 v2 迁移块里看到 `periodic_telemetry_enabled = false` 就会失败。
