## 2026-09-26 · Windows 登录先写本机会话标记，写不进则拒绝登录（#635 续修）
- 归属：G1 账户/设备身份；影响 Windows App `tono/commands/account.rs`（`adopt_sign_in_response`）、`tono/credentials.rs`。
  Issue #409（H11-F2 Windows 部分），#632/#635 续修；合并回归审查（区间 `f2e24512...fb5e8485`，jev-route run `4459fadd`）
  codex:F2，登记为 CR4459-codex-F2。
- 来源：基线 origin/main `fb5e8485`；红分支 `wip/win-signin-marker-20260926-red`（`e044b620`，测试 + 沿用旧行为的骨架），
  修复分支 `fix/win-signin-marker-20260926`（修复 `5f5b136a`），[#642](https://github.com/raydocs/tono/pull/642)；未合 main。
- 缺陷修复：#635 之后只有本机标记能为凭据库会话作证，但登录仍先 `client.adopt` 写入 refresh token、再写标记，标记写失败只记警告。
  合法的本机会话于是没有标记，下次启动被当成外来会话：登出并释放防护。现在登录在 `client.adopt` 之前写标记，
  写不进则拒绝本次登录（不存任何凭据，可重试）；原来 adopt 之后的仅警告写入删除。归属规则不变：只有本机标记作证，漫游证据不认领。
- 新增/优化：无。
- 工程与测试：新增 `record_sign_in_marker` 与纯判定 `sign_in_marker_verdict`，测试
  `tono::credentials::tests::a_sign_in_whose_local_marker_cannot_be_written_is_refused`（红分支骨架沿用「不致命」，应以断言失败）。
  `adopt_sign_in_response` 里「标记先于凭据」的调用顺序没有单元测试覆盖。
- 验证：MacBook 未运行 cargo（非构建主机）；红分支 windows-ci 手动触发 run 36212810169，修复以 PR #642 的 windows-ci（windows-2025）为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：标记已写入而 `client.adopt` 随后失败（凭据写入队列满或已关闭）时，标记留下并为凭据库原有内容作证，
  与现有「标记写入后异步写库失败」属同一类；被拒绝的登录已通过服务端验证，该服务端会话未注销（与现有 adopt 失败路径相同），
  用户需重新获取验证码。未实机。
