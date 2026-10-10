## 2026-10-10 · macOS 控制面路径切换进客户时间线（A19 续）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；Amp 待办 [A19](../ops/amp-backlog-2026-10-10.md) 的 macOS 部分
  （Windows 部分见 [2026-10-10-windows-path-timeline](2026-10-10-windows-path-timeline.md)，#1494）。`apps/macos`。
- 来源：基线 main a6ebf460 → 分支 `amp/a19-macos-path-fail-telemetry`；PR 见正文；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - macOS：一条控制面路径在没有收到状态行就失败、同一请求的下一条路径开始时，除原有本地审计
    `control_plane_path_failed` 外，再往周期时间线的事件环（`ConnectionTelemetryBuffer`）记一条 `controlPlanePathFail`：
    `from` 失败路径、`to` 下一条、`reason` 失败类 `dns|connect|tls|timeout|other`、`elapsedMs` 该路径耗时，与 Windows 同形。
    最后一条失败没有下一条，不记。路径标签只取 `X-Tono-Path` 允许表（`pinned`/`system_dns`/`relay`/`doh`/`alt_port`/`tunnel`），
    不含地址、URL、主机名、错误原文或账号字段。
  - 归属与开关：新的 `ControlPlanePathTimeline` 只在账号已就绪（`state == .ready` 且有 `user`）且时间线开关开着时打开；
    每次账号状态/用户变化、开关变化、退出登录都会关闭或重开它并作废之前的请求票据。请求开始时取票，记事件时票据必须仍有效，
    所以登录前、退出后、开关关着时或另一账号期间开始的请求，其路径失败只留在本地审计，不进上传。退出登录与关开关时先关闭再清空事件环。
  - 控制面：不改。遥测入口本来就收 `from`/`to`/`reason`/`elapsedMs`（`telemetry-window.ts`），展平按 kind 处理且该类 `node` 为空
    （`ops/flatten.ts`，#1494），与平台无关。
- 工程与测试：XCTest `AccountSessionRequestTests.testAFailedPathFollowedByTheNextQueuesOneTimelineEventWithNothingIdentifying`
  （系统解析 `cannotFindHost`、钉住地址应答 → 一条 `system_dns → pinned`、`dns`、带毫秒的事件，JSON 只有 `ts/kind/from/to/reason/elapsedMs`，不含主机名与邮箱）。
- 验证：见 PR 正文。XCTest 未在本机跑（Linux，无 Xcode），由托管 `macos-26` CI 跑。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：开关/账号闸门本身（未就绪时不记、换账号作废票据）没有单独的 XCTest，按「一个行为一条回归」只钉了事件形状与配对；
  登录前的路径失败不进时间线（账号归属规则）。
