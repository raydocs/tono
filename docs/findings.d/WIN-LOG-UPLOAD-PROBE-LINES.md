| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOG-UPLOAD-PROBE-LINES | 网络日志上传默认开启，服务器确认有收集窗口之前就发出真实审计行（首轮最多 4 MiB，之后每次探测 64 KiB），服务器不存但数据已离开设备 | in-PR | [#1191](https://github.com/raydocs/tono/issues/1191) | 中·推导 | 窗口关闭后的第一段仍会发出一次；macOS 同类问题见 MAC-LOG-UPLOAD-PROBE-LINES |
