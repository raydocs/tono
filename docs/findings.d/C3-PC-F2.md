| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C3-PC-F2 | 共享后台整份替换 `PUT exit-catalog` 只做名称/身份占位检查，不跑重新上架时用的客户端准入检查（Reality 字段、network、flow、hy2 server/sni/port），一条客户端不收的条目会让 Windows/macOS 拒收整份目录 | open | [#1273](https://github.com/raydocs/tono/issues/1273) | 低·推导 | 已缓存目录的设备不受影响；新登录/新设备拿不到目录。修复需改约 30 个 worker 测试夹具 |
