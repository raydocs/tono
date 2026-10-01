## 2026-09-30 · 解析器的有界性质测试
- 归属：工程（质量门）；控制面目录与流量策略、`tono-core` 节点准入、macOS 订阅 URL 与代理 URL、Windows 服务协议头。
- 来源：`origin/main` → 分支 `qg/parser-properties`。
- 缺陷修复：无。这轮生成输入没有打出新的解析缺陷。
- 新增/优化：无产品行为变化。
- 工程与测试：fast-check 40 次：垃圾目录必须抛 `ApiError`，通过的目录仍含 `{{TONO_CLIENT_UUID}}`；未签名策略不能带出媒体或 TCP 端点。`admit_node` 对 trojan 与 `skip-cert-verify: true` 拒绝，随机字节不 panic。XCTest 用 32 个生成串检查订阅 URL 成功时仍是公网 HTTPS，代理 URL 解析不陷落。`ProtocolVersion::parse_header` 对有界垃圾返回 `None` 而不 panic。没有加 proptest，也没有改 `Cargo.lock`：本机 rustc 1.83 不能为 edition 2024 更新锁文件。
- 验证：`npx vitest run test/parser-properties.test.ts` 通过。Swift 与 Windows 服务测试在托管 CI。
- 候选/发布：仅源码，无新候选。
- 剩余限制：helper `readRequest` 只在特权 helper 构建里编译，没有独立的管道测试夹具，这次没有为它新开一个会拉长 macOS 构建的夹具。
