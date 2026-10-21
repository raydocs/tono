## 2026-10-19 · macOS 启动前检查端口占用（Docker DNS 占 53）

- 归属：客户 0.0.77 测试反馈「启动前缺少冲突检查」「错误信息与重试机制不足」；macOS 网络助手与连接流程。
- 来源：`origin/main` `2e602f2ab` →（修复提交见 PR）；分支 `fix/core-port-preflight`；未合 main。
- 缺陷修复：Docker 等程序占着 127.0.0.1:53（UDP）时，核心一启动就退出，助手只回「sing-box exited (status N)」，界面显示通用的「受保护连接失败」，Tono 还会反复重试。现在助手（4.52.61）在启动核心前（以及同步换配置停掉旧核心后）按核心自己的方式绑一遍配置里的回环端口：TCP 带 SO_REUSEADDR、UDP 不带，和 Go 运行时一致，所以只在核心真的会失败时才拦。被占用时返回 `CORE_PORT_IN_USE`，消息里写明端口、协议和占用进程（libproc 查到的进程名与 PID）。
- 新增/优化：app 把这个拒绝显示成「这台 Mac 的端口 53（UDP）已被 com.docker.backend（PID 812）占用，Tono 无法启动保护……」，分类码 `LOCAL_PORT_IN_USE`，算作需要用户处理的失败：不自动重连，原网络放开。运维台文案加了这个码。
- 工程与测试：助手 `--self-test` 新增 `runCorePortPreflightSelfTest`（占住临时回环 UDP/TCP 端口，必须认出被占、认出本进程、放开后不再报）；app 新增 `CorePortConflictTests`（消息解析、文案含端口和程序名、不重试、无码的核心失败仍可重试）。`HelperProtocolVersion.current` 4.52.60 → 4.52.61，`CONTRACT.sha256` 已更新。
- 验证：本机 swiftc 编译助手通过；抽出的预检代码在本机跑：同进程占位、另一进程以 0.0.0.0 占 UDP 都能认出并报出进程名，0.0.0.0 的 TCP 监听不误报（核心的 TCP 绑定此时也会成功）。app 单测与 root 自检由托管 CI 跑，结果见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Clash 等其他 TUN 的冲突仍是失败后归因（`OtherVPNDetection`），没有做启动前检查；Windows 未改。真实 Docker Desktop 占 53 的端到端情况未在真机验证。

## 2026-10-19 · 续记
- 独立审查（Codex gpt-6.1-sol xhigh，覆盖 `228bdcab4`）结论 approve-with-fixes，无 major，6 个 minor，按规定修一轮：严格模式（三层分流）遇到端口冲突不再自动重连，保留屏障并等「立即重试」；同步换配置（`/core/sync`）返回同一码时也显示具体原因、不自动重试；占用进程查询加 0.5 秒与单进程 4096 个描述符的上限，超限只说「另一个程序」；只认真正与 127.0.0.1 冲突的套接字（IPv4 的 127.0.0.1 或通配、双栈 IPv6 通配），`::1` 不算；预检移到清空旧诊断之后，旧核心的 HY2 idle 文案不会盖过端口冲突；进程名过滤 Unicode 控制、格式与行/段分隔字符。
- 红灯：`a58e452d7`（预检恒返回空）上 macOS CI run 39323079739 的 helper 自检失败：`core port preflight self-test failed: udp busy, tcp busy`。app 侧红灯另见 PR 验证评论。
