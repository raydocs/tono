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
