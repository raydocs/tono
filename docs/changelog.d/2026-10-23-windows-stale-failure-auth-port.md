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

### 2026-10-23 · hosted fixture 失败与纯测试续修
- 初次 RED run `39920445903` / fixed run `39920571463` 均已编译，随后在同一真实 send 的
  10 秒 timeout unwrap 得到 `Elapsed(())`（771 passed / 1 failed）；不是预期的端口保留断言失败，
  不能作为行为 RED，也没有 GREEN。上面的「未编译/待定」是初始交付状态，不是当前结论。
- 测试修正提交 `a376644ade1f1a067284fa745b94d4de15ad13d7` 只改 `outcome.rs` 的测试区：
  用实际监听并读完 GET 后主动关闭的 loopback 端点替代非监听 socket；保留真实 HttpTransport fallback、
  B 的实际 mixed port、请求头/响应断言与当前代次清零对照。不改生产代码，不调大超时，无新测试或 sleep。
- R1 的 minor oracle 修正：旧 attempt await 后检查独立 atomic Service/cleanup 进入标记，
  不再用会被内层 spawn 转成 false 的 panic 独自证明未进入。不是新增产品缺陷或审查通过声明。
- 已做：`git diff --check`、rustfmt 只解析，以及临时 index 对 RED `662a79248` / fixed `50b86bc81`
  应用同一测试补丁的检查；两侧生产代码各自不变、测试源码相同。未做修正测试的编译、任何 native Cargo、
  hosted 重跑或实机验证。父任务仍须取得预期行为 RED 和 fixed GREEN；本次不推送、不建 PR、不合并或发布。

- 最终父任务验收：修正 RED run39922890390 在旧行为的端口保留断言失败；修复96125d828
  ci-gate39922905155成功，Tauri772passed，新回归/ownership同伴通过。Sol/xhigh R2覆盖该精确范围，
  R1测试oracle已修且无新finding。新增的本提交仅文档，不改已验产品树；仍未合并/发布或完成真机资格。
