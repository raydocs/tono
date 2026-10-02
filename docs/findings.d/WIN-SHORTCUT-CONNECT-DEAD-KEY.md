| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SHORTCUT-CONNECT-DEAD-KEY | Windows 上用 Ctrl+K 连接时，连接被拒（没选服务器、所选服务器已下架、目录还没到）什么都不发生，像按键失灵；真正的连接失败在主页以外的页面也看不到 | in-PR | [#1351](https://github.com/raydocs/tono/pull/1351) | 低·推导 | 只改快捷键连接；Ctrl+K 断开失败仍然不提示（断开失败时保护状态本身会显示在侧栏和主页）；未在 Windows 实机上复现 |

依据：`apps/windows/app/src/tono-ui/tono-layout.tsx` 的 Ctrl+K 直接 `void tonoConnect()`，拒绝被丢掉。主页按钮对同一类拒绝的处理是：没有可用服务器就打开服务器列表（`connectRejectionNeedsServerChoice`），被更新的操作取代就不提示（`isSupersededConnectRejection`），其余显示错误。快捷键没有这三步，所以没选服务器时按 Ctrl+K 没有任何反应；在设置等页面按 Ctrl+K 连接失败时，失败记录只在主页的进度卡上显示，用户看不到。修复后被拒的快捷键连接会跳到服务器列表（需要选服务器时）或主页（其余失败，进度卡显示后端的失败记录）。2026-10-02 读代码发现。
