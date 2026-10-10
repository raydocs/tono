## 2026-10-10 · Windows 安装包下载：中断后从已写字节续传，60 s 无字节算中断
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）；`apps/windows/app/src-tauri/src/tono/commands/update.rs`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-update-download-resume`，PR [#1527](https://github.com/raydocs/tono/pull/1527)；未合 main。
- 缺陷修复（[WIN-UPDATE-DOWNLOAD-NO-RESUME](../findings.d/WIN-UPDATE-DOWNLOAD-NO-RESUME.md)）：安装包下载开始后任何中断都让整次安装失败、下次从 0 开始，
  且没有空闲超时。现在 `download_resuming`：读超时 60 s（与 macOS `idleBudget` 一致），中断后用 `Range: bytes=<已写>-` 经同一路径链
  （先 API 最近走通的中继，再直连，再其余中继）续传，最多 3 次；续传应答必须是该偏移、签名大小的 206，否则失败；大小上限检查不变。
- 新增/优化：无。下载主机、签名与 Service 侧大小/SHA-256 校验、更新检查（manifest/签名 GET）不变；600 s 单请求上限保留（每次续传各自计）。
- 工程与测试：`update_relay_tests` 新 `#[tokio::test]` `a_package_download_cut_off_mid_body_resumes_from_the_bytes_written`：
  本地服务器第一次只发一半就断开，第二次按 `Range` 回 206；断言落盘字节完整连续、第二次请求带 `bytes=5-`、进度只开始一次且总数正确。
  `node --test scripts/windows-packaging.test.mjs ../../../tooling/scripts/tests/desktop-update-v1.test.mjs`：45 pass（Linux orb）。
- 验证：本机不跑 `src-tauri` 的 cargo；以托管 Windows CI `ci-gate` 为准。发布主机对 Range 的支持按 `services/control-plane/src/releases/host.ts` 阅读确认，未对生产发请求。
- 候选/发布：仅源码，无新候选。
- 剩余限制：故障为模拟；半截文件不清理、「取消」不中止下载另记 [WIN-UPDATE-PARTIAL-FILES](../findings.d/WIN-UPDATE-PARTIAL-FILES.md)（open）。
