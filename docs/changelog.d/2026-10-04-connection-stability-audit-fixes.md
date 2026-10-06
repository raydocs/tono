## 2026-10-04 · 连接审查四项窄修
- 归属：SHIP_PLAN §2 item 10 冻结期修复；G1/G2 macOS 连接稳定性，Windows 安装/升级租约准入（G3 仍按既有决定属于 0.0.75，不推进发布门）。
- 来源：基线 `a97c963e10450fff36f37cf9cdb1fc70954ee49a`；分支 `raydocs/fix-connection-stability-20261004`；尚未合 main。
- 缺陷修复：已拒绝的 Core 启动先报告原始错误而非先等控制器；换节点/reload 完成后丢弃上一线路的健康结果；Helper 从停旧前已验证的 root 快照启动；手动安装器身份不明时不覆盖旧租约。四项对应同名 findings 分片。
- 新增/优化：无新用户功能；不放宽 PF/WFP、不缩短成功冷启动窗口、不启用自动 HY2、不回退旧策略。start/controller 仍并行；TUN/DNS 现在在两者确认后并行，未测成功路径时延。
- 工程与测试：每个行为一条窄回归（两项 XCTest、Helper 原生 Core 生命周期自测、Windows native-update 单测）；Helper 协议 4.52.40 → 4.52.41，合同 hash 同步，确保已安装客户端不会沿用旧 daemon。
- 验证：MacBook 上 `git diff --check` 无输出；`sh tooling/scripts/test-core-helper-contract-guard.sh` 输出 `PASS build-core-helper contract guard`（镜像树假 xcrun，仅 hash/版本门，不是 Swift/Core 编译）。新原生回归未在 MacBook 运行；hosted CI 和 scoped 高风险审查待补，不能称为通过。
- 候选/发布：仅源码，无新候选、安装包、部署或客户更新源变更；不编辑 SHIP_PLAN owner 验收勾选。
- 剩余限制：四个故障触发尚未安装机复现；不关闭既有 #1300/#1290/#1291/#1284/#1307/#1247 等独立缺口。高风险审查或 exact-head CI 未完成前不合并。

### 同轮审查续修
- `7a81dcdd` 的双供应商审查（run `12625351`，main policy decision `54173f9b`）无 major-or-worse，确认一项 minor：已复用 PID 的新进程路径读不到时，完整 identity 读取会拒绝本可恢复的安装器租约。改为既有 `process_started_at` 无路径原语，仍拒绝真实的不确定创建时间；扩充同一窄回归，覆盖已更换创建时间可持久替换租约；当时尚未运行。其他既有释放门未扩大改动。
- 首轮 `7a81dcdd` 的 hosted macOS privileged-tests 已成功（ci-gate run `37187454487`；Helper core lifecycle self-test step success）；不能沿用为后续提交的 exact-head ci-gate。新增续修的原生 CI 与增量审查仍待补。

### 原生 CI 编译纠正（工程项，不计新产品缺陷）
- `ec36d2a5` 的 Windows service lifecycle 步骤实跑发现 E0382：新增测试断言构造 `Some(replacement)` 提前移动了 fixture，后续场景无法借用。改为比较引用，不改变生产准入或测试预期；失败日志保留在本轮本地 receipts。
- macOS 同一 head 的 app 构建、TonoTests、policy-tests、privileged-tests 成功；Windows Service 红灯意味着该 head 的 ci-gate 不通过，不能沿用为整体通过。后续提交须重新跑 exact-head CI 与该测试修正的 scoped 审查。
