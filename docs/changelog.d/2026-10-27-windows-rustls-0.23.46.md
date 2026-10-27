## 2026-10-27 · Windows App 的 rustls 升到 0.23.46
- 归属：运维计划（依赖安全）；`apps/windows/app/Cargo.lock`。
- 来源：分支 `amp/windows-rustls-0.23.46`（基线 origin/main `668ded58c`）；未合 main；仅源码，无新候选。
- 缺陷修复：Dependabot #84–#87（rustls < 0.23.46：Session 的 Debug 输出含 TLS 主密钥与恢复 PSK〔中〕、Brotli 证书解压在认证前最多分配 1 GiB、未认证的 ServerHello 让之后的 ClientHello 只带经典 X25519、ECH 拒绝时缓冲数据泄给外层服务器〔低〕）。锁文件 0.23.45 → 0.23.46：两版依赖要求逐项相同（crates.io 索引），校验和与 crates.io 索引、下载包的 SHA-256、`tono-plugin-core` 锁文件中已用的 0.23.46 三者一致；`Cargo.toml` 不变（`^0.23.44`）。
- 新增/优化：无。读码未见 App 对 rustls 会话做 Debug 格式化（`path_probe.rs`、`transport.rs` 只建配置、握手、匹配证书错误），中危一项在本仓库代码中没有已知触发点；依赖库内部未逐一核查。
- 验证：本 orb 无 cargo，未本地编译；以 ci-gate 的 Windows app-rust 作业编译与测试为准。
- 剩余限制：控制面误入的 `pnpm-lock.yaml`（undici 告警 #83、#89–#92）仍待其去留决定。
