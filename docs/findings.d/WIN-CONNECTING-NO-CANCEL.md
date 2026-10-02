| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CONNECTING-NO-CANCEL | Windows 主界面在「连接中」没有取消入口：连接事务预算 310 秒，卡在某一步时用户只能等、去托盘菜单断开或退出应用 | in-PR | [#1356](https://github.com/raydocs/tono/pull/1356) | 中·推导 | 所有者 2026-10-02 决定加取消。只加界面入口，后端沿用托盘「断开」在连接中已有的路径。没有实机验证。按读码推断：已经发给 Service 的一步（如 StartClash，预算 60 秒）不会被打断，取消后界面先进入「正在恢复」，释放要等它让出 |

依据（`main` `cc673eaa`）：`apps/windows/app/src/tono-ui/ConnectPill.tsx` 的 `connecting` 状态 `disabled: true`（`fc59e406`：当时整个按钮标成「取消」，慢启动时一次误点就把正在进行的连接变成待机加一张「出错了」卡片）；`connection/transaction.rs` 的 `CONNECT_TRANSACTION_TIMEOUT` 是 310 秒。托盘菜单在连接中一直提供断开（`core/tray/mod.rs` 的 `can_disconnect`，测试 `connected_and_connecting_menu_offer_safe_release`），走 `connection::disconnect`：作废当前代、取消事务令牌、走显式释放。

修复（#1356）：连接按钮下方加一个独立的「取消连接」按钮，只在连接中显示，调用同一个 `tono_disconnect`。主按钮不变，仍不可点。此前已经持有保护屏障（`protectionBlocked`）时，先弹和「受保护离线」相同的确认框。被取消的 `tono_connect` 返回 `connection superseded by a newer transition`，界面已把它当作非失败处理，不出错误卡片。回归 `cancels a live attempt from its own control, not from the pill`。
