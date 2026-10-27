## 2026-10-26 · 0.0.81 发布说明补充连接延迟项与助手版本
- 归属：G2（Windows 客户端）与 G3（macOS 客户端）发布说明；`apps/windows/release-notes/0.0.81.md/.zh.md`、`apps/macos/release-notes/build82.md/.zh.md`。
- 来源：基线 main（#1765 合入后）→ 分支 `release/notes-0081-latency`；只改说明，不改代码。
- 新增/优化：Windows 说明加入 #1766（隧道锁定后失败结论最多提前 8 秒）；macOS 说明加入 #1767（失败结论最多提前 5 秒，自动重连候选并行探测）。macOS 说明中「网络助手仍为 4.52.63」改为「网络助手为 4.52.67」，与 `HelperProtocolVersion.current` 和 `CONTRACT.sha256` 一致（#1765 刷新了记录）。
- 验证：`git diff` 仅四个说明文件各加一条、两处版本替换；无测试。
- 剩余限制：说明里的秒数来自超时常量，不是实测。
