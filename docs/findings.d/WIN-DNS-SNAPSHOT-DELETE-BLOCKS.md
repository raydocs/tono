| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-SNAPSHOT-DELETE-BLOCKS | `restore_protected` 已证明 DNS 恢复并恢复解析器策略后，快照文件删除遇非 NotFound 错误（杀软/备份句柄共享冲突）整体报错，经 `disarm_unlocked` 的 `bounded_dns_call("disarm", ensure_restored())?` 拒绝 WFP 释放：句柄不放手用户就一直被封 | in-PR | [#769](https://github.com/raydocs/tono/pull/769) | 中·推导 | 修复后重试 3 次（约 100 ms 间隔），仍失败按成功收尾并经 `surface_success_note`/`join_notes` 记成功级 note。剩余：①note 复用 `TONO_DNS_RESTORE_DEGRADED` 标记（原义「仅注册表证据接受」，此处外延为「恢复成功但有残留物」）以落入 App 既有 `DNS_WARNING_MARKERS` 告警归类，未加新标记；②note 存留期间（下次成功 enable/restore 前）`update.rs protection()` 要求 `dns.last_error` 为空，更新 Prepare 被「network protection is uncertain」拒绝——所有成功级 note 的既有行为，重按一次 Disconnect（句柄消失后）即清；③遗留快照文件在磁盘上多留一次会话（已核对无害：`PROTECTION_WANTED=false` 看门狗不动、下次 enable 按既有 originals 合并、下次 restore 重试删除）；④两次 restore 各睡至多 200 ms，均在 `DNS_OPERATION` 下、远低于 40 s `DNS_RESTORE_TIMEOUT`。未实机复现 |

来源：2026-09-30 释放路径审计（分支 `glm/win-release-fail-open`，基线 `main` `01c2403f`）。回归测试
`core::dns::tests::a_snapshot_delete_failure_after_a_proven_restore_still_releases`（新 test hook
`set_snapshot_delete_fails` 注入：恢复成功、告警级 note、第二次 `ensure_restored` 通过、句柄消失后下一次恢复删净）。
