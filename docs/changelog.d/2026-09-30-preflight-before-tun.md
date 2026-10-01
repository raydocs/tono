## 2026-09-30 · 第一次连接在装隧道前先证明 TCP

- 归属：SHIP_PLAN 客户连接路径。叠在后台探测分支上。不是 G4，不发客户包。
- 来源：`cursor/unarmed-background-heal-a925` `a88b1c36` → 本分支；未合 main。
- 缺陷修复：第一次连接如果出口静默丢包，以前会先装上 TUN/WFP，用户在握手超时前没有原网络。现在 VLESS 节点的 TCP 证明和服务就绪重叠；证明失败就不进入 `run_stages`，隧道不会装上。
- 新增/优化：60 秒内同一 `ip:port` 的成功证明不再等这一下。没有把 TUN 和握手并行，也没有缩短 10 秒 TUN / 12 秒首字节预算（没有实机数字）。Hysteria2 不能用 TCP 证明，这条路径不改它。
- 工程与测试：证明缓存的新旧判断在 `unarmed_probe::health_failure_uses_the_shared_disposition`。编排重叠没有单独的运行时测试。
- 验证：本机不能跑 `cargo test`（rustc 1.83 / edition 2024）。需要 CI。跨协议对打交给另一个性能代理，本 PR 不做。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Hysteria2 静默丢 UDP 时仍可能装上隧道。服务已就绪时，第一次连接多一次往返时间。没有实机阶段计时。

### 2026-09-30 续记 · 变基到当前后台探测

- 来源：重放到 `cursor/unarmed-background-heal-a925` `2753cddf`。证明失败仍然在 `run_stages` 之前返回。没有缩短 TUN 或首字节预算。

### 2026-09-30 续记 · 变基到已含 #703 的探测分支

- 来源：重放到 `cursor/unarmed-background-heal-a925` `2d9cd08f`。证明失败仍在 `run_stages` 之前返回。10 秒 TUN 和 12 秒首字节预算没有缩短。`FailOpen` 仍先释放再探测。

### 2026-09-30 续记 · 跟着重放到已含 #733 的探测分支

- 来源：`--onto` 重放到 `cursor/unarmed-background-heal-a925` `125721ef`（该分支已变基到 main `cbb4f56a`）。没有把 main 合并进来。TCP 证明失败仍在 `run_stages` 之前返回。预算没有缩短。助手协议仍是 `4.52.6`。

### 2026-10-01 续记 · 跟着重放到当前 #714

- 来源：`--onto` 重放到 `cursor/unarmed-background-heal-a925` `ffa9b3c0`。没有把 main 合并进来。TCP 证明失败仍在 `run_stages` 之前返回。10 秒 TUN 和 12 秒首字节预算没有缩短。助手协议仍是该基线上的 `4.52.8`。
