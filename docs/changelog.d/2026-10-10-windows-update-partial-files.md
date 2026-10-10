## 2026-10-10 · Windows 更新：下载的包在每条路径上清理，「取消」真正中止下载
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）更新下载；`apps/windows/app/src-tauri/src/tono/commands/update.rs`、`restore.rs`、`lib.rs`，
  前端 `services/update.ts`、`components/setting/mods/update-viewer.tsx`。
- 来源：叠在 #1527（`amp/win-update-download-resume`）上；分支 `amp/win-update-partial-files`，PR [#1540](https://github.com/raydocs/tono/pull/1540)；未合 main。
- 缺陷修复（[WIN-UPDATE-PARTIAL-FILES](../findings.d/WIN-UPDATE-PARTIAL-FILES.md)）：
  - `DownloadedPackage`：本次下载的 `update-downloads/<nonce>.exe` 在安装的每条出口（出错、取消、命令被丢弃）以及 Prepare 返回之后删除；
    此时 Service 已有自己的私有副本（`copy_private`，大小与 SHA-256 已校验），之后不再读 App 副本。
  - `sweep_stale_downloads`：启动时持安装锁，只删本目录下 32 位小写十六进制 nonce 命名的普通文件，不递归、不跟随链接。
  - 「取消」：新命令 `tono_cancel_update_download` 取消下载令牌，`download_resuming` 在请求、读块、续传任一处中止（错误带 `TONO_UPDATE_CANCELLED`）；
    令牌只在下载期间存在，代理清理、Prepare、Install 不可取消。对话框取消后不把该更新记为拒绝，可再次开始。
- 新增/优化：无。TLS、签名、大小与哈希校验不变；下载主机与路径链不变。
- 工程与测试：`#[tokio::test] cancel_aborts_a_download_stalled_mid_body`、`#[test] package_files_are_removed_and_the_sweep_stays_in_the_download_dir`；
  vitest `update-viewer.test.tsx`「cancels a download in flight and leaves the same offer available again」。
- 验证：Linux orb，Node 24：`npx vitest run src/components/setting/mods/update-viewer.test.tsx` 2 passed；`pnpm test` 400 passed；`pnpm typecheck` 通过；
  `node --test scripts/windows-packaging.test.mjs ../../../tooling/scripts/tests/desktop-update-v1.test.mjs` 45 pass。`src-tauri` 的 cargo 本机不跑，以托管 Windows CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Service 仍固定着的文件删不掉，留给下次启动；取消只在下载阶段有效。
