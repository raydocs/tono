## 2026-10-01 · macOS 日志上传先发空探测

- 归属：ops / 隐私；影响 macOS App 网络日志上传（`DiagnosticsLogUploader.swift`）。
- 来源：main `0676435b`；分支 `claude/fix-1192-mac-log-upload-empty-probe`；Fixes #1192。未合 main。
- 缺陷修复：上传默认开启，但没有收集窗口时，登录后首轮会发最多 4 MiB 真实审计行（主机名、进程路径、规则），之后每 30 分钟再发 64 KiB，服务器不读正文就回 `not_enabled`。改为：服务器存下过一次之前，只发 0 行的空 gzip 探测；存下后才发真实行。探测占用的回执序号不复用；服务器再拒绝时回到只发探测。只有其他账号行的块照旧本地跳过，不触发探测。移植 Windows 的同一设计（#1193，未改该 PR）。
- 新增/优化：无。
- 工程与测试：`testANotStoredReceiptStandsDownToASmallProbe` 改为 `testNoLogLineLeavesBeforeTheServerStoresAnEmptyProbe`；`testNoStoreLogReceiptReportsFailureAndRetainsTheUploadCursor` 改为探测被拒 → 探测被存 → 真实行用下一个序号；重试、边界、归属测试只跳过 0 行探测。
- 验证：本机不跑 `xcodebuild`/Swift；空 gzip 字节用 Python `gzip.decompress` 解出空串。macOS CI 是门禁。
- 候选/发布：仅源码，无新候选。
- 剩余限制：窗口关闭后的第一段真实数据仍会发出一次再停下（服务器拒绝后才知道）。
