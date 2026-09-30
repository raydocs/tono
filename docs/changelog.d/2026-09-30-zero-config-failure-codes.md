## 2026-09-30 · 登录与连接失败给出支持码，自愈不改系统网络

- 归属：SHIP_PLAN §2 第 10 项（连不上且无下一手）。影响 Windows 登录/连接、tono-core、macOS 失败文案与隧道丢失后的释放选择。
- 来源：基线 origin/main `d2363002`；分支 `cursor/failure-taxonomy-bba0`；未合 main。
- 缺陷修复：登录、验证码和连接失败原先要么把「换网络 / 换节点 / 检查连接」当成解决办法，要么只给笼统的不可达。现在每个失败有稳定 code 和 stage（DNS、TCP、TLS、QUIC、API、超时、时钟、门户、本机冲突、隧道）。用户看到短句和支持码。完整原因仍走现有 telemetry 字符串里的 `TONO_` / `CORE_` 标记，没有第二套上传。
- 新增/优化：登录在直连钉扎和系统 DNS 之后，对 API 主机再试 DoH（只问 1.1.1.1，不改系统 DNS）、备用 HTTPS 端口，以及已经存在的本机回环隧道。这些步骤不安装 WFP/PF、不改路由。耗尽后默认释放回原来的网络；只有用户明确选择 `permanent` 严格断网保护才保持阻断。macOS 上隧道连续丢失走同一条 fail-open 判定。
- 工程与测试：`customer_failure` 覆盖每个 code 和回退顺序。Windows `plan_failure` 增加严格断网参数。
- 验证：本机 Linux 跑 `cargo test -p tono-core customer_failure` 与 Windows 前端 vitest（见 PR）。未跑 xcodebuild、未跑 Windows 原生 cargo。macOS XCTest 未执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：DoH、备用端口和回环隧道没有在真实故障网络上验证。macOS 多数健康检查路径仍按原样保持保护，只有隧道丢失判定改为 fail-open；其余路径需要实机再改。释放失败时屏障可能仍在，这不是新的放行。Windows 这条路径没有用户「permanent」开关，因此耗尽后一律释放。DNS 设置按钮还在，失败句子不再把打开设置写成解决办法。
