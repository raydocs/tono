## 2026-09-30 · macOS helper 启动与紧急恢复的放通加固
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）。macOS helper。
- 来源：合入 origin/main `a28b99bd`；分支 `glm/mac-helper-recovery`；PR [#763](https://github.com/raydocs/tono/pull/763)；未合 main。
- 缺陷修复：
  - MAC-EMERGENCY-STALE-CORE：`runEmergencyDisarm` 与 `releaseNetworkWithoutLedger` 里 `CoreManager` 构造失败（僵尸 Mihomo 扛过 SIGKILL）不再中止释放：stderr 高声警告后继续「先尽量恢复 DNS、再 `disarm()` PF」；有待定更新且拿不到 core 时退回普通释放路径，更新证据不动、不验证、不归档（与 disconnect 失败的既有回退一致）。决策钉在 `emergencyReleaseDespiteStaleCore`，与坏账本同形。
  - MAC-STARTUP-FAIL-DNS：生产 `secureFailedStartup`（main.swift 底部的装配）在 `KillSwitchManager.secureFailedStartup` 清 PF 之后，尽量恢复已保存的受保护 DNS 快照（`ProtectedDNSManager().restore(deferringLossNotice: true)`）：失败记 stderr、永不抛错、不装任何 block。`KillSwitchManager.secureFailedStartup` 本体语义不变（无其他调用方）。绑定用户被删导致 `SocketServer.init` 在 DNS 管理器建成之前抛错的 KeepAlive 重启循环不再把系统解析器留在 127.0.0.1。
  - MAC-HELPER-CONFIG-FIFO：`atomicCopy` 的源 open 加 `O_NONBLOCK`（既有 fstat 的 S_IFREG 检查兜底拒掉 FIFO/设备，正则文件读不受影响）；`UpdatePackage.openInput` 逐段 `openat` 同样加 `O_NONBLOCK`（对端指定路径穿过用户可写目录，macOS 的 O_DIRECTORY 仅建议性）。helper 内其余 `open(` 逐一核对：只读 root 专属路径（账本、PF 状态、PrivilegedHelperTools 二进制、DNS 状态）或已带 `O_NONBLOCK`（`KillSwitchPF.secureRead`、main.swift 的 Info.plist 读），不改。
- 新增/优化：无新旁路。紧急路径仍不 bootout 无关进程、不要求 DNS 验证通过后才放行、不写「以后禁止启动」标记（#691 范畴不动，改动保持最小以便其重放）。
- 工程与测试：`--self-test` 增 `emergencyReleaseDespiteStaleCore` 两极性断言和 `runStartupDNSRecoverySelfTest`（PF 释放→DNS 恢复顺序，恢复失败不逃逸），并保留 main 的失败提交、孤儿 bootstrap 与 SelectiveFailOpen 自测；`--staging-self-test` 增 FIFO 拒绝用例（缺失修复时该用例挂起而非失败）。helper 协议 main `4.52.18` + `0.0.1` = `4.52.19`，`CONTRACT.sha256` 按 build-core-helper.sh 清单重算。启动失败仍经 `releasePersistedBlock` 在放行一般流量后保留次级 AI 阻断层；显式 `--emergency-disarm` 仍走 `disarm()`，按 main 契约撤掉该层。严格模式才全阻断。
- 验证：本机 Linux 无 Swift 工具链，未编译、未跑 self-test；hosted macOS CI（macos-ci.yml privileged-tests：sudo `--self-test`、`--staging-self-test`）待跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：紧急放通对「僵尸 core 仍在跑」只高声警告不强杀；A/C 的守护内端到端行为没有 self-test（会动真实 PF/DNS），靠策略断言与原语用例钉住；core 构造失败且有待定更新时走通用释放提示，不打印「证据保留」专用文案；未实机。

- Windows CI：main 上的 `merge-manager/aux.sh` 是 Windows 保留设备名，检出失败。本分支将其改名为 `side.sh`，内容不变。
