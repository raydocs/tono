## 2026-10-10 · Windows 控制面路径链：系统 DNS 一步限 10 s，中继进得了启动恢复预算
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）；`apps/windows/app/src-tauri/src/tono/transport.rs`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-cn-relay-walk-budget`；未合 main。
- 缺陷修复（[WIN-RESTORE-RELAY-UNREACHED](../findings.d/WIN-RESTORE-RELAY-UNREACHED.md)）：固定 IP 丢包时，路径链的系统 DNS 一步仍用 30 s 连接预算；
  DNS 被污染到丢包地址或解析没有应答时，第一个中继 40 s 后才开始，30 s 的启动恢复预算在这一步就到期，恢复从不尝试中继。
  改为系统 DNS 一步与固定 IP 同用 10 s 连接预算（reqwest 的连接预算含解析、TCP、TLS 握手），无论它在固定 IP 之前（#583 偏好）还是之后；
  原来专为偏好情形另建的 `resolved_first` 客户端随之合并到 `resolved`。中继 1 死时中继 2 约 24 s 内开始（10 + 10 + 4）。
- 新增/优化：无。路径顺序、送达规则（POST/DELETE 只在连接阶段失败时换路径）、中继/DoH/备用端口预算、WFP 均不变。
- 工程与测试：新 `#[tokio::test]` `a_dead_direct_path_and_a_dead_first_relay_leave_the_second_relay_inside_the_restore_budget`：
  生产预算的客户端，固定 IP、系统 DNS、中继 1 全丢包，登录 POST 须由中继 2 在 `RESTORE_TRANSACTION_TIMEOUT` 内应答并记为下一跳。
  `restores_refresh_and_me_pay_the_dropped_pins_once` 的夹具改用同一构造函数。
- 验证：本机（Linux orb）不跑 `src-tauri` 的 cargo（工具链自动安装）；以托管 Windows CI `ci-gate` 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：故障为模拟，非中国现场；已建立 TLS 后响应卡住的 GET 仍要等 45 s 总超时；armed 时中继不可达（decision 077，未改放行表）。
