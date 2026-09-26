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
- **续记（2026-09-26，#642 续审 ad7be8fc 确认 opus:F1 / codex:F1，同一根因）**：标记只表示「文件存在」，没有绑定到本次登录已存下的会话。
  `adopt_replacing_with` 在写标记与存会话之间释放锁；新的登录或 `restore_session` 的重试在此间隙提升 `sign_in_generation`，
  被取代的登录因代次已变保留自己新写的标记，下一次登录又按「文件存在」判成 `Existing`，失败也不撤销，
  于是一个从未存下会话的登录所写的标记长期为凭据库原有内容作证。现在 `TonoInner.sign_in_marker_pending` 记录写了标记、
  尚未存下会话的登录代次：写标记（`Created`）时置为本次代次；`adopt_sign_in_response` 在 `client.adopt` 成功后清空；
  登录未存下会话时，只要标记仍归本次登录（pending 等于本次代次）就撤销，不再看代次是否已变。后来的登录遇到仍待定的标记，
  不当作本机已有归属，而是重写并接管（`Created`，pending 改为自己的代次），由它存会话或撤销；原登录见 pending 已不是自己则不删。
  撤销时删除失败则 pending 保留，本进程内的下一次登录仍接管而不当作 `Existing`。登录前已有的真实标记（pending 为空时已存在的文件）
  仍为 `Existing`，不重写、不删除；拒绝点、防护与上一账户的处理不变。
  测试：新增 `tono::commands::account::lifecycle_tests::a_superseded_sign_in_leaves_no_marker_vouching_for_the_vault`
  （隧道启动中，释放期间开始新的登录使 A 被取代，断言下次启动对凭据库的归属判定为 `NotOwned`）；红分支
  `wip/win-signin-marker-20260926-red2`（`77ec5dcf`，基于 `3b9ad5f7`，仅测试，windows-ci run 36214673497）。
  「后来的登录接管待定标记」与「存下会话时清空」没有单元测试覆盖。MacBook 未运行 cargo，以 PR #642 的 windows-ci 为准。
  剩余限制更新：写入标记之后、会话存入之前进程崩溃，标记仍留下并为凭据库原有内容作证（pending 只在内存）；撤销时删除失败，
  下次启动仍认该标记；登录待定期间若有凭据加载读到该标记（`tono_retry_restore` 或新登录开始时的 `load_credentials`，
  只在此前读库失败、凭据尚未载入时发生），本进程仍当作本机归属载入库中旧令牌，撤销后下次启动不再认。
