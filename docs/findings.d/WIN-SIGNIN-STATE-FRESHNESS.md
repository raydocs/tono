| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SIGNIN-STATE-FRESHNESS | Windows 登录页只在进入时读一次注册状态、不读 `deliveryDegraded`，并按缓存账号和本机时间判断套餐到期，续费后或名额中途用完时提示会过期失真 | in-PR | 待开 | 中·实测（vitest 红） | 待 Windows 真机；应用重启后拒绝码未知，退回普通「登录已失效」 |
