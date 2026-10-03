| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ARM-PRELOAD-RELEASE | 已连接会话的再次 arm 或睡眠屏障在 `pfctl` 尚未接受新规则时失败，catch 仍 `releaseInstalledBlock()`，内核里上一份规则被冲掉，Core 继续跑，物理网卡不再被 PF 拦住 | fixed(884e4eee) | [#889](https://github.com/raydocs/tono/pull/889) | 高·推导 | 负载命令已返回 0、或发出后没有应答时仍释放（半提交不能留到下次启动）；`pfctl -f` 非 0 是否从不改内核未在实机核对；未实机 |

`arm`（`KillSwitchManager.swift`）在 `writeRules` / `saveState` / `ensureAnchorLoaded` 里 `ensureMainHook`、`pfctl -nf` 抛错时，内核规则还是上一份。`secureForPowerTransition` 同一 catch。修复后只有 `KernelLoadOutcome.acceptedOrUnknown` 才释放。
