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

## 2026-09-22 · Windows 加密 DNS 旁路捕获文件损坏改为隔离恢复，不再永久拒绝断开

- **归属/来源**：G1 断开与恢复（旁路文件损坏不得成为 Disconnect 的永久阻断）；缺陷编号
  R3-F2（已确认，源码推导级：代码路径确定，仅掉电产生损坏文件未实机验证）。基线为
  叠枝父提交 `9c8e5f13`（`fix/windows-dns-merge-guard-20260922`，PR #300），分支
  `fix/windows-dns-sidecar-recovery-20260922`，叠在其上；关联 PR 见
  `raydocs/tono` compare。本条提交时为独立修复分支，不沿用任何 main 合并授权。
- **缺陷修复（三个面）**：
  (1) 旁路文件非原子落盘且存在即永不重写：`protected-secure-dns.json` /
  `protected-interface-doh.json` 用 `std::fs::write(tmp)`+`rename` 无数据 flush，严格弱于
  主快照的原子写；损坏（0 字节/截断）后无人重写、无人删除。现在捕获文件改用与主快照
  同级纪律（temp → write_all → sync_all → `atomic_file::replace_blocking`
  `MOVEFILE_WRITE_THROUGH` 改名，参照 `core::desired` 的数据先于改名 flush 顺序），suppress
  侧保留“可读即保留”的跨升级语义，但缺失或不可读时按守卫重写——只有当在位值不是本
  build 写入的压制值（`EnableAutoDoh≠0` / 非空 DoH 模板集）才重新捕获，自身压制值永不
  被记作“原始值”。
  (2) 损坏后 `restore_encrypted_dns` 对 `read_capture_file()`/`restore_interface_doh()`
  解析错 `?` 硬拒，`restore_resolver_policy` 四个调用点（无快照分支、证明通过后、损坏
  快照恢复、卸载 rung 2）全部被阻，每次重试读同一文件，产品内无出口；suppress 早夭的
  会话（读捕获失败发生在写 `EnableAutoDoh=0` 之前，策略根本未压制）同样被砖。现在
  restore 侧对不可读捕获隔离（改名保留 `*.corrupt-<ts>.json`，参照主快照 quarantine
  模式）后按“无捕获”语义继续：在位值即恢复结果，新标记
  `TONO_DNS_CAPTURE_QUARANTINED` 随 `last_error` 在**成功**恢复上透出（App 按警告面
  显示）。选择“保持现状而非猜测 Windows 默认值”的依据：早夭面在位值就是用户原值，
  主动写猜测默认值会破坏它；suppress 已写入的面在位值为 0，恢复后用户可在设置中重新
  打开，损失被标记而非沉默。核心不变量：旁路文件损坏不得成为 Disconnect 的永久阻断，
  也不得伪造“已恢复加密 DNS”的正面证据（两者均不假）。
  (3) 卸载/紧急路径：`restore_for_uninstall` 不再因旁路文件损坏在 rung 1 早退（同一
  隔离处理），WFP 拆除后 `EnableAutoDoh=0`/`DohFlags=0` 残留从“静默永久”变为“已标记
  可修复”；跨卸载/重装存活的损坏旁路文件（卸载器不清持久目录）重装后首个 Disconnect
  不再被砖。触发序列与逐环核实见 R3 审查报告 F2 及 V6 对抗核实（两处加重面）。
- **新增/优化**：无新功能；`atomic_file` 新增阻塞线程用的同步 `replace_blocking`
  （同 `MOVEFILE_WRITE_THROUGH` 标志，供 DNS engine 在 `bounded_dns_call` 的阻塞线程上
  使用）。
- **工程与测试**：一个窄回归（native 域，native_apply_tests.rs）
  `corrupt_interface_doh_capture_is_quarantined_not_a_permanent_refusal`：enable 种正常快照后
  使适配器离网（文档化的 "vanished counts as proven" 恢复面）并写 0 字节
  `protected-interface-doh.json` → `facade::restore_protected()` 必须走证明路径成功、
  `last_error` 含 `TONO_DNS_CAPTURE_QUARANTINED`、离网适配器注册表原始值被恢复、旁路文件被
  隔离（0 字节内容保留）、主快照正常退役（当前实现每次以 "interface DoH capture is not
  JSON" 解析错误失败）。suppress 早夭加重面由同一解析容错路径结构性修复，但 suppress 在
  夹具下保持短路，未并入断言。夹具扩展：`test_io::Machine` 增加 `capture_dir` 改道（两个
  捕获路径像 `snapshot_path()` 一样重定向），`restore_encrypted_dns` 的整体测试短路收窄为
  注册表操作走夹具键表（`delete_key`/`write_dword`/`delete_value`/`write_qword` 增加
  test_io 改道，`key_exists`/`enum_subkeys`/`write_sz`/`read_sz` 原有），文件读写/隔离走真
  逻辑，宿主 NRPT/DoH 策略仍不可触碰；`Machine::legacy` 对空批提前返回（恢复一个全部
  适配器已离网的快照会以 Restore 模式到达空调用），非空 restore/DHCP 批仍被拒。
- **验证**：按所有者 2026-09-14 执行位置决定，本机（MacBook）未运行任何 cargo
  build/test/check/clippy，只做编辑与源码自查；回归委托本 PR 的 GitHub-hosted
  `windows-2025` Service CI：lifecycle `cargo test --locked --features standalone,client,test`
  与 native DNS 前缀命令（`cargo test --locked --features standalone,client --lib
  core::dns::engine::native_apply::tests::`，前置 `-- --list` 防零测试，与 windows-ci.yml
  现有步骤一致）。提交时未获得结果；准确源码 SHA、实际 CI 输出与续记保留在关联 PR。
- **候选/发布**：无新包，仅源码；不部署、不触碰 `appcast.xml` / `windows-updates` /
  `latest.json`。
- **剩余限制**：不放宽任何保护（NRPT 删除与策略注册表写失败仍 fail-closed 且可重试；
  隔离只作用于捕获文件本身）；损坏文件的原值不可恢复，只能隔离保留供手工诊断；
  未验证 Windows 11 实机断电产生的真实损坏文件；未把旁路文件纳入卸载器恢复状态清扫
  （verify-V6 可选项，修复后残留只影响标记面不再阻断）；suppress 侧的隔离与"在位值为
  自身压制值时不重捕获"只记引擎日志（该路径本就 warn 级，且后续 record_outcome 会清
  `last_error`），用户可感知面由 restore 侧标记承担；enable 恢复路径上的隔离同样只记
  日志；夹具通过不等于 G1 实机验收。

## 2026-09-22 · Windows 快照合并与损坏恢复不再把 TUN DNS 地址记为原始值

- **归属/来源**：G1 断开与恢复（Disconnect 不得被污染快照永久拒绝）；缺陷编号 R3-F1
  （新根因，与 #293 的混合值判定、#290 的 protect 侧 pending 保留不同轴）。基线
  main `576d7087`，分支 `fix/windows-dns-merge-guard-20260922`；
  [差异与关联 PR](https://github.com/raydocs/tono/compare/main...fix/windows-dns-merge-guard-20260922)。
  本条提交时仍是独立修复分支，不沿用任何 main 合并授权。
- **缺陷修复（两面同一根因）**：
  (a) `merge_snapshot` 对快照已存在时新纳入的适配器无 Tono 值检查、GUID 用精确 `==`
  比较。一个（重新）激活时注册表已带 `198.18.0.2` 且不在快照内的适配器会被以该值
  作为“原始 DNS”追加落盘；此后每次 Disconnect 把 `198.18.0.2` 写回该适配器并在证明
  阶段被 `any_loopback` 无条件拒绝，产品内无出口。现在对“尚未记录原始值”的适配器
  子集应用与无快照分支相同的 orphan 守卫与 DHCP heal 语义（新标记
  `TONO_DNS_ORPHANED_ADAPTER`），GUID 比较统一为忽略大小写，已记录的原始值不受影响。
  (b) `recover_unreadable_snapshot` 只读 active 适配器：损坏/缺失快照恢复期间 inactive
  适配器上残留的 `198.18.0.2` 无人读、无人清，适配器回网后经 (a) 污染合并。现在恢复
  证据改为枚举注册表 `Tcpip(6)\Parameters\Interfaces` 全部子键（新 engine 读取
  `collect_interface_key_adapters`，沿用隧道排除），inactive 残留同样拒绝恢复直至
  操作员清理，判定谓词与原 `any_loopback` 完全相同（同注册表读、更大范围）。
  触发序列与逐环核实见 R3 审查报告 F1 及 V6 对抗核实。
- **新增/优化**：无新功能；只收紧“什么可以成为原始值/什么可以证明恢复”的证据面。
- **工程与测试**：两个窄回归（每行为一个）：stub 域
  `a_fresh_adapter_already_on_tono_dns_is_never_recorded_as_original`
  （dns/tests.rs，快照存在 + fresh 适配器带 TUN 端点 → enable 拒绝、快照不被污染，
  当前实现在落盘后必败）；native 域
  `corrupt_snapshot_recovery_refuses_over_an_inactive_leftover_tun_dns`
  （native_apply_tests.rs，损坏快照 + 仅存在于注册表的 inactive 适配器 → 恢复拒绝、
  证据保留、零写入；清理后恢复完成并隔离旧文件）。夹具扩展仅一处：OS I/O 隔离
  Machine 增加 `subkeys` 注册表枚举，使 `enum_subkeys` 在夹具激活时改走夹具键表，
  不触碰宿主注册表（该 helper 原无夹具路径，DoH 枚举在夹具下本就被 suppress/restore
  短路，行为不变）。
- **验证**：按所有者 2026-09-14 执行位置决定，本机（MacBook）未运行任何 cargo
  build/test/check/clippy，只做编辑与源码自查；回归委托本 PR 的 GitHub-hosted
  `windows-2025` Service CI：lifecycle `cargo test --locked --features standalone,client,test`
  与 native DNS 前缀命令（`cargo test --locked --features standalone,client --lib
  core::dns::engine::native_apply::tests::`，前置 `-- --list` 防零测试，命令与
  windows-ci.yml 现有步骤一致）。提交时未获得结果；准确源码 SHA、实际 CI 输出与
  续记保留在关联 PR，不把上一轮 main 的绿灯移用到本修复。
- **候选/发布**：无新包，仅源码；不部署、不触碰 `appcast.xml` / `windows-updates` /
  `latest.json`。
- **剩余限制**：不放宽任何保护（含 TUN DNS 地址的适配器在所有路径都不得被记为
  “已恢复原始值”；#293 混合判定与 #290 缺失适配器 pending 语义不变）；未验证
  Windows 11 实机断电产生的真实损坏文件与 inactive 适配器回网时序；emergency 后
  依赖操作员按拒绝信息清理适配器 DNS；夹具通过不等于 G1 实机验收。

### 2026-09-23 续记 · lifecycle CI 4 项既有测试失败：恢复证据在 test 构建丢失 loopback hook

`9c8e5f13` 的 lifecycle 步骤 307 通过 / 4 失败（push 与 pull_request 两个 run 的 service
job 同因，[失败日志](https://github.com/raydocs/tono/actions/runs/35820994514/job/107052595536)）：
`disarm_is_refused_until_dns_restore_is_proven`、
`emergency_disarm_removes_wfp_intent_but_reports_unrestored_dns`、
`release_is_refused_until_dns_restore_is_proven`、
`release_when_not_armed_still_attempts_dns_restore_best_effort`。属本条 (b) 引入的
**测试域回归**（非产品缺陷、非编译错误）：`recover_unreadable_snapshot` 的 any-loopback
证据从 `engine_any_loopback`（test-feature 构建读 `set_live_dns_on_loopback`，是模块
文档化的“restore 不可证明”夹具渠道）换成注册表视图谓词后，test 构建里该视图取
`test_hooks::collected_adapters()` 的空默认值，四个夹具用 hook 表达的“机器仍在 Tono
DNS 上”不再被听见——损坏快照被误判可以隔离，disarm 门随之打开（应 Err 得到 Ok）。
同分支的 `unverified_startup_intent_stays_blocked_until_core_and_dns_reconcile` 等其余
用例不受影响。修复为窄谓词 `registry_interfaces_read_as_tono_dns`：生产
（`not(feature = "test")`）分支保持注册表全集判定不变，test-feature 构建 OR 回
`live_dns_on_loopback`（只更 fail-closed，永不 AND），native 域与 stub 域两个新回归、
既有夹具语义均不动，**未修改任何测试夹具**。验证仍按所有者 2026-09-14 执行位置决定
本机零 cargo，委托同一 `windows-2025` CI 重跑；本续记提交时未获得结果，不预支绿灯。

### 2026-09-23 续记 2 · 审查意见：注册表视图的名称无关 TUN 排除与子键枚举截断

- **缺陷修复（审查 P1）**：上文“沿用隧道排除”不准确——注册表视图无 LUID，只剩
  `Connection\Name == "Tono"` 一道排除。若 wintun 设备删除后
  `Tcpip\Parameters\Interfaces\{tunGUID}\NameServer = 198.18.0.2` 残留而 `Connection\Name`
  随设备消失，损坏快照后的每次 Connect 都会以 `tono_dns=true` 永久拒绝。现在注册表
  视图另加名称无关排除 `is_inactive_tunnel_interface_key`：键**不在**当前活跃集、IPv4
  `NameServer` **恰为** `198.18.0.2`、其余三值（IPv4 `ProfileNameServer`、IPv6 两值）
  全空/缺失——这是 TUN 入站 `dns_address` 经接口 DNS API 写出的形状；Tono 自己的
  protected apply 总是同时写 IPv4 `NameServer` 与 `ProfileNameServer`，所以被 Tono
  重定向过的真实适配器（含 inactive）、混合值（#293）、legacy loopback、活跃适配器均
  仍计入证据、仍拒绝假恢复。被误判为 TUN 形状的真实适配器若回网，会在 enable 中作为
  “未记录”适配器由 (a) 守卫 heal 或拒绝，不会成为污染原始值。
- **缺陷修复（审查 P2）**：`enum_subkeys` 原 `0..64` 静默截断；改为无上限枚举直到
  `ERROR_NO_MORE_ITEMS`，其他状态返回错误，不再把不完整集合当完整证据
  （Hyper-V/WSL/Docker 机器常超 64 个接口 GUID）。
- **测试/夹具修正**：不新增测试。修改既有 native 回归
  `corrupt_snapshot_recovery_refuses_over_an_inactive_leftover_tun_dns`：{B} 夹具改为
  Tono apply 实际写出的形状（`NameServer` + `ProfileNameServer`），并加入仅
  `NameServer=198.18.0.2` 的已删除 TUN 键 {C}；清理 {B} 后恢复必须在 {C} 存在时完成。
  修改前的分支上第二次 `enable()` 会被 {C} 以 `tono_dns=true` 拒绝，测试必败。
- **验证**：本机（MacBook）未编译、未运行 cargo，委托本 PR 的 `windows-2025` CI；
  提交时未获得结果。
- **剩余限制**：TUN 键形状是按 sing-tun/Windows 接口 DNS API 行为推断的，**未实机
  核实**。需在 Windows 验收机 Disconnect（wintun 删除）后查：
  `reg query HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{tunGUID}`
  是否残留 `NameServer`、是否带 `ProfileNameServer`，以及
  `HKLM\SYSTEM\CurrentControlSet\Control\Network\{4D36E972-E325-11CE-BFC1-08002BE10318}\{tunGUID}\Connection /v Name`
  是否消失。若 TUN 键实际带有 `ProfileNameServer` 或 IPv6 值，本排除不生效，损坏快照
  后 Connect 仍会被拒（fail-closed，不泄漏），需改为持久化 TUN GUID 的排除。

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
