# 本批本地收据（未冻结）

主机：所有者 MacBook，Xcode 26.6；仅 Foundation Swift package，不安装任何组件。
本轮所有者明确要求本地单测先行，因此本机运行包测试；不把旧版默认 hosted-only 流程作为跳过本地验证的理由。

| 文件 | 命令／对象 | 原始结果 |
|---|---|---|
| baseline-swift-test.log | `swift test --package-path apps/ios/TonoKit`；未修改的 `3ab870ef` | 74 tests，0 failures，exit 0 |
| implementation-swift-test.log | 同命令；Opus 第一版未提交实现 | 94 tests，0 failures，exit 0 |
| integration-regressions-red.log | `swift test --package-path apps/ios/TonoKit --filter 'testAnEarlierPositiveReplyCannotUndoALaterUnansweredQuestion\|testAnUnconfirmedReadingNeverHasAnOnSwitch\|testALateBeatCannotMoveTheSameGraphConfirmationBackwards'`；根线程追加三项测试后的第一版 | 3 tests，5 assertion failures，exit 1 |

无新 commit/freeze；这些记录不能绑定为后续修改的验证。精确测试符号、失败机制见相邻 plan。修改后将另存 green 输出，不覆盖 red。
未执行：本批 App/PacketTunnel/Widgets 原生编译、模拟器 UI、真实 NE、系统 App Group、真机、签名和真实服务。

## 根线程修正后实跑

| 文件 | 对象／命令 | 原始结果 |
|---|---|---|
| integration-regressions-green.log | Opus 修正后，原三个红测，同上 filter | 3 tests，0 failures，exit 0 |
| correction-swift-test.log | Opus 修正后完整 `swift test --package-path apps/ios/TonoKit` | 108 tests，0 failures，exit 0 |
| generation-watermark-red.log | 再追加 `--filter testSilenceDoesNotEraseTheLastKnownGraphGeneration`，尚未修正 watermark | 1 test，2 assertion failures，exit 1 |
| stale-reply-regressions-green.log | watermark 及 stale put-back gate 修正后，`--filter 'testSilenceDoesNotEraseTheLastKnownGraphGeneration\|testAReplyAfterTheSessionEndedCannotPutOldInputsBack'` | 2 tests，0 failures，exit 0 |
| final-foundation-swift-test.log | 根线程最终完整包 `swift test --package-path apps/ios/TonoKit` | 110 tests，0 failures，exit 0；XCTest 0.184 秒，不含编译时间 |
| stale-write-negative-control.log | `bash docs/agent-reports/2026-10-19-ios-state-authority-receipts/stale-write-negative-control.sh`，仅在私有临时 package 移除两个 pre-side-effect gate | 1 test，1 assertion failure，exit 1；错误地执行第二次旧输入恢复写入。不是历史基线的 red，不修改 checkout |
| static-checks.log | 69 个 iOS Swift 文件 `xcrun swiftc -parse`；routing sync check；`git diff --check` | 全部 exit 0；只证明语法，不是 App/extension typecheck／构建 |

`source-SHA256SUMS` 绑定最终包测试及语法检查时的改动源码／测试／strings 字节；只是未提交工作区快照，不是冻结 SHA。`SHA256SUMS` 绑定本目录日志、负控脚本和源码清单。子任务声称的 50 次锁测试和 11 项 mutation 未由根线程重跑，不作为本收据的独立实跑结论。
