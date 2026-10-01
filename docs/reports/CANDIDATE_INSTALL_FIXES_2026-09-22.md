# 0.0.73 候选签名与覆盖安装修复 — 2026-09-22

范围：所有者要求继续修复两个已定位阻塞。归属 SHIP_PLAN G3、[#26](https://github.com/raydocs/tono/issues/26)
与 [#273](https://github.com/raydocs/tono/issues/273)。交付 [PR #276](https://github.com/raydocs/tono/pull/276)，
分支 `fix/g3-candidate-install-20260922`；直接基于已发布 main
[fc5da57e](https://github.com/raydocs/tono/commit/fc5da57eebcebfae4cff9dc5fe7d452e3199b764)，
不包含 [#275](https://github.com/raydocs/tono/pull/275) 的临时诊断模式。

行为修复提交：[429d6e40](https://github.com/raydocs/tono/commit/429d6e40ea775d0fb38d0e84053a4e44943c015e)。
当前结论：源码修复、定点原生回归与重建候选的原始覆盖安装检查均通过。
候选可以进入内部 Windows 11 人工验收，但没有真实账号/节点连接证据，不能保证朋友直接连接可用。
这不是签名、公证、Windows 11 实机、受保护更新或客户发布验收。

## 修复契约

- Windows 安装器从合法的 `SystemDrive` 盘符构造绝对 `\Users` 路径，避免 `C:Users`
  受调用者工作目录影响。缺失盘符、额外相对路径、UNC 输入仍报错；枚举/日记拒绝仍传播到
  非重试门禁，不删除日记、不吞错、不修改 NSIS 的工作目录。
- macOS 候选只接纳 `refs/heads/stability/desktop-0.0.73-20260922`，两个入口和
  产物身份校验共用 0.0.73/build73 合同。manifest 从已校验的 bundle 字段写实际身份，
  保留源码与四项文件摘要。旧分支、相似分支、main、PR 和候选 tag 仍被拒绝。
- 同时修复签名调用链中重复上传 `sing-box-darwin-arm64` 的确定配置冲突：资格检查已经
  上传且验证了该不可变产物，后续直接下载同一份，不再次构建或设 `overwrite`。
  [所钉 action 的合同](https://github.com/actions/upload-artifact/blob/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/README.md#not-uploading-to-the-same-artifact)
  明确要求同一 run 内名称唯一。此项是源码与执行配置回归证据，不是一次实际签名 run 的报错。
- 普通 release/macos 祖先校验、Developer ID/notary 检查、候选禁止进入 Sparkle 环境、
  客户源隔离均保留。未创建专用候选分支，未调用签名 workflow。

## 已执行的红绿证据

| 检查 / 环境 | 来源 | 实际结果 |
|---|---|---|
| Windows 原生红，`cargo test --locked --features standalone,client,test`，目录 `apps/windows/service` | [20771f9e](https://github.com/raydocs/tono/commit/20771f9e7f537c35dd73bed2e1224f12dfe7b928)，[run35701620873 / job106660752527](https://github.com/raydocs/tono/actions/runs/35701620873/job/106660752527)，Windows Server 2025 | `tests::journal_discovery_uses_an_absolute_system_drive_root` 实际断言 `D:Users` ≠ `D:\Users`；安装器 21 passed / 1 failed，exit1。不是编译或 fixture 错误。后续真实 WFP 步骤跳过。 |
| Windows 原生绿，同一命令 | 行为修复提交，[run35702502962 / job106663631557](https://github.com/raydocs/tono/actions/runs/35702502962/job/106663631557) | 安装器 **22 passed / 0 failed**，包含新回归与原有不完整发现拒绝回归。Service 库 **303 passed**；现有集成检查及单独真实 WFP filter-shape 检查成功，保留原有 1 个集成 skip。不是完整保护行为验收。 |
| macOS 配置红，Linux Orb `ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` | 更新回归后、旧 workflow | exit1：0.0.73 候选被旧分支门禁拒绝。仅修版本后，下一次 exit1 正确检出重复 Core 产物生产者。 |
| macOS 配置绿，同一命令 | 行为修复源码；本地 scope fingerprint `400e3c556ca1986c142261f13e9be05d57397c627856a53a8b8b84141d842faf` | exit0：11 个分支场景、第二个真实 source gate、实际 manifest 脚本的 bundle 身份/摘要与旧 bundle 拒绝、单一 Core 产物生产者、Sparkle 隔离及原有失败传播检查通过。使用合成未签名 fixture，不执行签名。 |
| 同一配置回归在 macOS 托管机执行 | 行为修复提交，[run35702503836 / job106663956388](https://github.com/raydocs/tono/actions/runs/35702503836/job/106663956388) | 具名输出与本地一致，policy-tests job 成功；checkout 日志确认准确行为修复 SHA。 |

CI receipt 工具未提取到 Windows Service 红/绿 job 的具名测试日志；直接 GitHub job 日志已读回
checkout、具名断言与汇总，不将工具的空 testResults 当作成功。原始 installer smoke 的三条
具名 PASS 已由 receipt 工具提取并与完整 job 日志核对。Linux 不编译或模拟原生 Windows。

行为修复提交的 Windows/macOS **push CI 均成功**；Windows 原生 App 的
`cargo test --locked` 为 **492 passed / 0 failed**，另有 1 个原有 opt-in skip，
Windows 日记 integration target 为 **3 passed**。Ubuntu 上的 `cargo test --locked -p tono-core`
为 **265 unit + 10 + 1 + 3 integration passed**，不是 Windows 原生执行。
PR 同时有 16 个成功检查；这些状态不代替真实安装和连接证据。

## Windows UUID、握手和连接阶段复核

所有者追加要求：确认连接问题属于 UUID、握手还是其他阶段，再决定朋友测试包。
已复核下列生产路径，未因假设某个原因而更改凭据、服务端节点或放宽验证。

| 边界 | 源码能证明什么 | 仍需实际失败证据 |
|---|---|---|
| UUID 下发 | `services/control-plane/src/catalog.ts` 从 account/device exit credential 取稳定身份，替换目录占位符；客户端 `tono-core/src/node.rs` 校验 36 位 UUID 并规范大小写，将它传入 owned runtime，不自行重新生成出口 UUID。 | 格式正确不证明当前 VPS roster 接纳该身份。device 凭据等待传播可能是 `EXIT_IDENTITY_PROPAGATING`；dual 模式可能继续使用 legacy credential。未读取实际账号/roster，也未把目录 SHA-256 完整性校验说成 Ed25519 签名。 |
| Core / 保护启动 | `connection/stages.rs` 执行 Service readiness、Core 启动、控制器就绪和 WFP/WinTUN 锁定，再进入 DNS 与出口验证。 | `startingKillSwitch` / `startingTunnel` / `lockingTraffic` 的原始 Service、Core pin、LUID 或 WFP 错误；这些阶段失败不能凭 UI 文案归因 UUID。 |
| DNS | `securingDNS` 读取 protected fake-IP；后续 HTTPS 探测使用 protected DNS 并验证 TLS。 | 实际 DNS/NRPT/DoH 与适配器状态；测试中的注入不是用户 OS 状态。 |
| 出口 / 握手 / TUN | `connection/probes.rs` 把 controller delay 当参考，Connected 必须通过真实 TUN HTTPS。最终 loopback cross-check 只诊断：loopback 成功、TUN 失败优先定位客户端数据面；多路径失败保留 Core/节点错误。 | `EOF` 本身不能区分 UUID 拒绝、Reality key/SNI/short-id 不匹配、远端关闭、链路或目标站点 TLS 失败；需要同一 attempt 的 Core 错误、probe path/category 和服务端观测。 |

准确行为修复提交的日志确认以下原有回归本轮执行成功：`rejects_invalid_uuid`、
`rejects_missing_uuid`、`accepts_uppercase_uuid_and_stores_canonical_lowercase`、
`controller_success_without_tun_is_not_connected`、`mixed_proxy_cannot_replace_tun`、
`successful_tun_does_not_wait_for_diagnostic`，以及原生 App 的超时/取消后释放、旧失败不串新账号、
保留脱敏失败原因和诊断不泄露凭据回归。这证明对应代码合同，不证明一次真实线路已经连通。

已有收集入口是连接失败卡或支持页的「复制诊断信息」：包含 App build、Service 协议/版本、
Core 自报版本（不是二进制证明）、目录 revision、阶段、耗时、保留的失败 attempt、
有界 Core 错误和各 probe 结果。提供该脱敏文本即可；不要发送原始 UUID、密码、令牌或完整配置。
截至本记录，没有指定账号、目标 Windows 11 设备或该候选实际失败诊断，不能确认用户历史故障
一定由 UUID 或握手引起，也不能宣称所有用户会流畅连接。朋友包只能标记为待实机验证的候选，
不能因 CI 绿色就标为稳定版或推进客户自动更新。

## 重建产物与剩余边界

- 一次新 [Windows 候选构建 35702579743](https://github.com/raydocs/tono/actions/runs/35702579743)
  成功，checkout 为行为修复提交。Service/Core pin、NSIS payload 预检通过，未复用旧 installer。
  [候选下载](https://github.com/raydocs/tono/actions/runs/35702579743/artifacts/10683509026)
  含安装器与 manifest；artifact 当前到期时间为 2026-09-29 08:36 UTC，需要 GitHub 登录。
- 安装器 `Tono_0.0.73_x64-setup.exe` 的 SHA-256：
  `bfb279e1fb9725c930057b090ca9da7038f987ceb1673984996d8bf0080ddd57`。
  本地下载后执行 `sha256sum --check -`，输出 `Tono_0.0.73_x64-setup.exe: OK`；manifest 的
  source/version 及 `candidateOnly=true`、`releaseAccepted=false`、`updaterSigned=false`、
  `authenticodeSigned=false` 均已核对。没有签名与发布资格的虚假声明。
- 一次原始 [installer smoke 35705859237 / job106674482328](https://github.com/raydocs/tono/actions/runs/35705859237/job/106674482328)
  成功：Windows Server 2025、workflow_dispatch，run head 和实际 checkout 都是行为修复提交。
  同分支/产品树及 artifact 来源校验未改；没有采用 #275 的诊断模式或改变工作目录。
  实际命令：`tooling/scripts/test-windows-candidate-install.ps1 -CandidateDirectory $env:CANDIDATE_DIRECTORY`。
  原始 `/S` → `/S /UPDATE` → uninstall 的具名输出：

  ```text
  PASS fresh silent install, Service running, installed Core pin, no GUI auto-launch
  PASS same-version replacement/repair and Service restart
  PASS uninstall removed Service/runtime payload and preserved DNS
  ```

  [原始 JSON 回执](https://github.com/raydocs/tono/actions/runs/35705859237/artifacts/10684119123)：
  `freshInstall=true, sameVersionRepair=true, uninstall=true, dnsUnchanged=true, physicalUpgradeQualified=false`。
  这关闭的是原始同版本修复失败的证据缺口，不证明从 0.0.72 的已登录/受保护状态升级。
- 普通 Windows/macOS push 与 PR CI 自动触发，不手动重复 dispatch。最终状态应以准确 source
  与具名 job 日志核对；PR merge checkout 不冒充 push checkout。本报告只新增文档，所列原生与
  安装证据对应行为修复提交，不冒充对后续文档提交的重新执行。
- macOS 签名、公证、已安装 helper/Core 身份及 Sparkle 更新仍未执行。Windows 11 已连接或
  Protected Offline 升级、跨身份 journal/Service 回执、PF/WFP/TUN 流量与真实 DNS 恢复仍未资格化。
  保持 #26 与 G1–G3 开放，不从本轮回归推导全库无 bug。
- 无 merge、生产部署、发布标签、客户更新源修改、依赖更新或永久设备操作。
- 所有者的「确保连接没事再发布给朋友」条件尚无实机证据，因此没有创建 GitHub Release 或
  推进自动更新。最小下一步是在可恢复的内部 Windows 11 设备先断开旧 Tono，再安装该哈希候选，
  走登录 → 连接 → HTTPS 页面/仪表盘/Activity → 断开恢复 DNS → 再连接；失败时保留同一 attempt
  的「复制诊断信息」。不要把本次未配置的同版本覆盖安装成功视为受保护更新许可。
