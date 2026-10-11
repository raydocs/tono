# #1071：A13 生产路径回归交接 · 2026-10-11

**交付是证据与回归设计，不是修复或验收 PASS。** #1071 在下列精确 head 上仍存在；协调者已把它纳入
[#1504](https://github.com/raydocs/tono/pull/1504) / 决定092，由同一 A13 实现者处理，不另建自动放行修复。
归属：[SHIP_PLAN](../SHIP_PLAN.md) G1/G2；#1307、更新架构重写与发布不在范围内。

## 版本与文件所有权

- 当前 main：[134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a](https://github.com/raydocs/tono/commit/134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a)。
- 指定核对的 A13：[f631a083b5b25ca14c3820e558f82110accd6f09](https://github.com/raydocs/tono/commit/f631a083b5b25ca14c3820e558f82110accd6f09)。
  `git diff 134e126a f631a083 -- apps/macos/Tono/Core/HelperManager.swift` 显示会话代际新增，
  **abandoned-upgrade 的预检/清理没有改变**。没有把旧审计当作当前 head 的证据。
- [协调者](https://ampcode.com/threads/T-01a12506-8674-77da-a956-c31ff53add43) 明确：A13 合并前独占 HelperManager、
  helper 恢复实现及其文件列表；本交接不写任何产品或测试源码，不改092/084文件、release协议、SocketServer或OperatorRelease。
- 协调者确认后的目标：**自动失败保留 PF、DNS 快照及 intent，错误上报；用户明确 Restore internet / Disconnect 才释放**。
  这取代 #1071 最初设想的自动“放普通联网、留窄 AI 层”；不再承诺二者自动同时完成，也不擅自用新权限补旧 helper 能力。
  保留全保护的可用性成本必须明确告知，显式恢复仍须可用，未知读回不能显示已解除。

## 当前路径与已有真实执行证据

在 f631a083，`HelperManager.prepareReplacementBeforePrompt` 停掉旧 Core；静默替换失败且不允许管理员弹窗时抛错，
其 defer 调 `cleanUpAbandonedUpgrade`。app 没有 A29 fault 且 fresh `helperReportsFault == false` 时：

```text
HelperManager.swift:485–488
  restoreProtectedDNSIfConfigured()
  disarmKillSwitch()                 // 默认 preserveAIHold=false
  KillSwitchService.isArmed = false
HelperManager.swift:1096–1099
  false → POST /killswitch/disarm
SocketServer.swift:1084–1087
  /killswitch/disarm → disarm(preserveAIHold: false)
KillSwitchManager.releaseWithAIHold
  false → release broad PF → finishSelectiveRemoval
```

源码证明默认操作会请求完整解除窄 AI 层；它不是已经测得的真机泄漏。
而且只堵 defer 不够：当前 `prepareReplacementBeforePrompt` 的 no-fault 预检仍恢复 DNS，丢弃快照，须一并遵守092。

[ci-gate 38106694496](https://github.com/raydocs/tono/actions/runs/38106694496) / [macos build job 114373950961](https://github.com/raydocs/tono/actions/runs/38106694496/job/114373950961)
已实际执行下列原生 XCTest，未重复触发。run head=f631a083，实际 PR 合成 checkout 为日志中的 dd47785：

```text
HEAD is now at dd47785 Merge f631a083b5b25ca14c3820e558f82110accd6f09
  into 134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a
Test Case '-[TonoTests.LocalNetworkDevicesArmFieldTests
  testAbandonedUpgradeReleasesWithoutAFaultAndUserDisconnectReleasesAHeldOne]'
  passed (0.003 seconds).
Executed 708 tests, with 1 test skipped and 0 failures
```

该既有测试调用生产 `prepareReplacementBeforePrompt`，helper I/O 注入；明确断言 `dnsRestores=1`、`releases=1`。
这证实 **no-fault 自动释放分支被实际执行**，但它以旧行为为期望，不能作为092回归 PASS。
它没有使用 live release、没有测实际 PF/DNS 或选择性 AI 层。两个 held/unknown fault 控制亦实际通过；不能用它们替代 false 分支。

历史能力边界独立核对：[9960255660e6bc07261e96b53d2a65e68cd1f19a](https://github.com/raydocs/tono/commit/9960255660e6bc07261e96b53d2a65e68cd1f19a)
才加入 `/killswitch/release`，同 commit 的 HelperProtocolVersion 为 **4.52.17**，父版本4.52.16没有该路由。
因此不盲发 legacy release；本次092方案不需要它。

## 一个 XCTest 覆盖自动失败和其后的用户恢复

由 A13 owner 修改现有 `LocalNetworkDevicesArmFieldTests` 的 no-fault control，**替换旧期望，不另复制一个相冲突的测试**。
复用同文件的 `abandonedReplacement`、`ReplacementLog`、`makeApp`，在实际 prepared-helper 入口驱动失败；
不要只断言 `shouldReleaseAfterAbandonedUpgrade` 的布尔值。下面是基于 f631a083 接口的交接设计，**未添加到测试树、未编译或执行**：

```swift
func testNoFaultAbandonedUpgradeKeepsProtectionUntilExplicitRestore() async {
    let log = ReplacementLog()
    KillSwitchService.isArmed = true
    XCTAssertFalse(LocalNetworkDevicesSync.holdsProtectedFault)

    XCTAssertThrowsError(try HelperManager.prepareReplacementBeforePrompt(
        installedVersion: "4.52.16",  // 没有 /killswitch/release 的旧 helper
        daemonRejected: false,
        administratorPrompt: false,
        operations: abandonedReplacement(log: log, faultReads: [false])
    )) { error in
        guard case HelperInstallError.installFailed = error else {
            return XCTFail("expected withheld-prompt install error: \(error)")
        }
    }
    XCTAssertEqual(log.coreStops, 1)
    XCTAssertEqual(log.dnsRestores, 0, "preflight must retain protected DNS and its snapshot")
    XCTAssertEqual(log.releases, 0, "no-fault abandon is not explicit release authority")
    XCTAssertTrue(KillSwitchService.isArmed)
    XCTAssertFalse(LocalNetworkDevicesSync.holdsProtectedFault)

    // 同一份 armed 状态，不能先 reset 或人为制造 A29 fault。
    var explicitDisarms = 0
    var explicitDNSRestores = 0
    let app = makeApp { explicitDisarms += 1 }
    app.networkProtection.restoreDNS = {
        explicitDNSRestores += 1
        return true
    }
    app.networkProtection.releaseAfterFailure = {
        XCTFail("explicit Restore must not use automatic release")
    }
    app.isConnected = false // 旧 Core 已停，不伪造一个活隧道
    app.isProtectionBlocked = true
    app.protectedDNSService = "Wi-Fi"
    app.disconnect(releaseKillSwitch: true) // 用户 Restore/Disconnect 的生产入口
    await app.connectionCoordinator.disconnectSequence?.value
    XCTAssertEqual(explicitDisarms, 1)
    XCTAssertEqual(explicitDNSRestores, 1)
    XCTAssertFalse(app.isProtectionBlocked)
    XCTAssertNil(app.protectedDNSService)
    XCTAssertFalse(app.isDisconnecting)
}
```

`setUp/tearDown` 已保存/恢复 isArmed 并 reset LocalNetworkDevicesSync。若 A13 改了注入类型，由其 owner 适配这个窄 I/O 边界；
保留输入及外部结果，不依赖读 fault 的次数或日志文字。选4.52.16、false fault、已停 Core，是为了抓旧兼容分支，
不是用 true/unknown fault 的容易控制掩盖问题。

**测试限制：** `makeApp.disarm` 只记录请求，不改 isArmed；故设计没有把 fake 自己清旗标当作 live IPC 成功证据。
显式阶段证明生产 App 的 release admission、DNS调用及状态结算，不证明真实命令执行。完整 PF/DNS/AI readback 是设备门。
它也不覆盖 osascript 真正取消或安装进程启动超时；那些出口须由 owner 核对共用同一清理语义，不扩展为本轮全故障扫描。

## Owner 与唯一 Sol reviewer 的最短后续

1. A13 owner 先在修前源上执行这同一回归并保留失败（旧分支应违反 DNS=0/release=0），再修预检和清理后跑同一回归；
   **本交接没有新的 RED/GREEN 回执**。已有绿色旧期望不可冒充新的失败复现。
2. hosted macOS 可定点执行下面的 XCTest；PR 仍只使用自身 ci-gate，不重复 dispatch 原生 workflow：

   ```sh
   xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono -configuration Debug \
     -only-testing:TonoTests/LocalNetworkDevicesArmFieldTests/testNoFaultAbandonedUpgradeKeepsProtectionUntilExplicitRestore \
     CODE_SIGNING_ALLOWED=NO ENABLE_USER_SCRIPT_SANDBOXING=NO test
   ```

3. 协调者将 false-fault 预检/清理和显式恢复加入[原 Sol reviewer](https://ampcode.com/threads/T-01a126c1-8b2b-741f-b212-3669beb1724d) 的最终 head 检查单；
   仅同 head 的源码+CI+独立回执有效。不得把本 docs PR 绿当作 #1504 的评审或保护验证。
4. 可恢复 Mac 按既有 G1 流程验证旧 helper 取消后 PF/DNS快照/intent仍在且错误可见；用户明确恢复后
   PF 空、DNS 回基线、普通 HTTPS 恢复且迟到工作不重封。显式解除可移除 AI 层；这是用户授权恢复，不是隐私或保护降级被偷偷执行。

这里只读当前源码/CI/历史并提供交接，不另建 worker、不改092、不发候选/生产操作、不关闭 #1071。
后续 #1504 head 变动必须重新绑定证据；待实现、CI/Sol及所需设备门完成后由其 owner 记状态。
