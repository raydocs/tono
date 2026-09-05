# Tono UI 设计规范

macOS 与 Windows 客户端共用的视觉与交互约定。改任何 UI 之前先读这份文档；
两端必须保持一致，单端改动需要说明理由。

## Clarity 桌面版更新（2026-09）

欢迎/邮箱流程、内容材质、导航与启动策略以
[Clarity 设计与验证记录](desktop-clarity.md) 为准。内容层使用实色，不再把
每张卡片做成模糊玻璃；品牌渐变保留于标志，不作为登录按钮背景。
登录主操作 token 为 macOS `TonoBrand.actionFill` / Windows
`--tono-action-fill` (`#3658C9` + 白字)。状态颜色和延迟阈值的含义不变。

## 1. 设计 Token（唯一事实源）

| 语义 | macOS（`Views/NodeCardView.swift`） | Windows（`tono-ui/theme.ts`） | 值 |
|---|---|---|---|
| 品牌主色 | `TonoBrand.accent` | `TONO_COLORS.accent` | `#4B6EFF` |
| 品牌渐变中段 | `TonoBrand.accentSoft` | `TONO_COLORS.accentSoft` | `#7B5CFF` |
| 品牌渐变暖端 | `TonoBrand.accentWarm` | `TONO_COLORS.accentWarm` | `#FFB07A` |
| 连接状态绿 | `TonoStatus.connected` | `TONO_COLORS.connected` | `#2ED573` |
| 延迟良好 / 成功 | `TonoStatus.positive` | `TONO_COLORS.latencyGood` | `#30D158` |
| 连接中黄 | `TonoStatus.connecting` | — | `#FFD60A` |
| 保护离线 / 降级橙 | `TonoStatus.blocked` | `TONO_COLORS.protectedOffline` | `#FF9F0A` |
| 错误红 | `TonoStatus.error` | `TONO_COLORS.errorDark` | `#FF453A` |
| 待机 / 中性 | `TonoStatus.neutral`（动态）/ `.standby`（实色，供渐变） | — | `.secondary` / `#98989D` |
| 下行流量 | `TonoTraffic.download`（= connected 绿） | — | `#2ED573` |
| 上行流量 | `TonoTraffic.upload` | — | `#64D2FF` |

规则：

- **禁止新增裸 hex 状态色**。带状态语义的颜色一律走 token；纯装饰色
  （Dashboard 统计卡 `32ADE6`/`5856D6`、住宅路由 `BF5AF2` 等）可以保留字面量，
  但不得混入状态语义。
- **绿色双轨是有意设计**：连接绿 `2ED573` ≠ 延迟/成功绿 `30D158`，不要合并。
- **禁止 `Color.accentColor` / `.tint(.accentColor)`**（系统强调色随用户设置漂移），
  一律 `TonoBrand.accent`。

## 2. 延迟阈值（全 app 唯一标准）

`LatencyLevel.level(for:)`（`Models/ProxyNode.swift`）：**<200 良好（绿）/
<400 较慢（橙）/ ≥400 极慢（红）**。Windows 对应 `node-latency.ts` 的
`latencyColor`。任何显示延迟颜色的地方都必须走这套，包括 Activity 连接行、
菜单栏徽章。文案：良好 / 较慢 / 极慢；无数据 = 未测速；失败 = 超时。

## 3. 节点身份

- 标识用 **NodeRouteMark**（macOS）/ **TonoNodeBadge**（Windows）：中性玻璃小方块 +
  品牌渐变描边的"一源两出口"路由图形，两端同一套 24×24 几何。**不用国旗 emoji、
  不用按区域配色的色块**。
- 区域以文字码呈现（globe 图标 + `US`/`JP`…，10pt secondary 无底色），逻辑在
  `nodeRegionCode(flag:name:)`（macOS）与 `nodeCode`（Windows `node-meta.ts`），
  两端映射表必须保持同步。
- 列表按区域码分组，组头小节标题。

## 4. 状态表达（一个状态只说一次）

- 选中卡片 = accent 淡底（dark 0.13 / light 0.08）+ accent 边框 + 顶部 2px 品牌
  渐变细线 + 名字旁 ACTIVE chip。**底部状态行只在非选中、非切换时渲染**。
- Connecting 只显示一处（右上 spinner 区域）。
- disabled = 整卡 0.55 透明度。
- hover = 背景微提亮（`NodeCardSurface` / `.tono-server-card` CSS），0.15s easeOut。

## 5. 玻璃表面惯例（macOS 透明度）

| 用途 | dark | light |
|---|---|---|
| 卡片底 | `.white.opacity(0.07–0.08)` | `.white.opacity(0.42–0.58)` |
| 输入框底 | 0.07 | 0.38 |
| 描边 | 白 0.12–0.16 | 白 0.6–0.72；**登录卡等压在浅背景上时用黑 0.14 / 线宽 1** |

所有 `.white.opacity(...)` 背景必须带 colorScheme 分支。登录网关背景用
`MeshGradientBackground(emphasis: true)`（浅色叠品牌渐变），主界面保持默认。

## 6. 按钮

- **玻璃容器上禁止 `.borderedProminent`**——在 glassEffect / 非激活窗口下会渲染成
  无底白字（实机验证过的坑）。主按钮用自绘实心样式：accent 底 + 白字 +
  disabled 0.45 透明度（参考 `GateProminentButtonStyle`）。
- 按压反馈：scale 0.98、0.1s，尊重 reduceMotion（macOS `ConnectPillPressStyle`，
  Windows `.tono-pill:active`）。

## 7. 动效

所有装饰动画走 `TonoMotion.easeOut(_:reduceMotion:)` + 
`@Environment(\.accessibilityReduceMotion)`；Windows 依赖 `tono.css` 的
`prefers-reduced-motion` 全局块。reduceMotion 下缩放类效果固定为 1，
过渡退化为 opacity。状态切换动画 0.2s，hover 0.15s，作用域限制在单个组件。

## 8. 操作反馈

轻量确认（切换节点、导出日志）走 toast：macOS `ToastCenter.shared.show`
（`Views/TonoToast.swift`，挂在 App 根），Windows `useTonoToast()`
（`tono-ui/TonoToast.tsx`，Provider 在 tono-layout）。顶部玻璃胶囊、单条、
2.5s 自动消失、VoiceOver / `role="status"` 可达。**toast 只在 UI 层触发，
禁止服务层依赖 UI**。

## 9. 中文本地化

目标用户以中文为主，任何用户可见字符串必须可本地化并带 zh-Hans 翻译。

**macOS 流程**（xcstrings 不会被命令行构建自动回写，必须手动同步）：

1. 代码里用 `Text("...")` 字面量或 `String(localized:)`（普通 `String` 变量
   不会本地化——`Text(someString)` 是坑）。
2. 提取：`xcodebuild build SWIFT_EMIT_LOC_STRINGS=YES` + `-exportLocalizations`
   让编译器权威生成 key（插值 → `%@` / `%lld`，手写极易错），回写
   `Localizable.xcstrings` 后补 zh-Hans 翻译（state = translated）。
3. 验证：构建产物 `zh-Hans.lproj/Localizable.strings`（plutil 转 JSON）抽查
   key 与翻译，插值 key 必须逐字符匹配。
4. 实机切中文：启动参数 `-interfaceLanguage 简体中文`，或 App 内设置。

**术语表**（两端统一）：节点（不是服务器）、未测速、超时、不可用、使用中
（ACTIVE）、当前线路、待测速、良好/较慢/极慢、重试、显示详情/收起详情、
网络组件（network helper）、已切换到 %@、日志已导出。

**风格**：称呼用"你"不用"您"；中文语境用全角标点（，。：（）——）；
`LoginErrorCopy.headline` 同时支持 `.` 与 `。` 截断。

**豁免（不翻）**：区域码、协议名（VLESS…）、`%lld ms`、`—`、纯日志/审计串、
被 `contains(...)` 逻辑匹配的字符串（如 `"already running"`——改了会破坏逻辑，
动之前必须 grep 确认无逻辑依赖）。

## 10. 验证命令

```bash
# macOS（勿用 /Applications/Tono.app 验证——那是独立安装副本）
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test \
  -project apps/macos/LiquidClash.xcodeproj -scheme LiquidClash \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/tono-xcode-derived

# Windows（apps/windows/app）
npx tsc --noEmit && npx vitest run
npx eslint --max-warnings=0 <改动文件> && npx biome check <改动文件>
npx vite build
```

改动 Windows locale 文件后如增删 key，运行
`node scripts/generate-i18n-keys.mjs` 重新生成类型。
