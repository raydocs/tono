| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WORKER-ENSURE-DEVICE-RACE | 同一安装并发注册会留下没有出口凭据或停在 pending 的设备 | refuted | [#1743](https://github.com/raydocs/tono/pull/1743) | 中·已确认 | 报告里的 SQL 与现行 schema 不符；强制交错测试下胜出事务带凭据，注册关闭时设备为 active |

复核 `services/control-plane/src/devices.ts`：新设备的 `INSERT` 与 `INSERT OR IGNORE INTO device_exit_credentials` 在同一次 `DB.batch`（约 248–282 行），D1 batch 是一个事务。唯一约束失败的是输的那次，整批回滚。胜出方提交时凭据已经在内。

`device_exit_credentials`（`migrations/0034_device_exit_credentials.sql`）的列是 `client_uuid`，没有报告所写的 `vless_uuid` / `hy2_password`。注册关闭时插入的是 `active` 不是 `pending`（约 256–261 行）。注册打开时保持 `pending` 与非竞态路径一致，凭据仍在同一批里。

`test/ensure-device-race.test.ts` 让两次 `ensureDevice` 都在插入前读到「没有这台设备」，再进入 batch。两次都得到同一行：注册关为 active、注册开为 pending，且各有一行凭据。没有可复现的缺陷，未改 `devices.ts`。
