## 2026-09-27 · Windows：Windows 报告为不存在的遗留 Tono 网卡不再拒绝安装，也不再被当作隧道
- 归属：SHIP_PLAN G1（0.0.74 可安装性）；影响 Windows Service 安装 helper（`core/update.rs`、`core/update/security.rs`、
  `core/update/gate.rs` 注释、`bin/install_service/update_executor.rs`）、WFP 锁（`core/wfp/mod.rs`、`core/wfp_model.rs`）
  与 NSIS 87 对话框。发现 WIN-GATE-GHOST-TUN。
- 来源：基线 origin/main `6226b604`；分支 `fix/win-ghost-tono-adapter-20260927`，红提交 `38a5fb2e`
  （分支 `fix/win-ghost-tono-adapter-20260927-red`），修复提交 `145dc833`，本记录提交在其后；PR 待开，未合 main。
  方向：计划 PLAN-stale-adapter 第 3 版（Jev be13d4a6，计划评审 cb50f375 → d1837131 → 1e546b82 通过），实现决定 b43e5ab3。
- 缺陷修复：
  - WIN-GATE-GHOST-TUN（门禁）：每次停止 Core 都是 `TerminateJobObject` 硬杀，WinTUN 设备变为「不存在」（Not present），
    Windows 仍保留名为 `Tono` 的接口行；`tunnel_present` 只按名字匹配，所以连接过一次再断开或卸载的机器，每次手动重装都
    被 87 拒绝（读码推导，未实机确认）。改后：`tunnel_rows` 按 `OperStatus` 拆分名为 `Tono` 的行（精确名、不区分 ASCII 大小写），
    只有不是 `IfOperStatusNotPresent`（6）的行算存在；`manual_core_absent` 只对存在的行拒绝 87，只剩不存在的行时返回一条说明，
    `finish_gate` 把它写到 install-gate.log 的 OK 行（`--manual-update-gate exit=0 OK ignored a network interface named "Tono"
    that Windows reports as not present: …`）。`begin_manual` 的顺序不变：`manual_core_absent` 成功之后才写租约，拒绝不会留下租约。
    `tunnel_present` 的四个调用方共用这条规则：手动安装门禁 `manual_core_absent`（唯一改动的调用方），以及经 `tunnel_absent`
    的三个更新路径调用方 `update.rs:164`、`update.rs:442`、`windows_kill_switch.rs:1024`（v1 应用内更新在 `stop_core` 之后）。
  - WIN-GATE-GHOST-TUN（锁）：新 Core 的适配器接管名字之前，别名可能仍解析到遗留行的 LUID（许可被键到遗留 LUID，或随后
    「tunnel LUID changed」终态失败），遗留行也可能在别名解析和读行之间被 wintun 清掉，`GetIfEntry2` 返回 `ERROR_FILE_NOT_FOUND`
    而被当作永久拒绝，首次连接失败。改后：`validate_tunnel_luid` 读行后先调用纯函数 `wfp_model::tunnel_row_not_ready`：读到的行
    不存在，或别名解析后读行得到 `ERROR_FILE_NOT_FOUND`，都返回已有的可重试文字「did not resolve to a LUID」，App 现有重试
    （`failure.rs:91-95`，`LOCK_ATTEMPTS` 50 × 200 ms）等待新适配器；其他任何状态（如 5、87）仍是原来的永久拒绝，描述与类型检查不变。
  - NSIS 87 对话框不再让用户去设备管理器卸载网卡：只说明 Windows 报告名为 Tono 的网络适配器存在，请重启后重新运行安装程序，
    仍出现时把日志发给支持；俄语重复英文。
- 新增/优化：无。不删除任何设备或接口（不调用 SetupAPI、CfgMgr、pnputil 或 wintun），Service 不做清理，不改 Core 停止方式，
  不改 App；退出码 87 与 `TONO_INSTALL_TONO_ADAPTER_PRESENT` 不变。决定见 DECISIONS.md 2026-09-27「a Tono adapter that is not
  present is neither a refusal nor a tunnel」。
- 工程与测试：新增 `core::update::tests::update_manual_gate_ignores_a_not_present_tono_interface`（门禁拆分）与
  `core::wfp_model::tests::a_gone_or_not_present_tunnel_row_waits_for_the_new_adapter`（锁的两种等待与四种保持永久的状态）；
  `wfp/mod.rs` 用编译期断言把两个本地常量绑定到 windows-sys；`windows-packaging.test.mjs` 门禁文案循环内加一条断言：门禁文案
  不得提设备管理器。
- 验证：MacBook 未运行 cargo。本机 `apps/windows/app` 中 `node --test scripts/windows-packaging.test.mjs`：红提交上 1 项失败
  （`gateReasonTonoAdapterPresent (SIMPCHINESE)` 提到设备管理器），修复后 34/34 通过；`git grep -n -i "Device Manager\|设备管理器"
  -- apps/windows/app/src-tauri/packages/windows/installer.nsi` 无结果；`git grep -n "SetupDi\|CM_Get\|pnputil\|DIF_REMOVE" --
  apps/windows/service` 无结果；`rustfmt --check` 在改动处无新增差异。Windows CI（windows-2025）：红
  [run 36379273405](https://github.com/raydocs/tono/actions/runs/36379273405)（`38a5fb2e`，期望在「Test the service lifecycle」
  只有两个新测试在第一条断言失败），绿 [run 36379299558](https://github.com/raydocs/tono/actions/runs/36379299558)（`145dc833`）；
  写本条时两个 run 仍在运行，结果以 run 页面为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：
  - A5 未实机确认：遗留行在 `GetIfTable2` 与 `GetIfEntry2` 中是否真的报 OperStatus 6。若不是，门禁仍拒绝，锁的行为与今天相同。
  - 评审 1e546b82/codex:F1（minor，按设计保留）：纯函数断言只证明分类和消息，不证明 Windows 会完成别名迁移，也不证明首次连接
    能在重试预算内成功（A12、A14）。
  - 评审 1e546b82/codex:F2（minor，按设计保留）：0.0.72 实机两次连接成功只证明连接成功，不证明复用了同一 devnode、LUID 和名字（A7）。
  - A9：用户禁用的 `Tono` 适配器同样读作不存在，门禁忽略它，锁一直等到 wintun 清理之后；那一次连接失败，下一次成功。
  - A12：若 wintun 不能改名不存在的接口，新适配器成为 `Tono 1`，锁以「TUN adapter not ready?」超时，下一次连接成功。
  - 更新路径在硬杀之后的时序是 G3 / 0.0.75 的设备问题。Case B（另一台设备占用 `Tono` 名）CI 无法复现，只由锁测试和读码覆盖。
  - 客户修复（计划 §4.6）未做：需要在 Windows 10/11 上用 7421 时代安装程序复现 87，再用绿 SHA 的候选确认无对话框安装、
    install-gate.log 的说明行、首次连接成功和 `Get-NetAdapter -Name Tono` 为 `Up`。此前不得声称客户已修复。
