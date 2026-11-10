# Tono 界面改版决策（四端：macOS / Windows / iOS / Android）

> 写作依据：四端代码审计（只采纳 confirmed 和 plausible 的结论）、findings ledger、三份调研、三个候选方向和三位评审的意见。本文没有构建、截图或真机测量。所有性能数字都是目标值，不是测量结果。

---

## 1. 结论

**路径对一半。日出日落作为开关的隐喻要保留。错的是"写实海景 + 常驻环境动画 + 每端各写一套渲染"这种做法，这部分要整套重做。**

新做法：只用一个数值 `e`（太阳高度，取值 -1 到 1）驱动画面，它沿临界阻尼弹簧运动。太阳本身就是开关，做成一枚会折射的玻璃透镜，放在一条清晰的地平线上。点击后光线升起；状态到位后整个画面静止。删掉星空、云、流星、颗粒、月亮呼吸和常驻水面，倒影只保留成太阳的一个简化镜像。

理由：
- owner 认可"日出 = 连上"这个隐喻。10-03 那轮已经否掉了去掉太阳和地平线的抽象方案。
- 参考视频（60fps/Wabi）好看的原因是：玻璃面积小，背后有高反差的边缘，动作短，画面克制。把一枚玻璃太阳压在地平线上，正好是这种构图。
- 现在的写实海景只能拿真实海水来比，必输。

### 为什么调了几周还是出不来：根因在结构，不在参数

1. **天和水是两套渲染器，互相追赶。**
   - Mac：天空由约 60 个 CALayer 拼成，水面是另一个 Metal shader。shader 每帧在主线程用 KVC 读取天空的 presentation 值来重建天空颜色（`SeaSceneLayerView.swift:427-441`，`SeaSceneWater.swift:70-75`）。所以倒影比太阳慢 1 到 3 帧，颜色也对不上。
   - Windows：WebGL 每帧调用 `getBoundingClientRect` 和 `getComputedStyle` 去读 CSS 太阳的位置（`SeaWater.tsx:277-310`）。水面颜色按 1.1 s 指数逼近（`:266`），天空按 2.6 到 6 s 过渡，两者在时间上对不齐。
2. **太阳跟着网络阶段走台阶，而且每次换目标都把速度清零。**
   - 太阳高度直接由 stage 序号决定：`SeaSceneParameters.swift:30,47-50`、`sea-home.tsx:156-157`、iOS `SkyState.sunRise`、Android `SeaScene.kt:43-51`。
   - 每次换目标都从零速度重新开始：`SeaSceneLayerView.swift:853-880` 每次新建一个 `CABasicAnimation`；Android 用的 `TweenSpec` 不继承速度。
   - 结果是太阳走一段、停一下、再走一段。看起来是机械动作，不是"慢慢亮起来的光"。
3. **颜色靠预先烘好的几张渐变互相淡入淡出，不是一条连续的色温曲线。**
   - 例子：`sea-scene.css:869-876` 里夜色延迟 3.8 s；iOS `Theme.swift:64-68` 在 gamma sRGB 空间里做插值。
   - 所以过渡到一半时中间色发灰、发紫。
4. **环境循环的节奏像加载动画。** 黎明光晕每 2.4 s 闪一次（`SeaSceneLayerView.swift:549-551`）。水面是匀速平移的贴图，Mac/Windows 像传送带（`:578-579`），iOS 46 条横线像条形码（`SeaScene.swift:129-143`）。
5. **文字、按钮和光不在一个时钟上。** 标题 90/130 ms 就切换完（`DashboardView.swift:1283,1298`），天空要 2.6 s。iOS 胶囊的填充进度（0.36/0.78）和太阳高度（0.5/0.7）是两套数。Android 干脆没有日落：`SeaScene.kt:82` 进入 NIGHT 时直接硬切。
6. **Mac 的水"不活"可能是被自动降档了。** Auto 档的探测在启动最卡的那几秒采样（`SeaSceneParameters.swift:96`），一旦降到 Lite 就不会再升回来，Metal 水面也就不再出现（MAC-MISS-01）。
7. **同一个场景在四端各写了一遍，各自调参，各自出偏差。** 只要保留"常驻的、像活物一样的环境动画"，调参就没有终点。

---

## 2. 推荐方向：Glass Sun（玻璃太阳）

### 概念
画面分四层：
- 底：静态渐变天空，下方是一条约 1 pt 的清晰地平线，再往下是静止的镜面海。
- 太阳透镜就是开关。它把背后的地平线和光核折射弯曲。
- 透镜上方是一个状态词和一行范围说明。
- 透镜下方是一个线路胶囊和一个模式胶囊。

全部视觉只由一个数 `e` 推导：天空色、光晕宽度、倒影长度、透镜色调。

### 四端界面

| 界面 | macOS | Windows | iOS | Android |
|---|---|---|---|---|
| 主页 | 132 pt 透镜放在 58% 高度的地平线上；线路和模式胶囊放进同一个 `GlassEffectContainer` | 布局相同。背景是 CSS 渐变；只有透镜外框加 24 px 的区域有一个 WebGL2 canvas | 104 pt 透镜，放在拇指可达区 | 104 dp 透镜；全应用只有一个场景，提到 `TonoRoot` 的 `when` 之上 |
| 内页 | 不放场景。平铺 `smoke` 底色和原生玻璃面板 | 不放场景。平铺底色和半透明面板，不使用 `backdrop-filter` | 弹出 sheet 时下面的场景冻结 | 同 iOS |
| 托盘 / 菜单栏 | MenuBarExtra：280×180 的静态地平线条加一个小透镜；状态栏图标沿用"地平线上的太阳"，有 4 种状态 | 浮窗改成独立的小 Vite 入口，用预烘的透镜 PNG，不用 WebGL；Win11 加 Mica；隐藏 30 s 后销毁 | 小组件、Live Activity、控制中心用静态 `HorizonGlyph`，用光的宽度表示保护范围 | QS 磁贴和通知用同款字形 |

### 统一 token（`design/tokens/glass-sun.json`，一处定义，生成 CSS / Swift / Kotlin）
- **天空色阶**，由 `e` 取样，在 **OKLab** 空间插值：夜 `#070A1C`/`#1C2350`（决定 069 定下的靛蓝）→ 金色地平线 `#F0A86E` → 白天暖色 `#E0784E`，光核 `#FFE2B4`。中间不出现紫色。
- **固定色**：`ink #F5F2EC`（次级 64%、三级 44%），`ember #C2563A`，`amber #E8A23A`，`haze`（断网时的降饱和），`steel`（退出后仍拦截的状态）。
- **字体**：字号 44/22/15/12。苹果用 SF Pro + PingFang SC；Windows 用 Segoe UI Variable + Microsoft YaHei UI；Android 用 Roboto Flex + Noto Sans SC。
- **圆角**：8 / 14 / 22 / 胶囊。
- **层级**：
  - L0：场景，不透明。
  - L1：透镜，全屏唯一一个强折射物体。
  - L2：控件玻璃，用系统强度。
  - L3：面板，平铺填充。
  - 规则：玻璃下面不能有运动的像素；玻璃不叠玻璃。

### 动效规范：两个时钟，光不反弹
参数写法是 SwiftUI `spring(response, dampingFraction)`。换成 Compose 时，stiffness ≈ (2π/response)²，damping 取 1。Windows 用一个约 20 行的 JS 弹簧积分器，同一套参数同时驱动 CSS 变量和 shader uniform。

| 事件 | 控件时钟 | 光时钟（`e` 和天空 `s`） |
|---|---|---|
| 按下 | 内容缩到 0.97，弹簧 0.25/1.0（stiffness ≈ 632）；苹果端用 `.interactive()`。缩放不能作用在被采样的背景上（AND-UI-12） | 不动 |
| 点击连接 | 文字淡入淡出 0.18 s | 从点击那一刻开始：`e` 从 -0.35 到 0.10，1.6/1.0（≈15.4）；`s` 追随 `e`，2.2/1.0。stage 只改文字和小点，不改太阳。**4 s 内到达保持值，之后不再出帧** |
| 连接成功 | 状态词：先淡出 0.12 s，延迟 0.25 s 后用 0.24 s 淡入，和光一起落定 | `e` 到模式目标值，1.6/1.0，保留当前速度；同一帧算出倒影和颗粒遮罩（修 MAC-UI-13） |
| 连接成功后 | — | 透镜下方的倒影波光以 30 fps 运行 8 s，振幅衰减到 0 后完全静止 |
| 断开（日落） | 文字**立即**变化 | `e` 到 -0.45，0.8/1.0（≈61.7），**0.4 s 内暖色落到地平线以下**；天空余晖 2.4/1.0 |
| 失败 | 0.2 s 内变成 ember 色；透镜左右轻推 3 px，持续 380 ms | `e` 到 -0.2，0.6/1.0；失败配色从第一帧就和连接中不同（修 AND-UI-M3） |
| 快速来回切换 | 同一个弹簧，保留速度 | 释放保护后显示 `min(animated, lastShown)`，太阳不会倒着升起 |
| 切页 | 内容 0.18 s 淡入淡出 | 场景不动，不做模糊 |
| 减弱动效 | 直接到终点 | 0.2 s 淡入淡出，不出 shader 帧 |

**折射只用在透镜上：**
- 边缘位移 `0.18R · smoothstep(0.82R, R, r)`，沿边缘法线方向；中心放大 1.06×。
- 色散 0.5% R，只在边缘出现。
- Fresnel 边光 18%，左上方一个高光。
- 透镜内部不模糊。弯曲的地平线就是全部效果。

**静止时**：除了连接后那 8 s 衰减的波光，任何状态停稳后都是 0 帧。没有呼吸、闪烁、云、颗粒噪点（颗粒烘成静态 dither）。长时间连接中，最多每 5.6 s 做一次 ±6% 的边光呼吸，30 s 后停止。

### 状态表达（文字说了算，光跟着文字走）

| 状态 | `e` 和天空 | 文字 |
|---|---|---|
| 未连接 | -0.35，靛蓝夜色 | 未连接 |
| 连接中 | 0.10，天空变暖 | 正在连接 · 阶段名 |
| Stable | 0.55，整条地平线发光 | 已保护 |
| 三层分流 | 0.45，光覆盖中间 60% | 分流保护 · 其余直连 |
| AI Home | 0.25，只有透镜后面一道窄光 | AI 已保护 |
| 已保护但断网 | 保持不变，天空降饱和 40% | 已保护 · 网络离线 |
| 降级 / 恢复中 | 保持不变，地平线变 ember 色 | 正在恢复（修 MAC-UI-08） |
| 退出后仍拦截 | 0，`steel` 色边，透镜上显示锁 | 已拦截 · 网络被保护锁定，下方次级文字按钮"恢复网络"，点后需确认 |
| 失败 | -0.2，ember | 连接失败 + 重试 |

规则：
- 每次状态变化都发 VoiceOver / Narrator / TalkBack 播报（修 MAC-UI-11）。
- 开启"减少透明度"时，透镜变成不透明的暖色圆盘。
- 文字只能读取现有的状态选择器：`MenuBarProtectionStatus`、`seaPresentation`、`SkyState`、`skyFor`。

---

## 3. 每端技术实现与降级

| 层 | macOS 26.3 | iOS 26 | iOS 16–25（app 部署目标为 16.0；17.0 只是小组件扩展的目标，已核对 `project.yml:9,80`） | Windows 11 / 10 | Android 33+ / 31–32 / 29–30 |
|---|---|---|---|---|---|
| 天空 | SwiftUI `LinearGradient` + `Animatable` 驱动的 `e` | 同 macOS | 同 macOS | CSS 变量渐变 | `drawWithCache` 缓存，并加独立 `graphicsLayer` |
| 透镜 | `.glassEffect(.clear.tint(warm).interactive(), in: Circle())`，放在一个容器里，用 `glassEffectID` 让透镜和进度条互相变形 | 同 macOS | `.ultraThinMaterial` + 1 px 边光，不做 `.layerEffect` | 透镜区域内的 WebGL2 SDF 圆，按需渲染；WebGL 失败时退回 CSS 模糊 + PNG 边光 | 自研约 80 行的 AGSL `RuntimeShader`，链在 `Glass.kt` 的 BackdropHost 采样片段后面 / 模糊 + 画布边光 / 只着色 |
| 面板 | 原生 glass | 原生 glass | 材质 | 平铺半透明；Mica 只给浮窗用 | 模糊 / 模糊 / 着色 |

关键点：
- **原生透镜可能太弱**：在平滑渐变上，原生 Liquid Glass 看起来几乎就是模糊。所以要专门把清晰的地平线和光核放到透镜后面。如果第 0 步拍出来折射还是不明显，Mac 再考虑在 Metal 里自写透镜（运行时编译 MSL，管线做成进程级缓存）。
- **Windows 主窗口不改透明**，避免启动白闪和 Win10 兼容问题。
- **Android 不用 Kyant 库**：它的 FAQ 里列了玻璃 bottom sheet 会触发 RenderThread 崩溃。
- **兜底原则**：做不好的仿制透镜，比干净的磨砂玻璃更难看。哪一端仿制透镜效果差，就退回磨砂。

---

## 4. 性能能效目标（可测量）与删除清单

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 主页聚焦静止 | Mac / iOS / Android 10 s 内 0 帧（排除 `.interactive()` 鼠标悬停反馈）；Windows `msedgewebview2` 3D 占用 < 1% | Instruments Core Animation；`dumpsys gfxinfo`；`typeperf "\GPU Engine(*engtype_3D)\Utilization Percentage"` |
| 后台、最小化、托盘 | GPU 约 0%；后台不跑任何 JS 定时器；Android 进入 ON_STOP 后 0 次唤醒 | 同上，加定时器日志 |
| 过渡 | 每次 ≤ 4 s；每帧 GPU 时间 UHD 620 上 ≤ 4 ms，A15 上 ≤ 2 ms | GPU trace |
| Windows 合并门槛 | 在 Intel 核显上用 typeperf 测 4 种状态（聚焦静止、过渡中、隐藏、托盘）都达标后才能合并 | typeperf |
| iOS 小组件刷新 | 每 10 min 不超过 1 次 | 真机多小时运行 |
| 体积 | Android 按 ABI 拆包 + R8（AND-UI-16）；iOS app target 不再链接 Libbox（IOS-UI-10）；Windows 删掉 12 个没用到的依赖（WIN-UI-14）。Mac 包里 40 MB 是 sing-box 内核，不在本次范围 | CI 产物 |

**要删的代码**：
- **Mac**：`SeaScene.swift`、`SeaSceneLayerView.swift`（1,035 行）、`SeaSceneWater.swift`（424 行）、`SeaSceneParameters.swift` 里的质量探测和四档画质、`SeaHomePillStyle.swift`、`MeshGradientBackground.swift`、`ConnectPill.swift`、`DashboardView` 的 classic 分支、sea 贴图。
- **Windows**：`SeaScene.tsx`、`SeaWater.tsx`、`sea-scene.css`（1,019 行）、`SeaBackdrop.tsx`、`use-shared-sea-backdrop.ts`、`scene-quality-probe.ts`、`useSceneQuality.ts`、`sea-assets/`（340 KB）、`MeshBackground.tsx`、`sea-shell.css` 的暗化规则。
- **iOS**：`SeaScene.swift` 里 30 Hz 的 Canvas，`HomeView` 里的 `ReacquireSweep` 和 `ReflectionColumn`。
- **Android**：`SeaScene.kt` 的 `rememberInfiniteTransition`，`Glass.kt:110` 的固定焦散。
- **四端**：四档画质合并为"动效：开 / 减弱"两档。

---

## 5. 四端已核实问题清单
标注 **[先修]** 的可以不等改版先修。改版会删掉的代码，只做低成本止血。

### 高
| ID | 位置 | 问题 | 修法 |
|---|---|---|---|
| IOS-MISS-1 **[先修，高风险，需独立审查]** | `apps/ios/App/Services/LiveActivityController.swift:13` | app 挂起期间隧道断开后，Live Activity 最长还会显示约 15 min 的"已连接"，属于"保护已释放却显示受保护"（major） | `staleDate` 改为 beat + 5.5 min，或改成 push 更新；onForeground 时同步一次。ledger 里还没有这条 |
| MAC-UI-03 **[先修]** | `apps/macos/Tono/Views/SeaSceneWater.swift:167` | Metal 水面默认 60 fps 一直在跑，所有阶段都跑，最高 1.5×，非 opaque，不看温度 | 改为 30 fps、1×、`isOpaque=true`，温度达到 serious 时降档 |
| WIN-UI-01 **[先修]** | `apps/windows/app/src/tono-ui/SeaBackdrop.tsx:43` | 内页上整个场景加 WebGL 一直在跑，上面还叠一层全窗口 `blur(14px)` | 改为 `paused={!active}`，或换成预先模糊好的静态层；同时改掉过时的注释 |
| WIN-UI-03 | `apps/windows/app/src/tono-ui/SeaWater.tsx:277` | 每帧读 4 次 rect 和 3 次 computedStyle，不限帧率重画重 shader | 先止血：限 30 fps，尺寸为 0 时停下；之后改版时删掉 |
| IOS-UI-1 **[先修]** | `apps/ios/App/Views/SeaScene.swift:17` | 30 Hz TimelineView 只在"减弱动效"时暂停 | 按 scenePhase、sheet 打开、低电量模式、温度暂停 |
| AND-UI-01 **[先修]** | `apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/ui/SeaScene.kt:70` | 无限循环的 transition 让画布每帧重录，所有玻璃每帧重新模糊 | 去掉常驻循环；breath 只在连接中运行 |
| AND-UI-02 | 同文件 `:82` | NIGHT 和 EMBER 直接画目标值，日落是硬切 | 改版时用 `Animatable` 实现真正的日落 |

### 中
| ID | 位置 | 问题和修法 |
|---|---|---|
| MAC-UI-01 **[先修]** | `apps/macos/Tono/ContentView.swift:28` | 内页的场景一直 `active: true` → 改成 `selectedPage == .dashboard` |
| MAC-UI-02 **[先修]** | `apps/macos/Tono/Views/SeaSceneLayerView.swift:276` | 窗口失去焦点时仍满速运行 → 在 resignKey 时降到 Lite 或 20–30 fps |
| MAC-UI-04 | `apps/macos/Tono/Views/DashboardView.swift:750` | material 和 glass 叠在一起，并且盖在会动的背景上 → 每个表面只保留一个效果 |
| MAC-UI-08 **[先修]** | `apps/macos/Tono/Views/SeaStatusWords.swift:7` | 降级时文字说"已连接"，画面却是黄昏 → 给降级状态单独一个文案 key |
| MAC-UI-09 | `apps/macos/Tono/Views/SeaScene.swift:128` | AI Home 的标题和画面与 Stable 一样 → 标题改为"AI 已保护" |
| MAC-UI-11 | `apps/macos/Tono/Views/DashboardView.swift:364` | 没有任何 VoiceOver 播报 → 状态变化时播报 |
| MAC-MISS-01 **[先修]** | `apps/macos/Tono/Views/SeaSceneParameters.swift:96` | 启动时的卡顿把画质锁死在 Lite → 等空闲后再探测，并允许升档 |
| MAC-MISS-02 / 03 | `SeaSceneLayerView.swift:801`、`SeaSceneWater.swift:406` | 看不见的层仍在跑循环；雾的 sky() 每个像素都重算 → 按透明度门控；雾按列预计算 |
| WIN-UI-02 **[先修]** | `apps/windows/app/src/tono-ui/while-visible.ts:11` | 定时器和 SWR 只看 `document.visibilityState` → 用 Tauri `isVisible` 做一个统一信号 |
| WIN-UI-04 / 05 | `sea-home.css:16`、`sea-scene.css:509` | 运动背景上的 backdrop-filter、overlay 混合 → 改版时删掉 |
| WIN-UI-07 **[先修]** | `apps/windows/app/src/tono-ui/SeaScene.tsx:50` | 失去焦点就冻结相位过渡，从托盘连接时主窗口画面不更新 → 一次性过渡照常跑完，只暂停循环 |
| WIN-UI-08 | `scene-quality-probe.ts:62` | 只测 rAF；Lite 档仍跑水面循环 → Lite 档停掉水面；电源切换时重新探测 |
| WIN-UI-09 | `apps/windows/app/src/pages/tono/sea-home.tsx:157` | 开始连接时太阳先下沉，再一级一级往上爬 → 同一次尝试内高度只升不降 |
| WIN-MISS-01 **[先修]** | `SeaWater.tsx:294` | `uTime` 无限增长，托盘挂几天后水面出现色带 → 在 CPU 端用 double 取模 |
| WIN-MISS-02 | `apps/windows/app/src-tauri/src/core/tray/flyout.rs:76` | 托盘浮窗加载整个 SPA，并且常驻 → 改成独立入口，隐藏后销毁 |
| IOS-UI-2 / 3 | `SeaScene.swift:54`、`Theme.swift:199` | Canvas 每帧在主线程重画；玻璃压在运动背景上 → 改版时删掉 |
| IOS-UI-4 / IOS-MISS-4 | `LiveActivityController.swift:33`、`Widgets/StatusWidget.swift:27` | 正常会话约 15 min 后显示"状态未知" → 刷新频率要考虑系统预算 |
| IOS-UI-5 **[先修]** | `apps/ios/PacketTunnel/PacketTunnelProvider.swift:110` | 每天约 288 次小组件刷新 → 改为每两次心跳刷新一次（不能直接砍掉，否则小组件会过期） |
| IOS-UI-6 / AND-UI-08 **[先修]** | `HomeView.swift:772`、`HomeScreen.kt:146` | 三层分流也显示"已保护" → 显示"分流保护 · 其余直连" |
| IOS-UI-7 / AND-UI-03 | `ConnectionState.swift:39`、`HomeScreen.kt:92` | 断开过程中显示连接时的呼吸效果 → 断开单独一个状态 |
| IOS-UI-10 | `apps/ios/project.yml:43` | app 和扩展各带一份 Libbox → app 改用 provider message 获取数据 |
| IOS-MISS-2 / 3、AND-UI-04 / M2 | `SeaScene.swift:21,25`、`SeaScene.kt:60`、`HomeScreen.kt:304` | 呼吸效果跳变、高潮段最快、胶囊和太阳各自计时 → 改版时用统一的 `e` |
| AND-UI-06 / M4 **[先修]** | `HomeScreen.kt:153`、`Tokens.kt:122` | 打开 sheet 时场景照跑；不看省电模式和温度 → 冻结场景，加省电和温度门控 |
| AND-UI-16 / M1 | `build.gradle.kts:42`、`Glass.kt:59` | 单个 APK 带双 ABI、没开 R8；画布没有独立图层 → 拆包；加 `graphicsLayer()` |

### 低（合并列出）
- MAC-UI-05、06、07、10、12、13、14、15、16，MAC-MISS-04、05、06
- WIN-UI-06、10、11、12、13、14，WIN-MISS-03
- IOS-UI-8、9、11（ledger 已有）、12、13、14、15、16，IOS-MISS-5
- AND-UI-05、07、09、10、11、12、13、14、15，AND-UI-M3、M5

其中 **WIN-UI-10**（GL 上下文没有释放）和 **AND-UI-09**（ON_STOP 后仍有 1 Hz 唤醒）建议先修。其余低级别问题改版时会自然消失。

---

## 6. 分阶段计划

**第 0 步：让 owner 拍板的最小原型。**
- 做什么：一个可交互的 HTML/WebGL2 页面，只做主页。点击按钮触发日出、日落、失败三个过渡，可以切换 Stable / 三层 / AI Home 三种范围。页面内提供 A/B 开关：
  - 写实太阳透镜，或抽象光带；
  - 连接后 8 s 波光衰减，或常驻 30 fps 波光。
- 交付：页面和 60 fps 录屏。
- 同时在 Devin macOS VM 上做一段 10 s 的 `glassEffect` 实拍，压在同一张渐变和地平线上，用来判断原生折射够不够强。
- owner 看过之后才开始删代码。这份原型以后也直接作为 Windows 的实现。

**第 1 步：独立止血。** 每项一个 PR，每个 PR 带一个窄回归测试和一条 changelog。
- iOS：IOS-MISS-1（需独立审查）、IOS-UI-1、IOS-UI-5、IOS-UI-6。
- Mac：MAC-UI-01、02、03、08、MAC-MISS-01。
- Windows：WIN-UI-01、02、07、WIN-MISS-01、WIN-UI-10。
- Android：AND-UI-01、06、M4、09、AND-UI-08。
- 冻结期规则：G4 冻结期间只有 SHIP_PLAN §2 第 10 项能合并。上面这些默认排在 0.0.76。

**第 2 步：共享基础。** 包括 `glass-sun.json` 和生成器、每端一个弹簧积分器测试、每端一个"保护已释放 ⇒ 画面不暖"的回归测试，以及一份 `docs/decisions/` 的 provisional 记录。

**第 3 步：Mac。** 按以下顺序拆 PR：
1. 先拆分 1,349 行的 `DashboardView`。
2. 加 `GlassSunView`，放在 flag 后面。
3. 加透镜容器。
4. MenuBarExtra 和状态词。
5. 删除 Sea* 文件和 classic 外观。

**第 4 步：iOS。** 静态天空加透镜（iOS 26 原生，16–25 用材质）→ 小组件字形 → 移出 Libbox → 删除 `SeaScene`。证据用 Devin 跑。

**第 5 步：Android。** `Animatable` 驱动的 `e` 加真正的日落 → AGSL 透镜（API 33+，在 29/33/36 三个版本的模拟器上截图）→ 只保留一个场景 → 拆包和 R8。

**第 6 步：Windows。** 托盘浮窗独立入口加 Mica → CSS 天空加 WebGL2 透镜 → 删除 sea 栈。合并前必须拿到 typeperf 的 4 种状态数据。移除 MUI 单独立项，不跟这次视觉改版一起做。

---

## 7. 风险与需要 owner 决定的问题

**风险**
1. **静止的画面可能显得"死"。** 10-06 owner 要求过"活的水"。应对：第 0 步把两种波光方案放在一起录屏比较。
2. **四端透镜效果对不齐。** 苹果的折射参数调不了，iOS 16–25 上没有折射效果。应对：共享一套参数，用 CI 做并排截图；哪端效果差就退回磨砂。
3. **状态真实性。** 改动"受保护"的表达方式会碰到 major 级别的不变量。应对：只读现有的状态选择器，每端都加回归测试。
4. **证据。** 所有性能数字都要真机或 Devin 测出来，本机无法测。

**请 owner 决定（每题后面是推荐答案）**
1. 保留写实的太阳和地平线，删掉星空、云、流星、颗粒，海面只留静止镜面加倒影？**推荐：是。**
2. 平时静止，只在连接后有 8 s 波光，替代"一直在动的水"？**推荐：是，最后以第 0 步录屏为准。**
3. 撤掉决定 078 里的全屏 Metal/WebGL 实时水面？**推荐：是。**
4. 四档画质合并为"开 / 减弱"两档（会重开决定 069）？**推荐：是。**
5. iOS 16–25 不做折射，只用材质加边光？**推荐：接受，不为它引入 `.metal` 文件。**
6. Windows 主窗口继续不透明，Mica 只给 Win11 托盘浮窗？**推荐：是。**
7. 三层分流模式的主页文案用"分流保护 · 其余直连"？**推荐：是。**
8. IOS-MISS-1 是否申请作为冻结期例外修复？**推荐：申请。它属于"已释放却显示受保护"。**
9. 第 0 步原型先做 HTML（同时作为 Windows 的实现），再配一段 Mac 原生实拍？**推荐：是。**

**本次没有运行的检查**：任何构建、截图、GPU 或能耗测量，以及真机验证。