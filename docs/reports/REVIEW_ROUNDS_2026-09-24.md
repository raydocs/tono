# 审查轮次记录（2026-09-24：H16 界面真实性、H17 账户生命周期）

本页记录 2026-09-24 两轮隐秘搜寻（H16、H17）的方法、覆盖、未覆盖与修复进度，以及同日的仓库清理。
**条目的状态、编号和去重以 [FINDINGS_LEDGER](../FINDINGS_LEDGER.md) 为准**；本页不重复条目，也不粘贴原始报告。
通用的审查约束沿用 [2026-09-23 审查轮记录](REVIEW_ROUNDS_2026-09-23.md) 第 4 节。

## 1. 方法

两轮都固定基线 main `bb2ed4e4`，在只读 worktree 上审查；发现与修复分两个阶段；
每份报告必须交覆盖清单（每个不变量、每个指定用例一行：「安全 + 文件:行」或发现编号）。

| 轮次 | 范围 | jev-route 决定 | 席位 |
|---|---|---|---|
| H16 | 两端每个界面对「已连接 / 受保护 / Protected Offline / 已拦截 / 已释放」的说法是否属实 | `c30072c2`，dual | Opus 5.5 max（O）、Codex astra6 max（C） |
| H17 | 账户生命周期端到端：注册/开通、到期、续期、配额、设备上限轮换、吊销、停用、销户 → Worker/cron → D1 → roster/目录/策略 → exit-agent → 两端客户端 | `6d18b013`，triple | Opus 5.5 max（O）、Codex astra6 max（C）、Grok 4.7（G） |

**交叉厂商核实。** 每条发现由另一厂商的模型核实，目标是推翻；两个厂商独立报出同一问题的，算作交叉确认。

| 发现来源 | 核实方 | 核实项 | 结论 |
|---|---|---|---|
| H16-O | Codex | O-F3、O-F6、O-F7 | 3 确认（O-F7 收窄了触发条件） |
| H16-C | Grok | C-F2、C-F3 | 2 确认 |
| H16-O × H16-C | 独立重复 | O-F1=C-F5、O-F2=C-F4、O-F4=C-F6、O-F5=C-F1 | 4 条交叉确认 |
| H17-O | Codex | O-F3、O-F4、O-F6、O-F7 | 3 确认、1 降级（O-F6） |
| H17-C / H17-G | Opus | C-F2（同意）、G-F5（确认机制）、C-F1（确认，定为低） | 3 确认 |
| H17 三席位 | 独立重复 | O-F1、O-F2（macOS）=G-F3；O-F5=G-F2；C-F1=G-F1；C-F3=G-F3 第 3 步 | 交叉确认 |
| H17-G-F4 | — | 与 H7-F7 / #381 同一缺口 | 不另立条目 |

合计：原始发现 H16 13 条、H17 15 条，去重后 20 项进入修复队列（H16 9 项、H17 11 项）；**0 条驳回，1 条降级**（H17-O-F6）。
H17-O-F2 的 Windows 部分只有 Opus 一个来源，核实记录是与 #460 已知限制的对照，没有另一厂商的单独核实。

## 2. 覆盖摘要

### H16（不变量 I1–I6）

| 不变量 | macOS | Windows |
|---|---|---|
| I1 旧 attempt 的迟到副作用不改新会话的界面 | 安全（发布与 onCoreStarted 按代际守卫） | 两个席位分歧：O 判安全；C 找到解锁后发布旧快照的交错（H16-C-F3） |
| I2 用户最后的意图生效且界面如实反映结果 | 更新准备失败后 Connect 被静默丢弃（H16-O-F4） | 退出拒绝对话框误述结果（H16-O-F6） |
| I3 界面说受保护 ⇔ 真受保护（双向） | 空闲机误称拦截（O-F3）；PF armed 却显示 Standby（O-F4、O-F5）；菜单释放后 gate 仍称拦截（C-F2） | 无 live 证据称已拦截（O-F1）；托盘图标不刷新（O-F2）；恢复期短暂 Standby（O-F7） |
| I4 有界时间内各表面收敛 | O-F4、O-F5 在本会话内不收敛 | 托盘图标永不收敛（O-F2） |
| I5 表面不以自动重连覆盖显式释放 | 安全（显式释放清除 resume/自动连接标志；睡眠门拒绝后的重连是已知 X1-2） | 安全（flyout 与仪表盘只响应用户点击） |
| I6 单一权威来源或来源可证一致 | 菜单栏读 isProtectionBlocked、登录/阻断页读 isArmed，启动时不对账（O-F5） | 横幅/登录卡/提示只看 FSM 锁存，药丸/进度卡/flyout 要求 wanted && live（O-F1） |

指定用例 C1（监听建立前的事件）、C2（节流丢最后一次更新）、C6（首个状态前默认不泄漏「受保护」）在两端均判安全，
例外均已归入上面的发现；C8 只抽查了 en/zh 的状态字符串和图标映射。

### H17（不变量 A1–A6）

| 不变量 | 结论（高层） |
|---|---|
| A1 权益与 roster 在有界延迟内一致 | Worker 请求时的资格检查与 roster 一致；新发现：开通丢到期日（H17-O-F4）、到期/超额吊销后续期不恢复（H17-O-F3）、调低设备上限不驱逐（H17-C-F1）；延迟上界取决于仓库外的 exit-agent timer |
| A2 生命周期转换原子 | 设备吊销与 LRU 轮换是单个 D1 batch；退款销户不原子（H17-C-F2） |
| A3 客户端遇到不再有权益时的处理 | 401 释放 PF/WFP 并登出（H17-AUTH-MAC、H17-AUTH-WIN）；suspended 不停 Core（H17-C-F3）；日志上传无限重试（H17-O-F7） |
| A4 续期/重置/重新启用后可恢复 | H17-O-F3、H17-G-F2（=H17-O-F5） |
| A5 吊销/删除后无可用凭据残留 | 无硬删除路径；更早的 refresh 在再登录/登出后仍有效（H17-G-F5）；已知项 H4-F1、H7-F5、H7-F7 |
| A6 生命周期事件不造成跨账户可用 | 安全（设备按 user+installation 唯一，凭据与出口标签按设备，UUID 按请求替换）；已知项 H3-F1、H11-F1、H4-F2 |

未找到独立的试用、支付回调、月度配额自动重置、邮箱修改、账户合并、密码修改或硬删除流程；「功能不存在」不算缺陷。
控制台操作（停用、恢复、销户、改配额）已审计，另见 H17-O-F6。

## 3. 未覆盖

- 全部结论是源码推导或阅读确认；**没有运行任何回归草案**，没有 xcodebuild/swift/cargo/Tauri。
  H17 的 Opus 席位只跑了 4 条既有 Worker 用例作基线（开启 Tailscale enrollment，不覆盖任何发现）。
- 需要设备的部分：更新准备失败频率（H16-O-F4）、8 s 之后才完成的释放（H16-O-F6）、恢复与托盘创建的启动竞争、
  Explorer 重启后的托盘、SwiftUI 实际重绘（H16-C-F2）、Windows 抢占交错（H16-C-F3）、真实 Core/PF/WFP 行为（H17-C-F3、H17-AUTH-*）。
- 生产事实：是否仍有带 `tailscale_node_id` 的设备（H17-G-F2）、出口凭据 rollout phase、Mac 遥测开启比例、exit-agent timer 周期。
- Windows 100 余处状态机写入点只抽查约 10 处是否发布状态；en/zh 以外的语言；macOS 字符串只抽查约 25 个。
- Xray/hy2 对已建立连接的撤销效果；客户端时钟偏移；D1 真实并发调度；home-agent（未部署）、ops 账目、iOS、Linux。
- 部分席位没有运行 `gh pr diff`，其「可能已被 #N 覆盖」的判断由后续去重复核（H17-G-F4 即按 #381 的 diff 判为已覆盖）。

## 4. 修复进度（写入时）

| 队列 | 条目 | 状态 |
|---|---|---|
| 1 | H17-AUTH-MAC（H17-O-F1、H17-O-F2 macOS、H17-G-F3） | [#516](https://github.com/raydocs/tono/pull/516)（issue [#510](https://github.com/raydocs/tono/issues/510)） |
| 2 | H17-AUTH-WIN（H17-O-F2 Windows） | [#515](https://github.com/raydocs/tono/pull/515)（issue [#512](https://github.com/raydocs/tono/issues/512)） |
| 3 | H16-O-F1（=H16-C-F5） | [#513](https://github.com/raydocs/tono/pull/513)（issue [#511](https://github.com/raydocs/tono/issues/511)） |
| 4 | H16-O-F2（=H16-C-F4） | [#518](https://github.com/raydocs/tono/pull/518)（issue [#517](https://github.com/raydocs/tono/issues/517)） |
| 5 | H16-O-F6 | [#520](https://github.com/raydocs/tono/pull/520)（issue [#519](https://github.com/raydocs/tono/issues/519)） |
| 6–20 | 其余 15 项 | `open`，按同文件依赖排队（例如 H16-O-F5、H16-C-F2、H17-C-F3 排在 #516 之后；H16-C-F3、H16-O-F7 排在 #515 之后）；H17-O-F3 需 owner 选定修法；H17-C-F1、H17-O-F6、H17-O-F7 为低 |
| 后续 | Worker 对到期/超额/停用返回客户端已识别的权益码（目前一律 401） | 在 #515/#516 之后另开 |

上述 5 个 PR 各自在总账登记自己的行；本页与本次总账更新不重复这些行。

## 5. 仓库清理（2026-09-24）

- 删除 114 个 worktree 与 87 个本地分支；删除 104 个过期的本地 `pr/*` 引用。
- 删除 131 个远端分支：84 个的 PR 已合并，47 个的内容已在 `main` 中。
- 保留 20 个未合并、也没有开放 PR 的远端分支（有意保留，未删除）：
  `client/windows-connection-contract`、`dept/d-d1`、`dept/d-d3`、`dept/d-d5`、
  `detail/dead-code/chore-remove-unused-format-tun-probe-failures-help-0ef212`、
  `detail/dead-code/chore-remove-unused-with-data-modify-subsystem-fro-11ef42`、
  `docs/sing-box-go-migration-plan-20260914`、`experiment/sing-box-stage-a-20260913`、
  `experiment/sing-box-stage-b-lossless-20260913`、`experiment/sing-box-stage-b2-throughput-20260913`、
  `experiment/sing-box-stage-b3-ai-streams-20260913`、`feat/ios-liquid-home`、
  `feat/macos-helper-and-coordinator-hardening`、`feat/sing-box-m1-build-certification`、
  `feat/sing-box-m1-rust-offline`、`feat/sing-box-m1-swift-20260914`、`fix/191-ledger-target-month`、
  `fix/macos-pending-exit-selection-20260922`（#312 已关闭）、`fix/preserve-teardown-readback-20260923`（#482 已关闭）、
  `provisioning/fq-bbr-and-metering`。
  另有 `main`、`release/macos`、`release/windows`、`windows-updates` 与开放 PR 的头分支，不在清理范围内。
- GitHub 仓库设置 `delete_branch_on_merge` 已开启（2026-09-24，owner 要求）：此后合并的 PR 分支自动删除。
- 恢复任一已删除的远端分支：`git push origin <tip_sha>:refs/heads/<branch>`（提交仍可由 SHA 取回时有效）。

<details>
<summary>已删除的 131 个远端分支与删除时的 tip SHA</summary>

| 分支 | tip SHA |
|---|---|
| `client/macos-phase-3.5` | `155cda506454b1a5a5b198d2c74b78a7339315a4` |
| `client/windows-phase-3.5` | `0cb2c6dbc6017072ae329cbfd8b1d7510e69533c` |
| `contract/e-roles-and-disconnect-bytes` | `f48ad7d5e5d270466fef96ae71165d78cdc5f37d` |
| `cursor/hy2-worker-filter-d57f` | `84c8bdac016c5721e793751317b43c0caf59185b` |
| `dependabot/npm_and_yarn/services/ops-console/ops-console-0a8d0017a6` | `f7a9011f140006d2f383f5343253b4124c421d6c` |
| `dept/d` | `c327ceb89fdccaf3e1f8a3f318e48440fc90c4ad` |
| `dept/d-contract` | `0fd76b673468005c20bc8c848f81d5a1bff0ea86` |
| `dept/e` | `4297641f59c8fd1a8cca0aee0743ec75ea963d80` |
| `detail/fix-docs/docs-agents-list-windows-live-feed-file-in-no-publ-8ea92c` | `24287daafd314b417f05f03c1f58b0ea2940754c` |
| `detail/fix-docs/docs-bump-current-source-version-to-0-0-73-in-rele-8ee646` | `3ba2951516b2e0a3ed8e1c9178597d9ad47ed39b` |
| `detail/fix-docs/docs-home-agent-retire-stale-mac-studio-deployment-782410` | `3d2ea6e4c17cafd484babe5b873abd990b81034c` |
| `detail/fix-docs/docs-mark-extracted-control-plane-module-list-as-n-8712cc` | `6fc0e18a0f2c1b974d807d79c0f06ad2bd615967` |
| `docs/073-test-candidate-20260922` | `3d57e59ccb7cb4b4248f32733ecafeb89a51b800` |
| `docs/171-native-acceptance-20260914` | `6b195fad6b9045b82a81aa7e51aa3e6656af065e` |
| `docs/d-wip-reconciliation-20260914` | `5c4e2dabecee7e41c4334e325b6773c725bfff5f` |
| `docs/engineering-quality-acceptance-20260921` | `8189417eebcc946e742da7c1f4d37e3dda004ee0` |
| `docs/findings-ledger-20260923` | `204b45587553a86eec911879acf6a72727b6aa56` |
| `docs/g1-internal-candidate-20260922` | `69ab5b2d183849786e09098b7dd961e8f3a2af53` |
| `docs/internal-changelog-20260923` | `2cbc7af4a9c8ddf31f3ee4e2410a75cb424f1dab` |
| `docs/metering-boundary-evidence-20260914` | `bfbe6b0330407b9fc92ae46f3ebb5e4da3102dc7` |
| `docs/remote-build-workflow-20260914` | `9e4beb06c775e670d697cefb95af2afcc69609c4` |
| `feat/desktop-usability-0.0.73` | `05cc4a13bab9bbbb654103587237051a302d78de` |
| `feat/macos-connectivity-watchdog-hardening` | `92dc28d74ef8ca33c038e7c1e52874cac6c96d90` |
| `feat/macos-sing-box-product-delivery` | `7c121b31327b27c0f5864479229d39d785a35930` |
| `feat/shared-sing-box-contract` | `347f048a61ba884b401098375a35a6197a5caacd` |
| `feat/sing-box-m0-contract-20260914` | `7f64978c5d9d5b8551e0b81f7247cb5a630ebf56` |
| `feat/welcome-v2` | `f250413b99f446fa49b86fa6915f2c5cd757c5e8` |
| `fix/dns-followup-20260923` | `192b347a772686c153a6abfa8baaa5898bd7cfc6` |
| `fix/g1-engineering-acceptance-20260921` | `1fe84fd5ae383cfe82801232e95d859c402a4e24` |
| `fix/g1-g2-baseline-fixtures-20260913` | `e5972a8b309c01901024cf7649d249e8db48d4cf` |
| `fix/g1-hot-switch-convergence-20260913` | `5fcde956a87d48238d7b108807c95f57a038ec4d` |
| `fix/g1-macos-engineering-20260921` | `6061e2512b59edd21e10516370e9638866cbd862` |
| `fix/g1-pin-refresh-lock-20260913` | `b852c76afd4ce65d84024d9979e71d34c828ae57` |
| `fix/g1-server-switch-toast-20260913` | `f9d759b2b856066822ac2d37cecf49e052b812f3` |
| `fix/g1-tailscale-netmap-20260913` | `0dd5bcae59b9ef77fdb6e70c10d90e82d59592d5` |
| `fix/g1-telemetry-readiness-20260913` | `e0ea3091b097cfc0f28be68952ee5df6e61ccac9` |
| `fix/g2-attempt-failure-snapshot` | `5dbe9ceb11263dbeb0c8fe260d8f06b685214682` |
| `fix/g2-g3-dns-hy2-20260913` | `b5c098185780075825b6d20aedfad058b9b55459` |
| `fix/g2-hy2-roster-only-20260913` | `ba2b1edb16ed192472f7ba32042baf344a7510b9` |
| `fix/g2-identity-and-local-recommendation` | `4f397609f059f9110f6d534c1431fd3b9e90d665` |
| `fix/g2-probe-outcome-evidence` | `759442317b3c91b17b410a94a65a16375af8fa5b` |
| `fix/g2-route-byte-interval-20260913` | `1c4fa1ff7ef3a8e632d910744d6adc78aed4dc37` |
| `fix/g2-services-evidence-20260921` | `711f29d4e5fb4f513573a48e48d444ee24f1bebe` |
| `fix/g2-swift-policy-fixture-20260913` | `0a07b74e4f4747383d28602ba1c6e83d54c73f67` |
| `fix/g2-telemetry-retention-20260913` | `9805bc727efafdfc4ac63112f1faef80f4d0b059` |
| `fix/g2-windows-candidate-version` | `31295a315a2f58cb29ec4b2e9079b0acce13656d` |
| `fix/g2-windows-local-failure-evidence` | `8ab2a63eca8e697d8d803d59dc643b0ab162aec6` |
| `fix/g3-candidate-install-20260922` | `046849f22493562ec346013ab639c7479f51f6e1` |
| `fix/g3-installer-journal-gate-20260913` | `78859d8c8006e9bcb2077ebe11ea6147aaa1b946` |
| `fix/g3-journal-exclusive-write-20260914` | `8fdf7a06c854ca1f014241208e8e115124ca942c` |
| `fix/g3-macos-update-preparation-20260913` | `63ec27d2c40c250b47b4a4fd6c25ee2c99b252cf` |
| `fix/g3-protected-restore-proof-20260913` | `ec3db85a91eb8ac2901b6b0ed7f43c9987687f78` |
| `fix/g3-protected-update-phase-guards-20260913` | `eacabc300dab5be651420b69b2de8151d49af89f` |
| `fix/g3-signature-placeholder-20260913` | `5f68fe70b8670ab399c0d61ed3d698e2cd3fdf0c` |
| `fix/g3-unreadable-update-evidence-20260913` | `bf9387f5f23f762fedfe9c19d638b7818a3d6e31` |
| `fix/g3-update-recovery-reentry-20260913` | `c46aeb5989132d34457e42e6704302ce5c7932c9` |
| `fix/macos-dns-probe-races-20260922` | `d954a7f740f95f141136af423a39338d79a1b674` |
| `fix/macos-dns-snapshot-outlet-20260922` | `b6b8df0d2977b338da691af3b81ea7242b956e68` |
| `fix/macos-dns-status-snapshot-20260922` | `2132e80cdacc765de67d45fec85418b76e21bbda` |
| `fix/macos-external-release-misjudge-20260922` | `1068bb73fb96ff60a1ccc8fe553ec150f05e4543` |
| `fix/macos-optional-policy-reconnect-20260922` | `4ee7b1470dade43a15f10243283012aef4bded79` |
| `fix/macos-pending-network-change-20260922` | `6027993466e6e846d0d62b00301cf316a42d505d` |
| `fix/macos-sleep-during-release-20260922` | `5981a09802dc405ed9ade19fdf04c405e4c2a09c` |
| `fix/macos-tun-switch-guard-20260922` | `982ed9de10b745f63b884dcc7f3e5c2811feaf23` |
| `fix/macos-update-bootout-startup-20260922` | `8a2e151e8be4a1a7437dd7033278b547227bc58d` |
| `fix/macos-update-terminal-states-20260922` | `7e7d2b7d89fbc2e89b137eaa73329e1957735638` |
| `fix/ops-compatible-september-deps-20260913` | `655510d37c7274c1568fc6bf681a9dcd342a5b56` |
| `fix/ops-today-partial-readiness-182` | `9a7db90206151fe9d34d03318f9127c56356a3fb` |
| `fix/ops2-hy2-node-identity-20260913` | `f2dd1a295cdc7ad9bbbbd485c090991828b2b333` |
| `fix/ops2-toolchain-20260913` | `281929d1a5b28cde6be614ead3c4bb2a73b48bff` |
| `fix/pr187-isolated-20260914` | `0fc09d34a0baf6e60eafacfa114f8bdf4558ca93` |
| `fix/windows-251-g3-closeout-20260922` | `ac2cde16a5e303a09e0bc8893f02972b34671115` |
| `fix/windows-monitor-self-abort-20260922` | `a7e4c27c0c39f9769d9cd64a8fd7ae84fc26dee5` |
| `fix/windows-policy-defer-connecting-20260922` | `ce674caf6f05d1f89e13c3d84550ff9976b11f66` |
| `fix/windows-prepare-start-freshness-20260922` | `f6ecee355e481a88ce5c8811c01e6d97a28fbb94` |
| `fix/windows-release-refused-fsm-20260922` | `7f53a5cc08999fa5fd235abf6fc4a6cd130c2170` |
| `fix/windows-service-restart-resync-20260922` | `e3f46d120c0f081fe15bec1f31159c4b253538c4` |
| `fix/windows-update-connecting-fsm-20260922` | `3729c8b8c80e91c163e60c6c1c7bbae757b34abf` |
| `fix/windows-update-txn-recovery-20260922` | `b5d9e93cbcbd1288542cbce4aa394a86e221ec94` |
| `macos/failure-report` | `ef73c7b8f90442d7c0ede59c11e17280bbdcc07b` |
| `macos/telemetry-node-name` | `d285920e6b0927bea330dcb570a611a03ccf2413` |
| `ops2/today-visual-prototype` | `5156ea9512b5c1a4b7d942ec883176b1b01695a9` |
| `ops2/ui-refresh` | `6f3091165a513c54bd814dbe7af9aceecc996c90` |
| `ship/ready-dependency-prs-20260923` | `94bfa6cfa15e13bba9786ec103be49a996010d4c` |
| `client/windows-phase-1.5` | `ecdfaa2bc3dc1cc9bd5dbd7d55400e4d71e55556` |
| `dept/a-a3` | `cdd414376272dbe1851b57d442c523bd6d48b08a` |
| `dept/a-a6` | `ebd10c93e80d7a6a4654f3154c03b78609f2d04e` |
| `dept/d-d2` | `f459f1981438d5120511ca12743e8683fd2986da` |
| `dept/d-d4` | `c327ceb89fdccaf3e1f8a3f318e48440fc90c4ad` |
| `dept/e-ci` | `c9440a9752c9fce8e0778dfe91e6182799582d2f` |
| `dept/e-ingest` | `147b53f29a4ad761c901f86216fc46a19eb8aea3` |
| `dept/e-orphans` | `1e61c4051395202cdbc1f9add646f8a6d450b335` |
| `dept/e-roles` | `1b45a1a82d49c714f6528c775a9849a984283fd4` |
| `dept/e-wipe` | `4e4c752a35cf7374bedef5098d866fdbf549e27e` |
| `fix/g1-account-boundary-red-20260921` | `022014382f132d5ebbf4326ae0cee857344e37e6` |
| `fix/g1-network-reconcile-red-20260921` | `a96bb5d2e84acf0a9be73a6ed79dd69f21156872` |
| `fix/g2-retained-failure-red-20260921` | `daadc3a71a91403965db4615fb2e7bc67fbef300` |
| `macos/apple-continuity` | `7a6f0980733f95959310c6bb37e2d8cbddaaed04` |
| `macos/clash-rename` | `ef9583ebeb3b903c045e4395b4ac37138f4e1845` |
| `ops/scaffold` | `9d53fca5b971b71f8a045de9ecfbd4320d8de9bf` |
| `ops/wave4-p` | `d280326dab5644f5fe9a7a575d654a37dab36c38` |
| `ops/wave4-q` | `d12596a66f2f80cd639c16579c90d11b2184ed06` |
| `ops/wave4-r` | `1da0a8919a31ad2033906cf19e327daa42a9a4e4` |
| `ops/wave5-f` | `2eb8ee0ae9b1bb32c10b09c6c96f01327d8a00e7` |
| `ops/wave5-s` | `72c5ac88866b73195463ad79b4f5824b500017f6` |
| `ops/wave5-t` | `97f627601d2c919b045282acf8f48eb3717b4fe6` |
| `ops/wave5-u` | `27dc0ab9600d7ef074f21b521bc5cb2365c01fa9` |
| `ops/wave5-x` | `35f7886c771bf804812bedc34e071d14246b342e` |
| `ops/wave5-y` | `835fa1737687d0d010423028ea650260d3b690cd` |
| `ops/wave5-z` | `adfe55d4282fe625f60f6fbb7e63539340b932e1` |
| `ops2/workflow-followups` | `b3d6536046de0c5fc48a4800dcd2b69bd6d23dda` |
| `cursor/ship-plan-first-publish-d57f` | `3b284d35f4bd94fcc8c9ed3496e1f62b040bbcdf` |
| `feat/desktop-connection-beta-20260922` | `705e16d9ac80a800591da195c0c360029db0ff77` |
| `feat/desktop-update-contract-v1-20260922` | `e811d740bfc733f65b54bf6ea4223d4f250482c8` |
| `feat/desktop-update-integration-v1-20260922` | `aeb4b5ad69330507fdeed70a4b263667b2619eda` |
| `feat/macos-073-usability-20260922` | `fd0ba19242437ddd6281457f7bb423e3f05a0380` |
| `feat/macos-g1-bounded-connect-20260922` | `7d69c4f0cb9d8ab258a1ba40b5ad50765bd86d67` |
| `feat/macos-native-update-v1-20260922` | `e3cc3896cc195792b301e77be6c73be95ef8022e` |
| `feat/windows-native-dns-apply-20260922` | `f4e506d85b3d4c7d406e4b13833d7caad056cf7a` |
| `feat/windows-route-usability-0.0.73` | `f8f0749ba85488fdbeadfba33f4da5738bfafe9d` |
| `feat/windows-update-transaction-v1-20260922` | `dc4c6589f66083732c99c2d812b5f1e9dd56a3a3` |
| `fix/245-failure-lifecycle` | `e260979b7b0066f805db1ee0b78cff36d884220c` |
| `fix/260-prerequisite-polling` | `efc790d39ae364d22adb49fb6989ff37bffc5e0e` |
| `fix/g1-diagnostic-probe-latency` | `024da95cea213a6a205279251875656598982e65` |
| `fix/g1-direct-selection-serialization` | `4b3f21afc90bb57c4d2a6300258ca06c9ab98ebf` |
| `fix/g1-dns-restore-finalization` | `cc7e7524f7ed0b6951c2506440721e3815b9578e` |
| `fix/g1-handoff-projection` | `a0d2fcd8d9fbe1841c7eb243f7f90161ab45c07f` |
| `fix/g1-live-catalog-selection` | `2717271b817b0fc19cdccc463502459d99be0494` |
| `fix/g1-recovery-ownership` | `09854372b475dba126543e8254be349004eb9fd7` |
| `fix/g3-handoff-review-20260914` | `3451ce5c041be60901cbbdcd7b91effd7e8c6e1f` |
| `fix/windows-dns-pending-evidence-20260922` | `1506678a26699df7e78c21c1796c950c43008382` |

</details>
