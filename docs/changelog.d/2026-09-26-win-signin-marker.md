## 2026-09-26 · Windows 登录先写本机会话标记，写不进则拒绝登录（#635 续修）
- 归属：G1 账户/设备身份；影响 Windows App `tono/commands/account.rs`（`adopt_sign_in_response`）、`tono/credentials.rs`、`tono/state.rs`（`session_marker`）。
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
- **续记（2026-09-26，#642 续审 147a047f 确认 codex:F1）**：上一条的待定状态只在内存（启动时为空），标记文件本身仍只按「存在」判定；
  写标记后、存会话前进程崩溃，或撤销删除失败后重启，标记都会为凭据库原有账户作证。现在标记文件自己带状态：
  登录写入 `pending:<代次>`（先写 `vault-session.marker.staged` 并 `sync_all`，再改名替换，崩溃只留旧标记或新标记，不留残缺文件），
  `client.adopt` 成功后在同一锁段内原子改写为已提交内容 `1`（`commit_sign_in_marker`）。
  `data_dir_owns_vault_session` 读到待定标记即 `NotOwned`（不作证，需重新登录；文件留着，下一次登录会接管），
  读到其他内容（此前各版本写的 `1` 或空文件）仍为 `Owned`，升级不会批量登出；标记存在但读不出时答 `Unrecorded`
  （既不认领也不登出，保留防护，重试时再读）。登录遇到读不出的标记则拒绝（`TONO_SIGN_IN_NOT_SAVED`），因为它可能是不得改写的已提交标记。
  `undo_sign_in_marker` 只删待定标记，已提交标记绝不删除；登录前已有的已提交标记仍为 `Existing`，不重写、不删除。
  后来的登录遇到待定标记（文件或内存）照旧接管。上一条记下的「登录待定期间的凭据加载仍认该标记」随之关闭：加载读到待定标记即不认领、不载入旧令牌。
  测试：新增 `tono::commands::account::lifecycle_tests::a_sign_in_cut_off_before_storing_its_session_leaves_no_marker_vouching_for_the_vault`
  （释放上一隧道时进程结束，以超时丢弃 `adopt_replacing_with` 模拟，断言下次启动的归属判定为 `NotOwned`）；红分支
  `wip/win-signin-marker-20260926-red3`（`6fae885f`，基于 `5773e3c3`，仅测试，windows-ci run 36215718981）。
  上一轮 `5773e3c3` 的 windows-ci 通过，红分支 run 36214673497 以断言失败。提交改写失败、读不出的标记、旧格式标记没有单元测试覆盖。MacBook 未运行 cargo，以 PR #642 的 windows-ci 为准。
  剩余限制更新：`client.adopt` 成功后、改写为已提交之前进程崩溃（或改写失败），会话已存而标记仍待定，下次启动按未登录处理
  （需重新登录，走与任何无归属会话相同的 NoToken 恢复路径）；改写为已提交紧跟在 `client.adopt` 把写库排入队列之后，
  写库本身仍是异步的，已提交标记之后写库失败或崩溃时，标记为凭据库原有内容作证（与此前相同，本 PR 不能消除）。
- **续记（2026-09-26，#642 评审 c0e92466 确认 opus:F1/F2、codex:F1/F2，两个根因）**：① 提交早于落库（opus:F1、codex:F1）：
  `client.adopt` 经 `SessionCredentialStore::mutate` 只把写库命令 `try_send` 入队并更新内存，真正的 `vault.set` 在后台 writer 中异步执行，
  上一版却在入队后立即把标记改写为已提交，注释「The session is stored」与事实不符。现在提交移出 `adopt_sign_in_response`，
  由 `adopt_replacing_with` 在 adopt 成功后、不持状态锁地等待现有的 `SessionCredentialStore::flush()`（writer 处理完此前所有写入后回报结果，
  上限 `SIGN_IN_SAVE_TIMEOUT` 5 秒），只有落库成功且标记仍归本次登录时才改写为已提交。② 提交失败被吞（opus:F2、codex:F2）：
  上一版改写失败只记日志、清掉内存待定状态并返回成功。现在落库失败或超时、或改写失败（重试一次后仍失败）都返回现有的
  `TONO_SIGN_IN_NOT_SAVED`（前端已映射为「无法在这台电脑上保存登录。请重新获取验证码后再试。」），标记保持待定，内存待定状态不清，
  下次启动按未登录处理（安全方向）。本进程保留已接纳的会话，不新增任何登出或释放防护的路径。登录前已有的已提交标记（`Existing`）不改写；
  其落库失败同样返回 `TONO_SIGN_IN_NOT_SAVED`，标记仍按原样为本机会话作证。
  启动时待定标记的实际去向（已核对，`restore.rs` 与加载路径本 PR 未改）：`data_dir_owns_vault_session` 答 `NotOwned` → 不载入令牌 →
  `restore_session` 的 `TokenProbe::NoToken`：保护状态未知时进入 Error、不释放；否则走 `close_account_with(Missing)`，
  执行 `client.logout()`，并在 Service 报告保护仍处于 Armed 时调用现有的 `release_for_account` 释放。这与 main 处理任何无归属会话
  （如卸载重装后凭据库残留的令牌）的路径完全相同，本 PR 没有新增释放；但它确实会释放已存的防护，评审所说「触发既有的自动登出和防护释放路径」属实。
  测试：新增 `tono::commands::account::lifecycle_tests::a_sign_in_whose_session_never_lands_in_the_vault_is_not_saved`
  （注入拒绝写入的凭据库，断言登录返回 `TONO_SIGN_IN_NOT_SAVED` 且下次启动的归属判定为 `NotOwned`）；红分支
  `wip/win-signin-marker-20260926-red4`（`1a907b0c`，基于 `573dcbea`，仅测试，windows-ci run 36216963614）。
  落库超时、改写失败的重试、被接管时的分支没有单元测试覆盖。MacBook 未运行 cargo，以 PR #642 的 windows-ci 为准。
  剩余限制更新：落库失败、超时或改写失败时，本进程仍以该账户登录，但下次启动需重新登录，并按上述无归属会话路径处理（含已存防护的释放）；
  超时后写入才落库时标记仍为待定，同样下次需重新登录。标记为已提交之后的换令牌写入失败，不在本 PR 范围内。
- **续记（2026-09-26，#642 评审 44d47166 确认 opus:F1 / codex:F2（major）、opus:F2、codex:F1（minor））**：上一条的「adopt 之后失败即返回
  `TONO_SIGN_IN_NOT_SAVED`」设计有误（协调方设计，已撤回）：返回错误时 `adopt_sign_in_response` 已接纳会话、丢弃目录、置为 Ready 并广播，
  调用方的 `?` 跳过首次目录/策略同步、周期任务与 SignInOk 审计，留下没有出口的半登录状态，前端又因 Ready 离开登录页，看不到重试提示（major）；
  换账户时已有已提交标记，新账户写库失败则库里仍是旧账户的令牌，已提交标记让下次启动静默恢复旧账户，与错误文案相反（opus:F2）；
  落库成功但改写两次失败时合法会话只剩待定标记（codex:F1）。现在：① 登录的标记步骤（仍在任何释放/丢弃之前）一律写入 `pending:<代次>`，
  已有已提交或旧格式标记时也改写（更严：换账户失败不得静默恢复上一账户，代价是重新登录）；写不进仍在释放/丢弃之前拒绝。
  登录失败时：标记原本不存在（`Created`）且仍是本次写的待定标记则删除；原本已有标记（`Existing`）则不恢复，保持待定，下次启动需重新登录。
  ② adopt 之后不再让登录失败，也不阻塞命令：正常走完成功路径（Ready、首次同步、周期任务、SignInOk 审计），另起后台任务
  `commit_marker_when_durable` 等待 `SessionCredentialStore::flush()`（每次上限 10 秒，最多 6 次，间隔从 5 秒起倍增，约 3 分钟内），
  落库成功且标记仍为 `pending:<本次代次>` 时才改写为已提交；每次失败记日志，始终不成功则标记保持待定，下次启动需重新登录（安全方向）。
  ③ 删除 adopt 之后的 `TONO_SIGN_IN_NOT_SAVED` 返回，该错误只剩 adopt 之前写标记失败的拒绝。标记归属改由文件内容 `pending:<代次>` 判定，
  内存中的 `TonoInner.sign_in_marker_pending` 已删除；`record_sign_in_marker` 不再需要 pending 参数。
  已有测试 `a_sign_in_whose_local_marker_cannot_be_written_is_refused` 的第三项随设计改为：已有标记时写不进同样拒绝，写入则为 `Existing`。
  启动时待定标记的去向不变（见上一条）：走 main 既有的无归属会话路径（NoToken：`client.logout()`，Service 报告 Armed 时释放已存防护）。
  测试：上一条的测试改名为 `tono::commands::account::lifecycle_tests::a_sign_in_whose_session_never_lands_in_the_vault_leaves_its_marker_pending`，
  并在前置条件中加入上一账户的已提交标记（换账户情形）：凭据库拒绝写入时登录返回成功，下次启动的归属判定为 `NotOwned`；红分支
  `wip/win-signin-marker-20260926-red5`（`008cfaba`，基于 `2809087b`，仅测试，windows-ci run 36217858913）。上一轮红分支 run 36216963614、
  36215718981 均以断言失败，`2809087b` 的 windows-ci 通过（已核对：run 36217064878、36217067192）。后台提交的重试、被新登录替换时的跳过、失败后保持待定没有单元测试覆盖。
  MacBook 未运行 cargo，以 PR #642 的 windows-ci 为准。
  剩余限制更新：换账户登录在 adopt 之前失败（释放失败、被取代、`client.adopt` 失败），上一账户的已提交标记已被改为待定且不恢复，
  本进程仍以上一账户运行，但下次启动需重新登录，并走上述无归属会话路径（含已存防护的释放）；后台提交在约 3 分钟内未成功（写库被拒或持续超时）
  或提交前进程退出，下次启动同样需重新登录。
- **续记（2026-09-26，#642 评审 c28a72f7 确认 codex:F2、opus:F1、opus:F3/codex:F1（均 minor）；opus:F2 已驳回，不处理）**：
  ① codex:F2：后台提交把标记「读不出」当成「已被新登录替换」并停止重试。现在 `holds_pending_marker` 返回 `io::Result<bool>`：
  读到其他内容或文件不存在才是「不归本次登录」，读错误返回错误，后台提交照常重试。
  ② opus:F1：换账户登录在 `client.adopt` 之前失败（释放被拒、被取代）时，上一账户的已提交标记已改写为待定，撤销又对 `Existing` 直接返回，
  而凭据库从未被动过、本进程仍是上一账户，下次启动却被登出。现在标记步骤记下原内容（`SignInMarker::Existing { previous }`），
  登录未存下会话时，只要文件仍是本次的 `pending:<代次>`，就原子写回原内容（原本不存在则删除；原内容读不出则保持待定）。
  `adopted` 出错即表示会话没有进入凭据库（`client.adopt` 在入队写库之前失败），所以 `client.adopt` 失败也一并写回；
  `client.adopt` 成功之后的保持待定不变。`docs/DECISIONS.md` 的暂定条目同步改为「只有新会话已交给凭据库之后才不恢复」。
  ③ opus:F3/codex:F1：后台约 3 分钟放弃后本进程不再尝试。单次尝试抽成 `commit_marker_if_durable`（先读标记，只有仍是本次待定内容才 flush 并提交），
  账户的周期同步（`catalog_sync` 每 300 秒一轮，不另设定时器）在每轮末尾以当前登录代次调用一次；已提交时只多一次小文件读取。
  已有测试 `a_sign_in_whose_local_marker_cannot_be_written_is_refused` 随 `SignInMarker` 改为带原内容的形式调整参数，断言含义不变。
  测试：新增 `tono::commands::account::lifecycle_tests::a_switch_refused_before_adopting_keeps_the_previous_account_marker`
  （上一账户有已提交标记且隧道在启动，释放被拒，断言登录失败且下次启动仍为 `Owned`）；红分支
  `wip/win-signin-marker-20260926-red6`（`e99034cd`，基于 `6913b366`，仅测试，windows-ci run 36218716073）。上一轮红分支 run 36217858913
  以断言失败（542 passed，1 failed），`6913b366` 的 windows-ci run 36218076446 通过（均已核对）。读错误重试与周期同步里的提交没有单元测试覆盖。
  MacBook 未运行 cargo，以 PR #642 的 windows-ci 为准。
  剩余限制更新：换账户登录只有在 `client.adopt` 已把新会话交给凭据库之后失败落库，才会让下次启动需重新登录；此前失败则写回原标记。
  连锁情形（两次换账户登录重叠且都在 adopt 之前失败）时，后失败者写回的是先失败者的待定标记，下次启动需重新登录（安全方向）。
- **续记（2026-09-26，#642 评审 e812b461 确认 opus:F1/F2、codex:F1/F2（均 minor））**：前几轮逐条修交错，没有修到根因：进程内没有「谁为某个待定标记负责」的记录。
  提交路径的结束条件是「文件此刻不是本次的 `pending:<代次>`」或周期同步的登录代次，撤销写回的是本次登录读到的紧邻内容。
  ① opus:F1：已接纳、尚未提交的 g1 的后台提交在 g2 的待定期间读到内容不符即结束，周期同步又因代次改变退出；g2 在 adopt 前失败写回 `pending:<g1>` 后无人提交。
  ② opus:F2：周期同步兜底对暂停账户不启动，转为暂停或代次改变即退出。③ codex:F1：兜底绑定周期任务的登录代次，退出登录被拒后代次改变，原标记永不提交。
  ④ codex:F2：两次重叠换账户都在 adopt 前失败，后撤销者写回先失败者的 `pending:<g1>`，未动过的旧账户失去归属。
  现在：进程内的标记归属集中到 `TonoInner.session_marker`（`credentials::SessionMarker`，只在状态锁内改动），只有两个槽：`in_flight`（尚未存下会话的登录代次，及其撤销时写回的内容）
  和 `awaiting_commit`（已接纳、会话尚未确认落库的登录代次）。写标记（`begin`，仍在任何释放/丢弃之前，写不进仍拒绝且不改动记录）：
  取代在途登录时继承它的写回内容（被取代者的代次已失效，不可能再 adopt）；否则有待提交的登录时写回它的 `pending:<h>`；否则写回文件原内容（不存在则删除，读不出则保持待定）。
  adopt 成功（`adopted`，与 `client.adopt` 同一锁段）：清空在途，待提交改为本次。撤销（`undo`）：只有仍是在途登录，且文件仍是本次的 `pending:<代次>`（比较并交换）才写回。
  提交任务 `commit_marker_when_durable`：每个接纳的登录一个，只在已提交或更新的登录被接纳（`awaits_commit` 为假）时结束，与文件当时的内容、周期同步、账户状态、登录代次都无关；
  每次等待 `flush()`（上限 10 秒），失败后间隔从 5 秒起倍增、封顶 300 秒，一直重试到进程退出。flush 成功后提交（`commit`）：有在途登录时不写文件，只把它的写回内容改为已提交；
  否则文件为待定就改写为已提交。周期同步里的提交兜底与 `commit_marker_if_durable` 删除，`catalog_sync.rs` 与 main 相同；`record_sign_in_marker`、`holds_pending_marker` 改为模块私有，
  标记只经 `SessionMarker` 写入（load 的一次性升级只写不存在的标记，未改）。状态、写入方、事件与不变量见 PR 描述「Marker state machine」。
  四条为何不再可能：① g1 的提交任务不看文件内容决定是否结束；g2 写回 `pending:<g1>` 只在 g1 仍待提交（提交任务仍在）时发生，g1 在 g2 在途时提交则 g2 写回已提交内容。
  ② / ③ 提交任务与周期同步、暂停状态、登录代次无关，退出登录（成功或被拒）不改动 `session_marker`。④ 后来的在途登录继承 A 的已提交内容，先失败者已不是在途登录，撤销为空操作；两种撤销顺序都写回 A 的标记。
  前几轮修复逐条核对仍成立：写不进标记在任何释放/丢弃之前拒绝（d9ba823a）；被取代的登录按「仍是在途登录」撤销，与代次无关（ad7be8fc）；标记文件自带待定/已提交，崩溃后待定即 `NotOwned`（147a047f）；
  只在 flush 确认落库后提交（c0e92466）；adopt 之后不让登录失败，已有已提交标记也先改写为待定（44d47166）；读错误照常重试（提交任务的结束只看内存中的 `awaiting_commit`），adopt 前失败写回原标记（c28a72f7）。
  测试：新增 `tono::commands::account::lifecycle_tests::overlapping_switches_refused_before_adopting_keep_the_previous_account_marker`
  （A 有已提交标记且隧道在启动；B 等待释放期间 C 开始并同样等待释放；服务先拒绝 B、再拒绝 C；断言两次都失败且下次启动仍为 `Owned`）；红分支
  `wip/win-signin-marker-20260926-red7`（`5de593c4`，基于 `2535e6a2`，仅测试，windows-ci run 36222576251 以断言失败：544 passed，1 failed，得到 `NotOwned` 而非 `Owned`）。上一轮红分支 run 36218716073 以断言失败（543 passed，1 failed），
  `2535e6a2` 的 windows-ci run 36218826226 通过（均已核对）。提交任务的重试、在途期间提交改写写回内容、撤销写回失败没有单元测试覆盖。
  MacBook 未运行 cargo（只用 rustfmt 解析过改动的 Rust 文件），以 PR #642 的 windows-ci 为准。
  剩余限制更新：提交前进程退出（含登录在途期间），待定标记下次启动按无归属处理（需重新登录，走上文的无归属会话路径）；撤销写回失败只记日志，
  此时若有待提交的登录，其提交会把该待定标记改为已提交，否则下次启动需重新登录；退出登录成功后提交任务仍可能把标记改为已提交（凭据库已无令牌，与 main 退出登录后保留标记相同）；
  凭据库持续拒绝写入时提交任务每 300 秒重试一次，直到进程退出。
- **续记（2026-09-26，#642 评审 fc199962 确认 codex:F1、opus:F1（均 minor））**：① codex:F1：有换账户登录在途时，`commit` 只把在途登录的写回内容改为已提交，
  随即清空 `awaiting_commit`，唯一的提交任务结束；在途登录撤销时写回失败只记日志，已确认落库的会话就永远留下待定标记。现在提交责任只在文件真正是已提交之后才释放：
  `SessionMarker::commit` 返回 `io::Result<bool>`，有在途登录时仍改写其写回内容，但保留 `awaiting_commit` 并返回 `Ok(false)`；提交任务稍后再试，
  文件已是已提交（写回成功）则结束，仍是待定（写回失败）则改写为已提交；更新的登录被接纳则结束。
  ② opus:F1：上一版提交任务每次尝试都以 10 秒超时取消 `flush()`，而 `VaultCommand::Flush` 已进入容量 64 的写入队列；凭据库卡住时每次重试多留一条，
  约五小时后队列满，`mutate` 的 `try_send` 失败，轮换的 refresh token 进不了内存；也违背 `flush` 「调用方超时不得取消等待者」的约定。
  现在提交任务同一时间只有一个 flush：固定（pin）同一个 flush future 反复等待，超时只记日志（间隔 5 秒起倍增、封顶 300 秒），绝不重发；
  只有 flush 返回错误（已有应答）后才隔一段时间重发。确认落库后进入第二阶段，只重试文件提交，不再 flush。`SIGN_IN_SAVE_TIMEOUT` 删除。
  上一条记下的四条（e812b461）与此前各轮修复逐条核对仍成立：提交任务的结束条件仍只看内存中的 `awaiting_commit`（不看文件内容、周期同步、账户状态、登录代次），
  撤销仍是比较并交换且由后来的在途登录继承写回内容。
  测试（两条行为各一条）：新增 `tono::credentials::tests::a_durable_session_keeps_its_commit_when_a_refused_switch_cannot_put_its_marker_back`
  （登录 1 已接纳、换账户 2 在途时 1 确认落库；2 被拒且写回因暂存路径被占而失败一次；1 的提交任务再试；断言下次启动为 `Owned`），
  以及 `tono::commands::account::lifecycle_tests::a_hung_vault_never_fills_the_credential_queue_with_marker_commit_retries`
  （暂停时钟；凭据库在登录写入上挂起，推进 12 小时；断言轮换的 refresh token 仍能入队）；红分支
  `wip/win-signin-marker-20260926-red8`（`9383fa1b`，基于 `69f6695c`，仅测试，windows-ci run 36224307467 两条均以断言失败：545 passed，2 failed；一条得到 `NotOwned`，一条为 `credential persistence queue full or closed`）。
  上一轮红分支 run 36222576251 以断言失败，`69f6695c` 的 windows-ci run 36223207052 通过（545 passed，均已核对）。
  MacBook 未运行 cargo（只用 rustfmt 解析过改动的 Rust 文件），以 PR #642 的 windows-ci 为准。
  剩余限制更新：凭据库一直挂起时，每个已接纳登录的提交任务在队列里各占一条 flush（随登录次数而非时间增长），挂起期间标记保持待定；
  在途登录撤销写回失败后、提交任务下一次尝试之前进程退出，下次启动需重新登录。
