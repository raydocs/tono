## 2026-09-27 · Windows：安装/卸载门禁的每个拒绝都说明原因、下一步、代码和日志
- 归属：SHIP_PLAN G1（可安装性），客户 0.0.74 发布阻断（7411 候选上的客户现场）；影响 Windows Service 安装 helper
  （`core/update.rs`、新 `core/update/gate.rs`、`update/security.rs`、`update_transaction.rs`、`update_executor.rs`）
  与 NSIS（`.onInit`、`un.onInit`、Uninstall 节、`un.onUninstSuccess`）。发现 WIN-GATE-OPAQUE、WIN-UNINST-LEASE-WINDOW、
  WIN-GATE-CORE-PID-REUSE。
- 来源：基线 origin/main `11d62953`（即 7411 源码）；分支 `fix/windows-gate-reasons-20260927`，红提交 `99214112`，
  修复提交在其后；PR 待开，未合 main。
- 缺陷修复：
  - WIN-GATE-OPAQUE：新笔记本上卸载旧版后运行 7411 安装程序，客户只看到通用「现在无法安装：可能有受保护的更新…」。
    除 77/78/79 外，门禁的所有拒绝（租约、修复锁、更新记录、WFP、所有者记录、DNS、核心进程、Tono 网卡、
    ProgramData 目录、安装程序自身、panic）都以 anyhow 退出码 1 落到同一个对话框，原因只写到 `.onInit` 看不见的
    stderr。改后：每个拒绝带稳定代码和自己的退出码（80 `TONO_INSTALL_UPDATE_PENDING` … 91 `TONO_INSTALL_UNEXPECTED`，
    nsExec 起不来为 `TONO_INSTALL_HELPER_BLOCKED`）；NSIS 按代码显示这台电脑上是什么问题、下一步怎么做，再列错误代码、
    helper 写回的首行错误和日志路径；门禁把带时间戳的完整错误链追加到 `%ProgramData%\Tono\logs\install-gate.log`
    （256 KiB 轮换一次；state 根目录不可用时写本账户 TEMP）。卸载门禁同样处理，删掉两条兜底文案
    `manualInstallRefused`/`manualUninstallRefused`（三种语言）。新文案只有中文和英文，俄语条目重复英文（所有者决定）。
  - WIN-UNINST-LEASE-WINDOW：卸载程序在「完成」页关闭前一直持有手动租约，此时运行新安装程序被当作「另一个安装程序」。
    改后：卸载节最后一个改动之后立即交还租约；中途 Abort 的卸载照旧保留。
  - WIN-GATE-CORE-PID-REUSE：卸载留下的核心运行记录在 pid 被无法读取映像的进程复用后，每次都让门禁报错。改后：
    用 Toolhelp 映像名区分，名字不同即过期；没有已注册 Service 时删除过期记录。同名或读不到名字仍拒绝。
- 新增/优化：`--manual-update-gate`/`--manual-orphan-gate`/`--manual-uninstall-gate` 接受 `--reason-file <path>`；
  确认清除孤立拦截后若又出现 Service，孤立门禁返回 77（断开提示）而不是通用拒绝。不自动删除遗留 Tono 网卡、
  不把读不到的所有者/DNS 证据当作不存在（暂定决定，见 DECISIONS.md 2026-09-27）。77/78 的安全语义不变。
- 工程与测试：新增 `update_executor::tests::update_manual_gate_refusal_names_its_cause_in_the_log_and_the_dialog`、
  `core::update::tests::update_manual_gate_treats_a_reused_core_pid_as_a_stale_record`；`windows-packaging.test.mjs`
  的门禁对话框断言改为逐个退出码核对 NSIS 分支、三语条目（新条目俄语 = 英文）与卸载节末尾交还租约。
- 验证：MacBook 未运行 cargo；本机 `node --test scripts/windows-packaging.test.mjs`：红提交上 4 项失败（新对话框、租约、
  孤立门禁参数、租约位置），修复后 34/34 通过；`rustfmt --check` 改动处无新增差异。Windows CI、候选构建（NSIS 编译）、
  安装冒烟尚未运行（分支未推送）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：该客户的具体拒绝原因仍未知，需要新包给出的代码或日志；新对话框未在 Windows 实机点过；NSIS 字符串长度按
  1024 字符上限估算（详情截到 300 字符）；遗留 Tono 网卡仍需重启或设备管理器手动删除。
