# Decision 091 有界整合预检（不是冻结候选签核）

归属：SHIP_PLAN G1/G2；仅首登、失败/取消/掉线恢复、保护与明确解除三项。本轮不改生产代码、不重做 UI、不构建或发布候选。

## 源码与证据身份

- checkpoint：GitHub `origin/main` [134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a)，#1560。不是最终组合 SHA，没有对应最终候选包或包哈希。
- 该 checkpoint 包含 A29/#1506、A30/#1507、#1542、Mac #1552 / Windows #1553 relay-only 与第三中继 #1538。旧 A29 FAIL、旧「A13 不纳入」不描述当前计划；主线程明确 A13/#1504 **必须修完才发布**，该修复仍由其 worker 所有。
- 主线程根目录本地 `main` 仍为旧 `2f4b2c195`，不使用它。本线程分支 `amp/relay-only-preflight` 从上述 `origin/main` 创建。主线程未推的 A13/账户恢复 WIP 没有纳入本次检查，聊天不传源码。
- 沿用的实际 CI checkout 为 [eb8909bd3a7905cb7ed5205768483aedfb0fd8e2](https://github.com/raydocs/tono/commit/eb8909bd3a7905cb7ed5205768483aedfb0fd8e2)。到 checkpoint 的 `apps/` 差异为空；进一步比对所有跟踪输入（文档除外）也为空。不是拿 PR merge-ref 当产品 head。
- [Windows push CI / app-rust](https://github.com/raydocs/tono/actions/runs/38097411275/job/114346079213)：`709 passed; 0 failed; 0 ignored; 0 filtered out`。本轮核对 16 个准确命名结果，均 `ok`。**黑洞预算测试实际执行未确认：** 原命令 `cargo test --locked` 捕获成功测试 stderr；`blackhole_is_intercepted()` 为 true 时测试会打印 skip 后 return，仍显示 `ok`。日志没出现 skip 不证明该 guard 没触发。其他 core 测试带 `--nocapture` 不覆盖此 app 测试。
- [macOS push CI / build](https://github.com/raydocs/tono/actions/runs/38097411277/job/114346387288)：`Executed 707 tests, with 1 test skipped and 0 failures`。本轮核对 17 个准确命名结果，均 `passed`；唯一 suite skip 是 `HelperInstallScriptTests.testEmitInstallScriptWhenRequested`，不是本矩阵中的故障测试。
- 附加只读核对：[Windows Service](https://github.com/raydocs/tono/actions/runs/38097411275/job/114346079217) 为 success（含 `api_relay_permit_requires_revision_twenty ... ok`）；[Mac privileged-tests](https://github.com/raydocs/tono/actions/runs/38097411277/job/114346387236) 为 success，执行 root helper self/lifecycle/core-lifecycle 测试。它们不等于安装包在用户设备上经历 PF/WFP 故障后恢复。

## 三项结论：组件通过，端到端仍未验证

1. **国内首次登录/首次连接：未验证端到端；relay-only 路径选择组件证据通过。** Windows 无隧道测试断言 direct 连接数为零及 `X-Tono-Path=relay`。预算测试设计为两黑洞后第三 HTTP fixture 返回刷新结果，低于两次 4 s connect timeout 加 2 s，且两倍耗时低于 30 s restore budget，随后 `me` 优先走记住的第三中继；但捕获的 stderr 不能确认其提前返回 guard 未触发，**此预算场景不签核**。Mac 使用注入的 relay-only 读取器，验证 relay header、没有 system/pinned 调用。真实生产 HTTPS 登录、邮件验证码、目录与首连未在国内家宽执行。
2. **取消、失败、断网恢复：未验证完整组合；掉线路径/取消/代际组件通过。** Windows 覆盖 relay-walk 中途丢弃后不拨下一中继、不改成功偏好；掉线后跳过 direct、DoH、备用端口与 loopback；Service 等待期间锁存掉线。Mac 覆盖掉线期间/步骤间 direct 停止、旧 token/catalog 返回不污染新账户、取消后的凭据不被收养及 disconnect 排空旧 mutation。不能据此宣称“DoH 已发出并等待 → 取消 → 新登录”完整场景过关。
3. **保护与用户明确解除可信：未验证实机；账户层/清理所有权组件通过。** Mac 保护中登录失败测试未调用解除；Windows/Mac 不可达恢复只允许与当前 token、内存目录/路由摘要匹配的 grant，无 grant/撤销/错账户不能 Ready。Mac 明确解除需要等待取消的 mutation，旧账户 release 不能绕过新的保留保护 owner。没有把合成 UI 截图、测试的布尔屏障或状态枚举当作真实 PF/WFP 拦截证明。

本轮没有复现新的产品级缺陷，也没有对 A13 或最终组合给 PASS。helper 重启/解除代际、PF/WFP 失败后状态、hy2→Reality 的完整设备序列留待准确冻结候选检查，不因这一轮 transport 证据而自动通过。

## 证据没有覆盖的具体时序

- **G2 / 高优先补证：Windows 黑洞预算不是一个 ok 就算执行。** 在匹配源码的 Windows app `src-tauri` 目录只跑 `cargo test --locked --lib tono::transport::tests::relay_only_without_tunnel::without_a_tunnel_two_dead_relays_leave_the_third_inside_the_budget_and_it_goes_first_next -- --exact --nocapture`，保存准确 SHA、测试结果和未触发 skip 的完整输出。无需重跑整个 native suite。当前 Linux orb 不执行此原生测试。
- **G2 / 高优先补证：DoH 已在等待时取消并重进。** 已有 `a_tunnel_lost_before_doh...` 与 `a_tunnel_lost_after_the_doh_check...` 都在 query 发出前改变状态；`resolve_via_doh` 的 futures 由调用者持有、非 detached 是源码推导。最小缺口场景：健康 tunnel → 前序请求失败 → DoH fixture 确认收到查询但不答 → Cancel/Disconnect → 新登录 → 放行旧 DoH；断言旧查询取消、不再拨旧 direct、不覆盖新 token/catalog。现有 relay-walk 取消回归不能替代它。**这是未验证，不是已确认泄漏。**
- **G1/G2 / 高优先补证：Mac 第三中继完整成功与恢复总预算。** `testTheThirdRelayIsDialedAfterTheFirstTwoFail` 使用两个关闭的 loopback 端口与一个在 TLS 前关闭的 listener，只证明顺序、到达和 connect-budget；不是两黑洞后第三返回有效 HTTPS。另一个测试只有一个静默 relay、第二到达。最小缺口场景：前两中继 TCP/TLS 黑洞，第三返回有效刷新/`me`/目录响应；验证总时长、成功账户/目录状态，及同一合法缓存的 reconnect。不能用 Windows 的 HTTP fixture 结果替 Mac 签核。
- **G1/G2 / 发布设备门：all-fail + 真保护 + 缓存重连。** 在安装的准确候选上进入 Protected Offline，三中继都拒绝/丢包，执行 refresh 和 catalog；记录 relay-only、清晰错误、PF/WFP 仍阻断未允许流量且没有隐式 release；恢复一个出口后凭匹配 grant/cache 连接。再用撤销、过期、其他账户 grant 作反例。现有 grant folding 与 transport 测试是分开的；Mac“保护中失败不解除”fixture 没有断言该次调用同时 relay-only。

## 必修阻塞与可延后项

- **必修/未满足发布条件：** A13/#1504 按主线程最新要求完成、Sol 审准确 head；主线程账户恢复 WIP 与待合 UI 完成后冻结唯一组合 SHA、构建候选并绑定包哈希；老板在 SHIP_PLAN §6 填 G1/G2 本人实机证据与勾选。该 checkpoint 不能替代这些门槛。
- **最小外部条件：** 可恢复的 macOS / Windows 11 设备与主线程候选包；一条受影响的国内家宽线用于无其他 VPN 的首次登录/首连与上述窄故障序列。发布凭据只由主线程按既有流程使用，本线程不需要其秘密值。
- **既有可延后/明确残留（不新增重复 Issue）：** 三中继虽跨商家仍同在洛杉矶（`API-RELAY-SAME-PROVIDER`）；Mac PF 按 UID，不是进程身份（#331）；旧/未知 Windows Service 无 relay-permit 时保留完整路径是 decision 091 的兼容例外；已有 `MAC-UPDATE-RETAIN-NO-RELAY`、`MAC-CP-PINNED-SILENT-WAIT` 仍按原记录处理。本轮不扩大修复或重新定级。

## 可运行预检与本轮工具验证

仓库根目录执行（需要 Git、Node 和只读 `gh` 访问；不触发 workflow、不安装 toolchain）：

```sh
node --test tooling/scripts/tests/relay-only-preflight.test.mjs
node tooling/scripts/tests/relay-only-preflight.mjs \
  134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a 38097411275 38097411277
```

本轮 Linux orb / Node 24.18.0 原始决定性输出：

```text
✔ the public CLI refuses unearned green evidence and stale dependencies
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

真实 GitHub CLI 预检退出码 0，输出 `kind=component-evidence-preflight`，checkpoint 为 `134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a`；两实际 checkout 均为 `eb8909bd3a7905cb7ed5205768483aedfb0fd8e2`；Windows 16、Mac 17 个命名结果。回执另有 `unverifiedFaultExecution`，明确黑洞提前返回/captured stderr 的不确定性。完整原始 job 日志留在 GitHub，未提交其账号/诊断内容。

脚本拒绝源码/锁文件/配置/工作树漂移、非 main push、实际 checkout 不符、缺/重复/失败/跳过的命名结果、**日志可见**的黑洞 skip、缺 suite summary 或 `gh` 失败/超时/输出超限。不宣称识别被 capture 隐藏的 skip。比对豁免仅 `docs/`、这两个 preflight 脚本及 hosted native jobs 不调用的 operator aggregate `test-macos-all.sh`；该 aggregate 只新增本 CLI 回归的一行注册，没有全量运行。外部依赖缓存、机器网络与真实保护不由 Git 比对证明。命名结果与源码等同性是可复用证据，**不是要求已满足的自动语义判定**。

额外窄检查 `bash tooling/scripts/test-suite-reachability.sh` **FAIL，退出码 1**，列出 20 个既有未注册 suite（包含注册守卫自己）；本 CLI 回归不在失败列表。用 checkpoint 的跟踪 suite 集合、原始 aggregate/guard 和未修改的 workflows 构造临时只读基线，复验输出同样 20 项、退出码 1。没有把该失败删掉或记成通过，也未扩大修改这 20 项；临时基线检查目录不交付。

交付是独立 docs/test PR；不自签核、不合并、不发布。完成这一轮后等待主线程发送最终 SHA，不循环重跑预检。
