## 2026-10-11 · Win/Mac 无已保存语言时默认简体中文
- 归属：SHIP_PLAN G2，两端首次启动/登录/设置；仅语言默认值，不改系统语言、恢复策略或保护逻辑。
- 来源：基线 [134e126a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a) → 生产源码 [b1da55bf4](https://github.com/raydocs/tono/commit/b1da55bf4d4fab98d29deac262aa610b4802e1d6)，分支 `amp/default-chinese-language`，[#1561](https://github.com/raydocs/tono/pull/1561)；待准确 head CI 与主线程独立审查，未合 main。
- 新增/优化：无选择或未知语言使用 zh；Windows 不再从浏览器/OS 推导默认，原生模板与启动配置保持一致。保存的 English 与 Mac 明确选择 Auto 保留；Mac 原有 Apply/确认/重开不变。中文已就绪后直接进入既有 intro/account gate，不再要求新装先选语言。
- 缺陷修复：Windows 慢 IPC 的降级首次渲染先加载保存/默认语言资源，避免未翻译键和替换已缓存 English。没有把旧的跟随系统默认冒充安全缺陷。
- 工程与测试：shell fixture 复用生产 preload，不再另行默认 en；Mac XCTest 的 English 文本来源在测试 scheme 显式声明，中文视图/OCR 仍需实际原生捕获。偏好 patch 保持 sparse，不给缺失 language 字段添加会覆盖个人选择的反序列化默认。
- 验证：Linux Node 24，定点 vitest 首轮 15 passed/1 failed（新慢启动测试未等完动态 import）；修正测试等待后 main 2/2 passed，preload 1/1、i18n 10/10、settings 3/3 passed。`pnpm typecheck`：unchecked indexed access errors 69 (baseline 79)；定点 ESLint 0。Swift/native Rust 未在 Linux 执行，待 hosted CI。
- 截图：[13 张已查看的原始中英 PNG 与来源](../screenshots/default-language-2026-10-10/README.md)，Windows 9 张为 Linux Chromium、合成 IO、DPR 2；Mac 4 张使用 hosted ScreenCaptureKit 原始窗口、1×。截图不是安装设备验收。
- 候选/发布：仅源码，无新包、无发布线操作；主线程确认纳入尚未冻结的两端候选。
- 剩余限制：真实 Windows WebView2/Mac 新装、升级保留 English、真实语言 Apply/Cancel/重开仍待最终签名候选包设备验收。登录精简为下一独立 PR；最新所有者顺序为本轮三项及 A13 完成后再冻结，不自行顺延到下一包。

### 2026-10-11 · CI 与截图续记
- 生产源码未变；before 134e126a 仅装入两条新测试时 2 failed / 1 passed，分别证明 fresh en 与 native deadline 下未翻译键，after 同场景通过。
- CI [38106296606](https://github.com/raydocs/tono/actions/runs/38106296606)，head b1da55bf4，实际 checkout [559f6c927](https://github.com/raydocs/tono/commit/559f6c92750bc6c68579750945dd92d7623a8761)：Windows frontend、Tauri 710/0、Mac build/policy/privileged 通过；Mac XCTest 708 tests / 1 skipped / 1 failure，唯一失败是新中文登录按钮的 Vision witness。
- 原图确认“发送验证码”实际可见。按 Apple minimumTextHeight 文档修正中文 OCR 输入尺寸过滤器（默认 height/32 会过滤此处 14 px 控件），仍要求精确原文字、首候选、confidence ≥0.35、原图亮度/完整性与指定窗口/PID/尺寸。不是产品改动、删断言或真实设备通过；准确新 head 原生复验尚待 CI。
- 复验 [38107273790](https://github.com/raydocs/tono/actions/runs/38107273790)，head [430a4da00](https://github.com/raydocs/tono/commit/430a4da00cdf50974340fc1bac8c136a140b861b)，实际 checkout [5533dbce7](https://github.com/raydocs/tono/commit/5533dbce7bc250fd98b432c803899a90333860a3)：708 tests / 1 skipped / 1 failure，仍为同一中文按钮 witness；8 px 输入过滤只识别两行标题，原图按钮仍可见。最终一次定点修正关闭中文识别的输入尺寸预过滤，验收端既有 ≥8 px 原图几何/文字/置信度/亮度/完整性断言全部保留；不扩大至其他 fixture，不把旧截图称为复验通过。
