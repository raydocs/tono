## 2026-09-26 · Windows 漫游账户痕迹不再单独认领会话（#632 续修）
- 归属：G1 账户/设备身份；影响 Windows App `tono/credentials.rs`、`tono/commands/account.rs`（启动读取会话）。
  内部审查 H11-F2（Windows 部分）续修，Issue #409；#632 审查发现 opus:F1。
- 来源：基线 origin/main `f2e24512`；分支 `fix/win-session-trace-fallback-20260926`，
  [PR #635](https://github.com/raydocs/tono/pull/635)；红分支 `wip/win-session-trace-fallback-20260926-red`；未合 main。
- 缺陷修复：#632 把会话标记移到不漫游的 `%LOCALAPPDATA%`，但本地标记缺失时仍回退到账户痕迹（目录/策略缓存、
  节点选择、隐私设置），而这些文件在漫游数据目录 `%APPDATA%\com.raydocs.tono\tono`。同步该目录的机器会凭漫游来的
  痕迹认领会话并写下本地标记，等于痕迹替代了标记。现在只有本地标记证明归属；账户痕迹只在一次性升级时有效：
  凭据库里的 refresh token 是旧版以 `CRED_PERSIST_ENTERPRISE` 写入的（#632 之前的安装，读取时已识别并改写为本机持久化）。
  旧位置的漫游标记仍按 #632 采纳一次。其余情况本地标记缺失即要求重新登录，不认领。迁移锁不变。
- 新增/优化：无。
- 工程与测试：新增纯判定 `adopts_unmarked_vault_session` 及
  `tono::credentials::tests::roaming_account_traces_vouch_only_for_a_session_an_earlier_build_stored_roaming`；
  启动读取改用 `TonoCredentialStore::get_session_async`（带 `legacy_roaming`）。已有
  `fresh_data_dir_does_not_adopt_a_vault_refresh_token` 的升级场景改为提供旧版漫游凭据（与真实旧安装一致）。
- 验证：MacBook 未运行 cargo（非构建主机）；以 PR #635 的 windows-ci（windows-2025）编译与测试为准，
  红分支应以断言失败。Win32 读取标志与实际漫游行为没有单元测试覆盖。
- 候选/发布：仅源码，无新候选。
- 剩余限制：一次性升级时若本地标记写入失败，凭据已改写为本机持久化，下次启动要求重新登录（此前漫游痕迹会再次认领）；
  #632 之前已形成的克隆（两台都持有漫游来的 enterprise 项和漫游痕迹）仍会在每台各认领一次，无法区分；
  漫游配置文件行为需两台 Windows 实机确认。
- **续记（2026-09-26，双厂商评审确认 major：升级证据先于归属标记被销毁）**：上一版 `722af1e6` 在
  `win_vault::get_migrating` 的读取里就把旧版 `CRED_PERSIST_ENTERPRISE` refresh token 改写为本机持久化，
  「旧版漫游凭据」只存在于内存返回值，本地标记要等整个异步加载结束后才写。① 启动读取超过
  `CREDENTIAL_LOAD_TIMEOUT`（3s）后 `spawn_blocking` 仍完成改写、结果被丢弃，`tono_retry_restore` 再读时已是
  本机持久化 → 不认领 → 登出、释放防护、删除 refresh token；② 并发的 `load_credentials`（启动与重试/登录）中
  后读的一方可能先提交「非漫游」；③ 升级时本地标记写入失败仍认领，首次 token 轮换即改写凭据，下次启动登出。
  现在会话读取（`TonoCredentialStore::get_session_async` → `win_vault::read_unmigrated`）不改写；只有在标记
  确实为它作证之后（本地标记已写入，或旧位置的漫游标记仍在）才由 `load_credentials` 在加载之外调用
  `bind_session_to_machine_async` 改写为本机持久化（仍在 `VAULT_LOCK` 下改写当时存的值，不会复活已轮换或已删除的
  token；失败则下次加载重试）。`data_dir_owns_vault_session` 改为返回 `VaultSessionOwnership`：
  一次性升级若本地标记写不进，返回 `Unrecorded`，加载记为凭据错误、不开闸（M1 分支：保持防护、提供 Retry），
  既不认领（轮换会销毁证据）也不登出；重试时漫游凭据仍在，再次升级。归属规则本身不变：无本地标记且无旧版证据即重新登录，
  漫游痕迹单独不作证。测试：新增纯判定
  `tono::credentials::tests::a_roaming_session_upgrade_is_rebound_only_once_a_marker_vouches_for_it`；红分支
  `wip/win-session-upgrade-evidence-red`（`722af1e6` + 该测试 + 沿用旧规则的骨架，应以断言失败）。MacBook 未运行 cargo，
  以 windows-ci（windows-2025）为准；Win32 读取不改写这一点没有单元测试覆盖。仅源码，无新候选。
  剩余限制更新：上文「本地标记写入失败则下次要求重新登录」不再成立，改为停在凭据错误并可重试（若本地目录持续不可写，
  Retry 会一直停在该错误，用户可改为重新登录）；旧版漫游凭据在归属写入之前保持漫游，时间窗比上一版长（从读取到认领成功，
  未认领的会话仍由登出清理删除）；其余限制不变。
- 续记 2026-09-26：#635 已合 main（merge 57c1c64c）。内部候选 0.0.73 build73（源码 fb5e8485；macOS run 36212061109、Windows run 36212062220）包含本修复，未发布到客户通道，实机待测。登录前写标记的续修见 #642（未合）。
