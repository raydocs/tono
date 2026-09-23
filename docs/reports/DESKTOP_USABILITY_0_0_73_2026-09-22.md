# 0.0.73 两端易用性整合与验收边界 — 2026-09-22

所有者要求把已讨论的六项能力在本版完成，再审查并收敛问题，不继续扩充功能。
归属 SHIP_PLAN G1/G2 的连接与恢复体验、G3 的运行身份和支持证据。
这不是全仓无缺陷证明，也不关闭实机或客户发布门。

仓库 `raydocs/tono`，整合分支 `feat/desktop-usability-0.0.73`，
[PR #279](https://github.com/raydocs/tono/pull/279)。基线是
[#276](https://github.com/raydocs/tono/pull/276) 的准确候选
[046849f2](https://github.com/raydocs/tono/commit/046849f22493562ec346013ab639c7479f51f6e1)，
不是 main。初次整合源码为
[9fee0a70](https://github.com/raydocs/tono/commit/9fee0a70b7f72e8dd2fcb4db75dbf824afa86e7d)，
Windows 审查整改为
[12a085a0](https://github.com/raydocs/tono/commit/12a085a0e3e5ec44609d664443fde175104686b1)，
macOS 目录竞态与捕获整改后的组合源码为
[35e28dc3](https://github.com/raydocs/tono/commit/35e28dc312fa0d9b89284bb34d93954e69ad4510)。
包含 [Windows 分片 #277](https://github.com/raydocs/tono/pull/277)、
[macOS 分片 #278](https://github.com/raydocs/tono/pull/278) 和父线程的 IPC/状态/同意流程整合；
分片不得当作独立组合验收，不能重复合入。

## 六项能力及保留的边界

| 能力 | 实现与验证对象 | 不证明什么 |
|---|---|---|
| 本地健康检查 | 明确点击才观察账号、目录、Service/helper、Core、DNS 与连接证据；失败/未知单列。Windows 有界 OS worker 保留 semaphore，超时不会无限排队；macOS 不调用会修复 PF 的 `/killswitch/status`。 | 不发送新的外网探测，不证明所有网站畅通；缓存意图不当作实时保护。 |
| 报告预览、同意和回执 | 使用既有 schema-v1 端点；预览冻结内容、绑定原账号。Windows ID 单次消费/5 分钟过期；macOS account lease 失效后禁止刷新/重放。实际回执才显示编号。Support、连接失败与 Windows 首页旧入口统一。 | 不扩大 raw-log/远程操作同意；无回执不代表服务端必定未保存。Windows 再次发送须重新预览；macOS 明确同意后可重发同一预览。 |
| 版本与运行身份 | App 构建源码、观测到的组件版本和目录身份分别展示；未知保留。macOS 构建脚本记录真实 checkout/configuration/dirty；Windows 使用实际构建环境元数据。 | 版本相同不证明签名、公证、客户渠道或运行中二进制摘要。 |
| 收藏、近期成功、固定地区与推荐 | 有界、按账号存储；hy2 收藏折叠到同节点；近期记录只由已验证连接提交产生。固定地区无可用证据时不越区。 | 收藏/低 TCP 延迟不是成功连接。Windows 只选择推荐，另点 Connect；macOS 显式确认 Connect，仍走原连接所有者。两者不静默切换健康出口。 |
| 恢复反馈 | 分清已有恢复正在工作、已排队和没有自动重试；复用现有 Retry/Release 所有者。 | 文案不是一次真实睡眠/Wi-Fi/网卡故障恢复证明。 |
| 应用线路说明 | 展示运行时实际报告的逐连接 terminal/rule/chain；同一应用可以有不同线路，空证据保持未知。 | 不从应用名或当前选中节点猜出站，不提供规则编辑，也不是逐包证明。 |

父线程阅读了实际 diff、生产调用关系、异步边界与新测试；发现 macOS 初始任务说明遗漏固定地区后补齐。
Windows 已确认的整合问题包括首页旧上传签名、账号替换后残留的预览/回执、收藏按钮脱离节点卡片、
旧系统摘要与实时健康检查混淆。前端预览的日期转义问题只在 fixture 配置，已与生产 i18n 对齐，
没有把它写成生产日期故障。未改防火墙/保护策略、云端协议、安装器或依赖版本。

## 已执行的本地与界面证据

Linux Orb，以下定点组合于 10:30 UTC 在 Windows 审查整改的实际交付源码执行：

```sh
pnpm exec vitest run src/pages/tono/support.test.tsx src/pages/tono/connect-progress.test.tsx src/pages/tono/dashboard.test.tsx src/pages/tono/servers.test.tsx src/pages/tono/route-preferences.test.ts src/pages/tono/activity.test.tsx src/services/tono.test.ts
# Test Files 7 passed (7); Tests 135 passed (135); exit 0
pnpm typecheck
# tsc --noEmit; exit 0
git diff --cached --check
# exit 0
```

测试工作目录为 `apps/windows/app`，Git 检查在仓库根目录。receipt 工具记录了真实退出码，
但本轮 fingerprint 不可用，状态是 unverified；不以工具颜色宣称全部需求验收。
缓存摘要说明先加聚焦断言，旧实现实际以找不到说明文字失败（1 failed、15 filtered/skipped），
修复后原断言随上述 135 项通过。此前类型检查确实失败过，修复旧上传调用和动态翻译键后才通过。

R1 的现有 ActivityPage 回归扩展后先在旧实现执行：
`pnpm exec vitest run src/pages/tono/activity.test.tsx -t 'explains only reported terminals'`，
实际以 `expected ... length of 5 but got 2` 失败（1 failed、18 filtered/skipped），不是 fixture 或编译错误。
修复后同一断言随该文件 19 项及上述 135 项通过；真实目录终端、家宽终端与 DIRECT 是正对照，
只丢弃所有证据的实现不能通过。未重写旧列表 badge，严格观测分类与旧列表展示分离。

使用现有 Vite desktop-preview、真实 React 页面与合成 native IO，在 Chromium DPR 2 渲染并
用 view_media 检查：收藏/推荐、空历史、Activity 展开的云端与未知连接、健康检查未知/版本不符/
失败/独立修复确认、报告预览/回执/失败、恢复等待/停止。DOM 另确认 JSON 230px 容器可滚动到
569px 内容底部；收藏按钮与选择按钮共享有边框的非按钮父容器，不是嵌套按钮。
Activity 下半部经真实滚动可见；截图视口之外不等于不可访问。
浏览器 fixture 没有访问实际 Service、上传真实报告或执行连接，不能用截图证明这些行为。
R1 整改的 DPR 2 页面重新捕获并检查：仅选择器两条记录的 DOM 观测值均为「未验证」，
真实目录终端/空链的 DOM 为「云端 / 未验证」；288px 说明容器的 384px 内容可滚动到底。
预览 Vite 曾返回旧模型缓存、导致新组件显示缺失键，重启预览服务并核对实际返回模块后消除；
这是预览服务缓存，不记作产品路由故障。最终截图来自重启后的实际源码。

## 托管组合检查与独立审查

初次整合源码的普通 push CI，逐项读回了实际 checkout 与 job 日志：

| 检查 | 准确源码 / job | 结果与边界 |
|---|---|---|
| Windows 前端 | 9fee0a70，[app106701352997](https://github.com/raydocs/tono/actions/runs/35714091692/job/106701352997) | `tsc --noEmit` 成功；36 文件 / 284 tests passed。 |
| Core | 同源码，[core106701353340](https://github.com/raydocs/tono/actions/runs/35714091692/job/106701353340) | Ubuntu 上 `cargo test --locked -p tono-core`：265 unit + 10 + 1 + 3 integration passed；不冒充 Windows 原生。 |
| Windows Service | 同源码，[service106701353258](https://github.com/raydocs/tono/actions/runs/35714091692/job/106701353258) | Windows Server 2025：Service 库 303、installer 22 项及现有集成目标通过，保留原有 1 skip；单独真实 WFP filter-shape 1 项通过，不是 Windows 11 设备验收。 |
| Windows App 原生 | 同源码，[app-rust106701353373](https://github.com/raydocs/tono/actions/runs/35714091692/job/106701353373) | **失败**：`route_preferences.rs:276` 的 awaited `MutexGuard` 引用产生 E0308。没有执行 Rust 测试；日记后续步骤跳过。12a085a0 改为先绑定 guard 再借用，保留校验与锁边界；后续绿色证据见下表。 |
| macOS | 同源码，[build106701789158](https://github.com/raydocs/tono/actions/runs/35714091681/job/106701789158) | unsigned Release 成功；`xcodebuild ... test`：Executed 355 tests, 1 existing opt-in skip, 0 failures；7 个 MacUsabilityTests、3 个报告 transport 回归执行通过。实际 Swift runtime/Core/helper 合同通过。 |
| macOS policy / privileged | 同源码，[policy106701789274](https://github.com/raydocs/tono/actions/runs/35714091681/job/106701789274)、[privileged106701789241](https://github.com/raydocs/tono/actions/runs/35714091681/job/106701789241) | 既有脚本、helper/PF parse/lifecycle/staging 检查成功；不代表已安装签名 helper 或用户网络。 |

初次 PR run 为 Windows 35714097640（失败）、macOS 35714097868（成功）；PR merge checkout
不冒充 source head。Windows 修复后的普通 push 为
[35716494640](https://github.com/raydocs/tono/actions/runs/35716494640)，四个 job 全部成功；
父线程读回实际 checkout 与日志，准确源码为 12a085a0：

| 检查 | job | 决定性输出 |
|---|---|---|
| Windows 前端 | [app106709108942](https://github.com/raydocs/tono/actions/runs/35716494640/job/106709108942) | `tsc --noEmit` 成功，36 files / 284 tests passed。 |
| Core（Ubuntu） | [core106709109092](https://github.com/raydocs/tono/actions/runs/35716494640/job/106709109092) | `cargo test --locked -p tono-core`：265 unit、10 + 1 + 3 integration passed。 |
| Windows Service | [service106709108905](https://github.com/raydocs/tono/actions/runs/35716494640/job/106709108905) | 库 303、installer 22 及现有 integration targets passed；保留原有 1 ignored。真实 WFP shape 单独 1 passed。 |
| Windows App 原生 | [app-rust106709108663](https://github.com/raydocs/tono/actions/runs/35716494640/job/106709108663) | `cargo test --locked`：499 passed、0 failed；原有 opt-in integration 1 ignored。`cargo test --locked -p tono-core --test update_journal_atomic`：3 passed。 |

原生日志明确包含账号替换不夺取旧成功记录、损坏/有界/账号归属存储、阻塞健康探测不排队等
新回归的 `ok`。这解决了先前 E0308，但不证明 Credential Manager 或已安装网络会话。
整合 macOS 后，`git diff --exit-code 12a085a0 HEAD -- apps/windows .github/workflows/windows-ci.yml tooling`
为 exit 0；Windows 树及该 CI/工具未改变，以上是有范围依据的沿用证据，不冒充在新 SHA 重跑。

最终 Windows PR 自动 run
[35717902392](https://github.com/raydocs/tono/actions/runs/35717902392) 随后四个 job 全部成功。
[app-rust106713627790](https://github.com/raydocs/tono/actions/runs/35717902392/job/106713627790)
实际 checkout 是临时 merge
[2ce220ed](https://github.com/raydocs/tono/commit/2ce220ed1830c68a1e85984f757c16825b9044f7)，
不是 source head。父线程 fetch 核对其 parents 为基线 046849f2 与源码 35e28dc3，且它与
35e28dc3 的完整 Git tree 都是 `50caea57c1982c9d4e8edded5bba406d6450457b`，diff 为零。
该 job 再次实际执行 `cargo test --locked`：499 passed、0 failed；原有 opt-in 1 ignored；
Windows 原子更新日记目标 3 passed。不是只依赖分片或旧分支结果。

35e28dc3 的普通 macOS push
[35717897070](https://github.com/raydocs/tono/actions/runs/35717897070) 四个 job 全部成功。
[build106714024510](https://github.com/raydocs/tono/actions/runs/35717897070/job/106714024510)
的实际 checkout 日志为完整 35e28dc312fa0d9b89284bb34d93954e69ad4510：unsigned Release
`BUILD SUCCEEDED`，以下原生命令 `TEST SUCCEEDED`：

```sh
xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono -configuration Debug \
  -resultBundlePath apps/macos/test-results/TonoTests.xcresult \
  CODE_SIGNING_ALLOWED=NO ENABLE_USER_SCRIPT_SANDBOXING=NO test
# Executed 356 tests, with 1 test skipped and 0 failures (0 unexpected)
```

目录竞态、固定地区、8 个 MacUsabilityTests、3 个报告 transport 回归和实际原生捕获测试通过。
唯一 skip 是既有 opt-in 安装脚本输出测试，不是本次回归；policy/privileged、实际 Swift runtime
与固定 Core/helper 合同也通过。receipt 的日志提取不可用，命名结果来自直接下载的完整 job 日志。
上述执行均为普通 push/PR 自动检查，未手动重复 dispatch。PR merge checkout 不冒充 source head；
文档提交不改变产品树时只沿用明确匹配的上述证据，不声称文档 HEAD 重新执行了同一检查。

既有独立审查线程完成六项功能及直接调用边界的有限反证审查，父线程核实了两项 P2：

- R1：Windows 仅选择器链误作终端证据。12a085a0 已修，红绿与浏览器证据如上；独立定点
  复查确认源码解决原反例，未发现这项修复的直接回归。复查没有重新运行测试，也不是全库结论。
- R2：macOS 验证期间同名目录替换，可把旧目录成功记到新 digest。分片回归先行提交
  [09cff3d2](https://github.com/raydocs/tono/commit/09cff3d2abac0080d1958cc818b7a93657fb9009)
  的 [build106709410256](https://github.com/raydocs/tono/actions/runs/35716447221/job/106709410256)
  已实际执行 356 项，1 existing skip、1 failure；失败准确落在
  `testHeldVerificationCannotCreditASameNameReplacementCatalog` 的
  `C1 verification must not mark the same-name C2 route as proven`，不是编译或 fixture 失败。
  父线程读回了 checkout 和该断言日志；随后将回归与
  [fd0ba192](https://github.com/raydocs/tono/commit/fd0ba19242437ddd6281457f7bb423e3f05a0380)
  的修复一起整合为 35e28dc3。connect/switch 都在悬挂前捕获目录 digest，写入必须与当前目录
  完全相等且非空；变化时宁可省略成功记录，不把 C1 证明改名为 C2。未改保护/生命周期分支。
  测试使用真实目录校验/发布、验证结果分类和历史写入，只在 origin 网络 I/O 注入 barrier；
  最终特权 runtime commit 由测试内表示，不声称执行了真实 helper 启动。独立定点复审已检查
  35e28dc3 的两个实际调用者、MainActor 同步写入和默认 I/O 参数，确认原反例已在源码解决，
  未找到这项修复的直接回归。测试自身不执行完整 connect/selectNode 编排，不能独立防住未来
  调用者重新捕获完成时 digest 的错误；两个真实调用者本轮由源码审查覆盖。上述组合源码原生
  日志已确认同一回归通过，未删断言或改变正对照，形成红/绿闭环。

未重开全仓审计、不新派子线程、不以 review 替代测试。
模型证据限制：沿用该审查线程历史配置；其本次 `AMP_INITIAL_AGENT_MODE_KEY` 为未设置，
不能重新确认当前实际模式。两端实现线程的创建配置选定了 `gpt-6-astra-max`，不把可用模式列表
或缺失的环境变量当成运行模型证明。

历史 macOS 分片 [d8cfa095](https://github.com/raydocs/tono/commit/d8cfa095fa6b7da6d92ebd68fa65510ee68bbf1e)
的 [run35712148855](https://github.com/raydocs/tono/actions/runs/35712148855) 在新增截图测试编译失败：
`accessibilityReduceMotion` 是只读 environment key。该 run 没有执行 XCTest 或生成实际渲染；
已改为禁用动画的 SwiftUI transaction 并纳入初次整合提交。

初次组合的原生测试 [artifact10689192090](https://github.com/raydocs/tono/actions/runs/35714091681/artifacts/10689192090)
含 xcresult 与 11 张 PNG；GitHub 给出的归档 digest 是
`sha256:3294ec7512f173f6c13fa262c36be4f3a5e49c21a59d0252caba243e1ca1b4ce`，到期日 2026-09-29。
实际下载、view_media 检查了健康未知、Activity 云端/未知、报告预览/失败/合成回执、恢复反馈；
报告 JSON 处于有界滚动区，截图不声称覆盖全部滚动内容或真实上传。
macOS 分片同时确认 Dashboard 整张 alpha=0、Nodes 有离屏合成缺失；这些截图**不算通过**。
35e28dc3 已把这三项捕获限定为真实生产组件并增加透明度拒绝检查，不关闭生产玻璃效果，
不申请屏幕录制权限；完整 Liquid Glass 页面仍需原生窗口证据。

最终组合的 [artifact10689799532](https://github.com/raydocs/tono/actions/runs/35717897070/artifacts/10689799532)
名为 `tono-macos-tests-35e28dc312fa0d9b89284bb34d93954e69ad4510`，1,679,676 bytes，
GitHub 归档 digest 为 `sha256:a0f804c99e46f838347832c4028abed7b77986ab2c637d0d7d0294e0c172d20e`，
到期日 2026-09-29 10:54:31 UTC。父线程下载 xcresult 和 11 张直接 PNG，逐张用 view_media 检查：

- US 地区/近期成功/查看推荐可读；移除地区显示 `Saved region unavailable`，没有越区推荐按钮。
  这两项是 RouteChoicesView 生产组件，不宣称整张 Nodes 或收藏卡片的原生布局已验收。
- 暂停唤醒、网络变化中的恢复组件及真实菜单栏恢复/解除操作可读，未见重叠。
- 健康结果保留 live PF/DNS/Core 未知和授权失败；构建卡明确显示 Debug、实际 source、dirty=true
  及签名/运行身份未验证，不把 CI 构建包装成签名候选。
- 报告预览、无回执、合成回执的 JSON 是内部有界滚动视口，动作与状态没有重叠；
  `SYNTHETIC-NOT-A-SERVER-RECEIPT` 不是实际上传证据。截图未验证滚动到所有 JSON 字段。
- Activity 展示真实 fixture 目录终端与 selector-only 未知；文案限定当前上报的逐流信息，
  不据此声称应用所有流量或逐包路径已验证。

检查范围内未发现剩余可见布局缺陷；内容范围外、真实点击和完整玻璃窗口效果不由这些截图证明。

## 不能省略的稳定版门槛

- 工程层结论：本轮六项能力的代码整合、确认问题的红/绿整改、已列自动化与有限独立审查完成，
  没有尚未修复的已确认范围内源码阻塞；工程上可进入后续内部实机验收，不是全仓无缺陷证明。
  测试与实际调用者审查的不同覆盖范围、模式无法重新确认和完整原生窗口渲染缺口均保留如上。
- 实机层结论：尚缺同一最终候选在 Windows 11/macOS 的登录、真实 TUN HTTPS、速率/Activity、
  断开 DNS 恢复、再次连接及睡眠/网络切换证据。凭据格式或 EOF 不能单独确定 UUID/握手根因。
- G3：[#26](https://github.com/raydocs/tono/issues/26) 的受保护更新与已装设备证据仍开放；
  [#273](https://github.com/raydocs/tono/issues/273) 的候选签名配置修复来自 #276，仍不代表实际
  签名/公证完成。旧安装器 smoke 的准确源码是 429d6e40，不冒充本功能版本的安装验收。
- 以上记录截止整合分支验收时，当时未合并、部署、签名、创建发布标签、发布朋友包或改客户
  更新源。此后的合并及测试候选使用所有者追加授权，状态见下节；G1–G3 仍须有实机证据才能
  推进客户渠道。本记录不提供发布许可，也不承诺全库没有其他 bug。

## 追加授权：合并后的 0.0.73 测试候选

所有者随后要求完成工程验收并合入 main，再启动 GitHub CI 生成新的 0.0.73 包供测试人员测试，
同时继续检查遗漏风险。#276、#279 已分别普通合并；测试候选冻结于 main
[569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d)，
远端专用分支 `stability/desktop-0.0.73-20260922` 指向同一提交。没有改写平台发布线或旧标签。
整合分片 #277/#278 不再独立合并。

合并后自动 push CI 的实际 checkout 和完整日志已读回，不再只是沿用 PR merge-tree 证据：

- [Windows 35722605447](https://github.com/raydocs/tono/actions/runs/35722605447) 四个 job 成功。
  [app-rust106728962323](https://github.com/raydocs/tono/actions/runs/35722605447/job/106728962323)
  的 `cargo test --locked` 为 499 passed / 0 failed，原有 opt-in integration 1 ignored；
  `cargo test --locked -p tono-core --test update_journal_atomic` 为 3 passed。
- [macOS 35722605401](https://github.com/raydocs/tono/actions/runs/35722605401) 四个 job 成功。
  [build106729267381](https://github.com/raydocs/tono/actions/runs/35722605401/job/106729267381)
  的 unsigned Release、实际 runtime/Core/helper 合同和 XCTest 成功：356 tests / 1 existing skip /
  0 failures。receipt 日志提取不可用，数量来自直接下载的完整 job 日志。
- 候选工作流必需的 [frontend106735823380](https://github.com/raydocs/tono/actions/runs/35724809207/job/106735823380)
  在同一准确源码执行 `pnpm typecheck` 和 `pnpm test`：36 files / 284 tests passed。

本次追加检查限定于发布入口、源码与产物身份、打包信任边界和安装检查，没有重新发起全仓审计。
确认并纠正了发布说明的真实错误：macOS 原文声称 14+、helper 4.3.0，但项目部署目标和 helper
编译目标均为 26.3，打包明确为 arm64，`HelperProtocolVersion.current` 为 4.4.0。新说明明确
Apple Silicon / macOS 26.3+，不再声称此包适用于 Intel/14/15，也不保证所有 helper 更新都无
授权提示。Windows 说明标明 x64，并把两端的“first public cut”改为未获稳定版资格的测试候选。
这些是文档修正，没有更改版本、兼容性目标或产品二进制；按仓库规则不为文档再跑产品测试。

已有 `tono-macos-0.0.73-build73` 指向旧源码，`v0.0.73` 也已有旧安装器草稿。因此不能覆盖旧
标签或混用旧草稿资产。新测试交付使用独立内部 RC 标签，不标 Latest，不上传客户 feed，
不推进 Sparkle、`windows-updates` 或生产 Worker。macOS 候选不进入 Sparkle 签名环境；Windows
候选关闭 updater 配置，保留未作 Authenticode/updater 签名的声明。

### macOS 新签名包：CI、Apple 公证与下载校验通过

本次唯一一次手动候选运行是
[35724809207](https://github.com/raydocs/tono/actions/runs/35724809207)，输入
`version=0.0.73, candidate_only=true`，上述专用分支与准确源码。六个 job 成功，
`validate-appcast` 按候选隔离合同跳过，而不是 Sparkle 签名成功。
[build106737261893](https://github.com/raydocs/tono/actions/runs/35724809207/job/106737261893)
的完整日志确认：

- 实际 checkout 为 569ce8654f57e66f293cf4e443b5e0819b71912d。
- `xcodebuild test ... -configuration Debug -destination 'platform=macOS,arch=arm64'`
  为 356 tests / 1 existing skip / 0 failures，目录竞态回归通过。
- `tooling/scripts/package-macos-test.sh` 重建当前 helper，归档并签名；`codesign --verify
  --deep --strict --all-architectures` 成功。公证输出 `status=Accepted, submitExitCode=0`，
  `stapler validate` 输出 `The validate action worked!`，`spctl -a -t exec -vv` 输出
  `accepted / source=Notarized Developer ID`。没有使用跳过签名或忽略拒绝的路径。

[artifact10693693603](https://github.com/raydocs/tono/actions/runs/35724809207/artifacts/10693693603)
是 `Tono-0.0.73-build73-arm64`，20,215,154 bytes，GitHub 外层归档 SHA-256
`24d1d190c6924722a916917f38d045dd339da3c91d015ab4e3038aceb9312028`，2026-09-29 12:17:32 UTC
到期。下载后 `sha256sum --check -` 输出 `macos-run-artifact.zip: OK`。
内部实际分发 ZIP 为 `Tono-0.0.73-build73-arm64.zip`，SHA-256：
`fb4dc0f68987da54705b20c386426d631cb3a2659740d87965ff672f5332393f`。

Linux Orb 使用 `zipfile/plistlib/hashlib/struct` 只读校验 ZIP CRC、唯一顶层 `Tono.app`、
内部 ZIP/App/helper/Core 与 manifest 的全部摘要、三个 Mach-O 的 arm64 类型，以及实际
`Info.plist` 的 `0.0.73 / 73 / LSMinimumSystemVersion=26.3`，全部通过。签名验证证据来自
上述 macOS 托管 job，不把 Linux 的摘要检查冒充 codesign/Gatekeeper。
包内 `tono-build-source.json` 实读为准确源码、`Release`、`dirty=true`；构建脚本会重建已跟踪
的 helper 资源，该字段不是纯源码 checkout 时的 clean 证明，没有为美化显示而写成 false。
manifest 保留 `candidateOnly=true, releaseAccepted=false, developerIDSigned=true, notarized=true,
sparkleSigned=false`。这关闭实际候选签名/公证的执行缺口，不关闭已安装 helper/设备网络验收。

### Windows 新包：内容预检与原始安装检查通过

本次一次 [candidate35724809260](https://github.com/raydocs/tono/actions/runs/35724809260)
在同一专用分支、准确源码完成；[build106736468397](https://github.com/raydocs/tono/actions/runs/35724809260/job/106736468397)
实际重建 Service/Core/App，不复用旧 0.0.73 草稿安装器。`pnpm typecheck`、4 项 updater
测试及 85 项打包/开发合同测试通过，保留 5 个既有平台相关 skip。
`pnpm release:preflight --payload-only <installer>` 的实际 7-Zip 内容检查通过，17 entries，
Service 与安装 helper 内嵌 Core pin、pin 文件和已打包 Core 匹配。

[artifact10694885424](https://github.com/raydocs/tono/actions/runs/35724809260/artifacts/10694885424)
是 `tono-windows-0.0.73-candidate-569ce8654f57e66f293cf4e443b5e0819b71912d`，25,127,722 bytes，
外层归档 SHA-256 为 `0d537f3fc6ad789df83465795a1dcba38d1a9107b7a8989e889e1361d683e11d`，
2026-09-29 12:34:34 UTC 到期。下载后 `sha256sum --check -` 输出 `windows-run-artifact.zip: OK`；
manifest 源码/版本和以下实际安装器 SHA-256 校验通过：

`Tono_0.0.73_x64-setup.exe`，25,135,330 bytes，
`e0837a2ab2f5126ae05f11188f9a7de469605453785888310cafb7f566ed0cad`。

随后仅运行一次同分支、同源码、指定候选 run 的
[smoke35728148869 / job106746780226](https://github.com/raydocs/tono/actions/runs/35728148869/job/106746780226)，
保留原始 disposable GitHub-hosted Windows Server 2025 限制与候选来源检查。实际命令仍为
`tooling/scripts/test-windows-candidate-install.ps1 -CandidateDirectory $env:CANDIDATE_DIRECTORY`，
未采用 #275 的诊断模式、改 cwd 或放松 journal 门禁。原始输出：

```text
PASS fresh silent install, Service running, installed Core pin, no GUI auto-launch
PASS same-version replacement/repair and Service restart
PASS uninstall removed Service/runtime payload and preserved DNS
```

[artifact10694142487](https://github.com/raydocs/tono/actions/runs/35728148869/artifacts/10694142487)
已下载读回，源码为准确 569ce865，`freshInstall/sameVersionRepair/uninstall/dnsUnchanged=true`、
`physicalUpgradeQualified=false`。这是新组合包的未配置安装/修复/卸载证据，不是旧包沿用，也不
证明 Windows 11、旧版已登录升级、真实 TUN/WFP 流量或受保护更新。安装器 manifest 明确
`candidateOnly=true, releaseAccepted=false, updaterSigned=false, authenticodeSigned=false`。

### 已发布的测试交付与仍待测试的场景

[Tono 0.0.73 — Test candidate RC 2026-09-22.1](https://github.com/raydocs/tono/releases/tag/tono-desktop-0.0.73-rc.20260922.1)
已发布为 `draft=false, prerelease=true`。新标签 `tono-desktop-0.0.73-rc.20260922.1` 读回为
准确源码 569ce8654f57e66f293cf4e443b5e0819b71912d，非本次文档修订提交。
先建立 Draft、核对六项上传摘要/大小/发布说明与准确 target，再发布预发布；没有替换资产。
GitHub Latest 仍是 `v0.0.72`，旧 macOS 0.0.73 标签与 Windows 0.0.73 草稿保留。

发布资产包含 Windows 安装器、已签名/公证的 macOS ZIP、两个平台的原始 candidate manifest、
Windows 安装检查 JSON 和 `SHA256SUMS.txt`。六项都使用无认证 `curl -qfsSL` 从公开资产 URL
重新下载，HTTP 200；逐项与 GitHub 上传 digest 比较一致，`sha256sum --check SHA256SUMS.txt`
对两个包、两个 manifest 和安装回执全部输出 `OK`。测试者不需要 GitHub 账号读取这些下载。
这证明本轮 Orb 到公开资产的可达性，不证明大陆所有网络均可访问 GitHub。

本轮额外排查没有确认新的产品运行时缺陷；确认修正的是发布说明的兼容性、helper 版本和
候选资格误标。未为“找更多问题”再扩展功能、重构或升级依赖，也未将新包替换成未测试源码。
签名/构建/原始安装检查均无当前阻塞，可以交给指定测试人员进行手动设备验收；仍不能称为
已通过全部稳定版门槛。

Release 已提供中文测试清单：先断开并退出旧版，核对哈希与支持页源码，再走登录、真实 HTTPS、
仪表盘/Activity、断开恢复 DNS、再次连接，以及收藏/固定地区/报告预览回执检查。睡眠、网络
切换和受保护更新只在可恢复内部设备单列。失败保留同一次尝试的脱敏诊断、阶段与错误码，
不提交 UUID、令牌、密码或完整配置。真实账号上传、PF/WFP 流量、装机授权、完整原生玻璃页面、
G1–G3 设备及运营商证据仍未由本轮建立，#26 和 #273 保留边界而不自动关闭。
没有新增合并、生产部署、客户 feed 编辑或自动更新推广；发布说明及证据文档通过独立 PR 交付。
