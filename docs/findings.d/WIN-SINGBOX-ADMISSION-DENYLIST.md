| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-ADMISSION-DENYLIST | Windows Service 以 SYSTEM 运行 sing-box 前只做黑名单检查，缺少 mihomo 和 macOS helper 都有的产品白名单（文件路径、非回环监听、`route.final`、Go 键折叠） | in-PR | [#1187](https://github.com/raydocs/tono/issues/1187) | 高·推导 | 当前安装没有 `sing-box.exe`，#1159 合入后才可达；单元测试由 Windows CI 跑，本机未执行 |
