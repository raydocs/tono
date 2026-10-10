| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SEA-TRAY-CONNECTED-OVERFLOW | 新外观固定 320×232 托盘在已连接时速率行加两条快捷线路产生窗口滚动，底栏不再固定 | in-PR | [#1495](https://github.com/raydocs/tono/pull/1495) | 低·已复现（Linux Chromium 预览） | 本轮复测 236/232 px（中文239），底栏文字仍可见，不把先前「被裁」推论当实测；速率行占一条快捷线路，底栏固定，长内容在上方滚动。真机 WebView2/Segoe UI 待验 |

#1460 只让「备用通道」和错误各占一条快捷线路的位置；已连接时的速率行没算进去。复现：`vite --config vite.shell-preview.config.mts`，打开 `?route=/tray&scenario=connected`，视口 320×232，`.sea-tray` 的 scrollHeight 是 236。
