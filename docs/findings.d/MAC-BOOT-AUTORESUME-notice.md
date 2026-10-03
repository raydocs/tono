| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BOOT-AUTORESUME-notice | 意外重启保持的提示把启动时读到的恢复意图当作「Kill Switch 仍在拦截」的证据：外部恢复（root 紧急解除）已释放 PF 且 App 已接受后，迟到的账户恢复回调仍会设「等待用户操作」暂停并显示该提示 | fixed(c0e7758e) | [#677](https://github.com/raydocs/tono/pull/677) | 中·推导（审查定为 minor：要求外部释放恰好在恢复回调之前被接受） | `acceptCloudOnlyTransport` 只在 `KillSwitchService.isArmed` 仍为真时接受恢复意图（确认的释放会清掉它），提示和暂停另需 helper 确认的屏障（`isProtectionBlocked`）；launch 判定「未确认」时不再显示提示（不再出现提示里的按钮名与界面对不上），自动连接仍由保持拦住。未实机验证 |

来源：合并回归审查 run `a1d498c8`（区间 `e2aff1a3...ccbc50a8`）codex:F1。由 MAC-BOOT-AUTORESUME（#675）的提示派生，按总账
`-notice` 规则单列。Home-US 路径没有提示的问题另见 R675-opus-F1（仍 open）。
