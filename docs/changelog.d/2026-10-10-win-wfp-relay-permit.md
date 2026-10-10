## 2026-10-10 · Windows 无隧道 armed 时控制面可经 Tono 中继（所有者 W-A）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 2026-10-10（所有者决定 W-A，2026-10-10 直接批准
  「按你说的改」）；Windows Service WFP 规则 C `apps/windows/service/src/core/wfp_model.rs`、共享常量
  `apps/windows/service/src/lib.rs`、Windows 客户端 `apps/windows/app/src-tauri/src/tono/bootstrap.rs`。
- 来源：基线 f549a28e（main）→ 分支 `amp/w-a-wfp-relay-permit`；PR 待记；未合 main。
- 缺陷修复：原失败：保护 armed 而无隧道时（Bootstrap、Blocked / 断网保护、严格模式保持关闭），WFP 规则 C 只放行
  Cloudflare 地址，中继 `IP:2053` 被 Tono 自己的防火墙挡住；对到 Cloudflare 线路不通的客户（决定 077 的场景），这段
  时间登录、续期、取目录都不可能。改后：规则 C 在原有 Cloudflare 条目之外，为每个编译中继渲染一条放行：
  `AleAppIdTonoApp` + 远端地址 /32 + TCP + 远端端口（今天 `179.253.233.220:2053`、`179.255.154.17:2053`），与
  Cloudflare 条目同层、同权重、非持久。只在规则 C 本来渲染通道时出现：`Locked`（已连接）、没有安装路径、没有任何
  已接纳 API 地址（无主应急封锁）时都没有。客户端路径顺序不变，中继在 armed 时从未被跳过，只是以前被 WFP 挡住。
  决定 [090](../decisions/090-2026-10-10-windows-armed-control-plane-via-relays.md)（修订 077）；发现 H1-F5 Windows 说明已更新。
- 新增/优化：中继列表只剩一处：`tono_service_protocol::API_RELAYS`（`Ipv4Addr` + 端口，编译期常量，不解析 DNS、不经
  IPC），客户端 `bootstrap::API_RELAYS` 改为它的再导出。Cloudflare pin、学到的地址、`CONTROL_PLANE_PORTS` 条目不变
  （所有者选择保留）。过滤器命名空间 v13 → v14（`…9e0d…`），升级时按键整体替换。Service 协议修订号不变：旧 Service
  只会继续挡住中继，客户端照旧走下一条路径。
- 工程与测试：两条 `#[test]`：`bootstrap_channel_adds_exactly_the_tono_relays_for_the_tono_app_over_tcp`（字面钉住
  中继列表；Bootstrap / Blocked 下规则 C 中非 Cloudflare 的条目恰好是每个中继一条，条件向量逐项相等，仲裁：Tono 程序
  TCP 放行，其他进程、UDP、443 端口均封锁；Locked 与无 API 地址时没有）；`bootstrap_channel_keeps_the_cloudflare_entries_unchanged`
  （两个 pin × 六个端口，键、名称、层、权重、条件与改前一致）。命名空间钉住测试同步改为 v14。
- 验证：本机（Linux）未跑 Service `cargo`（按任务）；用 `rustc --test` 单独编译 `wfp_model.rs`（`structure` 用桩、
  `lib.rs` 三个常量原样抽取）：`test result: ok. 36 passed; 0 failed`；反证：去掉中继渲染段后新测试失败
  （`left: 0 right: 2`），Cloudflare 测试仍过。`rustfmt --check` 新增段落无差异。Service `cargo test` 与客户端编译由托管
  Windows CI 运行：待记。
- 候选/发布：仅源码，无新候选。
- 剩余限制：第三个中继 `38.14.195.144:2053`（#1538）未合入，未加入，合入后在同一常量和测试字面量里补上并升命名空间；
  armed 时系统 DNS 一步的预算（#1518）未合入，中继前仍可能先等系统 DNS 超时；未实机验证（断网保护下经中继登录、
  `netsh wfp show filters` 读回中继条目）；Tono 程序自身仍可经 Cloudflare pin 到达共享 anycast（所有者选择保留）。
