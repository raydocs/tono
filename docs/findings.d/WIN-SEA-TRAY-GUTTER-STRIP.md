| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SEA-TRAY-GUTTER-STRIP | 新外观托盘弹窗只有 312 px 宽：外壳 `.tono-main` 的 `scrollbar-gutter: stable` 在托盘路由（不滚动）也预留 8 px 滚动条槽，右侧露出一条托盘背景没有画到的竖条，左右边距也不一致 | in-PR | A32 Windows 草稿 PR（branch `amp/a32-sea-ui-followups-windows`） | 低·已复现（Linux Chromium 预览） | 只在新外观托盘（`.tono-main:has(.sea-tray)`）取消预留，旧外观托盘与其他页面不变。透明窗口下真机 WebView2 的实际显示未看 |
