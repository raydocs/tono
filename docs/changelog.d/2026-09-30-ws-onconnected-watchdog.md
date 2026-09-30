## 2026-09-30 · 本机控制器订阅在初始化失败后仍会重连
- 归属：Windows 应用的流量订阅重连。不改 WFP、DNS、路由或 TUN，不进新的客户包。
- 来源：`main` `cbb4f56a` 上的 `cursor/ws-onconnected-watchdog-a706`（`e4b2f5a6`）；PR #768；未合 main。
- 缺陷修复：连接看门狗只该打断一直不返回的 `connect()`。它以前会留到 `onConnected` 期间。10 秒后看门狗改掉尝试代号，随后的初始化失败就不再关闭套接字、也不再排重连，流量订阅停在半初始化的连接上。套接字一旦被接受就清掉看门狗，初始化失败仍走原来的关闭并重连。
- 新增/优化：无。挂住的 `connect()` 仍由看门狗接管。
- 工程与测试：`use-mihomo-ws-subscription.test.ts` 一条回归。
- 验证：`pnpm exec vitest run src/hooks/use-mihomo-ws-subscription.test.ts src/hooks/use-mihomo-ws-subscription-hung-connect.test.ts`，9 passed。修复前该回归里 `close` 被调用 0 次。
- 候选/发布：仅源码，无新包。
- 剩余限制：`onConnected` 若永远不返回，订阅仍停在那只套接字上。未在 Windows 上跑 Tauri。
