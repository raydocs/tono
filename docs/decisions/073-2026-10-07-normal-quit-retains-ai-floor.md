## 2026-10-07 · macOS 普通 Quit 保留选择性 AI 恢复层
- Status: provisional
- Chosen: 按 AGENTS「选更严、不泄漏」处理 MAC-QUIT-AI-HOLD：普通 Quit 在 Core 停止且 DNS 恢复证明后先释放广域 PF/普通网络，再沿用 decision 036 的选择性 AI 恢复层。helper 在同一保护锁中读取广域保护或既有 retain-ai 意图，空闲 Quit、已完成显式恢复和待移除记录不新装恢复层。显式 Disconnect / Restore internet 完全移除，覆盖与 Quit 重叠的释放；新 Connect 才退休该显式选择。下一次启动展示窄恢复层意图及移除入口，但绝不称它为完整 Protected Offline。
- Rejected: 普通 Quit 无条件全部释放；每次空闲 Quit 都新装 AI 层；Quit 单开与现有 disconnect queue 竞争的释放所有者；为保 AI 层继续保持普通网络全阻断；新增 CDN/云平台广域阻断。
- Why stricter: owner 2026-10-07「都修复完了发新版」由 Claude ribboneel 转述，未将该转述当作 owner 对此具体策略的直接验收。本 provisional 选择保留已武装会话的窄层，同时保留普通网络可用优先及用户显式完整恢复例外；owner 可否决。
- Applied in: [MAC-QUIT-AI-HOLD #1445](https://github.com/raydocs/tono/pull/1445)（叠 BRICK-M1 #1444，helper 4.52.43）；Plan: SHIP_PLAN §2 item 10。仅 macOS；不改变 Windows、严格保护、更新执行器所有权或发布门。
- Limits: 选择性安装为既有 best effort，不保证所有 AI 流量被截断；失败、退出超时、睡眠拒绝和更新事务不伪报释放完成。真实 PF/DNS、签名安装候选仍需 G1/G2 owner 验收。
