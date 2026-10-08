| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1446-grok-F1 | 新登录已被服务端接受后，恢复拒绝标记与 Keychain 删除同时失败，旧账号令牌跨重启重新可用，设备重绑定后存在跨账号混用 | in-PR | [#1446](https://github.com/raydocs/tono/pull/1446)；[#901](https://github.com/raydocs/tono/issues/901)；续修 [#1452](https://github.com/raydocs/tono/pull/1452) | 高·已确认 | c7ed2f9b grok:F1、Codex 交叉确认 major；拒绝将原“不可消除限制”视为止损豁免。成功采纳摘要作为恢复前提；旧成功凭据必须在验证回调前被持久拒绝，失败则禁止服务端新登录。保留严格清内存/保护意图，捕获旧凭据尽力认证撤销；首轮 Jev 3c29e3f0 三方 PASSED（0 major，Codex gpt-6.1-sol/high）；一轮 minor 修复见 R1452-opus-F1，增量 f5c2d4d9 在源码 8139c5f0 PASSED，minor 已复核关闭；最终精确记录 head 窄回归/CI 待验，未合 main，不填 fixed。 |

Plan: SHIP_PLAN §2 item 10。源码基线 main53676e913，B/#1429 已暂停，不进入本修复。

旧版本只有 token、没有成功采纳摘要的会话要求重新登录；不存在自动信任/迁移旧 token 的后门。新摘要绑定服务与当前 refresh token，不包含原始凭据。读取拒绝缺失/不匹配/非普通文件/不可信权限，且不打开 FIFO 阻塞。

控制面现有认证 `auth/logout` 使用 `sessions.refresh_hash` 和 successor 链撤销；`revoked_token_hash` 位于 exit_nodes，不是 refresh token 撤销接口。仅复用现有认证 API，不改控制面/部署。旧凭据的网络清理不调用当前会话恢复，不给新账号发布旧会话的 offline verdict。
