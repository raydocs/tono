## 2026-10-10 · Windows 无隧道时控制面只走 Tono 中继（决定 091）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 2026-10-10（所有者经 Puck 的决定，记为
  [决定 091](../decisions/091-2026-10-10-control-plane-relay-only-without-tunnel.md)，修订 077/086/090 的路径顺序）；Windows
  客户端 `apps/windows/app/src-tauri/src/tono/{transport.rs,commands/mod.rs}`，共享协议常量
  `apps/windows/service/src/{lib.rs,core/structure.rs}`。高风险：路由、断网保护恢复。
- 来源：基线 2ad39dba（main）→ 分支 `amp/win-relay-only-without-tunnel`；PR [#1553](https://github.com/raydocs/tono/pull/1553)；未合 main。
- 缺陷修复：原失败：没有隧道时（首次登录、续期、目录/权益检查、断网保护、掉线恢复），每个请求先付固定 IP（10 s）和系统
  DNS（10 s）的连接预算才轮到中继；到 Cloudflare 线路不通的客户，第二个中继约 24 s 才开始，第三个中继约 28 s，启动恢复
  30 s 预算里 refresh + `me` 走不完。改后：对生产 API 主机的请求只走中继：上次应答的中继在前，其余按 `API_RELAYS` 顺序，
  每个 `RELAY_CONNECT_TIMEOUT` 4 s 连接、45 s 总时长；不再尝试固定 IP、系统 DNS、DoH、备用端口、已起的本地隧道，所有中继
  都失败时不回退直连，错误以稳定前缀开头，供界面映射：`TONO_RELAYS_UNREACHABLE: relay 1 (<ip:port>) <阶段>: <原因>; relay 2 (…) …`，按 `API_RELAYS` 编号逐个列出（途中失去隧道时其后附 `; pinned[…]`）。三个死中继最多 12 s 连接；活的第三个约 8 s
  内到达。POST/DELETE 只在确证未送达时换下一个中继（`should_retry_transport` 不变）；`ApiClient` 的一次重试仍走中继，不回到
  直连优先；不并行，不新增刷新令牌的并发（`refresh_lock` 单飞不变）。有健康隧道时顺序不变。
- 新增/优化：状态来源 `control_plane_reach_of`（连接状态机 + Service 最后一次 kill switch 读数）：已连接、连接进行到
  `LockingTraffic` 及之后、或断开中且读数仍为 `Locked` = 隧道；否则状态机或读数 armed = 无隧道 armed；其余 = 未 armed。
  `commands::status_of` 每次发布状态时写入传输层（原子量），传输层在每个非中继步骤前重读，隧道在请求途中断掉时剩余直连步骤
  跳过、改走中继。例外：① 旧 Service：armed 无隧道且 Service 协议修订 < 20（W-A 在 19 落地但未上报），保持完整路径（其 WFP
  只放行 pin）；传输层只在需要时问一次 Service `GET /version`（1 s 上限），未应答视为未知、走完整路径；② 中继不服务的主机
  （集成环境、测试）保持完整路径；③ 更新器（`commands/update.rs`）不变：它请求另一个主机，判定不是同一个。Service 协议修订
  19 → 20（`MIN_SERVICE_REVISION_FOR_API_RELAY_PERMIT`，`ProtocolInfo::supports_api_relay_permit`），线上格式不变，
  `MIN_REQUIRED` 仍为 14。
- 工程与测试：传输层新增 9 个回归（`relay_only_without_tunnel` 模块）：无隧道时固定 IP/系统 DNS 从不拨号；两个黑洞中继后
  第三个在预算内应答且下一请求先走它（生产 4 s 预算，断言耗时）；全部失败时错误列出每个中继且不拨直连；中途取消停止遍历、
  不改记住的中继；有隧道时直连在前；途中失去隧道跳过剩余直连；旧 Service 保持完整路径；非 API 主机保持完整路径；状态机里
  隧道已死而读数仍 `Locked` 时不算隧道。Service 新增 `api_relay_permit_requires_revision_twenty`。三处测试构造改用
  `TonoTransport::from_parts`。
- 验证：见 PR；Windows 客户端与 Service 的 `cargo test` 由托管 Windows CI（`ci-gate`）运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无中国大陆实机证据；旧 Service 升级到修订 20 之前，armed 无隧道仍走旧路径；修订 19 且已带放行的 main 构建也按旧
  Service 处理（保守）；所有中继都下线时无隧道的控制面不可达（无直连回退，所有者选择）；中继运营方能看到无隧道时每个请求的
  客户端 IP、SNI、大小和时间。
- 续记（2026-10-10，独立审查 Sol @ 4a4b7c95：1 major + 1 minor，同一轮修复）：major F1：途中失去隧道的复查只在 DoH、
  备用端口、本地隧道三步的入口，步骤内部等待之后、端口之间不再复查；且 `relays_only` 在等 Service 探测（最长 1 s）之后不重读
  状态。改为：每一个真正的直连动作之前都复查（记住的备用端口、系统 DNS 优先、固定 IP、系统 DNS 回退、每个 DoH 查询及其后的
  直连请求、每个备用端口、本地隧道），一次遍历内一旦判定只走中继就锁存（`WalkGate`），之后不再放行任何直连；探测之后重读
  状态，状态已变则只按新状态和已缓存的放行判定、不再等待。minor M1：中继步骤期间隧道丢失且中继全失败时，错误改为
  `TONO_RELAYS_UNREACHABLE: …`（再走一遍中继作为唯一路径，每请求最多多一轮，种类仍可重试），其后附原 `pinned[…]; system-dns[…]; relay[…]`。
  新增 3 个回归：`a_tunnel_lost_mid_alternate_port_walk_dials_no_further_port_and_uses_the_relays`、
  `a_tunnel_lost_before_doh_sends_no_doh_query_and_no_direct_request`、`a_tunnel_lost_during_the_relays_ends_with_the_relay_unreachable_error`；
  为此 DoH 解析与备用端口的目标加了仅测试使用的本地替身（`StandIns`，生产为空、行为不变）。本机 `cargo check --tests --lib` 通过；
  `cargo test` 未在本机跑（磁盘不足），由 CI 运行。
- 续记（2026-10-10，Sol 复核修复轮 @ 636ce742：F1 major 未尽、M1 minor 部分）：F1：生产 DoH 只在 `resolve_via_doh` 之前复查，
  查询被 `tokio::spawn` 成脱离的任务，任务在 Disconnect 发布 `Unarmed` 之后才运行仍会直连发出，且赢得答案或父请求取消后其余查询
  仍在跑。改为：查询在本次遍历自己的 future 里并发（`FuturesUnordered`，不再 spawn），赢得答案、2 s 截止或遍历被丢弃时其余查询随之
  取消；每个查询发出前都经同一个 `WalkGate` 复查。DoH 测试替身改为走生产查询路径的本地解析器（按连接计数），不再是同步闭包。
  M1：最后一步本地隧道请求期间隧道丢失时，终止处只看 `gate.lost()`，错误仍是 `pinned[…]; system-dns[…]`；改为经同一闸门重读当前
  状态，再决定是否以 `TONO_RELAYS_UNREACHABLE` 走最后一轮中继。新增回归 `a_tunnel_lost_after_the_doh_check_sends_no_doh_query`、
  `a_tunnel_lost_during_the_loopback_request_ends_with_the_relay_unreachable_error`；去掉修复后两者都失败，恢复后通过。本机
  `cargo test --lib tono::transport`（Linux，资源文件用占位）35 通过。
- 续记（2026-10-10，#1553 合入 `62bab6ed` 后的 Sol M2 minor，单独小 PR）：`direct_step_allowed` 只在等待 `relays_only`（可能等
  Service 探测）之前看 `WalkGate`；DoH 查询现在并发调用它，A 恢复时看到 `Unarmed` 锁存，隧道又回来，B 恢复后仍被放行，违背“一次遍历内
  锁存不撤销”。改为等待之后再读一次锁存。回归 `a_step_waiting_on_the_service_probe_honours_a_latch_set_meanwhile`（去掉修复即失败）；
  本机 `cargo test --lib tono::transport` 36 通过。
