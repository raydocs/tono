| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TRAY-SUPERSEDED-CONNECT-ERROR | Windows 托盘面板点「连接」后，这次连接被更新的操作取代（另一个窗口又点了连接或断开，或与仍在进行的连接重叠）时，面板把拒绝信息当成失败显示成红色错误 | fixed(0c4c07bc) | [#1345](https://github.com/raydocs/tono/pull/1345) | 低·推导 | 只影响托盘面板的提示，不影响连接本身；只改「连接」按钮，「重试」和备用通道的拒绝仍按原样显示；未在 Windows 实机上点出这个时序 |

依据：`apps/windows/app/src/tono-ui/TrayPanel.tsx` 的 `runAction` 对任何拒绝都调用 `setActionError`。后端在连接被新一代操作取代、或已有连接在进行时返回 `connection superseded by a newer transition`、`already connecting`、`a connection transition is already in flight`，这些不是失败的尝试；主窗口（`pages/tono/dashboard.tsx`）和选节点后的自动连接（`services/server-selection.ts`）都用 `isSupersededConnectRejection` 忽略它们并刷新状态，托盘面板没有。结果是连接其实正在进行或已被用户自己的下一个操作取代，托盘却留着一条红色错误，直到下一次操作才清掉。2026-10-02 读代码发现。
