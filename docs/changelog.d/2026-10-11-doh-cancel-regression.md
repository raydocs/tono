# 2026-10-11 · Windows：DoH 查询在途时取消的回归（预检缺口 #1563）

- 归属：SHIP_PLAN G2（取消/恢复）；#1563 预检列出的「DoH 已发出等待 → Cancel/Disconnect → 新登录」缺口。分支 `amp/doh-cancel-regression`，仅测试。
- 工程与测试：新增 `a_doh_query_in_flight_goes_with_a_cancelled_walk_and_the_next_request_uses_the_relays`：有隧道的遍历走到 DoH，
  本地解析器收到查询后不回答；随后发布 `Unarmed` 并丢弃该请求，断言查询连接在 1 s 内（早于它自己 2 s 超时）随遍历关闭，下一请求只走中继、
  不拨任何直连、不再发 DoH。生产代码不变（查询在遍历 future 内并发，见 #1553 修复）。
- 验证：本机 Linux `cargo test --lib tono::transport::tests::relay_only_without_tunnel::a_doh_query_in_flight -- --nocapture` 1 通过（0.62 s）。
  mutation 复核：把查询改为脱离的 `tokio::spawn` 后该测试失败（1 s 关闭断言，1.58 s），恢复后通过。真机/国内家宽未执行。仅源码测试，无新候选。
