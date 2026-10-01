## 2026-09-30 · macOS sing-box 输入下载遇瞬时断流时重试
- 归属：工程（质量门）；只动 `tooling/scripts/prepare-macos-sing-box.sh`。不改产品、不放宽校验。
- 来源：`origin/main` → 分支 `qg/ci-download-retry`。
- 缺陷修复：无产品缺陷。macOS CI `sing-box-input` 在 [run 36773239399](https://github.com/raydocs/tono/actions/runs/36773239399) 因 `curl: (92) HTTP/2 stream was not closed cleanly` 失败，脚本没有重试。
- 新增/优化：无。
- 工程与测试：Go 工具链压缩包 `curl --retry 5 --retry-all-errors`；钉死的 sing-box commit 最多再取 5 次。SHA-256 与 commit 不变，对不上仍失败。
- 验证：`node --test tooling/scripts/tests/prepare-macos-sing-box.test.mjs`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：最近约 200 次 workflow 里没有「同一 SHA 失败后再跑就过」的测试重跑（`run_attempt > 1` 在各工作流最近 40 次里是 0）。大量 `cancelled` 是 ci-gate 的并发取消，不是测试抖动。connect-bench 的 `fake_ip_ms: None` 是那两次提交自己的回归，不是重跑才过，基准线没有放宽。
