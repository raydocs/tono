| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SEA-TRAY-CONNECTED-OVERFLOW | 新外观托盘弹窗（固定 320×232）在「已连接」时多出速率 / Claude AI 一行，再加两条快捷线路就超出窗口：出现滚动条，底栏「打开 Tono / 切换线路 / 退出」被裁掉一截 | in-PR | A32 Windows 草稿 PR（branch `amp/a32-sea-ui-followups-windows`） | 低·已复现（Linux Chromium 预览） | 预览量得 236/232 px（中文 239）；按 Segoe UI 行高 1.33 估算约 240。修复按 #1460 已有规则：速率行与备用通道、错误一样占掉一条快捷线路。真机 WebView2 未看 |

#1460 只让「备用通道」和错误各占一条快捷线路的位置；已连接时的速率行没算进去。复现：`vite --config vite.shell-preview.config.mts`，打开 `?route=/tray&scenario=connected`，视口 320×232，`.sea-tray` 的 scrollHeight 是 236。
