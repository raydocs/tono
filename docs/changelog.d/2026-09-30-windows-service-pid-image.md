## 2026-09-30 · Windows 安装/卸载停止验证 Service image
- 归属：SHIP_PLAN §2 第 10 项；Windows Service install/uninstall 的强制终止。
- 来源：基线 `0ad57ccd` → 本 PR；分支 `hunt/sol-r3proc-service-pid-image`，尚未合 main。
- 缺陷修复：崩溃遗留 PID 文件和 SCM 停止失败可误杀复用 PID 的程序 → 正面 Stopped 不读旧文件；其他服务停止在同一终止 handle 上证明 installed Service image，外国 image 不动。发现 WIN-SCM-PID-FALLBACK（P2）。
- 新增/优化：无新功能；updater 的 GUI 通用终止行为保留，服务路径的未知身份仍拒绝，严格模式/AI 规则未动。
- 工程与测试：一个 Windows 真子进程 image mismatch 回归，RAII 清理；未改依赖或 CI gate。
- 验证：Linux VM，CARGO_BUILD_JOBS=2；`cargo test --locked --features standalone,client,test --bin tono-service-uninstall --bin tono-service-install`，installer 17 / uninstaller 22 通过。Windows GNU cargo check（同二进制，含 tests）通过是编译证据，原生 baseline/fixed 回归未在 VM 执行，交由托管 Windows CI；git diff --check 通过。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：needs-hardware；未知/不可读 image 不允许终止，文件已丢失时可能需要其他恢复操作。真实 PID 复用与 SCM 故障未实机复现。
