# Tono 内部更新记录

这份总账回答「内部这次更新了什么、修了什么、验证到哪里、哪个包包含它」。
它是变更入口，不取代 [SHIP_PLAN](SHIP_PLAN.md)、[运维计划](ops/plan-2026-09-11.md)
或各项原始验收记录。源码修复、合入 main、生成候选、实机通过、客户发布是不同状态。

## 维护规则（所有者要求，2026-09-23）

- 每次内部代码、配置、构建/测试工具或发布验收状态的有效交付，在同一个 PR 更新本页。
  新一轮记录放在旧记录前面；同一轮后续结果加带日期的续记，不覆盖原来的失败或未知。
- 分开写 **缺陷修复**、**新增/优化**、**工程与测试修正**。同一根因的续修、移植、测试和
  cherry-pick 不重复算新 bug；编译失败、fixture 错误不冒充客户运行时故障。
- 写清准确源码、分支/PR、归属门或 ops 任务；通过、失败、跳过、未执行和沿用证据分开。
  命令、主机、实际 CI checkout 与日志链接可引用已有详细报告，不复制多套验收事实。
- 内部包必须记版本、源码、标签/下载入口、包摘要、签名状态及包含/不包含的后续修复。
  没有新包就明确「仅源码，无新候选」；同版本号不表示相同字节。
- 纯咨询、只读审查无新成果、无行为影响的排版/拼写改动不制造空条目。文档整理不重跑
  产品测试，不改写旧证据为新 SHA 的测试结果，不记密钥、账号或原始诊断数据。
- 更新记录不是 merge、签名、部署、设备操作或推进客户更新源的授权。

### 后续条目模板

```text
## YYYY-MM-DD · 内部更新名称
- 归属：G1/G2/G3/G4 或已有 ops 任务；影响平台/模块。
- 来源：基线 → 实现源码 SHA（链接）；分支、PR；是否已合 main。
- 缺陷修复：原失败场景 → 改后行为；关联 Issue/回归或详细记录。
- 新增/优化：新增能力、保留行为与自行选择的边界；没有则写无。
- 工程与测试：编译/fixture/CI 修正，与产品缺陷分开。
- 验证：准确源码/checkout、主机、命令、决定性输出或证据链接；列未执行/沿用项。
- 候选/发布：无新包，或标签、包源码、下载入口、SHA-256、签名及发布状态。
- 剩余限制：尚未解决的问题/Issue、实机或外部依赖；不能声称什么。
```

## 2026-09-25 · Windows：更新生命周期审查跟进（恢复标记、epoch 准入、ARP 版本、安装器租约）

- **归属/来源**：G3 发出去还能再发（更新事务与手动安装器）；TW-anthropic-4 兼及 G1 连接生命周期。Issue #602
  （合并列车 #572 审查跟进，总账 TW-*）。基线 origin/main f5c31d58；分支 `fix/win-update-lifecycle-followups-20260925`
  （红分支 `wip/win-update-lifecycle-followups-20260925-red`）；PR [#626](https://github.com/raydocs/tono/pull/626)；未合 main。`apps/windows/service`
  （`bin/install_service/update_executor.rs`、`core/update.rs`、`core/update/security.rs`、`core/server/handlers.rs`、
  `core/windows_kill_switch.rs` 注释、`tests/test_owner_lifecycle.rs`）、`apps/windows/app`（`installer.nsi`、
  `scripts/windows-packaging.test.mjs`）、`docs/UPDATE_PROTOCOL_V1.md`。
- **缺陷修复**：
  - TW-OpenAI-2 = TW-G-1（及 TW-anthropic-3 文档）：恢复在停 Service 之前读不出已安装组件或计划成员时直接退出，
    `Consumed` 原样悬挂；而 Disconnect 只能在证明原件完整后退役 `Uncertain`/`RolledBack`。现在这一出口把 `Consumed`
    写成 `Uncertain`，`Replaced`（已登记后继）与 `Uncertain` 不变，不停 Service、不动文件，下次恢复重新分类。
    `UPDATE_PROTOCOL_V1.md` 原写「留下 `Uncertain`」与代码不符，已按此改写。
  - TW-anthropic-4：更新路由原在 owner 认证后、`update::request` 的准入前就推进全局 attempt epoch，任何本地已认证
    调用方发一个未签名 Prepare 就能让他人在途 PrepareCoreStart 被判 `StaleReleaseEpoch`。现在推进移入
    `update::request`，在 App 映像、无手动安装/修复、待决事务属同一 owner、签名校验都通过后才推进，仍在同一
    lifecycle 锁内；准入后的拒绝（重放/降级、保护状态、活动 owner 等）照旧推进，保留 H9-F3 语义。
  - TW-anthropic-5：核对 main 后确认 eef9d2ce（#508）只加了降级阻断，没有任何原生路径写 ARP `DisplayVersion`，
    原生更新后降级检查比较的是旧版本。现在目标成为已定安装时写入：Service 在提交持久化后写（失败只告警，不撤销
    提交）；执行器提交清理在退役开机任务前再写一次，且只在已安装身份仍是该目标时写（避免提交后手动装了别的版本、
    开机重试把旧版本写回），失败保留任务；「已安装已释放」归档前由 Service 写，失败保持记录待决。回滚与其它归档
    从未写过，原版本保持。待决期间手动安装器与卸载器被 gate 拦住，读不到未定版本。
  - TW-anthropic-6 = TW-G-2：`.onInit` 取得手动租约后，`invalid_existing_version`、`legacy_wix_blocked` 与旧自定义
    位置 `legacyLocationAbort` 三个无修改退出现在先 `Call ReleaseManualLease`。语言选择框取消在
    `MUI_LANGDLL_DISPLAY` 内部 Abort，无处交还租约，因此把语言选择移到 gate 之前（gate 的对话框因此也用所选语言）。
  - 未修：TW-OpenAI-1 = TW-anthropic-2（DHCPv4 放行限定 Dhcp 服务 SID）。需 WFP 引擎新增 `ALE_USER_ID` 安全描述符
    条件；Dhcp 客户端流量（含取得地址前的 DISCOVER、服务 SID 类型可配置）是否带该 SID 只能实机确认，错配会在保护
    期间丢 DHCP 租约，比这条 P3 加固的风险更大。保持 open。
- **新增/优化**：无。
- **工程与测试**：四条回归，红分支只含测试与骨架（`classify_before_stop` 原样传播错误、`finish_committed` 忽略版本
  记录），预期以断言失败：`update_executor::tests::update_recovery_marks_a_consumed_attempt_uncertain_when_it_cannot_classify`、
  `update_executor::tests::update_commit_records_the_installed_version_before_retiring_the_task`、
  `test_owner_lifecycle::update_prepare_refused_at_admission_does_not_supersede_a_connect_attempt`、
  `windows-packaging.test.mjs`「every installer init exit after the manual gate hands the lease back」。
  第三条替换 H9-F3 的 `late_prepare_core_start_superseded_by_update_takeover_cannot_stop_the_successor_core`：
  那条的前提（未准入的 Prepare 也推进 epoch）正是本次报告的缺陷；CI 无已安装 App 与固定更新公钥，构造不出已准入
  Prepare，H9-F3 正向路径改由源码保证。`finish_committed` 增加版本记录参数，原有测试随签名更新。
- **验证**：本机未编译或运行 Rust（执行位置规则）；编译与 `cargo test` 以 PR CI `windows-2025` 为准。本机：
  `node --test` 跑 `apps/windows/app` 六个脚本测试文件 109/109 通过；新 node 测试在红分支状态以断言失败
  （the language dialog must precede the gate）；`rustfmt --check` 改动区无差异（文件里原有的格式差异未动）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：执行器取自升级前已安装版本，TW-OpenAI-2 与执行器侧 ARP 重试只对从含本改动的版本发起的升级生效；
  提交与「已安装已释放」的 ARP 写入由新 Service 执行，首次升级到本版即生效。提交时 ARP 写入失败且执行器 120 s
  等待已结束时，版本要到下次开机才补写。卸载器 `un.onInit` 的 `MUI_UNGETLANGUAGE` 在当前用户无记忆语言时可能
  弹出语言框，其取消同样不会交还租约（按 MUI2 源码推断，未核实、未处理）。
  DHCP SID 未做（见上）。均未实机。

## 2026-09-25 · exit-agent：停用轮保留最后计数；hy2 出错不再跳过 Xray 吊销

- **归属/来源**：ops 任务（出口计量与吊销，#563 合并车审查后续）；Issue #600 的 TF-opus-4 与 TF-opus-8（其余条目仍开）。
  基线 origin/main 13983688；分支 `fix/exit-agent-disable-counters-hy2-20260925`（红分支 `wip/exit-agent-disable-counters-hy2-20260925-red`）；
  PR [#624](https://github.com/raydocs/tono/pull/624)；未合 main。只改 `services/exit-agent/reconcile_and_report.py`、其测试与 README。
- **缺陷修复**：TF-opus-4：控制面答复 `EXIT_NODE_DISABLED` 的停用轮只撤客户端、不读计数，上次正常轮到停机之间的流量丢失
  （1000→1500 仍记 1000）。改后：撤除完成（或失败）后再尽力读一次计数（同一 Xray 进程代际），折入本地状态总量，由下一次可上报的轮次报出；
  计数读取或状态写入失败只追加到拒绝说明里，永不阻挡或替换撤除结果。TF-opus-8：hy2 目录权限不对或 allowlist 缺失时在 Xray 对账前就抛出，
  该轮 Xray 吊销 0、计数 0、无 ACK。改后：先记下 hy2 错误，照常做 Xray 对账与计数读取并存入状态，再以 hy2 错误拒绝本轮，不发 roster/计量 ACK、
  不上报用量，控制面仍视该节点未收敛。停用轮与 hy2 失败轮与控制面不可达轮共用新提取的 `keep_usage_locally`（行为同原不可达轮）。
  续：adca10ac 把 hy2 的文件系统 `OSError` 也按 hy2 失败处理；增量审查（jev-route f4e3ecab，Opus 发现、Codex 核实）指出停用轮
  `withdraw_disabled_node` 仍只接 `Refusal`，`OSError` 会跳过 Xray 撤除，已同样处理（仍以 hy2 错误拒绝该轮）。
- **新增/优化**：无。
- **工程与测试**：两条回归：`test_a_disabled_round_still_folds_the_final_counter_sample`（新增）；
  `test_a_failed_hy2_publish_still_revokes_xray_and_keeps_usage_but_is_never_acknowledged` 替换原
  `test_a_failed_hy2_publish_is_never_acknowledged`（原测试断言「hy2 失败不做 Xray 对账、不写状态」，正是本缺陷）；`run_round` 增加 `counters` 参数；
  `test_a_hy2_filesystem_error_still_withdraws_xray_clients`（停用轮，修复前断言失败）。
- **验证**：本机 `cd services/exit-agent && python3 -m pytest -q`：红分支两条新测试均以断言失败（2 failed, 90 passed）；修复分支 92 passed；停用轮续修后 93 passed（新测试在修复前失败）。
  `python3 services/exit-agent/test_reconcile_and_report.py`（CI 同命令）续修后（c82ac4aa）93 OK。未在任何节点运行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：**节点需部署新 agent 才生效（运维步骤，本 PR 未做，未 SSH、未部署）**。停用轮的计数由下一次能上报的轮次报出；
  节点被永久退役则这段用量仍不会上报。#600 的 TF-opus-3/5/6/7 未处理。

## 2026-09-25 · 两端：系统时钟错误导致证书日期校验失败时点名时钟

- **归属/来源**：G2 连不上有下一手（失败要说清原因）；Issue #588（总账 H21-O-F9）。基线 origin/main 630d9e66（含 #622）；
  分支 `fix/clock-skew-classification-20260925`（红分支 `wip/clock-skew-classification-20260925-red`）；PR 待开；未合 main。
  macOS `ControlPlanePath.swift`、`TonoAPIClient.swift`、`ProtectedConnectivity.swift`、`ProtectedConnectivityVerifier.swift`、
  `AccountSession+Auth.swift`、`Localizable.xcstrings`；Windows `tono/transport.rs`、`tono/commands/diagnostics.rs`、
  `services/tono.ts`、en/zh `tono.json` 与生成的 i18n 类型。
- **缺陷修复**：#588：时钟偏差大时所有证书都显示过期或尚未生效，而保护期间 NTP 被拦，用户只看到「无法连接 Tono」或出口不可达，
  不知道该校时。macOS：新增 `CertificateClock`，识别 URLSession 的 `NSURLErrorServerCertificateHasBadDate`/`NotYetValid`
  及其背后的 Secure Transport/`SecTrust` 状态（pinned 路径的 `NWError.tls`）；控制面客户端改抛 `APIError.clockSkew`，pinned 路径
  证书日期握手失败报 `serverCertificateHasBadDate`；连接后探测新增 `.clock` 类别，任一探测为 `.clock` 时保留原失败码（遥测不变），
  只把用户文案换成时钟提示（mixed 探测已成功时不换：它经同一出口完成了默认证书校验，说明时钟没问题）。控制面在系统 DNS 与 pinned
  两条路径间保留证书日期证据：任一路径因证书日期失败且没有路径答复时，按时钟错误报告。Windows：传输层在 rustls `Expired`/`NotValidYet`（webpki 或平台校验器）错误链上加 `TONO_CLOCK_SKEW`
  标记，`auth_error` 映射为该前缀；前端把它排在最前，出现在任何界面错误里都显示时钟文案。
  准入选择：时钟错误仍是「收到状态行之前失败」，Windows 保持原 `TransportKind`（重试与回退规则不变），macOS `isUnreachable`
  视为不可达，离线授权照常判定；从不当作会话拒绝（#582 sink 不变）。未新增任何 PF/WFP NTP 放行，保护不放松。
- **新增/优化**：无。
- **工程与测试**：两条回归，各平台一条。macOS `AccountSessionRequestTests.testACertificateTheClockCannotDateNamesTheMacClock`
  （登录 POST 遇 `serverCertificateHasBadDate`，错误文案须含 date and time）；Windows `commands::diagnostics::tests::
  a_certificate_the_clock_cannot_date_is_named_as_the_clock`（hyper-rustls 形状的 io::Error 链包 rustls `Expired`，
  `auth_error` 须以 `TONO_CLOCK_SKEW: ` 开头）。红分支只含两条测试与 Windows `mark_clock_skew` 原样返回的骨架，预期以断言失败。
- **验证**：未在本机编译或运行 Swift/Rust（执行位置规则）；编译、XCTest、`cargo test` 以 PR CI `macos-26`/`windows-2025` 为准。
  本机仅运行 `node scripts/generate-i18n-keys.mjs`（生成类型只多出新键）与 locale/xcstrings JSON 解析检查。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：Network.framework 对证书日期失败实际给出的 `NWError.tls` 状态（-9814/-9815/-67818/-67819）未实机确认；
  若系统报为通用信任失败则仍显示原文案。macOS 在离线授权下进入 Ready 时不单独提示时钟（仅连接后探测与无授权失败时提示）。
  保护期间仍无法自动校时（产品决定，另议）。
  Windows 连接后探测未改。

## 2026-09-25 · macOS：控制面请求系统 DNS 失败时改走 pinned 地址

- **归属/来源**：G2 连不上有下一手（控制面域名被污染时仍能登录、恢复）；Issue #584（总账 H21-O-F3 = H21-C-F1）。
  `apps/macos/Tono/Services/ControlPlanePath.swift`（新）、`TonoAPIClient.swift`、`KillSwitchService.swift`（仅
  `configuredBootstrapPins` 改为 internal）。基线 origin/main 8fb73d84；分支 `fix/macos-control-plane-fallback-20260925`
  （红分支 `wip/macos-control-plane-fallback-20260925-red`）；PR [#622](https://github.com/raydocs/tono/pull/622)；未合 main。
- **缺陷修复**：#584：`TonoAPIClient` 只用 URLSession 按域名访问控制面，内置 pinned 地址只用于 PF。域名被污染时首次登录、
  干净退出后的每次启动和每次恢复都只显示通用的「无法连接 Tono」。现在每次交换先走原有的系统 DNS URLSession（健康网络行为不变，
  已连接时也照旧先走系统 DNS）；只有它在收到状态行前传输失败、且 `shouldRetry` 允许重放（GET 任何失败；POST/DELETE 仅限未建立连接）
  时，才改走 pinned：Network.framework TLS 直连 helper PF 为 API 主机放行的地址（编译进来的 `TonoAPIBootstrapAddresses`，再加受保护解析学到的地址），
  SNI 为真实主机名，证书仍由系统默认信任评估按该主机名校验，没有自定义校验块；不走代理；HTTP/1.1 `Connection: close`；
  TCP+TLS 共 10 s、按地址平分；响应上限 2 MiB。收到状态行即是回答，不会在另一条路径重发；pinned 路径状态行一完整即记下，
  其后头部/正文中断、超时或请求被取消，仍按该状态交给 #582 判定（非 2xx 按状态报错，不当作不可达）。pinned 在系统 DNS 失败后
  完整答复时，后续请求先走 pinned（对应 Windows 学到的首选），该首选尝试失败、取消或正文失败即恢复系统 DNS 在前（仅进程内存）。新 HTTP/1.1 客户端
  未经实机验证，因此只作回退、不作主路径。#582 判定、#587 无代理、凭据代际守卫不变；成功/拒绝审计事件增加 `path`，
  换路径时记 `control_plane_path_failed`。
- **新增/优化**：无。
- **工程与测试**：一条回归：`AccountSessionRequestTests.testASystemResolverThatFailsAtConnectHandsTheRequestToThePinnedAddressesOnce`
  （系统 DNS 路径在连接阶段失败，登录 POST 由 pinned 桩恰好收到一次，系统路径只试一次）。红分支只含该测试、
  `ControlPlanePath`/`ControlPlaneAnswer` 骨架和未使用的 `pinnedPath` 参数，预期以断言失败（无回退：拿不到 challenge，
  系统路径被重试 2 次，pinned 进入 0 次）。
- **验证**：未在本机编译或运行（执行位置规则：MacBook 不跑 xcodebuild/swift）；编译与 XCTest 以 PR CI `macos-26` 为准，红/绿以 CI 为准。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：系统 DNS 连到被污染地址而连接超时，URLSession 报 `NSURLErrorTimedOut`，按 `shouldRetry` 规则 POST 不回退
  （GET 会回退；GET 经 pinned 答复后首选翻转，此后 POST 也先走 pinned）；每次回退前要先等系统路径失败（最长 30 s 空闲超时）。
  未实现备用端口——helper PF 只放行控制面 TCP 443，加端口需新 PF 放行，本 PR 不动。pinned TLS 直连未在实机或真实控制面验证。

## 2026-09-25 · 两端：验证码错误/过期不再显示「会话过期」；收不到验证码时给求助出口

- **归属/来源**：G2 连不上有下一手（登录失败说清原因、给下一步）；Issue #595（总账 H20-C-F6）、#596（H22-C-F2）。
  Windows `apps/windows/crates/tono-core/src/auth.rs`、`app/src-tauri/src/tono/commands/diagnostics.rs`、
  `app/src/services/tono.ts`、`app/src/pages/tono/login.tsx`、`app/src/locales/{zh,en}/tono.json` 与生成的 i18n 类型；
  macOS `Tono/Services/TonoAPIClient.swift`、`Tono/Views/LoginView.swift`、`Tono/Views/AccountGateSupport.swift`、
  `Tono/Localizable.xcstrings`。基线 origin/main 52e67294；分支 `fix/signin-code-errors-and-help-20260925`
  （红分支 `wip/signin-code-errors-and-help-20260925-red`）；PR [#620](https://github.com/raydocs/tono/pull/620)；未合 main。
- **缺陷修复**：
  - #595：Worker 对错误或过期的验证码返回 401 `INVALID_OR_EXPIRED_CODE`，两端都走通用 401，显示成「会话过期」
    （Windows 审计日志与错误串、macOS 登录页）。现在两端只把带 `INVALID_OR_EXPIRED_CODE` 错误码的 401 改成专门错误
    （Windows 在 `map_status`，macOS 在 `sendData` 读错误码处；审查发现 verify 在验证码已消费后还可能回普通 401
    `AUTHENTICATION_FAILED`，不能一概当作验证码错误）：Windows `ApiError::InvalidOrExpiredCode` → `TONO_AUTH_INVALID_CODE` →
    「验证码错误或已过期，请重新获取。」；macOS `APIError.invalidOrExpiredCode`，同样文案。带令牌请求的 401
    （刷新、重放、#582 的 `SessionUse`/`SessionVerdict` 判定）不变；登录端点仍是 `SessionUse::None` / `.noSession`，不参与判定。
  - #596：`/auth/email/start` 对任何地址都回 202，投递失败按设计静默，验证码没到时两端都没有求助出口。现在验证码页等满
    60 秒（Windows 与「重新发送」解锁同时；macOS 按每个验证码单独计时，重发即重新计时）显示「还没收到邮件？」，并复用已有
    求助动作：Windows `SupportContact`（复制信息给客服；已有错误自带求助时不重复）；macOS 新的
    `SignInCodeNotReceivedHint`，含「复制详情」（版本、构建号、邮箱，不含验证码或 challenge）与已有的「在访达中显示诊断日志」。
- **新增/优化**：无。
- **工程与测试**：两条回归，各一：tono-core `verify_reports_a_refused_code_as_a_code_error_not_an_expired_session`；
  `login.test.tsx` 的 `offers support once the code has had a minute to arrive`（`SupportContact` 测试桩改为渲染标记）。
  红分支只含两条测试和 `InvalidOrExpiredCode` 变体骨架；vitest 在红提交上以断言失败（`expected null not to be null`）。
- **验证**：本机（链接主工作树已有 node_modules，未安装）Windows 前端 `vitest run` 38 个文件 291 条通过；`tsc --noEmit`、
  改动文件的 eslint 与 biome 均无问题。未跑 cargo 与 macOS 构建/测试（执行位置规则），以 PR CI 为准；Rust 测试的红/绿以 CI 为准。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：macOS 两处改动没有单独的 XCTest（本单元按 Issue 各一条）；菜单栏（`MenuBarView.swift`）未加求助入口。未在实机复现。

## 2026-09-25 · macOS：浏览器加密 DNS 冲突与拒绝管理员授权改为提示用户操作

- **归属/来源**：G2 连不上有下一手（失败看得到可执行的原因）；Issue #591（总账 H20-C-F2）、#592（H20-C-F3）。
  `apps/macos/Tono/Services/AppState+Connect.swift`、`ProtectedConnectivity.swift`、`ProtectedDNSProbe.swift`、
  `Localizable.xcstrings`。基线 origin/main 52e67294（含 #617）；分支 `fix/macos-browser-dns-and-helper-denied-20260925`
  （红分支 `wip/macos-browser-dns-and-helper-denied-20260925-red`）；PR [#619](https://github.com/raydocs/tono/pull/619)；未合 main。
- **缺陷修复**：
  - #591：住宅路由连接时浏览器 Secure DNS 扫描不通过，抛出的专用文案被 catch 丢弃，界面只显示
    `PROTECTED_DNS_NOT_READY` 的通用「稍候再重连」；抛出的 `CoreControllerError.protectionFailed` 也不在
    `failureRequiresUserAction` 中，自动重试一直跑到三次暂停。现在分类失败的 `userMessage` 使用扫描自身的步骤文案
    （代码仍为 `PROTECTED_DNS_NOT_READY`），连接路径改抛 `BrowserDNSDiagnostics.ConflictError`，按需用户操作处理：
    立即暂停自动重试，PF 保持，只有 Retry now 解除。连接后的健康复查路径未改（原本已显示专用文案）。
  - #592：`prepareHelper()` 的所有错误（除另一账户外）都被分类为 `HELPER_PROTOCOL_MISMATCH`，拒绝管理员弹窗后显示
    「网络组件与这份 Tono 不匹配，请修复」。现在 `HelperInstallError.userDenied`（拒绝或弹窗超时）归为新的仅 macOS
    代码 `HELPER_AUTHORIZATION_DENIED`，文案「Tono 需要你的管理员批准才能保护连接——请再次点按「连接」并批准。」
    （已加 zh-Hans）。重试行为不变：该错误原本就在 `failureRequiresUserAction` 中。
- **新增/优化**：无。
- **工程与测试**：两条回归，各一：`ProtectedConnectivityTests.testBrowserSecureDNSConflictShowsItsStepsAndWaitsForTheUser`、
  `HelperBoundAccountTests.testDeclinedAdministratorPromptIsNotAHelperMismatch`。红分支只含测试与最小骨架
  （错误类型、保持旧分类的辅助函数）。
- **验证**：本机未编译、未跑测试（执行位置规则）；以 PR 的 `macos-26` CI 为准。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未实机复现；运维台 `copy/customers.ts` 的失败代码文案表没有新代码（与其他 helper 代码一样走回退）。

## 2026-09-25 · Windows：检查更新失败不再报「已是最新版」；节点刷新失败显示原因

- **归属/来源**：G2 连不上有下一手（失败看得到原因）；Issue #589（总账 H21-C-F3）、#590（H20-C-F1）。
  `apps/windows/app/src/services/query-client.ts`、`src/pages/settings.tsx`、`src/pages/tono/servers.tsx`、
  `src/locales/{zh,en}/tono.json` 与生成的 i18n 类型。基线 origin/main ef6d09db；分支
  `fix/win-update-check-catalog-error-20260925`（红分支 `wip/win-update-check-catalog-error-20260925-red`）；
  PR [#618](https://github.com/raydocs/tono/pull/618)；未合 main。
- **缺陷修复**：
  - #589：SWR 的 `mutate()` 在请求失败时不抛错，而是返回缓存数据（空缓存即 `undefined`），设置页因此把失败的
    「检查更新」显示成「已是最新版」，有旧结果时还会打开更新对话框。现在 `refetch()` 额外返回本次重新验证写入
    SWR 缓存的 `error`；设置页遇到错误显示新文案 `checkFailed`（「检查更新失败。请检查网络连接后重试。」）。
    其他只读 `data` 的调用方不变。
  - #590：节点页「刷新」失败时 `formatTonoActionError` 丢掉 `detail`，只剩「出了点问题。详情见下方」却没有详情。
    现在刷新区在「最近一次刷新失败：…」下方显示 Rust 侧已有的原因（`catalog_sync_error` / 命令返回的错误串，
    与现有 UI 下发的是同一串，不含 bearer 令牌）。同步失败取自目录状态，之后同步成功即消失；同步之前就被拒
    （未登录、账号切换抢占）的错误在本页保留。该失败不再重复出现在底部的选择错误框。
- **新增/优化**：无。
- **工程与测试**：两条回归，各一：`reports a failed refetch instead of resolving with the cached data`
  （`src/services/query-client.test.tsx`）、`shows the recorded cause under a failed catalog refresh`
  （`src/pages/tono/servers.test.tsx`，测试桩补 `tonoRefreshCatalog`）。两条在红分支上均以断言失败。
- **验证**：本机（链接主工作树已有 node_modules，未安装）`npm test` 38 个文件 290 条通过；`npm run typecheck`、
  改动文件的 eslint 与 biome 均无问题；`node scripts/generate-i18n-keys.mjs` 仅新增一键。未跑 cargo（无 Rust 改动）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：#590 提到的目录同步传输错误没有稳定 `TONO_*` 键、诊断报告无目录同步字段，本 PR 未改。未在实机复现。

## 2026-09-25 · macOS 控制面请求不走系统代理；备用通道只给核心可用的块，prepare 拒绝计入三次暂停

- **归属/来源**：G2 连不上有下一手；Issue #587（总账 H21-O-F6）、#585（H21-O-F4）。
  `apps/macos/Tono/Services/TonoAPIClient.swift`、`AppState+Connect.swift`。基线 origin/main 46dde442；
  分支 `fix/macos-backup-channel-and-proxy-20260925`，PR [#617](https://github.com/raydocs/tono/pull/617)，未合 main。
- **缺陷修复**：
  - #587：控制面 `URLSession` 原先继承系统代理/PAC；另一代理软件设为系统代理时，账户请求走该代理，而受保护离线下
    PF 挡住它的上游，账户落入通用错误。现在生产配置 `connectionProxyDictionary = [:]`（与 Windows no_proxy 一致）；
    测试注入的 session 照旧使用。其它 `URLSession`（本机控制器、mixed 端口探测、OAuth 换票、更新下载）不属控制面客户端，未改。
  - #585：「试用备用通道」只按名字匹配 hy2，会提供内置 sing-box 拒绝的证书 pin hy2 块；`connect()` 在 prepare 拒绝、
    不计失败，受保护离线每 30 s 重试且永不暂停，保存的 hy2 选择重启后仍在。现在备用通道只从
    `singBoxUnavailableReason` 为空的块中选；保护已阻断时，这类 prepare 拒绝按同签名计数，第三次暂停自动重试
    （网络变化不解除），沿用已有的「同一失败重复三次」本地化文案。PF 保持；Retry now 或改选出口照旧重置计数。
- **新增/优化**：无。
- **工程与测试**：新回归 `AccountSessionRequestTests.testControlPlaneSessionIgnoresTheSystemProxy`、
  `ProtectedReconnectTests.testProtectedReconnectPausesWhenPrepareKeepsRefusingTheSelectedExit`（约 15 s，30 s 看门狗）。
  红分支 `wip/macos-backup-channel-and-proxy-20260925-red` 只含测试与配置工厂骨架。
- **验证**：本机未编译、未跑测试（执行位置规则）；以 PR 的 `macos-26` CI 为准。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：客户端仍发 `X-Tono-Accept: hy2`，证书 pin hy2 仍在目录里（不提供、连接拒绝，但未剔除）；未实机复现。

## 2026-09-25 · Windows：WFP 锁定校验失败单独分类；上传诊断带上一次失败

- **归属/来源**：G2 连不上有下一手（错误可诊断）；Issue #593（总账 H20-C-F4）、#594（H20-C-F5）。
  `apps/windows/app/src-tauri/src/tono/connection/{probes,failure}.rs`、`tono/diagnostics.rs`、
  `tono/commands/diagnostics.rs`、`src/services/tono.ts`、`src/locales/{zh,en}/tono.json` 与生成的 i18n 类型。
  基线 origin/main 5ca17af3；分支 `fix/win-wfp-error-diagnostics-20260925`（红分支 `wip/win-wfp-error-diagnostics-20260925-red`）；PR [#616](https://github.com/raydocs/tono/pull/616)；未合 main。
- **缺陷修复**：
  - #593：锁定后验证里 `verify_locked()` 失败时根本没跑 TUN 探测，却被归成 `TONO_TUN_DATA_PLANE_BROKEN`
    （「请重启电脑」），Service 的 `status.last_error` 也被丢掉。现在这类失败带新前缀 `TONO_WFP_LOCK_UNVERIFIED`，
    正文保留 Service 的 wanted/live/mode 与 `last_error`，并附回环代理交叉检查结果；前端映射到新文案
    `wfpLockUnverified`。若 `last_error` 本身是 `TONO_WFP_ENGINE_WEDGED`/`TONO_BFE_NOT_RUNNING`，仍按原漏斗
    （`StageFailure::error`）显示对应的引擎文案。连接判定、保护与释放路径不变。
  - #594：新一次尝试会清空 `failed_stage`/`connect_error`，上传的诊断里就没有上一次失败。现在当前无错误而
    `attempt_history.last_failure` 存在时，上传的 `failedStage` 取其阶段，`error` 写
    「last failed attempt, Ns before this report: <稳定错误码>」；只带阶段键和 `TONO_*`/`CORE_*` 码，
    本地 `error_detail` 仍只在复制诊断里。不加新字段（控制面 intake 拒绝未知键），schema 不变。
- **新增/优化**：无。
- **工程与测试**：两条回归，各一：`unverified_wfp_lock_carries_the_service_error_instead_of_a_tun_verdict`
  （`connection.rs`）、`a_retry_that_cleared_the_live_error_still_uploads_the_last_classified_failure`（`diagnostics.rs`）。
  红分支只含测试和保持原行为的骨架（`verify_locked` 消息拆成两个辅助函数；`DiagnosticsSources` 加未读取的 `last_failure`）。
- **验证**：本机未跑 cargo（执行位置规则），编译与红/绿结果以 PR 的 Windows CI 为准。本机
  `node scripts/generate-i18n-keys.mjs` 重新生成类型（仅新增一键），两份 locale JSON 可解析；未跑 vitest/tsc（工作树无 node_modules）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：测试员看到的「上次错误，可能已恢复」横幅读的是 Service 的 `last_error`：看门狗重装失败时写入，
  自行恢复后不清除，要等下一次成功的 arm/lock（`record_outcome`）才清。这是 Service 看门狗路径，与 #593 的 App
  分类路径不同，本 PR 未改，另需记录。未在实机复现。

## 2026-09-24 · Windows 候选包构建：私有解包分支写出 live `Tono.exe`，载荷门拒绝

- **归属/来源**：G3 发出去还能再发（候选包打包）；`apps/windows/app/src-tauri/packages/windows/installer.nsi`
  （Section Install 私有解包分支）、`apps/windows/app/scripts/windows-packaging.mjs` 及其测试。
  基线 origin/main 536ee977；分支 `fix/windows-private-unpack-staged-gui-20260924`。
- **缺陷修复**：b6b42ea0（2026-09-22，Service 受保护更新事务 v1）加入的 `$TonoPrivateUnpack = 1` 分支以 live 名
  解出 GUI（`Tono.exe`）和 Mihomo（`tono-core.exe`），安装包因此同时含 `Tono.exe` 与 `Tono.exe.next`；
  `release:preflight --payload-only` 按 2026-08 起的规则（GUI 只能以唯一的 `Tono.exe.next` 出现）拒绝，此后每个
  Windows 候选包都失败（run 36095249694；最后成功 569ce865）。现在私有分支与 live 分支一样以 `.next` 名解出，
  再在私有 payload 目录内改名为 Service 校验的 `Tono.exe`/`tono-core.exe`；改名失败即 `Abort`（非零退出），
  Service 不会读到半个 payload。载荷门未放宽。除私有解包的命名外无产品行为变化，Service 契约不变。
  两个分支对同一源文件、同一 `SetOutPath $INSTDIR`、同一 `/oname` 各有一条 File 指令；7-Zip 对同数据块、同名同前缀的
  成员只列一次（run 36095249694 的列表里两分支都写的 `resources/*` 各只出现一次），所以 `.next` 成员仍各一个，
  门的「恰好一个」检查不改。
- **新增/优化**：无。
- **工程与测试**：`validateNsisAutomaticUpgradeFlow`（config-only preflight 也跑）现在要求私有分支只以 `.next` 名解出
  GUI 与 Mihomo、只在 `$INSTDIR` 内改名、改名失败 `Abort`，构建前即可拦住。新回归
  `NSIS private extraction never extracts a live GUI member`。三处原有 live 路径变异断言（`$APPDATA` 删除、GUI 与外部
  二进制的 `File`）按首次出现替换，现在私有分支先出现同一行，改为只替换 live 段（`replaceInLiveInstall`），意图不变。
- **验证**：本机 `node --test scripts/windows-packaging.test.mjs`：LF 32/32；`installer.nsi` 临时转 CRLF 后 32/32，已按副本
  原样还原；新回归对 origin/main 的 `installer.nsi` 以断言失败。本机未跑 NSIS/cargo/tauri（执行位置规则）。
  Windows 候选包 run 36098008549（d17b672c）构建与 `release:preflight --payload-only` 均通过，`.next` 成员未重复。
  增量审查（Opus+Codex）PASSED，1 项 minor：私有分支 lint 未禁止 binaries 循环内多出的 live 名成员，`Rename` 放行
  `$INSTDIR\..\`；已收紧为 binaries 循环逐行精确匹配、`Rename` 路径禁止 `..`，本机注入两种变异均被拒，LF/CRLF 32/32。
- **候选/发布**：Windows 0.0.73 候选安装包（run 36098008549，源 d17b672c，未签名、`candidateOnly`，未推更新源），
  `Tono_0.0.73_x64-setup.exe` SHA-256 `756145b7878c17de82ad6e64ec12a126213840bc85cc8f95db0c431793caceb9`，已交所有者分发测试。
- **剩余限制**：私有解包未在实机由 Service 执行（受保护更新 G3.3 真机流程仍待）。

## 2026-09-24 · Windows 候选包构建：NSIS 打包测试在 CRLF 检出下失败

- **归属/来源**：G3 发出去还能再发（候选包构建）；`apps/windows/app/scripts/windows-packaging.test.mjs`。
  基线 origin/main e0b7be4a；分支 `fix/windows-packaging-crlf-20260924`。
- **缺陷修复**：无产品行为变化。
- **工程与测试**：669113eb（2026-09-22）加入的变异断言用含 `\n` 的字符串锚点替换 `installer.nsi` 片段；
  `windows-2025` 检出为 CRLF，锚点不匹配、替换落空、校验返回 null，`NSIS automatically upgrades…` 失败，
  Windows 候选包构建（run 36094398670）因此中止。该测试只在候选包构建里跑（普通 CI 在 Linux，LF），所以此前未暴露；
  上一次成功的候选包 569ce865 早于它。三处字符串锚点改为 `\r?\n` 正则，与同文件其它断言一致。
- **验证**：本机 `node --test scripts/windows-packaging.test.mjs`：LF 31/31；把 `installer.nsi` 临时转 CRLF 后新版 31/31、
  旧版 30/31（同一断言失败），已还原文件。Windows 候选包在本分支重跑见 PR。
- **候选/发布**：macOS 0.0.73 build73 签名公证测试包（run 36094396395，源 e0b7be4a，`candidateOnly`，未签 Sparkle，
  未推更新源）；Windows 候选包待本修复后的构建。
- **剩余限制**：无。

## 2026-09-24 · 控制面不可达时凭离线授权进入 Ready；服务端拒绝统一经单一漏斗吊销（Windows + macOS）

- **归属/来源**：G2 连不上有下一手；Issue #582（总账 H21-O-F1）。Windows `crates/tono-core/src/auth.rs`、
  `src-tauri/src/tono/`（新 `offline_grant.rs`，`state.rs`、`catalog_sync.rs`、`commands/restore.rs`、
  `commands/account.rs`、`commands/quit.rs`、`commands/mod.rs`、`connection.rs`），tono-core `catalog.rs`
  加 `current_routing()`；macOS `Tono/Services/`（新 `Account/OfflineGrant.swift`，`TonoAPIClient.swift`、
  `AccountSession*.swift`、`AppState*.swift`、`ConfigStorage.swift`、`TonoApp.swift`、`Localizable.xcstrings`）。
  基线 origin/main a4284413；分支 `fix/issue-582-offline-admission-20260924`，源码 a0a6244e；PR #612；未合 main。
  取代 #607 的删除式标记方案。
- **缺陷修复**：
  - #582：已登录、有已验证目录缓存的用户在控制面不可达（出口可达）时重启，恢复失败进 error，无法连接。
    现在：`me()` 仅因传输错误或恢复预算耗尽而失败时，若保护状态已知、`offline-grant.json` 为 granted、
    其 refresh token 摘要与内存中水合的 token 相同、catalog/routing 摘要与内存 tracker 相同且有节点，
    进 Ready 并标记离线（Windows 状态字段 `offlineVerifiedAtMs`）；401/403/5xx/无效响应不走此路。
    比对只用内存，不重读目录缓存。授权只在本进程目录同步拿到服务端响应（安装或未变）且凭据存储确认
    token 已落盘后写入，摘要取自该服务端响应，不取启动时从磁盘种下的 tracker。
  - 服务端拒绝的识别此前分散在各调用点、依赖 `ApiError::Unauthorized`（本地也会产生），重试收到的
    401、提前续期被吞掉的 refresh 401 会漏掉。现在 Windows 的 `ApiClient::exchange` 与 macOS 的
    `TonoAPIClient.sendData` 是读取服务端答复的唯一位置（在传输重试与续期吞错之下），按请求用途分类：
    2xx→Verified；refresh 或用新 token 重放的 401、带权益码（6 个，两端一致）的 403→Refused（macOS 首次请求
    带权益码的 401 也算 Refused，Windows 不算；Worker 的 401 目前不带权益码，无实际差别）；
    其它 403→Forbidden；首次请求的 401 只表示 access token 过期，不算拒绝。判决带发起时的身份代次，
    身份已更替的迟到答复丢弃。
  - 吊销：Refused/Forbidden 先在内存置位（Connect 与自动重连立即拒绝），再把授权文件**覆盖写**为
    `{verdict:"revoked",reason,at}`，失败按 1 s→30 s 退避重试；Windows 退出时最多等 3 s。Refused
    挂起账户（保护不动），Forbidden 只取消离线资格。离线模式在收到第一个分类答复时结束。
- **新增/优化**：离线 Ready 期间 Connect 前再次比对授权与内存；macOS 离线期间每 60 s 重试 `me()`。
  无前端改动：两端都没有「无法连接 Tono，使用 <日期> 验证的出口」+ 重试的界面（Windows 的
  `offlineVerifiedAtMs` 与 macOS 的 `offlineVerifiedAt` 都未被界面读取）。
- **工程与测试**：每个行为一个回归（规则 5），均先在 CI 上红、再转绿。
  - tono-core T1 `a_refresh_refused_on_the_transport_retry_reports_one_refusal`、
    T2 `a_refusal_during_early_renewal_is_reported_but_a_retired_identitys_is_not`。
  - Windows app T3 `restore::offline_admission_tests::unreachable_restore_is_ready_offline_only_on_a_grant_matching_memory`、
    T4 `offline_grant::tests::refusal_revokes_memory_at_once_and_retries_the_tombstone_until_it_lands`、
    T5 `connection::tests::offline_ready_connect_is_refused_as_soon_as_the_server_forbids_the_session`。
  - macOS M1 `testUnreachableRestoreIsReadyOfflineOnlyOnAGrantMatchingMemory`、
    M2 `testARefusedRenewalOverwritesTheOfflineGrantAsRevoked`（AccountSessionRequestTests）、
    M3 `testOfflineConnectIsRefusedAsSoonAsTheServerRevokesTheSession`（ManagedExitCatalogOwnershipTests）。
  - 15dad8f0 在 macOS 编译失败（新参数 `session` 遮蔽 `URLSession` 属性），a0a6244e 修正；属编译错误，
    非运行时缺陷。
- **验证**：本机未执行 cargo/xcodebuild（执行位置规则）。
  - 红：Windows CI 36070390689（19370636，`core` 仅 T1/T2 断言失败，271 通过）；36073146186（0b97c3ff，
    `app-rust` 仅 T3/T4/T5 断言失败，526 通过）；macOS CI 36075897145（3fea479a，仅 M1–M3 断言失败）。
  - 绿：Windows CI 36070556159（bd124d1f，四作业全绿，`core` 273 通过）；36074223673（fda90ebb，四作业全绿，
    `app-rust` 529 通过）；macOS CI 36077017209（a0a6244e，四作业全绿，TonoTests 428 例 0 失败）。
    a0a6244e 之后的提交只改 macOS 与文档，Windows 结果沿用 fda90ebb。
  - 未实机：设计文档的完成条件（黑洞控制面后启动→离线 Ready→连接；服务端吊销后恢复连通→挂起；
    B 覆盖 A 缓存后离线重启被拒）未在设备上执行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：
  - refresh token 每次续期都会轮换；轮换后到下一次目录同步（≤300 s）之间授权失配，离线启动被拒（fail-closed）。
  - 退出等待有上限（Windows 3 s，退出时唤醒写入器立即重试；关机路径总预算 2.5 s 可能截断；macOS 不等待）；
    超出时旧授权可能留在磁盘，
    下次离线启动仍可准入，直到首个服务端答复。授权文件读取未做属主/ACL 校验（Windows）；macOS 读取校验 0600 与属主。
  - Forbidden 会挡住在线 Connect 直到下一个 2xx（最长约一个同步周期）；Worker 目前在客户端端点不返回此类 403。
  - 换账户时不丢弃旧账户未落盘的 tombstone，由新账户的第一次授权写入取代；吊销记录带 token 摘要，
    与内存 token 不符或无摘要时按「无授权」处理（普通错误），不再挂起新账户。
  - macOS：`me()` 重新接受账户时解除 Refused（Windows 只在重新登录时解除）。离线启动后账户为空：Windows 在
    离线被 Verified 结束后每 60 s 补读 `me()` 直到成功（期间状态保持 Ready 时无上限）；macOS 离线期间每 60 s
    重试 `me()`，挂起后该循环仍在运行。
  - 真正的授权来源是出口 roster；客户端文件不是权益凭证，未加客户端离线时长上限。
- **续记（2026-09-24，审查修复）**：`review-run`（55c23f9a）中 Grok 发现与复核均因 jev-route 的空闲看门狗
  超时（`--output-format json` 结束前不写字节，5 分钟即被结束，且其 json 信封无法解析；工具侧另行修正），
  由 Codex（发现）+ Opus（复核与独立发现）+ Codex（复核 Opus 发现）替代。确认项均为 minor/major·低概率，无阻断：
  - 缺陷修复（总账 R612-*）：F1/O1 401/403 答复头已到而 body 中断时按该状态分类并抛出状态错误，不再当作
    不可达（ac1de43d，两端）；F2 macOS 离线准入会话的 Check again 走完整恢复（2c41bf8a）；F3 Windows 先处理
    消失出口再记授权，flush 限 2 s（313a6e05）；F4 Windows 离线被 Verified 结束后补读 `me()` 并启动日志上传
    （35cb2a08）；O2 待写 tombstone 保留最强原因、解除或新授权落盘后丢弃（b662119e）；O3 吊销记录绑定 token
    摘要（e1d61944）；O4 Windows 退出唤醒 tombstone 写入器（f124c0b7）。O5（macOS 受保护重连无授权仍拨缓存出口）
    为 origin/main 既有问题，记总账 open，不在本 PR。
  - 工程与测试：新增 3 个回归，均先红后绿。红：`wip/582-fa-red`（仅测试，基于 e681db2f，不合入）Windows CI
    36081983790（`transport::tests::a_refusal_whose_body_is_cut_off_is_still_an_answer` 断言失败，529 通过）、
    macOS CI 36081983804（`testARefusedRenewalWithACutOffBodyStillRevokesTheOfflineGrant` 断言失败）、
    Windows CI 36082901027（c5045f1e，`restore::offline_admission_tests::unreachable_restore_is_not_suspended_by_another_sessions_revocation`
    得到 Suspended）。F2/F3/F4/O2/O4 无回归（需 helper IPC、可阻塞的凭据库或 AppHandle，无便宜接口）。
  - 验证：35cb2a08 Windows CI 36081986829、macOS CI 36081986834 全绿；f124c0b7 Windows CI 36082799227 全绿
    （`app-rust` 531 通过）、macOS CI 36082799183 全绿。本机未编译。
- **续记（2026-09-24 晚，第 2–6 轮审查）**：jev-route 改为 Opus+Codex 双发现者、异厂商流水化复核、
  增量 `--since` 审查（第 2 轮起每轮 2–6 分钟）。各轮均 PASSED、无阻断；确认的问题：
  - 缺陷修复：
    - 36a43680：恢复预算超时时若已收到任何响应状态行，不再按不可达离线准入（`TonoTransport` 新增答复计数）；
      两端 body 中断的非 2xx 按该状态处理（不再只限 401/403）；`lift_forbidden` 先取文件锁（第 2 轮 Codex F1=Grok G1、
      G2、G3）。
    - f594995a：`lift_forbidden` 只在确为 FORBIDDEN 时取锁，sink 在 2xx 常规路径不再等文件锁；超时后已答复的请求
      给予宽限（第 3 轮）。bf5980c2、01399288：宽限先后改为 transport 总超时、5 倍总超时（第 4、5 轮指出仍不够）。
    - 380fe8e3：已收到答复后不设上限，等 `me()` 调用链自然结束，由 tono-core 分类每个答复（第 6 轮指出一次
      `send` 内会串行多条路径，固定上限都不成立）。链有限、每次 attempt 受 transport 超时约束；罕见情况下
      Restoring 会持续较久，保护不变。
  - 接受不改：2xx body 中断仍按传输失败（服务端已接受会话，不会放行被拒会话）；答复计数不按身份区分
    （只会让结果偏向 Error，fail-closed）；真正解除 FORBIDDEN 时 sink 可能等一次写盘（罕见、有界）。
  - 工程与测试：本轮修复无新增回归（需 AppHandle、可阻塞 transport 或并发时序夹具）。
  - 工程与测试：36a43680 漏改一处测试里的 `TonoTransport` 结构体字面量，app 测试目标在 Windows 编译失败；
    其后各次 Windows 运行都被下一次推送取消，直到 380fe8e3 的 CI 才暴露，c258bb46 修正（编译错误，非运行时缺陷）。
  - 验证：c258bb46 Windows CI 36091919930 全绿（四作业）、macOS CI 36091919923 全绿；第 7 轮增量审查（Opus+Codex）
    无发现。本机未编译。

## 2026-09-24 · Windows 启动恢复的备用路径在预算内运行；重试收到的拒绝不再被当作网络失败

- **归属/来源**：G2 连不上有下一手；Windows `src-tauri/src/tono/transport.rs` 与
  `crates/tono-core/src/auth.rs`。Issue #583；审查项 R607-F1。从 #607 拆出：#607 的离线准入部分
  （#582）按所有者决定另行重设计（单一拒绝入口 + 持久化拒绝，Windows 与 macOS 一起），本 PR
  不含标记文件、离线 Ready、目录同步/恢复的离线改动和对应界面文字。基线 origin/main bf177a10，
  后并入 main 3c3f9b95（合并提交 aea51516）；分支 `fix/issue-583-transport-20260924`；PR #611。
- **缺陷修复**：
  - #583：控制面直连（pinned）客户端的连接超时是共用的 30 s，等于启动恢复总预算
    `RESTORE_TRANSACTION_TIMEOUT`。直连地址被丢包时，恢复在直连这一步就用完预算，系统 DNS 备用
    路径在启动时从不运行。现在：直连一步的连接超时为 10 s（`PINNED_CONNECT_TIMEOUT`）；系统 DNS
    客户端在直连失败后答复成功，之后的请求先走它（同为 10 s 连接预算的独立 client），所以恢复的
    `me` 不再在 refresh 之后又等一次直连。首选尝试失败或被外层截止时间取消时，由租约在 drop 时清除
    偏好，下一次请求先走直连（kill switch 武装、DNS 被封时多付一次解析失败）。只限制连接阶段，
    POST/DELETE 的送达判断不变；其它客户端（fallback 的系统 DNS、备用端口）超时不变。
  - R607-F1：`ApiClient::call` 在首次请求为可重试的传输错误、重试收到服务器答复（401/403/其它
    4xx/5xx）时，丢弃答复并返回第一次的传输错误。现在重试仍为传输错误才返回原错误，服务器的答复
    优先。影响：启动恢复中重试收到的 401 进 Suspended（保留保护与已存会话，提示重新登录；此前进 error），
    403/5xx 仍进 error；
    传输失败仍进 error（本 PR 不改为 Ready）。
- **新增/优化**：无。
- **工程与测试**：两个回归（规则 5）。
  - `transport::tests::restores_refresh_and_me_pay_the_dropped_pins_once`：直连指向丢包地址
    10.255.255.1、系统 DNS 路径指向本机夹具，经真实 `ApiClient::me()` 走 refresh（POST）+ `me`（GET），
    断言两次合计小于恢复预算一半；再构造“偏好已学到、DNS 路径变黑洞、直连健康”的 transport，
    首选请求被 500 ms 超时取消后，下一次请求须在 5 s 内由直连答复。旧代码直连 30 s、无偏好，
    第一段约 60 s；有偏好但取消不清除时第二段约 10 s（超过 5 s 上限）；均失败（按代码推理，未实跑）。有隧道截获
    黑洞地址时跳过；耗时约 11 s。
  - `tono-core auth::tests::a_retry_the_server_refused_is_not_reported_as_unreachable`：refresh 首次
    Connect 失败、重试 401，断言 `me()` 返回 `Unauthorized`；旧代码返回 Transport（按代码推理，未实跑）。
  - `RESTORE_TRANSACTION_TIMEOUT` 改为 `pub(crate)` 供测试引用。
- **验证**：本机未执行 cargo（执行位置规则）。Windows CI run 36058698693 在 aea51516 上全绿：
  transport 回归在 windows-2025 `app-rust` 作业通过（实跑约 13 s，未走隧道跳过分支）；tono-core
  回归在 ubuntu-24.04 `core` 作业通过（windows-2025 只跑 tono-core 的 `update_journal` 过滤）。
  两个回归在旧代码上的失败未实跑。未改前端。双厂商审查：Codex 无发现；Opus 报告 F1/F2（见剩余限制）
  及本条文字错误（已改），F1/F2 尚待异厂商复核。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未实机验证。#582（控制面不可达时用缓存连接）不在本 PR，另行重设计；启动时控制面
  不可达仍进 error 状态并显示“Session expired”。系统 DNS 路径本身较慢时（审查按约 11 s 推算），
  refresh 的直连 10 s + 备用路径 + `me` 的备用路径仍可能超出 30 s 预算，本 PR 只去掉了第二次直连等待。
  审查 F1（Opus 发现，待复核）：hyper-util 0.1.20 把 connect 超时按地址数均分并逐个尝试，10 s 在两个
  编译期 pin 下每个地址只有 5 s（只覆盖 0 s/3 s 两次 SYN），学到更多 pin 时更少；此前 30 s 每地址 15 s。
  丢包链路 + Protected Offline 下，旧代码可能在 9 s 重传时连上而新代码失败（仍 fail-closed）。上文
  「10 s 覆盖两次重传」的注释不成立。审查 F2：`restore_deadline` 在保护探测之前设定，探测最坏约 14 s
  也计入 30 s；`me` 走 `resolved_first` 是独立连接池，不复用 refresh 的连接。

## 2026-09-24 · macOS Core 重启期间撤下 reviewed-bundle PF 放行（不清空状态）

- **归属/来源**：G1 连接保护；`tono-core-helper`（`/core/sync`、空闲监督循环）、macOS `AppState+Proxy`
  配置重载与 `AppState` 策略应用。#604 审查发现 R604-F1（High，Codex 发现、Opus 源码核实），Issue #608。
  基线 `fix/issue-586-20260924` 17f2d71d（#604，未合 main）；分支 `fix/issue-608-20260924`；本 PR 叠在
  #604 上；未合 main。
- **缺陷修复**：服务器切换、配置重载、策略应用都先以 `utun199` + bundle 标志布防，再调 `/core/sync`；
  Helper 先停旧 Core 再启动新 Core，utun 随之消失，但不带地址的 `tono-bundle` 放行仍留在锚点里，
  Core 重启期间（约 1–2 s）root 进程可经物理网卡访问 Web 端口；Core 崩溃时同样如此。现在：
  `/core/sync` 在新配置通过检查之后、停旧 Core 之前，只把两条 `tono-bundle` 从已加载的锚点撤下，
  不清空 PF 状态，并递增 `stateGeneration`（在途 arm 会被拒绝）；`lastLoadedPassRules` 仍是原完整集合。
  放行只能由 App 在隧道存在后带标志重新布防恢复：相对该基线没有撤回，不清空状态；之后真正去掉
  该放行的 arm 相对基线仍算撤回，照旧全机清空。App：配置重载（非 pins-only）与策略应用在
  `/core/sync` + reload 之后等 `utun199` 出现，再补一次带标志的布防；pins-only 收敛布防与切换路径的
  收敛布防原本就带标志（已核对）。Core 崩溃：Helper 空闲循环（每 10 s）发现 Core 未运行时走同一
  撤下路径。撤下为尽力而为：读取、校验或加载失败时保留原规则（不比原来更松），照常重启 Core，只写 stderr。
- **新增/优化**：无。
- **工程与测试**：Helper 协议 4.45.0 → 4.46.0（叠在 #604 的 4.45.0 上；按合并顺序重编号）；
  CONTRACT 按 `build-core-helper.sh` 同一管道重算为 `42a3e809…`（先对 17f2d71d 复算出记录值
  `51e335a1…` 以核对管道）。`writeRules` 拆出 `writeRuleText`，行为不变。回归测试一条：`runSelfTests`
  的 `bundleWithheldForCoreSync`——对带隧道、带标志的规则集，撤下计划只去掉两条 `tono-bundle`、
  仍保留 `block drop out quick all`、`disposal == .keep`；以计划保留的基线衡量，去掉放行的 arm 为
  `.full`，恢复放行的 arm 为 `.keep`；基线未知时不撤。17f2d71d 上没有这条撤下路径
  （`reviewedBundleWithholding` 不存在，自测编译失败）；那里唯一能去掉该放行的是不带标志的 arm，
  相对同一基线为 `.full`（全机清空），正是 `.keep` 断言排除的结果（按代码推理，未实跑）。
- **验证**：not run locally per execution-location rule; CI pending（GitHub-hosted `macos-26`：
  `build-core-helper.sh` 编译后运行 `--self-test`，以及 root 下的 `--self-test` / `--lifecycle-self-test`
  和 TonoTests）。本机只做了 CONTRACT 哈希的纯文本重算（未编译）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未在设备上验证。撤下期间，规则引擎直连的 bundle 流量被 PF 丢弃（fail-closed）：
  重载/策略路径持续到新 TUN 出现后的补布防，切换路径持续到出口验证之后的收敛布防。已建立的
  bundle 状态不清空，可持续到对应连接结束（与原来相同，不更松）。Core 崩溃时仍有至多约 10 s 的
  监督周期窗口（App 侧 TUN 缺失判定约 5–10 s 后也会 fail-closed 拆除）；Core 仍在运行而 utun 消失
  的情形不覆盖。只有本进程记录了基线且锚点文件与基线一致时才撤下；部分提交后（基线为 nil）不撤。
- **续记（2026-09-24，#609 审查 R609-F1，Codex High / Grok low，源码推导）**：上文「撤下失败时照常重启 Core」
  已改。原实现把收窄后的规则写盘、`pfctl -nf` 通过后若 `pfctl -f` 失败，只返回 false：内核仍有放行，
  `/core/sync` 照样停旧 Core（无隧道窗口照旧），而磁盘上已是收窄文件，与基线不一致，空闲循环再也
  不会重试，直到下一次 arm。现在：（a）写入或加载失败时把读到的原文件写回，磁盘、内核、基线重新一致，
  空闲循环可以重试；（b）撤下失败，或锚点文件既不是基线也不是已撤下的版本（放行可能仍在）时，
  `/core/sync` 在停旧 Core 之前报错返回，旧 Core 和隧道保持运行，App 按现有失败分支 fail-closed 拆除并
  重连。已撤下的文件识别为完成，照常重启。没选「退回不带放行的完整 arm（全机清空）」：同一个
  `pfctl -f` 失败时它同样会失败，且会清空全部连接。同一条自测扩展了三项断言：回滚内容等于读到的原文件、
  已撤下的文件判为无需撤下、不一致的文件判为不可停 Core；`/core/sync` 与失败注入的接线没有测试替身，
  未覆盖。Helper 版本仍为 4.46.0（未发布），CONTRACT 按同一管道重算为 `d386cfb4…`（先对 214330dc 复算出
  `42a3e809…`）。仍未本地构建或运行测试。剩余：`/core/sync` 失败后 App 的保留拆除通过 `/core/stop`
  停 Core，该路径不撤放行，放行在无隧道时保留到空闲循环重试（至多约 10 s）或重连的第一次布防。
- **续记二（2026-09-24，协调人批准）**：上条剩余项已处理。`/core/stop` 在停 Core 之前也走同一撤下
  （不清空状态）；尽力而为，失败只写 stderr，照常停 Core，空闲循环重试兜底。撤下失败且原文件也写
  不回去时（磁盘上的收窄文件会被误判为「已撤下」），清空内存基线（下一次 arm 走全机清空）并置
  `reviewedBundleFileUnconfirmed`：在下一次成功提交的 arm 之前，任何撤下都报错，`/core/sync` 因此
  不停旧 Core，`/core/stop` 记录后照停，空闲循环忽略。这两处都是有副作用的 manager/IPC 代码，没有
  测试替身，自测未扩展。Helper 版本仍为 4.46.0，CONTRACT 按同一管道重算为 `69ea0498…`（先对
  549f546d 复算出 `d386cfb4…`）。仍未本地构建或运行测试。

## 2026-09-24 · macOS 连接首次布防不再在 TUN 出现前放行 root Web 端口

- **归属/来源**：G1 连接保护；macOS `AppState+Connect`、`tono-core-helper` PF 规则。内部审查 H21-O-F5
  （High，跨厂商源码级核实），Issue #586。基线 origin/main ca00a736；分支 `fix/issue-586-20260924`；
  本 PR；未合 main。
- **缺陷修复**：连接（及受保护重试）的第一次布防在 `.startingTunnel` 之前就带上
  `reviewedBundleDirect`，Helper 在 `tunnelInterfaces` 为空时仍渲染不带地址的
  `pass out … port { 80, 443, 8000, 8080 } user root`（`tono-bundle`）。TUN 出现前的这段时间，
  root 进程可经物理网卡访问这些端口，界面却已显示保护中。现在：App 只在 TUN 存在后的锁定布防
  发送该标志，第一次布防固定为 `false`；Helper 在没有隧道接口时不渲染该放行（直接丢弃，不报错：
  报错会让发送该标志的连接全部失败；不放行时该流量仍 fail-closed）。精确地址、仅 root 的
  `sessionDirectEndpoints` 首次布防行为不变。配置重载路径在 utun 不存在时传空接口列表，同样由
  Helper 丢弃该放行。
- **新增/优化**：无。
- **工程与测试**：Helper 协议 4.22.0 → 4.45.0（远端分支最高为 4.44.0；按合并顺序重编号），
  CONTRACT 哈希按 `build-core-helper.sh` 同一管道重算为 `51e335a1…`（先对 HEAD 复算出原记录值
  `3f2459e2…` 以核对管道）。回归测试一条：`runSelfTests` 的 `bundleOffWithoutTunnel`——无隧道、
  标志为真的状态渲染结果不得含 `label "tono-bundle"`。旧代码对该状态渲染两条 `tono-bundle`
  放行，断言为假，`--self-test` 失败（按代码推理，未实跑）。测试修正：原 `required` 在同一无隧道
  状态上要求这两条放行（即断言了缺陷形态），现改为对同一状态加 `utun199` 的 `tunneledRules`
  检查形状与 `forbidden`，PF 语法检查也改用 `tunneledRules`（其规则是原 `rules` 的超集）。
- **验证**：not run locally per execution-location rule; CI pending（GitHub-hosted `macos-26`：
  `build-core-helper.sh` 编译后运行 `--self-test`，以及 root 下的 `--self-test` / `--lifecycle-self-test`
  和 TonoTests）。本机只做了 CONTRACT 哈希的纯文本重算（未编译）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未在设备上复现或验证。首次布防到锁定布防之间，规则引擎直连的该 bundle 流量会被
  PF 丢弃（fail-closed，持续到 TUN 就绪，通常几秒）。TUN 在会话中途消失而状态仍列有接口的情形
  不在本修复范围内。

## 2026-09-24 · 舰队 exit-agent 接入（13 个在线节点，运维操作）
- 归属：SHIP_PLAN 前置（交接 §2 第 2、3 步）；影响 exit 节点、D1 `exit_nodes`，无客户端改动。
- 来源：#563 合并提交 85ba3945 的 `services/exit-agent/reconcile_and_report.py`；详细记录见
  [FLEET_EXIT_AGENT_ROLLOUT_2026-09-24](reports/FLEET_EXIT_AGENT_ROLLOUT_2026-09-24.md)。
- 缺陷修复：Westwood 自 09-18 起 agent 每轮失败（吊销不执行、计量停报）→ 部署后恢复 ACK 与计量，首轮移除 1 个已吊销身份。
  另外 12 个在线节点此前未登记、从不 ACK → 全部登记并接入；各节点首轮补齐 6 个此前未在运行中 Xray 生效的身份。
- 新增/优化：6 个 hy2 节点的检查器改为绑定 `/opt/tono-hy2` 目录，hy2 allowlist 由 agent 按 roster 维护；
  Fuji 未发布的共享口令 hy2 停用（暂定决定，可恢复）。
- 工程与测试：无代码改动。
- 验证：D1 13 个节点 active、ACK 均在 62 秒内；hy2 节点真实身份 `ok:true`；未做客户端实机连接验证。
- 候选/发布：无新包。
- 剩余限制：`Tokyo · Sakura` 离线仍在目录内，需要 admin token 下架；ops hub 推送是否停用待定；首报补计 09-11 以来的流量。

## 2026-09-24 · Windows 独立列车 train/win2-20260924

- **归属/来源**：G1–G3 Windows 独立修复汇合（各 PR 归属见其自身条目）；基线 origin/main
  [d98b217d](https://github.com/raydocs/tono/commit/d98b217d) → 分支 `train/win2-20260924`，按序
  `--no-ff` 合入 15 个 PR：#513 (bfba4799)、#518 (35ef2230，含 #513)、#515 (8cab7ed3)、#520 (fd4a0f4b)、
  #557 (c62ae4fe)、#565 (9def4537)、#571 (c2734825)、#569 (bc64320d)、#573 (aeb3445e)、#577 (128892ab)、
  #580 (d132b0e8)、#544 (3b49c752)、#548 (407d57c1)、#554 (77169a16)、#558 (3d53a413)；无 PR 被剔除；提交时未合 main。
- **缺陷修复**：见各 PR 条目；列车本身不改产品行为，只做冲突合并：
  - `login.tsx`（#513 × #515）：登录页拦截卡片标题/说明三分支——Service 报告上次隧道仍在运行
    （`mode: locked` 且 `tunnel_permit_rendered`）时显示 #515 的「上次的连接仍在运行」；否则有 live 屏障
    时显示「网络已被拦截」；再否则显示 #513 的「保护状态未确认」与 `unverifiedDescription`。
  - `login.test.tsx`（#515 × main）：保留 #515 的三个 query-key mock（`tonoAccountQueryKey`、
    `tonoDevicesQueryKey`、`tonoServersQueryKey`）。
  - en/zh `tono.json`（#513 × #515）：`unverifiedDescription` 与 `stillRunningTitle`/`stillRunningDescription`
    取并集；`i18n-keys.ts`、`i18n-resources.ts` 用 `node scripts/generate-i18n-keys.mjs` 重新生成（最终 1085 键）。
  - `tono/commands/update.rs`（#557 × main）：`disconnect_if_pending` 用 #557 的
    `proxy_control::clear_for_update()`，保留 main 的 `released.needs_attention` 告警。
  - `installer.nsi`（#569 × main/#571）：删 data 分支采用 #569——不再对本账户 `$APPDATA`/`$LOCALAPPDATA`
    做 NSIS 递归 `RmDir /r`（由 helper 按全部 profile 删除，不穿越 junction）；保留 main 的
    `cmdkey /delete:refresh-token.tono`。#571 的 `$TonoUninstallScope`、#569 的 `$AppDataPathPlain`
    门控与 #573 的改动均保留（后两者文本上无冲突）。
  - `docs/INTERNAL_CHANGELOG.md` 与 `docs/FINDINGS_LEDGER.md`：两边条目/行全部保留，只删冲突标记。
- **新增/优化**：无。
- **工程与测试**：无新测试；各 PR 自带测试全部保留。
- **验证**：MacBook 列车工作树（node_modules 软链主仓库）：`apps/windows/app` `npx tsc --noEmit` 通过；
  `npx vitest run` 37 文件 287 通过；`node --test tooling/scripts/tests/windows-ci-paths.test.cjs` 12 通过；
  `npm run test:dev-control`（打包/发布脚本 node 测试）106 通过；无冲突标记；`git diff --check origin/main HEAD`
  无输出。未在本机运行 cargo / Tauri / NSIS 构建，Rust 与安装器改动以 PR 的 Windows CI 为准（CI pending）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：Rust 与 installer 合并结果未本地编译，等待 CI；未做实机验收。后续事项见
  Issue [#602](https://github.com/raydocs/tono/issues/602)。
- **续记（2026-09-24，Codex 审查列车头 `239aeb84`，Claude 交叉复核 F1/F2 确认）**：同分支追加两个修复提交。
  - 缺陷修复 F1（P2，来自 #544）：`tono_check_update` 以字符串拒绝，下一轮失败缓存相同值，
    `use-update.ts` 以 `checkError` 为依赖的重查计时器不再重设，SWR 又因缓存错误跳过每日轮询，
    更新发现永久停止。改为以「是否有错误」为键的每小时 interval，直到某次检查成功、每日轮询恢复。
  - 缺陷修复 F2（P2，来自 #569）：`--delete-app-data-all-profiles` 在 `enter_repair_gate()` 之前返回，
    独立调用可在更新待定或其他清理持锁时删除所有账户数据。现在与其他清理模式同走 repair gate；
    卸载程序在 Section Uninstall 内以自己的手动租约调用（`--final-uninstall` helper 已退出释放锁）。
  - F3（审计恢复写入未绑定原目录）：按路径重开属实，但目录位于用户自身 AppData、写入以同一用户
    身份进行，未跨权限边界，且与首次打开同一原语；不在本列车修复，另行登记。
  - 验证（MacBook，本分支工作树）：`use-update.test.tsx` 新增字符串错误用例在修复前失败（24 小时内
    调用停在 6 次）、修复后 2/2 通过；`npx tsc --noEmit` 通过；`windows-packaging.test.mjs` 新增
    repair gate 用例修复前失败、修复后全文件 31/31 通过。未在本机运行 cargo / NSIS，
    `uninstall_service.rs` 编译以 windows-2025 CI 为准；未做实机卸载验收。

## 2026-09-24 · mac3 列车 train/mac3-20260924

- **归属/来源**：G2 macOS 账户状态与保护展示汇合（各 PR 归属见其自身条目）；基线 origin/main
  [d98b217d](https://github.com/raydocs/tono/commit/d98b217d) → 分支 `train/mac3-20260924`，按序
  `--no-ff` 合入 #516（fc33c9eb）、#537（a984c553）、#538（f8a3c16a，含 #537）；提交时未合 main。
  mac2 列车 #605 尚未进 main，本列车不含它。
- **缺陷修复**：无新增；各修复见对应 PR 条目。
- **新增/优化**：无。
- **工程与测试（合并时手工解决的冲突）**：
  - #516 × #537：`AppState+Connect.swift` 同时保留 #516 新增的 `acceptConfirmedProtectionReleaseBeforeSignIn()`
    与 #537 把 `acceptConfirmedExternalProtectionRelease()` 去掉 `private`（供 `AppState+LaunchProtection.swift` 调用）。
  - 本文件：各合并两边条目全部保留，仅去掉冲突标记。`FINDINGS_LEDGER.md` 自动合并，无冲突。
  - 未合入 #535：其新 head f587b441 基于 #516 旧 head，与 #516 现 head 在同一接缝上改法不同——#516
    （fc8337ec/7b95aed4/fc33c9eb）用返回 Bool、在 AppState 保护代次下清除 armed 意图的
    `protectionReleaseConsumer` 取代了 `killSwitchStatusObservation`；#535 让
    `retireResumeIntentIfProtectionReleased()` 返回 helper 原始答复（Check again 需区分 `.rejected`），其测试仍设
    `killSwitchStatusObservation`。合并需要重新设计该接口，不属于无歧义解决，故留出。
  - 未合入 #539：叠在 #535 旧 head f814061e 上，含 #535 的提交，随 #535 一起留出。
- **验证**：MacBook 列车工作树只做文本检查：无冲突标记（`git grep`）；`git diff --check origin/main HEAD` 通过；
  `Localizable.xcstrings` JSON 解析通过；相对 origin/main 无 helper 源码（`tooling/scripts/core-helper/*`、
  `helper-shared/*`、`HelperProtocolVersion.swift`）改动。未运行 xcodebuild/XCTest，编译与测试待列车 PR 的
  GitHub-hosted `macos-26` CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：CI 待定；#535/#539 需先 rebase 到 #516 现 head 并统一 sign-in 释放接口后再进下一班列车；
  其余跟进见 #601。没有实机验收。
- **续记（2026-09-24，PR #610 集成审查，Codex 发现、Claude 读源码复核三项均确认）**：列车头 947cf8d6 已另行合入
  #535（1ad72605）与 #539。修复提交 [60e70d55](https://github.com/raydocs/tono/commit/60e70d55)：
  INT610-F1（P1）activation 对 unconfirmed 的解除答复只核对 launch 序号，跨过 wake 的 protection generation
  仍被接受并清 `isArmed`，wake 的 reassert 返回 false 却发布 Protected Offline → 答复再核对 protection
  generation；wake 仅在 reassert 真正武装时才发布 blocked。INT610-F2（P2）activation 先接受解除后，sign-in 同一
  解除答复被 generation 拒绝、`shouldResumeProtection` 残留并自动重连 → 若越过它的只是该次已确认解除（其后无新操作、
  仍为解除态），sign-in 返回解除答复并退掉 resume 意图。MAC3-ADD-F1（P2）挂起/Check again 的保留式拆除经
  `restrictToBootstrap` → `installIfNeeded` 可对拒绝本 App 的 helper 弹管理员提示 → `restrictToBootstrap` 不再安装/修复
  helper（`helperPrepared: true`），helper 不可达或拒绝时调用失败、PF 维持 helper 现状。测试：
  `LaunchProtectionPresentationTests.testAnActivationAnswerAWakeOvertookIsDropped`、
  `KillSwitchArmOutcomeTests.testBootstrapRestrictionNeverPreparesTheHelper`（失败前行为为推理：旧代码前者接受答复、
  后者先走 helper 安装而非 arm 请求），F2 无新测试。仅 `git diff --check`；未在 MacBook 编译或跑 XCTest，待 `macos-26`
  CI。剩余：wake 中 reassert 未武装且路由 48 s 内未就绪时不再移交重连循环；无实机验证。无新包。
- **续记（2026-09-24，Codex 复核 60e70d55：F2 FIXED，F1 PARTIAL，另两项回归/过宽；Claude 读源码三项均确认）**：
  (1) F1 残留（原有路径）：wake reassert 抛错仍发布 Protected Offline 和「网络仍处于阻断状态」→ 改为发布 #537 的
  unconfirmed（「保护状态未知」），文案改为无法确认、继续重试；此状态下 activation 或重连循环读到 helper 确认解除时，
  与 Protected Offline 一样走完整解除并结束 wake/重连恢复。(2) 上一续记引入的回归（即上条「剩余」）：未武装的
  wake 在就绪超时后不再移交重连 → 恢复无条件移交，不再依赖 blocked 声明。(3) MAC3-ADD-F1 过宽：`helperPrepared: true`
  让所有 `restrictToBootstrap` 调用跳过版本检查与静默升级 → 改为照常准备 helper，仅不弹管理员提示
  （`installIfNeeded(administratorPrompt: false)`），需要提示时（拒绝本 App 或静默升级失败）失败、PF 维持 helper 现状。
  测试：两个已加测试扩展——F1 测试改为驱动真实 wake（新增 `reassertKillSwitch` seam），另断言抛错时为 unknown 而非
  Protected Offline；MAC3 测试改为断言准备只以不提示方式调用且不发 arm 请求。失败前行为为推理；未编译、未跑 XCTest，
  待 `macos-26` CI；wake 移交（约 48 s）与 HelperManager 内部的提示前拦截无测试。无新包。
- **续记（2026-09-24，PR #610，合并 main 后修复 F1/F2）**：基线 mac3 `b9bea67a`，以 `2ac94c30`
  合入 origin/main `c9fe191e`；日志冲突按 main 条目在前、mac3 条目在后解决，逐节文本核对两侧原记录完整保留。
  G2 缺陷修复：F1 菜单栏先判断 `isProtectionUnconfirmed`，再判断重试暂停，不再把未知保护显示成
  Protected Offline；F2 wake 的 `reassertKillSwitch` 成功返回后立即检查取消，旧任务不得继续发布保护状态或发起连接。
  新增/优化：无。工程与测试：`LaunchProtectionPresentationTests` 各新增一条回归，覆盖未知+暂停的菜单投影、
  已取消的 reassert 成功返回不覆盖未知状态。验证：`git diff --check` 通过；按执行主机规则未运行 XCTest/原生编译，
  修复前失败未实跑；待 GitHub-hosted `macos-26` CI。仅源码，无新包；无设备验收。

## 2026-09-24 · mac 独立列车 train/mac2-20260924

- **归属/来源**：G1–G3 macOS 修复汇合（各 PR 归属见其自身条目）；基线 origin/main
  [d98b217d](https://github.com/raydocs/tono/commit/d98b217d) → 分支 `train/mac2-20260924`，按顺序 `--no-ff` 合入：
  #550 `fix/helper-recovery-no-user-20260924`（1c1b329f）、#562 `fix/pf-hook-removal-20260924`（097024ec）、
  #546 `fix/macos-keychain-read-error-20260924`（551a7bdc）、#552 `fix/macos-wake-reconnect-budget-20260924`（f96c589f）、
  #581 `fix/mac-candidate-telemetry-20260924`（e11e5399）、#566 `fix/helper-orphan-app-gone-20260924`（1f69a391）、
  #579 `fix/helper-other-user-20260924`（11dd36d2）。无 PR 被排除。提交时未合 main。
- **缺陷修复**：见各 PR 条目（本条之下）。冲突处理：
  - Helper 协议版本：各 PR 基于 4.9.0 各自写了临时编号，main 已到 4.22.0。按合入顺序定为合并列车编号
    4.22.0 → 4.41.0（#550）→ 4.42.0（#562）→ 4.43.0（#566）→ 4.44.0（#579）；最终只有一个版本 **4.44.0**，
    版本历史注释逐段接在 4.22.0 之后，“A 4.9.0 daemon/reset” 改为对应前一版本号。
  - `CONTRACT.sha256`：每个 Helper 合并提交都按 `build-core-helper.sh` 的同一文件清单与注释/空行过滤重算。
    该管线先在 origin/main（`4.22.0 3f2459e2…`）及 #550/#566/#579 分支头上复现了各自记录的哈希。最终为
    `4.44.0 007d78fcd0bbcb8593597913899aa6d7825b8d9e171dd778c62c17644db0a8e2`。
  - `main.swift`（#566 × main）：main 已把 `SocketServer` 构造移到 `startHelperDaemon(...)`；保留 main 结构，
    只在 `UpdateExecutor.startup()` 之后加入 #566 的 `if releaseIfTonoWasRemoved() { exit(0) }`（在恢复 PF 之前）。
  - `main.swift`（#579 × #566）：#579 的 `socketPath` 删除（连同注释）放进 #566 的 `removeHelperInstallation()`，
    因此 `--emergency-reset` 与启动时发现 Tono.app 已删除的释放路径都会删掉 socket。
  - `KillSwitchTests.swift`（#562 × main）：main 的第 8、9 段与 #562 的移除挂钩段都保留，后者编号改为 10。
  - `UpdateTests.swift`（#566 × main）：main 的 ledger schema 测试与 #566 的两个测试都保留，计数改为 13。
  - `docs/INTERNAL_CHANGELOG.md`：两侧条目全部保留，只去掉冲突标记。
- **新增/优化**：无（列车本身）。
- **工程与测试**：无新测试；各 PR 自带测试全部保留。
- **验证**：MacBook 列车工作树，未运行 xcodebuild/swift/swiftc（按执行位置规定）。`git grep` 冲突标记为空；
  `git diff --check origin/main HEAD` 干净；`Localizable.xcstrings` JSON 解析、`Info.plist` `plutil -lint`、
  `package-macos-test.sh` `bash -n`、`macos-release.yml` YAML 解析均通过；
  `node --test tooling/scripts/tests/*.test.cjs *.test.mjs` 80 项中 79 通过，1 项失败为
  `windows-ci-paths.test.cjs` 在本工作树缺 `js-yaml`（无 node_modules，本列车未改动）。**CI pending**：Helper 构建、
  `--self-test`、root 自测与 XCTest 以本 PR 的 GitHub-hosted `macos-26` CI 为准。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未在实机验证任何 Helper 行为（删除账户、删除 Tono.app、第二账户、pf.conf 挂钩移除）；
  4.44.0 对已安装用户需要管理员重装或升级。P3 后续事项见 Issue [#601](https://github.com/raydocs/tono/issues/601)。

## 2026-09-24 · macOS 第二个账户打开 Tono：按名称拒绝，绝不把 Helper 改绑到自己

- **归属/来源**：G1 连接保护（多账户隔离）；macOS App `HelperManager`。内部审查 H19-O-F3 = H19-G-F2（两个 finder
  独立发现，阅读确认），Issue [#561](https://github.com/raydocs/tono/issues/561)。基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b) → 分支 `fix/helper-other-user-20260924`；未合 main。
  与 #425（启动时自动修复）协调：本改动让“属于别的账户”走独立错误，不进入 #425 的 `connectFailed` 修复分支。
- **缺陷修复**：Helper 只服务一个 macOS 账户，socket 以 0600 交给该账户。第二个账户连接被权限拒绝，App 只报
  “The authenticated network helper is unavailable”，Retry 永远重复；一旦走到管理员安装（App 附带的 Helper
  更新、daemon 未登记，或 #425 那类启动时自动修复），批准后 Helper 被改绑到第二个账户，第一个账户的保护随之
  失控。现在：
  - 连接失败时若 socket 属于另一个 uid，报 `HelperIPCError.boundToAnotherUser`，文案点名该账户，说明在该账户中
    使用 Tono，或由管理员运行 `--emergency-reset` 后再迁移。
  - `installIfNeeded` 在任何探测、弹窗、重装之前做同样检查并拒绝。
  - root 安装脚本最前面加守卫：allowed-uid 记录的是另一个仍存在的账户时拒绝并返回账户名，App 显示同一错误。
    账户已不存在（被删除、迁移遗留）时不阻止安装。
  **临时产品决定（取更严一侧，待所有者确认）**：App 内任何安装（自动或用户点击）都不改绑另一个现存账户的
  Helper；迁移只能由管理员显式运行 `--emergency-reset`（会释放原账户的保护）。
- **新增/优化**：无。
- **工程与测试**：新增 XCTest `HelperBoundAccountTests.testAnotherAccountsHelperIsRefusedByNameAndNotRebound`：
  绑定真实 Unix socket，以另一个 uid 调 `connectFailure` 必须得到点名的错误；用临时记录文件以 `/bin/sh`
  实际执行 root 守卫片段：记录为另一个现存账户时非零退出且能解析出账户名，同账户或不存在的 uid 放行。
  先推送只含测试与现状行为桩的提交让 CI 变红，再推修复。zh-Hans 文案已加入字符串目录。
- **验证**：本机（编辑机）未编译、未运行 xcodebuild；以本 PR 的 GitHub-hosted `macos-26` CI（TonoTests，含
  LocalizationCoverageTests）为准。本机确认 `id -un <uid>` 对存在的 uid 输出用户名、对不存在的 uid 退出 1。
- **候选/发布**：无新包，仅源码。Helper 源码未改，不需要协议版本号。
- **剩余限制**：未在实机上用两个账户验证；自动重连循环遇到此错误仍按可重试处理（不再弹管理员框，但会反复
  快速失败）。daemon 未运行（没有 socket）时只能靠 root 守卫在管理员授权之后拒绝，用户会先看到一次授权框。
  守卫把“记录中的 uid 能解析为账户”当作账户存在。
- **2026-09-24 审查跟进**（MA-Codex-4，P2；MA-Codex-6 = MA-GROK-3，P2；MA-Codex-3，P3）：修复——
  (1) 按提示运行 `--emergency-reset` 后 socket 仍属原账户，第二个账户照样被按原账户名拒绝：`--emergency-reset`
  现在删除 `/var/run/tono-core/service.sock`；App 在 launchd plist 不存在时忽略 socket；安装脚本在停掉旧 daemon 后
  删除残留 socket（旧版 Helper 做的 reset 留下的 socket 属于别的 uid，新 daemon 会拒绝替换它）。
  (2) 连接路径把此错误记成 `HELPER_PROTOCOL_MISMATCH`（“请修复”）并继续自动重试：新增错误码
  `HELPER_BOUND_TO_ANOTHER_ACCOUNT`，界面显示点名账户的错误原文，`failureRequiresUserAction` 暂停自动重试（取代上文
  “自动重连循环遇到此错误仍按可重试处理”）。(3) P3：root 守卫移到 Helper 更新锁内的安装片段开头，与
  `--emergency-reset` 同锁，读取的记录就是随后覆盖的记录。Helper 源码因此改动（取代上文“不需要协议版本号”）：
  4.9.0 → 4.44.0（临时编号，合并时按顺序重编号），`CONTRACT.sha256` 按构建脚本清单重算。测试：两个 XCTest——
  `testASocketLeftWithoutTheDaemonIsNotAnotherAccountsHelper`、`testAnotherAccountsHelperIsItsOwnFailureAndWaitsForTheUser`；
  原测试改为显式传入存在的 plist 路径。验证：本机未运行（不做本机 Swift 编译），以 PR CI 为准。剩余限制：Helper 删除
  socket 没有自测（reset 接线需要真实安装）；新错误码仅 macOS，Windows 分类与运维台文案未同步；与 #566 同改
  `main.swift` 的移除列表，后合并者须把 `socketPath` 放进 #566 的 `removeHelperInstallation()`。
- **2026-09-24 第二轮跟进**（核验方 Codex 指出，Opus 读码确认，P3）：修复——账户 B 首次连接失败后，清理路径
  （`disconnect(releaseKillSwitch: true)` → 发布前修复探测 → 安装被守卫拒绝）用“需要修复、请批准管理员提示”覆盖了
  点名账户的提示。现在 `repairHelperForExplicitReleaseIfNeeded` 在 Helper 属于另一个账户时直接抛出
  `boundToAnotherUser`、不做探测和修复，清理路径保留该错误原文。保护行为不变（释放照旧中止）。测试：无（P3）。
  验证：本机未运行，以 PR CI 为准。剩余限制：完整清理流程的提示文本没有测试覆盖。

## 2026-09-24 · macOS 删除 Tono.app 后，Helper 在下次启动时释放保护并移除自身

- **归属/来源**：G1 连接保护（删除 App 后的出口）；macOS `tono-core-helper`。内部审查 H19-O-F1 = H19-G-F1
  （两个 finder 独立发现，阅读确认），Issue [#555](https://github.com/raydocs/tono/issues/555)。分支
  `fix/helper-orphan-app-gone-20260924`，叠在 #550（H19-O-F4）与 H19-O-F6 分支之上；未合 main。
- **缺陷修复**：Helper 是 `/Library/LaunchDaemons` 下 RunAtLoad + KeepAlive 的 daemon，每次启动都由
  `restoreAtLaunch` 重新加载已 arm 的 PF 状态，从不检查还有没有 Tono App。用户在保护开启时退出（设计上保留）或
  崩溃后，把 Tono.app 拖进废纸篓（macOS 唯一的移除方式），此后每次开机都断网，唯一的恢复说明在已删除的 App 里。
  现在每次 Helper 启动（执行器恢复之后、开 socket 之前）检查：`/Applications` 里没有 Tono（按登记名
  `Tono.app`，或任何声明 `com.raydocs.tono` 的改名副本），并且更新账本里没有未完成的尝试时，按
  `--emergency-reset` 同一路径先停残留 Core、恢复 DNS、解除 PF，成功后撤回 pf.conf 挂钩与备份、删除安装文件，
  最后 `launchctl bootout` 卸载自己。
  **临时产品决定（取更严、不泄漏的一侧，待所有者确认）**：只要 App 可能回来就保持 fail-closed——App 仍在
  `/Applications`、或有未完成的更新可能把它放回、或 `/Applications` 读不出来，都不释放；只在 Helper 启动时判断，
  运行中 App 被移走不会立刻打开出口，要等下次重启。移除后留给用户的出口是“重启一次”，不依赖已删除的 App。
  废纸篓里的 App 不算“仍可用”：Helper 不检查 `~/.Trash`（受 TCC 保护，daemon 无法可靠读取）。
  Helper 协议版本 4.42.0 → 4.43.0（临时编号，合并时按顺序重编号），`CONTRACT.sha256` 按构建脚本清单重算。
- **新增/优化**：`--emergency-reset` 的移除步骤抽成 `removeHelperInstallation()` 与启动释放共用，行为不变。
- **工程与测试**：`--update-self-test`（root，CI privileged-tests）新增一例，用临时 Applications 目录与临时账本驱动
  `releaseIfTonoWasRemoved`：改名的 Tono 副本、未完成的更新、读不出的目录都不释放；无 App 且无未完成更新时释放。
  先推送只含测试与恒返回 false 的函数（即现状）的提交让 CI 变红，再推修复。
- **验证**：本机（编辑机）未编译；以本 PR 的 GitHub-hosted `macos-26` CI 为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在实机上删除 App 并重启验证；`launchctl bootout` 由 daemon 自己发起、在 SIGTERM 下结束自身
  的时序，以及“登录项与扩展”对删除 App 后这个旧式 daemon 的处理都需要实机确认。自测不执行真实的
  DNS/PF 释放与 bootout（复用已有的 `runEmergencyDisarm`）。开发机若只从 DerivedData 运行 App、`/Applications`
  没有 Tono，重启后 Helper 会自行移除，下次打开需重新授权安装。用户替换 App 的同一秒 Helper 恰好重启时，
  会按“已移除”处理。
- **2026-09-24 审查跟进**（MA-Codex-1 = MA-GROK-1，P2；MA-Codex-2，P3）：修复——原先只看 `/Applications`，
  把运行中的 App 移到 `~/Applications` 后 Helper 一重启就释放保护并移除自身（取代上文“运行中 App 被移走……要等下次
  重启”）。现在以下任一都算 Tono 仍在：有进程满足 Helper 的客户端签名要求（`TonoPeerAuthorizer.clientRequirementText`，
  先按 `*.app/Contents/MacOS/Tono` 路径筛选；存活但查不到签名的也算在）；绑定用户的 `~/Applications` 里有 Tono.app 或
  改名副本（该目录不存在则跳过，其他读取失败算在）。P3：`.app` 的 Info.plist 缺失、读不出或解析失败一律算 Tono 在。
  4.43.0 仍未发布，按 b6b8df0d 的先例只改版本说明并重算 `CONTRACT.sha256`，不再升号。测试：`--update-self-test`
  新增一例（运行中的客户端、`~/Applications/Tono.app` 都不释放；托管 runner 上真实进程扫描必须为 false），原例改为
  显式注入空的用户目录与“无进程”，保持与宿主无关。验证：本机未运行（不做本机 Swift 编译），以 PR CI 为准。
  剩余限制：P3 按更严一侧处理，`/Applications` 里任何没有 `Contents/Info.plist` 的 `.app`（例如 Apple 芯片上的
  iOS 包装 App）都会让 Helper 不再自行移除，只能用 `--emergency-reset`；只看绑定用户的 `~/Applications`。
- **2026-09-24 第二轮跟进**（核验方 Codex 指出，Opus 读码确认，P2）：修复——`proc_pidpath` 失败时原先直接跳过，
  没有确认进程已退出。现在进程扫描抽成 `tonoClientAmong`：路径或签名查询失败而进程仍存活（`proc_pidinfo`
  BSD 信息可取且非僵尸）即算 Tono 在，只有已退出的 pid 才跳过。测试：扩展原 `--update-self-test` 用例，注入
  “路径查询失败且存活”“签名查询失败且存活”必须保留保护，“已退出”“签名不符”不算。验证：本机未运行，以 PR CI 为准。
  剩余限制：仓库里没有 App 之外可取得的 macOS 恢复说明（`--emergency-disarm/--emergency-reset` 只写在 App 的支持页），
  因上述更严规则而不能自行移除的机器，在删除 App 后只能由支持人员提供命令；托管 runner 上若有存活但路径查询失败的
  进程，真实扫描断言会失败，这同样意味着该类机器上 Helper 不会自行移除。
- **2026-09-24 第三轮跟进**（核验方 Codex 指出，P2）：修复——存活查询的任何失败都被当成“已退出”，签名校验的任何
  非成功结果都被当成“不是 Tono”。现在只有确定的结论才跳过：`proc_pidinfo` 返回 ESRCH、`kill(pid, 0)` 返回 ESRCH
  或进程为僵尸才算已退出；只有 `errSecCSReqFailed` 才算签名不符。其他查询错误（含未签名、签名失效、代码对象
  不可读）一律视为不确定，按存在处理。测试：扩展同一 `--update-self-test` 用例，注入“存活查询出错”“签名校验出错”
  必须保留保护，“确定已退出”“确定不符”才跳过。验证：本机未运行，以 PR CI 为准。剩余限制：`*.app/Contents/MacOS/Tono`
  路径下未签名或签名失效的存活进程也会阻止 Helper 自行移除。
- **2026-09-24 第四轮跟进**（mac2 train PR #605，run 36040386937，privileged-tests 失败，与上文预警一致）：修复——
  CI 主机上有存活进程的路径/签名查询失败，被当成 Tono，真实扫描断言失败；真机上同样会让 Helper 永不自行移除。
  现在只有内核短名（`proc_name`，即 p_name/p_comm，由 exec 按可执行文件名设定，删除 bundle 不改变）等于 `Tono`
  的进程才是候选；非候选即使查询失败也跳过。候选的路径或签名查询不确定时仍按存在处理；确定已退出或
  `errSecCSReqFailed` 才跳过。测试：扩展同一用例，加入“非候选且查询全失败”“名称查询失败”必须跳过；真实扫描断言保留。
  验证：本机未运行，以 PR CI 为准。剩余限制：存活进程的名称查询本身失败时按非候选跳过（不能再算作存在）；
  被改名为别的短名的 Tono 可执行文件不被识别（改名会破坏签名，正常安装不会出现）。

## 2026-09-24 · macOS 内部候选版默认发送分类连接失败记录

- **归属/来源**：G1–G3 候选验收的现场证据；影响 macOS App（`AccountSession`、设置页、Info.plist）、
  `package-macos-test.sh` 与 `macos-release.yml` 的 `candidate_only` 路径。所有者决定 2026-09-24：内部候选/测试版默认开启
  分类连接失败遥测，公开发布版保持现状（关）。基线 origin/main [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，
  分支 `fix/mac-candidate-telemetry-20260924`，Issue #576，未合 main。
- **缺陷修复**：无（行为变更来自所有者决定）。
- **新增/优化**：a68d4e76 起 `reportConnectFailure` 与保护快照共用默认关闭的同意开关，升级时 v2 迁移会把旧的开启重置为关；
  候选签名路径与正式发布构建同一 Release 配置，包内没有渠道标记，测试者失败连接从未到达运维。现在：构建设置 `TONO_BUILD_CHANNEL` 展开到 Info.plist `TonoBuildChannel`，只有 `candidate_only` 签名运行设为
  `internal`；打包脚本校验产物中的渠道与请求一致（公开版必须为空）。内部版在未开启快照时也发送分类记录（阶段、错误代码、版本、
  节点、OS、传输、路径延迟），错误原文与 Core 日志行仍只在用户显式开启后附带。默认值来自包而不是 UserDefaults，v2 重置无法在升级时
  关掉它。内部版设置 → 隐私显示一行提示（含简体中文）。公开版逻辑不变。
- **工程与测试**：一个 XCTest（`testInternalBuildsKeepClassifiedFailureReportsThroughTheUpgradeReset`）。
- **验证**：本机 `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 通过、`sh -n package-macos-test.sh` 通过、
  xcstrings JSON 可解析；Swift 未在本机编译（按执行位置规定），以 PR CI 的 XCTest 为准，红→绿运行号见 PR。
- **候选/发布**：无新包，仅源码；下一次 `candidate_only` 签名运行才会带内部标记。
- **剩余限制**：未在真实签名候选包上验证提示与上报；快照窗口本身仍默认关闭；
  维护者本地用 `package-macos-test.sh` 打的测试包需显式 `TONO_BUILD_CHANNEL=internal` 才算内部版。
- **2026-09-24 审查跟进**（DG-OpenAI-1/DG-grok-1，P2）：修复——内部版原先没有任何关闭方式（快照开关默认即关，不能兼作退出）。
  新增独立键 `internalFailureReportsOptedOut`，`failureReportScope` 在内部版且已保存退出时返回 nil；设置 → 隐私的提示行改为
  开关「连接失败上报」（默认开，含简体中文）。已开启快照的用户仍按快照同意发送完整记录。测试：一个 XCTest
  （`testAnInternalBuildsSavedOptOutStopsClassifiedFailureReports`；旧代码无该键与参数，编译失败，旧逻辑对内部版恒返回
  `.classified`）。验证：本机未运行（不做本机 Swift 编译），以 PR CI 为准。剩余限制：开关只控制内部版默认上报，不影响快照。
- **2026-09-24 第二轮跟进**（核验方 Codex 指出，Opus 读码确认，P2）：修复——同意只在入口检查一次，已通过检查的报告
  在等待 token 刷新或网络重试期间用户关闭开关后仍会发送。现在 `reportConnectFailure` 把
  `failureReportStillAllowed` 作为 `requestIsCurrent` 传给 API，每次发送前重读开关（完整记录还要求快照同意仍开）。
  测试：一个 XCTest（`testAPendingFailureReportStopsOnceTheUserOptsOut`，旧代码无此判定）。验证：本机未运行，以 PR CI 为准。
  剩余限制：已发出的请求不撤回。

## 2026-09-24 · macOS 睡眠后唤醒重连获得新的重复失败预算

- **归属/来源**：G1 连接恢复；macOS `AppState.prepareForSystemSleep()`。内部审查 H18-G-F1（交叉厂商核实降级为
  已暂停会话的恢复预算问题，非永久锁死），Issue #542。基线 origin/main 8dc79a5b → 分支
  `fix/macos-wake-reconnect-budget-20260924`；提交时未合 main。
- **缺陷修复**：同一失败（阶段 + 文案）连续三次后，保护重连暂停自动重试。睡眠只清显示用的尝试次数，
  保留失败计数和签名；唤醒 `connect()` 只清暂停标志。睡前已有两三次同样失败的 Protected Offline Mac，
  唤醒后第一次同样失败就再次暂停，唤醒任务已返回，没有任何重试在排程（PF 保持，不泄漏），要等网络变化
  或用户点 Retry now / Restore internet。现在睡眠把会话交给唤醒恢复时，清掉重复失败计数、签名和可由网络变化
  解除的暂停，与网络变化 kick 的处理一致；需要用户处理的暂停（管理员授权被拒、helper 被拒）保留；显式
  Restore internet 进行中时睡眠在此之前返回，行为不变。
- **新增/优化**：无。
- **工程与测试**：`AppStateSleepTests` 新增一个 XCTest `testSleepGivesWakeAFreshRepeatedFailureBudget`：
  Protected Offline、PF 未武装（睡眠排程的 bootstrap 收紧在未武装时直接返回，不触达 helper）、同一失败三次
  且可由网络变化解除的暂停；调用 `prepareForSystemSleep()`，断言计数归零、签名清空、两个暂停标志清除、
  唤醒恢复仍被请求。只含测试的提交 a1cf8692 在 GitHub-hosted macOS CI run
  [35981761856](https://github.com/raydocs/tono/actions/runs/35981761856) 实际跑红：只有该测试失败
  （计数仍为 3、签名保留、两个暂停标志保留）。
- **验证**：本机（编辑机）未运行 xcodebuild/swift；TonoTests 委托本 PR 的 GitHub-hosted `macos-26` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：测试驱动睡眠一侧的状态，未模拟唤醒后的实际重连与失败；睡眠通知丢失（只收到唤醒）时不重置。
  唤醒后首次失败文案与睡前相同的频率未在实机测量。唤醒 `connect()` 会清除需要用户处理的暂停标志，这是既有行为，
  本修复不改。

## 2026-09-24 · macOS 续期时钥匙串读取失败不再当成会话被拒

- **归属/来源**：G2 客户端账户状态；macOS `TonoAPIClient` 刷新令牌读取、`KeychainStore`。内部审查 H18-O-F3
  （交叉厂商核实 confirmed，启动变体收窄），Issue #540。基线 origin/main 8dc79a5b → 分支
  `fix/macos-keychain-read-error-20260924`；提交时未合 main。
- **缺陷修复**：access token 过期（1 天）后续期要读钥匙串里的 refresh token。`currentRefreshToken()` 用 `try?`
  读取，钥匙串锁定或不允许交互等任何非 `errSecItemNotFound` 状态都变成 nil，`refreshAccessToken()` 随即抛
  `.unauthorized`，请求没发到服务端。于是周期账户重读把正常账户置为 `.suspended`；启动恢复（第一次读成功、
  续期时第二次读失败）和遥测上传走账户丢失路径，删掉仍有效的 refresh token 并登出。现在只有"条目不存在"
  表示无会话；其他钥匙串状态作为本地可重试错误抛出：账户重读和遥测按瞬时失败等下个周期，启动恢复进入
  普通错误页（PF 保持），都不置 suspended、不登出、不释放保护。登出路径读不到令牌时仍只删本地副本，行为不变。
- **新增/优化**：无。
- **工程与测试**：`KeychainStore` 增加 `SecItemCopyMatching` 注入点（默认值不变）。新增
  `RefreshTokenReadFailureTests.testUnreadableRefreshTokenDoesNotSuspendTheAccount`（一个 XCTest）：
  读取返回 `errSecInteractionNotAllowed`，内存中无 access token，调用 `refreshAccount()`；断言状态仍为 `.ready`
  且没有发出任何请求。只含注入点和测试的提交 c70616cd 在 GitHub-hosted macOS CI run
  [35981508237](https://github.com/raydocs/tono/actions/runs/35981508237) 实际跑红：只有该测试失败，
  `("suspended") is not equal to ("ready")`。
- **验证**：本机（编辑机）未运行 xcodebuild/swift；TonoTests 委托本 PR 的 GitHub-hosted `macos-26` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：哪些实际钥匙串状态（睡眠锁定、智能卡、钥匙串密码不同步）会触发未在实机测量。启动恢复遇到该错误显示
  通用错误文案（`KeychainStore.Error` 没有本地化描述），需用户点重试。#516、#535 给 `.unauthorized`/`.suspended` 增加
  后果，本修复与它们无文件重叠。

## 2026-09-24 · macOS Helper 完整移除时撤回 /etc/pf.conf 挂钩并删除 .tono-backup

- **归属/来源**：G1 连接保护（移除后恢复原状）；macOS `tono-core-helper`。内部审查 H19-O-F6（跨厂商核实：
  降级为残留问题），Issue [#551](https://github.com/raydocs/tono/issues/551)。分支 `fix/pf-hook-removal-20260924`，
  叠在 #550（H19-O-F4，`fix/helper-recovery-no-user-20260924`）之上；未合 main。
- **缺陷修复**：首次 arm 会在 `/etc/pf.conf` 写入带标记的挂钩（`# BEGIN/END TONO KILL SWITCH`），并保存
  `/etc/pf.conf.tono-backup` 与 `/etc/hosts.tono-backup`；`--emergency-reset` 解除保护后只删除 plist、allowed-uid
  和两个可执行文件，挂钩与两个备份永远留下。现在 reset 在 PF 已释放之后，只去掉标记块（及首次 arm 在其后
  留下的空行），保留标记外的每一行，不把旧备份覆盖回去；挂钩去掉后再删除两个备份（标记损坏时保留备份以便
  手工修复）。这一步失败只报告，不阻止移除：留下的挂钩只加载已解除的空锚点文件。普通 disarm 不变，仍保留挂钩。
  Helper 协议版本 4.41.0 → 4.42.0（临时编号，合并时按顺序重编号），`CONTRACT.sha256` 按构建脚本清单重算。
- **新增/优化**：无。
- **工程与测试**：把 arm 对 `/etc/pf.conf` 的纯文本变换抽成 `hookedMainConfiguration`（行为不变），
  `--lifecycle-self-test`（root，CI privileged-tests）第 8 段在临时目录用一次 arm 与两次 arm 的真实输出加上
  用户后加的一行做夹具，断言移除后恰好回到“原文件 + 用户行”，且两个备份都被删除。先推送只含测试与空实现的
  提交让 CI 变红，再推修复。
- **验证**：本机（编辑机）未编译；以本 PR 的 GitHub-hosted `macos-26` CI 为准。本机用 Python 按同一算法模拟了
  默认 pf.conf 的一次/两次 arm 往返。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在实机上跑 reset；自测不覆盖 `runEmergencyResetLocked` 的接线本身（它需要真实安装）。
  没有重载内核里的主规则集（下次开机按去掉挂钩的文件加载），也没有删除 `/Library/Application Support/Tono`
  下的状态文件。文件无尾换行、或挂钩位于没有任何 anchor/pass 行的文件末尾时，结果可能多一个空行或尾换行。

## 2026-09-24 · macOS 绑定用户被删除后，Helper 紧急恢复命令仍能释放保护

- **归属/来源**：G1 连接保护（恢复出口）；macOS `tono-core-helper`。内部审查 H19-O-F4（跨厂商核实：confirmed），
  Issue [#545](https://github.com/raydocs/tono/issues/545)。基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b) → 分支 `fix/helper-recovery-no-user-20260924`；未合 main。
- **缺陷修复**：`--emergency-disarm`（以及调用它的 `--emergency-reset`）在恢复 DNS、解除 PF 之前先构造
  `CoreManager`，它的初始化用 `getpwuid` 解析绑定用户的 home 目录。绑定的 macOS 账户被删除后解析失败，两条文档化
  恢复命令都只打印“PF remains fail-closed”，reset 也不会移除安装。现在 `CoreManager` 初始化不再查账户，只在
  start/sync 校验配置目录时解析 home；恢复仍用原有的 pid 文件加进程身份核对停止残留 Core。Helper 协议版本
  4.9.0 → 4.41.0（临时编号，合并时按顺序重编号），`CONTRACT.sha256` 按构建脚本清单重算。
- **新增/优化**：无。
- **工程与测试**：`--core-lifecycle-self-test`（root，CI privileged-tests）新增一段：为一个不存在的 uid 构造
  `CoreManager` 必须成功，且为它启动 Core 仍被拒绝。先单独推送测试提交让 CI 变红，再推修复。
- **验证**：本机（编辑机）未编译、未运行 swiftc/xcodebuild；结果以本 PR 的 GitHub-hosted `macos-26` CI 为准
  （Helper 构建 + `--self-test` + root 自测）。本机只按 `build-core-helper.sh` 的同一清单重算了 `CONTRACT.sha256`。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在实机上删除账户验证。绑定用户不存在时 daemon 本身仍无法启动（`SocketServer` 需要该用户的组），
  App 侧也无法修复；本修复只保证文档化的 root 恢复命令可用，`--emergency-reset` 之后重新打开 Tono 会按当前用户重装。

## 2026-09-24 · Windows 合并列车 train/win-20260924

- **归属/来源**：G1–G3 Windows 修复汇合（各 PR 归属见其自身条目）；基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b) → 分支 `train/win-20260924`，逐个
  `--no-ff` 合入 40 个 PR（顺序与 head SHA 见列车 PR 正文）；提交时未合 main。
- **缺陷修复**：无新增；各修复见对应 PR 条目。
- **新增/优化**：无。
- **工程与测试（合并时手工解决的冲突）**：
  - #359/#361 × #396：按 R4 审查，把 #359 的 `Replaced` 归档分支与 #361 的 RolledBack/Uncertain
    逐成员 `old_digest` 校验移进 #396 的 `retire_after_release`（组件用注入的 `installed` 读取；
    #361 现版 `plan_members_at` 返回 `Result<bool>`，按 `ensure!(…?)` 调用）。
    `UPDATE_PROTOCOL_V1.md` 取 #361 的 Terminal archives 新文字，删掉旧文字的三行碎片（R4 C3），
    保留 #396 的簿记条目。
  - #471、#460、#508、#345：相邻新增测试两边保留；#460 的测试 `use` 列表取并集。
  - #345 × #343：WFP `FILTER_NAMESPACE` 按两 PR 的约定取 v11（`…9e0a…`；#343 为 v10），注释合写；
    `intent_floor` 同时保留 #345 的 DHCP 出站目的地限制与 #343 的入站默认拒绝。
  - 本文件两边保留；修正一次合并把 #342 条目标题与正文拆开的问题。
- **验证**：编辑机（MacBook）未运行 cargo 或原生构建。本机只跑前端与脚本检查：`apps/windows/app`
  `tsc --noEmit` 通过；`vitest run` 36 个文件 283 项通过；`test:dev-control` 103 项通过；
  `windows-ci-paths.test.cjs` 12 项、`desktop-update-v1.test.mjs` 4 项通过；`generate-i18n-keys`
  重新生成无差异；`git diff --check` 通过。Rust 编译与测试以列车 PR 的 GitHub-hosted Windows CI 为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未合入 #203（draft）、#300（2 条未解决的 review thread）、#305（叠在 #300 上）、
  #352（PR 正文要求先取得设备 `icacls` 证据），以及在途、新开或 CI 未绿的 PR（见列车 PR 正文）。
  没有实机验收。
- **续记（2026-09-24，TW-anthropic-1，P1，Codex 复核确认）**：分支 `fix/win-train-20260924`
  （基于列车头 `b4ff7538`，PR #572）。
  - 缺陷修复：#343 引入、#354 加重——保护一旦武装，物理网卡没有 RDP 入站例外，已验证 intent
    开机重装；断开的 RDP 所有者仍算已登录（其他用户 1014），Service 在线时紧急解除拒绝执行。
    只靠 RDP 管理的电脑按下连接就会切断自己的远程会话且无法远程恢复。现在 `StartClash` /
    `PrepareCoreStart` 在生命周期锁内、任何副作用之前检查**调用方**会话：取命名管道内核报告的
    peer PID（`AuthenticatedOwner::peer_pid`），`ProcessIdToSessionId` 后查该会话的
    `WTSClientProtocolType`（0 = 控制台，其余为远程），不看 Service 自己的 Session 0。远程或读不出
    会话、且调用方尚未持有已武装保护时，返回新错误码 1015 `RemoteSessionConnectRefused`（409）。
    App 映射为 `TONO_REMOTE_SESSION_CONNECT_REFUSED` 并显示中英文专门提示；1014 的 Service 文案与
    界面文案改为可操作的恢复步骤（原所有者在本机点「断开」或注销；否则本机管理员先停止
    TonoService，再以管理员身份运行「恢复网络」开始菜单快捷方式）。断开的会话仍算已登录，
    不新增任何非特权解除路径。
  - 产品决定（暂定，待所有者复核）：采用更严格的选项 (b) 拒绝远程会话首次连接；不采用 (a)
    局域网 RDP 放行，因其会放宽保护。
  - 工程与测试：一个 Rust `#[test]`
    `core::windows_kill_switch::tests::a_remote_session_cannot_be_the_first_to_arm_protection`
    覆盖纯判定函数（远程/未知且未持有 → 拒绝；控制台 → 放行；已持有已武装保护 → 不变）。
    lifecycle `test` feature 与非 Windows 构建的会话读取固定返回控制台，不改变现有集成测试。
  - 验证：按执行位置规则本机未运行 cargo；Rust 编译与测试待列车 PR 的 GitHub-hosted
    `windows-2025` CI。本机只跑 `apps/windows/app` `tsc --noEmit` 通过，`vitest run`
    `src/services/tono.test.ts` `src/services/i18n.test.ts` 39 项通过，`generate-i18n-keys`
    仅新增一个键。
  - 候选/发布：无新包，仅源码。
  - 剩余限制：已经由远程会话持有已武装保护的现有安装保持原行为（不自动解除，仍 fail-closed）；
    断开状态 RDP 会话的 `WTSClientProtocolType` 取值、Hyper-V 增强会话（RDP 协议但不走网卡，会被
    误拒）均未经实机确认；没有实机 RDP 验收。
  - 续记（2026-09-24，Codex 复核 `50da128d` 为 PARTIAL 后修正）：(1) P2 例外条件过宽——原先只看
    `wanted + owner_key`，但 `ARMED` 在 WFP 安装前发布、安装失败也不撤销，本地首次武装失败后经 RDP
    重试会拿到例外并首次真正武装。现在例外只给调用方自己的**已验证** intent（验证仅在 lock 成功后
    提交，证明屏障确曾安装）；仅有 intent 仍按首次武装拒绝。(2) P2 PID 重用窗口——原先等完生命周期锁
    后才按裸 PID 查会话。现在认证时在已核对 SID 的同一进程句柄/令牌上读取 `TokenSessionId`，存为
    `AuthenticatedOwner::peer_session_id`；gate 只按该会话 ID 查询当前 `WTSClientProtocolType`
    （等锁期间控制台被 RDP 接管也会看到远程）。同一个 `#[test]` 扩展到全部会话 × {无 intent、已验证、
    仅 intent} 组合及他人已验证 intent。验证：本机仍未运行 cargo，待 GitHub-hosted `windows-2025` CI；
    `git diff --check` 通过，改动部分 rustfmt 无新增差异。剩余限制：会话 ID 仅在原会话完全结束后才可能
    被复用，此时原调用进程已退出，未另做处理。

## 2026-09-23 · Windows 发布 workflow 权限最小化（内部审查 H5-F1）

- **归属**：发布工具链加固（SHIP_PLAN 发布前置，非客户可见行为）；`.github/workflows`。
- **来源**：基线 main `498ed426` → 分支 `fix/windows-release-perms-20260923`；Issue #362；
  提交时未合 main。
- **缺陷修复**：`windows-release.yml` 原在 workflow 级给 `contents: write`，运行
  pnpm/Vite/crate 构建脚本和 tauri-action 的 `build-draft` 作业持有可写 token，且
  checkout 把 token 留在 `.git/config` → 现 workflow 级 `contents: read`；`build-draft`
  只构建签名并上传 artifact、记录 SHA-256；新增不运行构建代码的 `publish-draft`
  （唯一 `contents: write`），按摘要复核后创建草稿 Release 并生成 `latest.json`（格式
  与 tauri-action 原输出一致，供 `validate-windows-channel.mjs` 校验）。
  `windows-update-promote.yml` 同样改为只给 `promote` 作业写权限，checkout 不持久化
  token，仅在两次 push（及 fetch/pull）时传入。`control-plane-d1-backup.yml` checkout
  加 `persist-credentials: false`（其 secrets 已是 step 级）。
- **新增/优化**：无。仓库设置不在本 PR 范围。
- **工程与测试**：`tooling/scripts/tests/windows-ci-paths.test.cjs` 新增一个 test：
  两个 Windows 发布 workflow 的 workflow 级无写权限、所有 checkout 不持久化凭据、运行
  pnpm/npm/cargo/tauri-action 的作业无写权限、`publish-draft` 是写作业。旧 workflow
  上失败于 “windows-release.yml grants write at workflow level”。
  `validate-windows-channel.test.mjs` 中“先校验后推送”断言的推送命令字面量随之改为
  `git_auth push origin HEAD:refs/heads/windows-updates`（顺序约束不变）。
- **验证**：MacBook 本机 `node --test tooling/scripts/tests/windows-ci-paths.test.cjs`
  12/12 通过（修复前新增项失败），`pnpm test:dev-control` 98/98；三个 workflow js-yaml 解析 + bash 步骤 `bash -n`；
  本机无 actionlint，未跑。`build-draft`/`publish-draft`/`promote` 只在
  `release/windows` 上 `workflow_dispatch` 运行，PR CI 不执行，需所有者在下一次发布时观察。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Tauri 更新签名私钥仍须注入运行构建代码的作业（`tauri build` 内签名）；
  草稿复用逻辑依赖 `gh release` 按 tag 解析草稿。

## 2026-09-23 · Windows 策略 revision 只认签名内的值（H3-F5 客户端侧）

- **归属/来源**：G1 保护不放宽/签名信任边界；影响 Windows tono-core `policy.rs` 与 App
  `policy_sync.rs`。基线 main 49c82dde，分支 `fix/policy-revision-binding-20260923`；
  Issue #317（含完整设计与过渡方案）；提交时未合 main。
- **缺陷修复**：签名只覆盖 `v1\n + json`，revision 在签名外却是单调闸门；被攻破的 Worker
  或 TLS 中间人可把历史真实签名策略配超大 revision 重放，永久钉住客户端。改后：json 内若带
  `revision` 必须等于信封 revision，否则整份拒绝；只有"签名 Trusted 且 json 内含 revision"才算
  已认证 revision；已认证 revision 无视数值大小替换未认证的当前 revision（已被钉住的客户端
  借此恢复）；一旦装入已认证 revision，未认证文档（未签名或旧 v1 签名）不能再推动闸门
  （按 StaleRevision 静默保持，fail-closed）。缓存播种经 `PolicyTracker::from_cached` 保留
  该状态。主机信任仍只由签名结论与编译期白名单决定，未放宽。
- **新增/优化**：`PolicyTracker::install` 内部改走可注入公钥的 `install_with_key`（生产仍用
  编译期公钥）。
- **工程与测试**：新增回归 `signed_revision_outranks_an_unsigned_revision_pin`。
- **验证**：红灯：只含测试与无行为变化重构的提交在 GitHub-hosted `ubuntu-24.04` Windows CI
  core 作业（run 35842730707）以断言失败（`policy.rs:1227`，265 过 1 败）；修复后结果见 PR CI。
  本机未运行 cargo。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Worker 尚未在 canonical json 中写入 revision、发布工具尚未随 dry run 传
  expectedRevision，因此本修复在服务端落地前处于休眠（旧文档行为与现状相同）；macOS 尚未实现
  同一规则；`sing_box.rs` 的 JSON 键白名单会把带 `revision` 的策略判为 UnsupportedPolicy
  （fail-closed），服务端落地前需同步。均记录在 #317。

## 2026-09-23 · Windows 未签名策略的 media 端点不再放行（H3-F6）

- **归属/来源**：G1 保护不放宽（签名才可扩大绕行面）；影响 Windows tono-core
  （`apps/windows/crates/tono-core/src/policy.rs`）。基线 main 49c82dde，分支
  `fix/windows-unsigned-media-20260923`；Issue #318；提交时未合 main。
- **缺陷修复**：`validate_policy_with_trust` 对 `mediaEndpoints` 不看 `trusted`，未签名
  策略里任意公网 IPv4 都会变成 WeChat 进程名集合的 UDP DIRECT 规则与 WFP 精确许可；macOS
  未签名 IPv4 白名单为空、全部丢弃。改后 Windows 未签名文档的 media 端点一律丢弃，签名文档
  行为不变（仍要求公网 IPv4、非永久保护、非选中节点、端口 443/8000）。
- **新增/优化**：无。
- **工程与测试**：新增回归 `unsigned_policy_cannot_carve_media_endpoints`。测试契约修正：
  `accepts_valid_document_and_normalizes` 原断言未签名 media 被接受（把错误行为写成契约），
  改为在 trusted 下断言规范化；`rejects_media_port_and_duplicate_violations`、
  `rejects_disallowed_and_protected_addresses` 改为 trusted，避免因"未签名全丢"而变成空断言。
- **验证**：红灯：只含新测试的提交在 GitHub-hosted `ubuntu-24.04` Windows CI core 作业
  （run 35842653037）以断言失败（`policy.rs:989`，265 过 1 败）；修复后结果见 PR CI。
  本机未运行 cargo（AGENTS 执行地点约束）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Worker canonical 仍接受未签名任意公网 media（应改为 signatureRequired），
  未在本 PR 处理；非 Windows 11 实机验证。


## 2026-09-23 · Windows 替换式登录先退役前一账户的运行时并丢弃其目录

- **归属/来源**：G1 连接正确性（账户隔离）；影响 Windows App 登录验证与账户采纳。
  Issue #491（R4 组合审查 W4）。基线 main bb2ed4e4，叠在在审 #316（登出丢弃账户目录，提供
  `discard_account_catalog`）与 #410（运行时副本，提供 `remove_legacy_runtime_copy`）之上 →
  分支 `fix/win-replacement-sign-in-20260923`；提交时三者均未合 main，须在 #316、#410 之后合并。
- **缺陷修复**：从 Suspended / Error 界面不登出直接用另一邮箱登录时，`adopt_sign_in_response`
  只替换账户与令牌：前一账户的 `nodes`/`routing`/tracker/`managed-exit-catalog.json`、运行时副本
  以及仍在运行的 Core 都保留。新账户首次同步失败时 Connect 使用前一账户的出口凭据；前一账户
  隧道仍在时新账户界面直接显示 Connected。现在 (1) 采纳任何登录前都丢弃账户目录（内存、
  tracker、缓存文件）并删除运行时副本，首次同步成功前 Connect 没有出口；(2) 验证码校验成功后、
  采纳前，若前一账户的连接处于 Connected/Connecting/Disconnecting，按登出语义先使连接代失效，
  再走 DNS → Core → WFP 顺序释放；释放失败则拒绝采纳，保护保持 armed。仅 armed 的
  Protected Offline（没有运行时）不释放，屏障保持。
- **新增/优化**：无。
- **工程与测试**：新增一个回归 `replacement_sign_in_retires_the_previous_account_before_adopting`
  （`commands/account.rs` lifecycle_tests）；旧代码没有采纳前的退役入口（按构造编译失败），
  若只去掉目录丢弃则 `inner.nodes.is_empty()` 断言失败，若去掉退役则 `released` 断言失败。
- **验证**：本机（编辑机）未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI（app
  workspace `cargo test --locked`），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：释放失败时新账户的服务端会话已签发但未采纳（用户需重新获取验证码）。同账户
  重新登录也会丢弃缓存目录，需要一次成功同步才能连接。未做实机验证。

## 2026-09-23 · Windows periodic telemetry 按账户归属过滤审计事件

- **归属/来源**：G2 遥测/运维证据可信（H3-F3）；影响 Windows App
  （`apps/windows/app`）。基线 main 576d7087，分支 `fix/telemetry-account-window-20260923`，
  Issue [#319](https://github.com/raydocs/tono/issues/319)；提交时未合 main。
- **缺陷修复**：账户 A 登出后约 17 分钟内账户 B 登录，B 的首个 periodic window
  （`telemetry.rs` 只按 22 分钟时间窗读 `traffic-audit.jsonl`）会把 A 的 `connectFail`、
  连接时间线和 `protectedRouteEvidence`（展开为 `protectedRouteInvariantViolation`）用 B 的
  凭据上传。现在每条审计记录在入队时带一个与上传同意无关的 `_accountScope`，periodic
  window 只收当前账户 scope 的记录；无 scope（旧记录、登录前、登出后）或他人 scope 的记录留在
  本机。与 macOS `clearAccount` 清空缓冲的语义对齐。
- **缺陷修复（R4 审查 §1.9）**：初版 scope 是每进程随机 id、不落盘，App 重启（含崩溃后重启）后
  同一账户重启前约 22 分钟内的 `connectFail`/`protectedRouteEvidence`/Protected Offline 证据不再
  上传，比 main 少证据。现在 scope 按账户稳定：`settings.json` 新增 `account_scope`
  `{owner_digest, id}`，只存随机 id 与 `SHA-256("{id}:{账户 id}")`（以随机 id 加盐，不落明文
  邮箱/用户 id），同一账户重启或登出后重登得到同一 scope，其记录继续进入窗口；换账户时摘要不匹配，
  生成新 id 并覆盖（只保留一个槽，A→B→A 时 A 拿到新 scope，A 早先的记录留在本机）。登出
  （abandon）仍立即清空内存 scope，登出期间的记录不带 scope、不上传。settings 文件不可读/损坏时
  不覆盖它，本次运行用不落盘的新 id。
- **新增/优化**：无。本地审计文件内容与原始网络日志上传（`_uploadScope`）不变。
- **工程与测试**：新增一个回归
  `periodic_window_carries_only_the_signed_in_accounts_records`（`telemetry.rs`）；既有
  `collect_events_*` fixture 补上 scope 以适配新签名。旧代码上该测试无法编译（无账户边界），
  即旧实现没有这层过滤。R4 修正扩展同一测试：在同一 settings 目录上重建 `Audit`（模拟重启）后
  同一账户拿到重启前的 scope，重启前后的 `connectFail`+`connectOk` 都被收集，另一账户 scope
  不同且只收自己的记录，落盘的 `account_scope` 不含账户 id；初版分支上重启后生成新随机 id，
  `assert_eq!` scope 即失败。
- **验证**：本机仅对改动文件跑 rustfmt 检查；按执行位置规定未在 MacBook 跑原生
  `cargo test`，以 PR 的 GitHub-hosted Windows CI 结果为准。R4 修正本机未编译、未跑
  rustfmt，委托 CI（windows-2025）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：升级后首个窗口不再携带升级前的无 scope 事件（旧记录无 scope）。重启后同一
  账户的证据现在会继续上传；但 restore 验证账户前、登出期间写的记录不带 scope，不上传；只存一个
  账户槽（A→B→A 丢 A 早先的 scope）。原始网络日志上传的 `network_log_upload_scope.owner` 仍按
  既有实现存明文用户 id，本 PR 未改。即时 `telemetry/failures` 路径沿用 W14 的 admission 身份，
  未改。未实机复现。

## 2026-09-23 · Windows 网络日志上传：服务器明确不存储时停驻，不再重发整段

- **归属/来源**：G2（客户端 3.5 网络日志上传，#138）；Windows App `tono/log_upload.rs`。
  内部审查 H13-F1，Issue #452（macOS 对应修复另开 PR）。基线 main bb2ed4e4 → 分支
  `fix/log-upload-standdown-windows-20260923`；提交时未合 main。
- **缺陷修复**：上传默认开，Worker 只为 ops 打开采集窗口的设备存储，其余返回 200
  `stored:false`，tono-core 映射为 `ApiError::Server { status: 200 }`。上传循环把它当普通
  失败：保留整段、游标不动，按 120 s × 2^min(n,3) 退避后重发同一段（最多 2 MiB gzip），
  无限期，且每次写一条 `NetworkLogSegmentUploadFail` 审计。现在收到不存储回执时丢弃内存中的
  段（服务器已说明未存该键）、游标保持不动、进入停驻：每 30 分钟用不超过 64 KiB 原始数据的
  小段探测一次；只有真正存储的上传才结束停驻。审计只在进入停驻时记一次。tono-core 未改。
- **新增/优化**：无。
- **工程与测试**：`log_upload.rs` 新增一个 `#[test]`
  `a_not_stored_receipt_stands_down_to_a_small_probe`：1,200 行日志首段被拒后，下次间隔为
  停驻间隔，下一段不超过 64 KiB，游标与序号不变。旧代码下被拒段原样保留并重发（新测试
  引用的 `decline` 与间隔函数在旧代码中不存在）。
- **验证**：本机（编辑机）未运行原生 cargo；Tauri crate `cargo test` 委托本 PR 的
  GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：停驻状态只在内存中，App 重启或重新登录后第一次仍会发一个完整段。ops 打开
  采集窗口后最长约 30 分钟才开始上传。识别依赖 tono-core 把不存储回执映射为 status 200
  的现有约定。实际上行字节量需实机抓包确认。

## 2026-09-23 · Windows 网络切换后 DIRECT 仍绑旧网卡时不再原地保持

- **归属/来源**：G1 连接可靠性；Windows App 连接监控（`connection/monitor.rs`、
  `connection_health.rs`、`connection/platform.rs`）。内部审查 X2-1，Issue #461。基线 main
  bb2ed4e4 → 分支 `fix/direct-rebind-20260923`；提交时未合 main。
- **缺陷修复**：可选 DIRECT 出站按连接时抓到的网卡名写死 `interface-name`，之后不再重取；
  网络变化后只要隧道探针成功就原地保持 Connected（事件探针分支与 `RecoveredInPlace` 两处）。
  在两块网卡间切换（如拔网线由 Wi-Fi 接管）且旧网卡断开时，隧道已在新网卡恢复，DIRECT 新连接
  仍拨向旧网卡而失败，界面却一直显示 Connected + DIRECT on。现在记录已提交 DIRECT 所绑网卡
  （`applied_direct_interface`），原地保持前用纯函数 `may_recover_in_place` 判断：该网卡已不在
  "带 IPv4 默认路由、运行中的硬件网卡"列表里（或读不到列表）时，改走既有的受保护拆除 + 重连
  （`Stop(false)` 在 Service 锁内收紧 WFP，新事务在首次 Core 启动前重新探测网卡）。网卡列表
  不经 `GetBestRoute2`（TUN 起来后它会解析到 Tono 自己的网卡），沿用同一硬件/虚拟网卡过滤。
  没有 DIRECT 的全隧道会话不读网卡、行为不变。保护不放宽。
- **新增/优化**：无。
- **工程与测试**：新增一个 `#[test]`
  `connection_health::tests::a_direct_overlay_bound_to_a_lost_adapter_cannot_recover_in_place`
  （绑定 Ethernet、可用出口仅 Wi-Fi、隧道探针成功 → 不得原地保持）。旧代码的原地判定只看隧道
  探针（相当于 `tunnel_proven`），该用例在旧语义下失败：本机用 `rustc --test` 单独编译该纯函数
  与测试，旧语义红、新实现绿（非 cargo 构建，仅证明谓词）。`detect_physical_interface_windows`
  的逐网卡判断抽成共用 `hardware_uplink_alias`，选择行为不变。
- **验证**：本机为编辑机，未运行 cargo/Tauri；Windows 编译与 `cargo test --locked`（src-tauri）
  委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。未做实机切网验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Mihomo `interface-name` 在 Windows 上网卡失去路由后的实际拨号行为仍需实机
  确认（Issue #461 的三步清单）。已提交网卡若只靠拆分路由（非 0.0.0.0/0）出网，每次网络事件都会
  重建一次（罕见配置）。DIRECT 提交完成之前到达的网络事件仍按旧逻辑判定（此时尚无已提交网卡）。
  重建期间界面短暂显示 Protected Offline。

## 2026-09-23 · Windows 凭据库里的会话只由创建它的安装使用，卸载删除应用数据时一并删除

- **归属/来源**：G1 账户隔离；影响 Windows App 凭据加载、登录采纳与 NSIS 卸载器。内部审查
  H11-F3，Issue #408。基线 main 833c0607 → 分支 `fix/win-uninstall-session-20260923`；
  提交时未合 main。
- **缺陷修复**：refresh token 存在凭据管理器（`refresh-token.tono`），不在应用数据目录里。
  卸载时勾选「删除应用数据」只删 `%APPDATA%`/`%LOCALAPPDATA%` 目录，重装后
  `load_credentials` 无条件读入残留 token，静默恢复为上一账户。现在：(1) 登录采纳时在数据
  目录写 `vault-session.marker`；`load_credentials` 以标记为首选依据读入 vault token。没有
  标记时，数据目录里只要有任一"只有已登录账户才会写"的文件，就视为旧版本留下的本安装会话，
  一次性补写标记并读入，不会把现有用户登出。没有标记也没有这些文件的全新目录不读入 token，
  restore 走未登录路径，其本地登出清理会把残留 token 从 vault 删除。
  - 审查修正（R4 §1.4 问题 1 / W3）：初版只认目录缓存 `managed-exit-catalog.json`。旧版本已
    登录但目录同步从未成功（离线，或 503 `EXIT_IDENTITY_PROPAGATING`）的机器没有目录缓存，
    升级后 token 不读入 → restore `NoToken` → `AccountCloseReason::Missing` → 释放现有 WFP
    保护并本地登出。现在账户痕迹为以下任一文件（均在 Tono 数据目录，路径取自代码常量）：
    目录缓存 `managed-exit-catalog.json` 与策略缓存 `managed-traffic-policy.json`（只由登录后
    的同步写入；策略同步可以在目录同步 503 时单独成功）；节点选择 `selection.json`（选择
    节点或同步替换时写，需要账户目录）；隐私设置 `settings.json`（缺失时按默认值读取、不写
    回，所以全新安装首次启动不会生成；只在设置页切换开关时写，而 guard 只让已登录账户进入
    设置页；登录/恢复会话时若上传同意开启还会写入该账户的日志上传 scope）。未选：
    `logs/traffic-audit.jsonl`（未登录时请求验证码、登录失败也会写审计）；`route-preferences.json`、
    `last-success.json`（只在目录修订已提交后写，而目录修订只在目录缓存写入成功后提交，不增
    加覆盖）。
  (2) 卸载器「删除应用数据」分支执行 `cmdkey /delete:refresh-token.tono`。(3) 更正注释和
  tono-core 常量 `WINDOWS_CRED_TARGET_REFRESH_TOKEN` 的目标名（原写 `tono/refresh-token`，
  实际为 keyring 的 `<user>.<service>`）。
- **新增/优化**：无。
- **工程与测试**：新增一个回归 `fresh_data_dir_does_not_adopt_a_vault_refresh_token`
  （`commands/account.rs` lifecycle_tests）。为此把 vault 读取抽成 `load_credentials_from` 的
  注入参数，生产路径不变。测试先断言无标记目录不读入 vault token（旧实现会读入，断言失败），
  再断言写入标记后可以正常读入；审查修正后同一测试再用一个新数据目录：无标记、无目录缓存、
  只有策略缓存文件，断言 token 被读入。初版分支上这一步会失败：旧判定只看标记和目录缓存，
  两者都不存在即返回"不属于本安装"，token 保持为空。契约修正：`account_names_are_stable` 原本断言错误的
  `tono/refresh-token` 格式，改为断言 keyring 实际目标名等于 tono-core 常量（不新增测试）。
  本机运行 `node --test scripts/windows-packaging.test.mjs`：22/22 通过（只验证模板约束，
  不覆盖 cmdkey 行为）。
- **验证**：本机（编辑机）未编译、未运行 cargo（审查修正同样如此）；委托本 PR 的 GitHub-hosted `windows-2025` CI
  （app 与 tono-core `cargo test --locked`），结果以 PR 页为准。卸载器未在 Windows 11 实机运行。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：卸载不吊销服务端会话（卸载器没有已认证客户端；残留 token 在本机被删除或
  拒用，服务端按正常有效期过期）。UAC 以另一个管理员身份提权卸载时，「current」上下文指向
  该管理员，与现有 `$APPDATA` 删除有同样的限制。dev 通道与正式通道共用凭据名，全新的 dev
  数据目录会清掉正式通道的 vault token（内部通道，已记录）。数据目录在漫游 `%APPDATA%` 下，
  标记会随配置文件漫游，见 #409。旧版本已登录、两种同步都从未成功、也从未写过
  `settings.json` 的数据目录（49e8b2bb 之前不持久化日志上传 scope 的构建上、从未切换过隐私
  开关）仍然没有任何痕迹，升级后照旧走 Missing 关闭，释放保护并登出。审查问题 2（`inner` 锁内
  同步 fs `exists`/`write`，UNC 重定向 `%APPDATA%` 可能卡锁）与问题 3（标记与 vault 写入
  不原子：标记写成功、vault 写失败时，下次启动读入的是旧安装残留 token）本轮未改。

## 2026-09-23 · Windows 不再写入含账户出口凭据的运行时副本，登出时删除旧副本

- **归属/来源**：G1 账户隔离；影响 Windows App 连接阶段与账户关闭。内部审查 H11-F1
  （Windows 部分），Issue #407。基线 main 833c0607 → 分支 `fix/win-runtime-copy-20260923`；
  提交时未合 main。与在审 #316（登出删除目录缓存）互补，互不依赖。
- **缺陷修复**：每次连接和 DIRECT 重载都把运行时写到
  `%APPDATA%\com.raydocs.tono\tono\owned-runtime.redacted.yaml`。所谓 redacted 只抹顶层
  controller `secret`，节点 UUID、Reality 参数和住宅 SOCKS5 用户名/密码原样落盘，登出与
  会话过期都不删。该文件全仓无读取方（运行时经 IPC 交给 Service）。现在 App 不再写这个
  文件（删除 `write_redacted_copy` 及其两处调用）；账户关闭收尾（用户登出、restore 的
  Expired/Missing）和启动 restore 删除旧版本留下的副本（`remove_legacy_runtime_copy`，
  NotFound 忽略，其他错误记日志）。
- **新增/优化**：无。
- **工程与测试**：新增一个回归
  `sign_out_removes_the_runtime_copy_that_holds_the_account_exit_credentials`
  （`commands/account.rs` lifecycle_tests）：数据目录放一份含住宅密码的副本，走用户登出，
  断言文件已删除。旧实现不删，断言失败。
- **验证**：本机（编辑机）未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI
  （app workspace `cargo test --locked`），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：tono-core `OwnedRuntime::redacted_yaml()` 仍只抹 secret，App 已不再调用，
  未改库接口。Service 私有目录 `ProgramData\Tono\users\<sidhash>\runtime*`（仅 SY/BA 可读）
  保留最后一次运行时，不在本条范围。未做实机验证。

## 2026-09-23 · Windows 目录新鲜度纳入 routingSha256

- **归属/来源**：G1 连接正确性（住宅出口授权回收与凭据轮换）；影响 Windows tono-core 目录追踪与
  App 目录同步。分支 `fix/win-catalog-routing-freshness-20260923`，叠在 #316
  （`fix/win-catalog-account-20260923`）之上；Issue #321；提交时未合 main。
- **缺陷修复**：只改 routing 的变更（家宽解绑/改绑、SOCKS5 密码轮换）不动 revision 和 `sha256`，
  Worker 另发 `routingSha256`，Windows 丢弃该字段，tracker 返回 `Unchanged`，`inner.routing` 与缓存
  保持旧值。现在 `ExitCatalogResponse` 解析 `routingSha256`，客户端按控制面同一配方本地计算
  `routing_digest`，下发值存在时必须一致（否则 `InvalidResponse`，与 YAML digest 同级）；tracker 以
  (revision, sha256, routing digest) 为键，routing 变化即安装并写缓存；重启用 `from_cached` 连同
  routing digest 播种。对齐 macOS `catalogRoutingToken`。
- **新增/优化**：无。
- **工程与测试**：新增一个回归 `routing_only_rotation_replaces_routing_at_same_revision`
  （`catalog_sync.rs`），使用控制面配方算出的 `routingSha256` 值；旧代码上编译失败（字段与
  `from_cached` 不存在），行为层面对应旧实现返回 `installed == false`。
- **验证**：本机未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
  `routingSha256` 期望值由本机 Node 按 `catalog.ts` 配方计算。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：已连接会话不因 routing 变化自动重载运行时（与既有 revision 更新一致，下次连接/重连
  生效；macOS 会重载）。未做实机验证。

## 2026-09-23 · Windows 登出丢弃账户目录，同 revision 新正文不再判篡改

- **归属/来源**：G1 连接正确性（账户隔离）；影响 Windows tono-core 目录追踪与 Windows App
  账户关闭。基线 main 244075f2 → 分支 `fix/win-catalog-account-20260923`，Issue #315；
  提交时未合 main。
- **缺陷修复**：控制面 revision 全机群共享、正文与 `sha256` 按账户下发，Windows
  `CatalogTracker::install` 却把「同 revision、不同 digest」判为 `InvalidResponse`，而登出又不清
  `nodes`/`routing`/tracker/`managed-exit-catalog.json`。A 登出后 B 在下一次 fleet revision 前登录时，
  B 的目录被拒，Connect 沿用 A 的 VLESS UUID 与住宅 SOCKS5 凭据；同账户设备凭据重发也会一直拨
  已退役 UUID。现在 (1) 同 revision 不同 digest 按新正文安装（仍须完整校验：digest、节点准入、
  住宅路由），只有 digest 相同才是 `Unchanged`，旧 revision 仍是 `StaleRevision`；(2) 账户关闭
  收尾（用户登出、restore 的 Expired/Missing）调用 `discard_account_catalog`，清内存节点/路由、
  重置 tracker 并删除缓存文件。对齐 macOS。
- **新增/优化**：无。
- **工程与测试**：新增一个回归 `sign_out_discards_the_account_issued_catalog`
  （`commands/account.rs` lifecycle_tests）；旧实现在 `inner.nodes.is_empty()` 断言失败。
  契约修正：tono-core `tracker_same_revision_different_digest_is_invalid` 把错误语义写成契约，
  改为 `tracker_same_revision_different_digest_installs_the_new_body`（不新增测试）。
- **验证**：本机（编辑机）未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI
  （`tono-core` 与 app workspace `cargo test --locked`），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：缓存删除失败只记日志（下一会话首次同步仍会替换）；缓存未记录 owner，restore
  依赖登出/Expired/Missing 收尾清理而非 owner 比对。只改 routing 的轮换（`routingSha256`）另案处理。
  旧 Windows 客户端仍需控制面 bump revision（`catalog.ts` 注释说明不变）。未做实机验证。

## 2026-09-23 · Windows 运行期会话被拒：进入 Suspended，停止周期同步

- **归属/来源**：G2 客户端账户状态与控制面调用；Windows App `tono/catalog_sync.rs`、
  `tono/policy_sync.rs`、`tono/telemetry.rs`、`tono/log_upload.rs`，前端 `pages/tono/login.tsx`
  与 en/zh `tono.json`。内部审查 H13-F3，Issue #459；R4 审查 §1.7 / W1 / W2 的修正。基线 main
  bb2ed4e4 → 分支 `fix/win-account-suspended-20260923`（PR #460）；提交时未合 main。
- **缺陷修复**：套餐到期、流量用尽、账户停用、设备或会话吊销时，Worker 对鉴权路由和
  `auth/refresh` 都回 401。Windows 运行期对此没有任何账户状态变化：catalog/policy 同步对任何
  错误都重试 3 次，每 5 分钟约 8 次必然失败的 refresh，界面一直是 Ready，连接只在出口失败。
  现在 tono-core 自己的 refresh 也被拒后得到的 `Unauthorized` 不再重试，Ready 账户进入已有的
  `Suspended`（与 macOS `.suspended` 一致）：周期同步退出，connect/自动重连已有的守卫拒绝
  suspended 账户，界面转到已有的"账户已暂停"页。保护状态不变：不释放 WFP、不登出；该页已有的
  恢复网络入口照旧。重新登录（或下次启动 restore）重新读取账户。
- **缺陷修复（R4 审查）**：遥测（约 20 分钟）与网络日志上传（2→16 分钟）循环原先只在
  SignedOut/Restoring（日志上传只在代际或账户变化）时退出，Suspended 下继续 401→refresh，日志
  上传每次还写一条 `NetworkLogSegmentUploadFail`。现在遥测复用 `periodic_sync_continues`（语义
  与原条件相同，只多了 Suspended），日志上传用 `periodic_upload_continues`（原代际+账户条件再加
  Suspended）；其他状态的行为不变。登录页：隧道仍是 connected 时不再显示"Internet is blocked /
  Restore network"；由运行期会话被拒进入的 Suspended 改显示中性文案"Session ended / 登录已失效"
  （可能在别处退出、设备被移除或套餐暂停，请重新登录），按钮为"Sign in again / 重新登录"。登录
  验证返回 `suspended` 的套餐暂停场景仍显示原"Account paused / 账号已暂停"。
- **新增/优化**：catalog 与 policy 共用一个重试函数 `run_with_retries`（预算不变：1 次 + 3 次
  重试、间隔 1 s）。
- **工程与测试**：`catalog_sync.rs` 新增一个 `#[tokio::test]`
  `rejected_session_is_not_retried_and_suspends_periodic_sync`：会话被拒的尝试只跑 1 次；Ready
  账户转为 Suspended；周期同步（遥测共用）与日志上传的判定在 Ready 时继续、Suspended 后停止。
  旧代码下同类失败跑 4 次，账户保持 Ready，周期循环不认 Suspended 继续运行；R4 修正前的分支没有
  `log_upload::periodic_upload_continues`，日志上传循环在 Suspended 下继续。前端 `login.test.tsx`
  增加一个 `it`：Suspended + uiState connected + killSwitch.wanted 时显示"Session ended"，不显示
  "Account paused"与"Internet is blocked"（修正前的 login.tsx 下该用例失败，已在本机确认）。
  i18n 生成类型用 `node scripts/generate-i18n-keys.mjs` 重新生成。
- **验证**：本机（编辑机）未编译 Rust、未运行原生 cargo，Tauri crate `cargo test` 委托本 PR 的
  GitHub-hosted `windows-2025` CI，结果以 PR 页为准。前端本机：`vitest run
  src/pages/tono/login.test.tsx` 8/8 通过、`tono-auth-guard.test.tsx` 17/17 通过、`tsc --noEmit`
  通过、biome format 与 eslint 对改动文件无告警。
- **候选/发布**：无新包，仅源码。**发布顺序**：含本改动的 Windows 客户端构建必须在 Worker
  PR #329 上线之后才能发布（先对生产 D1 跑迁移 0079，再部署 Worker）。#329 未上线时，一次
  refresh 响应丢失后的重放直接得到 401，客户端会进入 Suspended（旧行为是静默失败到重启）。
- **剩余限制**：没有 macOS 那样在面板出现/唤醒时自动重探并恢复；续费后需重新登录或重启 App
  （重启走 restore 已有的 401 登出路径）。DIRECT 租约心跳在 Suspended 下不停，仍可能发
  refresh；一次 sweep 进行中被判 Suspended 时，日志上传最多再失败一次后才退出。Suspended 不区分
  子原因，restore 时服务端标记为 suspended 的账户也显示中性的"登录已失效"文案（重新登录后验证
  返回 suspended 才显示"账号已暂停"）。从 Suspended 直接换号登录不清理旧账户的目录/运行时副本
  （R4 审查 W4，未在本 PR 处理）。

## 2026-09-23 · Windows 周期目录/策略同步：长时间睡眠唤醒后只补跑一次

- **归属/来源**：G2 客户端控制面调用；Windows App `tono/catalog_sync.rs`。内部审查 H13-F2，
  Issue #455。基线 main bb2ed4e4 → 分支 `fix/win-sync-missed-tick-20260923`；提交时未合 main。
- **缺陷修复**：300 s 周期同步的 tokio interval 未设 `MissedTickBehavior`，默认 `Burst`。
  合盖 8 h（Modern Standby 下时钟照走）唤醒后，错过的约 96 个 tick 连续交付，每个 tick 跑一次
  catalog 和一次 policy 同步（各最多 4 次），约 192 个鉴权 GET 集中打到 Worker。现在改为
  `Delay`（与连接监视一致）：唤醒后补跑一次，下一次在其后 300 s。
- **新增/优化**：无。
- **工程与测试**：`catalog_sync.rs` 新增一个 `#[tokio::test(start_paused = true)]`
  `periodic_sync_after_long_sleep_ticks_once_not_per_missed_period`：暂停时钟前进 8 h，唤醒
  tick 之后 1 s 内不应再有 tick。旧代码（`Burst`）下第二个 tick 立即返回。
- **验证**：本机（编辑机）未运行原生 cargo；Tauri crate `cargo test` 委托本 PR 的
  GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：S3 睡眠下 tokio 时钟（QPC）是否计入睡眠时间需实机确认；无论哪种，改后最多补跑
  一次。唤醒后的一次补跑仍不加随机偏移。

## 2026-09-23 · Windows 升级恢复在停 Service 前只读判定，已完整发布不再停/起 Service

- **归属/来源**：G3 受保护升级（安装后可用性）；Windows Service 升级执行器
  （`apps/windows/service/src/bin/install_service/update_executor.rs`）。Issue #490（R4 组合审查 C1，
  #301 遗留）。基线 main bb2ed4e4，叠在在审 #361（含 #359，提供逐成员 `plan_members_at` 判定）
  之上 → 分支 `fix/update-recover-no-stop-20260923`；提交时均未合 main，须在 #359、#361 之后合并。
  与 #488（同文件 `register_consumed_recovery` 段）不重叠，合并顺序不限。
- **缺陷修复（源码推导，无保护绕过）**：`--update-recover` 在分类之前就 `stop_windows_service`。
  Replaced 且 successor 未运行（用户在 commit 前关掉新 App，或重启）时，分类为 TargetVerified，
  什么都不改，却已停掉 Service 再重启；重启后的 Service 又为同一 pending 记录 spawn 恢复，形成
  停/起循环，期间 App `adopt()` 撞到停机窗口会失败。现在恢复在停 Service 之前先做只读分类
  （已安装组件 + durable plan 逐成员 New），TargetVerified 只写 Replaced 标记并退出，不停
  Service；NoPlan / Interrupted 仍按原流程停 Service、取得 owner 后再次分类并回滚。停 Service 之前
  的读失败直接退出，不再把记录降为 Uncertain。U1（单次消费）、U3（高水位）、U4（Disconnect 不
  伪造 commit）未触碰：本改动不调用 consume，不改序号，不涉及 Disconnect 分支。
- **新增/优化**：无。
- **工程与测试**：新增一个回归 `update_recovery_keeps_the_service_running_for_a_complete_publication`
  （执行器 tests）；旧代码没有停 Service 前的判定入口（按构造编译失败）。停 Service 后的分类改为
  调用同一只读函数 `classify_installed`，逻辑不变。
- **验证**：本机（编辑机）未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI（service
  workspace `cargo test --locked`），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Replaced 记录仍 pending，每次 Service 启动仍会 spawn 一次恢复执行器（只读分类后
  立即退出），直到 App 收养 successor 或 Disconnect 归档（#359）。未在 Windows 11 实机复现或验证，
  实机验证属 G3 验收范围。

## 2026-09-23 · Windows 更新恢复任务注册失败不再让尝试停在 Consumed（X3-2 后续）

- **归属/来源**：G3 原生升级链；Windows Service 更新协调器（`core/update.rs`）与独立执行器
  （`bin/install_service/update_executor.rs`）。内部审查 X3-2 后续，Issue #484。基线 main
  bb2ed4e4 → 分支 `fix/update-recovery-register-20260923`；提交时未合 main。与 #471（同函数附近）、
  #361（执行器）可能文本冲突，后合并者 rebase。
- **缺陷修复**：ONSTART 恢复任务注册被当成三处的前置条件：执行器 consume 后
  `register_consumed_recovery(&store)?`、Service 启动 `reconcile_before_desired` 先注册再拉起
  `--update-recover`、恢复模式自身也先注册。Task Scheduler 停用/禁止建任务时三处都提前返回，
  尝试停在 Consumed，无进程能推进；更新一直 pending，手动安装/卸载被拒。改后：
  - 首次执行（尚未替换任何文件）：注册失败时不发布（不在没有安全网时做 live 替换），验证已安装组件
    仍等于保留的原始组件后把尝试记为 RolledBack 并返回错误；之后经已验证的 Disconnect 可按既有
    `retire_rolled_back` 归档。
  - 恢复模式与 Service 启动对账：注册失败只记警告，照常分类/回滚、照常拉起恢复执行器。
  U1 单次消费、U3 高水位不回退、U4 Disconnect 不伪造提交均保持；保护不放宽。
- **新增/优化**：无。
- **工程与测试**：新增一个 `#[test]`
  `core::update::tests::unregistrable_recovery_task_rolls_back_the_unpublished_attempt`：consume 后
  注册失败，持久化状态必须是 RolledBack 且高水位仍为 74。旧代码的等价路径（`register_consumed_recovery(&store)?`
  直接返回）使状态留在 Consumed，该断言不成立；新 seam 在旧代码上不存在（编译失败）。
- **验证**：本机为编辑机，未运行 cargo；只对改动文件跑了 `rustfmt --check`（新增代码无差异）。Windows
  编译与该测试委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。未在 Task Scheduler
  不可用的实机上验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Service 无法加载且恢复任务未注册时仍无独立恢复（与现状相同，本 PR 不改）。首次执行注册
  失败后 App 仍保持"更新恢复未完成"提示，直到用户 Disconnect 归档；需实机确认该提示与归档路径。
  只在包含本改动的已安装版本起生效（执行器取自已安装版本）。

## 2026-09-23 · Windows 更新恢复任务按系统目录启动 schtasks

- **归属/来源**：G3 原生升级链；Windows Service 更新协调器（`core/update.rs`、
  `core/update/security.rs`）。内部审查 X3-2，Issue #469。基线 main bb2ed4e4 → 分支
  `fix/update-recovery-sysdir-20260923`；提交时未合 main。
- **缺陷修复**：`register_consumed_recovery` 用写死的 `C:\Windows\System32\schtasks.exe`
  注册 ONSTART 恢复任务。Windows 装在其他盘时启动失败：执行器在 consume 后报错，Service 启动的
  `reconcile_before_desired` 与 `--update-recover` 也都先卡在这一步，尝试停在 Consumed，
  `RolledBack`/`Replaced` 都到不了，更新一直 pending。现在用 `GetSystemDirectoryW` 取系统目录
  （新增 `security::system_directory()`，不写死盘符，也不读可继承的环境变量），命令构造抽成
  `recovery_task_registration(system_directory, attempt_dir)`，参数不变。保护不放宽。
- **新增/优化**：无。同类排查：`apps/windows` 特权代码里没有其他写死 `C:\Windows` /
  `C:\Program Files` 的路径（其余为测试夹具；Program Files 已用 `SHGetKnownFolderPath`，
  NSIS 用 `$WINDIR`/`$PROGRAMFILES64`）。
- **工程与测试**：`windows-sys` 增加 `Win32_System_SystemInformation` feature（不改 Cargo.lock）。
  新增一个 `#[test]`
  `core::update::tests::update_recovery_registration_uses_the_os_system_directory`：真实
  API 返回的目录里有 `schtasks.exe`；系统目录为 `D:\Windows\System32` 时命令程序必须是
  `D:\Windows\System32\schtasks.exe`。旧代码无论系统目录都用 `C:\...`，该断言失败。
- **验证**：本机为编辑机，未运行 cargo；只对改动文件跑了 `rustfmt --check`。Windows 编译与
  该测试委托本 PR 的 GitHub-hosted `windows-2025` CI（"Test native update admission and
  independent executor" 步骤），结果以 PR 页为准。未在系统盘非 C: 的实机上验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Task Scheduler 本身不可用（服务停止等）时，注册仍失败，恢复仍会停在
  Consumed；这是恢复注册顺序的设计问题，本 PR 不改。App 侧自启动 `utils/schtasks.rs` 仍按
  `%SystemRoot%` 取路径（用户权限进程，非特权路径，未改）。

## 2026-09-23 · Windows 更新接管同样作废在途 PrepareCoreStart（H9-F3）

- **归属**：G1 连接生命周期（I1：旧 attempt 的迟到 Service 副作用不得影响新会话）；
  Windows Service IPC（`apps/windows/service`，App 与线型无改动）。
- **来源**：基线 main 18301fc5 → 分支 `fix/update-cancel-release-epoch-20260923`；
  Issue [#390](https://github.com/raydocs/tono/issues/390)，内部审查 H9-F3（#294 × #302
  组合）；PR 见该分支，提交时未合 main。
- **缺陷修复**：原行为：更新接管 `invalidate_connection(false)` 作废 connecting 的
  attempt A 但不 release，Service 的 release epoch 不动；#294 之后 A 被折叠为 Not
  Connected，用户可不经 Disconnect 直接发起 B，B 读到同一 epoch；A 迟到的
  PrepareCoreStart 通过 #302 的门并停掉 B 未验证的 Core（一次莫名连接失败，fail-closed，
  不泄漏）。现行为：Service 另设 attempt epoch，每次显式 release 与
  `UpdateRequest::Prepare`（在锁内、无论随后被拒或接受）都推进；`GET /version` 的
  `release_epoch` 字段报告它，PrepareCoreStart 的门（含 Legacy 到达时快照）比较它，
  错误码仍为 `StaleReleaseEpoch`。StartClash 仍只比较 `RELEASE_EPOCH`：更新不是
  Disconnect，不得让迟到的 arm 回撤，保护不放宽。
- **新增/优化**：无。
- **工程与测试**：`tests/test_owner_lifecycle.rs` 一个回归
  `late_prepare_core_start_superseded_by_update_takeover_cannot_stop_the_successor_core`
  （`#[tokio::test]`）：快照 epoch → 被拒的更新 Prepare → 后继 StartClash → 用旧快照发
  PrepareCoreStart → 断言 `StaleReleaseEpoch` 且 `core_pid` 不变。旧代码下 Prepare 不推进
  epoch，请求被放行并停掉后继 Core，断言失败。同时修正 #302 条目中把更新作废变体列为
  "更窄"剩余限制的过时说法。
- **验证**：本机（MacBook）按 2026-09-14 执行位置决定只编辑与源码自查，未运行 cargo
  构建/测试；回归委托本 PR CI 的 GitHub-hosted `windows-2025`
  （`cargo test --locked --features standalone,client,test`），结果以该 run 为准。修复前
  先红未在本机执行。Windows 11 实机时序未复现。
- **候选/发布**：无新包，仅源码；未触碰 WFP/DNS 规则、`appcast.xml`/`latest.json` 或
  `windows-updates`。
- **剩余限制**：只覆盖更新接管；节点消失、连接事务 240 s 超时、Retry now 等不 release 的
  取消路径仍不推进 epoch（#302 已列）。更新 Prepare 到达前刚准入的新 attempt 会被拒一次
  （fail-closed，重试即恢复）。Prepare 请求未到达 Service（IPC 失败）时无推进。只在
  Service 升级到含本修复的版本后生效。

## 2026-09-23 · Windows 升级恢复判定与回滚退休逐成员校验 durable plan（#301 跟进 2）

- **归属**：G3 受保护升级（安装完整性）；Windows Service 更新事务 + 执行器
  （`apps/windows/service`）+ 协议文档。
- **来源**：基线 main `498ed426`，叠加在 R4-F7 分支 `fix/update-replaced-release-20260923`
  （PR #359，共用 plan 视图）之上 → 分支 `fix/update-plan-member-digests-20260923`；
  Issue #360；PR #361；提交时未合 main，须在 #359 之后合并。
- **缺陷修复（源码推导，无保护绕过）**：`classify_recovery` TargetVerified 与
  `retire_rolled_back` handler 只比较 Tono.exe / tono-core.exe / tono-service.exe 三组件，
  而 durable plan 覆盖整棵 payload 树 + `tono-service.exe` + `core-sha256.txt`（最后成员）。
  发布在二进制之后、后续成员之前中断 → 误判已完整发布（残留旧 pin 可致 Core 启动被拒，
  落入 #358 锁死）；回滚恢复了二进制而某资源失败 → 误判已回滚并归档。改后：新增
  `update_native::plan_members_at`（读 plan 视图，校验 attempt、成员路径位于安装根/
  Service 目录、scratch 路径绑定，逐成员 sha256 等于 old/new digest）；恢复判定
  TargetVerified 额外要求全部成员 == `new_digest`，否则按中断回滚；RolledBack/Uncertain
  退休在 plan 存在时额外要求全部成员 == `old_digest`（无 plan 仍表示未开始发布）。
  R4-F7 的已安装且已释放出口复用同一校验。
- **新增/优化**：无。
- **工程与测试**：新增 1 个 `#[test]`
  `core::update::tests::update_plan_members_gate_recovery_and_rollback_on_every_member_not_three_binaries`
  （真实文件 + 与执行器相同的 plan 序列化形状：末成员仍旧 → New 拒；资源未回滚 → Old 拒；
  全部一致 → 通过）。旧代码无逐成员校验入口（测试无法编译）。既有纯函数测试
  `update_recovery_classifies_publication_by_installed_identity_not_successor_liveness`
  只为新增参数补实参，断言不变。
- **验证**：本机未运行任何 cargo；委托本 PR 的 GitHub-hosted `windows-2025` Service lane
  （`core::update::tests::update_` / `update_executor::tests::update_` 定向枚举）。结果见续记。
  恢复执行器与 Disconnect handler 的接线（SCM、原生组件测量）无单测、未在设备执行。
- **候选/发布**：无新包，仅源码。
- **版本生效**：恢复判定在执行器内，执行器是 Prepare 时从**已装旧版**复制的，故只对从含
  本修复的版本出发的下一跳生效；退休校验在当时运行的 Service 内，取决于 Disconnect 时
  已装 Service 版本。
- **剩余限制**：Windows 11 实机中断恢复/回滚验收仍属 G3 未闭合证据。
- **续记（2026-09-23）**：PR #361 源码 `37074b70`（叠加 `7c6ccf00`）的 GitHub-hosted
  `windows-2025` lane 全绿；service lane 日志确认新增 `#[test]` 与改参的既有纯函数测试运行
  并通过。CI 绿不等于设备验证或已发布。
- **续记（2026-09-23，R4 审查修正）**：审查指出恢复执行器
  `plan_members_at(..).is_ok()` 把成员读取 I/O 错误（共享冲突、AV 暂锁）当成「不是
  target」→ Interrupted → 回滚一次已完整发布并校验过的安装并消耗序号；与 #359 备份部分
  删除组合（审查 C2）可成混合树 + 永久 pending。改后 `plan_members_at` 返回
  `Result<bool>`：`Ok(false)` 仅表示成员已读出且摘要不符，plan 或成员读不到为 `Err`。
  执行器改为 `?` 传播：读不到时在任何回滚之前退出、不动文件，按既有 outcome 路径标记
  `Uncertain`（与三组件读失败一致），下次 recover 重新判定。Disconnect 的 RolledBack/
  Uncertain 退休与 Replaced 释放出口对 `Ok(false)` 与 `Err` 都拒绝（仍 fail-closed，
  记录保持 pending）。测试：扩展同一 `#[test]`——不匹配断言 `Ok(false)`、一致断言
  `Ok(true)`，新增成员路径为目录（存在但打开/读取失败）断言 `Err`；
  旧签名 `Result<()>` 下不匹配与读不到同为 `Err`、执行器 `.is_ok()` 均变 false，测试在旧
  分支无法编译。本机未编译，委托 CI（`windows-2025` Service lane）。剩余限制：读错误若
  持续存在，记录停在 `Uncertain`（Adopt 需 Replaced，要等可读后的 recover 恢复）；审查
  C1（恢复执行器停/起 Service 循环）未在本 PR 处理。

## 2026-09-23 · Windows 升级 Replaced + 已验证 Disconnect 的「已安装且已释放」终态（R4-F7）

- **归属**：G3 受保护升级；Windows Service 更新事务（`apps/windows/service`）+ 协议文档。
- **来源**：基线 main `498ed426`（含 #301）→ 分支 `fix/update-replaced-release-20260923`；
  Issue #358；PR #359；提交时未合 main。
- **缺陷修复（R4-F7，源码推导，非 #301 引入）**：升级已完成并被新 App 收养（Replaced）
  后自动重连失败、用户点 Restore internet → Disconnect 已验证、网络已释放，但 Disconnect
  handler 只归档未消费与 RolledBack/Uncertain，Replaced 永久 pending；此后连接、
  Adopt/Commit、再更新、Quit/登出释放、卸载/重装全部被拒，产品内无出口（不泄漏流量）。
  改后：新增 `Store::retire_released_installation` 归档终态——前提为 execution=Replaced、
  Disconnect 已验证为 Unprotected、请求方经 `authenticate_successor` 证明为注册安装根
  的 target 身份 successor（旧字节 App 仍可 Disconnect 但不能结束 Replaced 事务）、
  已装三组件等于 target 且 durable plan 每个成员 sha256 等于其 `new_digest`。
- **新增/优化**：释放不等于 commit——phase、requiredRecovery、successor 证据与
  consumed/generation 高水位原样进归档，不走 `Committed` 清理路径。备份清理归属：
  该事务之后不会再有 commit 或执行器运行，由 Service 在清空槽位**之前**删除每个 plan
  成员绑定的 `.rollback/.restore/.publish` 副本（路径须等于成员目标+后缀、位于安装根或
  Service 目录；只删普通文件）；否则它们会拒绝下一次升级的 prepare。私有 attempt 证据
  （payload、plan、executor、package）保留。删除失败则事务保持 pending、可重试。
  UPDATE_PROTOCOL_V1.md 澄清节新增该条并删去对应「open」限制。
- **工程与测试**：新增 1 个 `#[test]`
  `update_replaced_attempt_released_by_verified_disconnect_reaches_archive_without_commit`
  （update_transaction.rs）：旧字节 peer 被拒、备份释放失败保持 pending、成功时释放先于
  归档、归档 receipt 未变（phase 仍 InstalledIdentityVerified）、高水位 (74, 92) 保持。
  旧代码上该归档出口不存在（测试无法编译，即无出口本身）。
- **验证**：本机未运行任何 cargo（执行位置决定）；委托本 PR 的 GitHub-hosted
  `windows-2025` Service lane（含 `update_transaction::tests::update_` 定向枚举）。
  结果见续记。Service handler 的原生部分（installed_components、plan 逐成员摘要、
  文件删除）无单测，未在 Windows 设备上执行。
- **候选/发布**：无新包，仅源码。
- **版本生效**：该出口由升级后已安装的**新** Service 执行（Disconnect handler），故只要
  目标版本含本修复即生效，不依赖旧版执行器；从不含本修复的版本升级到不含本修复的版本
  不受益。
- **剩余限制**：Windows 11 实机「升级后重连失败 → Restore internet → 可再连接/再更新」
  未验收；恢复判定 TargetVerified 与 `retire_rolled_back` 的逐成员校验另行修复
  （#301 跟进项 2）；App 侧 Disconnect 二次确认未做。
- **续记（2026-09-23）**：PR #359 源码 `7c6ccf00` 的 GitHub-hosted `windows-2025` lane
  全绿（service / app / app-rust / core）；service lane 日志确认新增 `#[test]` 运行并通过
  （314 passed）。CI 绿不等于设备验证或已发布。

## 2026-09-23 · Windows 更新待处理时显式 Disconnect 不再受墙钟顺序约束

- **归属**：G1 断开与恢复；Windows Service `apps/windows/service/src/update_transaction.rs`。
- **来源**：内部审查 H10-F3，Issue #413；分支 `fix/update-disconnect-clock-20260923`，基线
  origin/main be1c75d2。提交时未合 main。
- **缺陷修复**：原生更新待处理（WFP 仍按记录的恢复义务保持阻断）时，`request_disconnect`
  要求墙钟 ≥ `receipt.updated_at_unix`，`verify_disconnect` 要求墙钟 ≥ `requested_at_unix`。
  系统时间回拨（手动改时间、双系统 RTC、主板电池）后，唯一的产品内出口返回
  `Disconnect clock is uncertain`；已持久化请求的重试也在同一检查上失败；WFP 不放行 NTP，
  时钟无法自愈。改后与 macOS helper 对齐：显式释放不授予任何权限，不比较墙钟；记录的
  请求/验证时间取 `max(now, 上一条持久证据时间)`，证据保持单调，现有 `State` 校验
  （`requested ≥ created`、`verified ≥ requested`）与持久化格式不变，回滚后的旧 Service
  仍能打开该记录。时间判断仍只留在授予权限的路径（`live_attempt`：consume、observe/commit、
  adopt、unpack）。U1 单次消费、U3 高水位不回退、U4 Disconnect 不伪造提交保持不变。
- **新增/优化**：无。
- **工程与测试**：一个 `#[test]`
  `update_transaction::tests::update_explicit_disconnect_releases_after_wall_clock_rollback`：
  待处理 attempt `updatedAt = 1_900_000_010`，墙钟回到 `1_899_999_000` 时请求（含重试）与
  验证成功、重新 open 通过校验、回拨下 `live_attempt` 仍拒绝、未消费记录可退休。旧代码在
  第一次 `request_disconnect` 返回 Err。
- **验证**：MacBook 为编辑/审查机，未运行原生 cargo；回归由本 PR 的 GitHub-hosted
  `windows-2025` windows-ci service job（`update_transaction::tests::update_` 过滤）执行，结果
  以 PR checks 为准。未做实机时钟回拨验收。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：重启后更新仍待处理时 WFP 是否保持阻断取决于 Service 启动对账（需实机）；
  与在审 #359/#361/#396 无同区代码冲突，仅本文件条目位置需按合并顺序整理。

## 2026-09-23 · Windows 更新 Disconnect 释放后的归档失败不再报成「保护仍在」（H9-F2）

- **归属**：G3 受保护升级；Windows Service 更新事务（`apps/windows/service`）+ App 断开路径
  （`apps/windows/app`）+ 协议文档。
- **来源**：基线 main `18301fc5`（含 #295、#299、#301）→ 分支
  `fix/update-release-after-archive-20260923`；Issue #393；内部审查 H9-F2（合并后组合回归）。
  提交时未合 main。
- **缺陷修复**：更新事务停在 `RolledBack`/`Uncertain`（执行器回滚失败或恢复任务尚未复原，
  安装树与原始组件不符）时用户点 Disconnect：Service 先恢复 DNS、停 Core、清 owner、
  `wfp::release()`，之后 #301 的归档校验失败以 Err 返回，路由文案写
  "evidence/protection retained"；App 的 #295 监督者把任何 release Err 当作仍 armed，显示
  Protected Offline，而机器已放开；#299 轮询约 30 s 后才纠正，每次重试都复现（违反 I3）。
  改后：`wfp::release()` 成功之后的更新簿记（owner 代理/保护读回/peer 核对、
  `verify_disconnect`、各归档分支）抽成 `retire_after_release`，失败时记录保持 pending，
  响应为成功并带新字段 `UpdateStatus.needs_attention`（原因文本）；Service Err 现在只表示
  没有完成任何保护释放，路由文案改为 "evidence retained and no protection release
  completed"。App 收到 `needs_attention` 记日志，照常读 kill switch 状态、
  `record_verified_release`，并按原有 `wanted||live` 校验折叠为 Not Connected；只有 Err
  才保持 Protected Offline。`INCOMPLETE` 仍为真，后续 Connect 照旧被更新门拒绝。释放前的
  失败路径、fail-closed 语义均不变。
- **新增/优化**：无。协议为加字段：`needs_attention` 为
  `#[serde(default, skip_serializing_if = "Option::is_none")]`，`UpdateStatus` 不拒未知字段，
  不改 Service revision（参照 #302 的兼容考虑）：旧 App + 新 Service 忽略该字段、收到成功，
  正确折叠；新 App + 旧 Service 字段缺省，旧 Service 仍在释放后返回 Err，行为同修复前，
  由 #299 轮询兜底。
- **与在审 PR 的关系**：#359（Replaced 归档 + 备份清理）与 #361（逐成员校验）都在同一位置、
  释放之后新增 `?` 校验。rebase 到本 PR 后，这些分支应放进 `retire_after_release`，失败即
  自动成为 `needs_attention`，不应在 handler 里再返回 Err。已在两个 PR 上留言。
- **工程与测试**：新增一个 `#[test]`
  `core::update::tests::update_disconnect_archive_refusal_after_release_is_not_a_release_failure`：
  夹具走 Launching → consume → `Uncertain`，请求 Disconnect，注入与原始不符的已安装组件，
  调 `retire_after_release` + `released`；断言返回 Ok、记录仍 pending、execution 为
  `Uncertain`、`needs_attention` 含 "rollback not proven"。旧代码中这段校验内联在 handler 里，
  `ensure!(..)?` 直接返回 Err（测试所需的拆分不存在，在旧代码上无法编译通过）。
- **验证**：编辑机（MacBook）只编辑，未执行本机 `cargo build/test`（按 2026-09-14 执行位置
  决定）。回归交给本 PR 的 GitHub-hosted `windows-2025` CI；提交时结果未知，以 PR checks 为准。
  CI 绿灯不代表已部署或已实机验证。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：新 App 配旧 Service 时仍会出现修复前的约 30 s 误报，直到 Service 升级。
  Service 不可达、JoinError 等"未知"情形仍按 #295 假定 armed（保守，未改）。`Uncertain`
  混合安装树的实机出现频率未知，未实机复现。
## 2026-09-24 · macOS 合并列车（#567）审查跟进：DNS 无法核实时仍做 PF 健康检查

- **归属/来源**：G1 连接保护；macOS `AppState` 连接监控。合并列车 PR #567（`train/mac-20260924`，
  基线 167cbca6）交叉厂商审查的已确认项 TM-OpenAI-1（Opus 核实）、TM-claude-1（Codex 核实）、
  TM-claude-5、TM-claude-3；分支 `fix/mac-train-20260924`；未合 main。
- **缺陷修复**：
  - TM-OpenAI-1（#421 × #458 合并产生）：监控每 12 个周期（约 60 s）先做 Protected DNS 审计、
    再做 PF 健康检查。DNS 读回 `.unverifiable` 时直接 `return .continueMonitoring`，同一周期的
    PF 检查被跳过；Helper 监督进程按持久状态重装 PF（不含本会话直连例外）后，只要 DNS 一直
    读不到，App 就不会发现，界面仍显示已连接。现在 `.unverifiable` 只跳过 DNS 结论，继续执行
    PF 检查；DNS 判定改为穷举 `switch`，其余三种结论行为不变。
  - TM-claude-1：`acceptConfirmedExternalProtectionRelease()`（已确认的外部释放）没有清零
    `consecutiveProtectionRepairCount`，此前累积的修复次数会带进下一次会话，提前触发 3 次暂停。
    现在与“恢复正常网络”、“立即重试”一样清零。
- **新增/优化**：无。
- **工程与测试**：新增注入点 `ProtectionAuditOperations`（主服务、DNS 完整性读取、PF 健康读取；
  生产默认仍走 `PrivilegedRuntimeCoordinator`）。一个 XCTest
  `AppStateCoreMonitorTests.testUnverifiableDNSAuditStillRunsPFHealthCheck`：第 12 个周期，DNS 读回
  `.unverifiable`、PF 健康报告 `repairedSinceArm`，断言本周期停止监控、修复计数为 1、断开并显示
  “Network protection was interrupted…”。旧代码在 DNS 判定处返回 `.continueMonitoring`，会话保持
  连接，第一条断言即失败（按代码推理，未实跑）。TM-claude-1 未加测试（规则 5）。
- **文档**：`HelperManager` 中 `repairedSinceArm` 的版本注释 4.12.0 → 4.16.0（`/killswitch/health`
  在合并列车编号 4.16.0 加入，见 `HelperProtocolVersion`）。#503 条目中“4.40.0 机器不能静默升级到
  4.22.0”的说法已更正；#421 条目中“唤醒不看暂停”的限制已更正（#458 已修）。TM-claude-3：#458 的
  split-DNS 冲突暂停覆盖了 #348 对公司 VPN utun DNS 的 PF 豁免；保留较严格行为（暂停、保留 PF），
  在 `holdProtectedDNSSupplementalConflict`、`KillSwitchPF.swift` 注释和 #348 条目中注明这是暂定
  产品决定。`KillSwitchPF.swift` 只改整行注释，CONTRACT 哈希按 build-core-helper.sh 同一管道重算
  不变（4.22.0 `3f2459e2…`），不需要升 helper 版本。
- **验证**：not run locally per execution-location rule; CI pending（GitHub-hosted `macos-26`
  build + TonoTests）。本机只做了 CONTRACT 哈希的纯文本重算（未编译）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：网络变化核对（`AppState.swift`）与连接流程中的 `primaryNetworkService` 调用仍直接走
  协调器，未接入新注入点。TM-claude-3 待 owner 决定。#567 PR 正文“Deploy / release notes”中的
  4.40.0 说法同样有误，需由 PR 作者更正。

## 2026-09-23 · macOS 启动时删除 0.0.72 遗留的 Mihomo 运行时文件

- **归属/来源**：G1 账户隔离（升级维度）；macOS `ConfigStorage`。内部审查 H15-F4，Issue #504。
  基线 origin/main bb2ed4e4；分支 `fix/legacy-runtime-yaml-20260923`；未合 main。
- **缺陷修复**：0.0.72 把 Mihomo 运行时写在 `Application Support/Tono/config/config.yaml`，
  内含出口参数、住宅 SOCKS5 凭据和 controller secret；0.0.73 起运行时改为 `config.json`，
  旧文件再无任何读、写或删除，升级后永久残留。现在 `ConfigStorage` 初始化（进程启动时首次
  使用）删除该文件。与在审 #411（登出时删除 `config.json`）互补：#411 管新文件的账户边界，
  本条管升级遗留；两者不改同一行。
- **新增/优化**：无。
- **工程与测试**：一个 XCTest `RuntimeConfigTests.testLaunchRemovesThe0072MihomoRuntimeWithItsCredentials`：
  临时目录中的 `config/config.yaml` 被删除，`config.json` 保留。旧代码无此入口（编译失败即失败）。
- **验证**：本机未执行 xcodebuild/swift；回归交给本 PR 的 macos-26 CI（TonoTests），结果见 PR。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：未实机验证；root 所有的 `/Library/PrivilegedHelperTools/tono-mihomo` 旧二进制
  仍残留（不含凭据，仅整洁问题，未处理）。

## 2026-09-23 · macOS 原生更新账本：schema 主版本 + 同主版本忽略新增字段

- **归属/来源**：G3 原生更新 v1（面向 0.0.73 → 0.0.74 起的 N-1 执行器）；macOS
  `tono-core-helper` `UpdateStorage`。内部审查 H15-F6，Issue #501。基线 origin/main bb2ed4e4；
  分支 `fix/update-store-schema-macos-20260923`；未合 main。
- **缺陷修复**：`UpdateStorage.load()` 要求 `canonical(ledger) == bytes`，任何新增键都会被旧版
  执行器副本判成"ledger is corrupt"，而 blocked/corrupt 证据按设计不清理、重装也清不掉。改为：
  先探测 `schemaVersion`（缺省 1）；高于本版主版本时以"written by a newer Tono (schema N)"拒绝并
  保留字节；同主版本若字节不是规范编码，只有在确实存在本版不认识的键、且本版认识的每个键的值都与
  规范重编码一致时才接受（`knownFieldsMatch`）。无新增键的非规范字节仍按损坏拒绝。写入端主版本为
  1 时不写该字段，已有构建照常读取。规则文字在 `docs/UPDATE_PROTOCOL_V1.md`（随 Windows PR）。
- **新增/优化**：无。
- **工程与测试**：一个 helper 自测 `ledger-ignores-additive-fields-and-refuses-a-newer-schema-major`
  （`--update-self-test` 计数 10→11）：顶层与 attempt 加未知键后 `load()` 成功且已知字段不变；
  `schemaVersion: 2` 时以"newer"拒绝并保留原字节。旧实现在第一次 `load()` 报 corrupt。helper 源码
  变更按契约门把 `HelperProtocolVersion` 4.21.0 → **4.22.0（合并列车按顺序编号，重算
  CONTRACT.sha256）**；CONTRACT 以 build-core-helper.sh 同一 sed|shasum 管道重算（先对基线复现
  4.9.0 的记录哈希自证）。
- **验证**：本机未编译 helper、未运行 swift；回归交给本 PR 的 macos-26 CI（契约门 + root
  `--update-self-test`），结果见 PR。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：只对含本改动的执行器生效；本 PR 之前构建的内部候选执行器仍会拒绝任何新增键。
  重编号：本 PR 分支 CI 用过占位号 4.40.0；合并列车改为 4.22.0。装过该 PR 构建（4.40.0）的机器
  **可以**被静默升级到 4.22.0（2026-09-24 更正：原文称“#350 只接受更高版本，需走管理员安装”，
  不成立）。版本准入由正在运行的 helper 执行，而该 PR 构建基于 bb2ed4e4，不含 #350 的
  `helperUpgradeAdmissible`；App 侧只比较版本字符串是否相等，不同即尝试 `/helper/upgrade`。
  装上 4.22.0 之后，才只接受更高版本的静默升级。

## 2026-09-23 · macOS 升级后归档 0.0.72 遗留的更新交接记录

- **归属/来源**：G3 客户升级路径；macOS App。内部审查 H15-F3，Issue #496。基线 origin/main
  bb2ed4e4；分支 `fix/legacy-handoff-macos-20260923`；未合 main。
- **缺陷修复**：0.0.72 的 Sparkle 更新在安装前把 `update-handoff.json` 推进到
  `installStarted`；0.0.73 起不再推进、提交或删除它，但 Dashboard 仍读取它，48 h 过期后
  永久显示"更新未完成，断开后重装"，断开/重装都清不掉。改为启动时（`TonoApp.init`，在
  AppState 读取告警前）识别该记录：当前运行版本 ≥ 记录的 `nextAppVersion`，说明升级已完成，
  把原字节归档到 `update-handoff.history/` 后删除记录；记录目标高于当前版本、内容无法解码或
  版本号不是数字时保持原状（仍按原规则告警）。保护状态不依赖这份记录（启动恢复以 helper
  kill switch 状态为准），不改变 PF 行为。
- **新增/优化**：无。
- **工程与测试**：一个 XCTest
  `testCompletedLegacyUpgradeJournalIsArchivedAndStopsWarning`：0.0.72 写出的已过期
  `installStarted` 记录在 0.0.72 下保留并告警，在 0.0.73 下归档原字节且不再告警。旧代码上
  该入口不存在（编译失败即失败）。`writePrepared` 的归档代码抽成共用私有函数，行为不变。
- **验证**：本机为编辑/审查机，未执行 xcodebuild/swift；回归交给本 PR 的 GitHub-hosted
  macos-26 CI，结果见 PR。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：必须在 0.0.73 发给 0.0.72 客户之前合入，发出后无法从旧版一侧补救。未在真机
  上用 0.0.72 → 0.0.73 Sparkle 升级实测。Windows 同类问题由单独 PR 处理。

## 2026-09-23 · macOS 静默 helper 升级与安装器使用同一准入（H2-F1）

- **归属**：G1 保护完整性（root helper 替换路径）；平台/模块：macOS
  `tooling/scripts/core-helper`（`SocketServer.stageAndUpgrade`）、`HelperProtocolVersion`。
- **来源**：基线 main b1b6fe6c → 分支 `fix/helper-upgrade-admission-20260923`；
  Issue #337；PR 与准确源码 SHA 见 PR，提交本条时未合 main。
- **缺陷修复（内部审查 H2-F1，源码推导）**：`/helper/upgrade` 无需管理员同意就替换
  root helper 和 root sing-box，但缺少另外两条安装路径已有的约束：没有版本下限；
  签名要求缺少 Developer ID CA，也不要求 get-task-allow 不存在；候选没有绑定到发起
  App 的签名封存。修复后：
  - 候选路径必须等于发起 bundle 的 `Contents/Resources/tono-core-helper` 和
    `Contents/Resources/sing-box`。
  - 发起 bundle 本身要通过 `UpdatePackage.verifyCode`（Developer ID，strict，
    nested code）。
  - 源文件和 root 私有副本都复用同一个 `UpdatePackage.verifyCode`，删除了较弱的
    `verifyEmbeddedSignature`。
  - 读取已校验的 root 私有副本的 `--version`。候选版本必须严格高于运行中的
    `HelperProtocolVersion`（三段数字比较，格式不合法时拒绝）。
  - 被拒绝时 App 仍然回退到管理员安装，所以合法降级仍然可以在管理员同意后进行。
  - 审查后补充（#350 第三轮审查）：`--version` 探测只读 stdout，stderr 丢弃。原先复用
    `KillSwitchManager.run`，它把 stderr 合进同一个管道；候选 helper 在 stderr 打出任何
    警告（例如运行时的重复类警告）都会让版本文本变成多行、解析失败，合法升级被拒并退回
    管理员提示。
- **新增/优化**：无。
- **工程与测试**：helper 契约 4.20.0 → 4.21.0（合并列车按顺序编号），并重算 `CONTRACT.sha256`。`--self-test`
  增加 `runHelperUpgradeAdmissionSelfTest`，断言降级和同版本候选被拒、4.9.0 → 4.10.0
  被接受。旧代码没有这个准入函数，所以这项 self-test 在旧代码上无法编译。
- **验证**：本机只做编辑和源码自查，没有运行 swiftc 或 xcodebuild。helper 编译和
  `sudo tono-core-helper --self-test` 由本 PR 的 macOS CI（GitHub-hosted `macos-26`）
  执行，结果以该 run 为准。真实 Developer ID 包之间的静默升级和降级拒绝没有做实机验证。
  审查后补充的 stdout 修正同样本机未编译，委托 CI。
- **候选/发布**：仅源码，无新候选；未改动 PF 规则、`appcast.xml` 和 `latest.json`。
- **剩余限制**：
  - bundle 封存校验和复制之间仍然有文件替换窗口。root 私有副本会再按 Developer ID
    要求校验，并检查版本下限，所以替换进来的文件只能是更新的正式签名 helper。
  - 管理员安装路径本身没有版本下限，这是有意保留的：它需要管理员同意。
  - 测试只覆盖纯比较函数 `helperUpgradeAdmissible`。生产接线没有测试覆盖，也没有实机验证：
    候选路径必须等于发起 bundle 的 `Contents/Resources` 资源、发起 bundle 的封存校验
    （`UpdatePackage.verifyCode`）、对 root 私有副本的再次校验，以及只读 stdout 的
    `--version` 探测。
  - 标准（非管理员）用户不能再静默回滚 helper，降级需要管理员同意。
  - `--version` 探测没有超时：候选 helper 卡住时，accept 循环会一起卡住，直到 App 的 30 s
    超时后走管理员安装、由 launchctl bootout 恢复。
  - helper 版本号已在合并列车中按顺序重排为 4.21.0，并重算 `CONTRACT.sha256`。

## 2026-09-23 · macOS helper PF DHCP 放行收窄（H1-F6 macOS）

- **归属/来源**：G1 保护一致性；影响 macOS root helper（`tooling/scripts/core-helper`）。基线 main
  da7bad1b → 分支 `fix/dhcp-scope-macos-20260923`；Issue #341；提交时未合 main。
- **缺陷修复**：TUN 存在时的 `tono-dhcp` 规则为 `pass out … from any port 68 to any port 67 keep
  state` 与 `pass in … from any port 67 to any port 68 keep state`，无目的/用户限制，入向规则还会
  建立 state，让 68 端口回包给任意发送方。改后出向只到 `255.255.255.255`（私网服务器单播续租
  已由 `tono-lan` 覆盖），入向改为 `no state`。`HelperProtocolVersion` 4.18.0 → 4.20.0
  （合并列车按顺序编号），CONTRACT.sha256 用脚本同一 sed|shasum 管道重算（未编译）。
- **新增/优化**：无。
- **工程与测试**：`--self-test` 的 cloudRules 断言新增 DHCP 必需/禁止形状；该 self-test 在
  CI 以 root 运行并经 `pfctl -nf` 解析 cloudRules。在旧规则上的实测失败：仅加断言（及版本/契约）
  的一次性分支经 macOS CI（run 35843126003）在 `build-core-helper.sh` 调用 `--self-test` 时失败退出。
- **验证**：本机未运行 swift/xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机确认 DHCP 续租行为；公网地址或 100.64/10 的 DHCP 服务器单播续租被拒，
  依赖广播 rebind。未加 `user root`（IPConfiguration 发包归属未实机确认）。与在审 helper PR 的
  版本号/契约哈希会冲突，合并顺序确定后需重算。

## 2026-09-23 · macOS 审阅直连 bundle 的标准路径也要校验签名身份

- **归属/来源**：G1 连接保护；基线 main 244075f2，分支 `fix/reviewed-bundle-signature-20260923`，
  [Issue #332](https://github.com/raydocs/tono/issues/332)（内部审查 H1-F2，macOS），本条提交时未合 main。
  Windows 变体另记 [Issue #333](https://github.com/raydocs/tono/issues/333)，本 PR 未改。
- **缺陷修复**：`/Applications/{WeChat,微信,DingTalk,钉钉,Feishu,飞书,Lark}.app/` 原本无条件
  进入直连 `process_path_regex`，不检查是否存在、签名是否正确；`/Applications` 默认对 admin
  免 sudo 可写。现在标准路径与迁移路径走同一身份校验：Apple 锚定、审阅过的 identifier、
  已知 Team ID（Developer ID 叶证书 OU，或 App Store 代码目录中的 Team ID）。不通过则不生成
  直连规则，流量留在隧道。sing-box 在没有任何 bundle 通过时不再输出空 `process_path_regex`
  规则（空列表会匹配所有进程），WeChat DNS 后缀与此同条件，与 mihomo 路径一致。
- **行为变化**：校验前本机确认 App Store 版 WeChat 的叶证书是 Apple 的，不含腾讯 OU。原
  `isSignedWeChatBundle` 会拒绝它；新校验通过代码目录 Team ID 接纳它。Feishu/Lark 尚无
  已采集的 Team ID，标准路径也改为失败即关闭，走隧道。
  - **用户可见的功能回退（Feishu/Lark）**：开启国内直连策略时，飞书/Lark 全部流量改走海外
    出口。影响：延迟上升；VLESS 模式下 UDP 被全局拒绝，飞书会议只能退到 TCP，可能失败；
    飞书风控或企业登录 IP 限制可能把出口 IP 判为异地登录，要求二次验证。列表中的飞书/Lark
    Bundle ID 也从未在真实安装上核对过。补齐 Identifier 和 TeamIdentifier（在装有飞书/Lark
    的 Mac 上运行 `codesign -dvv` 采集，DMG 版和 App Store 版分别采）跟踪于
    [Issue #422](https://github.com/raydocs/tono/issues/422)，目标是下一个 candidate 之前。
    补齐前保持 fail-closed，不恢复按文件名信任。
- **工程与测试**：新增 `CoreRouteClassificationTests.testReviewedDirectPathRequiresSignedBundleAtStandardLocation`
  （临时目录中未签名的同名 bundle 不被授予；生产路径列表中每项都须通过签名校验。旧代码在
  没装这些 App 的 CI 上因无条件的默认路径失败）。增加仅测试使用的
  `managedDirectBundlePathsOverride`；4 处依赖“默认路径必在”的既有测试
  （`testReviewedChinaOfficeAppsShareTheWeChatDirectBoundary`、`SingBoxConfigTests` 产品运行时、
  `MultiExitPolicyTests`、`WeChatResolverPolicyTests`）改为显式注入路径，删除断言缺陷行为的默认路径断言。
- **验证**：本机只做 diff 检查，并用 `codesign -v -R` 核对新 requirement：本机 App Store
  WeChat 与 Developer ID 应用可通过，未签名的假 bundle 与 identifier 不符时被拒。XCTest、
  multi-exit 脚本与 `sing-box check` 由 GitHub-hosted `macos-26` CI 执行，结果见 PR。
- **新增/发布/限制**：无新包、无部署。签名在生成配置时校验，运行时按路径匹配，仍有 TOCTOU。
  未实机复现；DingTalk App Store 版未实测。Feishu/Lark 直连需先在目标 Mac 上采集
  Identifier 和 Team ID（#422）。本条随 PR 变基到 main bb2ed4e4，源码未改，
  本机未编译，委托 CI。

## 2026-09-23 · macOS 控制面 PF 例外如实标注为 UID 边界（未修复）

- **归属/来源**：G1 保护边界；基线 origin/main `244075f2`，分支
  `fix/macos-bootstrap-pf-scope-20260923`，Issue #331（内部审查 H1-F5 macOS 部分）。未合 main。
- **缺陷修复**：无行为修复。`tono-control` 规则的 `user { 0, uid }` 只按 UID 匹配，PF 没有进程或
  签名条件，交互用户的任何进程都与签名 App 同样命中；原注释称该规则只允许“signed app”，与实际不符，
  现已更正。端口已经只有 TCP 443，地址也已经只有钉住的主机，没有可以在不影响恢复的前提下继续收窄的部分。
- **工程与测试**：只改注释，不加测试（规则文本不变，PF 也无法表达程序身份）。
- **验证**：本机只检查 diff；PF 规则输出与改动前逐字相同。
- **新增/发布/限制**：无新包、无部署。剩余风险：Protected Offline 期间，以登录用户身份运行的进程仍能从
  物理网卡访问钉住的控制面地址的 443 端口。真正修复需要改为由 root helper（或专用身份）发起引导请求，
  并让规则只匹配该身份，设计见 #331，需要实机证明恢复路径仍然可用。


## 2026-09-23 · macOS Continuity 直连改为按系统路径匹配

- **归属/来源**：G1 连接保护；基线 main 244075f2，分支 `fix/continuity-direct-path-20260923`，
  [Issue #325](https://github.com/raydocs/tono/issues/325)（内部审查 H1-F1），本条提交时未合 main。
- **缺陷修复**：sing-box 产品规则按可执行文件名把 4 个 Continuity 守护进程送 `DIRECT`
  （1e69b137 引入）。国内直连策略激活时 PF 放行 root 的 80/443/8000/8080，文件名不是身份。
  现改为 `process_path` 精确匹配 SIP 密封系统卷上的路径（`/usr/libexec/sharingd`、
  `rapportd`、`SidecarDisplayAgent`、IDS.framework 内的 `identityservicesd`）。PF 不变：
  它只能按 UID 区分，进程边界在 sing-box 路由。
- **工程与测试**：`SingBoxConfigTests.testDirectRoutesNeverMatchOnProcessName`，旧代码上
  因 `DIRECT` 规则含 `process_name` 失败。
- **验证**：本机只做 diff 检查，路径在 macOS 26 上用 `ps`/`ls` 核对；XCTest 与 emitted
  runtime 的 `sing-box check` 由 GitHub-hosted `macos-26` CI 执行，结果见 PR。
- **新增/发布/限制**：无新功能、无新包、无部署。未做实机复现；旧系统版本若路径不同，
  规则不匹配，流量留在隧道。Windows sing-box 草稿的 `direct_process_names` 输入生产未接线，未改。

## 2026-09-23 · macOS Helper 被关闭、未加载或不响应时，App 明确提示“这台 Mac 当前未受保护”并进入修复

- **归属/来源**：G1 连接保护（重启后保持保护）；macOS App 启动恢复 `RuntimeCleanup`。
  内部审查 H12-F2 的 App 部分，Issue #423（Helper 部分见 #424）；第四轮 macOS 审查 S14 与
  H15-F1 指出第一版走不到。基线 main bb2ed4e4 → 分支 `fix/helper-unloaded-notice-20260923`；
  提交时未合 main。
- **缺陷修复**：重启后只有 Helper 会启用 PF。Helper 二进制已安装、但 socket 没有进程应答时
  （“登录项 > 允许在后台”中被关闭、launchd 没有这个任务、崩溃循环，也包括 0.0.72 的旧
  Helper），App 启动的第一步 `pendingNativeUpdate()` 就抛出 `connectFailed`。用户只看到
  “Secure sign-in service is unavailable”，Retry 每次重复同一错误，`recoverStaleRuntime` 里的
  修复分支和本 PR 第一版加的提示都到不了。现在：
  - 启动的更新查询改为 `RuntimeCleanup.queryPendingNativeUpdate`。查询因 `connectFailed`
    失败时，先只读查询后台项状态（`SMAppService.statusForLegacyPlist(at:)`）和
    `launchctl print`：
    - 被关闭：立即显示“网络组件已在登录项中关闭，这台 Mac 当前未受保护”，并说明如何打开。
      App 无法启动用户关闭的任务，不做修复尝试。
    - 未加载：走一次已有的鉴权安装修复，成功后重新查询；失败时显示“网络组件没有运行，这台
      Mac 当前未受保护”，后接原始错误。
    - 已加载或无法判断：等 2 秒再查一次；仍不应答（崩溃循环）时同样走鉴权安装修复，失败时
      显示“网络组件没有响应，这台 Mac 当前可能未受保护”。
    管理员安装由 root 端 `--update-install-guard` 把关，有未完成的更新事务时拒绝。
  - Helper 不应答时，若已安装二进制的 `--version` 低于 4.5.0（0.0.72 为 3.15.0），按旧版
    Helper 处理：它没有更新账本，不再查询，直接进入 `recoverStaleRuntime`。
  - `recoverStaleRuntime` 中第一版加的判断保留，覆盖二进制缺失或旧版 Helper 的情况。
- **新增/优化**：无。
- **工程与测试**：修改 XCTest
  `HelperUnprotectedNoticeTests.testAHelperLaunchdDoesNotRunSaysThisMacIsNotProtected`，改为驱动
  生产函数 `queryPendingNativeUpdate`：查询抛 `connectFailed` 且后台项被关闭时，抛出含“not
  protected right now”和“Allow in the Background”的错误，且不修复；未加载时修复一次后重新
  查询并返回。第一版测试只测“状态 → 文案”的纯映射，所以没发现提示走不到。修改前的分支上
  这个测试无法编译（函数不存在），不是实跑失败；按旧顺序推理，查询错误会原样抛出，第一个
  断言会失败。zh-Hans 文案已加入字符串目录。
- **验证**：本机（编辑机）未编译，未运行 xcodebuild，委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests，含 LocalizationCoverageTests），结果以 PR 页为准。本机只确认了普通用户执行
  `launchctl print system/<label>` 可用（存在为 0，不存在为 113）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未加载或崩溃循环时，App 启动即弹管理员授权框，不经用户操作（与已有的
  `daemonRejectsClient` 先例一致）；修复成功后界面没有说明。旧版判断依赖以普通用户运行已安装
  二进制的 `--version`。登录项开关对旧式 LaunchDaemon 的确切效果（`statusForLegacyPlist(at:)`
  是否返回 `.requiresApproval`、开机是否跳过）和崩溃循环的触发频率都需要实机确认。没有改用
  `SMAppService.daemon` 注册。

## 2026-09-23 · macOS helper 的 sing-box 配置检查拒绝重复键与折叠键（H10-F2）

- **归属**：G1 保护边界（纵深防御）；macOS `tono-core-helper` 的 `ownedRuntimeConfigIsSafe`。
- **来源**：基线 main `be1c75d2`，第四轮审查后 rebase 到 main `bb2ed4e4` → 分支
  `fix/helper-json-keys-20260923`；Issue #416，内部审查 H10-F2；提交时未合 main。
- **缺陷修复**：helper 用 `JSONSerialization` 校验 root 快照（重复键保留第一个，键名精确
  比较），root core 用 Go JSON 执行同一份字节（重复键取最后一个，结构体字段按
  `EqualFold` 折叠匹配）。两者可以读出不同的值。现在先对原始字节做键扫描（JSON 字符串
  转义按 Go 语义解码，按 Go 的折叠规则折叠键），任何对象内出现重复即拒绝；白名单与禁用键
  检查改在折叠后的键上进行，与 core 实际绑定的选项名一致。今天只有已签名 App 能提交配置，
  且 App 输出固定的小写 ASCII 键，所以没有真实输入可以触发；本项只收紧 App 失守时的最后
  一道防线。
- **新增/优化**：无。helper 协议版本 4.19.0 → 4.18.0（合并列车按记录的编号表取 4.18.0，
  虽晚于 4.19.0 合入；App 只按字符串相等比较版本），并按 build-core-helper.sh 同一清单重算 `CONTRACT.sha256`。
  rebase 后补注释：重复键检查对 map 类型对象的键同样按折叠比较（见剩余限制）。
- **工程与测试**：`runOwnedRuntimeContractSelfTests`（`--self-test`）新增一条断言：
  `route` 内重复 `final` 必须被拒；旧代码返回 true，该断言失败。
- **验证**：MacBook 不编译 Swift（所有者决定 2026-09-14），helper 自测交由本 PR 的 macos-ci
  （`sudo tono-core-helper --self-test`）执行，结果见 PR。本机只用 JXA 确认 Foundation 对重复键
  保留第一个，用 Go `encoding/json` 确认 Go 取最后一个且按 U+017F 折叠；用 Python 镜像扫描器
  确认生命周期 fixture 与 `tooling/scripts/sing-box/runtime-template.json` 通过、重复键和
  转义形式的同名键被拒。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：扫描器依赖 `JSONSerialization` 已先拒绝语法错误的输入；折叠规则只覆盖能落到
  ASCII 的字母（ASCII 大写、U+017F、U+212A），与 core 的 ASCII 选项名相符。Windows 的对应检查
  （#357，mihomo YAML）需另行核对解码器的键折叠行为，已在 #357 留言。已知过严：Go 只对结构体
  字段名折叠，map 类型对象（如 `predefined` hosts）的键不折叠，而本检查对所有对象都折叠比较。
  第四轮审查确认 App 自生成的配置不受影响（键都是写死的小写 ASCII，`predefined` 先
  `lowercased()` 再经 Dictionary 去重）；将来 App 若生成仅大小写不同的 map 键会被拒绝。
  rebase 后本机未编译，委托 CI。

## 2026-09-23 · macOS 保护期间阻断直连局域网 DNS（53/853）

- **归属/来源**：G1 保护边界（内部审查 H1 报告中的未编号设计缺口）；影响 macOS root helper
  PF 渲染。基线 main b1b6fe6c，分支 `fix/macos-lan-dns-20260923`，Issue
  [#344](https://github.com/raydocs/tono/issues/344)；提交时未合 main。
- **缺陷修复**：TUN 存在时 `tono-lan`/`tono-linklocal` 放行任意用户到私网、链路本地的任意端口，
  而 sing-box 把这些网段排除出 TUN，所以直接发往路由器或其他 LAN 解析器的 DNS（53）/DoT（853）
  碰不到 `hijack-dns`，查询名明文外泄。Windows 由 `dns-hijack any:53` 覆盖，两平台不一致。
  改后：在这两组放行之前渲染 `tono-lan-dns` 的 `block drop out quick`，覆盖 IPv4 私网/169.254
  与 IPv6 fe80::/10、fc00::/7、ff00::/8 的 TCP/UDP 53、853。系统 DNS（loopback 127.0.0.1）、
  TUN、mDNS 5353 不受影响。
  - 审查后补充（#348 第三轮审查）：阻断规则限定在物理出口接口 `on { enN, ... }`（渲染规则时
    用 `getifaddrs` 枚举当前存在的 `en` + 数字接口，覆盖 Wi-Fi、有线、USB/雷雳网卡和 iPhone USB
    共享），不作用于 utun、ipsec、ppp 等其他 VPN 接口，所以与 Tono 同时运行的公司 VPN
    （AnyConnect、GlobalProtect、WireGuard 等）推到自己 utun 上的 DNS 不会被挡。枚举不到任何
    物理接口时，阻断保持不限接口（fail-closed）。
    （2026-09-24 合并列车说明：这只是 PF 层。#458 的 Protected DNS 审计把这类 VPN 的
    split DNS（带匹配域、指向非 loopback 的补充解析器）判为 `.supplementalConflict`：拆会话、
    保留 PF、暂停自动重试，所以合并后与公司 split-DNS VPN 并存时 Tono 不会保持连接。保留这一
    较严格行为、不做“保持连接并提示”，是暂定产品决定，等 owner 确认。）
- **新增/优化**：无。
- **工程与测试**：helper 自测（`--self-test`）新增一个检查 `lanDNSBlockedFirst`：带 TUN 的规则集里
  LAN DNS 阻断出现在 `tono-lan` 放行之前；旧代码无此规则而失败。审查后同一检查改为用注入的
  物理接口 `["en0", "en7"]` 渲染，并断言阻断带 `on { en0, en7 }` 限定；修改前的分支渲染的是
  不限接口的阻断，匹配不到，检查失败。同一自测在 CI 以 root 做 pfctl
  语法解析。HelperProtocolVersion 4.17.0 → 4.19.0（合并列车按顺序编号），CONTRACT
  已重算；与该链合并时需按合并顺序重算 CONTRACT。
- **验证**：本机（MacBook）未编译 helper、未运行 pfctl（审查后的接口限定同样本机未编译）；编译、自测与 PF 解析委托本 PR 的
  GitHub-hosted `macos-26` CI（privileged-tests）。
- **候选/发布**：无新包，仅源码；不涉及 Sparkle 更新源。
- **剩余限制**：未实机复现。只阻断 53/853；其他端口上的自定义 DNS 协议（如私网 DoH 443）仍经
  `tono-lan` 放行。用户有意使用的局域网 DNS 服务器在保护期间不再可直连（系统解析本就走 loopback）。
  - **已知取舍，需要 owner 决定是否接受**：仍会挡掉企业 split DNS。公司 Mac 通过
    `/etc/resolver/<域>` 或配置描述文件下发的私网补充解析器（例如 `10.1.1.53`）经物理网卡
    直连，Tono 连接期间这些内网域名会解析失败。在 main 上它们经 `tono-lan` 可以解析。
  - 物理接口列表在每次写 PF 规则时确定。会话中途新接入的网卡（例如插上 USB 网卡）在下一次
    重写规则之前不在阻断范围内，此时该网卡上的 LAN DNS 与 main 行为相同（经 `tono-lan` 放行）。
  - 接口限定和公司 VPN 并存场景未做实机验证。

## 2026-09-23 · macOS 原 DNS 所属服务已删除时向用户提示

- **归属/来源**：G1 保护恢复；macOS App `HelperManager` / `AppState+Connect` / `AppDelegate`。
  X3-1 后续，Issue #487（根因 #475 / PR #476）。基线 main bb2ed4e4 → 分支
  `fix/dns-original-lost-notice-20260923`；提交时未合 main。字段 `originalDNSRestored` 由
  #476 的 helper 产生；本条无编译依赖，#476 合并前旧 helper 不发该字段，行为不变。
- **缺陷修复**：`/dns/restore` 成功但带 `originalDNSRestored: false`（原 DNS 所属服务已删除、
  快照已存档、loopback 已清为自动获取）时，App 只检查 `configured`/`snapshotPresent`，把它当
  普通成功，用户不知道原静态 DNS 没有写回。现在 `restoreProtectedDNS()` 解码该字段，为
  `false` 时在 UserDefaults 记一次性提示并写本地审计 `protected_dns_original_service_missing`
  （helper 会把快照移走，只报告一次；恢复可能发生在启动恢复、退出、更新准备等无窗口时刻）。
  显式 Restore internet 干净完成时（无 transitionError、未保持 blocked）显示提示；否则在下次
  App 激活且没有其他消息时显示。新增中英文案："原 DNS 设置所属的网络服务已被删除……现已改为
  自动获取 DNS"，更新 `Localizable.xcstrings`。保护与释放判定不变。
- **新增/优化**：无。
- **工程与测试**：新增一个 XCTest
  `ProtectedDNSRestoreNoticeTests.testRestoreReplyWithoutOriginalDNSMapsToUserNotice`：
  `originalDNSRestored:false` 的回复映射为提示，`true` 与缺字段映射为 nil。映射函数在旧
  main 上不存在，测试在旧代码上无法编译（未实际跑红）。
- **验证**：本机为编辑机，未运行 xcodebuild/swift；`Localizable.xcstrings` 本机 JSON 解析通过。
  TonoTests 委托本 PR 的 GitHub-hosted `macos-26` CI，结果以 PR 页为准。未在实机删除网络服务
  验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：提示只说明未写回，不展示存档中的原 DNS 值（存档文件只供诊断）。提示落在
  共享的错误横幅上，可被随后的其他错误覆盖；激活时只在横幅为空时显示。消费提示与 AppState
  状态之间没有自动化测试，只覆盖回复映射。

## 2026-09-23 · macOS DNS 快照按服务 ID 恢复，改名不再丢原 DNS

- **归属/来源**：G1 保护恢复；macOS `tono-core-helper` `ProtectedDNSManager`。内部审查
  X3-1，Issue #475。基线 main bb2ed4e4 → 分支 `fix/dns-service-id-20260923`；提交时未合 main。
- **缺陷修复**：快照只存服务显示名。保护期间用户在系统设置里给同一服务改名后，恢复按名字
  找不到快照服务，把仍指向 `127.0.0.1` 的改名服务写成 `[]`（自动获取），读回成功后删掉快照并
  报告成功，App 解除 PF；原来的静态 DNS 永久丢失。现在 enable 时额外记录
  `SCNetworkServiceGetServiceID`（显示名保留作诊断和旧快照匹配），恢复按 ID 找服务写回原值，
  写回读回确认后才删快照。快照服务在带 ID 的完整枚举里已不存在（服务被删除）时，不删快照而是
  改名存档为 `protected-dns.json.orphaned-<ts>`，`/dns/restore` 附带
  `originalDNSRestored: false`，loopback 清扫照常且需读回证明；枚举退回 `networksetup`
  （没有 ID）且按名字也找不到时，保留快照并拒绝释放（M2 语义）。旧格式快照（无 ID）照常读取，
  按名字匹配。enable 判断"同一服务"也按 ID，改名后重连会把快照里的名字更新为当前名字（status
  仍按名字读）。带 ID 的枚举不再丢弃名字不合 `validateService` 的服务（如改成超 128 字节的中文名），
  恢复清扫能按 ID 触达它们。保护不放宽。
- **新增/优化**：无。
- **工程与测试**：helper 协议版本 4.16.0 → 4.17.0（合并列车按顺序编号）并按 manifest
  重算 `CONTRACT.sha256`。现有两个 DNS self-test 适配新的服务类型（名字-only 枚举，行为不变）。
  新增一项 `--lifecycle-self-test`：`runRenamedServiceRestoreSelfTest`，服务 `S1` 由 `Wi-Fi`
  改名为 `办公无线` 后恢复，断言 DNS 回到 `["10.0.0.53"]`、快照在读回确认之后才删除、其他服务
  不动。旧代码会写成 `[]` 并删快照（该测试依赖新增的 ID 注入点，旧代码上的失败为构造推导，未实际
  跑红）。
- **验证**：本机为编辑机，未运行 swiftc/xcodebuild。helper 编译、`--self-test` 与
  `--lifecycle-self-test` 委托本 PR 的 GitHub-hosted `macos-26` CI（privileged-tests），结果以
  PR 页为准。未在实机上改名验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：`/dns/status` 仍按快照里的名字读；连接中改名后报 `ok: false, snapshotPresent: true`，
  App 判为 broken 并重连一次（重连时快照名字更新），或照常调用恢复。System Configuration 持续
  不可用、只能用 `networksetup` 枚举且快照名字已不存在时，恢复与 `--emergency-disarm` 都会拒绝
  （保持 fail-closed，不放宽）。App 不展示 `originalDNSRestored: false`，用户看不到"原 DNS
  所属服务已删除"的提示；存档文件只供诊断。服务被删除后又新建同名服务时按新 ID 视为不同服务，
  原值不会写到新服务。

## 2026-09-23 · macOS Protected DNS 按系统主服务选服务，并核对实际生效的解析器

- **归属/来源**：G1 保护；macOS `SystemProxy` 服务选择、`PrivilegedRuntimeCoordinator`
  DNS 完整性判定与 `AppState` 审计后的重连策略。内部审查 X2-3，Issue #457；第二轮按
  #458 独立审查（Codex，只读）修改。基线 main bb2ed4e4 → 分支
  `fix/dns-primary-service-20260923`；提交时未合 main。
- **缺陷修复**：
  - 服务选择：旧代码把 IPv4 默认接口经 `networksetup -listnetworkserviceorder` 映射成服务，
    但解析器把所有以 "(" 开头的行都当服务标题，设备行 `(Hardware Port: …, Device: en7)`
    被吞掉，映射**总是**失败，于是回退到第一个名为 Wi-Fi 的服务——有线为主、Wi-Fi
    同时开启的常见拓扑里，DNS 被写到空闲的 Wi-Fi，完整性检查也只读 Wi-Fi 自己存的设置就判
    intact。现在服务取自 SCDynamicStore `State:/Network/Global/IPv4` 的 `PrimaryService`
    （无 IPv4 主服务时取 IPv6；IPv4 主服务存在但无名字时不改用 IPv6，理由见代码注释），经
    `SCNetworkServiceGetName` 映射为 helper 使用的名字；拿不到时返回 nil，连接以既有的
    `noNetworkService` 失败、不写 DNS。系统代理模式共用同一选择函数。
  - 完整性判定：helper 读回通过后，`State:/Network/Global/DNS` 的 `ServerAddresses` 必须
    全部为 `127.0.0.1`，否则 `.broken`。另枚举补充解析器：`State:/Network/Service/*/DNS`
    中带 `SupplementalMatchDomains` 的项与 `/etc/resolver/*`；只要有指向非 loopback 的，
    判为新的 `.supplementalConflict`（既不 intact，也不当 broken 重连）：保持 PF 拆会话，
    暂停自动重试（网络变化不解除），提示"DNS 冲突"并在横幅与本地审计
    `protected_dns_supplemental_conflict` 中列出域名 → 服务器。不放宽 PF。
  - 重连有界：审计判 `.broken`（且网络未变）计入独立计数，连接成功**不**清零、仅 `.intact`
    审计/立即重试/释放清零；连续 3 次即停在"保护保持、DNS 未生效"并暂停自动重试
    （`protected_dns_broken_retries_exhausted`）。`noNetworkService` 另计：连续 5 次（约 1 分钟
    退避）后暂停并提示；网络变化可解除暂停，但计数不清零，所以每次网络变化只换一次尝试。
  - 二次确认（第四轮审查）：周期审计与网络变化核对读到 `.broken` 时，先等 2 s 重读一次，
    以第二次结果为准，DHCP 续租等造成的一次短暂坏读不再立即拆会话。PF 全程保持。
  - 唤醒尊重暂停终态（第四轮审查）：唤醒恢复在重新确认 PF 后，若已处于"等用户处理"的暂停
    （DNS 冲突、Protected DNS 反复失效、需用户操作的失败，即网络变化也不解除的那类），就保持
    Protected Offline 与原提示、不再 connect；网络变化可解除的暂停照旧由唤醒解除。此前每次
    唤醒都会重连一次再被审计暂停。
- **新增/优化**：无。
- **工程与测试**：`SystemNetworkObservation`（含补充解析器）；`primaryNetworkService(observe:)`
  注入点，生产默认读实时动态存储。一个 XCTest
  `ProtectedDNSServiceSelectionTests.testWiredIPv4PrimaryIsSelectedWhileWiFiIsAlsoUp`，
  走生产 `SystemProxy.primaryNetworkService(observe:)`，拓扑为 IPv4 有效、有线为主、Wi-Fi
  同时存在。**旧代码上没有行为失败的实跑**：旧代码没有注入点，测试只会编译失败；旧逻辑
  为何选 Wi-Fi 是按上面的解析缺陷推理得出（见测试注释中的 networksetup 输出）。冲突判定与
  有界重连、`.broken` 二次确认与唤醒暂停判断均未加测试（AGENTS 规则 5，审查未要求；
  完整性读取与唤醒的 PF 重申都直接调用 `PrivilegedRuntimeCoordinator`，没有现成 seam）。
  新增三条 zh-Hans 文案。删除无用的
  `networkService(for:)`。未改 helper 源码，协议版本与 CONTRACT.sha256 不变。
- **验证**：本机（编辑机）未编译、未运行 xcodebuild/swift，委托本 PR 的 GitHub-hosted
  `macos-26` CI（build + TonoTests），结果以 PR 页为准。本机只读 `scutil` 核对了键布局
  （`State:/Network/Service/<id>/DNS` 普通项无 `SupplementalMatchDomains`）。实机清单写在
  PR 中，尚未执行。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：用户可见影响需实机确认。补充解析器只看上述两处来源；NetworkExtension/描述
  文件下发的加密 DNS（DoH/DoT）设置、应用自带解析器不在观测内。非主服务的普通
  `ServerAddresses`（只服务于指定接口的查询）不算冲突。冲突在连接后才由审计（网络变化
  750 ms 或约 60 s 周期，读到 broken 时再加 2 s 复核）发现，连接期不预检。真实持续的
  broken 因复核晚 2 s 才拆会话（PF 期间一直生效）。与全隧道 VPN 共存时若其动态服务成为 IPv4
  主服务，连接以 `noNetworkService` 拒绝。直连策略的物理网卡仍由 `route -n get default`
  取得（IPv4 only）。`apps/windows/app/scripts/unset_dns.sh` 的旧服务选择未改：它只随 Tauri
  应用打包，而 Tauri 应用只出 Windows 包，且 Windows 打包显式禁止该脚本，生产不可达。

## 2026-09-23 · macOS 连接尾声在更新状态查询返回后重新核对代际再提交

- **归属/来源**：G3 原生升级恢复 / G1 连接生命周期；macOS `AppState+Connect.onCoreStarted`。
  内部审查 X1-9（降级），Issue #438。基线 main bb2ed4e4 → 分支
  `fix/core-started-late-commit-20260923`；提交时未合 main。
- **缺陷修复**：收养了 `.connected` 恢复义务的待定原生更新后，连接尾声先置 `isConnected`，
  再阻塞等待 helper 的 `pendingNativeUpdate()`。这期间用户取消（走
  `disconnectPendingNativeUpdate` → `suspendForNativeUpdate`：bump 代际、取消并等待连接任务）
  后，查询返回时尾声不再检查取消、代际或连接意图，直接 `nativeUpdate("commit")`，并注册
  后台策略和核心监视器。随后的 `/update/disconnect` 被 helper 以"已提交"拒绝，用户的恢复
  网络请求以错误告终。现在 `onCoreStarted` 入口记录代际；状态查询返回后、以及注册尾声任务
  之前，都要求任务未取消、仍在连接中且代际未变，否则返回 false，不提交、不注册。
- **缺陷修复（审查 R4 S13）**：`ConnectionCoordinator.executeConnect` 原先在 `prepare()` 准入检查之前
  就 bump 代际，一次被拒的 `connect()`（已在连接、无可用出口等）也会让在途尝试的代际失效；与上面的
  代际比较组合后，尾声返回 false 但 `isConnected` 已置位，界面同时显示 connecting 与 connected，
  直到 240 s 看门狗。现在只有通过准入的尝试才 bump 代际（`connectBegin` 遥测相应记录 bump 后的代际）。
  对 #443 的影响：#443 在同一处清除"释放未确认"意图，同样位于准入之前；该清除语句在 #443 分支上一并
  移到准入之后，两 PR 合并时此处会有一处文本冲突，保留"准入后先 bump、再清意图"即可。
- **新增/优化**：无。
- **工程与测试**：新增窄 seam `AppState.nativeUpdateResume`（`pending` / `commit`，生产走
  `PrivilegedRuntimeCoordinator`）；`onCoreStarted` 由 private 改为 internal 以便测试调用。
  新增 `ConnectTailRetirementTests.testRetiredAttemptDoesNotCommitUpdateAfterStatusQuery`
  （一个 XCTest）：状态查询停在可控闸门，期间按 suspend 的前两步 bump 代际并取消任务，
  放行后断言返回 false、commit 调用 0 次、未注册监视器。旧逻辑下会提交一次，断言失败。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。真实待定更新下的取消时序未做实机复现。准入后 bump 的调整
  没有新增测试，结论来自源码推理（`prepare` 与 bump 同在主 actor 上同步执行，中间无挂起点）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：commit 本身也是不可取消的阻塞 IPC；取消若恰好落在 commit 发出之后，提交
  仍会发生，只是尾声不再注册任务。helper 侧未改，CONTRACT.sha256 与协议版本不变。
  被拒的 connect 不再取消排队中的延迟 connect（`bumpGeneration` 附带的动作）；延迟 connect
  触发时自身会再检查状态。

## 2026-09-23 · macOS 睡眠取消的节点切换在唤醒后连到切换目标

- **归属/来源**：G1 连接意图；macOS `AppState+Proxy` 节点切换任务。内部审查 X1-5，Issue #444。
  基线 main bb2ed4e4 → 分支 `fix/sleep-node-switch-20260923`；提交时未合 main。
- **缺陷修复**：已连接时切换到 Y，切换只在 commit 时写入并持久化 Y。切换完成前合盖，睡眠
  先 bump 代际再做保留拆除，切换任务被退休，所有退出分支都不保留 Y；唤醒 `connect()` 读到的
  仍是旧出口 X。网络环境对账等其他内部保留拆除落在切换中途时同样丢失 Y。现在切换任务被保留
  拆除退休时（代际已变、会话已断开、拆除不是显式释放），把 Y 记为下一次连接目标；会话仍在
  时不提前宣称 Y 为活动出口，显式 Restore internet 的行为不变。
- **新增/优化**：无。
- **工程与测试**：新增 `NodeSwitchSleepTests.testSleepDuringNodeSwitchKeepsTheSwitchTargetForWake`
  （一个 XCTest，沿用 `NetworkProtectionOperations` seam）：已连接 X，选 Y 后立即
  `prepareForSystemSleep()` 并等拆除完成，断言 `preferManagedCatalogExitForConnect()` 为 Y。
  旧代码返回 X，断言失败。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：原生更新挂起路径（`suspendForNativeUpdate`）退休切换时会话可能仍显示已连接，
  不在此处记住 Y；未实机验证睡眠与 helper 睡眠门的先后顺序。

## 2026-09-23 · macOS 被睡眠门拒绝的 Restore internet 不再在唤醒或网络变化时自动重连

- **归属/来源**：G1 保护状态与用户意图；macOS `ConnectionCoordinator`、`AppState` 睡眠/唤醒与
  网络变化路径。内部审查 X1-2（三名审查者独立发现），Issue #442，是 #310 的补全。基线 main
  bb2ed4e4 → 分支 `fix/sleep-release-intent-20260923`；提交时未合 main。
- **缺陷修复**：Restore internet 尚未走到 PF disarm 时合盖，helper 的睡眠门拒绝 disarm，
  这次释放以"PF 仍 armed、Protected Offline"收尾。`completeDisconnect` 不管释放是否成功都
  清掉释放意图，唤醒时 `resumeAfterSystemWake` 只剩 `KillSwitchService.isArmed == true`，
  于是自动重连；不在唤醒恢复中时，随后的网络变化也会按 `isArmed` 触发重连。现在释放以 PF
  仍 armed 收尾时保留释放意图，直到用户再次 Connect（`executeConnect` 清除）或新的拆除请求
  替换它；只有通过 `prepare` 准入的 Connect 才清除，被拒的 connect（已在连接、无可用出口等）
  不再提前清掉它（审查 R4 S13 说明 1）。唤醒和"未连接"的网络变化分支都尊重这个意图。主机保持 fail-closed（helper 睡眠时
  写入的紧急阻断），用户再点 Restore internet 或 Connect 决定去向。
- **新增/优化**：无。
- **工程与测试**：`AppStateSleepTests.testSleepGateRefusedReleaseDoesNotReconnectOnWake`
  （一个 XCTest，沿用 `NetworkProtectionOperations` seam）：释放停在 DNS 恢复时进入睡眠，
  disarm 以睡眠门错误失败，拆除收尾后唤醒并触发一次网络变化，断言不建唤醒恢复任务、不排
  重连。旧代码建出 `wakeRecoveryTask`，断言失败。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：唤醒后不会自动重试那次被拒的释放，需要用户再点一次 Restore internet；
  睡眠门拒绝 disarm 的实际频率未在实机测量。释放意图只存在内存里：App 重启或重启机器后，
  `performRestore` 经 `RuntimeCleanup` 读到 helper 仍 wanted，会置 `shouldResumeProtection`
  并自动重连（main 已有行为，本 PR 未覆盖）。被拒 connect 提前清意图的问题已在本分支把清除
  移到准入之后修掉；#439 在同一处把代际 bump 移到准入之后，两者合并时此处有一处文本冲突，
  保留"准入后先 bump、再清意图"。清除移位没有新增测试，结论来自源码推理。

## 2026-09-23 · macOS disarm 出错后先回读 PF 再决定是否发布 Protected Offline

- **归属/来源**：G1 保护状态呈现；macOS `AppState+Connect` 释放拆除。内部审查 X1-8（降级：
  触发面窄，下一次状态观测会自行纠正），Issue #436。基线 main bb2ed4e4 → 分支
  `fix/disarm-error-readback-20260923`；提交时未合 main。
- **缺陷修复**：helper disarm 先清掉 PF 锚点，再删除持久化状态；后者失败，或完整 disarm
  成功但回执丢失时，App 收到错误，释放拆除的 catch 无条件发布 Protected Offline 和
  "Kill switch transition failed"，而 PF 实际可能已解除、流量已直连。现在 disarm 抛错时
  通过已有 `NetworkProtectionOperations.refreshKillSwitchStatus` 回读：只有
  `.confirmed(requiresProtectionRecovery: false)` 才发布开放状态并清除本地 `isArmed`；
  `.confirmed(true)`、`.unavailable`、`.rejected` 仍保持 fail-closed 声明。状态文件仍在的
  情形，helper 的 status 会把 PF 重新装回，回读结果为 true，界面继续显示受保护，与实际一致。
- **新增/优化**：无。
- **工程与测试**：新增 `DisarmErrorReadbackTests.testDisarmErrorAfterBarrierRemovalDoesNotPublishProtectedOffline`
  （一个 XCTest）：disarm 桩先把 `pfLive` 置 false 再抛错，status 回读返回 `pfLive`，断言
  `isProtectionBlocked == false` 且 `isArmed == false`。旧代码不回读，发布 blocked，断言失败。
  桩模拟的是"完整 disarm 后回执丢失"；审查 R4 指出测试注释原写成"清 PF 后删 state 失败"，
  与 helper 语义相反（该情形 status 会自愈装回 PF，回读为 true），已改注释，断言未变。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。helper 状态删除失败场景未做实机复现。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：只处理释放路径的 disarm 出错；保留拆除中 `restrictToBootstrap` 出错仍按
  受保护发布。回读本身拿不到回答时仍发布 Protected Offline，等下一次状态观测纠正。

## 2026-09-23 · macOS 会话拆除时清除 Recovering 状态

- **归属/来源**：G1 保护状态呈现；macOS `AppState+Connect` 断开准备。内部审查 X1-6，
  Issue #434。基线 main bb2ed4e4 → 分支 `fix/recovering-flag-reset-20260923`；提交时未合 main。
- **缺陷修复**：核心监视器连续健康失败时把 `isRecoveringProtectedConnection` 置 true；
  原地恢复和自动切换都失败后，它以保留拆除断开并安排重连，但这个标志只在重新连上、监视器
  自愈或切换成功时清除。首页主按钮让它优先于 Protected Offline 和 Not Connected，于是
  Protected Offline 期间、甚至用户点 Restore internet 之后，仍显示 "Recovering protected
  connection…" 并转圈，直到下一次连接成功。现在断开准备与其他会话状态一起把它复位。
- **新增/优化**：无。
- **工程与测试**：新增 `RecoveringPresentationTests.testReleaseClearsRecoveringPresentation`
  （一个 XCTest），沿用 `NetworkProtectionOperations` seam，已连接且处于 Recovering 时执行
  `disconnectAndWait(releaseKillSwitch: true)`，断言标志已清除。旧代码仍为 true，断言失败。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：原生更新的专用断开（`suspendForNativeUpdate`）不走这条断开准备，也没有复位
  该标志；该路径由更新流程自己的界面接管，本修复未改动。

## 2026-09-23 · macOS 从未 arm 的连接失败不再走显式释放修复

- **归属/来源**：G1 保护恢复；macOS `AppState+Connect` 连接失败与拆除路径。内部审查 X1-4，
  Issue #430。基线 main bb2ed4e4 → 分支 `fix/unarmed-connect-failure-20260923`；提交时未合 main。
- **缺陷修复**：连接在首次 PF arm 之前失败时（例如 helper 准备失败、用户取消管理员提示，
  或看门狗在 helper 准备阶段触发），失败清理调用 `disconnect(releaseKillSwitch: true)`，
  释放路径无条件先跑显式释放用的 helper 修复。结果是：马上再弹一次用户没要求的管理员提示；
  如果这次也失败，界面停在 Protected Offline，并提示 "traffic stays protected"，可本会话
  从未 arm PF。没有 helper 时，释放路径还会去停一个本次从未启动的 core，停不掉同样发布
  Protected Offline。现在这两处自动清理带上 `afterUnarmedConnectFailure`：等待中的连接
  工作收尾后，如果 `KillSwitchService.isArmed` 仍为 false，就跳过显式释放修复，helper 清理
  步骤只做尽力而为，不发布 Protected Offline，也不用拆除错误覆盖连接失败信息。取消过程中
  arm 已完成的，仍走完整释放。用户主动 Restore internet 的路径不变。
- **缺陷修复（审查 R4）**：上一版在该路径无条件 `transitionError = nil`，把真实的 DNS 恢复失败
  一起吞掉（例如上次崩溃留下 127.0.0.1 与快照、`restoreDNS` 失败时，界面只剩连接失败与
  Not connected）。现在只去掉与 Kill Switch 相关的拆除文案；DNS 恢复失败换成不提 Kill Switch
  的提示保留（"may be unable to resolve names"，指向 Support 页恢复命令）。
- **新增/优化**：无。
- **工程与测试**：新增 `UnarmedConnectFailureTests.testUnarmedConnectFailureDoesNotRunExplicitReleaseRepair`
  （一个 XCTest），沿用已有 `NetworkProtectionOperations` seam 和"缺 uuid 的目录节点在
  helper 之前失败"的写法，修复桩计数并抛 `userDenied`。旧代码修复被调用一次，且
  `isProtectionBlocked == true`，断言失败。审查后同一测试改为预置 `didStartCore`、让
  `restoreDNS` 抛错，并断言 `errorMessage` 以 "Protected DNS restore failed" 开头且不提
  Kill Switch；上一版（`transitionError = nil`）下 `errorMessage` 是连接失败文案，该断言失败
  （推理得出，未实跑）。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。第二次管理员提示的实际弹出未做实机复现。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：本修复把"失败时 `isArmed` 为 false"视为"从未 arm"。首次 arm 回执丢失且
  状态补查也失败时，`isArmed` 目前也是 false（X1-7，另一个 PR 修为按可能已 arm 处理），
  两者都合入后这一判定才可靠。

## 2026-09-23 · macOS 首次 arm 结果未知时保持 fail-closed 意图

- **归属/来源**：G1 保护恢复；macOS `KillSwitchService.arm`。内部审查 X1-7（降级：需三个条件
  同时发生），Issue #432。基线 main bb2ed4e4 → 分支 `fix/arm-unknown-outcome-20260923`；
  提交时未合 main。
- **缺陷修复**：helper 先持久化 armed 状态并加载 PF，再回复成功。回复丢失（helper 崩溃、
  重启或接收超时）且紧接的 status 补查也拿不到回答时，App 本地 `isArmed` 仍为 false，
  连接失败清理据此走释放拆除，helper 恢复后自动解除已经提交的 PF。现在只要请求可能已送达
  （除套接字连接被拒以外的 IPC 失败）且 status 无回答，就按"可能已 arm"处理，把 `isArmed`
  置 true：连接失败走保留拆除，其中 `restrictToBootstrap` 把 PF 装成 bootstrap 模式（真实
  fail-closed），随后进入受保护重连循环。连接被拒（helper 从未收到请求）保持原行为。
- **缺陷修复（审查 R4）**：helper 回复了成功、但回执不满足 `armed && wanted && live`（例如
  wanted=true、live=false）时，原先直接抛错，本地 `isArmed` 仍为 false，失败清理会走释放。
  现在抛错前按回执同步：`wanted || armed` 时置 `isArmed = true`。同时修正 `arm` 中"由重连
  循环释放"的误导性注释，改为实际路径（保留拆除 + `restrictToBootstrap` + 重连）。
  至此 Issue #480 点名的两种来源（回执丢失且补查失败、helper 持久化后崩溃未回复）以及
  guard 失败变体都在 arm 处把 `isArmed` 置 true，保留拆除不会在 helper 持 PF 时发布开放；
  #480 的兜底 PR #482 因在"首次连接睡眠且 helper 安装提示打开"时回归 #310 修过的误报
  Protected Offline 而关闭，不再合入。
- **新增/优化**：无。
- **工程与测试**：`KillSwitchService` 新增窄 IPC seam `armIPC`（`deliver` 包住真实
  `/killswitch/arm` 请求，`status` 读 `/killswitch/status`），生产行为不变。新增
  `KillSwitchArmOutcomeTests.testLostArmReplyWithUnavailableStatusKeepsFailClosedIntent`
  （一个 XCTest）：arm 抛 `emptyResponse`，status 抛 `connectFailed`，断言 `isArmed == true`。
  旧逻辑下为 false，断言失败。"成功回执但 wanted 无 live"的同步没有新增测试，结论来自源码推理。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。回执丢失场景未做实机复现。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：请求实际没被 helper 处理（例如 helper 读到半截请求就退出）时，保留拆除的
  `restrictToBootstrap` 仍会把 PF 装成 bootstrap，主机进入 Protected Offline 并重连，直到用户
  Restore internet 或连接成功。窄窗口（审查 R4 S5）：保留拆除时 helper 不可达、之后可达并确认
  未 arm，重连循环会走"外部释放已确认"，静默丢掉连接意图并清掉错误；未在本 PR 修。
  helper 协议未改，CONTRACT.sha256 与协议版本不变。

## 2026-09-23 · macOS helper 拒绝本 App（403）时，"修复并重连"能走到 helper 重装

- **归属/来源**：G1 保护恢复；macOS `AppState+Connect` 受保护重连循环。内部审查 X1-3，
  Issue #428。基线 main bb2ed4e4 → 分支 `fix/helper-rejected-repair-20260923`；提交时未合 main。
- **缺陷修复**：PF 已 armed、helper 对本 App 返回 403 时，App 进入 Protected Offline 并暂停
  自动重试，提示用户点"Repair and reconnect"。这个按钮启动的重连循环在调用 `connect()` 之前
  先做外部释放对账，对账又读到 `.rejected`，于是重新暂停、清空循环。`connect()` →
  `prepareHelper()` 里的管理员重装因此永远走不到，点多少次都一样，唯一出口是关掉保护的
  Restore internet（#304 的 `protectionWasArmed` 守卫只覆盖从未 arm 的情形）。现在用户显式
  重试把循环的第一次尝试标为修复请求：这次尝试遇到 `.rejected` 时不再暂停，继续进入
  `connect()`，由 helper 准备阶段弹出管理员重装。自动重试、前台激活对账和 Support 远程重试
  （`retryProtectedConnectionNow(repairHelper: false)`）遇到拒绝仍然暂停，不会自行弹出管理员
  提示。PF 全程保持 fail-closed。
- **新增/优化**：无。
- **工程与测试**：`ProtectedReconnectTests` 新增一个 XCTest
  `testRepairAndReconnectReachesConnectWhenHelperRejectsThisApp`，用已有的
  `NetworkProtectionOperations.refreshKillSwitchStatus` seam 固定返回 `.rejected`，PF armed、
  处于用户操作暂停状态，调用 `retryProtectedConnectionNow()`。断言连接尝试确实发生
  （`lastConnectionFailure` 非空，沿用同文件"缺 uuid 的目录节点在 helper 之前快速失败"的
  写法），且之后的自动尝试仍因拒绝暂停。旧代码在第一次尝试就暂停，`lastConnectionFailure`
  为空，断言失败。未改 helper 源码，CONTRACT.sha256 与协议版本不变。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。真实 403 下的管理员重装未做实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：如果 403 的原因是运行中的 App 包已被替换，重装 helper 也无效（需要重启 App），
  现有文案仍指向重装。重装被用户取消或失败时，仍按既有规则暂停，等待用户下一次操作。

## 2026-09-23 · macOS 旧 helper 读不了 DNS 快照时不再阻止自身被替换

- **归属/来源**：G1 保护恢复；macOS `HelperManager.installIfNeeded` 升级前检查。内部审查
  X1-1（#303/#307 修复不完整），Issue #426。基线 main bb2ed4e4 → 分支
  `fix/helper-upgrade-dns-preflight-20260923`；提交时未合 main。
- **缺陷修复**：替换已认证的旧 helper 前，App 要求旧 helper 先恢复 DNS、停 core、并确认 PF
  live，任一步失败都抛 `installFailed`，而且这一步排在静默升级和管理员安装之前。旧 helper
  遇到损坏快照或快照所记服务已删除时（#307/#303 修的正是这一情形），每次恢复 DNS 都失败，
  新 helper 因此永远装不上，主机停在 Protected Offline：Retry 和 Restore internet 都提示
  "批准管理员提示"，但提示从不出现。现在升级前检查抽成
  `prepareAuthenticatedHelperForReplacement`：旧 helper 恢复 DNS 失败只记审计事件
  `helper_upgrade_dns_restore_deferred`，不再阻止升级；停 core 和"PF 需要时必须 live"仍是硬
  条件（保护不放宽）。升级后由新 helper 的 `/dns/restore` 隔离损坏快照并清扫 loopback 解析器，
  应用内 Retry / 管理员安装因此成为不依赖旧二进制的恢复出口。
- **新增/优化**：无。
- **工程与测试**：新增一个 XCTest
  `HelperUpgradePreflightTests.testUnreadableDNSStateOnPreviousHelperDoesNotBlockItsReplacement`：
  注入恢复 DNS 抛错、停 core 成功、PF armed/wanted/live，断言不抛错且 core 已停。旧代码没有
  这个函数（测试无法编译，即失败）；按旧语义（恢复失败即抛）也会失败。未改 helper 源码，
  CONTRACT.sha256 与协议版本不变。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。"旧 helper + 损坏快照 → 升级"未做实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：App 文案中的 sudo 应急命令仍调用已安装的二进制，对旧 helper 的损坏快照依旧
  无效；应用内出口是 Retry 触发的升级。升级后到新 helper 恢复 DNS 之前，系统解析器可能仍指向
  已停止的 loopback（无泄漏，PF 仍 fail-closed）。

## 2026-09-23 · macOS Helper 持有自己的 PF 启用引用，已连接期间监督 PF 是否仍在过滤

- **归属/来源**：G1 连接保护；macOS `tono-core-helper` 的 PF 生命周期与 App 连接监控。
  内部审查 H12-F1，Issue #420，PR #421。基线 main bb2ed4e4（含 #311）→ 分支
  `fix/pf-enable-ref-20260923`；提交时未合 main。
- **缺陷修复**：`ensureAnchorLoaded` 只在 PF 关闭时执行 `pfctl -e`。如果别的程序已经用引用
  令牌启用了 PF，Helper 自己不持有任何引用，对方释放令牌后 PF 停止。另外，已连接期间没有
  任何地方检查 PF：`status()` 只在被调用时修复，而已连接的 App 不调用它。结果是 kill switch
  可能不再过滤，UI 仍显示已连接，直到下一次 arm。现在：
  - 每次 arm 都用 `pfctl -E` 取得 Helper 自己的引用，令牌连同 boot session 记录在
    `/Library/Application Support/Tono/pf.reference`。先记录新令牌再释放旧令牌。disarm 在
    清空锚点、删除意图之后，只释放本次开机记录且内核仍列出的那一个令牌。
  - Helper 空闲循环每 10 秒检查一次（在更新锁内）。armed 时如果 PF 未启用、主规则集缺少
    Tono 锚点或规则不在，就按持久状态重装（失败则装紧急阻断），并置 `repairedSinceArm`。
    只丢了引用时重新取得引用。
  - 新增只读 `GET /killswitch/health`（不加载规则、不 flush）。App 已连接时每 60 秒读取一次。
    如果 Helper 报告修复过 PF 或 PF 不生效，App 在断网保护下重连，并显示“保护异常：另一个
    程序中断了网络保护”。重连会恢复本会话的直连例外，持久状态不含这些例外。
- **审查修正（第四轮 macOS 审查 #421 三点）**：
  - 误判：监督第一次读到 PF 不生效后，在锁内间隔 200 ms 再读一次，两次都不生效才修复。
    `effectiveStatus()` 由三次 pfctl 组成，单次读失败或超时不再触发清空全机连接状态和 App 重连。
  - 上限：App 用独立计数 `consecutiveProtectionRepairCount` 记录监督修复次数，重连成功不清零。
    第 3 次时不再重连，停在断网保护下的暂停终态，显示“保护异常：另一个程序反复关闭或替换
    Tono 的网络保护……自动重连已暂停”，网络变化不解除；只有“立即重试”或“恢复正常网络”
    清零。之前另一款 PF 类 VPN/防火墙周期性重载规则集时，每约 60 秒断线重连一次，没有终点。
  - 令牌泄漏：记录写入失败时，不再每 10 秒取一个新令牌。刚取得的令牌保存在 Helper 进程内存，
    下一次检查用同一令牌重试写入，disarm 同时释放它。没有照审查字面“写入失败就 `-X` 释放”：
    没有其他引用时，这样做会让 armed 状态下的 PF 停止（保护变松）。每个 Helper 进程最多遗留
    一个未记录令牌（进程重启后到重启机器前 PF 保持启用、锚点为空，无害）。
- **新增/优化**：无独立新功能。`/killswitch/health` 只服务于上述检测。
- **工程与测试**：`--lifecycle-self-test` 新增一组引用检查（CI privileged-tests 以 root 真实
  运行 pfctl）：先模拟另一个程序 `-E` 取得令牌，Helper 取得并记录自己的令牌，释放对方令牌后
  PF 仍启用，重复调用复用同一令牌，释放后令牌不再列出、记录已删除，PF 恢复到测试开始时的
  状态。旧实现没有这些函数（无法编译）；按旧语义（PF 已启用就跳过），对方释放后 PF 会停止。
  Helper 源码变更按契约门推进 `HelperProtocolVersion` 4.15.0 → 4.16.0（合并列车按顺序编号），CONTRACT.sha256 按 build-core-helper.sh 同一清单与管道本机重算（纯文本哈希，
  未编译）。
- **验证**：本机（编辑机）未运行 swift/xcodebuild；Helper 编译、`--lifecycle-self-test`
  与 App 编译/TonoTests 委托本 PR 的 GitHub-hosted `macos-26` CI，结果以 PR 页为准。
  本机只确认了 `/sbin/pfctl` 含 `Token : %llu`、`TOKENS:`、`pf: token invalid` 等字符串
  （`-E`/`-X`/`-s References` 存在），没有在本机改动 PF。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：App 侧的重连分支与修复次数上限都没有单独的 XCTest（监控 tick 直接调用
  Helper，没有注入点）；复读与未记录令牌的处理也没有自检覆盖，审查修正本机未编译，委托 CI。
  修复计数不按时间衰减：跨越很长时间的零星修复累计到 3 次也会暂停（保持 fail-closed，
  “立即重试”即可恢复）。唤醒路径：本条提交时 `resumeAfterSystemWake` 不看暂停标志，暂停后
  每次唤醒会再重连一次（2026-09-24 更正：合并列车中 #458 让唤醒在重新确认 PF 后保留网络变化
  也不解除的暂停；修复次数上限的暂停属于这一类，唤醒后保持暂停、不再重连）。
  最坏情况下检测延迟为 Helper 10 秒加 App 60 秒；Helper 在 10 秒内修复 PF，App 的重连只负责
  恢复会话例外并提示用户。哪些系统组件用令牌启用 PF、XNU 引用计数的精确语义、PF 被关闭期间
  的实际泄漏面，都需要实机确认。另一个产品把自己的锚点插在 Tono 锚点之前的情况不在本条范围。

## 2026-09-23 · macOS Helper 启动先恢复 PF，启动失败装紧急阻断，紧急阻断不依赖 /etc/pf.conf

- **归属/来源**：G1 连接保护（重启后保持保护）；macOS `tono-core-helper` 启动顺序与紧急阻断。
  内部审查 H12-F2，Issue #423（Helper 部分；App 侧“当前未受保护”提示另行 PR）。基线 main
  bb2ed4e4（含 #311）→ 分支 `fix/boot-protection-first-20260923`；提交时未合 main。
- **缺陷修复**：开机时 `com.apple.pfctl` 只加载 `/etc/pf.conf`，不启用 PF；只有 Helper 会启用。
  此前 Helper 在 `SocketServer.init` 里先解析用户组、建鉴权器、建 `/var/run/tono-core`、构造
  `CoreManager`（查 home、清理旧 core），最后才构造 `KillSwitchManager` 恢复 PF。前面任何一步
  抛错，main 的 catch 直接退出，PF 保持关闭，KeepAlive 反复重试同一失败。紧急阻断也走
  `/etc/pf.conf`，该文件无法解析时同样失败。现在：
  - main 在执行器恢复（`UpdateExecutor.startup`，#308 行为不变）之后，读取 allowed-uid 后立即
    构造 `KillSwitchManager` 恢复 PF，再构造其余服务（`startHelperDaemon`）。
  - 之后任何启动失败，只要持久保护意图（`killswitch.state`）存在，就装紧急阻断
    （`secureFailedStartup`，读不到 allowed-uid 也装，紧急规则不含按用户的规则）。收到停止
    请求时视为干净停止，不装阻断，与 #308 一致。
  - 紧急阻断在正常路径失败时改载 Tono 自有的最小主规则集
    `/Library/Application Support/Tono/pf.tono-main.conf`（只含 Tono 锚点与 load）。
    `/etc/pf.conf` 恢复可用后，下一次正常加载会重新载入主规则集并删除该文件。
- **新增/优化**：无。
- **工程与测试**：`--self-test` 新增 `runStartupOrderSelfTest`：注入的启动步骤中服务端构造
  抛错，断言顺序为恢复 → 服务端 → 紧急阻断；收到停止请求时不装阻断。旧代码没有这个启动
  函数，失败时也不装阻断（无法编译，即失败）。`--lifecycle-self-test` 新增一条只解析
  （`pfctl -nf`）的检查，确认独立主规则集能被 pfctl 接受。Helper 源码变更按契约门推进
  `HelperProtocolVersion` 4.9.0 → 4.15.0（合并列车按顺序编号；4.10.0–4.14.0 已被 PR CI 构建用过，跳过），CONTRACT.sha256 按
  build-core-helper.sh 同一清单与管道本机重算（纯文本哈希，未编译）。
- **验证**：本机（编辑机）未运行 swift/xcodebuild；Helper 编译、`--self-test`、
  `--lifecycle-self-test` 委托本 PR 的 GitHub-hosted `macos-26` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Helper 根本没被 launchd 加载（登录项中关闭后台）时，本条无法起作用，由 App 侧
  提示覆盖（另行 PR）。紧急阻断的独立主规则集在 CI 上只做了解析检查，没有在真实机器上以
  损坏的 `/etc/pf.conf` 实际加载。与 #421（H12-F1）在 `ensureAnchorLoaded` 附近有文本重叠，
  合并时需 rebase 并重算契约哈希。

## 2026-09-23 · macOS 迁移到另一台 Mac 的会话按硬件锚点丢弃，按新设备登录

- **归属/来源**：G1 账户/设备身份；影响 macOS `KeychainStore` 与 `AccountSession.restore`。
  内部审查 H11-F2（macOS 最小部分），Issue #409。基线 main 833c0607 → 分支
  `fix/macos-device-anchor-20260923`；提交时未合 main。
- **缺陷修复**：refresh token 和 installationId 的 Keychain 项虽然设了 `ThisDeviceOnly`，但没有
  `kSecUseDataProtectionKeychain`，App 也没有 access group，项目落在文件型 login keychain 中，
  该属性不生效。迁移助理或 Time Machine 恢复会把它们带到新 Mac，两台机器共用一个设备身份
  和一个单次使用的 refresh token，一台轮换后另一台被判会话死亡而登出。现在 Keychain 里另存
  `SHA256(IOPlatformUUID)` 锚点，restore 最先比对：锚点不符就删除本机副本的 refresh token 和
  installationId 并记下新锚点，随后走既有的无 token 路径（purge 托管目录、显示未登录），用户
  按新设备登录，原 Mac 的会话不受影响。旧版本存储没有锚点时直接采纳当前锚点。硬件 UUID
  读不到时不做判断。
  - 审查后补充（#414 第三轮审查的非阻断建议）：首次写入锚点失败时只记日志并保留会话，
    restore 继续，下次启动重试写入；此前该错误会让 restore 进入 `.error` 状态（保护保留、
    不登出，但无法恢复会话）。锚点不符后的删除 token、删除 installationId 和写入新锚点失败
    仍然抛错。
- **新增/优化**：无。
- **工程与测试**：新增一个 XCTest
  `KeychainDeviceAnchorTests.testASessionCarriedToAnotherMacIsDroppedAndGetsANewDeviceIdentity`：
  用注入的锚点 "mac-a" 建立会话，再用 "mac-b" 调用，断言 refresh token 已删除、installationId
  已更换，同锚点重复调用则保留会话。旧代码没有这个检查（测试无法编译，即失败）。
  审查后在同一个测试开头补了断言：首次写入锚点被注入的写入函数拒绝时，函数返回 false 且
  不抛错，锚点仍为空（下次启动重试）。修改前的分支上首次写入失败会直接抛错，且没有
  `recordAnchor` 参数，测试无法编译，即失败。
- **验证**：本机（编辑机）未运行 xcodebuild，审查后的修正同样本机未编译；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。迁移助理 / Time Machine 场景未做实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：修复前已经克隆的两台 Mac 都会采纳各自的锚点，无法识别（需要服务端或用户
  操作处理）。更换主板会改变 IOPlatformUUID，这时会登出一次。改用 data protection keychain
  （需要 provisioning profile 和 access group，属于签名链变更）以及 Windows 变体
  （`CRED_PERSIST_LOCAL_MACHINE`、会话标记放到 `%LOCALAPPDATA%`）另行跟踪，见 #409。

## 2026-09-23 · macOS 策略 revision 只认签名内的值（H3-F5 macOS 客户端侧）

- **归属/来源**：G1 保护不放宽/签名信任边界；影响 macOS `ManagedTrafficPolicySignature.swift`、
  `ManagedTrafficPolicyProcessor.swift`、`AppState+Catalog.swift`。基线 main bb2ed4e4，分支
  `fix/macos-policy-revision-20260923`；Issue #317；与 Windows #342 同一规则；提交时未合 main。
- **缺陷修复**：签名只覆盖 `v1\n + json`，revision 在签名外却是单调闸门；被攻破的 Worker 或
  TLS 中间人可把历史真实签名策略配超大 revision 重放并写入磁盘缓存，此后真实新 revision
  全被当作旧版丢弃。改后：json 内若带 `revision` 必须等于信封 revision，否则整份拒绝（记
  `managed_direct_policy_revision_mismatch`）；只有"签名 Trusted 且 json 内 revision 等于信封"
  才算已认证 revision；已认证 revision 无视数值替换未认证的当前/缓存 revision（已被钉住的客户端
  借此恢复）；装入已认证 revision 后，未签名或旧式签名文档不能再推动闸门（静默保持）。
  AppState 内存闸门、磁盘缓存比较与 processor `persistIfNewest` 统一走 `revisionOrder`；
  认证状态只由文档与签名推出，磁盘缓存重启后结论不变。主机信任仍只由签名结论与编译期白名单
  决定，未放宽。
- **新增/优化**：无。
- **工程与测试**：新增 XCTest `testSignedRevisionOutranksAnUnsignedRevisionPin`（一次性密钥）。
- **验证**：红灯：只含测试与未接线辅助函数的提交 82cc2ede 在 GitHub-hosted macOS CI（run
  35948917094）build 作业中该 XCTest 以断言失败（测试第 80 行：json 写 revision 4、信封 5 的文档被
  接受），非编译错误。同一 run 的 policy-tests 作业因红灯提交里签名文件引用了独立编译清单外的
  `ManagedTrafficPolicyCache` 而编译失败，修复提交把按缓存取值的重载移到 processor 文件解决（工程
  修正，非产品缺陷）。修复后结果见 PR CI。本机未运行 xcodebuild/swift（AGENTS 执行地点约束）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Worker 尚未在 canonical json 中写入 revision（后续 PR，默认关闭开关），本修复
  在服务端开启前处于休眠（旧文档行为与现状相同）；AccountSession 诊断显示的
  `trafficPolicyRevision` 仍取历史最大值，被钉住后恢复时该显示值不回落（仅诊断，不影响闸门）；
  无实机验证。

## 2026-09-23 · macOS 网络日志上传：服务器明确不存储时停驻，不再重发整段

- **归属/来源**：G2（客户端 3.5 网络日志上传，#137）；macOS App `DiagnosticsLogUploader`。
  内部审查 H13-F1，Issue #452（Windows 对应修复另开 PR）。基线 main bb2ed4e4 → 分支
  `fix/log-upload-standdown-macos-20260923`；提交时未合 main。
- **缺陷修复**：上传默认开，Worker 只为 ops 打开采集窗口的设备存储，其余返回 200
  `stored:false`。App 把它当普通失败：保留整段、游标不动，按 120→960 s 退避后重发同一段
  （最多 2 MiB gzip），无限期；已连接时这些字节经出口节点计入用户配额。现在
  `uploadDiagnosticsLogSegment` 对不存储回执抛出专用 `DiagnosticsLogNotStoredError`
  （文案不变），上传器收到后丢弃内存中的段（服务器已说明未存该键）、游标保持不动、进入停驻：
  每 30 分钟用不超过 64 KiB 原始数据的小段探测一次；任何一次成功存储即结束停驻并恢复正常
  分段。手动“立即上传”仍显示“未存储”的原因。
- **新增/优化**：无。
- **工程与测试**：`DiagnosticsLogUploadOutcomeTests` 新增一个 XCTest
  `testANotStoredReceiptStandsDownToASmallProbe`：约 280 KB 日志，首段 1,200 行被拒后，
  下一次间隔为停驻间隔，第二次只发不超过 64 KiB 的探测段。旧代码下第二次会重发同样的
  1,200 行整段（新测试引用的错误类型与间隔常量在旧代码中不存在）。已有
  `testNoStoreLogReceiptReportsFailureAndRetainsTheUploadCursor` 语义不变（拒收后同一序号
  重试、存储后游标前进）。
- **验证**：本机（编辑机）未运行 swift/xcodebuild；编译与 TonoTests 委托本 PR 的
  GitHub-hosted `macos-26` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：停驻状态只在内存中，App 重启后第一次仍会发一个完整段再进入停驻。ops 打开
  采集窗口后最长约 30 分钟才开始上传。实际上行字节量需实机抓包确认。

## 2026-09-23 · macOS 登出时删除含账户出口凭据的 sing-box 运行时文件

- **归属/来源**：G1 账户隔离；影响 macOS `ManagedExitCatalogOwnership`/`ConfigStorage`。
  内部审查 H11-F1（macOS 部分），Issue #407。基线 main 833c0607 → 分支
  `fix/macos-runtime-copy-20260923`；提交时未合 main。
- **缺陷修复**：`CoreRuntimeManager` 把 sing-box 运行时写到
  `~/Library/Application Support/Tono/config/config.json`，其中含节点 `uuid`、Reality 参数、
  住宅 socks 用户名/密码和 clash_api secret。登出屏障 `purge` 只删目录缓存并丢弃托管地区，
  该文件一直留到下一个账户连接时才被覆盖。现在所有权丢弃（`purge`：用户登出、账户丢失、
  无 token 启动；`adopt` 到其他账户）同时删除该文件。helper 运行的是 `/var/run/tono-core`
  下自己的 root 快照；每次 start/reload 都会先重写用户侧文件，因此删除不影响运行中的 Core。
- **新增/优化**：无。
- **工程与测试**：新增一个 XCTest
  `ManagedExitCatalogOwnershipTests.testSignOutRemovesTheRuntimeBuiltFromTheAccountsCatalog`：
  在 `runtimeConfigPath` 写入含住宅密码的文件，调用 `purge()`，断言文件已删除。旧实现不删，
  断言失败。
- **验证**：本机（编辑机）未运行 xcodebuild；委托本 PR 的 GitHub-hosted `macos-26` CI
  （TonoTests），结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：macOS 没有卸载器，拖走 App 后 App Support 仍会残留（平台惯例，未处理）。
  未做实机验证。
## 2026-09-24 · exit-agent `rmu` 改为位置参数 email（Xray 26）

- **归属**：ops 出口节点吊销与计量；`services/exit-agent/reconcile_and_report.py`。
- **来源**：`train/fleet-20260924`（PR #563）上的续修提交；未合 main。
- **缺陷修复**：Xray 26.3.27 的 `xray api rmu` 只接受 `-tag=<tag> <email>...`，旧代码传 `--email=` 每轮报
  `flag provided but not defined: -email`，agent 拒绝本轮，吊销不执行、计量停止（179.253.233.220 自 2026-09-18 05:00 起）。
  两处删除（shared-legacy 与逐标签）改走同一 helper `remove_inbound_user`，生成
  `api <cmd> --server=<addr> -tag=<tag> <email>`；`removeuser` 用同一形式。
  续修：Xray 26 `rmu` 删除失败也返回 0，旧判定（rc≠0 且无「not found」才算失败）会把 inbound tag 错误
  （`handler not found`、`Removed 0 user(s)`）当作已删并 ACK roster。现由 `removal_succeeded` 判定：输出含
  `User <该 email> not found` 算已删；否则须 rc=0 且 `Removed N user(s)` 中 N≥1；其余一律计入 failures、阻止 ACK。
  续修 2（Codex 核实 b3299814 为 PARTIAL）：判定改为整行匹配（v26.3.27 `inbound_user_remove.go` / `inbound_user_add.go`
  的原样输出），回显的 email 或 tag 不能再冒充总数行或逐用户行；出现 `failed to get handler` / `handler not found`
  时不认逐用户 not-found。同类既有缺陷：`adu` 在 RPC 错误后同样 rc=0 并打印 `Added 0 user(s) in total.`，旧代码记为新增、
  写入清单并可 ACK roster；现须整行 `Added N user(s) in total.`（N≥1），或该 email 的整行
  `proxy/vless: User <email> already exists.`（视为已在）。旧 `adduser`/`adi` 路径（Xray 26 不可达）保留原判定。
  续修 3（Codex 核实 42653897 为 PARTIAL）：含换行或其他不可打印字符的 email 回显后可拆出独立的整行成功文本，
  现在此类 email 的 `rmu`/`adu` 一律判为失败（不 ACK、不从清单删除）。旧 `removeuser` 恢复原判定
  （rc=0 或 stderr 含 not found 即已删），不再套用 Xray 26 的输出规则。
  续修 4（Codex 核实 163cb823：RR2 FIXED，RR1 PARTIAL）：不可打印 email 不再交给 subprocess（NUL 字节曾抛
  `ValueError` 并跳过其后所有删除），直接记为失败；`TONO_XRAY_INBOUND_TAG` 只允许字母、数字、`.`、`_`、`-`，
  否则本轮拒绝（tag 回显同样可伪造整行成功文本）。
  续修 5（Codex 核实 26dc5647：tag 与 NUL 已修，legacy 残留）：拒绝结果的 stderr 不再包含 email，否则旧
  `adduser`/`adi` 的「already exists」判定会把 `u:a\x00already exists` 读成已在并 ACK。
  续修 6（Codex 核实 4e3d6887：rmu/adu 已修，legacy 残留）：旧 `removeuser`/`adduser`/`adi` 不再在整段输出里找
  「not found」/「already exists」子串，只认一整行 `…User <该 email> not found.` / `already exists.`；否则按退出码。
  回显的 email 不能构成点名其自身的整行。舰队全部为 Xray 26.3.27，legacy 分支不可达，此项仅为防御。
- **新增/优化**：无。
- **工程与测试**：回归 `test_rmu_success_is_read_from_its_output_not_its_exit_code` 用节点实测的三段 rc=0 输出
  （用户不存在→已删，错误 tag→失败，`Removed 1`→已删），并断言 rmu argv 恰为
  `api rmu --server=<addr> -tag=<tag> <email>`、不含 `--email`（取代先前单独的 argv 测试）；另含两例回显伪造（均须失败），以及续修 3 的换行 email 伪造（rmu/adu 均须失败，在 42653897 上失败）和 `removeuser` rc=0 判已删；续修 4 的 NUL email 不进 Xray 且后续删除照常、换行 tag 被拒（在 163cb823 上失败）。
  新增 1 个 adu 回归：`Added 0` + RPC 错误 → 失败、reconcile 拒绝，不返回清单。fixture 修正：原有测试中按
  `--email=` 解析 rmu 参数的 mock/断言改为位置参数；成功删除的 rmu mock 由空输出改为打印 `Removed 1 user(s) in total.`；成功添加的 adu mock 改为打印
  `Added 1 user(s) in total.`，「已存在」mock 由 rc=1 `User already exists.` 改为 Xray 26 实际的 rc=0 逐用户行。
- **验证**：MacBook 工作树 `cd services/exit-agent && python3 -m pytest -q`：91 passed, 7 subtests passed（续修 3 后）。
  rmu 输出样本来自 179.253.233.220（Xray 26.3.27）实测；adu 的 RPC 错误与 already-exists 行按 v26.3.27 源码
  （`proxy/vless/validator.go`）构造，未在节点实测；修复本身未在节点上运行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：节点部署待做；`DeadlineExceeded` 等其余错误输出按失败处理，未逐一实测。旧 `adduser`/`adi` 分支仍用 `--email=`/`--uuid=`，Xray 26 提供 `adu` 时不会走到。

## 2026-09-24 · fleet 合并列车（exit-agent #389→#375→#384→#464，ops-panel #466→#368→#373→#367→#377）

- **归属**：ops 控制面 / 出口节点吊销与计量、hub 运维任务；`services/exit-agent`、`ops-panel`，#375 附带控制面 migration 0081。
- **来源**：origin/main 8dc79a5b → 分支 `train/fleet-20260924`，按记录顺序 `--no-ff` 合入 9 个 PR；各 PR 的缺陷与测试见下方各自条目。
- **缺陷修复**：无新增；只有合并时的组合处理（按 r4 审查记录 `r4-fleet-merge.log` 与 #464 PR 正文）：
  - `run_once` 经 `fetch_roster_or_discard_cache` 取 roster；#375 的 `except NodeDisabled` 在 #464 的 `except Exception` 之前，并先 `discard_roster_cache`，删除失败写进最终 Refusal，撤回照常执行。
  - #375 停用分支自行容错加载 state（#389 已把 state 加载移到吊销之后），state 不可用时仍撤回，只是不写回清单。
  - #384 的 `retire_override`（bool|None）替换旧字符串比较，也传给 #464 的 `run_outage_round`；#384 早期 `rmu shared-legacy` 失败改为计入 #389 的 failures，不再中断其余删除。
  - #384 的静态配置持久化挪到 reconcile 之后、state/source/待发报告检查之前（#389「吊销先于计量检查」），失败仍按 #384 延到计量后才拒绝；#464 的 `cache_error` 放在它之后。
  - `run_outage_round` 容错加载 state，先按缓存恢复客户端，再在 state 不可用时拒绝（与 #389 可达路径一致；#464 正文建议「state 不可用则不恢复」，此处按 r4 记录）。
  - ops-panel `collect.py`：#368 的 `ssh_password_argv` 与 #373 的 `public_ip`/`probe_target` 取并集；`tests/test_collect.py` 两个测试类都保留。#373 条目中两行仅含空格的行去掉尾随空白。
- **新增/优化**：无。
- **工程与测试**：无新测试；各 PR 自带测试全部保留。
- **验证**：MacBook 列车工作树 `python3 services/exit-agent/test_reconcile_and_report.py`（89 通过）；`python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`（29 通过）；home-agent 与 exit metering 配置脚本测试通过；`services/control-plane` `npm run typecheck` 通过、`npx vitest run` 892 通过。未连接真实节点、hub 或探针，未部署。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：部署前置——#368 需先在 hub 登记节点与探针 known_hosts；#377 需为自定 unit 的节点在 hub `nodes.secrets.json` 填 `serviceName`，并与 #466 同时或之后部署（hub 上 `jobs.py` 与 `collect.py` 一起更新）；#384 需先在真实 Xray 25.3.6/26.x 确认 vless `clients: []` 能通过 `run -test`。`state.json.roster` 为明文凭据。#375 与控制面 #451 的 `revokeExitToken` SQL 相邻，后合者手工保留两边。
## 2026-09-24 · Windows 托盘图标随每次状态发布刷新，提示不再被速率覆盖

- **归属/来源**：G2 保护状态真实性；Windows App 原生托盘（`core/tray`、`tono/commands/mod.rs`）。
  内部审查 H16-O-F2（= H16-C-F4），Issue [#517](https://github.com/raydocs/tono/issues/517)。
  基线 main 8dc79a5b（2026-09-24 rebase），叠在 #513 之上 → 分支 `fix/win-tray-icon-state-20260924`，
  PR [#518](https://github.com/raydocs/tono/pull/518)；提交时未合 main。
- **缺陷修复**：托盘图标只在创建托盘、启动时一次性 `update_part` 和前端从不发送的图标偏好补丁时
  取样；`emit_status` 只刷新菜单（Windows 上为空操作）和提示。连接、Protected Offline、恢复网络后
  图标都停在启动时的样子（通常灰色）。另外 connecting/disconnecting 映射到绿色「已连接」图标；
  默认开启的速率显示每秒用速率文字整段替换提示，关闭时又设为「Tono」，保护状态行消失。
  现在 `emit_status` 只调用 `Tray::refresh_status`：在 `projection_lock` 下读取一次状态，同一快照
  设置菜单、图标和提示；偏好路径的 `update_icon` 也取同一把锁，旧刷新不能盖回新图标。connecting/
  disconnecting 改为灰色图标。提示由状态行和可选速率行组成，状态在前（Windows 只保留前 128 个
  UTF-16 单元）；速率任务只更新速率行，两边都在同一把锁内写原生提示。
  审查续修（518-O-F1 = 518-C-F1）：退出/重启期间 `is_exiting` 使状态发布跳过托盘，用户在拒绝
  对话框选「保持打开」后托盘仍停在退出前的图标和「已保护」。现在每个取消分支清除标志后都重新
  投影一次托盘（`surface_cancelled_quit` 与重启清理失败分支）。速率任务在退出开始后永久结束，
  取消后提示会一直带着最后一次速率（518-O-F2，经核实）：任务结束时清掉缓存的速率行，取消后按偏好
  重新启动速率任务。
- **新增/优化**：无。
- **工程与测试**：托盘刷新改经 `TrayProjectionTarget` 接缝（App 实现写 Tauri 托盘）。新增一个
  `#[tokio::test]`：经 `emit_status` 所用的 `refresh_status_on` 发布 Connected 状态，再经速率任务
  所用的 `show_speed` 写一次速率，断言菜单刷新一次、记录到 Tun 图标、第一次提示含保护状态行、
  第二次提示为「状态行 + 速率行」（审查续修 518-O-F3 = 518-C-F2：原测试直接调用私有投影并手工
  设置速率字段）。`emit_status` 到 `refresh_status` 的一行与 `AppTray` 绑定需要 Tauri AppHandle，
  未被测试覆盖。原有图标映射测试把 connecting 固定为 Tun，改为断言 connecting/disconnecting 为 Common。
- **验证**：本机（编辑机）未运行原生 cargo；Tauri crate `cargo test --locked` 委托本 PR 的
  GitHub-hosted `windows-2025` CI，结果以 PR 页为准。新测试在旧代码上的失败未运行（旧代码无此
  接缝，发布路径没有图标步骤）。改动文件的新增行用 rustfmt `--check` 核对无新增格式差异。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在实机上观察图标与提示；自定义托盘图标偏好与状态投影共用 `latest_arc`。
  对话框显示期间托盘仍是退出前的样子，取消后才重投影；确认退出则不再刷新。本 PR 叠在 #513
  （托盘提示按 live 证据显示「保护状态未确认」）之上，含其提交，不能单独合入。
  与 #520 都改 `feat/window.rs` 的取消路径，但改动不在同一行块。
  未验证的 Protected Offline 仍用橙色图标，与 flyout 一致（518-O-F4 经核实驳回，不改）。
  取消恰好发生在速率任务收尾的毫秒级窗口内时，任务不会重启，直到下次启动。

## 2026-09-24 · Windows 横幅、登录卡与托盘提示只在 Service 确认屏障时说「已拦住」

- **归属/来源**：G2 保护状态真实性；Windows App 前端与托盘。内部审查 H16-O-F1（= H16-C-F5），
  Issue [#511](https://github.com/raydocs/tono/issues/511)。基线 main 8dc79a5b（2026-09-24 rebase）→ 分支
  `fix/win-blocked-evidence-20260924`，PR [#513](https://github.com/raydocs/tono/pull/513)；提交时未合 main。
- **缺陷修复**：b489ea16 已让仪表盘 pill、进度卡、仪表盘提示和托盘面板在
  `killSwitch.wanted && live` 不成立时显示「保护状态未确认」，但三个表面仍只看状态机锁存：
  非仪表盘页的 Protected Offline 横幅（「已拦住直连，正在换线重试」）、登录页「网络已被拦截」卡片、
  原生托盘提示（「保护已开启，当前未连接」）。启动时 Service 探测不到（`kill_switch = None`）时，
  这些表面与仪表盘互相矛盾，并声称正在换线重试，而 Windows 从不自动换线，未验证会话也没有排程重试。
  现在三处都用同一证据规则：无 live 屏障时标题改为「保护状态未确认」并复用
  `tono.progress.protectionUnknownBody`（托盘新增 `tray.tono.state.protectionUnknown`，仅 en/zh）；
  横幅只在 `nextRetryAtMs` 存在时说「已安排自动重试」，否则用「连接不可用期间直连已被拦住」，
  并删去「换线」。卡片可见性、登录输入禁用、恢复网络与重试按钮不变，保护不放松。
  审查续修（513-O-F1）：登录卡的未确认说明不再复用提到「恢复正常网络」的通用文案，改用新键
  `tono.login.networkBlocked.unverifiedDescription`（en/zh），点名卡片上的「恢复网络」按钮并说明之后
  可登录。
- **新增/优化**：无。
- **工程与测试**：`ProtectedOfflineBanner.test.tsx` 原 fixture 没有 `killSwitch` 却断言
  「Protected offline」，固定了缺陷；改为默认带 `wanted/live=true`，并新增一个 `it`：
  `{uiState:'protectedOffline', killSwitch:null}` 在 `/servers` 必须显示
  `tono.pill.title.protectionUnknown` 且不得出现 `protectedOfflineDescription`。托盘测试 fixture
  补新字段 `protection_live`，不新增托盘测试。
- **验证**：MacBook worktree（node_modules 软链主仓库）：新 `it` 在旧代码上失败（1 failed / 4 passed），
  修复后 `vitest run` 该文件 5/5 通过；`ProtectedOfflineBanner`、`login`、`tono-auth-guard` 三个文件
  29/29 通过；`tsc --noEmit` 通过；三个 tsx 文件 eslint 通过。托盘 Rust 改动未在本机编译，
  以 PR 的 Windows CI（`cargo test --locked`）为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：托盘提示在开启速率显示时仍会被速率文字覆盖，托盘图标也不随状态刷新
  （H16-O-F2，另一 PR）。其余 11 种托盘语言缺新键时按 rust-i18n 回退到 zh。与在审 #460 同改
  `login.tsx`，但不在同一行块；合并顺序见 PR 正文。
## 2026-09-24 · Windows 启动恢复遇 401：账户进入 Suspended，不再释放 WFP、不再登出；暂停页可退出登录

- **归属/来源**：G2 客户端账户状态；Windows App `tono/commands/restore.rs`、`tono/commands/account.rs`，
  前端 `pages/tono/login.tsx`。内部审查 H17-O-F2（Windows 部分，= H17-G-F3 第 2 步），Issue #512
  （macOS 对应 #510）；含审查轮 515-O-F1/515-C-F2、515-O-F2/515-C-F1、515-O-F4 的修正。基线 origin/main
  8dc79a5b（初版写于 bb2ed4e4，经 059a2ea2 rebase；三者之间 `apps/windows` 无差异）→ 分支
  `fix/windows-auth-401-keeps-protection-20260924`（PR #515）；提交时未合 main。
- **缺陷修复**：套餐到期、流量用尽、账户停用、设备或会话被吊销时，Worker 对 `me` 与
  `auth/refresh` 一律回 401，tono-core 自己的 refresh 也被拒后返回 `Unauthorized`。启动恢复
  （含重启后、错误页 Retry）把它当作"会话已死"：`close_account_with(Expired)` 先走
  `release_for_account`（DNS → Core → WFP 有序释放），再登出并删掉保存的 refresh token，界面
  落到不给原因的登录页。现在 `me()` 的任何失败都由 `settle_failed_restore` 处理：保护状态按
  Service 读数原样保留（与非 401 错误分支相同），401 让账户进入已有的 `Suspended`，不登出、
  不删保存的会话。已有守卫拒绝 suspended 账户的 connect 与自动重连；登录页的暂停页在保护阻断时
  照旧提供"恢复网络"（显式 Disconnect）。保留会话是必要的：Windows 无 token 的启动路径会释放
  已存的屏障，登出只会把释放推迟到下次启动。
- **缺陷修复（审查轮）**：暂停页原先只有恢复网络、联系客服和"换邮箱"，而 Worker 不给不合格
  账户发验证码，保留会话后用户无法回到已退出状态。暂停页新增"退出登录"，调用现有
  `tono_sign_out`：与账户页相同，先释放保护，释放无法证明时保留账户并显示错误；成功后清掉账户
  相关缓存再刷新状态。Service 仍持有上一会话的 Core 且隧道放行已渲染（`mode: locked`、
  `tunnel_permit_rendered`）时，登录页的恢复提示原先写"网络已被保护拦住"，实际上一连接仍在
  转发流量；该状态下改为"上次的连接仍在运行 / 恢复网络会停止它"（en、zh，i18n 类型已重新生成），
  按钮与显式 Disconnect 不变。
- **新增/优化**：无。
- **工程与测试**：restore 在保护探测之后的部分（token 探测、预算内的 `me()`、结果分派与账户
  落状态）移入 `restore_account_with`，只注入系统 I/O：`me()`、屏障释放、服务器登出与 UI emit；
  生产传入 `client.me()`、`release_for_account`、`client.logout()`、`emit_status`。删除随 401 路径
  失效的 `close_dead_restore_with`、其回归
  `expired_restore_reserves_account_ownership_before_its_first_side_effect`（W11）与
  `AccountCloseReason::Expired`；新路径在同一把锁内检查代际并落状态，没有 await 与副作用，W11
  的竞态不再存在。Rust 一个 `#[tokio::test]` `rejected_restore_suspends_and_keeps_protection`：
  真实 tono-core `ApiClient` 配对所有请求回 401 的 transport（先装 access token，请求顺序为
  `me` → `auth/refresh`），经 `restore_account_with` 的真实分派；断言注入的 release 与 logout
  都未被调用、账户 Suspended、kill switch 仍武装且 `is_protection_blocked`、Service 状态原样、
  未开始 account close、保存的 refresh token 仍在。红：提交 59ce9fb1 只含 seam 与该测试
  （行为未改），GitHub-hosted `windows-2025` CI（run 35978180190，app-rust）在该测试的 `restore.rs:475` 断言
  "a refused session must not release WFP" 处失败（504 passed，1 failed），不是编译错误；修复提交后通过。前端
  `login.test.tsx` 一个 `it`：暂停页点"Sign Out"调用 `tonoSignOut`（不调用 `tonoDisconnect`）
  并刷新状态，状态取上一连接仍在运行的屏障，同时断言"Previous connection still running"而非
  "Internet is blocked"；在本 PR 之前的 login.tsx 与只加了退出按钮的版本上都失败，本机确认。
- **验证**：本机（编辑机）：`vitest run src/pages/tono/login.test.tsx` 8/8，改动文件的
  `tsc --noEmit`、biome format、eslint 通过。Rust 未在本机编译，Tauri crate `cargo test` 委托
  本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Worker 仍对所有不合格情况回 401，客户端分不清到期、停用与设备吊销（H17-O-F2
  的 Worker 部分未修）；未合 #460 前暂停页文案是"账号已暂停"，#460 合入后为中性的"登录已失效"。
  到期账户在登录页请求验证码得到 202 但收不到码（Worker 行为，未改）。保存的会话被服务器拒绝
  后，每次启动仍会发一次注定失败的 refresh，直到重新登录或在暂停页退出登录。续费后若 cron 已
  吊销会话，仍需重新登录。启动遇 401 时从缓存载入的目录保留到新登录（数据保留问题；其中出口
  凭据已被服务端拒绝，connect 也拒绝 suspended 账户）。"上一连接仍在运行"只按 Service 报告的
  屏障状态判断，未在 Windows 11 实机验证。
## 2026-09-24 · Windows 退出/重启拒绝对话框按 Service 读数说明保护状态

- **归属/来源**：G2 保护状态真实性；Windows App `feat/window.rs`。内部审查 H16-O-F6，
  Issue [#519](https://github.com/raydocs/tono/issues/519)。基线 main 8dc79a5b（2026-09-24 rebase）→ 分支
  `fix/win-quit-refusal-copy-20260924`，PR [#520](https://github.com/raydocs/tono/pull/520)；提交时未合 main。
- **缺陷修复**：交互式退出/重启在 8 s 内证明不了释放时，原生对话框固定写「网络保护仍然有效
  ……本机保持受保护，现在退出也保持如此」，不读 Service。8 s 超时不会取消释放，后台释放仍可能
  完成并移除 WFP；有待完成更新时 Quit 在查看屏障前就被拒绝，从未受保护的主机也会看到同一句话。
  现在出错后先有界（2 s）读取 Service 的 kill-switch 状态，由纯函数 `classify_refusal` 分三类：
  只有 Service 报告 `wanted && live` 且没有释放仍在运行时才说「保持受保护」；等待超时或读取前后
  任一时刻仍登记着释放（例如待完成更新的拒绝先于正在进行的 Disconnect 返回）时说释放可能仍在
  完成；无应答或未报告 live 屏障时说无法确认。三种文案都保留同样的恢复步骤。取消逻辑和退出
  决策不变。审查续修：「释放已结束」不再只看是否超时，还看 `release_in_progress`（520-O-F1 =
  520-C-F1）；原样插入的释放错误含「protection stays on」「assumed on」，会与无法确认的分支
  矛盾，改为只写入日志、对话框提示见日志（520-C-F2，经核实）；标题、正文和按钮改经
  `tono_i18n::t!`，新增 en/zh 键 `exitRefusal.*`（520-O-F3 = 520-C-F3）；等待超时或已有释放登记时
  文案不取决于读数，不再做那次最长 2 s 的 Service 读取（520-O-F2）。
- **新增/优化**：无。
- **工程与测试**：新增一个 `#[test]`，断言 Service 无应答、`wanted=false` 为「无法确认」，超时或
  仍有释放登记（即使 `wanted && live`）为「释放可能仍在完成」，只有两者皆无且 live 屏障时为
  「保持受保护」。
- **验证**：本机（编辑机）未运行原生 cargo；Tauri crate `cargo test --locked` 委托本 PR 的
  GitHub-hosted `windows-2025` CI，结果以 PR 页为准。新测试在旧代码上的失败未运行（旧代码无该
  函数，文案为硬编码常量）。改动行用 rustfmt `--check` 核对无新增格式差异。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在实机上触发慢释放。App 侧 IPC 报错而 Service 仍在处理释放的情况下，读数可能
  仍是 `wanted && live`，对话框会说「保持受保护」，随后释放完成；此窗口未消除。其余 11 种托盘
  语言缺 `exitRefusal.*` 时按 rust-i18n 回退到 zh（与 #513 同一取舍）。对话框不再显示具体错误。
  与 #518 都改 `feat/window.rs` 的退出路径，改动不在同一行块。
## 2026-09-24 · Windows 连接不再关闭非 Tono 的系统代理

- **归属/来源**：G1 客户端保护边界（首次连接/断开对系统状态的改动）；Windows App。基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支 `fix/win-sysproxy-owner-20260924`，Issue #541
  （内部审查 H19-C-F1，跨厂商核实 confirmed）；未合 main。
- **缺陷修复**：每次连接在 Service 就绪后、WFP 武装前无条件把当前用户的 WinINET 代理（LAN 与全部 RAS/VPN 项）写成
  直连，断开、停 Core、Service owner 丢失恢复再写一次，且从不保存或恢复原配置；公司代理/PAC 或其他产品的代理被
  静默关闭并跨卸载保留。改后：Windows 上只有「当前设置的每个生效部分都指向本安装自己的回环监听」（手动代理为
  `127.0.0.1`/`localhost` + 已配置 Mixed Port，或 PAC 为本实例 `http://127.0.0.1:<端口>/commands/pac`）才清除；
  其他代理原样保留，因此无需保存/恢复。连接侧的清除移到 `run_stages` 成功（屏障已武装）之后；断开、停 Core、
  owner 丢失恢复走同一所有权判定；设置读不出时不清除。
- **新增/优化**：无。原生更新事务的前置条件不变：`tono_install_update` 与待定更新的显式 Disconnect 改调
  `proxy_control::clear_for_update()`，仍无条件关闭（其 Service 在 `security::no_proxy` 拒绝代理开启时暂存）。
- **工程与测试**：`core/sysopt.rs` 一个 `#[test]`（`only_a_proxy_naming_tono_listeners_is_cleared`）：公司代理、另一产品
  回环端口、外部 PAC、Tono 端口+外部 PAC 均不算 Tono 所有；只有指向本安装监听的遗留才清除。
- **验证**：见 PR；红：仅测试提交在 CI 编译失败（旧代码没有所有权判定）；绿：Windows CI `cargo test --locked`。
  MacBook 未编译 Rust（仓库规则）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：用户主动安装更新时仍会关闭非 Tono 代理（更新事务设计，非本修复范围）；不兼容隧道的外部代理不再被
  清除，连接后该代理可能不可用，本修复不提示也不征求同意；RAS 项仍随 LAN 一起清（仅在 LAN 设置证明是 Tono 遗留时）；
  未实机验证。
## 2026-09-24 · Windows 最终卸载删除 Service 的 owner 运行时配置

- **归属/来源**：卸载恢复原状/凭据残留（L1、C4）；Windows 卸载助手。叠在 #549 修复分支
  `fix/win-update-recovery-task-20260924`（`--final-uninstall` 机制）之上；本分支
  `fix/win-uninstall-runtime-config-20260924`，Issue #560（内部审查 H19-G-F4，跨厂商核实 confirmed）；未合 main。
- **缺陷修复**：Service 把 App 发来的未脱敏运行时文档（含各出口 `password`/`uuid`）持久化到
  `ProgramData\Tono\users\<owner>\runtime\config.yaml`，成功卸载（即使先断开并勾选删除数据）从不删除该树。
  改后：最终卸载（`--final-uninstall`）且结果证明 WFP 已移除时，删除整个 `ProgramData\Tono\users`（各 owner 的
  desired state、运行时配置、日志）；StillProtected、安装期清理、安装回滚、更新模式都不删。失败按外观残留处理。
- **新增/优化**：无。
- **工程与测试**：`uninstall_service.rs` 一个 `#[test]`（`final_uninstall_removes_owner_runtime_config_only_after_proven_removal`）：
  StillProtected 时 `config.yaml` 保留，Clean 时 `users` 不存在。
- **验证**：见 PR；红：仅测试提交叠在 #549 修复上，CI 运行时断言失败（旧的最终清理不删 `users`）；绿：Windows CI。
  MacBook 未编译 Rust。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：须在 #549 之后合入；`ProgramData\Tono` 根下的 `active-owner.json`、`desired-state.json` 等非凭据状态保留；
  非最终卸载（修复安装、更新）按设计保留运行时配置；未实机验证。

## 2026-09-24 · Windows 更新恢复任务在提交与最终卸载时退休

- **归属/来源**：G3 原生升级链 + 卸载恢复原状（L1）；Windows Service 更新执行器、卸载助手与 NSIS 卸载段。
  基线 origin/main [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支
  `fix/win-update-recovery-task-20260924`，Issue #549（内部审查 H19-O-F5 = H19-C-F3 = H19-G-F3）；未合 main。
- **缺陷修复**：原生更新注册的 SYSTEM `ONSTART` 任务 `Tono Update Recovery v1` 从不删除：提交后
  `cleanup_committed` 只清备份，此后每次开机仍启动 SYSTEM 执行器；卸载只删两个自启动任务，任务与
  `ProgramData\Tono\updates-v1\<attempt>` 下的执行器副本和暂存安装包在卸载后继续存在并开机运行。改后：
  (1) 执行器在提交后的清理成功后删除该任务（同 macOS 提交时退休 launchd 项），失败只记日志，下次开机的同一路径重试；
  (2) NSIS 卸载段在非更新模式下给卸载助手传 `--final-uninstall`；助手只在结果证明 WFP 已移除（非 StillProtected）
  时删除任务并在存储锁下删除各 attempt 目录，保留存储自身文件（`state.json` 的已消费高水位与手动安装租约，
  D3；租约在助手返回后由 `--manual-update-finish` 释放）。安装期清理、安装失败回滚与更新模式不传该参数，行为不变。
  这些清理失败按「外观残留」处理（退出码 2，继续卸载），不会把已证明安全的卸载变成阻断。
- **新增/优化**：无。
- **工程与测试**：两个 `#[test]`，各对应一个行为：`update_executor.rs`
  `update_commit_retires_the_recovery_task_after_cleanup`（无提交清理时不退休；清理后退休）；
  `uninstall_service.rs` `final_uninstall_retires_update_executors_only_after_proven_removal`（StillProtected 时不动；
  证明移除后退休任务、删执行器目录、保留 `state.json`）。
- **验证**：见 PR；红：仅测试提交在 CI 编译失败（旧代码没有这两个决定）；绿：Windows CI。MacBook 未编译 Rust，NSIS 未编译。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：schtasks 路径沿用注册时的 `C:\Windows\System32`（#471 合入后应一并改为系统目录；只在注册成功的机器上才需要退休，
  二者一致）；已提交 attempt 目录在提交时不删（执行器正在运行自身映像，按 D3 保留为证据），只在最终卸载时删；
  回滚终态（RolledBack）的任务仍保留到最终卸载；未实机验证任务删除与卸载顺序。
## 2026-09-24 · Windows 卸载「删除应用数据」覆盖每个本机账户

- **归属/来源**：卸载恢复原状与多用户隔离（L1/L5）；Windows NSIS 卸载段与卸载助手。基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支 `fix/win-app-data-all-profiles-20260924`，
  Issue #559（内部审查 H19-O-F7 = H19-C-F2）；未合 main。
- **缺陷修复**：勾选「删除应用数据」后只删 `SetShellVarContext current` 下的 `$APPDATA`/`$LOCALAPPDATA`，
  提权卸载时这是批准 UAC 的管理员账户：另一管理员卸载时实际使用者的数据（含账户与出口配置）保留；标准用户借管理员
  凭据卸载时反而删了管理员的目录。改后：`RemoveVergeService` 证明屏障已移除后，卸载段（勾选且非更新模式）调用
  `tono-service-uninstall.exe --delete-app-data-all-profiles`，助手枚举用户配置文件目录（`FOLDERID_UserProfiles`，
  跳过 `All Users` 等联接点），删除每个配置文件 `AppData\Roaming` 与 `AppData\Local` 下的 `com.raydocs.tono`；
  用 Rust `remove_dir_all`/`remove_file`，链接只删链接本身、不跟随，避免提权删除被某个账户的联接点重定向。
  原有当前账户 `RmDir` 保留。失败只记日志、不阻断卸载。
- **新增/优化**：无。**暂定决定（更严格）**：选择实际删除所有账户的 Tono 数据，而不是只改确认文案说明「仅删除当前账户」。
- **工程与测试**：`uninstall_service.rs` 一个 `#[test]`（`delete_app_data_reaches_every_profile_not_only_the_approving_admin`）：
  两个配置文件的 Roaming/Local Tono 目录都删除，其他应用目录保留。
- **验证**：见 PR；红：仅测试提交在 CI 编译失败（旧代码没有跨配置文件删除）；绿：Windows CI。MacBook 未编译 Rust，NSIS 未编译。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：不在 `FOLDERID_UserProfiles` 下的配置文件、文件夹重定向到别处的 AppData 不覆盖；各账户 Credential Manager
  中的会话仍按 H11-F3/#412 处理，提权进程不能删他人凭据库；另一账户会话中 Tono 仍在运行时其被占用的文件可能删不掉；
  不改 Tauri 自带的复选框文案；未实机验证。
- **跟进 2026-09-24（跨厂商审查 WA-OpenAI-1）**：修复：原只对最后一级 `com.raydocs.tono` 不跟随链接，
  `AppData\Local` 若是指向 `D:\Data` 的联接点，提权删除会删掉 `D:\Data\com.raydocs.tono`。现逐级检查配置文件目录、
  `AppData`、`AppData\Roaming`、`AppData\Local`：任何一级是符号链接/联接点/其他重解析点或无法读取元数据，就跳过整个
  配置文件并在返回错误中报告（NSIS 仅记日志）。测试：`delete_app_data_never_walks_through_a_redirected_app_data_folder`
  （Windows 用 `mklink /J` 建联接点，无需特权）；旧代码会经联接点删掉外部目录，断言失败。验证：未在本机运行；CI 待定。
  限制：检查与删除之间仍有竞态（配置文件所有者可在检查后改成联接点），未用句柄逐级打开消除；未实机验证。
- **跟进 2026-09-24（Codex 复核 WA-OpenAI-1 PARTIAL，未闭合路径）**：修复：助手跳过某配置文件后，NSIS 仍对批准卸载的管理员
  执行 `RmDir /r "$APPDATA|$LOCALAPPDATA\${BUNDLEID}"`，并直接删除窗口状态与旧 pins，绕过逐级检查。现删掉这两条 `RmDir /r`
  （该账户的目录已由 `--delete-app-data-all-profiles` 在检查下删除）；卸载段先调用新的 `--check-current-app-data`，只有退出码为 0
  （本账户 Roaming/Local AppData 位于其配置文件内，且从配置文件到最深删除路径 `com.raydocs.tono\tono` 的每级都不是链接/重解析点）
  才删窗口状态与旧 pins；助手缺失、超时或失败都保留。Rust 侧 `remove_leftover_user_control_plane_pins` 用同一检查；配置文件循环
  改用同一 `redirected_folder`。测试：packaging 新增一个 `test`（`NSIS uninstall deletes in the approving account AppData only after the
  link check`），MacBook 上改前失败、改后 23/23 通过；Rust 由既有联接点测试覆盖共用检查。验证：Rust/NSIS 未在本机运行；CI 待定。
  限制：AppData 被重定向到配置文件外时本账户的窗口状态与旧 pins 不再删除；检查与删除之间的竞态同上；NSIS 未编译，未实机验证。
## 2026-09-24 · Windows 安装器可在确认后清除无主的 Tono 拦截

- **归属/来源**：G3 客户安装/修复路径（L3 死路、C5）；Windows NSIS 模板、Service 手动安装门控、恢复脚本。叠在 #500
  （`fix/installer-filter-gate-20260923`，H15-F2）之上并合入当前 origin/main；分支 `fix/win-orphan-barrier-install-20260924`，
  Issue #564（内部审查 H19-O-F2，跨厂商核实 confirmed）；未合 main。
- **缺陷修复**：`.onInit` 的 `--manual-update-gate` 只要有 Tono WFP 过滤器就拒绝，不看是否还有 Tono Service 能拥有/解除它们；
  旧卸载器、被强删或被隔离的二进制留下持久阻断且无 SCM 注册时，App 和「恢复网络」快捷方式都不存在，安装器又拒绝，
  安装段里专为此写的 `RemoveVergeService` 清理到不了（#500 的提示仍让用户去断开）。改后：过滤器存在时按「是否仍有注册且
  二进制在盘的 Tono Service」分类——有（含已停止、SCM 读不出）仍为 `ProtectionActive`（77，行为同 #500）；确认没有则为
  新的 `OrphanedProtection`（78）。非静默安装在 78 时弹确认框：选「否」保留拦截并退出；选「是」调用新的
  `--manual-orphan-gate`（再次确认没有 Service 出现后取与卸载相同的租约），安装继续进入既有 `RemoveVergeService`，
  该阶梯只有证明 WFP 已移除才继续，否则中止且不删文件。静默安装仍拒绝。卸载器把 78 与 77 同样走 #500 的确认释放路径。
  恢复脚本改为指向当前安装器与这一确认路径，并更正「先重启」的建议（持久阻断在重启后仍在、例外不在）。
- **新增/优化**：无。**暂定决定（更严格）**：只有在证明没有 Tono Service 可再武装拦截、且用户确认时才由安装器清除；
  静默安装不自动清除。
- **工程与测试**：`core/update.rs` 一个 `#[test]`（`update_manual_gate_names_an_orphaned_barrier_instead_of_asking_to_disconnect`，
  测 `begin_manual` 实际使用的 `residual_filter_refusal` 分类）；扩展 #500 的 packaging 测试断言 78 确认分支、卸载 78→77、
  三语文案与退出码常量 78。
- **验证**：MacBook `node --test scripts/windows-packaging.test.mjs`（apps/windows/app）：在 #500 基线上该测试失败，改后 23/23 通过；
  Rust 仅 rustfmt 解析，未执行 cargo；NSIS 未编译。其余见 PR 的 Windows CI。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：须在 #500 之后合入；静默/无人值守安装遇到无主拦截仍是死路；SCM 注册存在且 `ProgramData\Tono\bin\tono-service.exe`
  在盘但 Service 本身损坏时仍按 77 处理；只识别 Tono 自己的注册与二进制路径；未实机验证（AV 隔离、旧卸载器残留、重启后状态）。
- **跟进 2026-09-24（跨厂商审查 WA-OpenAI-3）**：修复：用户确认 78 且取得孤儿租约后，若 ARP 记录完整，`DetectExistingInstall`
  仍把本次安装归为升级（`$ConfirmedExistingInstall=1`），`RemoveVergeService` 跳过清理，`--replace-runtime` 的 `manual_gate()`
  因过滤器仍在而拒绝，重试 3 次后安装中止。现 `.onInit` 在 `--manual-orphan-gate` 成功后置 `$ClearingOrphanedBlock=1`，
  `automatic_update` 见此标志即返回、不设任何升级标志：走完整 `RemoveVergeService` 清理（仍须证明 WFP 已移除）与全新安装
  Service 路径；全新路径发布 GUI/Mihomo 前先删旧文件（`Rename` 不覆盖）。测试：packaging 新增一个 `test`
  （`a confirmed orphaned-block clear reinstalls through the fresh path, not the upgrade path`），MacBook 上改前失败、改后 24/24 通过。
  验证：Rust/NSIS 未在本机运行；CI 待定。限制：此路径显示全新安装向导（不再是被动升级），App 由完成页启动而不是自动重开；旧 `tono-core` 若仍被占用，
  删除失败，安装在创建 Service 前中止；#500 尚未进 main（已在 `train/win-20260924`）；NSIS 未编译，未实机验证。
- **跟进 2026-09-24（Codex 新发现，Opus 核实 CONFIRMED）**：修复：Service 消失、WFP 残留且 `active_owner` 的
  `core_should_be_running=true`（连接中二进制被隔离即是此态）时，孤儿租约与卸载助手的紧急解除都不清该期望状态，随后全新安装
  Service 的 `manual_gate()` 以「Disconnect before manual installation」拒绝，安装仍中止。现安装段在 `RemoveVergeService`（未证明
  WFP 已移除即中止）之后、`StartVergeService` 之前，仅当 `$ClearingOrphanedBlock=1` 调用新的
  `tono-service-install.exe --retire-orphaned-owner`：`retire_orphaned_owner` 要求本安装器持有租约、无 Service、无残留过滤器，
  再调用既有 `retire_legacy_active_owner`（期望状态置停止并清 active owner）；失败则中止安装。测试：packaging 新增一个 `test`
  （`a confirmed orphan clear retires the stale connected owner only after the barrier is gone`），MacBook 上改前失败、改后 25/25 通过。
  验证：Rust/NSIS 未在本机运行；CI 待定。限制：退役失败时安装中止，此时拦截已解除但无 Service，再次运行安装器会因期望状态仍为运行
  而得到 77（Disconnect）提示；无实机验证。
## 2026-09-24 · Windows 开机自启任务按用户 SID 命名

- **归属/来源**：多用户隔离（L5，低）；Windows App `utils/schtasks.rs` 与 NSIS 卸载段。基线 origin/main
  [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支 `fix/win-autostart-task-per-user-20260924`，
  Issue #568（内部审查 H19-C-F4）；未合 main。
- **缺陷修复**：两个开机自启任务用全机固定名 `Tono` / `Tono (Admin)`；另一 Windows 用户首次连接成功后 `/Create /F`
  会替换前一用户的同名任务，管理员模式还会删除另一模式的固定名任务而不看其主体。改后：任务名带所属用户 SID
  （`Tono <SID>` / `Tono (Admin) <SID>`），创建、删除、存在性与启用状态都只看当前用户自己的名字；旧固定名任务只在其
  `<Principal>` 的 `UserId` 等于当前 SID 时视为本人所有：状态读取把它算作已启用，任何一次设置变更把它退役；他人的旧任务
  不读、不改、不删。卸载（非更新模式）在原有删除两个旧名之外，用 PowerShell `Get-ScheduledTask` 按
  `^Tono (\(Admin\) )?S-1-[0-9-]+$` 删除所有用户的新名任务。
- **新增/优化**：无。
- **工程与测试**：`schtasks.rs` 一个 `#[test]`（`autostart_tasks_of_two_windows_users_never_share_a_name`）：两个 SID 的两种模式
  名称互不相同且不同于旧名，CSV 列表只匹配本人名字，旧任务只有主体为本人 SID 时才归本人。
- **验证**：见 PR；红：仅测试提交在 CI 编译失败（旧代码没有按用户命名与主体判定）；绿：Windows CI。MacBook 未编译 Rust，NSIS 未编译。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：旧版以 `DOMAIN\user` 形式记录主体的旧任务不会被识别为本人所有（保持不动，由卸载删除）；已升级用户在下次改动
  设置前继续由其旧名任务自启；卸载依赖 PowerShell ScheduledTasks 模块；未实机验证多用户切换。
- **跟进 2026-09-24（跨厂商审查 WA-OpenAI-4）**：修复：旧名任务的归属检查或删除失败只记日志，关闭/开启只看按 SID 命名的新任务，
  于是关闭自启返回成功而本人的旧任务仍在登录时启动 App。现 `retire_owned_legacy_tasks` 返回错误：本人所有且删不掉、已列出但定义
  读不出（可能是本人的）、或无法列出任务时都算失败；`set_auto_launch` 开启时在创建新任务前返回该错误（避免双启动），关闭时先删完
  新任务再返回。他人的旧任务仍不动、不报错。测试：`a_legacy_task_this_user_may_own_that_stays_fails_the_autostart_change`
  （注入查询/删除）；旧代码只记日志、返回 `()`，前两种情形会被当作成功。验证：未在本机运行；CI 待定。限制：另一账户的旧任务若
  对本人可见但定义读不出，本人改自启设置会失败，直到管理员删除它；`is_auto_launch_enabled` 仍只把可读且本人所有的旧任务算作开启；
  未实机验证。
## 2026-09-24 · Windows 内部候选版默认发送分类连接失败记录

- **归属/来源**：G1–G3 候选验收的现场证据；影响 Windows App（`tono/audit.rs`、`tono/telemetry.rs`、设置页）与
  `windows-candidate.yml`。所有者决定 2026-09-24：内部候选/测试版默认开启分类连接失败遥测，公开发布版保持现状（关）。
  基线 origin/main [8dc79a5b](https://github.com/raydocs/tono/commit/8dc79a5b)，分支
  `fix/win-candidate-telemetry-20260924`，Issue #575，未合 main。
- **缺陷修复**：无（行为变更来自所有者决定）。
- **新增/优化**：a68d4e76 起立即 `telemetry/failures` 与诊断时间线共用默认关闭的同意开关，升级时 v2 迁移还会把旧的开启重置为关，
  候选版与公开版行为相同，测试者失败连接从未到达运维。现在：编译期 `TONO_BUILD_CHANNEL=internal`，只由候选 workflow 设置（沿用的 `GITHUB_WORKFLOW` 出处判断在
  paired candidate 的可复用 workflow 下拿到的是调用方名称，不可靠，故新增显式标记）。内部版在未开启时间线时也发送分类记录
  （阶段、错误代码、版本、节点、平台/OS、传输、路径延迟），错误原文仍只在用户显式开启时间线后附带；本地诊断日志开关关闭时一律不发。
  默认值来自构建而不是 `settings.json`，v2 重置无法在升级时关掉它。内部版设置页隐私卡片显示一行提示。公开版逻辑不变。
- **工程与测试**：一个 `#[test]`（`internal_builds_keep_classified_failure_reports_through_the_timeline_reset`）；新增只读命令
  `tono_internal_build`；i18n 生成文件由 `generate-i18n-keys.mjs` 重生成。
- **验证**：本机仅前端：`tsc --noEmit`、`vitest run src/services/tono.test.ts`、eslint、biome format、
  `windows-ci-paths.test.cjs` 通过；Rust 未在本机编译（按执行位置规定），以 PR CI 的 `cargo test` 为准，红→绿运行号见 PR。
- **候选/发布**：无新包，仅源码；下一次候选构建才会带内部标记。
- **剩余限制**：未在真实候选安装包上验证提示与上报；测试者只能用本地诊断日志开关停止上报（无单独开关）；
  时间线窗口本身仍默认关闭。
## 2026-09-24 · Windows 更新发现：一次检查连同重试失败后不再永久停摆

- **归属/来源**：G3 更新通道（发现环节）；Windows App 前端 `hooks/use-update.ts`。内部审查 H18-O-F1，
  Issue #543。基线 origin/main 8dc79a5b → 分支 `fix/win-update-discovery-retry-20260924`，PR #544；提交时未合 main。
- **缺陷修复**：自动更新检查只靠 SWR 的 24 h `refreshInterval` 与 `retry: 2`。首次检查和两次 5 s 重试都失败
  （如开机自启时网络未就绪）后，SWR 缓存保留错误，锁定版本 2.5.1 的轮询在有缓存错误时跳过每个 tick；
  reconnect 重验证也因查询适配层传入 `undefined` 覆盖默认值而关闭；原生 `start_background_check` 无调用者。
  结果是 App 不重启、不手动检查就再也不自动发现新版本。现在缓存出现错误时另起一个不受该门控的 1 h
  重查计时器（每次失败换新错误对象，计时器随之重排；成功后错误清除，恢复原 24 h 轮询），并对该查询开启
  reconnect 重验证。仍走原有受 Service 验签保护的 `tono_check_update`。
- **新增/优化**：无。
- **工程与测试**：新增一个 vitest `it`（`src/hooks/use-update.test.tsx`，假计时器）：前三次检查失败、之后成功，
  推进 24 h + 1 min 后必须至少第四次检查并持有 offer。旧代码只有 3 次调用（本机实跑红，见 PR）。
- **验证**：本机 `vitest run src/hooks/use-update.test.tsx` 修复前 1 failed（expected 3 ≥ 4）、修复后 1 passed；
  `tsc --noEmit` 与该两文件 eslint 通过。完整 `pnpm test` 由本 PR 的 GitHub-hosted CI 执行，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：Settings 页打开时有多个 `useUpdate` 实例挂载，错误状态下每小时可能并发 2–3 次检查（结果以最后一次为准）；
  托盘隐藏窗口是否被 SWR 视为 hidden（影响成功路径的 24 h 轮询）未确认、未改；原生 `start_background_check` 仍无调用者。
## 2026-09-24 · Windows 托盘速率：无 Core 时不再每秒重连并写 INFO 日志

- **归属/来源**：G2 客户端诊断可用性（App 日志保留）；Windows App `core/tray/speed_task.rs`、
  `crates/tono-plugin-core/src/mihomo.rs`。内部审查 H18-O-F2，Issue #547。基线 origin/main 8dc79a5b →
  分支 `fix/win-tray-speed-idle-20260924`，PR #548；提交时未合 main。与 #518（同文件，仅改 tooltip 投影）
  用 `git merge-tree` 试合无冲突。
- **缺陷修复**：托盘速率任务默认开启，启动即运行，不看有没有 Core：未连接时插件上下文是产品从不提供的命名管道，
  断开后仍指向已退役的 HTTP 控制器，每次连接失败后固定睡 1 s 再试；插件在连接前写一行
  `log::info!("connecting to websocket…")`，默认构建不过滤。空闲时约每秒一行 INFO，按大小轮转的 App 日志几小时内
  就被冲掉有用记录。现在任务只在本 App 已发布自有控制器（会话 Connected 且持有控制器 secret）时连接，空闲时每秒只读
  一次产品状态，不连 socket、不写日志；连上后行为不变（失败 1 s 重试、Stale/Closed 重连）。每次 WebSocket 连接的
  那行日志降为 debug。
- **新增/优化**：无。
- **工程与测试**：`speed_task.rs` 新增一个 `#[tokio::test(start_paused = true)]`
  `speed_stream_waits_for_a_published_controller_before_connecting`：用真实 `TonoState::for_test()` 驱动新的
  「等控制器再连」步骤，无控制器 10 min 内连接次数必须为 0，发布控制器后一个轮询周期内开始连接。先推只含测试的提交
  （该步骤尚不存在，编译失败即红）。
- **验证**：本机为编辑机，未运行原生 cargo；Tauri crate `cargo test` 委托本 PR 的 GitHub-hosted `windows-2025`
  CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：已连接但 Core 崩溃、FSM 尚未离开 Connected 的窗口内仍按 1 s 重试（日志已是 debug）；实际每行字节数与
  修复前可保留的日志小时数仍是估算，未实测。
## 2026-09-24 · Windows Activity：墙钟回拨不再让连接列表冻结数小时

- **归属/来源**：G2 界面真实性（Activity 连接/流量数据）；Windows App 前端 `hooks/use-connection-data.ts`。
  内部审查 H18-C-F1，Issue #553。基线 origin/main 8dc79a5b → 分支 `fix/win-activity-monotonic-throttle-20260924`，
  PR #554；提交时未合 main。
- **缺陷修复**：Activity 连接帧 500 ms 节流用墙钟计算间隔。系统时间回拨（手动改时间或时间同步纠正快钟）后
  `Date.now() - lastFlushAt` 为负，下一帧排出约等于回拨量的 `setTimeout`（回拨 2 h 即约 2 h），其后的帧只覆盖待发帧；
  `connectionFeedLive` 仍为 true，页面的等待提示与自动刷新都不触发，刷新也不重置 `lastFlushAt`。现在节流间隔改用
  单调时钟 `performance.now()`，最多等 500 ms；事件自身的时间戳不变。
- **新增/优化**：无。
- **工程与测试**：`use-connection-data.test.tsx` 新增一个 vitest `it`：发布帧 A，系统时间回拨 2 h，再发帧 B，推进 500 ms
  后快照必须是 B。旧代码仍停在 A（本机实跑红）。首个测试提交的帧字面量类型未收窄，补了一个仅测试的类型修正提交。
- **验证**：本机 `vitest run src/hooks/use-connection-data.test.tsx` 修复前 1 failed（expected 1 to be 2）、修复后
  2 passed；`tsc --noEmit` 与两文件 eslint 通过。完整 `pnpm test` 由本 PR 的 GitHub-hosted CI 执行，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：同模块的连接超时门 `connectStartedAt` 仍用墙钟，但有单调的 `setTimeout` 看门狗兜底，未改；
  未在实机上改系统时间验证。
## 2026-09-24 · Windows 本地流量审计：轮转建新文件失败后可自行恢复

- **归属/来源**：G2 诊断证据（本地审计日志）；Windows App `tono/audit.rs` `RotatingWriter`。内部审查 H18-C-F2，
  Issue #556。基线 origin/main 8dc79a5b → 分支 `fix/win-audit-rotate-recover-20260924`，PR #558；提交时未合 main。
- **缺陷修复**：`traffic-audit.jsonl` 到 10 MiB 轮转时先删旧备份、把当前文件改名为备份，再新建当前文件。改名成功而新建
  失败（磁盘满）后，当前路径不存在，句柄仍指向已改名的备份，`written` 未复位。空间恢复后下一条超限记录再次轮转：
  删掉句柄正在写的备份，再改名一个不存在的路径，每次都失败；写入循环吞掉错误、任务仍存活不会重建，直到 App 重启都
  不再有当前审计文件，还可能丢掉保留的上一代。现在轮转时若当前路径不存在，只重建当前文件并把计数归零，不再删备份、
  不再改名。
- **新增/优化**：无。
- **工程与测试**：`audit.rs` 新增一个 `#[test]` `rotation_recreates_the_current_file_after_a_failed_reopen`：写到接近
  上限后把当前文件改名为备份（句柄仍开着，复现失败轮转后的状态），再写一条超限记录，当前文件必须重新出现且只含这条
  记录，备份仍在。旧代码在该次写入时返回 NotFound。
- **验证**：本机为编辑机，未运行原生 cargo；Tauri crate `cargo test` 委托本 PR 的 GitHub-hosted `windows-2025` CI，
  结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：失败状态下仍放得进剩余额度的短记录会继续写入旧句柄（即备份文件），直到下一条超限记录触发重建；
  日志目录整个被删除时轮转不重建目录，未改；未在实机上复现 NTFS 磁盘满。

## 2026-09-24 · macOS 账户 suspended 时停止网络日志上传

- **归属/来源**：G2 客户端账户状态（macOS `AccountSession+Auth.swift`）。内部审查 H17-O-F7（另一审查方按
  收窄条件确认）；Issue #536。叠在 #535（`fix/macos-suspended-stops-core-20260924`，其又叠在 #516）之上；本条分支
  `fix/macos-suspended-stops-log-upload-20260924`；提交时未合 main。
- **缺陷修复**：上传器已在运行（上传开关默认开、账户 ready）且有待发日志时，账户被控制面拒绝进入
  `.suspended`，`enterEntitlementBlock` 不停上传器；上传器运行中只按日志 ownership 判断是否继续，
  不看账户状态。于是每轮上传都 401 → `auth/refresh` 401 → 退避重试（上限 960 s，无次数上限），
  直到睡眠、退出或登出。现在进入 `.suspended` 时通过既有的 `updateDiagnosticsLogUploading()`
  停止上传器；账户重新可用时运行时启动（`startCatalogSync`）照旧重新启动它。
- **新增/优化**：无。
- **工程与测试**：`AccountSessionRequestTests` 新增一个 XCTest
  `testSuspensionStopsTheRunningNetworkLogUploader`：上传器已启动，账户重读与续期都回 401；断言状态为
  `.suspended` 且上传循环已停止。`DiagnosticsLogUploader` 增加只读 `isRunning` 供断言，无行为变化。
  只含测试（及该只读属性）的提交 c03c8c69（叠在 #535 上，本修复未加）在 GitHub-hosted macOS CI
  run 35977822472 上实际跑红：build 作业只有这一个测试失败（`AccountSessionRequestTests` 51 项、
  1 处断言失败：suspended 后上传循环仍在运行）。
- **验证**：本机是编辑机，未运行 xcodebuild/swift。TonoTests 委托 PR 的 GitHub-hosted `macos-26`
  CI，结果以 PR 页的准确 head SHA 为准。未实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：周期遥测任务句柄在 suspended 时未清空（#516 已记录的既有行为），不在本条范围。
- **后续（2026-09-24，重新叠在 #535 上）**：合入 #535 的 1ad72605（其已对齐 #516 fc33c9eb 的
  `protectionReleaseConsumer` 设计）。唯一冲突在 `AccountSessionRequestTests.swift`：本条的
  `testSuspensionStopsTheRunningNetworkLogUploader` 与 #535 的
  `testCheckAgainDoesNotResumeIntoAHelperRepairTheUserDidNotAskFor` 两个都保留，本条产品代码无改动。
  本机未构建，以 PR 的 `macos-26` CI 为准。

## 2026-09-24 · macOS 账户进入 suspended 时停止 Core 并撤下缓存出口

- **归属/来源**：G2 客户端账户状态与连接准入（macOS `AccountSession+Auth.swift`）。内部审查 H17-C-F3，
  另一审查方 H17-G-F3 第 3 步为同一缺口；PR 双厂商审查 535-O-F2..F4、535-C-F1..F2。Issue #526，
  PR #535。基线 origin/main 059a2ea2 → 分支 `fix/macos-suspended-stops-core-20260924`，叠在 #516
  （合入其 cd94a22f，复用 helper 确认的恢复意图规则）；提交时未合 main。
- **缺陷修复**：套餐到期、流量用尽、账户停用或设备被吊销后，账户重读收到 401（请求与续期都拒绝），
  账户进入 `.suspended`。原来 `enterEntitlementBlock` 只改状态：正在运行的 Core 继续用本设备的
  出口身份走流量；缓存目录（内存与磁盘）保留；连接层只按缓存判断就绪，唤醒恢复、保护重连循环、
  网络变化和自动连接都不看账户状态，睡眠唤醒后可用同一凭据再起 Core，直到出口下次刷新名单。
  现在进入 `.suspended` 时：
  - 在第一个挂起点之前撤下缓存目录（与登出同一道 ownership 屏障：内存与磁盘都清，期间任何目录
    都装不上），连接层不再有可用的出口；
  - 停止正在运行的 Core，PF 保持武装：Mac 停在 Protected Offline，suspended 页面在 kill switch
    武装时已提供"恢复网络"。任何 suspended 路径都不释放 PF。
  - 启动与登录时直接进入 suspended 的三处（服务端目前不发 `suspended: true`）也走同一入口。
  - 控制面重新接受账户时（`leaveEntitlementBlock`，作为账户生命周期工作运行，登出或恢复网络会先
    取消并排空它）：先取消挂起前仍在途的目录请求（否则会加入它并拿到被丢弃的结果，进入 `.error`），
    重新绑定 ownership 并拉取新目录；拉取失败则保持 suspended 与撤销屏障，"再次检查"可重试。
    是否自动重连先按应用内的 Protected Offline 状态，再问 helper：只有 helper 确认保护已解除
    （例如外部紧急解除）才放弃重连意图，helper 不可达或拒绝时保持（与 #516 同一规则）。之后从新
    目录重启运行时并回到 ready。
- **新增/优化**：无。
- **工程与测试**：`AccountSessionRequestTests` 新增一个 XCTest
  `testRefusedSessionStopsTheCoreAndWithdrawsItsExitsWithProtectionKept`：账户重读与续期都回 401；
  断言状态为 `.suspended`、已安装目录被撤下、该账户的目录不再被接受、Core 停止一次、disarm
  consumer 未被调用。审查后同一测试延伸到重新接受：挂起前有一个在途目录请求，续期与重读都成功、
  应用内仍显示 Protected Offline 而 helper 确认已解除；断言重新接受另发新的目录请求、只安装新目录、
  回到 `.ready`、恢复时不请求自动重连。测试 fixture 增加可注入的 `descriptorConsumer` 与
  `protectionBlockedConsumer`。延伸部分的只含测试提交 7615d579 在修复前的 head 上跑红（run 35984764434：
  只有这一个测试失败，重读成功后等待请求约 5 s 超时，按流程即没有发出新的目录请求；自动重连一项
  因此未执行到）。最初只含测试的提交 febea58a
  （产品代码未改）在 GitHub-hosted macOS CI run 35976604824 上实际跑红：build 作业只有这一个测试
  失败（`AccountSessionRequestTests` 50 项、3 处断言失败：目录未撤下、目录仍被接受、Core 未停止；
  "不释放 PF"一项在旧代码上本来成立）。
- **验证**：本机是编辑机，未运行 xcodebuild/swift。TonoTests 委托 PR 的 GitHub-hosted `macos-26`
  CI，结果以 PR 页的准确 head SHA 为准。未实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：
  - 出口对已建立连接的处理未实机验证；本修复只保证客户端在有界时间内停用凭据。
  - 保护重连循环在 suspended 期间可能继续按退避计时，但没有目录可用，不发起连接。
  - 恢复路径（`leaveEntitlementBlock`）只在控制面重新接受同一会话时可达；被吊销的会话仍需
    登出再登录。
  - 网络日志上传在 suspended 下继续尝试 refresh（H17-O-F7），单独修。
- **后续（2026-09-24，PR 复审 535R-C-F1..F3，Codex 发现、Opus 核实）**：
  - F1：重新接受时不再丢弃 helper 的回答。helper 拒绝（`.rejected`），或自动重连因需用户操作
    而暂停时，运行时不带恢复意图启动，不自动重连，"再次检查"不会引出 helper 修复的管理员授权；
    PF 保持原样。新增 XCTest `testCheckAgainDoesNotResumeIntoAHelperRepairTheUserDidNotAskFor`
    （helper 回 `.rejected`；断言回到 `.ready`、恢复参数为 `[false]`）。旧代码上按流程应为
    `[true]`，这是推断，未跑红。
  - F2：恢复网络与登出在排队清理前先取消在途的目录请求（独立 Task，取消账户工作传不到它），
    否则清理要等它的网络超时。槽位保留，由清理排空；恢复网络的清理现在也排空并清掉该槽位。
  - F3：`enterEntitlementBlock` 每次都递增拒绝计数（已是 `.suspended` 也递增），重新接受把它纳入
    当前性检查；目录同步循环调用 `refreshAccount` 前重新确认 `.ready`。
  - 剩余：暂停标志一支、F2、F3 没有单独测试。最后一次当前性检查之后、运行时启动期间到达的
    拒绝不经计数拦截（此时目录已撤下），其结果未逐步验证。本机未运行 xcodebuild/swift，
    交 PR 的 GitHub-hosted `macos-26` CI。
- **后续（2026-09-24，与 #516 当前设计对齐）**：合入 #516 的 fc33c9eb（N1 修复把
  `killSwitchStatusObservation` 换为 `protectionReleaseConsumer`，helper 确认释放时经 AppState 清掉
  `isArmed`）。两边改写的 `retireResumeIntentIfProtectionReleased` 合为一个：resume 意图或 `isArmed`
  任一为真时询问，返回 helper 的完整回答（`KillSwitchService.StatusObservation`：已释放 / 仍需保护 /
  拒绝 / 不可达），两个意图都没有时返回 nil。`protectionReleaseConsumer` 与
  `AppState.acceptConfirmedProtectionReleaseBeforeSignIn` 改为返回该回答而非 Bool：只有在当前保护代际内
  被 AppState 接受的释放才以"已释放"返回，并清掉 armed 与 resume 意图；被保护操作赶超、或因操作在途
  而未询问的回答报 `.unavailable`，什么都不清。登录照 #516 使用；"再次检查"用同一回答做 F1，其确认
  释放现在也清 `isArmed`（原先只放弃 resume 意图）。#535 的两个测试改用新钩子
  （`protectionReleaseConsumer` 直接返回 `.confirmed(requiresProtectionRecovery: false)` / `.rejected`），
  #516 的测试不变，未新增测试。本机未构建，以 PR 的 `macos-26` CI 为准。

## 2026-09-24 · macOS 会话被拒（401）不再释放 PF/DNS 保护

- **归属/来源**：G2 客户端账户状态与保护边界；macOS `Services/Account/AccountSession+*.swift`、
  `Services/AccountSession.swift`、`Views/WelcomeIntroView.swift`、`TonoApp.swift`。
  内部审查 H17-O-F1、H17-O-F2（macOS 部分），与另一审查方 H17-G-F3 第 2、4 步为同一路径；
  PR 双厂商审查 516-O-F1..F4、516-C-F1..F3。Issue #510，PR #516。基线 main 8dc79a5b →
  分支 `fix/macos-auth-401-keeps-protection-20260924`；提交时未合 main。
- **缺陷修复**：套餐到期、流量用尽、账户停用、设备吊销（含别处登录挤掉）时，Worker 对鉴权
  路由和 `auth/refresh` 一律回 401。macOS 有三处把这种 401 当成账户丢失：启动 restore
  （`me` 与续期都 401）、周期遥测窗口、分应用路由研究上传。三处都走
  `fail(signsOutOnUnauthorized: true)`，先 `releaseNetworkProtection()`
  （`disconnectAndWait(releaseKillSwitch: true)`）再登出。结果是 PF 与受保护 DNS 被放开，
  界面只剩登录页，不说原因。开了遥测的 Mac 睡眠期间跨过到期后，唤醒 45 s 的遥测先于 300 s
  的账户重读，每次都走这条路。现在任何 401 都不释放保护：
  - 启动 restore 仍登出，但 PF/DNS 保持原样，并保留崩溃恢复的 resume 意图。kill switch 仍
    武装时，窗口不再显示 Welcome 引导（从未看过引导的老用户原先会落到引导页，页上既不说明
    阻断也没有恢复入口；516-O-F1），而是落到登录页已有的阻断说明和"恢复网络"入口。
    这与无存储会话的启动并不完全相同：那条路径在无需保持保护时会做一次清理性解除，并自己
    加载登录方式。
  - 后台上传的最终 401（请求和客户端自己的续期都被拒）直接对当前账户调用
    `enterEntitlementBlock`，与 `refreshAccount` 收到 401 时相同，进入 `.suspended`。保护不变，
    显示原因页。首版改走 `refreshAccount`，要再发一次续期；那次若遇断网或 5xx 会被静默忽略，
    账户留在 `.ready`（516-C-F1）。
  - 登录时若带着保留下来的 resume 意图，先读 helper 的 kill switch 状态。helper 确认已释放
    （如 root 紧急解除）就放弃该意图，不再自动重连重新 arm PF；helper 不可达或拒绝不算释放，
    意图保留（516-O-F3 / 516-C-F2）。
  - 在登录页加载登录方式期间点"恢复网络"，释放会作废这次读取，登录页原先停在加载中且无法
    重试。现在释放后若仍未取得登录方式就重新加载，被作废的旧读取也不再挡住新的读取
    （516-O-F2）。
- **新增/优化**：无。
- **工程与测试**：
  - `AccountSessionRequestTests` 新增四个 XCTest：
    - `testBackgroundUploadRefusedSessionSuspendsAndKeepsProtection`：遥测与 refresh 都回
      401，其后任何请求回 503；断言 disarm consumer 未被调用、状态为 `.suspended`、账户仍在。
    - `testLaunchRefusedSessionSignsOutAndKeepsProtection`：驱动启动 restore 的 catch；断言
      disarm consumer 未被调用、状态为 `.signedOut`、本地 refresh token 已删、resume 意图保留。
    - `testSignInKeepsAResumeIntentUnlessTheHelperConfirmsRelease`：通过可替换的
      `killSwitchStatusObservation` 注入 helper 状态；`.unavailable` 保留意图，
      `.confirmed(false)` 放弃意图。直接调用登录前的检查函数，不走完整登录。
    - `testProtectionReleaseReloadsTheSignInMethodsItRetired`：登录方式读取进行中调用
      `restoreDirectInternet`；断言重新加载并发布了登录方式，加载标志已清。
  - `WelcomeLaunchGateTests.testIntroWhenUnseenAndSignedOut` 增加一条断言：kill switch 仍
    武装时不显示引导。
  - 红灯（均为 GitHub-hosted macOS CI，只含测试的提交，产品代码未改）：
    - 首轮两个测试：提交 a1154ced（基于 bb2ed4e4；变基后在本 PR 中为 43a101b9，文件逐字节
      相同），run 35973008589。build 作业只有这两个测试失败（`AccountSessionRequestTests`
      51 项、6 处断言失败）。后台用例：disarm 被调用，状态为 `signedOut`；启动用例：disarm
      被调用，resume 意图被清。
    - 后台用例加 503 之后：提交 4b4fad0b（在首版修复上；变基后为 6d5fcc5a，代码相同），
      run 35977233730。只有该用例失败，状态为 `ready` 而不是 `suspended`。
    - `testProtectionReleaseReloadsTheSignInMethodsItRetired`：提交 8f0ad561（在上一条之上，
      只加该测试），run 35978342364。该用例等不到重新加载的请求，5 s 后失败；同一 run 中
      后台用例照旧失败（该提交不含其修复）。
    - resume 意图测试和引导断言依赖新增的函数和参数，在旧代码上无法编译，未跑红。
- **验证**：本机是编辑机，未运行 xcodebuild/swift。TonoTests 委托本 PR 的 GitHub-hosted
  `macos-26` CI，结果以 PR 页的准确 head SHA 为准。未实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：
  - Worker 仍对所有不合格情形回 401（加 entitlement 码是另一单元）。因此启动时的 401 仍会
    登出，也不显示原因。
  - `.suspended` 不停止正在运行的 Core，不作废缓存的出口凭据（H17-C-F3，#535）。
  - 网络日志上传在 suspended 下继续尝试 refresh（H17-O-F7）。
  - 进入 suspended 时，周期遥测任务的句柄没有清空，这是 `refreshAccount` 路径的既有行为。
    若暂停超过 20 分钟，解除后周期遥测要等下次睡眠唤醒或重启 App 才恢复。
  - Windows 启动时的 401 仍会释放 WFP（`restore.rs:318-325`），见 H17-AUTH-WIN（#515）。
  - 启动 401 保留 PF 后，菜单栏仍显示 Standby（516-C-F3 / 516-O-F1 菜单部分）。这依赖另一个
    PR 修复启动时 AppState 的保护真值（H16-O-F5 / H16-C-F1），本条不改。
  - 引导页判断读 `KillSwitchService.isArmed`（非 observable）；在登录页点"恢复网络"后若再
    出现 `.error`，从未看过引导的用户会重新看到引导页（既有行为）。
- **后续（2026-09-24，PR 审查 N1：Codex 发现，Opus 复核）**：登录前 helper 确认已释放时，原先只放弃
  resume 意图，`KillSwitchService.isArmed` 仍为 true（root 紧急解除改不了该用户的 defaults，启动 401
  路径也不设 `isProtectionBlocked`，激活对账不运行），下次睡眠重新 arm PF，唤醒后重连。现在由 AppState
  新增的 `acceptConfirmedProtectionReleaseBeforeSignIn` 读 helper：未连接/连接中/断开中且保护代际未变时，
  确认释放才走既有 `acceptConfirmedExternalProtectionRelease`，一并清掉 armed 意图；不可达、拒绝或仍需
  保护时两个意图都保留。`killSwitchStatusObservation` 换为 `protectionReleaseConsumer`（TonoApp 接到
  AppState）；上文测试改名 `testSignInKeepsTheArmedAndResumeIntentsUnlessTheHelperConfirmsRelease`，经
  真实 AppState 与 `refreshKillSwitchStatus` 替身同时断言两个意图。旧代码缺新函数无法编译，未跑红；
  本机未构建，以 PR 的 `macos-26` CI 为准。
- **后续（2026-09-24，N1 复核残留：Codex 发现）**：原生更新以 Protected Offline 恢复时 `isArmed` 为 true
  但 resume 意图为 false；之后启动 401、root 紧急解除、不重启直接登录，检查因只看 resume 意图而跳过，
  下次睡眠仍按遗留的 `isArmed` 重新 arm。登录前检查现在在 resume 意图或 `isArmed` 任一为真时都运行，
  仍只有 helper 确认释放才清除。同一测试追加"只有 armed 意图"一段；在 7b95aed4 上该段断言会失败
  （检查被跳过，`isArmed` 保持 true），系推理，未跑红；本机未构建，以 PR 的 `macos-26` CI 为准。

## 2026-09-24 · H16/H17 审查轮与仓库清理记录

- **归属/来源**：G1–G3 审查与修复的可追溯性（工程流程与记录，非产品行为）；审查基线 main
  [bb2ed4e4](https://github.com/raydocs/tono/commit/bb2ed4e4)，本分支 `docs/records-20260924` 基于 origin/main
  [059a2ea2](https://github.com/raydocs/tono/commit/059a2ea2)。
- **缺陷修复**：无。
- **新增/优化**：[FINDINGS_LEDGER](FINDINGS_LEDGER.md) 登记 H16（界面真实性）与 H17（账户生命周期）的 15 条发现，
  均为 `open`；另 5 条由各自修复 PR 登记（#513、#515、#516、#518、#520）。H7-F7 剩余限制补上到期/超额不标记轮换；
  更新 ID 规则（H1–H19、席位后缀）与状态快照。新增
  [2026-09-24 审查轮记录](reports/REVIEW_ROUNDS_2026-09-24.md)：jev-route 决定、席位、交叉厂商核实矩阵
  （0 驳回、1 降级）、I1–I6 / A1–A6 覆盖摘要、未覆盖范围、修复进度，以及仓库清理（已删远端分支及其 tip SHA 可据此恢复）。
- **工程与测试**：无代码、配置或测试改动。
- **验证**：文档变更，未运行产品测试；`git diff --check` 通过；总账表格行列数用 awk 校验与表头一致；
  开放 PR 编号按 2026-09-24 `gh pr list` 实查。
- **候选/发布**：无新包，仅文档。
- **剩余限制**：H16/H17 条目全部是源码推导或阅读确认，回归草案均未运行；需实机的部分列在审查轮记录第 3 节。

## 2026-09-24 · macOS 账户 gate 与菜单栏读同一保护状态

- **归属/来源**：G2 客户端保护状态展示（macOS）。内部审查 H16-C-F2，
  Issue [#533](https://github.com/raydocs/tono/issues/533)。叠在 #537（H16-O-F5）之上 → 分支
  `fix/macos-gate-release-20260924`；须在 #537 之后合入；提交时未合 main。
- **缺陷修复**：登录页与账户停用页的「Kill Switch 仍在拦截」提示只读不可观察的
  `KillSwitchService.isArmed`，外加只有 gate 自己按钮才会置位的本地标志。用户从菜单栏
  「恢复正常网络」成功释放后，账户状态按设计保持不变，已显示的 gate 没有任何被观察的输入变化，
  继续声称仍在拦截。改后：两处 gate 共用 `GateProtectionSection`，由 `AppState.gateProtectionNotice`
  派生（与菜单栏同源的可观察状态）：`isProtectionBlocked` 或已连接 → 原「仍在拦截」文案；
  #537 的 `isProtectionUnconfirmed` 或仅有本地意图 → 新文案「无法确认上一次会话的保护状态，
  直接联网可能仍被拦截」；两者皆无 → 隐藏。任何地方完成的释放都会写 `isProtectionBlocked`，
  使已挂载的 gate 重新求值；去掉只对本按钮有效的本地标志。「恢复正常网络」按钮的显示条件与
  菜单栏对非 ready 账户的恢复入口一致，逃生出口不会消失。
- **新增/优化**：无。释放流程、账户状态、PF/helper 均未改。
- **工程与测试**：先以不改行为的提交把两处重复的 gate 区块收成一个共享视图并经环境拿到
  AppState；新增一个 XCTest `AccountGateProtectionTests.testMenuBarRestoreRetiresTheMountedGateNotice`
  （真实 AccountSession → AppState 释放路径，仅替换 helper/系统 I/O；用 `withObservationTracking`
  断言菜单栏释放会使 gate 读到的状态失效）。
- **验证**：本机未编译；TonoTests 在本分支 GitHub-hosted `macos-26` CI 运行，以 PR 检查中
  对应 head SHA 为准。行为不变提交的 CI 失败结果见 PR 正文。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机验证 SwiftUI 实际重绘；测试证明的是 gate 读取的状态会被释放通知失效。
  已连接但账户停用时仍沿用「上一次会话」文案（原有措辞）。
- **后续（2026-09-24，PR 复审 538-O-F1）**：测试用默认 API 客户端；#516 合入后，
  `restoreDirectInternet` 在未取得登录方式时会重新加载，测试就会向生产 `/auth/methods` 发请求。
  现在测试在释放前先填入登录方式，释放不再发起任何网络请求。未新增测试。同时合入 #537 的复审
  续修（a984c553）。本机未运行 xcodebuild/swift，交 PR 的 GitHub-hosted `macos-26` CI。

## 2026-09-24 · macOS 启动把 helper 确认的屏障发布到界面

- **归属/来源**：G2 客户端保护状态展示（macOS）。内部审查 H16-O-F5（= H16-C-F1），
  Issue [#529](https://github.com/raydocs/tono/issues/529)。基线 origin/main 059a2ea2 → 分支
  `fix/macos-launch-protection-20260924`；提交时未合 main。
- **缺陷修复**：启动恢复（`RuntimeCleanup`）只把 helper 的屏障答复写进本地意图
  `KillSwitchService.isArmed`，`AppState.isProtectionBlocked` 仍为 false：更新后须以
  Protected Offline 恢复、或带着 PF 重启进入停用/错误/登出时，菜单栏、仪表盘徽标和连接按钮
  都显示 Standby，而 PF 阻断全部流量；激活时 reconcile 和 Retry 都要求 `isProtectionBlocked`，
  无法自行收敛。改后：helper 认证答复（或 root 的更新回执）确认屏障 → 发布 Protected Offline
  （与会话内失败同一状态，横幅、Retry、Restore 均可用）；helper 未答复/拒绝而本地意图为
  armed → 新的 `isProtectionUnconfirmed`，菜单栏显示「Protection unknown / 保护状态未知」，
  既不显示 Standby，也不把本地意图当作屏障证明；启动第一步在 helper 答复前即按本地意图发布
  unconfirmed，因此之后抛错的启动路径也不会显示 Standby。任何后续保护状态写入
  （连接开始、拆除完成、释放、reconcile）都会清除 unconfirmed。
  评审续修（Opus + Codex 双方发现）：再次启动恢复（gate 上 Retry）得到 helper 确认「未持有」时，
  按激活 reconcile 同一路径撤销此前的 Protected Offline，不再残留 blocked；unconfirmed 在 helper
  之后给出认证答复时收敛——启动时 reassert 成功（arm 须读到 armed/wanted/live）发布 held，
  App 激活时的 reconcile 也对 unconfirmed 查询一次（不弹授权、不动重连状态）；仪表盘徽标、
  保护卡片与连接按钮显示「保护状态未知」，按钮与菜单栏在 ready 时也提供恢复正常网络。
- **新增/优化**：无。PF/helper、账户流程、保护策略均未改。
- **工程与测试**：把启动的 helper 答复折叠抽成 `RuntimeCleanup.adoptLaunchObservation`
  （先以不改行为的提交抽出）；新增一个 XCTest
  `LaunchProtectionPresentationTests.testLaunchShowsTheHelperAnswerInsteadOfStandby`（评审续修后
  同一测试另断言：同一 AppState 先 held 后 released 不残留 blocked；unconfirmed 在 helper 之后答复时收敛）。
- **验证**：本机未编译（MacBook 为编辑机）；TonoTests 在本 PR 的 GitHub-hosted `macos-26` CI 运行，
  结果以 PR 检查中对应 head SHA 为准。测试仅抽取提交（产品行为未改）的 CI 运行结果见 PR 正文。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机验证。helper 一直不答复时 unconfirmed 保持（如实为未知）。启动确认屏障后
  界面进入与会话内相同的 Protected Offline，点按连接按钮即恢复正常网络、激活 reconcile 会运行，
  这是行为变化而非纯展示。账户 gate 的文案与菜单栏一致由后续 H16-C-F2 修复（#538）负责。
- **后续（2026-09-24，PR 复审 537R-C-F1，Codex 发现、Opus 核实）**：启动 reassert 在本地意图已被
  撤销时（`guard isArmed`）正常返回却什么都没 arm，启动仍发布 held，界面显示 Protected Offline
  而 PF 实际未持有。现在 reassert 返回是否真的 arm，只有 arm 了才发布 held。启动裁决与激活时的
  helper 答复共用一个序号：激活读取期间若有更新的启动裁决发布，旧答复丢弃，不再改写本地意图。
  新增 XCTest `testAnActivationAnswerOlderThanTheLatestLaunchVerdictIsDropped`（激活读取期间
  启动再发布 unconfirmed，随后到达的旧 `.confirmed(false)` 不得清掉意图）。旧代码上按流程
  两处断言失败，这是推断，未跑红。reassert 返回值一支需要真实 helper，无单独测试。本机未运行
  xcodebuild/swift，交 PR 的 GitHub-hosted `macos-26` CI。

## 2026-09-23 · 发现总账与审查流程记录

- **归属/来源**：G1–G3 审查与修复的可追溯性（工程流程与记录，非产品行为）；基线 origin/main
  [bb2ed4e4](https://github.com/raydocs/tono/commit/bb2ed4e4)（2026-09-24 rebase），分支 `docs/findings-ledger-20260923`。
- **缺陷修复**：无。
- **新增/优化**：新增 [FINDINGS_LEDGER](FINDINGS_LEDGER.md) 作为唯一已知问题总账（首轮 W/M/S、
  审查轮 R1–R4、隐秘搜寻 H1–H15、内部复核轮 X1–X3、撤回项与已交付设计），取代每轮手工粘贴的 known-findings；
  新增 [审查轮记录](reports/REVIEW_ROUNDS_2026-09-23.md)（方法、覆盖/未覆盖、可复用约束）。
  AGENTS.md 要求审查或修 bug 前先读总账、交付时同 PR 更新条目。
- **工程与测试**：无代码、配置或测试改动。
- **验证**：文档变更，未运行产品测试；条目中的 issue/PR 编号与状态按 2026-09-24 GitHub 实查
  （已合入的写 main 合并提交 SHA）；表格列数用脚本校验一致。
- **候选/发布**：无新包，仅文档。
- **剩余限制**：总账状态是写入时快照；并行进行中的合并与修复 PR 需由各自 PR 同步更新对应行。
  `fixed` 只表示源码进 main，不表示实机验收。
## 2026-09-23 · exit-agent 在控制面不可达时从本地副本恢复 roster 并继续计量

- **归属/来源**：ops 出口计量与吊销执行；`services/exit-agent`。内部审查 H13-F5，Issue #463。
  基线 main bb2ed4e4 → 分支 `fix/exit-agent-roster-cache-20260923`；提交时未合 main。
- **缺陷修复**：agent 只记录已安装标签，不保存凭据。控制面不可达（网络错误或 5xx）期间
  Xray 一旦重启，经管理 API 加入的客户端全部丢失，节点上所有账户连不上，直到控制面恢复。
  这期间计数器也不读，恢复后第一轮只按新进程读数计，重启前的增长不计费。现在每次拉到并
  核对 nodeId 后，先把 roster 原子保存为 `state.json.roster`（0600、服务用户所有），再执行。
  拉取失败且属于不可达时，若副本不超过 24 h，就按副本重装客户端；无论副本能否使用，都继续
  把计数器折叠进持久 totals。本轮不 ACK、以非零退出，恢复后第一轮正常上报这段增长。副本
  超龄、缺失、权限不对或损坏时不恢复任何客户端，并拒绝说明原因。控制面的其他任何回答都会先
  删除副本，包括 401/403、roster 校验失败和 nodeId 不符。副本写入失败时删除旧副本；删除也
  失败时本轮在执行后拒绝，不 ACK。
  审查修正（R4）：删副本移进 `fetch_roster_or_discard_cache`，在 `run_once` 的任何 handler 之前完成；
  并预留 `node_disabled_answer`：响应（或 #375 的 `NodeDisabled` 的 cause）是 403 且 body 为
  `EXIT_NODE_DISABLED` 时先删副本，删除失败只告警、不替换原错误，撤除照常执行。这样 #375 的
  `except NodeDisabled` 放在 `except Exception` 之前也不会留下副本（否则下一次网络错误会把停用
  节点的全部客户端装回）。README 修正写反的论断：副本在执行前保存，是"不落后于"而不是"不新于"
  已执行的 roster；并写明副本是明文 VLESS 凭据（0600，应排除出快照/备份）和 24 h 回填窗口。
- **新增/优化**：无。
- **工程与测试**：`test_reconcile_and_report.py` 新增一个测试
  `test_an_outage_restores_the_last_verified_roster_and_keeps_metering`，连续跑 7 轮：成功；
  不可达；不可达加 Xray 重启（客户端重装，重启前 4,000 字节保留）；25 h 后不可达（不恢复）；
  成功（上报 5,300）；401（副本删除）；再次不可达（不恢复）。旧代码第一轮后不存在副本，
  测试失败。
  审查修正后第 6 轮由 401 改为经真实 `fetch_roster`（patch `build_opener`）得到的
  403 `EXIT_NODE_DISABLED`，断言副本已删。单独在本分支上它和修正前一样通过（任何 403 都删）；
  它守护的是与 #375 的合并：临时 worktree 里把本分支与 #375 合并、`except NodeDisabled` 放前面
  且不加 discard（朴素解法），修正前的 #464 在该断言失败（`True is not false`），修正后 84 项通过。
- **验证**：MacBook worktree：新测试在旧代码失败、修复后通过；exit-agent 全部 83 个测试
  通过（`python3 test_reconcile_and_report.py`；审查修正后复跑 83 项通过）。未连接任何真实节点或 hub，未部署。CI 结果
  以 PR 页为准。
- **候选/发布**：无新包，仅源码（exit-agent）。
- **剩余限制**：恢复要等到 Xray 重启后的下一次 timer 运行，本 PR 未给 `tono-xray` 加
  `ExecStartPost`。控制面不可达期间被吊销的账户，在副本 24 h 期限内仍会被重装，与 Xray 不
  重启时内存中保留它们的行为一致。副本是明文客户端凭据（0600）。停用节点删副本失败时副本
  仍在（只告警）。hy2 允许列表是文件，重启后仍在，不可达时不改动。与在审
  #375、#384、#389 修改同一 `run_once`，合并顺序与解决方式见 PR 正文。
## 2026-09-23 · ops hub 执行前确认租约，等待中的 job 一并续租

- **归属/来源**：ops 控制台节点作业（hub 执行器）；`ops-panel/jobs.py`。内部审查 H13-F6，
  Issue #465。基线 main bb2ed4e4 → 分支 `fix/ops-jobs-lease-20260923`；提交时未合 main。
- **缺陷修复**：hub 每次最多租 5 个 job，串行执行，只给正在执行的 job 续租，开始前也不
  确认租约。排在长任务后面的 `xray_restart`（租约 60 s）过期后会被 Worker cron 放回队列，
  hub 仍会执行它，下一轮又租到再执行一次，节点被连续重启两次。现在每个 job 开始前先发一次
  心跳确认租约，409 或不可达就跳过，不执行、不上报；不可达时本轮以非零退出。执行期间的
  心跳同时覆盖尚未开始的 job。
- **新增/优化**：无。
- **工程与测试**：`ops-panel/tests/test_jobs.py` 新增
  `test_a_leased_job_whose_lease_was_lost_before_its_turn_never_runs`：假心跳对第二个
  `xray_restart` 回 409，断言 SSH 只到第一个节点、只上报第一个结果。旧代码 SSH 到了两个
  节点（`['A', 'B'] != ['A']`）。
- **验证**：MacBook worktree：新测试在旧代码失败，修复后 `python3 -m unittest discover -s
  ops-panel/tests -p 'test_*.py'` 26 个测试通过。scratchpad 模拟脚本 `sim_jobs.py`：旧代码
  对 B 执行了 restart，新代码跳过 j2。未连接 hub 或任何节点，未部署。CI 结果以 PR 页为准。
- **候选/发布**：无新包，仅源码（ops-panel，需要在 hub 上部署后生效）。
- **剩余限制**：Worker 侧租约与 cron 未改。hub 在执行期间与控制面断开时，等待中的 job 仍
  可能过期被重新入队，本轮会在开始前发现并跳过。与在审 #377（重启目标改为
  `tono-xray.service`）不改同一段代码；#377 合并后本修复才防止真实的二次重启。

## 2026-09-23 · Windows 离线 sing-box 草稿接受签名内 revision 键（H3-F5 过渡前置）

- **归属/来源**：G1 签名信任边界的过渡前置；影响 Windows tono-core
  `apps/windows/crates/tono-core/src/sing_box.rs`（`build_synthetic_offline_draft` 的精确键白名单）。
  基线 main bb2ed4e4，分支 `fix/policy-revision-singbox-20260923`；Issue #317；与 #342（`policy.rs`
  闸门）互补、互不依赖；提交时未合 main。
- **缺陷修复**：服务端开始在策略 json 内写入 `revision` 后，该精确键白名单会把整份策略判为
  `UnsupportedPolicy`（fail-closed，但会让离线草稿路径全部失效）。改后接受 `revision` 键，且必须等于
  信封 revision，否则按 `UntrustedSnapshot` 拒绝；其余键与"策略必须为空"的约束不变。
- **新增/优化**：无。
- **工程与测试**：新增回归 `signed_policy_revision_key_is_bound_to_the_envelope`。
- **验证**：红灯：只含测试的提交 96d3b102 在 GitHub-hosted Windows CI core 作业（run 35948789260）
  以断言失败（`sing_box.rs:600`，265 过 1 败），非编译错误；修复后结果见 PR CI。本机仅对该文件运行
  `rustfmt --check`，未运行 cargo。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：该路径是冻结的 M0 离线草稿，不是产品入口；服务端写入 revision 仍由后续 Worker PR
  的默认关闭开关控制。

## 2026-09-23 · Windows 终端诊断：按 Known Folder 找 PowerShell profile，带 BOM 的 profile 不再漏检

- **归属/来源**：G2（失败看得到原因）；Windows App Support 页终端代理诊断
  （`apps/windows/app/src-tauri/src/tono/commands/terminal.rs`）。内部审查 X3-3、X3-4，
  Issue #477、#478。基线 main bb2ed4e4 → 分支 `fix/terminal-diag-20260923`；提交时未合 main。
- **缺陷修复**：
  - X3-3：当前用户 PowerShell profile 只在猜的 `%USERPROFILE%\Documents` 和
    `%OneDrive*%\Documents` 下找。文档目录被移走或重定向时，真正的 `$PROFILE` 读不到，诊断显示
    Ready。现在先用 `SHGetKnownFolderPath(FOLDERID_Documents)` 取实际文档目录，原来猜的位置作为
    补充；取不到时整次检查返回错误（Support 页显示 Check Failed），不再显示 Ready。
  - X3-4：profile/设置文件用 `read_to_string` 读取，UTF-8 BOM 作为 `U+FEFF` 留在首行，首行的
    `$env:HTTPS_PROXY = ...` 所有规则都匹配不上，诊断显示 Ready；UTF-16 文件则直接读取失败。现在按
    BOM 解码：去掉 UTF-8 BOM，解码 UTF-16 LE/BE；没有 BOM 的仍要求严格 UTF-8，解码失败照旧报检查失败。
  - 两项都只影响诊断结果，不改 WFP 保护、流量或连接状态。
- **新增/优化**：无。
- **工程与测试**：App crate 的 `windows-sys` 增加 `Win32_System_Com`、`Win32_UI_Shell`
  feature（不改 Cargo.lock）。`powershell_profile_roots` 改为接收注入的 Documents 目录。新增两个
  `#[test]`（`commands/mod.rs`）：`terminal_proxy_scanner_reads_byte_order_marked_powershell_profiles`
  用 UTF-8 BOM、UTF-16 LE、UTF-16 BE 三个 profile 各写一条代理，断言三个键都被发现（旧代码：UTF-8 BOM
  一条漏检，UTF-16 读取报错）；`terminal_proxy_scanner_uses_the_documents_known_folder_or_fails`
  断言注入的 `D:\工作资料\文档` 在扫描根里、取不到 Documents 时返回错误（旧代码没有这个注入点，
  属构造性失败，不是实际跑出的红）。
- **验证**：本机为编辑机，未运行 cargo；只确认新增代码行不产生 `rustfmt --check` 差异（这两个文件
  原本就不是 rustfmt 干净的）。Windows 编译与两个测试交给本 PR 的 GitHub-hosted `windows-2025` CI
  （"Test the Tauri crate" 步骤），结果以 PR 页为准。未在文档目录被重定向的实机上验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：X3-3 是否真能在"位置"选项卡迁移后触发（`%USERPROFILE%\Documents` 可能仍是指向新位置的
  联接）没有在实机确认。`USERPROFILE` 缺失时整段用户 profile 扫描仍被跳过（原有行为，本 PR 未改）。
  没有 BOM 的 GBK/ANSI profile 仍然只报检查失败，不按代码页解码。

## 2026-09-23 · Windows App 为"另一用户正在使用保护"(1014) 给出专门提示（H2-F2 后续）

- **归属/来源**：G1 保护不变量的用户侧提示；Windows App（`apps/windows/app`）。内部审查 H2-F2
  后续，Issue #481。分支 `fix/protection-held-hint-20260923` **叠在 #354
  （`fix/wfp-owner-takeover-20260923`，d3535b5b）之上**，依赖其新增的
  `ServiceErrorCode::ProtectionHeldByAnotherUser`(1014)；须在 #354 之后合并。提交时未合 main。
- **缺陷修复**：`tono_prepare_core_start` 与 `tono_start_core_with_kill_switch` 把 Service
  拒绝一律 `bail!(response.message)`，错误码丢失，前端只能显示通用"未知操作失败"。现在两处经
  `tono_start_refusal` 把 1014 转成稳定标记 `TONO_PROTECTION_HELD_BY_ANOTHER_USER`，前端
  `STABLE_ERROR_KEYS` 映射到 `tono.dashboard.errors.protectionHeldByAnotherUser`（中英）：
  "本机另一位用户正在使用 Tono 的保护，需对方断开或注销后才能连接。" 其他拒绝原样保留。
  Service 端拒绝行为不变，保护不放宽。
- **新增/优化**：无。
- **工程与测试**：新增一个 `#[test]`
  `core::service::tests::protection_held_by_another_user_refusal_carries_its_marker`：1014
  拒绝必须以该标记开头。旧代码没有这层映射（只返回原消息），断言不成立。i18n 类型文件用
  `generate-i18n-keys.mjs` 重新生成。
- **验证**：本机（MacBook）只做前端检查：`tsc --noEmit` 通过，`eslint src/services/tono.ts`
  通过，`vitest run src/services` 4 个文件 51 项通过；Rust 只跑了 `rustfmt --check`（新增代码无差异），
  未运行 cargo。App 编译与该测试委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未在多用户 Windows 11 实机上看到该提示。提示只覆盖连接路径；第二个用户的
  Restore/Release 被既有 owner 检查拒绝时的提示未改。依赖 #354 先合并。

## 2026-09-23 · Windows 另一登录用户不得接管已武装的保护（H2-F2）

- **归属**：G1 保护不变量（fail-closed；"不同本地用户不得释放他人保护"）；平台/模块：
  Windows Service（`apps/windows/service`），App 无代码改动。
- **来源**：基线 main b1b6fe6c（2026-09-23 rebase 到 26d438c1）→ 分支 `fix/wfp-owner-takeover-20260923`；Issue #353；
  PR 与准确源码 SHA 见 PR，提交本条时未合 main。
- **缺陷修复（内部审查 H2-F2，源码推导）**：`authorize_write_for` 已禁止另一本地用户
  Release，但 `StartClash` / `PrepareCoreStart` 走 `Unchecked` 门，`arm_bootstrap`
  直接把 intent 的 `owner_key` 改成调用方，随后停掉前一用户的 Core；owner 被改写后
  Release 对新调用方放行。改后：武装 intent 的 owner 是另一用户、且该用户仍有
  Windows 登录会话（WTS 枚举，只看 Active/Connected/Disconnected 状态的会话）时，两条路由在生命周期锁内、停任何 Core
  之前以新错误码 `ProtectionHeldByAnotherUser`(1014, HTTP 409) 拒绝；`arm_bootstrap`
  在 WFP 锁内再检查一次。RDP 监听、Idle、Init、Down 等状态的会话不参与判定；上述三种状态的
  会话查询 token 时，只有 `ERROR_NO_TOKEN`（无用户）与 `ERROR_CTX_WINSTATION_NOT_FOUND`（会话
  已结束）视为已登出，其余错误及会话无法枚举仍按"仍登录"处理。原 owner 注销后允许接管；
  无 owner 的 emergency intent 与 Release 的 owner 检查不变。
- **新增/优化**：无。
- **工程与测试**：新增 `#[tokio::test]`
  `another_signed_in_user_cannot_take_over_armed_protection`（`windows_kill_switch.rs`）：
  alice 武装后 bob 的 `arm_bootstrap` 必须返回 1014 且磁盘 intent 仍属 alice；旧代码下
  bob 的武装成功，断言失败。既有 `arm_inherits_verification_only_for_same_owner`
  原本就断言跨用户武装成功，现先把 alice 标为已注销再武装 bob，保留其"验证状态不跨
  owner 继承"的原意。windows-sys 增加 `Win32_System_RemoteDesktop` feature（不改 Cargo.lock）。
- **验证**：本机（MacBook）按 2026-09-14 决定只做编辑与 `rustfmt --check`（新增代码无差异），
  未运行 `cargo build/test/check/clippy`；编译与回归委托本 PR 的 GitHub-hosted
  `windows-2025` CI，结果以该 run 为准。WTS 会话判定只在 CI 编译，未在 Windows 11
  多用户实机上执行。
- **候选/发布**：仅源码，无新候选、无新包；未触碰 `appcast.xml`/`latest.json` 或
  `windows-updates`。
- **剩余限制**：App 尚未把 1014 映射成"另一用户正在使用 Tono"的专门提示，目前显示为
  一次连接失败并附服务端消息。第二个用户在原 owner 仍登录时既不能连接也不能释放，
  只能等原 owner 断开或注销。未对提升权限的管理员开例外。多用户实机行为需验收
  （含开启远程桌面的 Win11 Pro 上监听会话被正确跳过）。会话状态过滤与错误码分类只在 CI 编译，
  没有单元测试执行（生产 WTS 路径在 `test` feature 下编译掉）。快速用户切换时原 owner 的断开
  会话仍算"仍登录"，第二个用户可能整机断网：需 owner 确认。
- **续记（2026-09-23，第三轮审查）**：会话枚举只考虑 Active/Connected/Disconnected，避免
  RDP 监听等会话让接管被永久拒绝；`ERROR_CTX_WINSTATION_NOT_FOUND` 视为会话已结束。本机
  未编译，委托本 PR CI。

## 2026-09-23 · Windows DNS 状态纳入实际生效的解析策略（NRPT 漂移不再显示为干净健康）

- **归属/来源**：G1 保护可观测性；Windows Service `core/dns`（`mod.rs`、`engine.rs`、
  `apply_test_io.rs`）、共享 wire 结构 `DnsProtectionStatus`（`core/structure.rs`）与 App 诊断报告
  （`diagnostics.rs`）。内部审查 X2-2，Issue #467；R4 审查 Part C #468 第 1–2 点与跨 PR 发现 2
  （P2）已在同一 PR 修正。基线 main bb2ed4e4 → 分支 `fix/nrpt-drift-health-20260923`；提交时未合 main。
- **缺陷修复**：Service 的 DNS 健康只读各网卡注册表 `NameServer`/`ProfileNameServer`，连接后
  不读实际生效的 NRPT，也不再做系统解析；加入公司网络、公司 VPN 或策略刷新让别的 NRPT 规则
  生效后，状态仍是无错误的 enabled。现在 watchdog 每 30 s 在 DNS 操作锁之外读取实际生效的
  NRPT（组策略库有规则时取组策略库，否则取本地库），并做一次绕过缓存和 hosts 的系统 A 解析
  （同 App 连接期的探测名）；纯函数 `resolver_policy_conflict` 只在读取成功且与保护矛盾时给出
  `TONO_DNS_POLICY_CONFLICT` 标记：Tono 的 catch-all 不是生效规则、另有规则把名字指向非 Tono
  解析器，或系统解析成功但答案不在 fake-ip 198.18/16。NRPT 读取失败或系统解析失败只算无法判定，
  不算冲突（受保护重连期间 Core 重启几秒内查询必然失败；Core 长时间起不来也不是别人的解析策略）。
  标记放在 DNS status 的独立咨询字段 `resolver_policy_warning`（`serde(default)` + 为空不序列化，
  wire 结构无 `deny_unknown_fields`，新旧 App/Service 双向兼容），不进 `last_error`。它不是
  watchdog 的修复工作（重连无法改别人的策略，不会空转）。App 健康判定不读该字段，不拆会话；
  诊断报告在无真实错误时把它并入 `dnsLastError`，Support 页按标记列在 DNS 警告行。
  保护不放宽：WFP、适配器 DNS 和自有 NRPT 规则的写入都不变；`last_error` 仍只承载真实错误。
  **审查修正**：本 PR 初版把标记写进 `last_error`，而原生更新 Prepare 的 `protection()`
  （`update.rs` 要求 `dns.last_error.is_none()`）、启动接管候选（`structure.rs`）和 App DNS
  enable 响应丢失后的状态读回（`core/service/mod.rs`）都要求 `last_error` 为空：加入域且有 GPO
  NRPT 的机器在 Connected 时原生更新会一直被拒（"network protection is uncertain"）。初版
  "冲突时不续接，只会更严"的说法因此作废；初版还把任何查询失败算作冲突。两处均已改正，App
  `DNS_WARNING_MARKERS` 恢复为原来两项。
- **新增/优化**：无。
- **工程与测试**：native DNS 夹具（`test_io::Machine`）新增可注入的 `effective_nrpt` 与
  `system_lookup`（默认健康）；新增一个 `#[tokio::test]`
  `core::dns::engine::native_apply::tests::effective_resolver_policy_drift_cannot_read_as_healthy`：
  真实 enable 后经更新准入的读取路径 `observe_for_update()` 分三段断言：NRPT 健康但系统解析返回
  非 fake-ip → 冲突出现在 `resolver_policy_warning`，`last_error` 仍为空；NRPT 读取与系统解析都失败
  → 无冲突、无错误；组策略 catch-all 指向 10.20.30.40（解析仍失败）→ 冲突且 `last_error` 为空，
  `PROTECTION_WANTED` 保持。在初版分支上它失败：初版把标记写进 `last_error`（第一段
  `last_error.is_none()` 失败），且查询失败即冲突（第二段失败）；初版结构也没有该字段，按构造编译
  失败。在 bb2ed4e4 上状态观察没有这两个输入，同样按构造失败（均未在本机执行）。其余测试中
  `DnsProtectionStatus` 的完整字面量补上新字段（`None`）。Service `windows-sys` 增加
  `Win32_NetworkManagement_Dns` 特性（Cargo.lock 不变）。本机只用 `rustc --test` 单独编译过纯函数
  做语法与逻辑自查。
- **验证**：本机为编辑机，未运行 cargo；Service 编译与 CI 步骤 "Test native DNS apply
  orchestration"（`--features standalone,client --lib core::dns::engine::native_apply::tests::`）、
  lifecycle 套件与 App `cargo test` 委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以 PR 页为准。
  Support 页改动本机 biome/eslint 单文件检查通过。审查修正这一轮同样本机未编译，委托 CI；
  `support.tsx` 本轮只改注释，worktree 无 `node_modules`，未跑 vitest/tsc。未做实机验证。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：用户可见影响仍需 Issue #467 的实机 4 步清单。VPN 配置文件自带的 NRPT
  （不在两个注册表库里）只能由系统解析这条腿间接发现，且只覆盖探测名；针对具体公司域名的规则由
  规则读取覆盖。`enum_subkeys` 仍只枚举前 64 个子键（#300 另改）。冲突只在 Support 页显示，
  仪表盘无提示；检测间隔 30 s。旧 App 读新 Service 时忽略新字段，不显示该警告。读取或解析一直失败时
  不给任何提示（与 main 相同）。R4 审查第 3 点未改：检测仍在 watchdog 循环内联执行，冲突场景下
  NRPT 读取（上限 5 s）加系统解析（上限 5 s）每 30 s 最多让 2 s 一次的适配器 DNS 漂移修复停顿
  约 10 s（最坏约 12 s）。第 4 点未改：restore 与 enable 落在同一个 2 s tick 内时上一会话的结论
  可能在新会话里保留至多 30 s（只影响提示）。与 #305 的文本冲突现在只在 `support.tsx` 标记列表
  （合并时保留四项）。

## 2026-09-23 · Windows 升级后归档 0.0.72 遗留的更新交接记录

- **归属/来源**：G3 客户升级路径；Windows App + tono-core。内部审查 H15-F3，Issue #496。
  基线 origin/main bb2ed4e4；分支 `fix/legacy-handoff-windows-20260923`；未合 main。
- **缺陷修复**：0.0.72 设置页更新写下 `update-handoff.json`（`ConnectionQuiescing`，或安装器
  拒绝后被 0.0.72 记为 `Failed`）。0.0.73 起不再推进、提交或删除它，而状态读取把过期（`load`
  返回 Err）或 Failed 当作"更新恢复未完成"，Dashboard 永久告警。改为启动恢复入口
  `restore_session_guarded` 先调用 `update_handoff::retire_completed_legacy_journal`：当前
  `CARGO_PKG_VERSION` ≥ 记录的 `next_app_version`（数字点分比较），把原字节归档到
  `update-handoff.history/` 后删除；目标版本更高、无法解析、schema 不符或版本号不可解析时
  保留原文件并照旧告警。原生 v1 更新事务（Service `state.json`）不受影响，保护状态也不依赖
  这份记录。
- **新增/优化**：无。
- **工程与测试**：一个 `#[test]`
  `completed_legacy_upgrade_journal_is_archived_and_no_longer_incomplete`（tono-core）：已过期的
  0.0.72 → 0.0.73 记录在 0.0.72 下保留（`load` 仍报错），在 0.0.73 下原字节归档且 `load` 为空。
  旧代码无此入口（编译失败即失败）。`write_prepared` 的归档代码抽成共用函数，行为不变。
- **验证**：本机未执行 cargo（2026-09-14 所有者决定）；仅用 rustfmt 做语法解析检查。回归交给
  本 PR 的 GitHub-hosted windows-2025 CI（`cargo test -p tono-core` 与 App crate），结果见 PR。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：必须在 0.0.73 发给 0.0.72 客户之前合入。未在 Windows 11 上用 0.0.72 设置页
  升级实测。安装器在已连接时静默拒绝（H15-F2）另开 PR。

## 2026-09-23 · Windows 安装/卸载门控拒绝时给出说明；确认后的卸载可释放保护

- **归属/来源**：G3 客户升级路径；Windows NSIS 模板 + Service 手动安装门控。内部审查 H15-F2，
  Issue #499。基线 origin/main bb2ed4e4；分支 `fix/installer-filter-gate-20260923`；未合 main。
- **缺陷修复**：`--manual-update-gate`（`begin_manual`）在存在任何 Tono WFP 过滤器或 active
  owner 仍要求 Core 运行时拒绝，NSIS 在 `.onInit`/`un.onInit` 里 `Abort` 且没有对话框：
  0.0.72 已连接时从设置页更新 → App 退出、安装器静默退出；Protected Offline 卸载静默退出，
  `RemoveVergeService` 的"卸载助手 → 紧急解除 → 再清理"阶梯永远到不了。改为：
  (1) 这两种"仅因保护仍开启"的拒绝返回可区分的 `ProtectionActive`，门控以退出码 77 表达，
  其他拒绝（更新 pending、另一个安装器持有租约、DNS/Core 状态无法确认）不变；
  (2) 安装器非静默时弹框：77 提示在 Tono 中断开/恢复网络或以管理员运行"恢复网络"快捷方式，
  其他提示有未完成更新或安装器；门控仍拒绝，安装器不自行释放保护；
  (3) 卸载器仅在 77 且非静默时询问确认，确认后调用新的 `--manual-uninstall-gate`（只检查
  更新 pending 与安装器租约并记录租约，不要求断开），随后由既有 `RemoveVergeService` 释放保护；
  该阶梯仅在证明 WFP 已移除时继续删除文件。静默卸载在保护开启时仍拒绝（76）。
- **新增/优化**：无。
- **工程与测试**：一个 node 测试（`windows-packaging.test.mjs`
  "NSIS explains a refused gate and confirms before uninstall releases protection"），断言两处
  门控失败分支在非静默时有 MessageBox、卸载确认位于 `--manual-update-gate` 与
  `--manual-uninstall-gate` 之间、四组文案三种语言齐全、Service 退出码常量为 77。本机在旧模板上
  实际运行为失败，改后 23/23 通过。
- **验证**：MacBook 上 `node --test scripts/windows-packaging.test.mjs`（apps/windows/app）通过；
  Rust 仅用 rustfmt 做语法解析，未执行 cargo。NSIS 本机不能编译。Service 与模板改动交给本 PR
  CI（windows-2025 Service/App 测试、ubuntu packaging 契约）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：需候选构建 + Windows 11 实机验证：0.0.72 已连接时设置页更新、Protected Offline
  卸载（确认/取消两条路径）、孤立过滤器卸载。安装路径没有提供"由安装器代为断开"：已安装 Service
  在线时 `--emergency-disarm` 按设计拒绝，受支持的释放路径是 App 的认证管道，安装器代断开需要新的
  Service 路由，待 owner 决定。0.0.72 更新失败后不会自动重新打开旧 App。

## 2026-09-23 · Windows 原生更新存储：schema 主版本 + 同主版本忽略未知字段

- **归属/来源**：G3 原生更新 v1（面向 0.0.73 → 0.0.74 起的 N-1 执行器）；Windows Service
  `update_transaction.rs`。内部审查 H15-F6，Issue #501。基线 origin/main bb2ed4e4；分支
  `fix/update-store-schema-windows-20260923`；未合 main。
- **缺陷修复**：`State`/`Attempt`/`Image`/`DisconnectEvidence` 均为 `deny_unknown_fields`，
  而按设计旧版执行器副本会读新版 Service 写的 `state.json`；任何加字段都会让旧执行器报
  "corrupt update evidence retained"，且这类证据不会被清理或被重装清除。改为：读取前先探测
  `schema_version`（缺省为 1）；高于本版支持的主版本时以"written by a newer Tono (schema N)"
  拒绝并保留原字节（与损坏区分，仍按 pending 证据阻断）；同主版本去掉四个本地结构的
  `deny_unknown_fields`，忽略新增字段。写入端在主版本为 1 时不写该字段，已有构建照常读取。
  内嵌的 manifest/receipt 仍按线协议严格校验，不受影响。
- **新增/优化**：`docs/UPDATE_PROTOCOL_V1.md` 新增 "Local store schema across versions"，
  写明两端规则（新增字段须可选且可丢弃；其余变更升主版本；发布前用上一版执行器读候选写出的
  账本）。macOS 实现见单独 PR。
- **工程与测试**：一个 `#[test]`
  `newer_store_fields_are_ignored_and_a_newer_major_is_refused_not_corrupt`：在顶层、attempt、
  initiating_image 加未知字段后 `Store::open` 仍成功；`schema_version: 2` 时拒绝且错误可区分、
  原字节保留。旧代码在第一次打开处因 `deny_unknown_fields` 失败。
- **验证**：本机未执行 cargo；rustfmt 仅做语法解析。回归交给本 PR 的 windows-2025 Service CI，
  结果见 PR。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：规则只对含本改动的执行器生效；本 PR 之前构建的内部候选执行器仍会拒绝任何新增
  字段。执行器自身的 `replacement.json`（同一副本写读）未改。

## 2026-09-23 · Windows 安装器拒绝降级安装，并写明安全回退步骤

- **归属/来源**：G3 客户升级/回退路径；Windows NSIS 配置与模板。内部审查 H15-F5，Issue #507。
  基线 origin/main bb2ed4e4；分支 `fix/installer-downgrade-block-20260923`；未合 main。
- **缺陷修复**：`tauri.windows.conf.json` 未设 `allowDowngrades`，tauri-utils 默认 true，
  旧版安装器可直接装在新版之上；0.0.73+ 在受保护期间写入的 NRPT 全匹配规则与加密 DNS 抑制，
  0.0.72 的 Service/卸载器都不认识，断开后遗留（整机解析失败、加密 DNS 被关）。0.0.72 已发出、
  无法从新版一侧修复（0.0.73 Service 停止时分不清"被旧版替换"与"普通重启"，停止时撤销会削弱
  受保护重启）。改为：从 0.0.73 起 `allowDowngrades: false`，旧于已装版本的安装器走既有
  `downgrade_blocked` 并弹框；文案（中/英/俄）补充安全回退步骤（先卸载当前版本并保留应用数据，
  再装旧版）。`downgrade_blocked` 在 `.onInit` 中 Quit，不会走到 `.onGUIEnd`，而此时手动门控已
  发放租约；新增 `ReleaseManualLease` 在 Quit 前交还租约，避免 Service 之后一直拒绝连接。
- **新增/优化**：`docs/RELEASE_LINES.md` 新增 "Going back to an older Windows build"。
- **工程与测试**：一个 node 测试（`windows-packaging.test.mjs`
  "Windows installers refuse to downgrade and hand back the manual lease on that exit"）：配置为
  false、`downgrade_blocked` 在 Quit 前调用 `ReleaseManualLease`、该函数运行 bundled gate 的
  `--manual-update-finish`。旧源码上实际运行为失败；改后 dev-control 套件 99/99 通过。
- **验证**：MacBook 上 `node --test`（apps/windows/app，dev-control 六个文件）通过；NSIS 本机不能
  编译，交给本 PR CI 与候选构建。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：对 0.0.72 安装器无效（旧模板已固化）；需候选构建 + 实机确认降级弹框与租约交还。
  同类问题（未修）：`.onInit` 中门控成功后的其他退出（语言选择取消、`invalid_existing_version`、
  `legacy_wix_blocked`、`legacyLocationAbort`）同样不交还租约，另行跟踪。

## 2026-09-23 · Windows 地址无关直连规则不再接受裸 IP 的嗅探 SNI

- **归属/来源**：G1 保护边界（内部审查 H1-F3）；影响 Windows `crates/tono-core`
  运行时配置生成。基线 main b1b6fe6c（由 244075f2 rebase），分支 `fix/windows-sniff-direct-20260923`，
  Issue [#338](https://github.com/raydocs/tono/issues/338)；提交时未合 main。
- **缺陷修复**：带 pinned hosts 的 DirectPlan 开启 TLS sniffer（`parse-pure-ip: true`、
  `override-destination: false`），同一运行时在发现签名 WeChat 路径后还会生成无地址、
  无进程条件的 `DOMAIN-SUFFIX` 直连规则。Mihomo v1.19.30 中嗅探名只进 `SniffHost`
  供规则匹配，拨号仍用原始 IP；WFP Rule H 按核心 app id 放行任意公网 IPv4 的审查端口，
  因此裸 IP 连接只凭客户端提供的 SNI 就能走物理网卡。改后：凡运行时生成地址无关后缀规则，
  sniffer 显式写 `parse-pure-ip: false`（Mihomo 默认 true）；无此类规则的运行时保持原样。
- **新增/优化**：无。签名 WeChat 裸 IP 连接在该运行时仍由审查端口上的 `PROCESS-PATH-REGEX`
  规则直连；pinned host 连接仍经 `force-domain`/DNS 映射嗅探，受 pinned 地址约束。
- **工程与测试**：新增一个回归 `address_free_suffix_direct_never_matches_a_sniffed_raw_ip_dial`
  （`config.rs`，`#[test]`）：签名路径 + 地址无关后缀时断言后缀直连规则存在且
  `parse-pure-ip` 为 false；在旧代码上该断言读到 true 而失败。
- **验证**：本机（MacBook）按 AGENTS.md 执行地点约束未运行 cargo；编译与测试委托本 PR 的
  GitHub-hosted `windows-2025` CI（`crates/tono-core` `cargo test`）。Mihomo 语义依据上游
  v1.19.30 源码（`component/sniffer/dispatcher.go`、`constant/metadata.go`、`tunnel/tunnel.go`）。
- **候选/发布**：无新包，仅源码；不涉及 Sparkle/windows 更新源。
- **剩余限制**：未实机复现。无签名路径（不生成后缀规则）时裸 IP 嗅探保留，只服务带地址约束的
  pin 规则。非 WeChat 进程对 pinned 地址的裸 IP 连接在该运行时不再嗅探，改走隧道。
  pinned 地址 DNS 映射窗口内的连接仍会被嗅探，伪造 SNI 只能把流量直连到已审查的 pinned 地址。

## 2026-09-23 · Windows kill switch 入站接受默认拒绝（H1-F4）

- **归属/来源**：G1 保护一致性（断开/连接时保护与 UI 一致）；影响 Windows Service
  （`apps/windows/service`）。基线 main da7bad1b（2026-09-23 rebase 到 26d438c1）→ 分支 `fix/wfp-inbound-accept-20260923`；
  Issue #328；提交时未合 main。
- **缺陷修复**：WFP 默认拒绝只装在 `ALE_AUTH_CONNECT_V4/V6`，`ALE_AUTH_RECV_ACCEPT_V4/V6`
  没有 block（v6 只有 NDP permit、v4 层根本未建模）。远端发起的流只在 RECV_ACCEPT 授权一次，
  其出向包不再经过 CONNECT 层，所以物理网卡上的监听端可接受连接，整条流不经隧道。改后
  RECV_ACCEPT v4/v6 在同一子层加持久 floor block-all + 会话 block-all（权重 1，与 connect
  层一致），并补 permit：loopback 地址/ALE flag 两种形式（hard，权重 8）、Locked 时 WinTUN
  LUID（权重 8）、DHCP 服务器回包（v4 68←67 仅按端口；v6 546←547 且源地址限 `fe80::/10`，
  RFC 8415 规定服务器/中继以链路本地地址回复，权重 7）、原有 NDP。Windows 无 LAN
  放行，因此不加 LAN 入站放行。`FILTER_NAMESPACE` 升到 v10（`…9e09…`）。
- **新增/优化**：无。
- **工程与测试**：新回归 `inbound_accept_on_the_physical_adapter_is_blocked_in_every_mode`
  （`wfp_model.rs`，一个 `#[test]`）：三种模式下物理口入向 TCP（v4/v6）判 Block，loopback 判
  Permit，TUN 接口仅 Locked 判 Permit；同一测试另断言 DHCP 回包放行（v4 192.168.1.1:67→68、
  v6 fe80::1:547→546 判 Permit）与全局源 DHCPv6（2001:db8::67:547→546）判 Block——前者防止
  日后误删/写错入站 DHCP permit 导致租约到期断网，后者在收窄前（纯端口规则）判 Permit 必失败。
  在未修复规则上的实测失败：仅加测试+层枚举的一次性分支
  经 Windows CI（run 35842751048）失败于 `arbitrate` 的 “every layer must end in a block-all”
  （该层无任何过滤器可判决）。随规则表变更同步修正三个计数/固定值断言：持久过滤器 2→4、
  tunnel permit 2→4、namespace pin。
- **验证**：本机（编辑机）未运行 cargo；回归与编译委托本 PR 的 GitHub-hosted `windows-2025`
  CI。CI 的真实 WFP 引擎步骤只加载既有的多前缀 permit，没有加载新的 RECV_ACCEPT_V4 过滤器。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机确认（RECV_ACCEPT 语义、mihomo controller/本地 DNS 的回环入向被 loopback
  permit 覆盖、内核接受新层上的条件组合）。连接期间物理口上的入向服务（RDP/SMB/远程桌面、
  Tailscale 等其他虚拟网卡入向）将被拒绝，与 macOS PF 行为一致。**开启保护会立即断开当前的
  远程桌面（RDP）会话**：在 RECV_ACCEPT 加过滤器会重授权已有入向 flow，arm 时 RDP 会话被拆掉；
  之后入站 3389 被拒，floor 持久、Service 开机恢复 intent，重启也无法远程恢复，只能到机器前
  操作或 `--emergency-disarm`。这是否为可接受的产品行为**需 owner 决定**，本 PR 未加 App 侧
  RDP 检测提示。入站 DHCPv4 permit 仍只按端口：公网地址可主动发包到本机 :68 时，本地进程可借
  这条入向 flow 向任意地址的 :67 回发（DHCPv4 服务器/中继可能用公网地址回复，不能按源收窄）。
  Namespace 协调：本 PR 用 v10（`…9e09…`），#345（#341 Windows）用 v11（`…9e0a…`），建议
  合并顺序 #343 → #345；若 #345 先合，本 PR rebase 时须升到 v12，不可沿用任何已发过的值。
- **续记（2026-09-23，第三轮审查）**：入站 DHCPv6 permit 加源地址 `fe80::/10`；回归测试补
  DHCP 回包放行与全局源 DHCPv6 拒绝断言；限制中补 RDP 会话断开与 namespace 顺序。本机未编译，
  委托本 PR CI。

## 2026-09-23 · Windows kill switch DHCP 放行收窄目的地址（H1-F6 Windows）

- **归属/来源**：G1 保护一致性；影响 Windows Service（`apps/windows/service`）。基线 main
  da7bad1b（2026-09-23 rebase 到 26d438c1）→ 分支 `fix/dhcp-scope-windows-20260923`；Issue #341；提交时未合 main。
- **缺陷修复**：`intent/permit-dhcp-v4`（68→67）与 `intent/permit-dhcp-v6`（546→547）只按
  端口匹配，任意进程可经物理网卡到达任意公网地址的 UDP 67/547（所有模式，含 Protected
  Offline）。改后 DHCPv4 目的限定为 255.255.255.255 与非公网服务器段（10/8、172.16/12、
  192.168/16、169.254/16、100.64/10），DHCPv6 限定为 ff02::1:2 与 fe80::/10（WFP 对同字段
  条件取 OR）。`FILTER_NAMESPACE` 升到 v11（`…9e0a…`；v10 已由 #343 使用）。
- **新增/优化**：无。
- **工程与测试**：新回归 `dhcp_client_permits_do_not_reach_public_destinations`（一个
  `#[test]`）：三种模式下客户端端口到公网 v4/v6 判 Block、到广播/多播判 Permit。在未修复规则
  上的实测失败：仅加测试的一次性分支经 Windows CI（run 35843025023）失败于
  “Bootstrap: DHCP client port to 203.0.113.8”（Permit ≠ Block）。namespace pin 同步更新。
- **验证**：本机未运行 cargo；委托本 PR 的 GitHub-hosted `windows-2025` CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：未实机确认。DHCP 服务器在公网地址（如桥接模式）时单播续租被拒，依赖广播
  rebind 续租。未加 svchost/Dhcp 服务身份条件（需改引擎并实机确认 DHCP 客户端的 ALE 身份），
  入站 DHCP permit 由 #343（#328）引入，不在本分支：其 DHCPv6 回包已在 #343 限定源地址
  `fe80::/10`，DHCPv4 回包仍只按端口（公网 DHCP 服务器/中继存在，不能按源收窄）。Namespace：
  #343 用 v10、本 PR 用 v11，建议合并顺序 #343 → #345；若本 PR 先合，#343 rebase 时须升到 v12。
- **续记（2026-09-23，第三轮审查）**：namespace 由 v10 改为 v11，避免与 #343 同值——同值时
  已装过另一版 v10 的机器会按 key 保留旧 DHCP 过滤器，收窄静默失效。本机未编译，委托本 PR CI。

## 2026-09-23 · Windows runtime asset 从已校验的句柄复制（H2-F4）

- **归属**：G1 保护不变量（特权端不跟随用户可写路径）；平台/模块：Windows Service
  runtime generation（`apps/windows/service`），App 无代码改动。
- **来源**：基线 main b1b6fe6c（2026-09-23 rebase 到 26d438c1）→ 分支 `fix/runtime-asset-reparse-20260923`；Issue #355；
  PR 与准确源码 SHA 见 PR，提交本条时未合 main。
- **缺陷修复（内部审查 H2-F4，源码推导，影响低）**：`validate_source` 在规划阶段按路径
  校验，`copy_staged_file` 在停旧 Core 之后用 `tokio::fs::copy` 按路径重新打开，会跟随
  中途换上的 junction/symlink。改后：复制只打开一次源文件，并证明该句柄仍解析到已校验
  路径（Windows `GetFinalPathNameByHandleW`；Unix canonical + dev/ino），不一致即拒绝，
  内容从同一句柄读取。StartClash 的 `materialize` 与 `stage_runtime` 共用此原语。打开、句柄
  校验与整次复制在一次 `spawn_blocking` 内完成（`std::io::copy`，1 MiB 写缓冲），不再按 8 KiB
  块在 tokio 阻塞线程间往返，缩短停旧 Core 后的断网窗口；复制最多读规划时记录的长度 +1 字节，
  源文件在规划后变长即拒绝（不无界复制进 ProgramData，也不装入截断文件），变短则按完整内容
  复制，由既有的复制后 re-stat 处理。
- **新增/优化**：无。
- **工程与测试**：新增 `#[tokio::test]`
  `a_source_directory_swapped_for_a_link_after_validation_is_not_copied`（`staging.rs`）：
  校验路径成立后把源目录换成 junction（Windows，`mklink /J`）或 symlink（Unix），复制
  必须失败且目标不存在；旧代码会跟随链接复制成功，断言失败。链接另一端的文件与已校验文件
  等长，确保拒绝来自句柄校验而不是新增的长度校验。长度上限本身没有单独测试。
- **验证**：本机（MacBook）只做编辑与 `rustfmt --check`，未运行 cargo build/test；编译与
  回归委托本 PR 的 GitHub-hosted `windows-2025` CI，结果以该 run 为准。
- **候选/发布**：仅源码，无新候选、无新包；未触碰 `appcast.xml`/`latest.json` 或
  `windows-updates`。
- **剩余限制**：复制后目标文件不做摘要复核（句柄已固定，内容即该文件当前内容）；
  StartClash 期间若资源文件在规划后被改写且变长，本次启动失败（此前会完整复制新内容）；
  同长或变短的改写仍按原设计不致启动失败。断网窗口的缩短未实测。硬链接不在本修复范围内。
- **续记（2026-09-23，第三轮审查）**：复制改为单次阻塞复制并按规划长度校验，见上。本机未
  编译，委托本 PR CI。

## 2026-09-23 · Windows Service 端校验 StartClash / StageRuntime 运行配置

- **归属/来源**：G1 保护不得放宽（内部审查 H2-F3，[#351](https://github.com/raydocs/tono/issues/351)
  第 2 部分；第 1 部分映像绑定见 #352）；影响 Windows Service（`apps/windows/service`）。
  基线 main b1b6fe6c（2026-09-23 rebase 到 26d438c1），分支 `fix/win-service-runtime-config-20260923`；提交时未合 main。
- **缺陷修复**：StartClash/StageRuntime 的 `bundle.yaml` 被原样交给 SYSTEM 运行的 Core，
  owned-runtime 合约只由 App 保证。新增 `runtime_generation/owned_config.rs`
  `ensure_owned_runtime_config_is_safe`，按 macOS `ownedRuntimeConfigIsSafe` 的同类检查映射到
  Mihomo 键（不是逐项等价，见剩余限制）：
  顶层/dns/tun/profile/sniffer 键白名单（拒绝 external-ui、rule/proxy-providers、listeners、
  tunnels 等）；port/socks/redir 为 0，`bind-address: 127.0.0.1`、`allow-lan: false`、
  `mode: rule`；external-controller 与 DNS listen 只允许 `127.0.0.1:`，secret 非空；
  tun `enable`、`device: Tono`、`strict-route: true`；出站类型限 vless/hysteria2/socks5/direct，
  组只允许 select 且必须有 `Tono-Exit`，最后一条规则为 `MATCH,Tono-Exit`；全文禁止
  certificate/private-key/ca/ca-str/external-ui*/skip-cert-verify/routing-mark（比较前按 Mihomo
  解码规则规范化键：`_` 视为 `-`、按 Go `EqualFold` 大小写不敏感，故 `Skip_Cert_Verify`、
  `CA` 等拼写同样被拒）。不合约返回
  `InvalidRuntimeAsset`，在取生命周期锁之前拒绝。
- **新增/优化**：Service 新依赖 `serde_yaml_ng 0.10`（与 App/tono-core 同一解析器；
  Cargo.lock 按 `apps/windows/Cargo.lock` 的同版本与校验和补入 serde_yaml_ng、ryu、unsafe-libyaml）。
- **工程与测试**：新增一个 `#[test]`
  `the_service_refuses_runtime_yaml_outside_the_owned_contract`：App 形状的夹具通过，
  非回环 controller、`skip-cert-verify`、`Skip_Cert_Verify`、非 `MATCH,Tono-Exit` 结尾被拒
  （`Skip_Cert_Verify` 在精确匹配的实现上会被放行，断言失败）。在 main 上的失败方式
  是编译失败（校验函数不存在）。lifecycle `test` feature 的集成测试使用 `mode: rule` 占位
  YAML，故该 feature 下校验不接入路由。
- **验证**：本机（MacBook）按 AGENTS.md 未运行 cargo；手工补写的 lockfile 与编译、测试
  委托本 PR 的 GitHub-hosted `windows-2025` CI（`--locked`）。首版 c2ca1fdf 的 Windows CI
  run 35896001331 / 35895968611 为绿；CI 绿不等于实机验证。规范化续修的结果见本 PR 新 head 的 CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：夹具是按 `tono-core` 生成器手写的形状，不是跨 workspace 的真实输出比对；
  若 App 生成器新增顶层键而未同步本白名单，连接会被 Service 拒绝（fail-closed）。
  不校验规则内容与出站目标（WFP 端点约束仍在）；runtime assets 的 reparse 问题（H2-F4）
  不在本条。未实机验证。**本条不能关闭 #351 第 2 部分**：Core 以校验后的配置启动后，持有
  controller secret 的调用方仍可经 Mihomo 控制器 `PUT /configs`（payload 整份替换）或
  `PATCH /configs`（allow-lan、bind-address、端口、tun 等）把被拒的内容改回；App 自身也依赖
  `PUT /configs`（`direct.rs` reload），不能直接关掉。#380（webview 只授予用到的 core 命令）
  部分缓解（收窄能拿到控制器的前端面），完整封堵需要 Mihomo 补丁或由 Service 持有 secret/代理
  reload。与 macOS 不等价：sing-box clash_api 没有整份配置替换。
- **续记（2026-09-23，第三轮审查）**：禁止键改为规范化后匹配（`_`→`-`、大小写不敏感，含
  U+017F/U+212A 两个折叠到 ASCII 的字符），测试加 `Skip_Cert_Verify` 反例；限制补控制器绕过。
  本机未编译，委托本 PR CI。

## 2026-09-23 · macOS 升级事务终态：consumed 后可达归档 + successor 合法重绑

- **归属/来源**：G3 原生升级链；macOS `tono-core-helper` 升级账本。R4-F2 与 R4-F3
  （2026-09-22 升级中断恢复审查发现，对抗核实轮 V9 确认为同一根因族：consumed 后唯一出口
  commit + 证明权绑定唯一进程 incarnation + 全部门以 pending 拒绝）。叠在 #303、#307
  （快照 quarantine + 4.7.0）与 #308（bootout 干净停止 + 4.8.0，
  `fix/macos-update-bootout-startup-20260922`）之上；本条分支
  `fix/macos-update-terminal-states-20260922`。
- **缺陷修复**：F2——执行器侧一次失败（validate/`runtime.prepare` 失败、App 30 s 未退出、
  `.replacing` 中断回滚、48 h 过期）后，事务停在 consumed+blocked / rolledBack，无任何终态：
  `reconcile` 抛错、`AppUpdater.check` 的 retryable 只认 reserved/staged、"Restore internet"
  可解除 PF 但 `gate`/`offer`/`reserve`/`--update-install-guard`/`--emergency-reset` 全部永久拒绝。
  F3——successorToken 唯一绑定首个收养 App 的 audit token，commit 前 successor 退出/崩溃/重启机
  （audit token 仅同一 boot 有效）后任何新 incarnation（含执行器 `launchSuccessor` 自己拉起的）
  都被 `reconcile`/`bound` 拒绝，结果同 F2。修复为同一结构集：(a) 特权终态归档
  `retireResolved`——要求 owner 认证、已验证显式 Disconnect、`observe()==.unprotected`，且
  磁盘组件证明二选一（未进 replacement/已回滚 == originalComponents，或已替换安装 ==
  签名 target 组件），归档 JSON 保留（含最后证明相位与 blockedReason）后清槽，highWater 与
  generation 不变，并像 commit 一样退休执行器 launchd 项；挂在 `/update/retire`（按 execution
  分派 unconsumed/resolved 两套谓词）与 `--emergency-disarm`（验证释放后自动评估，root CLI 无
  peer，谓词不满足则什么都不改）。(b) `reconcile` successor 重绑——记录的 successor 跨 boot 或
  token 不再解析为活进程且新 peer 通过既有认证/owner/组件校验时，重新分配 successor 代际
  （换代不换相位：receipt 证明相位不动，适配器层原位更新 successorGeneration/token/boot，不调
  `propose`，不动共享 wire 模型）；旧 successor 可证明存活时仍独占拒绝。App 侧
  "Disconnect and Retry" 的 retryable 扩展到 blocked/rolledBack/expired/已断开/放弃替换的
  consumed 侧（健康执行中与 successor 可恢复的仍不可重试）。U1 单次消费、U3 高水位不回退、
  U4 Disconnect 不伪造提交全部保持；未放宽任何 gate 对未决事务的保护。
- **工程与测试**：新增两个窄 helper 自测（载体 `--update-self-test`，计数 8→10）：
  `rolled-back-attempt-can-be-retired-after-verified-disconnect`（F2：回滚 + 已验证 Disconnect
  后归档清槽、highWater 保留、证据归档、`gate` 放行 /core/start）与
  `successor-relaunch-after-adoption-can-be-readopted-and-commit`（F3：绑定 successor 存活时
  拒绝第三 incarnation；消亡后重绑新代际且 commit 达 committed）。修复前实现分别在 retire 调用
  与第二处 reconcile 处失败。helper 源码变更按 `build-core-helper.sh` 契约门推进
  `HelperProtocolVersion` 4.8.0 → 4.9.0；CONTRACT.sha256 以脚本同一 sed|shasum 管道本机重算
  （纯文本哈希，未编译；管道已先对修改前树复现 #308 记录的 4.8.0 哈希自证一致）。审查轮：
  链上父分支修正后 rebase 并重算契约；App 启动 `RuntimeCleanup.cleanupStaleRuntime` 在
  reconcile 拒绝时的错误文案改为指向新出口（"检查更新 → 断开并重试"），并在
  Localizable.xcstrings 补中英文条目（纯文案，无新测试）。
  `docs/UPDATE_PROTOCOL_V1.md` 新增小节 "Terminal resolution and successor re-adoption
  (clarified 2026-09-22)"，记录两个终态/重绑契约，不改旧条款含义。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；回归委托
  本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --update-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得本轮 CI
  结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能面向客户、无新包、无部署，仅源码。`--emergency-reset` 在
  pending 时仍拒绝（先 disarm 归档后再 reset 可走）；重绑不覆盖 48 h 过期（过期+replaced 仍只能
  走放弃归档，与"过期不是未安装证明"的文档语义一致）；Windows F1/F4/F6 不在本条。触发概率的
  实机数据仍缺，仅源码路径与 launchd/audit-token 语义核实。

## 2026-09-23 · macOS 升级开机竞态：执行器 bootout 停 Helper 不再误装紧急 PF 阻断

- **归属/来源**：G3 原生升级链；macOS `tono-core-helper` 启动恢复。R4-F5
  （2026-09-22 升级中断恢复审查发现，对抗核实轮 V9 确认并修正影响面）。叠在
  R3-F4 修复 PR #303 与 R3-F3 修复 `fix/macos-dns-snapshot-outlet-20260922`（#307）之上，
  本条分支 `fix/macos-update-bootout-startup-20260922`。
- **缺陷修复**：consumed→replaced 窗口内重启机时，`core-helper`（RunAtLoad+KeepAlive）与
  `update-executor`（RunAtLoad）并行启动；执行器先持锁进入 perform 的 validate（全束验签
  冷启动可达数秒），Helper main 的 `UpdateExecutor.startup()` 在 `storage.locked` 自旋等待；
  执行器到 `stopDaemon()` 的 `launchctl bootout` 发 SIGTERM，自旋守卫抛错，main 的 catch
  无差别 `installEmergencyBlock`（全阻断）并 exit(1)——把自己的执行器停机当成了账本损坏。
  现把 main 的 catch 收进 `UpdateExecutor.startup(storage:emergencyBlock:)`：`locked` 的
  自旋守卫在 `helperShutdownRequested` 时改抛可区分的 `HelperFailure.stopping`，startup 对
  stopping 返回干净停止（main exit(0)，执行器拥有流程，`startDaemon` 事后拉回，无需任何
  PF 动作）；其余任何 startup 错误仍照旧装紧急阻断（fail-closed 不变）。核实修正的影响面
  （V9）：`installEmergencyBlock` 不写持久化状态文件，受保护义务经执行器
  `restoreAtLaunch`/`retainBootstrap` 自愈；真正落入坏态的是 `.unprotected` 义务——紧急
  规则残留使 validate 观测 `.unknown` → blocked → 落入 R4-F2 的永久 pending（事务终态缺
  口由后续 PR 修，本条只修"bootout 被当成账本损坏"这一根因）。触发面经核实为窗口内重启
  机（UpdateStorage.swift:61-62 注释自证该交错是设计预期），同一 boot 内正常升级不暴露。
- **工程与测试**：新增一个窄 helper 自测
  `startup-interrupted-by-own-executor-bootout-does-not-arm-emergency-block`（载体
  `--update-self-test`）：第二持有者持锁 + `helperShutdownRequested=1` → 断言 startup 返回
  干净停止且 emergencyBlock 回调未 invoked；同测并断言损坏账本仍会触发 emergencyBlock
  （仅此一个白名单分支，不放宽保护）。修复前实现 `armed==1` 必失败。另：helper 源码变更
  按 `build-core-helper.sh` 契约门推进 `HelperProtocolVersion` 4.7.0 → 4.8.0；
  CONTRACT.sha256 以脚本同一 sed|shasum 管道本机重算（纯文本哈希，未编译；管道已先对
  修改前树复现 #307 记录的 4.7.0 哈希自证一致）。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --update-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得本轮
  CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。R4-F2（consumed 后无终态）与
  R4-F3（successor 单 incarnation 绑定）不在本条；触发概率的实机数据仍缺（依赖启动次序
  与冷启动验签耗时），仅源码路径与 launchd 语义核实。

## 2026-09-23 · macOS 快照文件不可读时隔离后清扫，三条恢复出口不再同点死锁

- **归属/来源**：G1 断开与恢复；macOS `tono-core-helper` 的 `protected-dns.json` 恢复链。
  R3-F3（2026-09-22 并发/时序审查发现，对抗核实轮 V7 确认为源码推导级：`save` 本身
  fsync+rename 原子，触发前提限外部权限漂移/备份恢复/截断事件）。叠在 R3-F4 修复
  `fix/macos-dns-status-snapshot-20260922`（PR #303）之上，本条分支
  `fix/macos-dns-snapshot-outlet-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/fix/macos-dns-status-snapshot-20260922...fix/macos-dns-snapshot-outlet-20260922)。
- **缺陷修复**：`loadSnapshot()` 对 uid≠0、非普通文件、mode 含 group/other 位、size==0、
  size>16 KiB、JSON 解码失败一律 throw（`HelperFailure.invalid`，永久性）。此前 `restore()`
  第一步即 throw：loopback 清扫不执行、文件不隔离；`--emergency-disarm` 在 disarm 前
  `_ = try dns.restore()` 失败即 "PF remains fail-closed"；`--emergency-reset` 依赖同一
  函数失败即回滚 launchd 注册；App 报错指引的 sudo emergency-disarm 本身就是死路——
  机器停留 PF 全阻断，唯一出口是 root 手删文件。现在 restore()/enable() 遇 invalid 级
  失败先把文件改名隔离保留（`protected-dns.json.corrupt-<ts>`，重申 root/0600；不当成
  已恢复的证据），再按「无快照但当前值可能受污染」的保守语义继续：loopback 清扫
  （127.0.0.1 → DHCP/Empty）照常执行、用户自设 resolver 不动、不凭空捏造原始值（M2
  拒绝假恢复的语义保持）；`.system` 级（lstat/open/read）瞬态失败仍 throw 交重试。
  `--emergency-disarm` / `--emergency-reset` 保持严格顺序（`dns.restore()` 失败即
  "PF remains fail-closed"，与父基一致），它们经同一 restore 事务，快照损坏时隔离后即可
  完成，不再因此回滚 launchd 注册。审查轮修正：首版曾把非 pending 的 `--emergency-disarm`
  改为 DNS 恢复失败也拆 PF，超出根因（把 `.system` 瞬态读失败也纳入放行）且与 pending
  分支不一致，按所有者决定已回退。`/dns/status` 对 invalid 级快照改报
  `ok:false, snapshotPresent:true`（`.system` 级仍报 false），App 既有门
  （`ok == true || snapshotPresent`）因此在断开与启动恢复时直接转调 /dns/restore 完成
  隔离+清扫，不再只剩 sudo 出口、也不再弹无意义的 helper 重装提示；`UpdateRuntime.observe`
  对 snapshotPresent:true 不判 `.unprotected`，更新准入只更严。
- **工程与测试**：新增一个窄 helper 自测 `runCorruptSnapshotSelfTest`（沿用
  statusResponse/restoreServices 的注入模式，restore 的快照失败决策提取为静态事务
  `restoreTransaction(snapshotResult:…)`）：喂 `.failure(HelperFailure.invalid)` 与
  settings `{"Wi-Fi":[127.0.0.1], "Custom":["8.8.4.4"]}` → 断言不再 throw、Wi-Fi 被清为
  `[]`、Custom 不动、quarantine 执行；修复前实现直接 throw，用例必失败。载体
  `--lifecycle-self-test`。审查轮在同一用例追加一条断言：`statusResponse` 对
  `.failure(HelperFailure.invalid)` 必须报 `snapshotPresent == true` 且 `ok == false`；
  修改前 status() 的 catch 固定返回 snapshotPresent:false（且 statusResponse 不接受
  失败结果），该断言必失败。另：helper 源码变更按 `build-core-helper.sh` 契约门推进
  `HelperProtocolVersion` 4.6.0 → 4.7.0；CONTRACT.sha256 以脚本同一 sed|shasum 管道
  本机重算（纯文本哈希，未编译）。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，macos-ci 运行 build-core-helper.sh 契约门与
  `sudo … --lifecycle-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得
  本轮 CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。未做实机损坏快照演练（需 root
  构造 uid/mode/截断文件）；`.system` 级瞬态读失败下 App 断开与 sudo emergency-disarm
  仍保持 fail-closed 拒绝（有意，重试可恢复）；隔离文件不随 emergency-reset 删除
  （有意保留诊断证据）；审查 nit（隔离时 chown/chmod 跟随符号链接、同秒两次隔离覆盖）
  未在本轮处理。

## 2026-09-23 · macOS 快照服务不可读时 status 折叠掉 snapshotPresent，断开被无谓拒绝

- **归属/来源**：G1 断开与恢复；macOS `tono-core-helper` 的 `/dns/status`。R3-F4
  （2026-09-22 并发/时序审查发现，对抗核实轮 V7 已确认低危）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/macos-dns-status-snapshot-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/macos-dns-status-snapshot-20260922)。
- **缺陷修复**：受保护期间快照存在但 `currentDNS(for: snapshot.service)` 抛错（服务被
  重命名/删除、`networksetup` 非零返回）时，`status()` 的 catch 把状态折叠成
  `ok:false, snapshotPresent:false` 并丢掉 service 键；App 侧
  `guard envelope.ok == true || snapshotPresent`（HelperManager.swift:726）随之失败，
  POST `/dns/restore` 从未发出——而 `restore()`/`restoreServices` 对快照服务缺失有明确
  处理本可成功。现在 `status()` 区分两种失败：loadSnapshot 失败仍报
  `snapshotPresent:false`（快照不可信，属 R3-F3 后续范围）；快照已加载但当前服务不可读
  改报 `ok:false, snapshotPresent:true` 并携带 service，读回失败信息单独携带，App 侧
  既有状态门无需改动即转调 `/dns/restore`。restore 的读回验证语义与 M2「读取错误不
  假装恢复」不变；本条只修“状态折叠导致根本不去尝试恢复”。
- **工程与测试**：按 `restoreServices` 的注入模式把状态决策提取为静态事务
  `statusResponse(snapshot:read:)`（生产 `status()` 仍用真实 loadSnapshot/currentDNS，
  行为面不变），新增 helper 自测 `runStatusUnreadableServiceSelfTest`：有效快照 +
  注入 currentDNS 抛错 → 断言 `snapshotPresent==true`、`ok==false`、service 保留；
  修复前实现报 false，用例必失败。载体 `--lifecycle-self-test`。
- **验证**：本机为编辑/审查机（2026-09-14 所有者决定），swift 编译与测试未在本机执行；
  回归委托本 PR CI（GitHub-hosted macos-26，`tooling/scripts/**` 触发 macos-ci，
  `sudo … --lifecycle-self-test`）。准确源码 SHA 与实际 CI 结果见关联 PR；提交时未获得
  本轮 CI 结果，不沿用其他分支或上一轮 main 的绿灯。
- **新增/发布/限制**：无新功能、无新包、无部署，仅源码。未做实机服务重命名演练；
  R3-F3（快照文件损坏/不安全时的隔离与产品内出口）为独立后续修复，不在本条；本条
  不改动 App 侧 guard、HelperManager 或 restore 读回验证。
## 2026-09-23 · 睡眠不再把进行中的显式 Restore internet 改写为保留保护+唤醒重连；未 armed 的 teardown 不再宣称 Kill Switch 在护机

- **归属**：G1（断开与恢复：用户明确要求的恢复直连跨睡眠保持，UI 保护状态与真实 PF
  一致）；macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-sleep-during-release-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）、
  `fix/macos-external-release-misjudge-20260922`（PR #304）、
  `fix/macos-optional-policy-reconnect-20260922`（PR #306）、
  `fix/macos-pending-network-change-20260922`（PR #309）之上，基线同后者；R1-F2，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V3 对抗核实（已确认：变体 b 确定、
  变体 a 源码推导级——需睡眠落在 release teardown 窗口内）。提交时未合 main。
- **缺陷修复**：两个根因面。
  （1）睡眠路径无视「进行中的 teardown 是显式 release」：用户点 Restore internet 后
  teardown A（release:true）可阻塞在 `repairForRelease()` 的管理员提示（最长 180 s）；
  此时合盖，`prepareForSystemSleep` 只看聚合状态（`isProtectionBlocked/isArmed` 均真）→
  置 `resumeProtectionAfterWake=true` 并入队 preserve teardown B，唤醒后
  `resumeAfterSystemWake` 再入队 C；用户应答提示后 A 完成释放（PF 打开、`isArmed=false`），
  但其 `completeDisconnect(A)` 因 requestID 已被 C 取代而被丢弃——A 的
  `isProtectionBlocked=false` 永不发布；B/C 的 `restrictToBootstrap()` 因 `!isArmed`
  空转成功却仍发布 Protected Offline（PF 已解除而 UI 报 Kill Switch blocking），唤醒
  恢复继续 `connect()`——用户的"恢复直连"被整体改写为重新保护+自动重连。修复：
  `ConnectionCoordinator` 记录 teardown 队列最新请求的 release 意图
  （`enqueueDisconnect` 置位、最新请求的 `completeDisconnect` 退役、新请求按新意图覆盖，
  与 `disconnectRequestID` 同一新者胜语义）；`prepareForSystemSleep` 检测到进行中的
  release 时不置 `resumeProtectionAfterWake`、不入队 preserve teardown（release 自己的
  `cancelReconnectTasks`/prepare 已做同等清理）；`resumeAfterSystemWake` 检测到时不建
  `wakeRecoveryTask`、不再入队 C 也不 `connect()`——release 独自收尾并经自身
  `completeDisconnect` 发布释放状态。`system_will_sleep`/`system_did_wake` 审计事件
  增加 `release_teardown_in_flight` 字段。
  （2）`restrictToBootstrap()` 的 `guard isArmed else return` 空转成功被当作"保护已保留"：
  变体 b（无睡眠也成立）——首次连接尚未完成 stage-1 arm（helper 安装提示打开，
  `isArmed=false`）时合盖，sleep 路径的 preserve teardown 中 stopCore 失败（helper 不可达
  → `coreStatus` 不可证 → `coreStopped=false`）→ 报
  "The protected core could not be stopped. Kill Switch remains active"而机器上没有任何
  PF 规则；`restrictToBootstrap` 空转 → `completeDisconnect` 置 `isProtectionBlocked=true`。
  修复：preserve 分支在 `restrictToBootstrap` 后按真实 `KillSwitchService.isArmed` 决定
  `transitionLeavesProtectionBlocked`（未 armed 的空转不再发布 Protected Offline）；
  stopCore 失败文案同按 `isArmed` 选择（未 armed 不再声称 Kill Switch remains active）。
  不放宽保护：`isArmed=true` 的一切语义不变；release 路径（含 stopCore/DNS 失败的
  不完整释放）与 `restrictToBootstrap` 抛错的 catch 仍 fail-closed 置
  `isProtectionBlocked=true`；helper 持久化状态可能存在的释放失败场景维持原有
  保守声明。本修复只消除"未 armed 却宣称已保护"的反向不一致。
- **新增/优化**：无新能力。`ConnectionCoordinator` 新增内部记录
  `disconnectQueueReleaseIntent` 与只读查询 `disconnectQueueRequestsRelease`；两个睡眠
  审计事件各增一个诊断字段。
- **工程与测试**：新增一个窄 XCTest
  `AppStateSleepTests.testSleepDuringExplicitReleaseDoesNotConvertItIntoWakeReconnect`
  （新文件 `apps/macos/TonoTests/AppStateSleepTests.swift`，文件系统同步组自动入 target）：
  fixture `isConnected=true`、`coreRuntime.isRunning=true`、`KillSwitchService.isArmed=true`，
  `repairForRelease` seam 挂在门上（显式挂起，非 sleep 轮询），断开路径全部走
  `networkProtection` seam（stopCore 置 `isRunning=false`、disarm 置 `isArmed=false`、
  restrictToBootstrap 内置"不得在 release 之上重 arm"canary）；`disconnect(release:true)`
  → 等 teardown 到达提示 → `prepareForSystemSleep()` + `resumeAfterSystemWake()`（提示
  未应答，等价合盖再唤醒）→ 断言 `resumeProtectionAfterWake==false`、
  `wakeRecoveryTask==nil` → 开门让 release 独自完成 → 断言 `isProtectionBlocked==false`、
  `KillSwitchService.isArmed==false`、`isDisconnecting==false`。当前实现（修复前）三者
  分别为 true/true/false 且唤醒恢复任务已建立，断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定与本 PR 本机限制）只编辑未编译
  未运行——未执行 `xcodebuild`/`swift build`/`swift test`/`swiftc`；Swift 语法、访问
  级别与调用链人工自查（含与 #298 armed 快照、#304 重连 loop 前提、#306 调度点、
  #309 pending 消费的共存核对）。回归委托本 PR CI（GitHub-hosted `macos-26`）；提交时
  CI 结果未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：变体 a 的实机命中率未量化（需睡眠恰落在 release teardown 窗口内，V3
  已核路径确定）；release 在 helper `PowerTransitionGate` 睡眠窗口内到 `disarm()` 会被
  拒绝并按既有 fail-closed 保留保护（用户重试 Restore internet），属既有语义非本条
  引入；唤醒恢复自身在未 armed 主机上的"Re-protecting"过渡文案、以及 helper 崩溃后
  持久化 PF 与 app `isArmed` 失同步的交互 5 场景不在本条范围（后者释放失败仍保守报
  Protected Offline）。

## 2026-09-23 · 连接中途到达的系统网络变化不再被丢弃，改为 pending 待窗口结束对账

- **归属**：G1（断开与恢复：网络切换后受保护会话及时自愈，不依赖 60 s 命令审计兜底）；
  macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-pending-network-change-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）、
  `fix/macos-external-release-misjudge-20260922`（PR #304）、
  `fix/macos-optional-policy-reconnect-20260922`（PR #306）之上，基线同后者；R1-F5，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V3 对抗核实（已确认，源码推导级；
  是 Windows W8/#259（特权服务 netmon.rs 保留 pending、窗口结束后对账）的 macOS
  平台遗漏——同族问题 Windows 已修、macOS 纯丢弃）。提交时未合 main。
- **缺陷修复**：`handleSystemNetworkChange()` 在 `isConnecting/isDisconnecting` 期间的
  入口 guard 直接 return，不留 pending。连接中途主网络服务切换（Wi-Fi→有线/热点，
  securingDNS 之后、`onCoreStarted` 之前的数秒窗口）时：`onCoreStarted` 把新拓扑固化为
  `lastPhysicalFingerprint` 基线，connected 分支的 `physicalChanged` 对此永远为 false；
  系统 DNS 已是新服务的 ISP resolver，PF 阻断其 53 端口，域名健康探测失败进入
  Recovering 循环不升级，唯一兜底是 `healthCycle.isMultiple(of:12)` 的
  primaryNetworkService 命令审计（最长约 60 s，2 s 降级 tick 下更快）才发现并重连；
  期间 fail-closed 不泄漏但无 DNS。修复：过渡期到达的网络变化置
  `pendingNetworkChangeCheck = true`（记 `network_change_held_pending` 审计）不再丢弃；
  在两个收尾点消费——`onCoreStarted` 收尾（基线已捕获）与 `completeDisconnect` 收尾
  （teardown 已 settle）：已连接走与 connected 分支完全相同的 750 ms 去抖
  `networkEnvironmentTask` 对账（primaryService/protectedDNSService、DNS 完整性、
  物理指纹；自写排除由既有指纹机制承担，任务体内的 settle 守卫等连接收尾清
  `isConnecting`）；断开收尾只清 pending 标记、不 kick。第二轮审查
  （prreview-mac-conn #309，需返工）指出首版在断开收尾无条件回放 immediate
  protected-reconnect kick：被保留的通知常是 Tono 自己的 DNS 写入（connect 的
  `enableProtectedDNS` / release 的 `restoreDNS`），回放会抬起「同一失败三次暂停」、
  清零退避，并把 disarm 失败的显式 release 自动重连（违反 I5）；每条 preserve
  teardown 已自行调度 loop 或有意暂停，release 不得重连，故断开分支不再 kick。消费
  只触发既有协调路径，不新增任何直连旁路；PF 全程 armed，不放宽保护；60 s 命令审计
  兜底原样保留。
- **新增/优化**：无新能力。配套把 connected 分支的环境对账任务体抽为共享私有函数
  `scheduleNetworkEnvironmentReconciliation()`（任务体逐字未改），新增
  `network_change_held_pending`/`pending_network_change_reconciled` 两个诊断审计事件。
- **工程与测试**：新增一个窄 XCTest
  `NetworkChangeTests.testNetworkChangeObservedWhileConnectingIsReconciledOnceConnected`
  （新文件 `apps/macos/TonoTests/NetworkChangeTests.swift`，文件系统同步组自动入 target）：
  fixture `isConnecting=true`、`protectedDNSService="Wi-Fi"`，调
  `handleSystemNetworkChange()` 断言留下 pending 标记且不建协调任务；切
  `isConnecting=false; isConnected=true` 后调 `consumePendingNetworkChange()`，断言
  `connectionCoordinator.networkEnvironmentTask != nil`（只断言调度，750 ms 去抖与
  helper 探测不在测试内运行，结束前取消任务）。当前实现（修复前）无 pending 字段、
  无任务，断言失败。第二轮在同一测试追加断开阶段：`isArmed=true`、目录一个节点
  （`isTonoReady`）、`isDisconnecting=true` 时通知入 pending，收尾消费后断言标记清除且
  `protectedReconnectTask == nil`；首版会 immediate kick 建 loop，断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定与本 PR 本机限制）只编辑未编译
  未运行——未执行 `xcodebuild`/`swift build`/`swift test`/`swiftc`；Swift 语法、访问
  级别与调用链人工自查。回归委托本 PR CI（GitHub-hosted `macos-26`）；提交时 CI 结果
  未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。第二轮修改同样本机未编译，
  委托 CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：断开/teardown 期间到达的真实环境变化（非自写）现同样只清标记：
  preserve 路径依赖其已调度的 loop 退避重试，睡眠/显式 release 不重连，与父基丢弃
  语义一致；实机 SCDynamicStore 通知与连接窗口交错的命中率未量化（V3 已核时序上界
  成立，降级路径常快于 60 s）；pending 消费只缩短发现延迟，不改变 fail-closed 语义；
  R1 审查其余发现（F2、F6）与 F5 的 Windows 侧（已由 W8/#259 修复）不在本条范围。

## 2026-09-23 · 后台可选策略替换失败后必须调度受保护重连

- **归属**：G1（断开与恢复：稳定网络上的 fail-closed 主机不滞留 Protected Offline）；
  macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-optional-policy-reconnect-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）与
  `fix/macos-external-release-misjudge-20260922`（PR #304）之上，基线同后者；R1-F4，
  出自 2026-09-22 macOS 连接生命周期并发/时序审查及 V2 对抗核实（已确认；与 F3 不同
  根因——F3 是 loop 被误判退出，F4 是 loop 根本没被调度）。提交时未合 main。
- **缺陷修复**：每次连接成功后 `onCoreStarted → scheduleBackgroundOptionalPolicy →
  applyOptionalDirectPolicyInBackground` 在共享 config-reload 句柄后执行运行时替换
  （arm → writeRuntimeConfig → helper `/core/sync` → reload → TUN 验证）；任一步抛错
  （重启后 8 s TUN 探测失败、`/core/sync` 超时等，弱网最易发生）时 catch 只做
  `disconnect(releaseKillSwitch:false)` + `errorMessage`，是全代码库唯一不调度
  `scheduleProtectedReconnect` 的 fail-closed 失败分支（对比 `reloadCoreConfig` 三个
  catch、`recoverFailedNodeSwitch`、monitor/watchdog/connect 失败路径与唤醒重试耗尽
  路径）。终态 PF bootstrap-only、`isProtectionBlocked=true`、无重连 loop；稳定网络上
  无 kick 事件，主机无限期停在 Protected Offline，仅网络抖动或用户 Retry now 能救回。
  修复：该 catch 补 `scheduleProtectedReconnect()`（非 immediate，与
  `reloadCoreConfig` 通用 catch 同形同序），loop 接管恢复；`disconnect(release:false)`
  的 fail-closed 语义与 stale-generation/cancellation 守卫原样保留，loop 从不 disarm，
  不放宽保护。调度点安全：调用点在 `onCoreStarted` 之后（`isConnected=true`），守卫在
  disconnect 之前判定 generation；loop 首次尝试先 `finishPendingDisconnect()` 排空本次
  teardown，不与进行中操作竞争；沿用 F3 修复的 armed 调度快照（本场景 PF 已 armed，
  loop 以 armed 前提调度，helper wanted=true 时正常 connect）。
- **新增/优化**：为可测性给 `AppState` 加 `optionalPolicyRuntimeMutation` seam
  （`() async throws -> Void`，默认 nil 走真实解析+特权替换，生产行为不变；同
  `tunInterfaceExists`/`networkProtection` 模式）：注入时替代解析段与运行时变更段，
  准入守卫与 catch 结构保持原位。无其他行为变化。
- **工程与测试**：新增一个窄 XCTest
  `OptionalPolicyTests.testBackgroundPolicyFailureSchedulesProtectedReconnect`：
  fixture `isConnected=true`、`KillSwitchService.isArmed=true`、含一个托管域的策略、
  抛错的 `optionalPolicyRuntimeMutation`，`NetworkProtectionOperations` 各 seam 空操作；
  调 `scheduleBackgroundOptionalPolicy()` 后等 config-reload 任务与 teardown 序列完成；
  断言 `isProtectionBlocked` 与 `errorMessage` 确证 fail-closed 终态，且
  `isProtectedReconnectScheduled == true`、`connectionCoordinator.protectedReconnectTask
  != nil`。当前实现（修复前）无任何调度，后两断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法、访问级别与调用链人工自查。回归
  委托本 PR CI（GitHub-hosted `macos-26`，`macos-ci` 由 `apps/macos/**` 路径触发）；
  提交时 CI 结果未知，不沿用任何旧 SHA 绿灯。准确受测源码为 PR head。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：失败触发为环境性（TUN 探测/`/core/sync` 超时的实机命中率未量化）；
  R1 审查其余发现（F2、F5、F6）不在本条范围；错误文案仍为内部原文（与
  `reloadCoreConfig` 的本地化文案对齐留待后续文案统一）。
## 2026-09-23 · ops hub SSH 固定主机密钥（H7-F1）

- **归属**：ops 任务（运维计划 §3 hub 部署 / 3.4 hub 任务执行器），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-ssh-hostkey-20260923`；Issue #365，
  内部审查 H7-F1；提交时未合 main。
- **缺陷修复**：`jobs.py` `ssh_exec`/`ssh_agent` 与 `collect.py` `probe_cn_agents`/
  `run_on_node_via_ssh` 四处 SSH 原为 `StrictHostKeyChecking=no` + `/dev/null` known-hosts
  后以 root 密码登录。现统一由 `collect.ssh_password_argv` 生成：`StrictHostKeyChecking=yes`、
  `UserKnownHostsFile=/opt/tono-ops/tono-collector-known-hosts`（与 `check-node-in-fleet.py`
  同一文件）、`GlobalKnownHostsFile=/dev/null`。未登记或变更的主机密钥连接失败，不自动接受。
  主机密钥未验证的大陆探针不计入封锁判定（记 `host_key_unverified`；`node_probe` 带
  `hostKeyUnverified` 计数），避免把未登记误报成「被墙」。
- **新增/优化**：`ops-panel/README.md` 写明 known-hosts 登记流程（新增/重装节点、新增探针前
  追加并与供应商控制台核对指纹）。
- **工程与测试**：`test_jobs.py` 新增一个测试 `test_node_ssh_pins_the_hub_known_hosts_file`，
  断言 `ssh_exec` argv 含严格校验与固定文件；旧代码上失败（argv 为 `StrictHostKeyChecking=no`）。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：旧代码
  26 项 1 失败（新测试），修复后 26 项 OK；另以打桩的 `subprocess.run` 手动确认主机密钥失败时
  `probe_cn_agents` 返回 None（无大陆数据）。未连接任何真实主机。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；hub 部署需 owner 执行。
- **剩余限制**：部署前必须确认 hub 上 known-hosts 已登记全部 `nodes.secrets.json` 节点与
  `mainland_probes`，否则对应节点采集/任务会 fail-closed 报错；仍使用 root 密码认证，
  改为 key 认证未在本条范围；`onboard-node.rb` 不写 hub 这份文件，需单独登记。
## 2026-09-23 · 节点上报的 public_ip 进入大陆探针前校验（H7-F2）

- **归属**：ops 任务（运维计划 §3 hub 部署 / 3.4 hub 任务执行器；采集器封锁探测），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-probe-ip-20260923`；Issue #370，内部审查 H7-F2；
  提交时未合 main。
- **缺陷修复**：`run_on_node_via_ssh` 读到的节点自报 `public_ip` 原来不做校验，`main` 和
  `collect_quality` 用它做探测目标，`probe_cn_agents` 把它拼进在大陆探针上以 root 执行的命令
  （`node_probe` 已有 `SAFE_HOST`，这两条路径没有）。现在新增 `collect.public_ip`，只接受
  `ipaddress` 能解析的公网 IPv4/IPv6 字面量，其余一律丢弃，并在三处使用：
  - 入口 `run_on_node_via_ssh`；
  - 目标选择 `probe_target`，节点自报值无效时回落到登记的 host，host 也要通过同一校验，
    两者都无效就跳过全部封锁探测；
  - 汇点 `probe_cn_agents`。

  目标改为作为 `bash -c` 的位置参数传入（`shlex.quote`），不再拼进脚本文本。
- **新增/优化**：无。
- **工程与测试**：新增 `ops-panel/tests/test_collect.py` 的一个测试：`probe_cn_agents` 收到
  非 IP 值（节点在 IP 回显失败时输出的 `unknown`）时不发起 SSH、返回 None。旧代码上失败
  （会调用 ssh）。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：
  - 旧代码：26 项中 1 项失败，即新测试；
  - 修复后：26 项全部通过。

  另外打桩手动确认合法 IP 生成 `bash -c '…$0/$1' <ip> 443`，并且 `probe_target` 对私网
  地址或主机名回落/返回 None。没有连接任何真实主机。CI 结果见 PR。
- **候选/发布**：只有源码，没有新候选；hub 部署由 owner 执行。
- **剩余限制**：如果节点在 `nodes.secrets.json` 里是用主机名而不是 IP 登记的，并且自报 IP 无效，
  这一轮就不做封锁探测（记 `no_public_ip`，显示为基线失败）。`node_probe` 仍然沿用
  `SAFE_HOST`，本条没有改动。本条和 H7-F1 的 PR 都改了 `probe_cn_agents` 的相邻行，合并时
  可能需要解决文本冲突。
## 2026-09-23 · ops 诊断/重启任务改用实际 Xray unit `tono-xray.service`（H7-F8）

- **归属**：ops 任务（运维计划 3.4 hub 任务执行器；3.1 验收单报错证据），非客户 ship gate；`ops-panel/`。
- **来源**：基线 main `e7c913e1` → 分支 `fix/ops-xray-unit-20260923`；Issue #376，内部审查 H7-F8；
  提交时未合 main。
- **缺陷修复**：
  - **原问题**：`xray_dial_errors`/`xray_error_digest` 读的是 `journalctl -u xray`，
    `xray_restart` 执行的是 `systemctl restart xray`，但部署脚本安装的都是 `tono-xray.service`。
    journal 对不存在的 unit 通常返回 0 且没有输出，任务会报 `ok matched=0`，验收单可能把它
    当作「无报错」证据。
  - **修复**：新增常量 `XRAY_UNIT = "tono-xray.service"`，三个任务都改用它。journal 任务先确认
    `LoadState=loaded`，否则以 rc=3 报 error，不再把空读当成功。
  - **审查修正（R4）**：`provision-tono-node.py` 允许每个节点自定 `serviceName`（如 `extend` 模式下的
    `xray.service`），写死 `tono-xray.service` 会把这类节点上原本可用的 `xray_restart` 改坏。现在三个任务
    都读节点记录（`nodes.secrets.json`）里的 `serviceName`，缺省才用 `tono-xray.service`；值不是
    `[A-Za-z0-9_.-]+.service`（与 provision 脚本同一规则）时直接报 error，不拼进远程 shell。
- **新增/优化**：无。
- **工程与测试**：`test_jobs.py:471` 原来把错误的 `journalctl -u xray` 写成断言，现改为
  `journalctl -u tono-xray.service`。这条就是本修复的回归测试，没有新增其他测试。在旧代码上
  它会失败（handler 返回 error，不是 ok）。审查修正后同一测试给节点记录 `serviceName: "xray.service"`，
  断言 LoadState 检查和 journal 都用这个 unit；只还原 `jobs.py`（写死 tono-xray.service）时失败
  （`'error' != 'ok'`）。缺省分支没有单独测试。
- **验证**：MacBook `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：旧代码 25 项
  1 失败，修复后 25 项 OK（审查修正后复跑 25 项 OK）。没有连接任何真实主机，也没有在节点上确认 `systemctl show -p LoadState`
  的输出。CI 结果见 PR。
- **候选/发布**：仅源码，无新候选；hub 部署需 owner 执行。
- **剩余限制**：
  - 如果某节点确实只跑旧的 `xray.service`（非 Tono 部署）而记录里没有 `serviceName`，journal 任务
    会报 error、不再报 ok，这是有意的 fail-closed；在该节点的 `nodes.secrets.json` 记录里补
    `serviceName` 即可。provision 脚本不会自动写 hub 上的这份记录，需要手工同步。
  - 历史上 `ok` 的 journal 任务行不会追溯改判。

## 2026-09-23 · 永不 armed 的内部转换不得被重连 loop 判为外部 release

- **归属**：G1（断开与恢复：用户连接意图不被静默丢弃）；macOS 客户端 `apps/macos`。
- **来源**：分支 `fix/macos-external-release-misjudge-20260922`，叠在
  `fix/macos-tun-switch-guard-20260922`（PR #298）之上，基线同该分支；R1-F3，出自
  2026-09-22 macOS 连接生命周期并发/时序审查及 V2 对抗核实（已确认；helper 未安装
  子变体因 `.unavailable` 自愈，不在本条范围）。提交时未合 main。
- **缺陷修复**：连接中途（PF 尚未 arm，如启动即点 Connect 撞上立即策略刷新）到达的
  托管流量策略更新走 `installManagedTrafficPolicy` 的 `disconnect(release:false)` +
  `scheduleProtectedReconnect(immediate:true)`；teardown 的 `restrictToBootstrap` 因
  `!isArmed` 空转，`completeDisconnect` 仍发布 `isProtectionBlocked`；重连 loop 的
  `reconcileConfirmedExternalProtectionRelease` 把 helper「无持久化 kill-switch 状态
  （wanted=false）」误判为 root 外部 release，`acceptConfirmedExternalProtectionRelease`
  取消 loop、清空错误并写假 `external_protection_release_confirmed` 审计——用户的
  Connect 意图静默消失，终态 idle 无错误无重试。同一入口：唤醒重试耗尽后的
  `scheduleProtectedReconnect()`（`AppState.swift` wake 路径）在同样 never-armed 状态
  同样静默退出。修复：`scheduleProtectedReconnect` 在调度时快照
  `KillSwitchService.isArmed`，loop 每次 attempt 以「调度时快照 || attempt 时实时
  `isArmed`」作为 external-release 确认的前提
  （`reconcileConfirmedExternalProtectionRelease(protectionWasArmed:)` 前置守卫），
  never-armed 的内部转换不再冒充外部 release，loop 继续重连。第二轮审查
  （prreview-mac-conn #304）指出仅用调度时快照会过期：同一 loop 内某次 attempt 已
  arm 后失败（preserve teardown + 去抖，loop 继续、快照仍 false），退避期内真正的
  root 紧急 disarm 会被 loop 无视并由 connect 重新 arm；现改为 attempt 时求值，
  app 认为 PF armed 时 helper 认证回答 wanted=false 仍被接受并退出；激活路径
  `reconcileExternalProtectionState()` 走默认参数，行为不变；loop 从不 disarm，不放宽
  保护。
- **新增/优化**：`NetworkProtectionOperations` 增加 `refreshKillSwitchStatus` seam
  （默认真实 `PrivilegedRuntimeCoordinator.refreshKillSwitchStatus`，生产行为不变），
  `reconcileConfirmedExternalProtectionRelease` 改经 seam 调用以便测试注入状态 IPC。
- **工程与测试**：新增一个窄 XCTest
  `ProtectedReconnectTests.testInternalTransitionReconnectDoesNotTreatNeverArmedHelperAsExternalRelease`：
  fixture `isConnecting` + `isArmed=false` + 一个可被选中但过不了 owned-node 校验的
  目录节点（使 loop 的 connect 尝试在任何特权 helper/core 操作之前快速失败，其
  pre-arm release teardown 按既有设计结束 loop），`refreshKillSwitchStatus` seam 返回
  `.confirmed(requiresProtectionRecovery:false)`，其余 seam 空操作；执行
  `disconnect(releaseKillSwitch:false)` + `scheduleProtectedReconnect(immediate:true)` 并
  等 loop 结束；断言 `lastConnectionFailure` 与 `errorMessage` 非空——即一次真实 connect
  尝试已发生且其失败文案留存。当前实现 loop 静默退出、两值为 nil，断言失败。
  第二轮在同一测试追加过期快照阶段：同样以 `isArmed=false` 调度 loop 后、首个
  attempt 运行前置 `isArmed=true`（模拟本 loop 先前 attempt 已 arm 后失败），seam
  仍回答 wanted=false；断言 release 被接受（`isArmed`/`isProtectionBlocked` 为
  false、`lastConnectionFailure`/`errorMessage` 为 nil、loop 结束）。仅用快照的上一
  版会跳过确认直接 connect，留下失败记录，断言失败（loop 等待以 10 s 看门狗封顶，
  不会挂死 CI）。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法、访问级别与调用链人工自查。回归
  委托本 PR CI（GitHub-hosted `macos-26`）；提交时 CI 结果未知，不沿用任何旧 SHA 绿灯。
  准确受测源码为 PR head。第二轮修改同样本机未编译，委托 CI。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：F2（睡眠改写显式 release / never-armed 的 Protected Offline 误报）与
  F4（后台可选策略失败漏调度重连）为不同根因（V2 判定），另行修复不在本条；替换窗口
  与外部 release 的实机量化未做。
## 2026-09-23 · exit-agent 吊销执行先于计量检查、逐个删除（H7-F6）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-revoke-first-20260923`（提交时未合 main）；内部审查 H7-F6，Issue #388。
- **缺陷修复**：状态文件损坏、durable source 不匹配、缺 stats 命令、队列 observedAt 超前等与吊销无关的检查原先都在应用 roster 之前，任一失败本轮 Xray 与 hy2 都不删用户；`reconcile` 首个 rmu 失败即中止后续删除；roster 超过 512 KiB 被截断后每轮 JSON 解析失败。现在：roster 的 nodeId 与配置的 source 一致（吊销唯一依赖的检查）后立即更新 hy2 并 reconcile Xray，计量相关检查放到之后，仍拒绝本轮、不 ack；删除与添加逐个尝试、最后汇总报错；roster 读取上限提到 8 MiB，超限显式 Refusal 且不应用任何变更（截断前缀无法证明谁缺席，因此不据此删除）；非 JSON roster 转为 Refusal。审查修正（R4）：state 是合法 JSON 但不是 object（`[]`/`null`）或 `installedClients` 含非字符串时，`load_state` 在吊销前就报 Refusal（原先 `AttributeError`/`TypeError` 让本轮在删除任何客户端之前崩溃），按"state 不可用"处理：照常吊销，之后拒绝本轮、不 ack；该文件原样保留、不读取也不覆盖（原地隔离）。没有把它改名移走：下一轮会从空 totals 重新计量，少计重启前的用量。
- **新增/优化**：`require_commands` 把 stats 命令改为可选，缺失时在 reconcile 之后拒绝（不再挡住吊销）。
- **工程与测试**：一个 unittest（队列中有超前 observedAt 的报告 + 记录清单两个待删 label、首个 rmu 失败 → hy2 仍更新、两个 label 都尝试删除、Refusal 且不 ack），在修复前代码上实际跑红。既有 `test_a_queued_future_timestamp_is_not_dropped_on_replay` 原断言 "reconcile 未调用" 固化的正是本缺陷，改为断言 reconcile 已执行，其余断言（报告不投递、状态不变）不变。审查修正新增一个窄测试 `test_a_state_file_that_is_not_an_object_still_lets_revocation_run`（state 为 `[]`、listing 有 `u:gone` → 仍 rmu、Refusal、不 ack、文件不变；只还原 `reconcile_and_report.py` 时报 `AttributeError: 'list' object has no attribute 'get'`）。
- **验证**：MacBook 本机 `python3 -m unittest test_reconcile_and_report`（83 通过；审查修正后 `python3 test_reconcile_and_report.py` 84 通过）。未连接真实节点。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：hy2 发布失败仍会阻止本轮 Xray reconcile（既有行为与测试，未改）；roster 超过 8 MiB 仍需控制面分页。state 损坏时计量一直拒绝，直到运维修复或移走该文件（移走会从空 totals 重新计量）。
## 2026-09-23 · 停用/退役的出口节点必须撤下全部客户端（H7-F4）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/control-plane`、`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-node-disabled-20260923`（提交时未合 main）；内部审查 H7-F4，Issue #371。
- **缺陷修复**：节点被 PATCH 为 disabled 或经退役流程 `revokeExitToken`（同时轮换 token）后，Worker 对其 token 返回与未知 token 相同的 401，exit-agent 直接退出，不删 client、不更新 hy2，最后一份 roster 中的身份（含之后被吊销/过期/超额的）在该节点持续可用且不计量。现在：属于 disabled 节点的 token（含退役前被轮换掉的旧 token，存于新列 `revoked_token_hash`，只用于应答、不认证任何请求）得到 `403 EXIT_NODE_DISABLED`；未知 token 仍 401。exit-agent 只在收到这个确切的 403 body 时移除所有 `u:` client 与 `shared-legacy`、清空 hy2 allowlist、记录并以非零退出；普通 401/403、边缘拦截页、5xx 与网络错误维持原行为（保留 roster、下轮重试）。
- **新增/优化**：migration `0081_exit_node_revoked_token.sql`（新增可空列，不改旧 migration）。手工添加的非 `u:` client 仍不动；节点无法列出也无记录的 client 清单时只能删 `shared-legacy`，退出信息提示运维停掉 `tono-xray`。
- **工程与测试**：Worker 一个 `it`（disabled 与 retired 节点 token 得 403 `EXIT_NODE_DISABLED`，未知 token 仍 401）；exit-agent 一个 unittest（403 HTML 页不删任何 client；403 `EXIT_NODE_DISABLED` 删 `u:` 与 `shared-legacy`、保留手工 client、不 ack）。两者在修复前的代码上均实际跑红。
- **验证**：MacBook 本机 `npx vitest run`（control-plane 全量 43 文件 892 通过）、`npm run typecheck`（首轮 CI 因测试中 `env` 未转 `Env` 类型检查失败，已修正）；`python3 -m unittest test_reconcile_and_report`（83 通过）。未连接任何真实节点，未部署，migration 未在远端 D1 执行。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：需部署 Worker 并执行 migration 后才生效；已在运行的旧 agent 需更新后才会响应该信号。退役前已被轮换且未经本改动记录旧 hash 的节点（改动部署前退役的）仍只得到 401，需人工停掉其 `tono-xray`。Xray 移除 client 不保证断开已建立的连接。
## 2026-09-23 · shared-legacy 退役持久化到 Xray 静态配置（H7-F5）

- **归属**：ops 控制面 / 出口节点吊销执行；`services/exit-agent`。
- **来源**：基线 main def3dd79 → 分支 `fix/exit-agent-legacy-persist-20260923`（提交时未合 main）；内部审查 H7-F5，Issue #382。
- **缺陷修复**：(a) `retireSharedLegacy` 只经 API 从运行中的 Xray 删除 `shared-legacy`，它仍在 `config.json`，Xray 每次重启复活；现在退役时同时从静态配置删除（同目录临时文件、保留属主/权限、`xray run -test` 通过后原子 rename 并 fsync 目录），每轮检查，失败则本轮最终 Refusal（见下）。(b) 拿不到 live 用户列表、只能用记录清单时（退役后记录中已无它）不再跳过：退役态下总是对 `shared-legacy` 执行 rmu（"not found" 视为成功），不改变其他 client 的"清单未知不删"规则。(c) `TONO_RETIRE_SHARED_LEGACY` 大小写不敏感，接受 `1/true/yes/on`、`0/false/no/off`（原先 `True` 等被当成 false）。审查修正（R4）：其他值告警并**保持现状**（本轮不退役）——退役持久化后是单向的，`false` 撤不回，回滚时拼错不能触发它。静态配置写入失败不再挡 roster ACK 与用量上报：失败先告警，本轮在计量完成后才以 Refusal 退出（超额吊销依赖用量上报）。
- **新增/优化**：新环境变量 `TONO_XRAY_CONFIG`（默认 `/opt/tono-xray/current/config.json`），README 与 env 示例同步。
- **工程与测试**：一个 unittest（override=`True`、无 list 能力、记录清单不含 shared-legacy、服务端信号为 false → 仍 rmu `shared-legacy` 且 config.json 中只剩手工 client），在修复前代码上实际跑红；既有 `RosterControlSignals` 测试夹具补一行 patch 持久化函数。审查修正新增两个窄测试（同一夹具加 `persist_error` 参数）：`test_an_unrecognized_override_leaves_shared_legacy_in_place`（`flase` → 不退役；旧实现 `True is not false`）、`test_a_failed_retirement_write_still_meters_before_refusing`（持久化抛 Refusal 时仍 ack roster 与 metering、state 已保存、最终仍 Refusal；旧实现 `acknowledge_roster` 调用 0 次）。两者只还原 `reconcile_and_report.py` 时均失败。
- **验证**：MacBook 本机 `python3 -m unittest test_reconcile_and_report`（83 通过；审查修正后 `python3 test_reconcile_and_report.py` 85 通过）。未连接真实节点，未在真实 Xray 上验证空 clients 的 vless inbound 能否通过 `run -test`（不通过时 agent 不写入、告警，本轮在计量后以非零退出；计量不停）。
- **候选/发布**：仅源码，无新候选。
- **剩余限制**：agent 运行用户需对 release 目录可写；只跑 `--hy2-roster-only` 或未配置 exit_nodes/agent 的节点仍不会退役 Xray 上的 shared-legacy，`device_only` 就绪门看不到这些节点（未在本 PR 处理）。退役后重跑 `enable-tono-exit-metering.sh` 会因 vless 无 client 而拒绝。退役对每台节点是单向的，恢复需 `.pre-metering` 备份或重新配置。
## 2026-09-23 · 出口节点质量工具按摘要固定，去掉第三方镜像兜底（H7-F3）

- **归属**：ops 任务（采集器 / 运维面供应链）；`ops-panel/collect.py`，不影响客户端和 Worker。
- **来源**：基线 main → 分支 `fix/node-diag-tools-20260923`；Issue #364；关联 PR，提交时未合 main；内部审查 H7-F3（源码推导）。
- **缺陷修复**：质量采集在每台出口节点上以 root 下载并执行 `securityCheck`、`backtrace`，来源是可变 release tag `output`，GitHub 失败时回退第三方 CDN 镜像，不校验摘要；节点上已存在的文件以后每轮直接信任。现在两个工具各固定一个 sha256（记在 `collect.py`），`backtrace` 改用版本化的 `v0.0.21`；`securityCheck` 上游只发布 `output` tag，以摘要为固定点。下载只走 HTTPS，校验通过才赋可执行权限；每轮都重新校验节点上已有的文件，不符就删除并按 missing 上报；删除镜像兜底。securityCheck 缺失（下载失败或摘要不符）时 `parse_quality` 报 `quality: "unknown"`，不再报 `ok`（审查 R4：上游一换 `output` 资产，全舰队会永久显示 ok）。
- **新增/优化**：无。工具仍然需要：`parse_quality` 用其输出生成节点质量、风险/线路关键词，供 Komari 标签、report.json、控制面快照和 ops console 节点抽屉使用。
- **工程与测试**：新增一个窄测试 `ops-panel/tests/test_collect.py::test_node_tools_are_digest_pinned_and_github_only`（旧代码上第三个 `dl` 参数是 CDN 地址而不是摘要，断言失败）；审查后同一测试让假 SSH 输出 `missing` 并断言 `quality == "unknown"`（只还原 `collect.py` 时失败：`'ok' != 'unknown'`）。
- **验证**：MacBook 本机 `python3 -m unittest discover -s ops-panel/tests -p 'test_*.py'`：修复前新测试失败，修复后 26 项通过（审查修正后复跑仍 26 项通过）。两个固定摘要由本机下载同一 URL 后 `shasum -a 256` 复核，与 GitHub release asset digest 一致（未执行二进制）。用本机 shim 演练 `dl()`：摘要相符安装、不符删除并返回 1、篡改后的已有文件被替换。未连接任何节点，未在 Linux 节点上运行远程脚本。
- **候选/发布**：无新包，仅源码；hub 上的 `collect.py` 需按 README 手工部署后生效。
- **剩余限制**：工具仍以 root 在节点上运行（固定摘要后的上游构建）；以低权限/沙箱运行、由 hub 分发（依赖 H7-F1 SSH 主机密钥校验）是后续项。上游更新 `output` 资产后，`securityCheck` 会显示 missing、质量为 unknown，直到有人审查并更新摘要；2026-09-23 核对上游 `oneclickvirt/securityCheck` 只有 `output` 一个 release/tag，没有可固定的版本，所以摘要仍是唯一固定点。

## 2026-09-23 · Windows 安装包移除未固定的第三方 enableLoopback.exe（内部审查 H5-F3）

- **归属**：Windows 发布载荷加固；`apps/windows/app`（prebuild、打包白名单、NSIS 模板）+ Windows CI。
- **来源**：基线 main `498ed426` → 分支 `fix/drop-unpinned-loopback-exe-20260923`；Issue #372；
  提交时未合 main。
- **缺陷修复**：`prebuild.mjs` 从第三方仓库可变 `latest` release 下载 `enableLoopback.exe`，
  无 tag 固定、无摘要校验，并经 `tauri.conf.json` 资源白名单打进 Tono 签名安装包；App、
  Service、crates 均无调用点 → 删除下载任务、`tauri.conf.json` 资源项、
  `WINDOWS_RESOURCE_ALLOWLIST` 项及 Windows CI 的占位文件；把
  `resources/enableLoopback.exe` 加入 `KNOWN_LEGACY_WINDOWS_PAYLOAD`，NSIS
  `RemoveKnownLegacyPayload` 在升级安装与卸载时删除旧版本留下的副本。未使用的
  `openUwpTool` i18n 文案未动。
- **新增/优化**：无。
- **工程与测试**：`windows-packaging.test.mjs` 新增一个 test：资源白名单中的 `.exe`
  只能是本仓库构建的 `tono-service*`；旧白名单上失败。
- **验证**：MacBook 本机 `node --test scripts/windows-packaging.test.mjs
  scripts/prepare-updater-config.test.mjs` 28/28 通过（修复前新增项失败）；
  `node --check scripts/prebuild.mjs`。未运行 Tauri/NSIS 构建（执行位置规则），由本 PR 的
  Windows CI 覆盖 `cargo test`（占位资源已同步删除）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：已装客户端里的旧副本只在下一次 NSIS 安装/升级或卸载时删除；Service
  驱动的私有解包更新路径不执行该宏。

## 2026-09-23 · Windows webview 只授予前端实际使用的 core 控制命令

- **归属**：G2（保护不得放宽）；Windows App `apps/windows/app`（Tauri capability）。
- **来源**：基线 main `def3dd79` → 分支 `fix/webview-mihomo-acl-20260923`；Issue #378；
  内部审查 H6-F1（源码推导）；提交时未合 main。
- **缺陷修复**：`capabilities/desktop.json` 原先把 `tono-plugin-core:default` 整体授予
  `main`/`tray-flyout` webview，其中包括改 controller 地址/secret、patch/reload 配置、
  重启、升级 core/UI/geo、更新 provider。连接后插件指向 SYSTEM core 的带 secret
  controller，所以 renderer 可以在运行期改写 core 配置，这条路径不经过 Service。
  现在只授予前端实际调用的六项：`ws_traffic`、`ws_connections`、`ws_disconnect`、
  `clear_all_ws_connections`、`delay_proxy_by_name`、`healthcheck_node_in_provider`
  （以 grep `apps/windows/app/src` 全部 `tono-plugin-core-api` 导入为准）。Rust 侧通过
  `MihomoExt` 直接访问，不受 webview ACL 影响。
- **新增/优化**：无。
- **工程与测试**：新增一个 `#[test]`
  `src-tauri/tests/webview_capabilities.rs::webview_capabilities_grant_only_the_core_commands_the_frontend_uses`，
  扫描 `capabilities/*.json`，断言授予的插件权限是上述白名单的子集。旧代码因为授予了
  `tono-plugin-core:default` 会失败。`scripts/windows-packaging.test.mjs` 里 ACL 命名空间
  断言原来要求 `:default`，改为要求该命名空间下至少有一项 `allow-*` 授权。这是 fixture
  修正，原意不变。
- **验证**：编辑机（MacBook）未执行原生 `cargo test`。用 Python 按相同逻辑对 main 与本分支的
  capability 做镜像检查：main 上 FAIL（`tono-plugin-core:default`），本分支 PASS。
  `node --test --test-name-pattern "Core plugin" scripts/windows-packaging.test.mjs` 4/4 通过。
  `rustfmt --check` 通过。Rust 回归委托本 PR CI（`windows-ci` / `windows-2025` 的
  "Test the Tauri crate"）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：core 的 controller 本身仍接受 `PUT/PATCH /configs`、`/restart`、升级和
  provider 更新（持 secret 的同用户进程仍可调用）；在 Tono core 补丁里禁用这些接口，以及
  Service 在运行期核对配置，都记录在 #378 作为后续。未做实机验证。

## 2026-09-23 · 安装器从仅管理员可写位置执行 VC++/WebView2 安装程序（内部审查 H5-F4）

- **归属**：Windows 手动安装路径加固；`apps/windows/app/src-tauri/packages/windows/installer.nsi`。
- **来源**：基线 main `498ed426` → 分支 `fix/installer-admin-only-setup-files-20260923`；
  Issue #383；提交时未合 main。
- **缺陷修复**：提权安装器把 VC++ Redistributable 与 WebView2 bootstrapper 写到当前用户
  `%TEMP%` 后直接 `ExecWait`，同用户未提权进程可在写入与执行之间替换 → 新宏
  `TonoAdminOnlySetupFile` 用 `GetTempFileName` 在 `$WINDIR\Temp` 新建文件（继承 ACL
  不给普通用户任何访问），同目录改名为 `.exe`（保留 ACL，目标已存在则失败），下载/释放
  到该文件后执行并删除。拿不到该文件时：VC++ 跳过（与原下载失败同为记录后继续），
  WebView2 中止（与原下载失败一致）。SYSTEM 私有解包路径不经过这两个 Section，未改。
- **新增/优化**：无。未加 Authenticode 校验（文件已不可被普通用户替换）。
- **工程与测试**：`windows-packaging.test.mjs` 新增一个 test：模板中不得有下载/释放到
  `$TEMP\` 或从 `$TEMP\` `ExecWait`；旧模板上失败。
- **验证**：MacBook 本机 `node --test scripts/windows-packaging.test.mjs` 23/23 通过（修复前
  新增项失败）。本机无 makensis，未编译 NSIS；PR CI 不构建安装包；未在设备上安装。
  需所有者在下一次 Windows 候选构建（NSIS 编译）和一次缺 VC++/WebView2 的干净 Windows 11
  手动安装中确认。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：依赖 `C:\Windows\Temp` 的默认 ACL；`.onInit` 在 `$PLUGINSDIR`（同样位于用户
  `%TEMP%`）执行随包的 `tono-service-install.exe --manual-update-gate`，不在本项范围，另行核实。

## 2026-09-23 · Windows 支持页「WebRTC 检查」按钮打不开页面

- **归属**：G1（功能可用）；Windows App `apps/windows/app`（Support 页、Tauri capability）。
- **来源**：基线 main `def3dd79` → 分支 `fix/webrtc-check-open-20260923`；Issue #386；
  内部审查 H6 C 节（功能缺陷，非安全发现）；提交时未合 main。
- **缺陷修复**：`support.tsx` 用 `plugin-shell open` 打开 `https://ip.cx/webrtc`，但 Windows
  启用的 capability 都没有授予 `shell:allow-open`。结果是调用在运行时被拒，并误报
  「复制失败」。现在 `desktop-capability` 授予 `shell:allow-open`，同时在 `tauri.conf.json`
  设置 `plugins.shell.open = "https://ip\.cx/webrtc"`（插件会把它锚定为 `^...$`），只放行这个
  固定 URL，不启用插件默认的 http(s)/mailto/tel 全放行。失败时改为显示新的
  `tono.support.webrtc.openFailed` 提示（中/英）。
- **新增/优化**：无。
- **工程与测试**：在 `scripts/windows-packaging.test.mjs` 新增一个 node test，断言以下三点：
  支持页唯一的 `openUrl` 字面量是该 URL；desktop capability 授予 `shell:allow-open`；
  配置的 open 正则接受该 URL、拒绝其他 URL。重新生成了 i18n 类型文件。
- **验证**（MacBook，本分支工作区）：
  - 该 node test 在还原 capability/配置后失败（缺 `shell:allow-open`），修复后通过。
  - `pnpm test:dev-control` 99/99 通过。
  - `vitest run src/pages/tono/support.test.tsx` 16/16 通过。
  - `tsc --noEmit` 通过，`eslint support.tsx` 通过。
  - 未执行 Tauri 构建。未实机点击。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：设置页旧 `update-viewer.tsx` 的 GitHub release 链接仍不在 open 范围内，行为与
  修复前一样被拒；它不在 Tono 产品更新路径上，本 PR 不放宽。打包后的 WebView2 打开外部浏览器
  尚未实机确认。

## 2026-09-23 · coreMonitor 不得把运行时替换的瞬时 utun 消失判为 TUN 死亡

- **归属**：G1（已连接=能用：切换/热重载不掉线）；macOS 客户端 `apps/macos`。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/macos-tun-switch-guard-20260922`（关联 PR，提交时未合 main）；
  R1-F1，出自 2026-09-22 macOS 连接生命周期并发/时序审查及对抗核实轮（已确认）。
- **缺陷修复**：切节点（`switchingNodeId`）/配置热重载（`configReloadTask`）/连接成功后的
  后台可选策略（同 `configReloadTask` 句柄）都经 helper `/core/sync` 以 stop+start 重启
  sing-box，utun199 消失 0.2–1.5 s 且 PF 全程 armed；`startCoreMonitor` 的 utun 存在性分支
  只做单次 `if_nametoindex` 判定（同循环 reassert/探测分支均有同款任务抑制，唯此分支
  没有），把正常替换窗口判为 "Protected TUN stopped"，fail-closed 断开+重连，表现为
  “连上/切换后几秒又掉线重连”。现在该分支：替换任务在飞时本 tick 不判死（与既有
  reassert 分支同款抑制）；且要求缺失连续两个 tick（`tunMissingVerdictTicks = 2`）才判死。
  真 TUN 死亡仍 fail-closed 断开，最多延迟一个 tick（2–5 s）确认，判定只延迟、不跳过；
  PF/Kill Switch 语义不变。
- **新增/优化**：为可测性给 `AppState` 加 `tunInterfaceExists` I/O seam（默认真实
  `KillSwitchService.interfaceExists`，生产行为不变），monitor 单次迭代从循环抽为
  `runCoreMonitorTick(state:)`（`CoreMonitorState`/`CoreMonitorTickOutcome` 承载跨 tick
  状态，循环只负责睡眠与退出）。无其他行为变化。
- **工程与测试**：新增一个窄 XCTest
  `AppStateCoreMonitorTests.testMonitorHoldsMissingTUNVerdictWhileRuntimeReplacementIsInFlight`
  （fixture：isConnected + `configReloadTask` 挂起任务 + `tunInterfaceExists=false` → 一次
  tick 不断开；清掉任务再 tick → 此时才进入断开）。XCTest 无法驱动真实特权 helper，
  seam 与 tick 抽取即为此设计；加 seam 但去掉守卫的旧实现会在第一段断言失败。
- **验证**：编辑机（MacBook，按 2026-09-14 执行位置决定）只编辑未编译未运行——未执行
  `xcodebuild`/`swift build`/`swift test`；Swift 语法与访问级别人工自查（结构迁移为纯代码
  搬移 + 控制流映射，未跑机器检查）。回归委托本 PR CI（GitHub-hosted `macos-26`，
  `macos-ci` 由 `apps/macos/**` 路径触发）；提交时 CI 结果未知，不沿用任何旧 SHA 的
  绿灯。准确受测源码为 PR head（基线 576d7087 之上的本分支提交）。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：替换窗口命中概率的实机量化未做；R1 审查其余发现（F2–F6）不在本条范围；
  真 TUN 死亡的判定延迟一个 tick 属本修复的有意权衡。
## 2026-09-23 · Windows 升级事务中断后无终态/误回滚的结构修复（F1/F4/F6）

- **归属**：G3 受保护升级中断恢复；Windows Service 更新事务
  （`apps/windows/service` 独立 workspace）+ 协议文档。
- **来源**：基线 main `576d7087` → 分支 `fix/windows-update-txn-recovery-20260922`；
  PR #301；提交时未合 main。
- **缺陷修复**（2026-09-22 并发/时序审查 + 对抗核实轮确认三项同根因：事务全部权威
  出口以精确进程 incarnation 为钥匙、唯一非 commit 终态只对 Install 前发起进程开放）：
  - **F1**（权限绑定单一 App incarnation）：Disconnect/退休 peer 谓词从 pid+started_at
    精确相等改为「owner 匹配 + 注册安装根路径 + 当前摘要为 old/target App 组件」；
    新增 `retire_rolled_back` 归档终态（已验证 Disconnect 且安装身份等于保留原件）。
    触发序：Prepare 持久化后发起 App 退出/执行器回滚（已终止发起进程）→ 重开 App 的
    全部出口被拒。
  - **F4**（successor 单 incarnation + 恢复一律回滚）：`classify_recovery` 三分支按
    「durable plan 是否存在 + 已装组件是否等于 signed target」判定；已等于 target 不
    回滚——successor 未登记的事务由恢复提升为 Replaced，首个 target 身份 App 经
    `authenticate_successor` 重绑收养；`service.start`/`wait_for_service_ready` 失败
    不再经 `SuspendedApp::drop` 终止已登记 successor。触发序：提交前退出新 App 或
    重启机 → 完整已校验安装被撤销且落入 F1。
  - **F6**（Launching 静默终态）：执行器 incarnation 空/死 ⇒ 消费可判定不可能 →
    `retire_unconsumed` 接受 Launching；`reconcile_before_desired` 将该状态置回
    Staged（同一发起 App 可再 launch，或经 Disconnect 退休），不二次授权执行。
- **新增/优化**：UPDATE_PROTOCOL_V1.md 新增「Interrupted-transaction recovery and
  terminal states (2026-09-22 clarification)」小节，只澄清不改变旧条款；U1 单次消费、
  U3 高水位不回退、U4 Disconnect 不伪造提交全部保持（退休只在证明未消费或已验证
  回滚到 old 时发生）。
- **工程与测试**：新增 4 个窄回归——`update_fresh_registered_app_incarnation_can_disconnect_and_retire_unconsumed_attempt`、
  `update_app_started_after_replacement_with_target_identity_is_an_adoptable_successor`、
  `update_launching_without_live_executor_incarnation_is_retirable_after_verified_disconnect`
  （以上在 update_transaction.rs，前三个在旧实现第一处 unwrap 必失败）与
  `update_recovery_classifies_publication_by_installed_identity_not_successor_liveness`
  （update_executor.rs 恢复判定纯函数）。既有
  `update_explicit_disconnect_archives_only_proven_unconsumed_attempts` 中「同注册路径、
  started_at+1 被拒」的断言改为异路径身份拒绝——原断言正是 F1 过度收紧的正面描述。
- **验证**：本机未运行任何 cargo（所有者 2026-09-14 执行位置决定，MacBook 只做
  编辑/审查）；全部委托本 PR 的 GitHub-hosted `windows-2025` Service lane：
  `cargo test --locked --features standalone,client,test` 及既有
  `update_transaction::tests::update_` / `core::update::tests::update_` /
  `update_executor::tests::update_` 定向枚举步。提交时未获得原生结果，不沿用上一轮
  main 的绿灯，也不声称未测代码已验证。
- **候选/发布**：无新包，仅源码。
- **版本生效边界**：升级时运行的 `executor.exe` 是 Prepare 时从**已安装旧版**
  `resources/tono-service-install.exe` 复制的，`--update-recover`/ONSTART 任务与发布前
  全部 Service 侧检查也由已装旧版 Service 执行。因此本 PR 对从 0.0.73（及任何不含本
  修复的版本）出发的首跳升级**不生效**（F4 恢复判定、F6 reconcile、F1 发布前半段均不
  适用），**不构成 G3 证据**；它保护的是从含本修复的版本出发的下一跳升级。
- **剩余限制**：
  - **未解决的独立问题（已存在，非本 PR 引入）**：Replaced 且已验证 Disconnect 仍永久
    pending、产品内无出口——连接、Adopt/Commit、再更新、Quit/登出释放、卸载/重装全部被
    拒（网络已释放，不泄漏流量）。这是可达性最高的产品锁死路径：升级后自动重连失败 →
    用户点 Restore internet 即触发。需单独设计「已安装+已释放」归档终态（不能把释放当
    commit，备份清理归属需明确），另立待办。
  - **跟进项（安装完整性缺口，无保护绕过）**：恢复判定（`classify_recovery`
    TargetVerified）与 `retire_rolled_back` 以三组件（Tono.exe / tono-core.exe /
    tono-service.exe）摘要代替整份 durable plan（整棵 payload 树 + `core-sha256.txt`，
    逐成员 `old_digest/new_digest`）成员校验；发布在二进制之后、后续成员之前中断，或
    回滚恢复了二进制而未恢复某资源时，会被判为全部发布/全部回滚。修法是逐成员校验。
  - 非 Windows 平台的 incarnation 探测编译为恒「已死」，只影响开发编译路径（该
    crate 测试仅在 windows-2025 lane 执行）；Windows 11 实机升级中断验收仍属 G3 未闭合
    证据。
- **剩余限制**：Replaced 且已验证 Disconnect（用户显式拒绝一个已完成安装）仍保持
  pending（不回滚也不退休），需后续单独判定；非 Windows 平台的 incarnation 探测编译
  为恒「已死」，只影响开发编译路径（该 crate 测试仅在 windows-2025 lane 执行）；
  Windows 11 实机升级中断验收仍属 G3 未闭合证据。
## 2026-09-23 · Windows PrepareCoreStart 绑定当前 release epoch（R2-F6）

- **归属**：G1 连接生命周期（I1：旧 attempt 的迟到 Service 副作用不得影响新会话）；
  平台/模块：Windows Service IPC 协议（`apps/windows/service`，App 侧无代码改动，
  客户端逻辑在 `tono-service-protocol` 内）。
- **来源**：基线 main 576d7087 → 分支 `fix/windows-prepare-start-freshness-20260922`；
  PR 与准确源码 SHA 见续记，提交本条时未合 main。
- **缺陷修复（R2-F6，源码确认 + 需实机级）**：被取消 attempt 的
  `POST /clash/prepare-start` 迟到数秒到达时，该路由只有 `Unchecked` owner 门、
  无会话/epoch 新鲜度令牌（对照 Lock/MarkVerified/Stop 均有会话门），且
  `is_protected_startup_replacement_candidate` 对后继连接未验证的 Core 为假，
  `prepare_start(false)` 会停掉后继受监督 Core，表现为一次莫名连接失败
  （fail-closed，不泄漏）。修复：协议 revision 17 起，客户端在发出该破坏性请求前
  经 `GET /version` 快照 Service 的 `RELEASE_EPOCH`（复用 StartClash 已有 epoch
  机制，不引入新令牌类型）并在请求内携带；Service 在 `OWNER_LIFECYCLE_LOCK`
  内比较，epoch 不等于当前 → 以新错误码 `StaleReleaseEpoch`(1013, HTTP 409)
  拒绝，拒绝发生在任何快照/操作发布/Core 停止之前，无半停止状态。合法路径
  （App 存活、期间无显式 release）行为不变。兼容：新旧混合配对时——新 App +
  旧 Service（<rev 17）由能力探测降级发送旧 `null` payload，行为同旧版；
  旧 App + 新 Service 的无 epoch 请求**被接受**，由 Service 在请求到达时自取 epoch
  快照、在锁内比较（与 StartClash 的到达时快照相同）。
- **审查修正（第二轮）**：初版对旧 App 的 `null` 请求一律 409，结果探测判定配对
  可用，之后每次连接都在 prepare 阶段永久失败，违反 `lib.rs` "Reject a
  mismatch at the protocol probe" 规则。没有把 `MIN_SUPPORTED_CLIENT_REVISION`
  提到 17：探测门 `require_protocol_version`（`server/mod.rs` 686-700，经
  `authenticate_request` 741 行）同样挡在 `ReleaseKillSwitch`/`StopClash`/
  `RestoreProtectedDns` 前面，提到 17 会让与新 Service 短暂共存的旧 App 无法
  释放 WFP、无法恢复 DNS。改为对 Legacy 采用到达时快照，旧 App 行为不比
  rev 16 差。
- **新增/优化**：`ProtocolInfo` 增加 `release_epoch`（`#[serde(default)]`，
  仅服务端 GetVersion 路由填充）；`PrepareCoreStartPayload` 采用与
  `StopClashPayload` 相同的 untagged `Legacy/Freshness` 线型。
- **工程与测试**：新增一个 Service 集成回归
  `late_prepare_core_start_superseded_by_release_cannot_stop_the_successor_core`
  （`tests/test_owner_lifecycle.rs`）：快照 epoch → 显式 release（真实 bump）→
  后继 StartClash（Core 未验证）→ 用旧 epoch 发 PrepareCoreStart → 断言返回
  `StaleReleaseEpoch` 且 `core_pid` 不变；若门被移除，后继 PID 断言失败。
- **验证**：本机（MacBook）按所有者 2026-09-14 决定只做编辑与源码自查，
  未运行 `cargo build/test/check/clippy`；回归委托本 PR CI 的 GitHub-hosted
  `windows-2025`（`cargo test --locked --features standalone,client,test`），
  结果以该 run 的实际 checkout 为准，不预支。R2-F6 的实机触发窗口
  （数秒级 IPC 在途延迟）未在 Windows 11 实机复现，维持原定级。
- **候选/发布**：仅源码，无新候选、无新包；未触碰 WFP/PF 规则、DNS 恢复语义、
  `appcast.xml`/`latest.json` 或 `windows-updates`。
- **剩余限制**：不 bump epoch 的取消路径不刷新令牌：StopClash(release=true)
  在无 armed 时为空操作；节点消失 `selected_node_vanished`（`stop_core(false)`，
  无 release）；连接事务 240 s 超时。经这些路径取消的 attempt，其迟到 prepare
  仍可能通过门，但触发条件比已修的 Disconnect→重连序列更窄。（更新安装的
  `invalidate_connection(false)` 原列于此；#294 合入后用户可不经 Disconnect 直接
  发起后继连接，这一变体并不更窄，已由 #390 的修复改为更新 Prepare 同样作废在途
  prepare 快照。）修复只在 Service 也升到 rev 17 后生效：
  `MIN_REQUIRED_SERVICE_REVISION` 仍为 14，只升级 App 时新 App 对旧 Service
  发 Legacy，F6 未修。旧 App 配新 Service 时只拿到到达时快照，在途迟到请求
  仍会漏过（与 rev 16 相同）。Service 重启会把 epoch 归零，快照于重启前的请求
  被拒绝并表现为一次连接失败（fail-closed，重试即恢复）。第二轮修正同样
  本机未编译，委托 CI；已有回归测试走 Freshness 路径，不受本修正影响，未改。
- **剩余限制**：不 bump epoch 的拆臂路径（如 StopClash(release=true) 在无 armed
  时为空操作）不刷新令牌——经这些变体取消的 attempt 其迟到 prepare 仍可能通过
  门，但触发条件比已修的 Disconnect→重连序列更窄；Service 重启会把 epoch 归零，
  快照于重启前的请求被拒绝并表现为一次连接失败（fail-closed，重试即恢复）。
## 2026-09-23 · Windows connecting 期间到达的 policy 行为变更不再丢弃

- **归属**：G1「已连接=能用」——已连接会话应按最新已安装 policy 提供 DIRECT/WeChat
  直连覆盖，而不是把 connecting 期间到达的行为变更静默丢到下次手动重连（会话内一致性，
  属已连接行为，不占 G2 的失败下一手）。
- **来源**：基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087)，分支
  `fix/windows-policy-defer-connecting-20260922`（PR 见该分支）；提交时未合 main。
- **缺陷修复**：R2-F5（对抗核实降级为低后只修丢弃/延迟部分；原报告"UI 显示直连已开"
  被 V5 核实推翻——实际走 `skip_optional_direct_policy` 写 `optional_direct_skip`，
  UI 如实显示 directSkipped，故本条不改前端）。原行为：FSM 处于 Connecting 时
  `handle_policy_behavior_change → handle_network_change_inner` 入口守卫直接无操作且无
  任何待处理记录；连接成功后 `spawn_optional_direct_after_connected` 携带连接前捕获的
  旧 policy 快照，`direct_context_is_current` 比对 revision/digest 不一致 → 跳过 overlay，
  新 policy 的 DIRECT 授权本会话永不应用，直到下次重连（pin-refresh 的 wechat 腿也因
  `applied_wechat_path_regexes` 为 None 不补放）。现行为：connecting 期间的行为变更由
  `policy_change_disposition`（ReconnectNow / DeferUntilConnected / Ignore 纯判定）给出
  DeferUntilConnected 并在 `TonoInner` 记录 pending（记下该 attempt 的 connect
  generation）；每次代际退役（Disconnect、连接失败、账户关闭/切换、下一次 attempt 准入）
  都清除 pending，connect 提交块在 `connect_succeeded` 后只消费与本 attempt 代际相同的
  记录，其它一律丢弃，因此绝不会串到下一个会话或其他账户；判定时在同一锁下重新核对
  `sign_in_generation`。消费后用最新已安装 policy 重建快照再走 optional-direct 应用
  路径。若刷新后的 policy 含 DIRECT 内容而本次连接**从未尝试**接口发现
  （`needs_physical_interface` 为假，内容从无到有），改走与已连接时相同的受保护
  teardown + 重连，由新事务发现接口并安装新 policy；该兜底任务携带本 attempt 代际，
  入口处会话已不是该代际的 Connected 就退出。接口发现**已尝试但失败**（虚拟/Hyper-V
  默认路由常态）不触发兜底，仍走原 skip 路径保持全隧道。已连接时立即 teardown+重连、
  DIRECT 应用失败的 restrict/不重连收敛、policy 写锁与 DIRECT 激活读锁互斥的既有
  纪律均不变；不泄漏（跳过路径保持全隧道）。
- **新增/优化**：无新功能。
- **工程与测试**：`connection/monitor.rs` 一个回归
  `a_policy_change_deferred_during_connecting_is_consumed_only_by_that_attempt`
  （`#[tokio::test]`：attempt A Connecting 时记录 pending → 按 `disconnect()` 的顺序
  `invalidate_connection` 后断开 → 下一 attempt B 提交时 `take_pending_policy_change(B)`
  为假；B 之后的 attempt C 自己记录的 pending 在其提交时被消费且仅一次）。审查返工前的
  实现断开不清 pending、消费不比代际，"不得到达下个会话"一条会失败（返工前的测试反而
  把"断开后记录仍在"写成了预期，已改正）。兜底条件与代际入口检查未被单测覆盖。
  三个 Windows Cargo workspace 保持分离，仅改 `app`。
- **验证**：本机未运行 cargo 构建/测试/格式检查（2026-09-14 执行位置决定：MacBook 只做
  编辑与源码自查）；委托本 PR 的 GitHub-hosted CI——`windows-2025` 上
  `apps/windows/app/src-tauri` 的 `cargo test --locked` 覆盖上述测试。提交时未获得 CI
  结果，不把未跑的检查写成通过；准确源码 SHA 以 PR 为准。审查返工（pending 清除与
  代际比较、兜底只在"从未尝试发现"时触发、兜底任务带代际）同样本机未编译，委托 CI。
- **候选/发布**：无新包，仅源码；不改 `appcast.xml` / `windows-latest.json`，不推
  `windows-updates`。
- **剩余限制**：只修 connecting 窗口的丢弃/延迟。兜底任务的代际检查与
  `handle_network_change_inner` 再次捕获代际之间仍有一个很小的锁释放窗口（与 policy_sync
  调用方同一纪律）。`directOverlay==='off'` 在其它 Err
  路径被前端渲染为 directOn 的问题仍独立存在（V5 旁注，不在本条范围）；Windows 11
  实机行为未验证，夹具结论不等于设备验收。

## 2026-09-23 · Windows 监视器重连成功后不再自中断丢失连接尾部

- **归属**：G1（已连接=能用；monitor 恢复的会话与用户点 Connect 的会话尾部行为一致）。
  影响 `apps/windows/app` 连接编排与仪表盘。
- **来源**：基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087) → 分支
  `fix/windows-monitor-self-abort-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-monitor-self-abort-20260922)。
  提交时未合 main。
- **缺陷修复**：R2-F4（对抗核实降级后仍成立）：网络监视器驱动的重连在旧 monitor
  自己的任务栈内联执行，成功尾部 `spawn_network_monitor` 无条件
  `abort_network_monitor()`，abort 了槽位里正在执行 `run_stages` 的自己；tokio 仅标记
  取消，任务在下一个 Pending await（`spawn_control_plane_pin_refresh` 的
  `state.lock().await`，常与托盘刷新任务争锁）被销毁。核实确认的实际损失：本会话
  DIRECT 覆盖层缺失（国内/WeChat 直连回到全隧道，fail-closed 不泄漏）、pin-refresh
  注册丢失（新任务以孤儿存活、靠代际自查，功能不丢）、`seed_autostart_after_connect`
  跳过（仅首连生效，无实质影响）；且 `direct_overlay="off"` 被仪表盘 connectHint 当成
  直连已开显示（旧逻辑只区分 `skipped`）。现在
  `TaskRegistry::register_network_monitor` 比较 `JoinHandle::id()` 与
  `tokio::task::try_id()`，槽位句柄即当前任务时只替换不 abort；旧 monitor 完成连接
  尾部后按既有 `connection_loop_continues(Handled)` 语义自行退出。前端仅
  `directOverlay === 'on'` 显示 directOn，`off`/`skipped` 显示 directSkipped。
- **新增/优化**：无新能力。DIRECT 覆盖层语义、WFP 保护、断开/登出路径的
  `abort_connection_tasks` 全部不变；其余替换路径（用户 Connect、重连退避、节点切换）
  仍中止被替换的监视器。
- **工程与测试**：新增一个回归
  `a_monitor_replacing_its_own_registration_finishes_the_connect_tail`
  （connection/monitor.rs tests）：任务把自身句柄放入槽位后执行同一注册逻辑，
  `yield_now().await` 后 oneshot 发送并断言接收；旧无条件 abort 语义下任务在 yield
  后被取消、收不到 → 失败。
- **验证**：按所有者 2026-09-14 执行位置决定，本机（MacBook）仅编辑与源码自查，
  未运行 cargo/npm 构建与测试；`apps/windows` workspace `cargo test` 与该回归委托
  本 PR CI（GitHub-hosted `windows-2025`），结果续记于 PR。未在 Windows 11 实机复现
  monitor 驱动重连场景。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：实机上的监视器重连后 DIRECT 覆盖层到位情况未验证；UI 提示
  directSkipped 同时覆盖 `off` 与 `skipped`（两者语义一致：国内直连未开）。

## 2026-09-23 · Windows 原生更新接管后不再搁浅 Connecting 状态机

- **归属/来源**：G3 升级生命周期与连接交错（R2 审查 F3，V5 对抗核实已确认）；基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-update-connecting-fsm-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-update-connecting-fsm-20260922)。
  提交时仍是独立修复分支，未合 main。选 G3 而非 G1：缺陷不在断开/恢复语义本身，而在原生
  更新事务（Prepare/Install）作废在途连接 attempt 后的收敛缺口；G1 的断开与释放路径未被触碰。
- **缺陷修复**：`tono_install_update` 下载完成后 `inner.invalidate_connection(false)` 使在途
  连接事务以 `Attempt::Stale` 返回（按约定不改 FSM），而后续收敛只折叠 `is_connected`
  （tunnel_died），`resync_after_cancelled_quit` 两侧分支都不命中 connecting——更新失败后
  FSM 永久停留在 Connecting，connect/retry 全拒，仅手动 Disconnect 可解。现把该收敛抽为
  `quiesce_connection_after_update(fsm, core_running)`：connecting 未 armed → 回 Not Connected；
  已 armed → 保留 blocked 闩收敛为 Protected Offline（不放宽保护：更新不是 Disconnect）；
  Connected 行为保持现状（仅 Service 报 Core 已停时 tunnel_died）。审查修正（代际门）：
  收敛原先只要 Service 快照有应答就折叠 connecting，若更新在 `invalidate_connection` 之前
  失败（如下载中途因 WinTUN 改路由断流），会把一个活着的 attempt 强改为 Not Connected，
  进而令其提交时 `InvalidSuccessPrecondition`、已验证连接被丢弃换成受保护重连。现在作废时
  记下 `connect_generation`，仅当它仍等于当前代际（即确是本次更新作废的 attempt）才折叠
  connecting；未作废或代际已被更新后准入的新 attempt 推进时不碰 FSM。遗留 `tono_prepare_update`
  （quit.rs）形状相同但前端与 `generate_handler` 均未引用（死代码），本轮不动，留待专门清理。
- **新增/优化**：无。
- **工程与测试**：app workspace 新增一个窄回归 `update_quiesce_never_strands_connecting`
  （update.rs 测试模块），覆盖未 armed → Not Connected 与已 armed → Protected Offline 两个
  收敛分支，并在同一测试中断言“更新未作废（None）或代际已推进”时进行中的 connecting 不被
  改动（修正前函数无条件折叠 connecting，该断言会失败）；无表驱动套件。代际比较在纯函数内，
  调用点只负责传入作废时与收敛时的代际，调用点本身无测试覆盖。tono-core 无改动（复用既有 `initial_release_failed` /
  `tunnel_died` 转移），三个 Windows workspace 保持分离。
- **验证**：本机（MacBook）按所有者执行位置决定只做源码编辑与 diff 自查，未运行任何
  cargo build/test/check（原生构建禁止本机执行）；编译与回归委托本 PR 的 GitHub-hosted
  `windows-2025` CI（app workspace `cargo test`）。准确源码 SHA 与 CI 结果续记于关联 PR；
  提交时无本机测试结果，不沿用其他 SHA 的绿灯。
- **候选/发布**：仅源码，无新候选包；未触碰 `appcast.xml` / `windows/latest.json` /
  `windows-updates`。
- **剩余限制**：更新在作废前失败时不触碰 FSM（进行中的 attempt 自行完成其转移）。更新收敛依赖 Service 状态快照应答；Service IPC 完全无应答的极端情形仍保持
  本地视图（与取消退出路径的既有设计一致）。该缺陷为已核实的源码推导（R2 + V5），修复前
  未在 Windows 11 实机复现，实机验证仍属 G3 验收范围。

## 2026-09-23 · Windows 引导 API 放行绑定 Tono 程序身份

- **归属/来源**：G1 保护边界；基线 origin/main `244075f2`，分支
  `fix/wfp-bootstrap-app-bind-20260923`，Issue #330（内部审查 H1-F5 Windows 部分）。未合 main。
- **缺陷修复**：Bootstrap 与 Blocked（Protected Offline）下的控制面放行（规则 C，
  `session/permit-api/*`）原先只匹配地址、TCP 与 6 个端口，不带 `ALE_APP_ID`，本机任意进程都能
  经物理网卡访问这些共享 Cloudflare anycast 地址。现在规则 C 额外要求 ALE_APP_ID 等于
  `%ProgramFiles%\Tono\Tono.exe`（Windows 上唯一调用控制面的进程；Service 不含 HTTP 客户端），
  并把该路径并入过滤器 key，使升级后的 Service 重新生成 key 并移除旧的无身份过滤器。App 不在该路径时
  不渲染规则 C（失败即关闭）；app id 解析失败时沿用核心放行的做法，先装 block 再报错。
- **工程与测试**：改写已有回归
  `arbitration_api_channel_open_in_bootstrap_and_blocked_retracted_in_locked`：Bootstrap/Blocked
  下 Tono app 的包放行，其他进程的同一元组必须 Block。旧规则表上其他进程的包得到 Permit，测试失败。
- **验证**：本机只跑 rustfmt 检查改动片段（仓库里已有的格式差异未动）；按执行位置规定，本机不跑原生
  cargo。Service 单元测试与 Windows 构建交给 PR 上 GitHub-hosted `windows-2025` CI，结果续记在
  PR 中。没有实机 WFP 验证。
- **新增/发布/限制**：无新包、无部署。`FwpmGetAppIdFromFileName` 对 Program Files 路径的匹配、
  Protected Offline 下 App 重新登录与刷新策略，都需要在 Windows 11 实机确认。开发版或非标准安装位置
  的 App 在保护开启期间无法走引导通道（失败即关闭）。macOS 部分另见 #331。


## 2026-09-23 · Windows App 在 Protected Offline（armed 未验证）期间的 Service 真值再同步

- **归属/来源**：G1 断开/保护状态与实际一致（R2-F2）；影响 Windows App
  （`apps/windows/app`，三个 Windows workspace 保持分离）。基线 main
  [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)，
  分支 `fix/windows-service-restart-resync-20260922`
  （[与 main 的差异](https://github.com/raydocs/tono/compare/main...fix/windows-service-restart-resync-20260922)，
  PR 随后在该分支上创建）；提交时未合 main。
- **缺陷修复**：App 存活并显示 Protected Offline（armed 未验证）期间 Service 重启时，
  Service 启动路径 `retire_unverified_windows_kill_switch`（`bin/service.rs` →
  `retire_unverified_on_service_start` → `disarm_unlocked`）会自动删除全部 WFP 过滤器并
  恢复 DNS，而 App 侧核实无任何再同步路径（monitor 仅 `is_connected` 时运行、自动重连需
  `session_verified`、`tono_status` 只回缓存、restore 探测只在启动、IPC 每请求新建管道无
  断线回调），UI 持续显示"已封锁"而机器已明文开放——I3 明文禁止的反向不一致。修复两部分：
  (1) 把 `resync_after_cancelled_quit` 里的 KillSwitchStatus → FSM 折叠抽成
  `apply_service_kill_switch`（`commands/quit.rs`），quit 路径与轮询共用同一语义；
  (2) 新增有界 Service 真值轮询 `protection_resync_loop`（`connection/monitor.rs`，30 s 一次
  读 `/status` 的 kill_switch 聚合），FSM 处于空闲 Protected Offline（armed 未验证为原始
  形态，推广到全部 protection_blocked idle）时经 `TaskRegistry.protection_resync` 注册，
  离开该状态即撤销（registry abort + 循环自退，无常驻线程）；注册点：
  连接失败收敛尾、节点消失/冷切换、启动与重试 restore 尾、释放协调 settled 回调、取消退出
  resync。只在 Service 亲口证明 `wanted=false` 时收敛 FSM 到 Not Connected 并清闩；读不到
  状态保持原状（fail-closed，不放宽保护）；IPC 在途代际变动时不折叠陈旧读数。
- **新增/优化**：无客户可见新功能；仅上述再同步任务与 TaskRegistry 槽位。
- **工程与测试**：新增一个回归
  `protected_offline_converges_when_the_service_proves_the_barrier_gone`
  （`connection/monitor.rs`，`#[tokio::test]`，无 AppHandle 依赖的 spawn 注入）：armed-unverified
  idle 夹具断言 (a) TaskRegistry 持有 protection 轮询句柄——这是新 seam 的存在性测试，
  在 main 上的失败方式是编译失败（`protection_resync` 字段与 `ensure_protection_resync_locked`
  不存在），不是行为失败；它只证明该函数在匹配状态下注册，不覆盖各生产入口是否调用它
  （入口接线靠源码核对）、
  (b) `apply_service_kill_switch(…, Some(wanted=false))` 后 `!kill_switch_armed` 且
  `ui_state == NotConnected`（锁住折叠语义）。W4/W5/W10 已修项（release 所有权、元数据收尾、
  55 s UI 等待）行为不变。
- **验证**：本机（MacBook，编辑机）按 AGENTS.md 执行地点约束未运行任何
  cargo build/test/check/clippy；回归与编译委托本 PR 的 GitHub-hosted `windows-2025`
  CI（app workspace `cargo test`）。源码自查基于逐文件比对，不声称本机已验证。
- **候选/发布**：无新包，仅源码；不涉及 Sparkle/windows 更新源。
- **剩余限制**：登出/关闭路径无需单独挂钩——生产上所有 release（Disconnect、quit/失败转移
  的 `release_explicit`、登出与 restore 的 `release_for_account`）都经 `start_explicit_release`，
  其 settled 回调在监督者更新 FSM 之后、`operation.complete()` 之前注册轮询；唯一直接调用
  `coordinate_release` 的 `commands/account.rs` 位于 `#[cfg(test)]`。但登出 release 被拒时
  FSM 处于 blocked（从而被轮询覆盖）依赖 #295（R2-F1）落地；未合 #295 时未 arm 竞争分支
  FSM 为 Not Connected，是 F1 本身而非本条。已验证会话经 monitor `tunnel_died` →
  `schedule_reconnect_for_generation` 进入 idle Protected Offline 且未排程重连（如重连预算
  耗尽）时不注册轮询；已验证 intent 在 Service 重启时保留、不被 retire，不构成 I3 反向。
  实机"Service 重启 + 存活 App"组合夹具仍缺
  （known-findings §6），本轮以源码级路径与单测覆盖。

## 2026-09-22 · Windows 拒绝释放后的连接 FSM 保护可见性

- **归属/来源**：G1 断开与恢复——断开后保护状态必须两端一致；本条修的是 Service
  拒绝 release 时 App FSM 谎报 Not Connected、Disconnect 随之变成空操作的断开一致性
  缺陷。基线 main [576d7087](https://github.com/raydocs/tono/commit/576d7087cc54084acef3a4cda15c433ec96bb679)
  → 分支 `fix/windows-release-refused-fsm-20260922`（PR 见关联分支）；提交时未合 main。
- **缺陷修复**：R2-F1（2026-09-22 并发/时序审查 + 对抗核实轮已确认）。Disconnect/登出
  与 in-flight StartClash 竞争且 Service 拒绝 release 时，release 监督者只调
  `initial_release_failed()`，而该方法把 `is_protection_blocked` 折叠成本次 attempt 的
  本地 `kill_switch_armed` 闩——该闩被 StartClash 竞争跳过、从未置位，FSM 于是报
  Not Connected，WFP 实际仍 Blocked；此后 `disconnect()` 命中 idle 早退成空操作，托盘
  禁用 Disconnect。现在监督者 Err 分支先 `mark_kill_switch_armed()` 再
  `initial_release_failed()`（拒绝本身即事实，fail-closed 假定保护仍在，与错误文案
  "protection stays on" 一致）；`tono_sign_out` 的 release 失败早退分支同样置闩，与既有
  Expired 收尾分支对齐。不放宽保护：WFP 删除逻辑、Service 侧、fail-closed 语义均未改。
- **新增/优化**：无。
- **工程与测试**：新增一个窄回归
  `refused_release_after_an_unarmed_connect_race_keeps_protection_visible`
  （`apps/windows/app/src-tauri/src/tono/connection/disconnect.rs` tests）。旧实现上该测试
  必失败：夹具 `begin_connect`+`begin_disconnect`（闩未置位）加注入 Err 的 release，
  旧 `initial_release_failed` 得 `is_protection_blocked=false`，末条断言不成立。
- **验证**：本机未编译未运行（编辑机约束，见 [BUILD_AND_TEST](BUILD_AND_TEST.md)）；
  回归委托本 PR 的 GitHub-hosted CI（`windows-2025`，`app-rust` job 在
  `apps/windows/app/src-tauri` 跑 `cargo test --locked`，路径过滤命中 `apps/windows/app/**`）。
  准确源码 SHA 为本 PR 实际 push 的 commit（PR head）；提交时 CI 结果未产出，以 PR 页为准。
- **候选/发布**：无新包，仅源码。
- **剩余限制**：只修 FSM 闩推断，不改变 Service 拒绝 release 的根因（DNS restore 失败、
  core 终止未确认、WFP 过滤器删除失败仍会拒绝并保持 armed）；Windows 11 实机断开/恢复
  清单未重测，不据此关 G1。监督者 Err 分支不区分 Err 来源、不读 Service 真值：Err≠拒绝
  的子情形（Service 不可达/修复被拒、更新栅栏、release 任务 join 失败）同样置闩，若此时
  机器从未 arm（Disconnect 落在 StartClash 之前），会被显示为 Protected Offline 而实际开放；
  这与 `restore.rs` 对 `Unknown` 的既有取舍（记作 armed、不 verified）一致，由 #299 的
  Service 真值轮询在 Service 可达后约 30 s 内以 `wanted=false` 纠正（未合 #299 时无自愈）。

## 2026-09-23 · Windows 混合 DNS 残留不能证明恢复成功

- **归属/来源**：G1 断开与恢复；从已合入的
  [4d4aafc8](https://github.com/raydocs/tono/commit/4d4aafc8129988cee76150ddb7ebdf0becd7d4b2)
  继续定点检查，分支 `fix/dns-followup-20260923`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/dns-followup-20260923)。
  本条提交时仍是独立修复分支，不沿用上一轮 main 合并授权。
- **缺陷修复**：恢复快照损坏、进程内没有旧失败标记时，IPv4 `NameServer` 或
  `ProfileNameServer` 中的 `1.1.1.1, 198.18.0.2` 被“列表全是 Tono 地址”的判断漏掉，
  `recover_unreadable_snapshot` 可错误接受恢复并隔离唯一快照；卸载恢复也会漏选这个适配器。
  现在复用已有“包含当前 TUN DNS 地址”的判断：仍有该地址就保留快照并拒绝恢复成功，
  不把公共备用 DNS 当成移除残留的证据。旧 loopback/用户本地解析器处理保持不变。
- **工程与测试**：新增一个生产 facade 回归
  `mixed_protected_dns_cannot_prove_corrupt_snapshot_recovery`，经过真实损坏文件解析、
  原生 engine 的注册表读取、恢复拒绝和卸载选择；清除残留后还须能完成恢复并保留隔离文件。
  延用 OS I/O 隔离夹具，补入 NRPT/DoH 恢复计数，避免反例和正例触碰宿主策略；没有伪造
  facade 的成功/失败结果。既有 native DNS 前缀已覆盖新测试，无工作流改动。
- **验证**：本地只做 diff/格式检查；原生命令由现有 GitHub-hosted `windows-2025` Service
  执行：`cargo test --locked --features standalone,client --lib core::dns::engine::native_apply::tests:: -- --nocapture`，
  前置相同前缀的 `-- --list` 防止零测试。准确源码 SHA、实际结果及日志续记保留在关联 PR；
  提交时未获得本次原生结果，不把上一轮 main 的绿灯移用到此修复，也没有修复前的原生红灯。
- **新增/发布/限制**：无新功能、无新包、无部署；只收紧残留 DNS 的恢复证据，不变更
  WFP、恢复超时、原始 DNS 字符串或快照 schema。夹具验证不等于 Windows 11 实机恢复、
  真实 API/适配器变化或 G1/G3 验收；本轮定点检查不表示整个产品已无 bug。

## 2026-09-23 · 桌面源码合入 main，保留发布边界

所有者在本线程明确要求把能合并的 PR ship 到 GitHub `main`。归属仍为 G1–G3
桌面整改、升级与可追溯验收；本轮是源码集成交付，不是新的功能实现或客户发布。

- **已合入**：[#289](https://github.com/raydocs/tono/pull/289) 正常合并为
  [1ca878cf](https://github.com/raydocs/tono/commit/1ca878cfb8f9c213356eae263a83e5eba0b39075)，
  一次保留 #281 → #282 → #283 → #286 → #289 的完整提交历史和最终修复。
  合并前 main 为 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；
  `git diff --exit-code d954a7f740f95f141136af423a39338d79a1b674 origin/main` 返回 0，
  合并结果与已验证最终组合源码的完整树相同，没有把有已知续修的中间版本逐次送入 main。
- **说明已合入**：[#280](https://github.com/raydocs/tono/pull/280) 正常合并为
  [e94161e0](https://github.com/raydocs/tono/commit/e94161e07593d581995b4a9eecc54030eeaa7118)。
  相对上一项仅增加两端 release notes 和既有 RC 报告，不改变候选字节。
- **重复 PR 收尾**：GitHub 已把 #281 标记为 merged；#282/#283/#286 的准确 head
  已是 main 的祖先，作为已集成记录关闭。#277/#278/#284/#285/#287/#288/#290 经
  `git cherry` 确认所有提交均有等价补丁，再按 #279/#289 的组合交付关闭。
  这不是丢弃源码，也不把子分支曾有的编译/测试失败改写成通过；没有重复合入旧实现。
- **依赖组合另验**：三个原有绿灯 PR [#252](https://github.com/raydocs/tono/pull/252)、
  [#255](https://github.com/raydocs/tono/pull/255)、[#256](https://github.com/raydocs/tono/pull/256)
  在新 main 上无冲突合成 [#292](https://github.com/raydocs/tono/pull/292)，准确源码
  [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)。
  只含 Rollup、Windows 前端依赖组与 Rust 锁文件这七个文件；新 updater 的依赖条目保留。
  `git diff --check origin/main...HEAD` 返回 0；记录时组合 Windows CI 待完成，仍为 Draft，
  尚未合入。8 分钟有界等待结束时 18 项成功、2 项 Windows app-rust 待完成，详见
  [当时状态及续验入口](https://github.com/raydocs/tono/pull/292#issuecomment-5787253794)。
  已完成的准确 push 日志确认：
  [前端](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851595) 36 文件/282 测试通过；
  [Service](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851691) 310 项 lifecycle、
  6 项 DNS、4+3+1 项更新及 WFP 形状检查通过。旧依赖 PR 的绿灯不代替新组合证据。
- **未强行合入**：[#253](https://github.com/raydocs/tono/pull/253) 的 control-plane/
  ops-contract/migrations 失败；[#254](https://github.com/raydocs/tono/pull/254) 的
  ops-contract 与四个 E2E shard 失败；[#203](https://github.com/raydocs/tono/pull/203)、
  [#204](https://github.com/raydocs/tono/pull/204) 有冲突且保留未完成的产品范围。
  [#275](https://github.com/raydocs/tono/pull/275) 仍是固定旧二进制的单次诊断 Draft，
  其红/绿诊断已用于 #276 修复，不把过时的例外工具作为新主线功能合入。
- **验证与限制**：合并前复核 #289 的 12 项检查全成功，原始命令、确切 CI checkout、
  377 项 macOS（1 skip）及 Windows DNS 6 项/lifecycle 310 项等证据见下文 F。
  合入 main 后 [Services CI](https://github.com/raydocs/tono/actions/runs/35804170997) 成功；
  [macOS CI](https://github.com/raydocs/tono/actions/runs/35804298002) 的实际 checkout 为上述
  e94161e0，仍是 377 项、1 skip、0 失败；旧 1ca878cf 的 macOS run 被后续 push 的既有
  concurrency 规则取消，不计通过。[Windows Service](https://github.com/raydocs/tono/actions/runs/35804170998/job/107001095427)
  实际 checkout 为上述 1ca878cf，310 项 lifecycle、6 项 DNS 及更新/WFP 检查通过；当时
  app-rust 仍在跑，不声称整个 main workflow 全绿。命名结果来自完整 job 日志，非步骤名推断。
  未手动 dispatch、重跑或取消 CI，也未创建后台监控或自动合并承诺。
  本记录的文档整理不另跑产品测试。没有 force push、历史改写、分支删除或工作树清理。
- **候选/发布：源码交付，未发布新候选。** 已发布 RC 仍固定在旧的 569ce865，仍不含下文 C–F；
  常规 CI 产生的未签名构建不是已签名 RC，不替换旧下载包。未部署 Worker、签名、安装设备、推进 Sparkle/windows
  更新源，#26 及原有 G1/G3 实机、PF/WFP/DNS 与性能证据要求不因合并关闭。

### 2026-09-23 续记 · 剩余依赖检查完成并合入

整理交付记录期间的最终复核发现两个 app-rust 已完成；[#292 的完成续记](https://github.com/raydocs/tono/pull/292#issuecomment-5787272136)
保留了这个状态变化，没有删除上面的 pending 观察。准确组合源码的 **20/20 检查全部成功**，
包括 [Windows push 原生消费者](https://github.com/raydocs/tono/actions/runs/35804404717/job/107001851447)：
499 项 Tauri、18 项 journal、3 项 atomic、1 项共享合同通过；另一个原有 opt-in target 的
1 项 ignored 不计为执行成功。CI 日志提取摘要可用但命名列表有截断，不充作全需求证明。

[#292](https://github.com/raydocs/tono/pull/292) 随后正常合入 main 为
[4f58da37](https://github.com/raydocs/tono/commit/4f58da37fffa15bf5dc4430d6afb413af6e9561c)。
合并后的完整树与已测试的 [94bfa6cf](https://github.com/raydocs/tono/commit/94bfa6cfa15e13bba9786ec103be49a996010d4c)
相同；GitHub 同时确认 #252/#255/#256 均为 merged。没有另行解决依赖代码冲突、变更锁文件
之外的实现或放宽测试。此前桌面合并的 Windows run 35804170998 此时也已全部成功。

本总账及维护规则通过 [#291](https://github.com/raydocs/tono/pull/291) 的文档变更收尾。
最后的新 main push CI 是独立运行，不把上述合并前或前一 main 的通过数重标为该 run 的结果。
保留未合入项仍为 #253/#254 的失败检查、#203/#204 的冲突/未完成范围和 #275 的旧诊断 Draft。
已合入源码与既有 RC 的包含关系仍不同，发布及实机门不变。

## 2026-09-21—23 · 工程整改线程全程回填

来源：[Tono 工程整改验收线程](https://ampcode.com/threads/T-01a0c5d0-1c0d-77a0-b272-0a931282c5b5)。
本条按已交付提交、PR、分项报告和候选来源回填，不把线程启动前已存在的修复重新算作发现。
例如 #240/#242/#244/#258/#262 及其子 PR 的代码被纳入基线/后续合并，但不是本条新发现的 20 项。
首轮报告明确编号 **20 项（W1–W14、M1–M4、S1–S2）**；下文另列后续修复与功能，
不把它们混成一个无法复核的「全部 bug 总数」。

### 交付与包含关系（2026-09-23 合入授权前的历史快照）

以下保留首次回填时的状态，不覆盖当时的未合入/未验证事实；后续合入状态以上方续记为准。

| 批次 / 归属 | 源码与 PR | 当前交付状态 |
|---|---|---|
| 首轮工程整改 / G1–G3、ops | [#267](https://github.com/raydocs/tono/pull/267)，合并 [0e20f2df](https://github.com/raydocs/tono/commit/0e20f2df671a528d80c2366d65aca3df1830117a)；含 #268/#271/#272 | 已合 main；20 项源码整改和组合证据见 A。 |
| 候选安装与构建 / G3 | [#276](https://github.com/raydocs/tono/pull/276)，实现 [429d6e40](https://github.com/raydocs/tono/commit/429d6e40ea775d0fb38d0e84053a4e44943c015e) | 已合 main；含 B 的安装路径和候选配置修复。 |
| 两端易用性 / G1–G3 | [#279](https://github.com/raydocs/tono/pull/279)，合并 [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)；含 #277/#278 | 已合 main；也是当前已发布 RC 的冻结源码。 |
| 测试包及说明 / G1/G3 | [#280](https://github.com/raydocs/tono/pull/280)，文档 [3d57e59c](https://github.com/raydocs/tono/commit/3d57e59ccb7cb4b4248f32733ecafeb89a51b800) | RC 已发布；说明 PR 尚未合并。不能把说明提交当包源码。 |
| #251 续修 / G1/G3 | [#281](https://github.com/raydocs/tono/pull/281)，[ac2cde16](https://github.com/raydocs/tono/commit/ac2cde16a5e303a09e0bc8893f02972b34671115) | 已推送、未合 main；C。 |
| 共用升级合同 / G3 | [#282](https://github.com/raydocs/tono/pull/282)，[e811d740](https://github.com/raydocs/tono/commit/e811d740bfc733f65b54bf6ea4223d4f250482c8) | 已推送、未合 main；仅该批是未接入的值模型，不单独声称原生升级完成。 |
| 原生升级接入 / G3 | [#283](https://github.com/raydocs/tono/pull/283)，[aeb4b5ad](https://github.com/raydocs/tono/commit/aeb4b5ad69330507fdeed70a4b263667b2619eda)；含 #284/#285 | 已组合、未合 main；D。受保护装机验收仍开放。 |
| 连接优化 / G1/G2 | [#286](https://github.com/raydocs/tono/pull/286)，[705e16d9](https://github.com/raydocs/tono/commit/705e16d9ac80a800591da195c0c360029db0ff77)；含 #287/#288 | 已组合、未合 main；E。没有设备提速百分比证据。 |
| DNS 反例续修 / G1 | [#289](https://github.com/raydocs/tono/pull/289)，[d954a7f7](https://github.com/raydocs/tono/commit/d954a7f740f95f141136af423a39338d79a1b674)；含 #290 的测试与修复 | 已组合、ready for review、12/12 CI 检查成功，未合 main；F。 |

未合并源码的依赖链为 **#281 → #282 → #283 → #286 → #289**；子 PR 已实际集成，
不是只引用提交号，也不应重复计算/重复应用。当前远端 main 与 RC 都仍是 569ce865，
**已发布 RC 不包含 #281 及其后的 picker、原生升级、连接优化和 DNS 续修**。

### A. 首轮确认并修复的 20 项

原始归属、反例、命名测试、红/绿结果与未覆盖模块见
[组合整改记录](reports/ENGINEERING_ACCEPTANCE_2026-09-21.md)、
[macOS 分项](reports/ENGINEERING_MACOS_2026-09-21.md)和
[服务端分项](reports/ENGINEERING_SERVICES_2026-09-21.md)。以下保留原编号，便于逐项回查。

| 编号 | 确认的失败场景 → 修复结果 |
|---|---|
| W1 / #247 | 重试槽位覆盖后旧任务失去句柄仍运行 → 替换前取消旧 loop，任务归属和代际一起提交。 |
| W2 / #249 | 卸载时 NRPT 恢复失败被适配器 fallback 吞掉 → 不报告恢复成功，保留快照和重试责任。 |
| W3 / #251 | 节点页/托盘用旧 idle 状态，在后端热切换后追加 Connect → 选择确认后读回后端状态；残余 admission 竞态见 C。 |
| W4 / #248 | 退出登录尚未结束，调用者消失后又允许连接 → 账户关闭责任持续到真实清理结束。 |
| W5 / #246 | 断开 UI 等待者取消，会话计时/重试元数据未清理 → 释放所有者继续完成收尾。 |
| W6 | 旧验证迟到后覆盖新连接的 controller secret/port → 发布边界核对原连接代际。 |
| W7 | 旧 logout 响应迟到，撤销或删除替换账户的凭据 → logout 绑定发起时账户。 |
| W8 / #259 | DNS 自写窗口直接丢弃真实网络变化 → 保留待处理事件，窗口后比较物理拓扑再协调。 |
| W9 | 下一次重试清空 live error，旧失败原因丢失 → 按原 attempt 保留有界、脱敏的原因及阶段。 |
| W10 | 55 秒 UI 超时被当成真正释放结束，过早重开登录 → owner 等实际释放，UI 等待预算不改变责任。 |
| W11 | restore 401 的代际检查后账户已替换，旧清理误伤新账户 → 首个副作用前原子预约账户关闭。 |
| W12 | vault 写/删乱序，旧写复活令牌或旧删抹掉新令牌 → 单写者 FIFO，退出等待持久化删除确认，错误不装作已退出。 |
| W13 | A 的 JSON 请求遇 401，借 B 的凭据重放 A 内容 → 请求与重试都绑定原账户身份。 |
| W14 | A 的失败在等待 Service status 后才取身份，首次上传已归给 B → 连接 admission 捕获不可变账户身份，贯穿失败记录和上报。 |
| M1 | macOS AppState 拒绝释放后，AccountSession 第二个 owner 仍恢复 DNS/解除 PF → AppState 成为唯一释放所有者。 |
| M2 | DNS 读取失败被当成空配置，删除恢复快照并允许释放 → 保留读错与快照，拒绝假恢复，允许重试。 |
| M3 | audit 写盘失败不断回填整批，重试缓冲无界增长 → 限制为最近 256 条/256 KiB，恢复后记录本地丢失情况。 |
| M4 | 更新日记把旧 Mihomo 版本/build number 当运行 Core/源码，丢失已知 catalog revision → 不可得身份保持 unknown，保留实际已知 revision。 |
| S1 / #269 | 密码脱敏只替换标签，值仍进入 collector/Worker 结果 → 上传和存储边界移除值，保留非敏感故障上下文。反例使用合成凭据，不声称发生真实泄漏。 |
| S2 / #270 | SSH rc255、journal rc1 被当作成功观测 → 非零读取报错，不能产生「无故障」证明；成功空输出仍合法。 |

工程配套：collector 的路径触发和 25 项测试补入 Services CI；权限阻塞解除后才实际推送并
执行成功。纯边界提取、测试 seam、预算内模块拆分不另算产品 bug。
首轮组合及 merge 后证据包括 Windows App 492 项、macOS 344 项（1 既有 skip）、Worker
890 项和 collector 25 项；准确命令、不同 checkout 与范围均在原始记录，不冒充最新全部源码结果。

### B. 安装、候选与易用性阶段的后续修复

| 范围 | 已修复内容 | 记录 |
|---|---|---|
| Windows 覆盖安装 | `C:Users` 是随工作目录变化的盘符相对路径，导致合法候选修复失败；改为合法 SystemDrive 下的绝对 Users 路径，保留枚举/日记拒绝。 | [候选修复与原始安装 smoke](reports/CANDIDATE_INSTALL_FIXES_2026-09-22.md)，#276。 |
| macOS 候选配置 | 签名候选仍只接纳 0.0.72；收敛到精确 0.0.73 专用分支/产物合同，并移除同一 run 重复生产同名 Core artifact 的冲突，不放宽到任意 PR。 | 同上；签名实际执行另见 RC 记录。 |
| Windows Activity | 把只有 selector 的链当作已观测出口 → 仅已报告的 terminal 作为线路证据，未知不猜测；正对照保留 DIRECT/家宽/云端。 | [易用性组合记录](reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，R1，#279。 |
| macOS 近期成功 | 验证期间同名目录被替换，将旧 digest 的成功记给新目录 → connect/switch 提前捕获 digest，完成时不相同就不记成功。 | 同上 R2，具备 hosted red/green。 |
| 易用性实现中的整合错误 | 修正 Windows 旧上传调用、账户替换后残留预览/回执、收藏按钮归属、缓存摘要被误读为实时健康；保留冻结预览、明确同意和未知状态。 | 同上；这是本线程新能力整合时纠正的问题，不全是旧版本缺陷。 |
| 发布说明 | macOS 14+/helper 4.3.0 与实际包不符 → 说明 Apple Silicon、macOS 26.3+、helper 4.4.0；Windows 标 x64；去掉稳定版/首次公开发行误标。 | [已发布 RC 的后续记录](https://github.com/raydocs/tono/blob/3d57e59ccb7cb4b4248f32733ecafeb89a51b800/docs/reports/DESKTOP_USABILITY_0_0_73_2026-09-22.md)，#280；未改变兼容性目标或包字节。 |

同时交付的 **六项新增能力，不计为六个 bug**：本地只读健康检查；报告冻结预览/同意/回执；
版本与运行身份说明；按账户的收藏/近期成功/固定地区/推荐；恢复进度反馈；应用线路解释。
最终该阶段 Windows App 499 项、macOS 356 项（1 既有 skip）通过；Windows 浏览器和 macOS
生产组件图已检查。完整原生窗口、真实上传、真实网络与所有交互不由这些截图证明。

### C. #251 剩余时序与更新日记覆盖

[#281](https://github.com/raydocs/tono/pull/281) 处理状态读回与 Connect admission 之间的竞态：
另一窗口已赢得连接，本窗口收到重复/过时代际拒绝后，节点页误报失败、托盘不刷新/不关闭。
改为只协调已识别的 **Connect** 竞争拒绝，仍刷新真实后端状态；Select/status 错误不吞，
不重试 Connect，也不发明 Connected。21 项页面/托盘回归通过，旧实现 2 项按预期失败。

同批扩展更新日记的逐相位写盘失败/旧文件保留回归，并把依赖包日记 unit tests 真正接入
Windows lane、加非零枚举门；以前 App 的 cargo test 不会自动跑依赖的 unit tests。
这项测试覆盖不等于实现了受信任安装交接。
详见[该准确源码的闭环记录](https://github.com/raydocs/tono/blob/ac2cde16a5e303a09e0bc8893f02972b34671115/docs/reports/WINDOWS_251_G3_CLOSEOUT_2026-09-22.md)。

### D. 共用升级协议及原生接入

这是 #282/#283 的 **新增与结构性实现**，不是把整个协议计为一个已经发布的 bug 修复：

- 两端共用 canonical manifest、同源码成对包、签名 releaseSequence；校验独立签名与实际包摘要。
- macOS 的 root Helper 与独立 launchd 执行器持有完整包更新；Windows 的 Service 与独立
  SYSTEM 执行器持有准入和替换。App 日记、同版本字符串或同路径不再充当安装授权。
- 私有暂存、先持久化消费再替换、丢确认的单次消费、真实 successor 身份、回滚及高水位保留；
  明确 Disconnect 不伪造恢复/提交，也不删除已消费或不确定事务。
- 配套成对构建/离线验证、精确只读下载路由与原生测试 lane；没有部署路由或发布 v1 更新对象。

实现中另纠正了：macOS 重读账本时的持久化确认、未消费事务先归档再退休、合法临时包路径
序列化；Windows 恢复任务早于持久化消费注册、未消费事务退休边界；更新拒绝在模态框外看不见、
关闭重开后还能重试同一拒绝 manifest；不完整更新提示与进度卡重叠。失败证据与保护未放宽。

编译 API/PID 绑定、sha2 版本调用、测试临时目录冲突、截图缩放/透明度、缺失 OK 翻译及旧包装
变异断言也已修正，分别保留失败来源；它们不都等于独立生产运行时漏洞。
证据见 [#283 的组合日志](https://github.com/raydocs/tono/pull/283)、
[原生接入合同](https://github.com/raydocs/tono/blob/aeb4b5ad69330507fdeed70a4b263667b2619eda/docs/UPDATE_INTEGRATION_V1.md)：
macOS Helper 更新自测 7 项、XCTest 361 项（1 既有 skip）；Windows Store/native/executor
4+3+1 项通过。具体 OS/签名成功效果有注入，不是实际受保护安装/断电/重启验收；#26 仍开放。

### E. 连接速度与取消责任

- macOS 原阻塞 resolver 会使 task-group timeout 仍等待子任务；改用 DNS-SD 后，独立审查
  又确认其同步提交也会卡住同队列 deadline/cancel。最终独立 waiter 先启动 timer，取消/截止
  立即结束调用者等待，C ref 仍在原串行队列清理；旧调用未清理前拒绝堆叠第二次提交。
  **没有强制取消同步 C 调用**，这是明确保留的边界。
- 最后一轮 mixed diagnostic 与 TUN 探测并行；TUN 成功不等诊断，迟到/取消的结果不能改
  新连接的 preferred origin 或遥测。诊断成功不能替代真实 TUN 成功。
- Windows 原生 IP Helper 应用 DNS 并读回有效 IPv4/IPv6，健康路径不启动 shell；已完成的
  错误才用一次兼容批次并全量重读。保留原始 DNS、restore 与超时后单写者，非设备性能证明。
- 新增只读同设备/同线路 P50/P95 比较工具，保留失败/取消/丢失尝试；纠正实现期间发现的
  Mac stage 名、缺少 Windows 单调计时和显示四舍五入越过 30% 阈值的问题。9 项测试使用
  合成时长，不能算实际提速。

证据：[连接 beta 记录](https://github.com/raydocs/tono/blob/705e16d9ac80a800591da195c0c360029db0ff77/docs/CONNECTION_BETA_2026-09-22.md)、
[#286 的组合结果](https://github.com/raydocs/tono/pull/286)：macOS 372 项（1 既有 skip），
包括 6 个系统 DNS 与 5 个连接时序测试；Windows 原生 DNS 4 项通过。
DNS-SD 同步提交的修复前问题是源码确认，没有把未执行的 native red 记成通过；最终 held-call
回归已执行。补齐的 Swift 显式源码列表与原生测试枚举是工程修正，不是额外连接缺陷。

### F. 最近一次发现并修复的四组 DNS 问题

| 范围 | 失败场景 → 修复结果 |
|---|---|
| macOS listener 取消 | NWConnection 构造期间取消，尚未登记连接而丢失取消 → 独立终态立即结束等待，真实 Disconnect 不必等 DNS 超时。 |
| macOS listener 响应证明 | 无关问题/owner、错误/截断应答、后续畸形 RR 仍留下 fake-IP；复审发现 OPT 扩展错误也被忽略 → 匹配实际随机 ID、IN A 问题和 owner/CNAME，完整校验帧，并拒绝未协商的 OPT。 |
| Windows 适配器消失 | 消失被报 apply 成功，清掉未验证标记 → 消失不给正面结果，返回后仍须实际 setter/readback；不反复重写健康适配器。 |
| Windows 部分写失败 | IPv4 已写、IPv6 失败，还没有 pending 标记，下一次被「看起来已配置」跳过 → 活跃适配器写前保存义务，错误/超时不退休，watchdog/idempotence 看活跃 pending。 |

[#289](https://github.com/raydocs/tono/pull/289) 保留 listener、OPT、Windows 两项的真实红/绿结果，
并已集成 #290 两个提交。最终源码是 d954a7f7，不是只拿子分支 green 代替组合：

- [Windows Service job](https://github.com/raydocs/tono/actions/runs/35800295759/job/106988865192)
  实际 checkout 为 d954a7f7；`cargo test --locked --features standalone,client --lib
  core::dns::engine::native_apply::tests:: -- --nocapture`：6 passed / 0 failed，另有 310 项 lifecycle。
- [macOS XCTest job](https://github.com/raydocs/tono/actions/runs/35800298994/job/106989255243)
  实际 checkout 为 PR merge [63a98602](https://github.com/raydocs/tono/commit/63a986027d50948438bc5daad33f3f95f85abf80)，
  与 d954a7f7 的完整 tree 相同；现有无签名 `xcodebuild ... test`：377 项、1 既有 skip、0 失败，
  五项 listener 测试均通过。完整命令、精确来源及红/绿链接在 PR。
- 2026-09-23 复核 #289 的 12 项 CI 全部成功。限定独立复审没有剩余确认的范围内源码缺陷，
  不是「所有 bug 已找完」。原始 DNS、restore/NRPT/DoH、PF/WFP、App 真流量证明保持。

### 已发布 RC 与最新源码不能混用

[RC 2026-09-22.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.73-rc.20260922.1)
为 `draft=false, prerelease=true`；标签实读指向 569ce865。详细签名、安装和下载证据见
[#280](https://github.com/raydocs/tono/pull/280)。这是此前明确授权后的历史交付，本次整理没有重发。

| 实际包 | SHA-256 | 已有资格及限制 |
|---|---|---|
| `Tono-0.0.73-build73-arm64.zip` | `fb4dc0f68987da54705b20c386426d631cb3a2659740d87965ff672f5332393f` | Developer ID/公证/Gatekeeper 通过；Apple Silicon、macOS 26.3+；非 Sparkle 客户发布或最新 v1 实机验收。 |
| `Tono_0.0.73_x64-setup.exe` | `e0837a2ab2f5126ae05f11188f9a7de469605453785888310cafb7f566ed0cad` | 原始 hosted fresh install/同版本 repair/uninstall/DNS 不变通过；无 Authenticode/updater 签名，`physicalUpgradeQualified=false`。 |

两包同源，包含 A/B 已合并产品修复和六项能力；不包含 C–F 后续源码。
本总账不创建新候选、不更新旧资产、不改客户源；不能把前一轮「未签名/未合并」的报告时点
套到整个线程，也不能把这一个旧 RC 的签名/安装证据套到最新源码。

### 查过什么，以及尚未查完什么

已重点检查：Windows 连接/切换/取消/重试/账户/凭据/失败上报、Service DNS/NRPT/WFP/网络事件、
两端安装更新；macOS AppState/协调器/helper/PF/DNS/audit；Worker 身份/目录/策略/诊断边界；
exit/home-agent、collector；相关 ops 证据、构建/测试/发布来源。深度和方法不同，详细覆盖矩阵
见 A 的三份报告；不是所有目录逐行审计、全 parser fuzz 或全并发状态空间穷举。

仍保留：

- [#26](https://github.com/raydocs/tono/issues/26) 的最新 v1 在已安装 macOS/Windows 11 上成功/失败
  更新、实际 successor/PF/WFP/DNS、重启与中断恢复证据。协议源码已接入，不代表此项已关闭。
- [#241](https://github.com/raydocs/tono/issues/241)、[#249](https://github.com/raydocs/tono/issues/249)、
  [#259](https://github.com/raydocs/tono/issues/259) 的设备/系统边界；[#251](https://github.com/raydocs/tono/issues/251)
  的后续代码仍待合并。Issue 开放不意味着表中已修代码不存在，也不该只凭代码关闭实机项。
- [#273](https://github.com/raydocs/tono/issues/273) 已有旧 RC 的签名执行证据，不能写成从未签名；
  但最新分支的新包/已安装 helper 资格仍未由旧 RC 建立。
- 真实线路 UUID/握手、运行中组件/配置身份、睡眠/Wi-Fi/IPv6/适配器变化、包级防漏、真实凭据库
  与报告回执；没有把 EOF 推断成特定网络原因，也没有实测 30–50% 提速。
- ops [#4](https://github.com/raydocs/tono/issues/4)、[#5](https://github.com/raydocs/tono/issues/5) 的计量
  边界/重置代际未解决；没有生产切换。一般 ops UI/digest freshness、未交付 Linux/CLI/移动端、
  无关第一方文件和第三方内部并未全部审计。

本次文档交付仅建立总账与以后同 PR 留记录的规则，归属 G1–G3 可追溯验收及已有 ops 证据。
历史检查均沿用其原 SHA/日志；不为整理文字重跑产品测试，不作新的合并、签名、部署或发布。
