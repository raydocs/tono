## 2026-10-06 · Windows 前端与 Rust 依赖升到当前可用的最新版本

- 归属：运维计划（依赖维护，不是发布门）；`apps/windows`。取代 dependabot #1403（前端）与 #1384（Rust），两者 CI 都是红的。
- 源码：基于 `main` `5a77c6b68`；分支 `claude/deps-windows-20261006`。
- 缺陷修复：无。
- 新增/优化：
  - 前端 `pnpm update --latest`，`package.json` 里 23 条依赖声明变化：`@tauri-apps/api` 2.11.1 → 2.12.1、`@tauri-apps/cli` 2.11.5 → 2.12.1，Tauri JS 插件 clipboard-manager 2.4.1 / dialog 2.8.1 / fs 2.6.0 / http 2.8.0 / shell 2.4.0 / updater 2.13.1，`vite` 8.3.2、`vitest` 5.0.3、`eslint` 10.12.0、`typescript-eslint` 8.71.1、`@biomejs/biome` 2.5.15、`@eslint-react/eslint-plugin` 5.24.4、`jsdom` 30.1.2、`react-hook-form` 7.89.0、`@vitejs/plugin-react` 6.1.2、`knip`、`lint-staged`、`sass`、`globals`、`eslint-plugin-sukka`、`@types/node`。更新后 `pnpm outdated` 只剩 `typescript`。
  - 四个 Cargo.lock（`apps/windows`、`app`、`service`、`crates/tono-plugin-core`）执行 `cargo update`。按包名对比合并基与本 PR 的锁文件（同名多版本算一个）：app 167 个包的版本变化、5 个新增、10 个移除；plugin-core 102 / 1 / 12；service 21 个变化；workspace 14 个变化。其中 `tauri` 2.11.5 → 2.12.1（plugin-core 的锁文件里起点是 2.11.6）、`wry` 0.55.1 → 0.57.0、`tao` 0.35.3 → 0.37.1、`webview2-com` 0.38.2 → 0.39.1、`windows` 0.61.3 → 0.62.2、`hyper` 1.12.0、`rustls` 0.23.45、`tokio` 1.53.2，Tauri Rust 插件与 JS 插件同小版本。没有改任何 `Cargo.toml`。
- 没有升、以及原因：
  - `typescript` 留在 6.0.3：`typescript-eslint` 8.71.1 的 peer 是 `typescript >=4.8.4 <6.1.0`，在 TS 7 上直接报 `typescript-eslint does not support TS 7.0`（ops-console 的同一次试验，见 `2026-10-06-deps-ops-console.md`）。
  - `minisign-verify` 留在 `=0.2.5`（dependabot #1384 想改成 0.3.0）：Service 的这个精确版本是为了和 App 的 Tauri updater 用同一份验签实现，而 `tauri-plugin-updater` 2.13.1 仍锁 0.2.5；先升 Service 会让同一个更新包由两个版本验签。等 updater 上游移动后再一起升。
  - 需要改调用点的主版本没有做：`ed25519-dalek` 2.2.0 → 3.0.0（策略验签）、`keyring` 3.6.3 → 4.2.0（凭据存储）、`boa_engine` 0.21 → 0.22（dependabot 配置里已说明）。`toml` 0.8.2、`icu_*` 2.0.x 等由上游依赖钉住。
- 工程与测试修正：dependabot #1384 只更新了两个锁文件，`apps/windows/app/Cargo.lock` 没跟上，所以 `cargo test --locked` 拒绝；#1403 只升了 JS 插件，`windows-tauri-plugin-versions` 测试拒绝。这次前端和四个锁文件在同一个 PR 里。MacBook 不跑 cargo：锁文件是在 hosted `ubuntu-24.04` 上用固定工具链 1.98.1 生成的（一次性分支 `lockfile/deps-windows-20261006` 上的临时 workflow，run 37517123885，产物下载后原样提交；该分支和 workflow 不合并，用后删除）。
- 验证（MacBook，仅前端）：`pnpm typecheck` `unchecked indexed access errors 79 (baseline 79)`；`pnpm exec vitest run` `Test Files 56 passed (56) / Tests 393 passed (393)`；`pnpm test:dev-control` 123 通过；三个 node 测试（CI 路径、desktop-update-v1、Tauri 插件版本）21 通过；`pnpm web:build` 通过。
  - 未运行：任何 Rust 编译与测试（只在 hosted CI，以该 PR 精确 head 上的 ci-gate 为准）；`tauri build` 与打包；Windows/WebView2 实机。
- 候选/发布：仅源码，无新候选。冻结源码 `e28ca45c` 与 7501 候选不含本项。
- 剩余限制：`tauri` / `wry` / `tao` / `webview2-com` 是窗口与 WebView 运行时，升级后的窗口、托盘、更新器行为没有任何实机证据，只有编译和单元测试；要在下一个 0.0.75 候选的实机验收里看。CI 不跑 `tauri build`，打包只在候选流程里验证。
