## 2026-10-13 · Windows CI：依赖缓存改用 rust-cache，tono-core 用 nextest

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。只改 `windows-ci.yml`。不改产品、签名或发布工作流。
- 来源：main `00ba688c2` → 分支 `cursor/windows-rust-cache-nextest-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：`core`、`app-rust`、`service` 去掉手写 `actions/cache`，改用 `Swatinem/rust-cache` v2.9.2（`6323deb102c322ba6fcbdcafc7e3dddab59af2b6`）。各作业独立 `shared-key`，只缓存依赖、不缓存 workspace crate，`save-if` 仅 push 到 `main`。`tono-core` 全套改为 `cargo nextest run --locked -p tono-core`（该 crate 没有 `serial_test`）。Service 生命周期、原生 DNS、WFP 和 Windows 上的 journal/contract 步骤仍是 `cargo test`。Tauri 的 `cargo test --locked` 不改：nextest 每个测试起一个进程，会重新加载 Tauri harness，而现在的 `cargo test` 已在一个进程里并行。必选检查名仍是 `ci-gate`。
- 工程与测试：`app` 作业里的守护改成数 rust-cache 的三处 pin、三个 `shared-key` 和三条只在 main push 保存的 `save-if`，并确认没有第二份 cargo cache。
- 验证：本地抽出守护脚本跑过。Windows `cargo test` / nextest 未在本机跑（无 Windows 工具链）。ci-gate 待本 PR。第一次 push 到 main 是冷缓存。
- 候选/发布：无新包。
- 剩余限制：本 PR 的 ci-gate 本身是冷缓存或仍吃 main 上旧的 `actions/cache` 键，量不到 rust-cache 命中后的墙钟。Tauri 376–644 秒的测试步骤没有改成 nextest。Service 不能用 nextest。

## 2026-10-13 · 续记：把 workspace crate 放进 rust-cache

- ci-gate [38475291612](https://github.com/raydocs/tono/actions/runs/38475291612)（`e950d127f`）`app-rust` 的 `cache-hit=false`。Tauri `cargo test` 11 分 10 秒，高于旧缓存命中时的 376 秒。只缓存依赖时，本仓库的 crate 每次都重编。三个作业改为 `cache-workspace-crates: "true"`，仍只在 push 到 `main` 时保存。这次 ci-gate 仍是冷的；命中后的墙钟要等 main 写下缓存之后的下一次跑。
