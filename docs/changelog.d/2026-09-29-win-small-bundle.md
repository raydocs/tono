## 2026-09-29 · Windows：DNS 子进程先入退出 Job 再运行；释放拿不到 Service 时显示「保护状态未确认」
- 归属：SHIP_PLAN G1（§2 第 10 项，变砖排查第二轮）；影响 Windows Service（`core/process.rs`、`core/dns/engine.rs`，
  以及 `core/dns/mod.rs`、`core/windows_kill_switch.rs`、`bin/uninstall_service.rs` 的注释）与 App
  （`tono/connection/disconnect.rs`、`tono/connection/failure.rs`、`src/services/tono.ts`）。发现 R680-dns-child-job-window、
  R680-dns-marker-doc-stale、R681-old-helper-still-on（均 in-PR）。
- 来源：基线 origin/main `eacd0d2a`；分支 `fix/win-small-bundle-20260929`，红提交 `d1c59ca6`（只加测试），修复提交
  `645919a3`；实现 Jev-Decision 54dc19ce；PR [#684](https://github.com/raydocs/tono/pull/684)，未合 main。
- 缺陷修复：
  1. R680-dns-child-job-window：DNS 引擎起 powershell.exe、ipconfig.exe 时先正常创建、再入 kill-on-close 退出 Job，入 Job
     失败只记 warn；创建与入 Job 之间走 `process::exit`，或入 Job 失败，恢复脚本会比助手活得久。改后：`CREATE_SUSPENDED`
     创建，先 `AssignProcessToJobObject`，再恢复其线程（`std::process::Child` 不给线程句柄，按属主 PID 从 Toolhelp 线程快照
     找线程，`GetProcessIdOfThread` 复核后 `ResumeThread`）。入 Job 或恢复失败时终止这个尚未运行的子进程并返回错误，
     不再无绑定地运行；退出 Job 本身建不出来时不创建子进程。恢复之后它再起的进程随 Job 继承。
  2. R680-dns-marker-doc-stale：只改注释。`TONO_DNS_POLICY_REMAINS` 在前、DNS 结果原样在后，可与 `TONO_WFP_REMOVED`
     同时出现；挡住卸载的是 `with_resolver_rule_proof` 的再次清扫（规则仍在则 exit 3），WFP 仍在不是唯一的阻塞条件。
  3. R681-old-helper-still-on：释放前的 Service 就绪检查失败（已装的 `tono-service-install` 早于 `--start-registered`
     而退出 1、提示被拒、启动或修复失败）时，App 报「kill switch release failed; protection stays on」，Restore internet
     对话框据此显示「Leak protection is still on」。此时没有 Service 读数。改后：错误以 `TONO_PROTECTION_UNCONFIRMED`
     开头，前端映射到已有文案 `tono.progress.protectionUnknownBody`（「Tono cannot confirm network protection…」），
     不新增界面字符串。FSM 处理不变（仍按释放失败保持 Protected Offline，Restore internet 仍可再点）。
- 新增/优化：无。
- 工程与测试：新增 `core::process::tests::a_dns_helper_runs_only_after_joining_the_job`（Windows 真实起 `cmd.exe`：入 Job
  的子进程被恢复并运行；入不了 Job 的子进程从未运行且返回错误）、
  `tono::connection::disconnect::tests::an_older_start_helper_leaves_protection_unconfirmed_not_promised_on`，以及
  `src/services/tono.test.ts` 一个 `it`（`TONO_PROTECTION_UNCONFIRMED` 映射到未确认文案）。`bind_to_process_exit`
  由 `spawn_bound_to_process_exit` 取代。
- 验证：MacBook 未运行 cargo、Tauri、vitest 或 Windows 构建。
  - 红（`d1c59ca6`，只加测试）：Windows CI [36611231215](https://github.com/raydocs/tono/actions/runs/36611231215) failure，符合预期：service 作业「Test the service
    lifecycle」编译失败 `error[E0425]: cannot find function spawn_in_job`；app-rust 作业「Test the Tauri crate」编译失败
    （E0425 `PROTECTION_UNCONFIRMED_PREFIX`、`service_not_ready_release_error`）；app 作业 vitest 断言失败 `expected
    'translated:tono.errors.unknownAction' to be 'translated:tono.progress.protectionUn…'`；core 通过。
  - 修复（`645919a3`）：Windows CI [36612592064](https://github.com/raydocs/tono/actions/runs/36612592064)（push）success，四个作业全绿；
    `a_dns_helper_runs_only_after_joining_the_job` 与 `closing_the_exit_job_ends_a_bound_helper` 在「Test the service lifecycle」
    为 ok（347 passed），「Test native DNS apply orchestration」（无 `test` 特性，编译含本改动的 engine）通过；
    `an_older_start_helper_leaves_protection_unconfirmed_not_promised_on` 在 app-rust 为 ok（lib 557 passed）；app 作业
    vitest 38 个文件全过。PR 的 pull_request 运行 [36612680263](https://github.com/raydocs/tono/actions/runs/36612680263)
    success。PR head 上的记录提交只改 `docs/`，其 CI 结果见 PR。
  - 未执行：实机场景（助手在 DNS 恢复进行中退出；已装旧版 helper 时停止 Service 后点 Restore internet）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：
  - WmiPrvSE 残留：已交给 WmiPrvSE 的单个 CIM 调用（`SetDNSServerSearchOrder`）不随 powershell 被 Job 结束而撤回。
  - 创建（挂起）与入 Job 之间若进程退出，留下一个从未运行的挂起子进程，不改 DNS，直到重启或被结束。
  - 入 Job 失败时这次 DNS 应用或恢复失败并报错，按已有失败路径处理，不再无绑定地运行脚本。
  - 未确认文案覆盖就绪检查失败的所有原因，不只旧版 helper；其它释放失败（Service 拒绝、Service 返回仍武装）仍报「保护仍开启」。
