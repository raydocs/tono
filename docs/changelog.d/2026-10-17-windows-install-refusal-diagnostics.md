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
- 验证续报：按所有者“新版正常安装/卸载/再安装”的目标执行
  [候选构建](https://github.com/raydocs/tono/actions/runs/39031345192) 和
  [实际安装 smoke](https://github.com/raydocs/tono/actions/runs/39033567105)，均通过。
  来源 [d7d7f8fda](https://github.com/raydocs/tono/commit/d7d7f8fda7241011d09f15d91083db070213c8eb)；
  Windows Server 2025 管理员静默安装/修复、清理失败保留、部分删除后缺 helper 重试、
  卸载→重装→最终卸载和数据/DNS 保留均已实际执行；32 布局/无记录文件仍拒绝覆盖。
  另核对 service CI 原始日志，网卡三状态与不可写日志原生回归通过。
- 未执行：NSIS 可见对话框/Win11 UAC、客户“32→保留数据卸载→76”真实包重放及活跃
  设备/WFP/DNS/重启场景；hosted 不代替这些验收。模板检查不是 Windows 安装成功证明。
- 候选/发布：已有仅测试 0.0.76 候选，安装包 SHA-256
  `9b83e811dc0510b101f8890a4ac50fe515d3c5780bc7d811b56d018920352e9a`，独立下载核对一致。
  候选未签名、未验收发布；未合并、未修改发布页/更新源，恢复指引记录证据和剩余实机清单。
- 剩余限制：客户说 32 可装、卸载后 76 不可装；三条输出来自重装 32 后，不能证明旧卸载
  残留。原报错网卡 Down，重装后同 GUID Up 也不证明卸载失败。确切新包身份与卸载后
  网卡/SCM/文件/卸载项证据仍缺；不声称已找到客户机器根因或恢复成功。InstallLocation
  带引号已由当前及仓库 0.0.32 写入/读取路径反证为本检测的根因。
- 剩余限制：不能追溯修客户的旧卸载程序，未添加无归属证明的设备/无记录文件自动删除。
  32 fixture 不是客户旧包重放；尚不能声称实际迁移已修复或不再发生。高风险独立审查
  尚未执行，PR 保持 Draft，未合并/发布。
