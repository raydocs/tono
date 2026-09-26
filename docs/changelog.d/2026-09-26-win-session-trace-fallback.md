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
