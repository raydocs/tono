## 2026-10-21 · Windows 连接遇到「上次恢复没完成」时自己恢复再连

- 归属：客户 Windows 11 Pro / 0.0.79 实测（[WIN-RELEASE-UNFINISHED-CONNECT-LOOP](../findings.d/WIN-RELEASE-UNFINISHED-CONNECT-LOOP.md)）。重启后每次点连接都被 `TONO_RELEASE_UNFINISHED` 挡回，界面要求再点「恢复正常网络」，用户只会反复点连接。
- 来源：[#1705](https://github.com/raydocs/tono/pull/1705)，分支 `fix/windows-release-self-heal`，基于 main `b3688fba6`；未合 main。
- 缺陷修复：
  - 用户点「连接」被这个拒绝挡回、且原因不是「需要重启 Windows」时，App 自己跑一次「恢复正常网络」，然后再连一次，相当于替用户点了恢复和连接。每次点击最多一次，不循环。
  - 恢复服务在 25 秒答复时间内只回「unknown」、后台还在做时，等它真正结束（上限是恢复的 90 秒硬上限）再连；最终放不放行仍由服务端准入决定，判据不放宽。
  - 必须重启 Windows 的那一种（本次开机里有没核对完的 WMI DNS 批次）不自动恢复，界面单独说「需要重启一次电脑，重启后直接点连接」。
  - 「恢复正常网络」没有恢复成功时，结果（各项读回、卡住的进程、说明）记一条 `releaseFail` 进上传的网络日志（按现有映射是 P0 `TONO_KILL_SWITCH_STUCK`），支持不必再找用户要复制的详情。
- 新增/优化：`releaseUnfinished` 文案改为「已自动恢复过一次仍未完成」；新增 `releaseNeedsRestart`（中英）。
- 工程与测试：`entry::retry_after_unfinished_release` 单测（未完成的恢复由同一次点击恢复并连接）；`tono.test.ts` 新增重启文案映射用例。服务端、WFP、DNS 和准入判据都没有改动。
- 验证：托管 CI 跑，结果见 PR 验证评论。本机不跑 cargo / vitest。
- 候选/发布：仅源码，无新候选。
- 剩余限制：恢复为什么在这台机器上核对不完（哪一项没 settled）还要等服务日志；恢复中途打断主 Service 正在跑的 WMI 批次这一可能根因另记 [WIN-RESTORE-ABANDONS-INFLIGHT-WMI](../findings.d/WIN-RESTORE-ABANDONS-INFLIGHT-WMI.md)，本 PR 不修。
