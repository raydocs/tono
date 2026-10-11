## 2026-10-11 · Win/Mac 无已保存语言时默认简体中文
- 归属：SHIP_PLAN G2，两端首次启动/登录/设置；仅语言默认值，不改系统语言、恢复策略或保护逻辑。
- 来源：基线 [134e126a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a)，分支 `amp/default-chinese-language`；待 PR/准确 head CI 与主线程独立审查，未合 main。
- 新增/优化：无选择或未知语言使用 zh；Windows 不再从浏览器/OS 推导默认，原生模板与启动配置保持一致。保存的 English 与 Mac 明确选择 Auto 保留；Mac 原有 Apply/确认/重开不变。中文已就绪后直接进入既有 intro/account gate，不再要求新装先选语言。
- 缺陷修复：Windows 慢 IPC 的降级首次渲染先加载保存/默认语言资源，避免未翻译键和替换已缓存 English。没有把旧的跟随系统默认冒充安全缺陷。
- 工程与测试：shell fixture 复用生产 preload，不再另行默认 en；Mac XCTest 的 English 文本来源在测试 scheme 显式声明，中文视图/OCR 仍需实际原生捕获。偏好 patch 保持 sparse，不给缺失 language 字段添加会覆盖个人选择的反序列化默认。
- 验证：Linux Node 24，定点 vitest 首轮 15 passed/1 failed（新慢启动测试未等完动态 import）；修正测试等待后 main 2/2 passed，preload 1/1、i18n 10/10、settings 3/3 passed。`pnpm typecheck`：unchecked indexed access errors 69 (baseline 79)；定点 ESLint 0。Swift/native Rust 未在 Linux 执行，待 hosted CI。
- 截图：中英首次 intro/login/settings 将归档于 `docs/screenshots/default-language-2026-10-10/`，Windows 为 Linux Chromium、合成 IO、DPR 2；Mac 使用 hosted ScreenCaptureKit 原始窗口。截图不是安装设备验收。
- 候选/发布：仅源码，无新包、无发布线操作；主线程确认纳入尚未冻结的两端候选。
- 剩余限制：真实 Windows WebView2/Mac 新装、升级保留 English、真实语言 Apply/Cancel/重开仍待最终签名候选包设备验收。登录精简为下一独立 PR，冻结不无限等待它。
