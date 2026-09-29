## 2026-09-29 · Windows：释放准入只读更新存储、已死租约不再挡释放、停止的 Service 原样启动
- 归属：SHIP_PLAN G1（§2 第 10 项「连不上且无下一手」，Windows 变砖排查）；影响 Windows Service
  （`update_transaction.rs`、`core/update.rs`、`core/server/mod.rs`、`core/server/handlers.rs`、`bin/install_service.rs`）
  与 App（`core/runstate/mod.rs`、`core/service/install.rs`、`core/service/mod.rs`、`tono/connection/disconnect.rs`）。
  发现 BRICK-W5（open）、BRICK-W2（in-PR，Service 半边）、BRICK-W10（open）、BRICK-W11（open）。
- 来源：基线 origin/main `c0e7758e`；分支 `fix/win-release-min-20260929`，红提交 `68ff29d4`（只加测试），修复提交
  `5a259afb`（Service）、`e0418d84`（App）；计划 PLAN-win-release-min rev 2（Jev-Decision 70500e68，计划审查
  00600860 → 2640cced），实现 Jev-Decision 87bca30d；PR [#681](https://github.com/raydocs/tono/pull/681)，未合 main。
- 缺陷修复：
  1. BRICK-W5 (d)：`ReleaseKillSwitch` 的准入原本走 `lifecycle_allowed` 与 `release_allowed`，两者都以写方式打开更新存储
     （重设 ProgramData\Tono 与 `updates-v1` 的私有 ACL、创建并 try-lock `transaction.lock`、重新发布 `state.json`）；
     另一进程持锁、磁盘满导致重写或 ACL 写失败时，没有更新也没有安装程序在跑，Disconnect 也被拒绝。改后：释放准入
     （新 `OwnerLifecycleGate::ArmedPolicyRelease`）用 `Store::read_state` 只读：不取锁、不重写、不重设 ACL；根目录仍须
     非重解析点且 ACL 为私有 ACL，未提交的更新尝试仍拒绝。其余路由仍走 `lifecycle_allowed`。
  2. BRICK-W2 的 Service 半边：卸载在「Tono 正在运行」处取消后留下的手动租约，在持有者退出后仍挡释放；App 重启后
     `adopt()` 置 INCOMPLETE，显式 Disconnect 先发的更新 `Status` 探测也被租约拒绝（35f8b312/codex:F7）。改后：持有者
     确认死亡（PID 不存在或已退出，或同 PID 的创建时间不同；读取失败一律视为活着）时，释放准入与 `Status` 放行；
     连接、其余更新请求、修复与启动 Core 恢复仍被挡，Service 不清除租约。
  3. BRICK-W5 (e)：SCM 停止 TonoService 后 WFP 仍武装，释放路径只能走完整修复，而修复的 `manual_gate` 在有过滤器时拒绝。
     改后：SCM 报告 Stopped 时，释放路径经 Run State 的特权操作槽（与修复同样的准入、150 秒上限与超时隔离）运行
     `tono-service-install.exe --start-registered`，原样启动已注册的 Service，一次 UAC；注册路径、启动类型或已安装
     二进制摘要校验不过时 helper 退出 74，App 退回原修复路径。Repair 按钮不变。
- 新增/优化：`tono-service-install.exe --start-registered`（持修复锁；只在 Service 停止且注册路径为
  `install_dir\tono-service.exe`、启动类型非 Disabled、已安装二进制为普通文件且与随包 `tono-service.exe` 摘要一致时
  启动；放开修复锁后等待就绪；退出码 0 成功、74 目标未校验、75 另有安装/卸载/修复在跑、1 其他失败）。不改 IPC、
  不升协议、不改客户文案。
- 工程与测试：新增 T1 `core::update::tests::update_release_admission_passes_only_a_conclusively_dead_lease_holder`、
  T2 `update_transaction::tests::update_release_read_takes_no_lock_and_rewrites_nothing`、
  T3 `core::update::tests::update_status_passes_only_a_conclusively_dead_lease_holder`、
  T4 `windows_start_registered_starts_only_a_stopped_verified_service_and_waits_without_the_gate`、
  T7 `windows_start_registered_target_must_be_the_installed_path`（`bin/install_service.rs`）、
  T5 `the_release_path_starts_a_stopped_service_and_repairs_only_what_the_start_cannot`、
  T6 `the_release_start_is_admitted_and_quarantined_like_a_privileged_operation`（`core/service/tests.rs`）。
  `update_transaction` 的加载逻辑抽成 `load`（锁内打开照旧 reaffirm），`perform` 的有界等待抽成 `bounded_privileged`
  （文案与健康处理不变）。
- 验证：MacBook 未运行 cargo、Tauri 或 Windows 构建。
  - 红（`68ff29d4`，只加测试）：Windows CI [36547279432](https://github.com/raydocs/tono/actions/runs/36547279432)
    failure，符合预期：service 作业「Test the service lifecycle」编译失败 `could not compile tono-service-protocol (lib test)
    due to 12 previous errors`（E0425 `release_admission_at`、`update_lease_gate`、`holder_conclusively_dead`；E0599
    `Store::read_state`）；app-rust 作业「Test the Tauri crate」编译失败 `could not compile tono-windows (lib test) due to
    6 previous errors`（E0425 `ready_or_start_with`、`start_registered_under_run_state`、`StartTargetUnverified`）；
    core、app 作业通过。
  - 修复（`e0418d84`）：Windows CI [36548431140](https://github.com/raydocs/tono/actions/runs/36548431140) success，
    四个作业全绿。service 作业中 T1、T3 在「Test native update admission and independent executor」（过滤
    `core::update::tests::update_`）与「Test the service lifecycle」均为 ok，T2 在过滤 `update_transaction::tests::update_`
    的步骤为 ok，T4、T7 在「Test the service lifecycle」的 bin 单测中为 ok；app-rust 作业 T5、T6 为 ok，
    `privileged_operation_timeout_quarantines_the_slot_until_restart` 不变且为 ok（lib 555 passed）。
    PR head 上的记录提交只改 `docs/`，其 CI 结果见 PR。
  - 未执行：实机场景（计划 §9.4 1–6：停止 Service 后 Restore internet；卸载取消后 Disconnect 与重启后横幅；活着的卸载
    程序仍拒绝；Run State 隔离后拒绝；替换已安装二进制后 74 退回修复）；U1–U6 未在 Windows 上确认。
- 候选/发布：仅源码，无新候选。
- 剩余限制：
  - 本 PR 不含管理员释放（W5 a、b）与另一用户已登出时的释放（W5 c），见 PLAN-win-admin-release。
  - App 启动时 INCOMPLETE 若因租约以外的原因置位（存储当时写不开或被锁、修复锁被占、App 镜像无法证明），Restore
    internet 仍停在 `Status` 探测，横幅与拒绝退出照旧（BRICK-W10）；账户登出路径不发更新探测，被挡时能否走到未核实。
  - 已死租约挡连接，直到下一次安装程序替换它；连接错误仍指向手动安装程序，未改提示文案。
  - 租约 PID 被 Service 打不开的进程（System、Registry、Memory Compression 等）复用时视为活着（U2）。
  - 原样启动需要一次 UAC；注册或已安装二进制校验不过（缺失、被换、Disabled、注册到别处）时退回原修复，多一次 UAC，
    有过滤器时仍被 `manual_gate` 拒绝，与 main 相同。推迟到重启的替换在重启前校验不过。启动可能先按记录运行 Core
    数秒再被释放停止，与开机相同。Disabled 的 BFE 不改。
  - 另一特权操作在跑时 Restore internet 以「service operation already running」拒绝；helper 超时（150 秒）后以
    「restart Tono before retrying」拒绝直到 Tono 重启，与修复路径今天的行为相同。
  - helper 仍持修复锁时，启动中的 Service 派生的恢复执行器取锁失败，下次 Service 启动或开机重试（A10）。
  - `updates-v1` 目录 ACL 不是私有 ACL 时释放被拒，直到写路径打开重设 ACL。
  - BRICK-W11 未改。
  - U1–U6 需要 Windows 实机或设备确认：U1 20 秒就绪等待是否够慢机器；U2 同上；U3 nsExec 下租约持有者即 NSIS 进程；
    U4 SCM 报告的二进制路径无参数；U5 7422 横幅即 BRICK-W10；U6 `runas` 1.2.0 转发 `--start-registered` 并返回退出码。
