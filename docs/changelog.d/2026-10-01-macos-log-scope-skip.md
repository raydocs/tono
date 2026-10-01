## 2026-10-01 · 诊断日志跳过整块非本 scope 的前缀

- 归属：非 SHIP_PLAN 发版门。macOS 诊断日志上传（M13）。
- 来源：`origin/main` `7d525e6c`；分支 `cursor/macos-log-scope-skip-f6c6`。
- 缺陷修复：一个读块里全是别的上传 scope 的完整行时，空 gzip 不再被当成读失败。游标越过这些行且不上传它们，后面属于当前 scope 的行仍会上传。轮转备份也不会因为这种前缀被整段放弃。发现 M13-G-F1。
- 新增/优化：无。
- 工程与测试：`DiagnosticsLogOwnershipTests.testOwnedLinesAfterAFullForeignChunkStillUpload`。
- 验证：本机不能跑 XCTest。macOS CI 跑该测试。
- 候选/发布：无新包，仅源码。
- 剩余限制：不改变 PF、路由或连接。同意关闭时上传循环本来就不跑。
