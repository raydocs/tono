## 2026-10-23 · Windows 迟到连接失败保留后继认证隧道端口
- 归属：SHIP_PLAN §2 item 10 的 Windows 连接可靠性缺陷候选；本次仅交付源码，不推进客户发布门。
- 来源：`4fbf1e6a4b387c80498e14975595791591839ee6` → 分支 `t3/windows-stale-failure-auth-port`；
  Windows 基于冻结 main `0465af8140d0fc91148fd3f356b8a9e819d71f76`，已由父任务集成到 `fix/windows-auth-port-ownership-20261023`；未合 main。
- 缺陷修复：adapter 读取迟到的 A 不再清 B 已发布的 auth tunnel fallback port；清零移入
  `record_connect_failure` 持 state mutex 且验证 generation 后的同一提交，关联 `WIN-STALE-FAILURE-AUTH-PORT`。
- 新增/优化：无新能力；保留当前失败清零、Disconnect/Restore、代次语义、Service/WFP/DNS 和 TLS 行为。
- 工程与测试：先提交保留旧行为的共享 failure-entry seam 与一个 oneshot 交错回归
  `662a792486e6ef7b482b2baf64586811b6769dbc`，再做修复。回归实际走 attribution await、
  stale reconciliation、真实 transport fallback；同一测试包含当前代次清零对照。无计时 sleep 控制交错。
- 验证：本 Mac 仅 `git diff --check` 与接口/锁区间源码核对；未编译、未运行任何 native cargo、
  test/check/clippy/Tauri 或 hosted Windows CI。RED/GREEN 均未证实，不能将源码 RED 提交当运行失败证据。
- 候选/发布：源码已推送，交付 draft PR；无新候选，未合并、部署或发布。
- 剩余限制：父任务须在 hosted Windows 对上述 RED 源码及修复提交运行新回归与现有 ownership 同伴检查，
  并补独立高风险 diff 审查；实机恢复/认证与包级验证未执行。未处理 WMI/Prepare/installer/healer backlog。

- 父任务静态复核：集成后的 Windows 源码与 worker fix 无差异（`git diff --exit-code` 为 0）；
  RED hosted run [39920445903](https://github.com/raydocs/tono/actions/runs/39920445903) 已启动，结果待定。
