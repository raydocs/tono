## 2026-10-10 · 两端登录前网络自检（只握手，结果存 24 h）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A4](../ops/amp-backlog-2026-10-10.md)（D14-A：登录前允许探测，只握手、不带身份；
  [decision 079](../decisions/079-2026-10-10-amp-backlog-defaults.md)）；macOS `ControlPlanePath.swift`、`TonoAPIClient.swift`、
  `AccountSession+Auth.swift`；Windows `tono/path_probe.rs`（新）、`tono/transport.rs`、`tono/commands/restore.rs`。
- 来源：基线 39edde90（main）→ 分支 `amp/a4-first-launch-probe`；PR 待开；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的首次登录一侧。原：没有走过中继的设备（新装、
  换网络、进程刚起），第一次登录先付系统 DNS / 固定 IP 的连接超时才轮到中继。改后：未登录启动（登录页即将出现）时，
  后台并行探系统 DNS、固定 IP、中继三条路径，每条 ≤5 s，只做 TCP + TLS 握手（API 主机名作 SNI、默认证书校验：
  mac 系统信任评估，Windows 与 reqwest 相同的 platform verifier）；不发 HTTP、不带 cookie/令牌/设备 id/`X-Tono-*`。
  按两端各自原有顺序取第一条握手通的路径，种进**已有**的路径偏好（mac `preferredPathLabel`，存 app profile 24 h；
  Windows `prefer_resolved` / `preferred_relay`，另存 `<tono 数据目录>/control-plane-path.json` 24 h，下次启动在第一个请求前读回），
  登录第一跳即走它。偏好失败时按原顺序回退、原重试规则不变：可能已送达的 POST 不重发。全部不通或探测期间已有真实
  应答改了偏好时，探测结果不采纳。不加 PF/WFP 放行：armed 时被拦的路径只是探测失败。UI 不等探测。
- 新增/优化：mac 审计事件 `control_plane_path_probe`（各路径 reached/failed/not_probed、采纳哪条、耗时，不含地址与身份）；
  Windows 日志一行同样内容。
- 工程与测试：XCTest `testAPreLoginProbeThatReachedOnlyTheRelaySendsTheFirstSignInThereUntilItIsADayOld`（探测只通中继 →
  下次启动第一次登录直接到中继、不碰系统 DNS；记录改成 25 h 前 → 系统 DNS 先走）；`#[test]`
  `a_cached_relay_probe_sends_the_first_sign_in_to_the_relay_until_it_is_a_day_old`（缓存「中继通」→ 第一次 POST 由中继应答；
  超过 24 h → 忽略，固定 IP 先应答）。Windows 新增直接依赖 `rustls-platform-verifier 0.7.1`（已在锁文件中，reqwest 同版本），
  `Cargo.lock` 只给 `tono-windows` 加了一行依赖名。
- 验证：Linux orb 上把 `path_probe.rs` 放进临时 crate（真实 tokio / tokio-rustls / rustls-platform-verifier，桩掉 bootstrap 与 transport）
  `cargo +1.95.0 check --offline` 通过、future 为 `Send`；对真实 `api.afk.ccwu.cc` 固定 IP 握手成功（约 120 ms），
  把固定 IP 换成 8.8.8.8 时证书校验失败、退到 `system_dns`。XCTest 与完整 src-tauri `cargo test` 只在 hosted CI（ci-gate）跑：待记。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有便宜的网络标识，缓存按 API 主机全局 24 h（换网络后最多付一次偏好失败的连接预算再回到原顺序）；
  只在未登录启动时探测，登出后回到登录页不重探；Windows 的缓存只由探测写，真实请求改的偏好仍只在进程内存；
  握手通不等于 HTTP 通（偏好失败即回退）。实机未测。
