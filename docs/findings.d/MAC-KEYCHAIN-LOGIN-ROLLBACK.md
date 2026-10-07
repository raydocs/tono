| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-KEYCHAIN-LOGIN-ROLLBACK | macOS 验证登录成功后，首次 refresh token 写钥匙串失败仍在内存保留新令牌、旧账户凭据可回退读取，登录页停在错误态 | open | [#901](https://github.com/raydocs/tono/issues/901)；修复 PR 待开 | 中·推导 | 本修复丢弃两账户凭据并回到 signedOut；本机未跑原生 XCTest，需托管 CI。若钥匙串连删除也拒绝，旧持久凭据仍可能留到下一次启动，须另行验证或处理。 |
