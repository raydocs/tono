| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-CANCELLED-RELOAD | 原生更新取消并等完配置重载后不清任务句柄；失败更新退役后切换节点、后续重载和部分监控仍当它在运行 | in-PR | hunt/sol-r3mac-update-reload-retirement | 中·推导（P2） | 需要更新挂起时重载在途，以及更新失败后继续用同一进程；普通 Disconnect 或重启 App 可清除。XCTest 已编写，Linux 无 Swift，待 hosted CI；无实机验证 |

Baseline `e504f6f4`: `AppState+NativeUpdate.swift:34–51` cancels/drains without clearing the slot. A pre-commit cancellation returns at `AppState+Proxy.swift:609–610`; retirement and new Connect do not clear it. Selection rejects at `AppState+Proxy.swift:9`, reload coalesces at `:419`, and monitor guards keep withholding checks. Suspension now fences the old completion, discards queued reloads, marks the session suspended before awaiting, and clears the slot only after draining. No helper, PF, DNS, strict-mode or AI rule changes.
