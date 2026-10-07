| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-KEYCHAIN-LOGIN-ROLLBACK | macOS 验证登录成功后，首次 refresh token 写钥匙串失败仍在内存保留新令牌、旧账户凭据可回退读取，登录页停在错误态 | in-PR | [#901](https://github.com/raydocs/tono/issues/901)；修复 [#1446](https://github.com/raydocs/tono/pull/1446)；decision 074 provisional | 中·推导 | 非秘密持久标记抑制旧令牌恢复；LoginView 已接 signedOut 错误。原生 XCTest/真实钥匙串拒绝待托管 CI/设备。若标记写入与钥匙串删除同时失败，则无持久拒绝记录，旧凭据仍可能在下次启动恢复；须修复存储或服务端撤销。 |
