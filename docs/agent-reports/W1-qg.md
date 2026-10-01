# W1-qg 质量门

槽位 W1-qg。Hunter: Grok 4.7。基线 `main` `5ba113d2`。2026-09-30。

这些 PR 都是非草稿。修复类 PR 使用 merge commit 的自动合并；合并管理员可以关掉或打开，关掉之后不再由本槽重新打开。报告 PR [#877](https://github.com/raydocs/tono/pull/877) 不自动合并，留给合并管理员成批处理。它们不改产品杀开关，不放宽 fail-closed，不把任何现有检查改成可忽略。`dependency-audit` 不进 `ci-gate`。

## Pull requests

| PR | 分支 | Head | 门 |
| --- | --- | --- | --- |
| [#803](https://github.com/raydocs/tono/pull/803) | `qg/decisions-split` | `714e80fbb4702ab17f09aa3c02a302443048e852` | 决策拆成 `docs/decisions/NNN-*.md`，`DECISIONS.md` 只做索引。38 条决策，锚点按原标题。`records.mjs decisions` 读取。 |
| [#822](https://github.com/raydocs/tono/pull/822) | `qg/ci-download-retry` | `3eab95fb45ac35084f293fcf10eea7d28256bea2` | macOS sing-box 输入下载失败后有界重试。SHA-256 与钉死的 commit 不变。 |
| [#837](https://github.com/raydocs/tono/pull/837) | `qg/unchecked-index-ratchet` | `69d064ee491f5250981ae55804154b8490b7031f` | `strict` 仍必须通过。`noUncheckedIndexedAccess` 只在错误数高于基线时失败。 |
| [#870](https://github.com/raydocs/tono/pull/870) | `qg/coverage-floor` | `80568e8ddb53f86c215595992623c4d755be7513` | auth / sessions / quota / ledger 的按文件覆盖率下限，做在现有 `npm test` 里。 |
| [#857](https://github.com/raydocs/tono/pull/857) | `qg/parser-properties` | `b06d57b1741dbf0aaf67694da04ad4370bdacbe4` | 目录、流量策略、节点准入、订阅 URL、代理 URL、服务协议头的有界性质测试。 |
| [#856](https://github.com/raydocs/tono/pull/856) | `qg/session-races` | `f569a1489ed3713f6592b562c889d0af087cf20e` | 登出撤销刷新已经换出的继任会话。断线中的选路保持 `UpdateOnly`。 |
| [#855](https://github.com/raydocs/tono/pull/855) | `qg/dependency-audit` | `bffb02285beaf928d68df66149306e418895c763` | 依赖审计只写 job summary，退出码 0，不是必需检查。 |

未修、已立案：[#860](https://github.com/raydocs/tono/issues/860) helper `readRequest` 没有管道测试夹具。[#862](https://github.com/raydocs/tono/issues/862) `tono-core` 的 `clippy -D warnings` 和 llvm-cov 没有放上 Linux 作业。

## 每个门卡住什么

- `ci-gate`：唯一必需检查。路径没命中的工作流必须是 skipped。本槽没有往它的必需上下文里加名字。
- 决策索引：新决策写成 `docs/decisions/` 里下一个三位编号，不改旧编号，不把新标题写回 `DECISIONS.md`。
- 下载重试：对不上 SHA-256 或钉死的 commit `93fff5954390367dd456cad3cbd79be54f8b941f` 仍然失败。最多 5 次。
- 类型：`tsc --noEmit`（已有 `strict: true`）先过。然后 `noUncheckedIndexedAccess` 的 `error TS` 计数不得高于基线：控制面 521、admin 99、运维台 219、Windows 前端 79。计数下降仍绿。SwiftLint 没有配置，没有新加。
- 覆盖率：只统计 `src/auth.ts`、`src/sessions.ts`、`src/ops/quota.ts`、`src/ops/ledger.ts`。Workers 池拒绝 v8。用 istanbul。按文件下限：行 82、分支 73、函数 81、语句 77。低于下限则现有控制面测试作业失败。
- 性质测试：垃圾目录和未签名流量策略要么抛 `ApiError`，要么仍带着占位身份 / 空的媒体与 TCP 端点。trojan 与 `skip-cert-verify: true` 被拒绝。接受的订阅 URL 仍是公网 HTTPS。协议头解析不 panic。没有改 `Cargo.lock`（没有加 proptest）。
- 并发：刷新先提交时，登出必须把 `successor_id` 指向的会话也标成撤销。刷新自己的 `revoked_at IS NULL` 比较交换不动。断线过程中 `select_action` 不是 Switch，也不是 Reconnect。
- 依赖审计：`npm audit --omit=dev`、`pnpm audit --prod`、跑者上有 cargo 时的 `cargo audit`、Swift `Package.resolved` 钉死版本。失败也只出现在摘要里。

## 抖动

最近约 200 次 workflow：没有「同一 SHA、同一工作流，失败后再跑就过」。各工作流最近 40 次里 `run_attempt > 1` 是 0。约 106 次 `cancelled` 是 ci-gate 在新 push 上的 `cancel-in-progress`，没有关掉。

修了的一次：macOS CI [run 36773239399](https://github.com/raydocs/tono/actions/runs/36773239399)（SHA `b0ba23ba`）在 sing-box 输入作业里 `curl: (92) HTTP/2 stream was not closed cleanly`，下载 `go1.27.1.linux-amd64.tar.gz`。脚本原先不重试。#822。

没有当成抖动、也没有放宽：

- connect-bench runs 36754399999 与 36754341975 的 `fake_ip_ms: None` 是那两次提交自己的回归。基准线还在。
- 同窗口里的 TonoTests 65、`cargo test` 101、ops-contract、ops-console e2e 是不同 SHA 上的进行中 PR，不是同一 SHA 重跑才过。
- connect-bench 的 loopback DNS 已由 #749 修过，这里没有再改。

## CI 时间

下面是改动之前、`main` 上最近一次成功运行的墙钟。作业并行，工作流墙钟等于最慢的作业。

| 工作流 | Run | 墙钟 | 最慢作业 |
| --- | --- | --- | --- |
| Services CI | [36791670113](https://github.com/raydocs/tono/actions/runs/36791670113) | 23:33:10Z–23:36:58Z，3 分 48 秒 | ops-console-e2e (1) 3 分 44 秒。control-plane 2 分 14 秒（23:33:13Z–23:35:27Z） |
| macOS CI | [36792958720](https://github.com/raydocs/tono/actions/runs/36792958720) | 23:48:13Z–23:57:05Z，8 分 52 秒 | build 6 分 57 秒。sing-box-input 1 分 26 秒 |
| Windows CI | [36788838523](https://github.com/raydocs/tono/actions/runs/36788838523) | 23:01:14Z–23:14:21Z，13 分 7 秒 | app-rust 13 分 2 秒。core 28 秒，app 41 秒 |

这些 PR 的「之后」运行在写这份报告时还没结束（为了跟上 `main` 刚 rebase 过）。结构上的差：

- 没有新的必需作业，也没有把检查改成 advisory 来换绿。
- #855 的审计工作流自己触发，不在 `ci-gate` 里，不占上面三列的墙钟。
- #837 在已经会跑的 `npm run typecheck` / `pnpm typecheck` 里多一次 `tsc`。本机控制面两次带标志的 `tsc` 约 2 秒，运维台约 12 秒，Windows 前端约 10 秒。
- #870 把 istanbul 放进已经会跑的 `npm test`。本机整包 949 个测试带覆盖率 254 秒。CI 上改动前的 control-plane 作业是 2 分 14 秒，而且短于 e2e 分片，所以服务墙钟当时由 e2e 决定。只插桩四个文件。
- #822 成功路径仍是一次下载；重试只在断流时发生。
- #857 / #856 的新测试是现有作业里的几秒，不新开 runner。

## 本地验证

- `node --test tooling/scripts/tests/prepare-macos-sing-box.test.mjs`：2 过。
- `node --test services/unchecked-index-ratchet.test.mjs`：4 过。控制面、运维台、Windows 前端的 typecheck 与基线一致。
- `npx vitest run test/parser-properties.test.ts`：2 过。
- `npx vitest run test/session-refresh-logout.test.ts`：旧语句失败（还剩 1 条活会话），加上继任撤销后 1 过。
- 带下限的 `npx vitest run`：949 过。合计行 92.03%、分支 81.09%、函数 90.9%、语句 87.3%。
- 未跑：`xcodebuild`、`swiftc`、`cargo test`（本机 rustc 1.83，crate 要 1.98 / edition 2024）。

Hunter: Grok 4.7
