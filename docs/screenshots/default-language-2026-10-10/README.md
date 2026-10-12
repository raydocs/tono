# 默认简体中文 · Win/Mac

PR [#1561](https://github.com/raydocs/tono/pull/1561)，归属 SHIP_PLAN G2。目录沿用本轮 UIUX 的日期；实际 Windows 捕获时间为 2026-10-11 UTC。没有真实账号、验证码、节点凭据或个人诊断文件。

## Windows：生产 UI + 生产语言预加载，合成 IO

- Before：[134e126a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a) 的未修改 shell fixture。它独立默认 en；生产 preload 同时存在无选择时跟随浏览器/OS 的另一来源。不要把这两张截图当作原生新装证明。
- After：[b1da55bf4](https://github.com/raydocs/tono/commit/b1da55bf4d4fab98d29deac262aa610b4802e1d6)，shell 复用 `preloadAppData()` 和实际 en/zh JSON；只有 native IO/status 被现有 fixture 替换。Linux Chromium，DPR 2，920×760 CSS px；设置 920×920，窄窗 640×760。PNG 原样归档，不拼图、不修像素。
- 无 `lang` 参数、无保存值、浏览器 `en-US`：首个 DOM heading 分别是“连上，就受保护。”和“登录 Tono”，document lang=zh-CN，缓存 zh。`lang=en` 代表保存的 native English；去掉 override 再打开仍为 English。未知 native locale 回到 zh。
- 捕获前等待实际标题和两帧；九张均已查看。中文窄窗没有横向溢出。正常登录的隐私段落略密，属于下一独立登录精简 PR，不隐藏默认上传披露。

| 场景 | Before | After |
|---|---|---|
| 无选择的 intro | [English fixture](windows-before-intro.png) | [默认中文](windows-fresh-intro-zh.png) |
| 无选择的登录 | [English fixture](windows-before-login.png) | [默认中文](windows-fresh-login-zh.png) |
| 保存 English | — | [intro](windows-saved-intro-en.png) · [登录](windows-saved-login-en.png) |
| 设置 | — | [中文](windows-settings-zh.png) · [English](windows-settings-en.png) |
| 中文窄窗 | — | [640 px 登录](windows-login-zh-narrow.png) |

保存 English 的两张 After 与对应 Before 字节一致；布局没有重做。first-DOM 观察和截图不证明真实 WebView2/IPC/窗口首次 show。

## Mac：hosted 原生窗口，合成状态

新增 XCTest 使用临时 UserDefaults 验证缺失/未知→简体中文、保存 English/明确 Auto 保留，渲染真实 WelcomeIntroView/LoginView。四张原图来源为 source head [b1da55bf4](https://github.com/raydocs/tono/commit/b1da55bf4d4fab98d29deac262aa610b4802e1d6)，[CI 38106296606](https://github.com/raydocs/tono/actions/runs/38106296606)，实际 PR merge-ref checkout [559f6c927](https://github.com/raydocs/tono/commit/559f6c92750bc6c68579750945dd92d7623a8761)，artifact `tono-macos-tests-559f6c92750bc6c68579750945dd92d7623a8761`。

ScreenCaptureKit 只捕获测试进程的指定窗口，原始 PNG 字节逐张归档：intro 760×680、login 760×720，1×。process/app bundle en（测试 scheme）；fixture locale 来自生产语言 resolver，分别 zh-Hans/en。无真实账号、helper IO 或屏幕扫描；不是用户冷启动的首帧捕获。

| 场景 | 简体中文 | 保存 English 的对照 |
|---|---|---|
| intro | [fresh zh](macos-intro-fresh-zh.png) | [saved en](macos-intro-saved-en.png) |
| 登录 | [fresh zh](macos-login-fresh-zh.png) | [saved en](macos-login-saved-en.png) |

四张均已人工查看：文字、邮箱、发送动作可见，无截断。该次 CI 为 708 tests / 1 skipped / 1 failure：中文登录的 Vision 只识别标题，没识别实际可见的“发送验证码”；不能称这次 XCTest 全过。其余三图的原始 receipt `acceptance=passed`。Apple [minimumTextHeight](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/minimumtextheight) 默认 image/32，曾怀疑输入过滤；8 px 和 0 两次修正都未解决，不能再将过滤当作充分原因。协调者已查看准确 CI 38108105926 原图，确认小字号 CJK 未识别而实际内容完整，授权仅把中文按钮 OCR 换成同一 fresh fixture 的生产 button key/app 编译目录精确解析断言；标题 zh-Hans OCR、精确文字/首候选/confidence ≥0.35/原图几何/亮度/完整性/窗口/PID/尺寸断言不变，English button OCR 保留，PNG/txt 保留。按钮 OCR 不声称通过；准确新 head CI 另核，不把这些旧原图冒充复验产物或设备验收。

## 回归与设备缺口

两条新 Windows 回归放到未改生产源码的 before 树时均失败：fresh 返回 en；2 秒 native deadline 提前渲染 `tono.intro.*` 未翻译键。After 同场景通过。设置已有确认保存/跨页面失败锁测试保留。

同一次 CI 的 Windows 原生回归 `startup_defaults_to_chinese_without_overwriting_saved_english` 已执行通过，Tauri 710 passed / 0 failed；Mac build/policy/privileged 通过，但全 gate 因上述 witness 失败。原生偏好/SwiftUI 合成窗口执行不同于真实安装验证。

仍需最终签名 Win/Mac 候选包验收：真正无偏好的新装（英文 OS）、已选 English 的升级、冷启动第一帧、Mac Apply/Cancel/quit/reopen 与原生弹窗语言、OS 权限/屏幕阅读器/真实剪贴板。应用内语言不改变系统语言；Windows 浏览器和 hosted synthetic Mac 窗口都不是安装设备验收。
