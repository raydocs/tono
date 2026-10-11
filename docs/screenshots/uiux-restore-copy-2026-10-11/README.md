# 恢复动作命名、登录恢复按钮、托盘“改用”· 原图

归属 SHIP_PLAN G2。基线 main `80255fe9a`（#1566 合并提交）。**全部是 Linux orb 里的 Chromium（DPR 2）+ 生产组件与 zh/en 资源 + `vite.shell-preview.config.mts` 的合成 native IO，不是真机、不是 WebView2、不是签名包。** 没有真实账号、网络或 helper。PNG 为 `agent-browser screenshot` 原样输出，未拼图、缩放或改像素；已逐张查看。

URL 参数（均为现有 fixture）：登录 `?route=/login&account=signedOut&scenario=protectedOffline&lang=zh|en`；托盘 `?route=/tray&scenario=connected&lang=zh|en`；首启 `?route=/intro&account=signedOut&lang=zh`。

| 场景 | Before（main 80255fe9a 工作树） | After（本分支工作树） |
|---|---|---|
| 登录受保护态，920×600，中文 | [before](before-login-protected-zh-920x600.png)：恢复入口是无边框纯文字「恢复网络」，正文引用「恢复网络」 | [after](after-login-protected-zh-920x600.png)：轮廓按钮「恢复正常网络」，正文同名 |
| 同上，键盘 Tab 焦点 | — | [focus](after-login-protected-zh-focus.png)：焦点环可见（computed outline solid 2px）|
| 同上，860×540（窗口最小尺寸）| — | [after](after-login-protected-zh-860x540.png)：按钮与说明未截断 |
| 同上，English | — | [after](after-login-protected-en-920x600.png)：英文未改动 |
| 托盘已连接，320×232 | [before](before-tray-connected-zh.png)：“布法罗 →” | [after](after-tray-connected-zh.png)：“改用布法罗 →” · [English](after-tray-connected-en.png)：“Use Buffalo” |
| 首启 intro，860×540 | [main](before-intro-860x540.png)：太阳与副标题**不重叠** | — |

## D4 未复现

此前审查看到的 intro 副标题压在太阳光晕上，来自 640 宽的历史截图。Windows 窗口最小宽度是 860（`src-tauri/src/utils/resolve/window.rs` `MINIMAL_WIDTH`），在 860×540 的生产 intro 上文字与太阳分离，因此不做修复。

## 没有被这些图证明的

真机 Windows/Mac 首帧、WebView2 字体与渲染、Mac 原生 SwiftUI 窗口中的新文案（本 PR 只改 `Localizable.xcstrings` 两条 zh 值，Mac 由 hosted CI 编译/XCTest，不另附截图）、真实恢复动作的结果、屏幕阅读器朗读。
