## 2026-10-07 · macOS 成功采纳凭据作为会话恢复前提
- 归属：SHIP_PLAN §2 item 10；#901；R1446-grok-F1（批次评审 c7ed2f9b 唯一 major），不是 B/0.0.76 UI。
- 来源：main53676e913；续修 [#1452](https://github.com/raydocs/tono/pull/1452)，新分支 codex/macos-keychain-adoption-proof-20261007，未合 main。
- 缺陷修复：拒绝只信任“无拒绝标记 + 有 Keychain token”。成功落 Keychain 后原子/同步记录绑定服务与 token 的非秘密摘要，才清拒绝记录/采纳会话；新进程要求摘要匹配，缺失、损坏、非普通文件或权限异常不恢复。原“双重拒绝不可消除”不是 major 豁免。
- 既有凭据：服务端验证/账户重绑定回调前先持久写拒绝，失败就不发送新登录；既有摘要不会因一次失败写入被假定消失。没有摘要的旧版本会话需重新登录，不做宽松迁移。持久写失败发生在准备阶段时，新登录未被服务端接受；不得冒称为新账号采纳后的旧账号回退。
- 撤销：采纳失败尽力使用捕获旧 access/refresh 和现有认证 auth/logout，必要时先刷新其旧会话；不读取当前可恢复会话、不把旧响应作为新账号 offline verdict。控制面 revoked_token_hash 为 exit_nodes 字段，未发明新 refresh 撤销接口。
- 工程与测试：一条窄 XCTest 注入记录写入和删除同时拒绝，证明旧条目确实仍在、拒绝文件确实不存在、fresh client 不恢复/不取得 digest/不发旧账号请求、旧凭据撤销被尝试；并证明旧有效摘要下拒绝写失败不会执行服务端验证回调，仍登出且不释放保护。既有拒绝测试只补真实旧 logout 的模拟响应，不改断言。旋转持久化同步更新摘要，保持同账号内存重试。
- 验证：本机 git diff --check/范围核对；MacBook 未跑 XCTest/Keychain/PF/DNS/原生构建。新精确 head CI 与独立 Jev review 待验，不声称旧代码红测已执行。
- 候选/发布：只源码，不改 Helper/release 线，不合并/部署/签名/发包/安装/tag；B 已暂停。G1/G2/断电级持久性待真机，不将源码证据当用户验收。
