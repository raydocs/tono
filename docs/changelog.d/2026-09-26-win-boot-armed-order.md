## 2026-09-26 · Windows：启动安装 WFP 失败时，远程桌面连接不再沿用上次的已验证标记
- 归属：G1（Windows 保护/连接门控）；影响 Windows Service `core/windows_kill_switch.rs`。发现 TW-R-boot（Part of [#602](https://github.com/raydocs/tono/issues/602)）。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/win-boot-armed-order-20260926-red`（`55c1c19e`），修复分支
  `fix/win-boot-armed-order-20260926`，[#650](https://github.com/raydocs/tono/pull/650)；未合 main。
- 缺陷修复：Service 启动恢复已验证的保护意图时，先发布 ARMED（`verified` 沿用上次），再安装 WFP；安装失败时 ARMED 保留
  （fail-closed，看门狗继续重试），但本次启动并没有任何过滤器。TW-anthropic-1 的远程桌面例外只看 `verified`，
  把它当作「屏障已装好」的证明，于是同一 owner 在这段时间从远程桌面连接会被放行，连接后装上的屏障会切断该远程会话。
  改后：启动恢复在发布前标记「本次启动尚未证明屏障」（`RESTORED_BARRIER_UNPROVEN`），第一次成功的 WFP 安装或实时校验
  （看门狗修复、控制台连接等）才清除；标记存在期间，远程桌面例外不成立，连接被拒绝，网络保持原状。
- 新增/优化：无。ARMED、落盘意图、`verified`、状态上报与看门狗重试都不变：安装失败仍报错、仍显示需要保护（不显示为已解除），
  `retire_unverified_on_service_start` 仍保留已验证意图。控制台会话的连接不受影响。
- 已核对 `verified` 的其他读取方：`arm_bootstrap` 的同 owner 继承（只在控制台可达，安装失败时标记不清除）、`mark_verified`
  （要求 Locked，须先成功 lock）、`retire_unverified_on_service_start`（已验证意图保持拦截）、`status()`（只上报）；均不需要改。
- 工程与测试：把门控读取已发布意图的代码抽成 `connect_session_refused`（红分支上行为不变）；新增
  `a_failed_startup_install_withholds_the_remote_reconnect_exception`：启动安装失败后远程会话应被拒绝，安装成功后恢复例外。
  红分支应以第一条 `connect_session_refused` 断言失败，不是编译失败。
- 验证：MacBook 未运行 cargo（非构建主机），只用 `rustfmt --check` 看过改动（无新增格式差异）；以 #650 的 windows-ci
  （windows-2025，`cargo test --features standalone,client,test`）为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：安装失败后如果过滤器其实已提交（不确定失败），要等看门狗下一次实时校验成功才恢复例外；未实机验证远程桌面场景。
