# Tono：可靠一键解除保护——特权 helper 并发机制独立设计 Handoff

> **保存说明（非原文）：** 下面是 Puck 线程 2026-10-11 提供的 handoff 原文，按原样保存，未删改。原文里的 Amp
> 线程链接需要登录才能打开，因此 GitHub 上的对应证据另见 [README.md](README.md) 和
> [STATUS.md](STATUS.md)。原文的 checkpoint 是写作时的历史状态；最新 head、CI 和审核结论以
> [STATUS.md](STATUS.md) 及 PR #1504 为准。

---

下面这份可以直接交给另一个 AI。它的任务是**独立判断是否必须重构、提出可证明的最小方案**，不是沿用现有设计继续扩写。

---

# Tono：可靠一键解除保护——特权 helper 并发机制独立设计 Handoff

## 目标

Tono 是 macOS / Windows 网络保护产品。本次重点是 **macOS 特权 helper**。

用户要求：

> 自动更新、helper replacement 或恢复失败，不能擅自解除保护；用户必须能明确一键恢复正常网络。解除不能被旧任务无限拖住，也不能在解除或重新连接后，被迟到任务再次封网。

需要同时满足：

1. 解除本地可用，不依赖登录、API 或隧道。
2. 有明确、可证明的**总时间预算**，包含排队、启动、drain、特权调用和状态读取。
3. 超时、查询失败、部分解除只显示 `unknown / partial`，不能显示已解除。
4. 分别核实 PF、Core/TUN、DNS、代理、AI hold 的实际结果。
5. 旧工作不得在解除后重新施加保护，也不得破坏用户随后明确发起的新 Connect。
6. App/helper 重启、崩溃、更新 executor、rollback helper、紧急 CLI 都必须纳入所有权和代数模型。
7. 旧 helper 不支持新机制时，不能错误启用依赖新机制的超时优化。

**“60 秒后 UI 不再等待”不等于网络恢复有界。**

## 仓库与工作入口

- 仓库：`raydocs/tono`
- 主 PR：[A13 #1504](https://github.com/raydocs/tono/pull/1504)
- 主协调线程：[实现与集成](https://ampcode.com/threads/T-01a12506-8674-77da-a956-c31ff53add43)
- 原独立审核线程：[Sol 安全审核](https://ampcode.com/threads/T-01a126c1-8b2b-741f-b212-3669beb1724d)

开始前请读取 **PR 最新 head、评论和 diff**。下面是历史 checkpoint，不能当最新状态：

| Checkpoint | 状态 |
|---|---|
| 代码 `5b23b163` | CI 绿，但 Sol R10 **FAIL** |
| 设计 `8632c8c3` | docs-only，Sol 第三轮设计 **FAIL** |
| R10 代码审核 | [完整 receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106817973) |
| 第三轮设计审核 | [完整 receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106874498) |

## 已实现但尚未解决整体硬门的改动

既有 worker 已做或正在修：

- **(a)** 显式解除持久化 `released<n+1>`，拒绝旧 arm/Core/DNS/自动恢复；只有用户明确 Connect 才重新 arm。
- **(b)** 对支持栅栏的 helper 设置约 10 秒 App drain 上限。
- **(d)** Support 指引改为 `--emergency-disarm`，标为本地管理员最后手段。
- 修复 PF 查询失败误判已解除、旧 `disconnectVerified` 被下一次尝试沿用等问题。

这些**不构成可靠有界解除已完成**。

### 当前代码主要失败

**R10-F1：** drain 超时后，旧 teardown 仍可能迟到完成，停止或限制用户随后发起的新 Connect。

既有修复方向是让新 Connect 等旧 teardown 结束。请检查它：
- 是否避免旧任务破坏新连接；
- 是否只是把无界等待转移到 Connect；
- 是否与最终所有权模型兼容。

**R10-M1：** 代理恢复预算不是已证明的上限。

## 为什么当前解除可能无界等待

以下位置来自既有调查，**行号随 head 变化，需重新定位和核实**：

| 位置 | 已报告的结构性问题 |
|---|---|
| `OperatorRelease.swift:283–296` | `guardedEffect` 仅比较 mode；12+ 调用点不能完整证明任务代数与所有权 |
| `SocketServer.swift:401–407, 931` | 串行请求循环及 update lock 可能阻塞解除 |
| `SocketServer.swift:1099–1103, 1121–1122, 1018–1020, 1036–1042`；`CoreManager.swift:102–105` | power、Core、KillSwitch 之间存在锁循环 |
| `HelperManager.swift:957–980` | session generation 存在仅内存持有的问题 |
| `ProtectedDNSManager.swift:1192–1201` | 进程内 System Configuration DNS 写入不能简单通过放弃等待撤销 |
| `HelperManager.swift:1403` | `/update/stage` 长调用可阻塞后续操作 |
| `PrivilegedRuntimeCoordinator.swift` | actor 串行化可能让解除等待先前特权调用 |

曾报告 repair、update 等操作耗时数百秒；**这些数字也不是已经证明的最坏上限**。

## 已被否决的设计及原因

上一版提出：

- 跨进程 target lock 成为所有保护 mutation 的最外层锁；
- 覆盖 daemon、更新 executor、rollback helper、紧急 CLI；
- effect 放入有界 child，DNS 写入也移入 child；
- 重排锁顺序；
- 独立 release socket；
- 一个总 deadline；
- 用 session generation CAS 实现幂等解除。

Sol 认为“全部串行化在跨进程锁下”原则上可行，但**现有设计未证明下面四项**：

### D3-F1：崩溃稳定的锁与 effect 所有权
未说明 child exec、daemon death/bootout、DNS commit 经由 `configd` 时：
- 锁由谁持有；
- 父进程死亡后谁仍能写；
- 子进程死亡是否意味着系统 mutation 已停止；
- 什么时候可以安全交接所有权。

### D3-F2：跨进程生命周期的 release epoch
null/replayed release request 没有完整跨 incarnation 语义。旧请求可能在 App 重启后误撤销一个更新的 Connect。

### D3-F3：旧 writer 的持久隔离
一次进程扫描不能排除之后才启动的 legacy/rollback writer。需要证明持久的 launch quarantine 或等效机制，而不只是“目前没发现旧进程”。

### D3-F4：代理所有权
代理恢复没有统一 epoch、崩溃所有权和总期限；不能只把 PF/DNS 做正确就称整体解除正确。

更早的设计还缺：
- `.going` 超时后的原子撤销，或确证 child 已死亡；
- effect 与 undo 相对新 Connect 的线性化；
- bounded socket IO；
- 完整锁图、单调时钟 deadline 和 abandoned work 的归属。

## 请独立回答

1. **是否真的必须大规模重构？**  
   是否存在更小、风险更低的架构，满足同样硬门？不要先接受“新增 release socket＋所有 mutation 子进程化”是唯一方案。

2. **最小正确性模型是什么？**  
   明确：
   - 持久 target / epoch；
   - request identity、App/helper incarnation；
   - mutation ownership；
   - release 与 Connect 的线性化点；
   - effect、undo、cleanup 的授权；
   - crash/restart/legacy writer 的处理。

3. **如何实现真正有界解除？**  
   给出一条完整 critical path，标明每段的硬上限和依据。  
   如果某 OS API 无法证明有界，明确指出，不能用 UI 超时或 kill child 替代证明。

4. **哪些实际保证无法达成？**  
   区分“有界返回且报告未知”和“有界恢复网络”。若只能保证前者，必须如实说明。

5. **如何分阶段落地？**  
   列出最小改动面、兼容策略、需要迁移的旧调用，以及每阶段的不变量与验收条件。先给设计，不直接修改生产代码。

## 必须包含的验证场景

- 长更新/修复进行中 → Restore；
- Restore 超时 → 旧操作迟到；
- Restore → 新 Connect → 旧 teardown/undo/cleanup 迟到；
- App 重启后的旧 release request 重放；
- daemon/child/update executor/rollback helper 崩溃或重新启动；
- DNS 系统写入已提交但 child/daemon 状态不明；
- 旧 helper 或旧 writer 在解除后才启动；
- PF 查询失败、DNS/代理/AI readback 分项失败；
- 重复点击 Restore、并发 Restore/Connect；
- sleep/wake；
- 无登录、API 不可用、隧道不可用；
- App 卡死时的紧急入口。

测试必须说明：哪些能靠单元/集成测试证明，哪些需要实际 macOS 上的 PF/DNS/代理/AI 验证。截图、mock PASS 和源码审核都不能替代设备证据。

## 边界与交付

本轮是**独立只读方案评估**：
- 不改代码、不合并、不发布、不启动重复 implementation worker。
- 不改变“自动失败保留保护、只有用户明确解除”的产品规则。
- Windows failed-Prepare 的历史例外是另一个待 owner 决策事项，不在此擅自裁定。
- 原先“1,500–2,500 行、4–6 天”的估计未经审核确认，**不要当成承诺**。

请交付：
1. 最小推荐方案及至少一个替代方案；
2. 四项设计失败如何逐一闭合；
3. 状态模型、锁/所有权图、完整 deadline 路径；
4. 具体文件与分阶段改动范围；
5. 回归与设备验收矩阵；
6. 不可证明的限制、风险及有依据的工期估计。

**用户目前明确要求：等可靠解除方案完成，再拿双平台安装包测试。不得默认改成提前出包。**
