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
- 呈现内续修：月亮/光晕/流星的相位循环单独暂停，父层仍能完成退场；保留失败星点 2600ms、月亮回场 4200ms 时长，仍不新增 moon 延迟。增加实际 CALayer Full > Lite > Static(0) 循环回归；整窗证据明确排除窗口外阴影，不裁切图像。
- 新增 provisional 决策 070：首页只显示当前线路最近 120s 的成功带时间实测（对应现有两分钟刷新），未知/失败/缓存无时间不补数字；不改变测量器或处理器。en/zh 新资源 `%lld ms` → `%lld 毫秒`。这些续修尚待最终 head 原生验证。

- 第二轮 a07fbfb1 / [37525498343](https://github.com/raydocs/tono/actions/runs/37525498343)：Release app 构建、policy-tests、privileged-tests 已通过；XCTest 编译失败，因为 SwiftUI 的原生 accessibility/contrast 环境是只读。改为场景/表面的共享呈现输入，生产从 OS 环境读取、预览/夹具显式注入同一值；不写系统辅助功能偏好、不伪造 OS 标志，也不绕过动态/透明/对比度的真实呈现分支。夹具证明呈现回退，尚不证明 OS 偏好通知或真机设置路径。

- 状态整窗夹具使用 Full 的真实初始挂载 + 活动循环，不以 Reduce Motion 代替普通截图；过渡与导航实例保留另由同窗实时序列证明。CPU 收据明确只是合成状态 UI test host 自身，未叠加真实网络/helper 负载，不冒充 owner 连接设备预算验收。

- 第三轮 74d882d6 / [37527579501](https://github.com/raydocs/tono/actions/runs/37527579501)：Release app、policy-tests、privileged-tests 已通过；XCTest 编译因两处 `Any as? CGColor`（CF 类型不能条件向下转型）失败。改为先核对 CFTypeID 再桥接；这是夹具编译修正，原始运行失败仍保留。
- 按本机 SDK NSView.h271–273/CALayer.h259–275 的公开契约启用自定义子层 Core Image filters，并相对 AppKit 实际 backing 层级规范化一次 top-down 坐标，避免盲目双翻转；加一条窄回归。尚未取得原生帧，均待新 head 的托管验证，不把源码推断写成截图通过。

- 第四轮 2323e462 / [37529037448](https://github.com/raydocs/tono/actions/runs/37529037448)：Release app、policy/privileged 已通过；XCTest 仍在 CF 颜色夹具编译处失败，SDK 指明应使用 `CGColor.typeID` 而非旧 C API。按该诊断修正，不删除检查、不放宽测试。
- 设置 Motion 对旧 Simple 存值只做显示映射 Lite，避免四档控件无匹配标签；只在用户选择时写新值，旧存值不自动覆盖。追加一条窄回归，未扩展 B 的面板/控件打磨范围。

### 2026-10-06 · 第一批真实原生图（bded69b8）
- [37530231293](https://github.com/raydocs/tono/actions/runs/37530231293)：Release app、policy/privileged 通过；632 XCTest，1 skipped、1 failure。新整窗与动效测试均执行并通过，旧 stored-off 详情夹具因暖色胶囊 1 个 alpha254 像素失败；原图/ImageIO/重复图一致。源码给桥接场景补不透明 SwiftUI 底，不降低原断言。
- 原始像素分析：arrival 16 帧单调；rise 首段下降，set 首段回升、末段微升，严格整窗单调判定失败。Full 文字交叉淡化与装饰循环影响整窗均值，已提请裁定；未裁定前不把 A 写为通过，不为图像指标改写 Windows 已有时长/层延迟。
- Full 水面 idle/connected 原图分别有 67811/89298 个变化像素，天空变化按 owner 回复允许。arm64、低电量关，5s 自身 user+system/wall：可见 idle0.418%、connected0.395%；隐藏0.347%，时钟速度断言0通过但不能声称进程 CPU 真为0。该数值仍只是合成 UI host，没有网络/helper 负载。
- 夹具需修：NSHostingView 自动尺寸 + AppKit 小屏约束使920×600变920×604、1280×720变1024×677；1280状态继承了上轮Settings选择，页面截图还处在过渡。修为固定请求原生窗口面、不裁切或放大PNG、每个稳态页面初次挂载，尺寸直接断言；此前图保留为失败证据。
- 窄呈现续修：星点层级的CSS opacity覆盖不是乘积；低电量暂停Auto采样，已测Static不被电量事件提升。加实际层级与质量回归，等待新head托管执行。

- 第六轮454a26ff / [37532863763](https://github.com/raydocs/tono/actions/runs/37532863763)：634 XCTest，1skipped、17failures；星点层级/低电量窄回归通过，但16次920×600整窗仍被首次toolbar布局改为604pt，stored-off的1个alpha254接缝也未被单加底色消除。保留失败，下一轮在真实toolbar第一次布局之后再设置外窗请求框（不改断言、不裁图）；首页胶囊改为CSS border-radius对应的圆弧 `.circular`，替换SwiftUI默认`.continuous`的延伸接缝，填充/描边/材质/点击区域一致。原透明像素断言仍原样，等待托管证据。

### 2026-10-07 · 规格更正与截图收尾
- 采用规格§4 2026-10-07更正：不改变Windows动效，set实时16帧跨6000ms，非增容差1/255、允许设计保持段、最大单帧下降≤首尾下降25%、末帧与完整night原生参考图对照；rise/arrival原严格指标不放宽。新增分析器5条窄回归本地实际通过；原生重跑待新head。
- WindowServer/SCShareableContent在首次toolbar布局后会短暂报同一窗口onScreen=false/零框。新增5s有界元数据就绪等待，只核对当前NSWindow的windowID+ownPID、WindowServer真实框和请求尺寸；第一张图仍唯一来源，未用重拍替换。先确保真实窗口几何/发布就绪再开始CPU或过渡；不将604pt图裁成600pt。
- circular源码已消除原暖色接缝，但8b5原图只剩深色线路胶囊1个alpha254像素（336,194），ImageIO与重复图一致。stored-off夹具与其它生产海景原生夹具使用同一个既有isolatedSubpixelEdges契约：最多5/255不透明度差、八邻居全不透明、必须同填充邻居；空白、成片透明、边界、断色仍拒绝。不改阈值、不按名称/坐标豁免、不改PNG；不能声称这个原像素被删除。原数学全alpha255判定失败仍保留。
- 为set增加7s完整night原图；为水面和三段过渡保留原生preflight图，测量CPU期间不捕获；所有图都将列入逐图清单，不把接近目标采样时刻写成精确硬件帧时间。无B/C/D、Windows改动、签名/安装/客户源/G1G2变更。
- f366b933 / [37581483081](https://github.com/raydocs/tono/actions/runs/37581483081)：Release/policy/privileged通过，635 XCTest/1 skipped/2 failures（两条新整窗夹具），stored-off与透明边缘拒绝回归均通过；没有新过渡PNG可供验收。重新核对当前SDK `SCShareableContent.h:149–153`：current-process API明确返回redacted信息，不能把其frame零/onscreen=false一律当真实未发布。改为单窗口WindowServer查询强制exactID+ownPID+onScreen+请求尺寸，SC仍须exactID+ownPID；只有SC零框/false的完整redacted组合可由独立证明替代，矛盾的非零框、错误身份、缺WindowServer证明仍拒绝。保留SC字段于原始收据，并将失败元数据先写日志/附件，避免XCTest错误序列化掩盖真正原因。新head原生执行仍待验证，未把此次失败写为通过。
- 9b8d21ae / [37582734311](https://github.com/raydocs/tono/actions/runs/37582734311)：635 XCTest/1 skipped/2 failures；新日志证实真实AppKit、WindowServer、SC均为920×604且SC在屏，故redaction不是本次阻塞原因。只读arbiter（gpt-6-sol/xhigh，实际CLI0.160.1）限域裁定为provisional：先用安装toolbar后的AppKit实例`contentRect(forFrameRect:)`计算内容尺寸再`setContentSize`，保留外窗600断言；不能仅凭现有日志确定4pt来源。root实现该候选并记录挂载/布局/调整前后frame、content/layout/min尺寸、host fitting/safe area、toolbar；不硬编码4pt、不调整产品最小尺寸或原图。只读结果/原日志保存在本地证据目录，不是当前head通过或合并评审。
