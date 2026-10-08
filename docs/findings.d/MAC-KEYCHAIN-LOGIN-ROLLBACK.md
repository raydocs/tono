| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-KEYCHAIN-LOGIN-ROLLBACK | macOS 验证登录成功后，首次 refresh token 写钥匙串失败仍在内存保留新令牌、旧账户凭据可回退读取，登录页停在错误态 | in-PR | [#901](https://github.com/raydocs/tono/issues/901)；修复 [#1446](https://github.com/raydocs/tono/pull/1446)；decision 074 provisional | 中·推导 | 非秘密持久标记抑制旧令牌恢复；LoginView 已接 signedOut 错误。原生 XCTest/真实钥匙串拒绝待托管 CI/设备。原双拒绝跨重启回退已由 c7ed2f9b 升为 major，续修见 R1446-grok-F1；成功采纳摘要为恢复前提，持久拒绝先于新验证，不允许旧 token 宽松迁移。本续修代码评审 3c29e3f0→f5c2d4d9 PASSED、minor 一轮关闭；最终精确记录 head 原生待验（结果记 #1452），不用旧 #1446 绿灯代替。 |
