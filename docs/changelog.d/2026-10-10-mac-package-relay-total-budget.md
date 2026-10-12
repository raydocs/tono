## 2026-10-10 · macOS 安装包中继下载：写满签名大小后不再被 900 s 总时长判失败
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A2](../ops/amp-backlog-2026-10-10.md) 续做
  （#1516 审查记下的限制 M3）；macOS 客户端 `apps/macos/Tono/Services/NativeUpdateDownload.swift`。
  服务端、helper、PF 不改，`HelperProtocolVersion` 不变。
- 来源：基线 origin/main 3d973f95 → 分支 `amp/a2c-relay-total-deadline`；未合 main。
- 缺陷修复：原行为：中继下载的 900 s 总时长计时器无条件判失败；签名大小在 899 s 写满、服务器保持连接不关时，
  2 s 关闭宽限期内总时长到点，包被判失败并删除，下一次更新检查再从头下载。改后：写满签名大小、进入关闭宽限期后，
  总时长计时器到点不再结束传输，由宽限期（或连接结束）判成功；宽限期内多出一个字节仍判失败。
- 新增/优化：无新能力。预算与结束规则从 `RelayPackageConnection` 移到 `RelayPackageTransfer`（时钟与计时器可注入），
  连接本身只管 TLS、发送与读取；60 s 空闲、900 s 总时长、2 s 宽限期数值不变。
- 工程与测试：一个回归 `NativeUpdateDownloadTests.testPackageCompletedJustBeforeTheTotalBudgetSucceedsAfterTheCloseGrace`
  （假时钟：每 50 s 一个字节，最后一个在 899 s 写满；900 s 总时长到点不结束；901 s 宽限期结束为成功，文件内容一致）。
- 验证：本机不跑 xcodebuild；由 hosted macOS CI（ci-gate）在 PR 头 SHA 上运行。
- 候选：仅源码，无新候选。
- 剩余限制：额外字节拒绝、签名/哈希校验、TLS、PF 均未改；真实中继下载仍未实测（v1 渠道尚无已发布的 macOS 包）。
