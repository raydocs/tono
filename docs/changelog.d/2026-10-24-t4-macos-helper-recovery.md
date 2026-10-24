## 2026-10-24 · macOS helper 恢复 P1 与 telemetry 429
- 归属：SHIP_PLAN §2 item 10 / G1；macOS，fix/t4-macos。
- 来源：main `322f48c6f` → 本 PR；未合 main。
- 缺陷修复：helper socket 断写不再依赖全局信号处理避免 SIGPIPE；root CLI 恢复可明确越过 strict/不可读记录，不在初始化时重装阻断；GUI/自动路径保留原权限。
- 新增/优化：T6 协作接入新账户错误码和分桶 Retry-After 持久化，保留登录并保持网络授权撤销；防泄漏差异表为只读复核，未移植路由规则。
- 工程与测试：socket 受控关闭 XCTest、strict 授权策略 XCTest、三种 authority 故障的 root self-test；helper 版本升至 4.52.65，编译清单增加共享策略源。
- 验证：真实 RED `9ea3e0b59` / `4e8cbc26c` / `619cd5326`；集成窄 XCTest 8 项、0 失败，telemetry 相关原有套件 22 项、0 失败；准确源码、命令和限制见 PR / [T4 记录](../reports/T4_MACOS_2026-10-24.md)。一次 seam 编译错误与缺失输入不计 RED；run 40081493256 已取消。
- 候选/发布：仅源码，无新候选、无签名发布、无部署、无 feed/migration 改动。
- 审查：独立 Sol/xhigh 批准 `322f48c6f...1bad91f67` P1 范围，无新增 major/minor；后续 telemetry/auth 未在该范围，待编排者 Claude 交叉审查。
- 剩余限制：本机 helper 编译后非 root 自测有六项 AI Home scope 失败，原始 main 源码独立构建复现相同失败；root self-test 待 CI；真机 PF/bootout/安装/睡眠未验证；路由移植、wake race、状态投影与 P2 留后续批次。
