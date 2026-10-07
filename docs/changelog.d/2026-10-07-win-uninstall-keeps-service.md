## 2026-10-07 · Windows 卸载无法证明安全时保留 Service（BRICK-W3）
- 归属：SHIP_PLAN §2 第 10 项（0.0.75 修复批，所有者 2026-10-07）；Windows Service 卸载助手与 NSIS 安装/卸载脚本。
- 来源：origin/main `f2cb79522` → 分支 `claude/win-uninstall-still-protected-keeps-service-20261007`；PR 见 findings.d/BRICK-W3.md；未合 main。
- 缺陷修复：卸载助手结果为 StillProtected（exit 3：WFP 屏障或 Tono 的 NRPT 规则无法证明已移除、或 Service 停不下来）时，过去仍删除 SCM 注册和
  ProgramData 里的 `tono-service.exe`，NSIS 随后却说「nothing was deleted」→ 现在先定结果（含 NRPT 清扫证明）再删：结果阻塞时
  Service 注册、二进制与恢复文件都保留，产品仍有释放路径；NSIS 中止文字改为如实说明「保护可能仍在、Service 与文件已保留、用开始菜单
  『恢复网络』快捷方式或重跑卸载/安装程序释放、不要靠重启」；`.onInstFailed` 的同类提示也不再叫用户重启。保留的 Service 开机重启不会
  在没有屏障时重放 Core：`restore_desired_state` 只在同一次开机且已恢复 wanted 屏障时重放（BRICK-W1 的门）。
- 新增/优化：无。
- 工程与测试：新增 `remove_service_unless_still_protected` 作为删除门；回归 `still_protected_keeps_the_service_registration_and_binary`。
  旧测试 `blocking_error_stays_blocking_after_the_service_was_deleted` 改名 `blocking_error_stays_blocking`（断言不变，旧名描述的删除行为已不存在）。
- 验证：本机 `node --test scripts/windows-packaging.test.mjs`（apps/windows/app）pass 39 fail 0。`cargo test`、makensis 未在本机运行（所有者规则），
  只由 PR 上的 ci-gate 证明。
- 候选/发布：无新包，仅源码。
- 剩余限制：未实机验证（保留的 Service 在 exit 3 后的 Disconnect/恢复网络流程）；nsExec 超时中断助手时，删除步骤若已开始，Service 可能只删了一部分
  （决定在删除前做出，但超时可落在删除过程中）。
