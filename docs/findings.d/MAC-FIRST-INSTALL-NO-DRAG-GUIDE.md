| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-FIRST-INSTALL-NO-DRAG-GUIDE | macOS 首装只发 zip：用户在「下载」里双击 Tono.app，/Applications 守卫（`AppDelegate.swift:34-49`）弹窗后退出；文案说「在安装窗口中拖到应用程序」，但没有安装窗口 | fixed(d91a12585) | [#1454](https://github.com/raydocs/tono/pull/1454)（macos-dmg.yml + make-macos-dmg.sh + 发布页链接 DMG） | 中·推导（读码，2026-10-08 安装审查） | 弹窗文案与「Open Applications」按钮不变（改 app 字节会换候选）；app 内「移到应用程序」留给 0.0.76 |
