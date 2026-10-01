## 2026-09-30 · Preserve WebSocket handles across renderer IPC
- 归属：SHIP_PLAN §2 item 10; Windows controller subscription cleanup; WIN-WS-ID-IPC-U128 (P2).
- 来源：origin/main `7d525e6c`; branch `hunt/sol-misc-ws-handle`; [#834](https://github.com/raydocs/tono/pull/834), not yet merged.
- 缺陷修复：numeric UUIDv7 handles could not be accepted by Tauri's u128 argument parser, so closing a page left its native reader running. Return and accept decimal strings at the IPC boundary, retaining u128 native keys.
- 新增/优化：无；no UI or network protection change.
- 工程与测试：one real Tauri-handler test forwards a full-width decimal handle and requires native disconnect's exact missing-ID result, proving argument decoding reached the implementation. Test-only Tauri feature; existing app CI runs it.
- 验证：Linux portable locked-dependency proof reproduces numeric precision/parse failure. Scoped TypeScript check and declaration generation with installed TypeScript 6.0.3, rustfmt for the new test, and git diff --check pass. Native Rust test unavailable here. Pinned Rollup/TypeScript 7 build fails before bundling with undefined ScriptTarget.ES2015; no dependency or CI workaround committed.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：Windows CI must run the generated-handler regression; native installed-machine subscription behavior was not tested.
