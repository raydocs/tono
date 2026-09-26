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
- **续记（2026-09-26，#642 评审 d9ba823a 确认三条 minor）**：① opus:F1 / codex:F2：拒绝点在不可逆步骤之后，换账户登录时
  `adopt_replacing_with` 已使上一账户的连接失效并释放防护，`adopt_sign_in_response` 已丢弃目录、runtime 副本和连接失败记录。
  现在标记步骤移到 `adopt_replacing_with` 第一段锁内、代次核对之后、任何失效/释放/丢弃之前；写不进则拒绝，防护与上一账户状态都不动。
  本机已有本地标记时不写、不拒绝（`SignInMarker::Existing`）：登录替换的是它作证的会话，不改变归属；只认本地标记，旧位置的漫游标记不算。
  ② codex:F1：本次登录新写的标记（`Created`）在登录没有存下会话时（释放失败、被取代、`client.adopt` 失败）由 `undo_sign_in_marker` 删除；
  只在代次未变时删（已有更新的登录开始，它可能依赖这个标记，则保留）；登录前已有的标记不删。
  ③ codex:F3：错误改为稳定前缀 `TONO_SIGN_IN_NOT_SAVED`，前端 `tono.ts` 映射到 `tono.login.errors.signInNotSaved`
  （中英文：「无法在这台电脑上保存登录。请重新获取验证码后再试。」），登录页遇此错误清空已被服务端消耗的验证码；i18n 类型已重新生成。
  测试：同一条 `a_sign_in_whose_local_marker_cannot_be_written_is_refused` 改为三项判定（写不进拒绝、写入为 `Created`、已有本地标记为 `Existing`）；
  红分支同步更新骨架（`a1a55477`，windows-ci run 36213518420）；上一版红分支 run 36212810169 已以该测试断言失败（539 passed，1 failed）。
  本机（MacBook，仅前端）：`npx tsc --noEmit`、`eslint`、`biome format`（改动文件）通过，`npx vitest run src/services/tono.test.ts src/pages/tono/login.test.tsx` 39 passed；
  未运行 cargo，以 PR #642 的 windows-ci 为准。标记步骤的调用位置与撤销路径没有单元测试覆盖。
  剩余限制更新：写入标记之后、会话存入之前进程崩溃，标记留下并为凭据库原有内容作证（与此前「标记写入后异步写库失败或写库前崩溃」同类，本 PR 不能消除）；
  被取代的登录不撤销它新写的标记；撤销时删除失败只记日志。
