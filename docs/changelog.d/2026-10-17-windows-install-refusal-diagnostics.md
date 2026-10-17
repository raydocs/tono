## 2026-10-17 · Windows 安装受阻取证、准确诊断与可重试卸载

- 归属：SHIP_PLAN G1 / §2 item 10（旧客户卸载后新安装被阻止），Windows 安装/卸载恢复。
- 来源：基线 [b3c61853](https://github.com/raydocs/tono/commit/b3c6185309bcba13627038ccaaf60de596db829d)；
  分支 `amp/windows-install-refusal-diagnostics`，本 PR；未合 main。
- 缺陷修复：WIN-INSTALL-VERSION-OPAQUE 将四类版本/残留拒绝拆成明确代码与包/记录版本、
  目录/注册表信息；不再断言完整旧安装一定存在。WIN-INSTALL-LOG-PATH-FALLBACK 在 helper
  未返回日志位置时不再虚构默认路径。两个分支都保留既有拒绝、退出码与租约规则。
- 缺陷修复（WIN-UNINSTALL-RETRY-RECORD）：新卸载器逐项检查 App/Core/历史 Core/资源删除，
  失败保留 ARP/uninstall.exe，退出 1603 并交还自己的租约；自带 helper 使部分资源删除后
  仍可重试。helper result 2 不再被当成卸载完成，保留文件/记录待重试；安装侧修复能力不变。
- 兼容路径：保留 WIN-0032-0034-INPLACE-UPGRADE 的卸载优先决策，将旧布局及缺失替换
  目标提前拦在覆盖之前；版本早于 0.0.35 时，即使有后来遗留的 tono-core 也不冒认新版。
  0.0.35 的改名边界由历史提交 [55f31a2b](https://github.com/raydocs/tono/commit/55f31a2bfc830e773efd910ac4f1a15be473d30f) 核对。
- 新增/优化：网卡存在提示不再要求反复重启或必须交日志，明确不按名称删设备；
  [恢复指引](../ops/windows-install-recovery.md) 提供无需日志的三条只读命令、保留数据的
  正常卸载条件与停止规则。未添加设备/注册表清理、未放宽 Down/Up 网卡门禁或降级限制。
- 安全边界：自带 helper 的卸载器先只读验证固定 Program Files\Tono、ACL、全树非重解析
  路径，防止 `_?=` 重定向清理；不依赖卸载项存在，但仍须通过原生网络/更新门禁。
- 工程与测试：扩展既有门禁模板契约、网卡 Up/Down/NotPresent Rust 回归及现有 hosted
  candidate smoke；后者新增 32 布局 fixture、无卸载项拒绝、锁 Service 的 result 2、
  锁历史 Core 后部分删除→移除已安装 helper→卸载重试→重装及数据哨兵；不新增框架/依赖。
- 验证：Linux Orb 红检查（仅新断言、旧安装器）运行
  `node --test --test-name-pattern='NSIS names every gate refusal|existing-install refusals distinguish' apps/windows/app/scripts/windows-packaging.test.mjs`，
  exit 1：默认日志路径与无区分代码分别触发断言失败。中间完整检查 40/41，守住已有孤儿
  恢复分支的顺序断言，调整保护位置后完整检查 42/42；最终源码结果见 PR 验证评论。
- 未执行：Windows 编译/NSIS 对话框渲染、客户“32→保留数据卸载→76”安装重放、WFP/DNS/
  设备真实状态验证；Linux 无 makensis/wine/pwsh。模板检查不是 Windows 安装成功证明。
- 候选/发布：仅源码，无新包；未触发候选构建、未修改发布页或更新源。
  不发布候选与 smoke 的精确命令、哈希核对和剩余实机清单见恢复指引末节。
- 剩余限制：客户说 32 可装、卸载后 76 不可装；三条输出来自重装 32 后，不能证明旧卸载
  残留。原报错网卡 Down，重装后同 GUID Up 也不证明卸载失败。确切新包身份与卸载后
  网卡/SCM/文件/卸载项证据仍缺；不声称已找到客户机器根因或恢复成功。InstallLocation
  带引号已由当前及仓库 0.0.32 写入/读取路径反证为本检测的根因。
- 剩余限制：不能追溯修客户的旧卸载程序，未添加无归属证明的设备/无记录文件自动删除。
  32 fixture 不是客户旧包重放；尚不能声称实际迁移已修复或不再发生。高风险独立审查
  尚未执行，PR 保持 Draft，未合并/发布。
