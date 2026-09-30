| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-RETRY-IGNORES-UNPERSISTED-TOKEN | macOS 首次登录远端成功但 refresh token 写入钥匙串失败后，Retry 的 restore 只查空钥匙串，忽略 API 客户端已保留的内存凭据并要求重新登录 | in-PR | #796 | 低·推导 | P3；现有接缝不能低成本注入钥匙串写失败，restore 先执行特权清理，本次按任务例外不新增回归；无 Swift / Xcode，需 hosted macOS CI；设备锚点读取仍先于内存检查，内存凭据不能跨进程重启保留 |

2026-09-30：`adopt` 已在钥匙串写失败时保留 `unpersistedRefreshToken` 和 access token，再向调用方抛错；Retry 经 restore 仅查询钥匙串时却把这一有效会话判成不存在。

`AccountSession+Auth.swift` 改为询问 API 客户端的 `hasRestorableSession`：先用内存 refresh token，并尽力重试持久化；写失败仍保留内存会话，没有内存值才读取钥匙串。未改 `KeychainStore` 的写入接缝或特权恢复流程，不扩展网络路径；仅源码，无新候选。
