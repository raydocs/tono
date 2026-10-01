## 2026-09-30 · 同一设备再次登录、刷新或登出会作废该设备更早的 refresh
- 归属：SHIP_PLAN §2 第 9 条（密钥与隐私）；控制面会话。发现 H17-G-F5。
- 来源：合入 origin/main `f95a4fff`；分支 `cursor/cp-device-session-revoke-f0e7`（本分支 PR），未合 main。
- 缺陷修复：同一 `device_id` 上再次签发会话，或只登出当前 access token，只作废当前这一条。更早签发的 refresh 默认还能用 30 天。现在 `tokens()` 在插入新会话的同一批语句里作废该设备其余未吊销会话；`POST /auth/logout` 作废该设备全部未吊销会话。其他设备的会话保持有效。轮换语句仍是批次的第一条，失败时仍是 401，不会误伤一次没有兄弟会话的刷新。
- 新增/优化：无。显式吊销设备本来就会作废该设备全部会话，这条路径不变。
- 工程与测试：`revokes earlier refresh tokens on the same device at refresh, the next sign-in, and logout`。
- 验证：Linux 上 Node v22.22.2（本环境没有 Node 24），`npx vitest run test/worker.test.ts -t "just-rotated refresh|session authorization changes|session inserted after|same device at refresh|redeems, confirms"`：5 passed。全量 `npm test` 未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：与 #800 都改 `index.ts` 的登出批次。若 #800 先合入，本分支需要变基并保留「同一设备全部未吊销会话」加上它的后继链。已提交的 refresh hash 仍会按原逻辑作废，不限设备。
