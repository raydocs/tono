| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-PLACEHOLDER-RELEASE | `releaseSequence` 先写占位规则文件再 flush 锚点，磁盘满或 `/Library/Application Support/Tono` 不可写时 `atomicWrite` 抛错、锚点永不 flush：disarm、watchdog、启动释放与 `--emergency-disarm` 全部失败，机器保持阻断（watchdog 还在 DNS 恢复前返回） | in-PR | [#761](https://github.com/raydocs/tono/pull/761) | 高·推导 | 占位写失败只记 stderr（daemon stderr 是 /dev/null，同 BRICK-M2）；规则文件残留旧阻断规则，此时 displaced-main 恢复被跳过（旧版 `load anchor` 行不会把刚 flush 的阻断经释放重载装回；紧急 standalone main 保持，flush 后不拦截流量，Apple/其他产品动态锚点仍被顶替，直到能写占位的下一次释放或下次 arm 的 `ensureAnchorLoaded` 换回）；磁盘满前提未在实机复现；未实机验证 |

`tooling/scripts/core-helper/KillSwitchManager.swift` `releaseSequence()`：`try writePlaceholder()` 位于 `flushAnchor` 之前，`releasePersistedBlockUnlocked()`（disarm/启动释放/watchdog
`observeCoreForWatchdog` 的 disarm 抛错即 return，`recoverDNSAfterStoppedCore` 不再执行）与 `releaseInstalledBlock()`（arm 失败释放、睡眠屏障失败释放、`--emergency-disarm`）都经它。与 hosts pins（BRICK-M2，同一函数内的先例）同类：占位只是让后续 main 规则集重载不再从锚点文件读回旧阻断规则的家务步骤。修复：仍先尝试，失败按 hosts-pins
分支样式记 stderr 后继续 flush；占位失败时跳过 `restoreDisplacedMain` 并记一行 stderr（否则未迁移的旧版 `/etc/pf.conf` 的 `load
anchor from` 行会把刚 flush 的阻断装回、而意图已删，再无路径释放——保持 standalone main 即 `restoreDisplacedMainRuleset`
对其他拒绝情形的既有「kept」结果，flush 之后它不拦截任何流量）；flush 状态检查、锚点空确认、意图删除顺序等守卫不变。回归：`KillSwitchTests.runLifecycleSelfTests`
新增 11b `release-survives-unwritable-placeholder`（占位抛错仍完成 flush/删意图且不抛，且不出现 "main" 步骤；原有第 11 步顺序断言不变：占位成功时
"main" 仍在其位）。
