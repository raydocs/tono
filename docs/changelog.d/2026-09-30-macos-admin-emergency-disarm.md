## 2026-09-30 · macOS 管理员显式紧急解除（源码待验）
- 归属：BRICK-M1 剩余部分、MAC-7424-F3/F4；macOS 特权 helper。
- 来源：基线 `b9c50b60` → 本 worktree 未提交源码；PR、准确 head SHA 与 hosted CI 待 ROOT 接手。
- 缺陷修复：root 显式 `--emergency-disarm` 不再依赖可读更新 ledger；保留损坏/较新 schema 证据及 high-water；Core 停止、owned TUN 消失、DNS 安全恢复证明先于 Tono PF 解除；恢复构造不重新加载旧 PF。独立 root-owned 租约隔离 daemon/executor 全生存期，并持久拒绝后续自动重武装。
- 新增/优化：紧急出口不伪造 update `disconnectVerified`，不自动恢复联网；标记留待显式管理员修复流程处理。
- 工程与测试：新增损坏/较新 schema 证据、失败清理拒绝释放、跨文件描述符恢复租约的窄 self-test；helper 协议目标 4.53.0。
- 验证：`git diff --check` 静态检查；MacBook 禁止本地 native 构建/测试。hosted exact-head CI、红/绿、实机、签名均未运行。
- 候选/发布：仅源码，无新候选；未合并、部署或发布。
- 剩余限制：不安全的共享 Tono 目录、旧二进制外部手工启动和已有 reset/移除恢复路径未改；隔离与签名 API 需要 hosted 编译及高风险 review。

### Root 接管验证
- root 独立读取实际 lease、mode、Core/DNS/释放、旧 reset 和 install guard 路径后保存 assigned draft。CONTRACT 仅按编译manifest静态算hash，不代表构建证明。
- 独立高风险diff审查及准确头hosted CI由root发起；DNS4.52/#690必须先合，后续集成保留admin4.53。原生实机/坏账本恢复仍未验证，不能关闭首次panic或声称紧急修复已完成。
