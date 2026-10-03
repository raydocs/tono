| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LOG-UPLOAD-PROBE-LINES | macOS 网络日志上传在服务器确认有收集窗口之前就发出真实审计行，服务器不存但数据已离开设备 | fixed(62ed22d4) | [#1192](https://github.com/raydocs/tono/issues/1192) | 中·推导 | 窗口关闭后的第一段仍会发出一次；XCTest 待 macOS CI |
