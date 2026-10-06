| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| C3-PC-F2 | 共享后台整份替换 `PUT exit-catalog` 只做名称/身份占位检查，不跑重新上架时用的客户端准入检查（Reality 字段、network、flow、hy2 server/sni/port），一条客户端不收的条目会让 Windows/macOS 拒收整份目录 | in-PR | [#1273](https://github.com/raydocs/tono/issues/1273) | 低·推导 | 发布前逐条检查，不通过返回 400 并指出条目；不验证 `server` 是否公网 IPv4；未部署 |
