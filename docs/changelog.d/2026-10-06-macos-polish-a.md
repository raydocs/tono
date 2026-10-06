## 2026-10-06 · macOS 海景与整窗打磨 A（待原生验证）
- 归属：SHIP_PLAN 0.0.75 G1/G2 外观准备；仅呈现，不改变连接、保护、helper、PF、路由及账户/更新逻辑。
- 来源：main `4c98c8c1c` → `codex/macos-polish-a-20261006`；草稿，尚未合 main；本条随本 PR 续记证据。
- 缺陷修复：旧海景只有静态胶囊/0.45s 状态淡变，且止于详情列；改为 Windows 参数/11 张原始纹理的原生合成器场景，放在整窗根部，页面切换保留实例。
- 新增/优化：Windows 日出/抵达/日落 token 和真实阶段进度；按 M1 勘误保留 3800ms 余晖保持 +2200ms 同步交接；首页 56pt 轻字重标题、并列 48pt 深色/暖色动作、真实步骤点、底部真实流量与详情；侧栏 32pt 中性选中行。
- 工程与测试：Full/Lite/Static 分离、Auto 有界 3s 探测、低电量 Lite/降低动态 Static；合成器时钟在隐藏/遮挡/最小化/二级页暂停。添加整窗 en/zh 两尺寸、安全状态、可访问性、3×16 实时过渡、Full 水面和 CPU 原始证据夹具。
- 验证：MacBook 不运行原生编译/测试；`git diff --check` 无输出（exit 0），11 PNG 与 Windows 源字节相同。托管编译/XCTest、图像逐张检查、亮度单调性、CPU 预算尚未执行/证明；不得把旧 #1405 证据算作本 PR 通过。
- 候选/发布：仅源码，无新签名候选；不安装、不推进客户源、不编辑 owner G1/G2。
- 剩余限制：A 必须交原生整窗图、帧/亮度/水面差分/实际 CPU 给规格方；看过 A 帧前不启动 B。原生材质使用 AppKit/SwiftUI material，不声称它等于 CSS 的精确 26/34px 模糊核。

### 2026-10-06 · 首轮托管编译续记
- head `0685f5d1` / ci-gate [37524855860](https://github.com/raydocs/tono/actions/runs/37524855860)：policy-tests 的原生编译失败，两处新 renderer 编译问题（CGFloat→NSNumber 的停止点、像素亮度表达式类型推断超时），不是产品运行时缺陷。拆分/显式桥接修正后重跑同一入口；原失败日志保留，不记为通过。
- 同轮修正证据夹具输出目录（以 #filePath 锚定 apps/macos）、Full 水面相对采样时刻；旧 Restore 标签合约跟随新增「Restore normal internet」，没有放宽 OCR/像素断言。补读 Windows 源，保留其 3400/4400/5600ms 日落 day/path/light 时长与 night 曲线，均不是新增延迟。
- 新增只读 PNG 分析脚本，输出全部源像素亮度、相邻差值、严格无容差单调判定、水面/天空差分与标记过的图像条带；不修饰原生源 PNG。`python3 -m py_compile tooling/scripts/analyze-mac-sea-polish.py` exit0；实际图像分析未执行。
