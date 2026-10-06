## 2026-10-06 · macOS 0.0.75 是否只提供新外观？

- Status: provisional
- Chosen: 是。协作会话 ribboneel 转述 owner 当日原话「和合并的全都合并到 main 只用新外观就好了」；本会话将其解释为 Mac 与 Windows 同步只呈现海景。移除 Mac 设置里的外观开关，所有实际读点改用同一只读展示策略；已存的 `seaAppearanceEnabled=false` 不再读取，也不删除或重写。海景动效与系统降低动态效果/透明度/增强对比仍保留。Rejected: 无开关但继续读取旧 off，使某些用户无法进入新外观；或在本版顺手删除旧界面。
- Supersedes: [064](064-2026-10-06-parallel-native-mac-sea-preview.md) 的默认关/显式关回旧外观，以及 #1405 前一 head 的默认开但保留 opt-out。跨会话 [Windows 066 / #1417](https://github.com/raydocs/tono/pull/1417) 是同一意图的独立实现，不编辑或复制其文件。
- Why stricter: 仅收敛展示方式，连接、路由、账户和特权语义不变；旧界面只供只读渲染夹具 override 使用，遗留代码留到专门清理。恢复网络和既有快捷键不能依赖旧界面，故同轮补回新首页入口，仍经既有 `seaToggleConnection`/`restoreInternet`，保留取消宽限与断开中禁用，不产生后台释放。
- Not verified: 转述不是 owner 真机或候选验收；本机不运行原生编译/测试。新的最终 head 必须有 CI/原图证据与增量独立评审，旧 head 的绿色/评审不覆盖新增量。
- Release gates: 不推进客户源，不改 owner G1/G2，不安装或签名；旧 e28ca45c 候选不承载新 UI。新冻结、签名候选及精确哈希对应的 owner G1/G2 仍需完成，G3 仍顺延 0.0.76。0.0.75 新外观进版采用转述的新产品意图，不把既有发布冻结排除条款当作这批 UI 已验收。
- Applied in: [#1405](https://github.com/raydocs/tono/pull/1405)，`SeaAppearancePreference`、`SeaPageAppearance`、`DashboardView`、`MeshGradientBackground`、`SettingsView`。
