## 2026-09-25 · Windows 会话凭据改为本机持久化，不再随漫游配置文件复制设备身份
- 归属：G1 账户/设备身份；影响 Windows App `tono/credentials.rs`（Credential Manager 与会话标记）。
  内部审查 H11-F2（Windows 部分），Issue #409；macOS 部分已由 #414（main 5da90232）合入。
- 来源：基线 origin/main `7a09f9cd`；分支 `fix/win-session-local-persist-20260925`，
  [PR #632](https://github.com/raydocs/tono/pull/632)；红分支 `wip/win-session-local-persist-20260925-red`；未合 main。
- 缺陷修复：keyring 3.6.3 把 refresh token 与 installationId 写成 `CRED_PERSIST_ENTERPRISE`（写死，不可配），
  随漫游用户配置文件复制到另一台 PC，两台机器共用同一设备身份和单次使用的 refresh token，一台轮换后另一台
  被判会话死亡而登出。现在 Windows 直接调用 `CredReadW`/`CredWriteW`/`CredDeleteW`，写入
  `CRED_PERSIST_LOCAL_MACHINE`，目标名、UserName、UTF-16LE 编码与 keyring 相同。读取到旧版写的 enterprise 项时，
  以同一目标名重写为本机持久化（CredWrite 覆盖漫游副本；不调用 CredDelete，否则会删掉刚重写的会话），
  重写失败也照常返回会话，下次读取重试；进程内锁保证迁移不会写回已被轮换替换的旧 token。
  会话标记 `vault-session.marker` 从漫游数据目录移到 `%LOCALAPPDATA%` 下同一相对路径；旧位置的标记只采纳一次，
  本地写入成功后才删除漫游副本。`%APPDATA%` 下没有设备身份（installationId 只在凭据库）。
- 新增/优化：无。非 Windows（开发机）仍用 keyring。
- 工程与测试：`windows` 依赖增加 `Win32_Security_Credentials` feature（Cargo.lock 不变）；
  新增 `tono::credentials::tests::a_roaming_session_credential_is_rewritten_local_machine`（纯迁移判定）。
  安装器只改注释，`cmdkey /delete:refresh-token.tono` 仍对应。
- 验证：MacBook 未运行 cargo（非构建主机）；以 PR #632 的 windows-ci（windows-2025）编译与测试为准，
  红分支应以断言失败。Win32 调用、Persist 改写是否移除漫游副本、标记迁移没有单元测试覆盖。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需在两台共用漫游配置文件的 Windows 实机上确认漫游副本消失；本版本之前已形成的克隆
  （两台都已持有漫游来的 enterprise 项）会在各自机器上迁移，不能识别；macOS data-protection keychain 仍 open（#409）。
- 续记 2026-09-26：#632 已合 main（merge cd881eb5）。内部候选 0.0.73 build73（源码 fb5e8485；macOS run 36212061109、Windows run 36212062220）包含本修复，未发布到客户通道，实机待测。
