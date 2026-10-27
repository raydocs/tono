## 2026-10-26 · macOS 帮助程序「恢复网络」与过期步骤拒绝的稳定错误码
- 归属：G3（macOS 客户端）；模块 `apps/macos/Tono/Services`（`ProtectedConnectivity`、`AppState+Connect`）、`apps/macos/TonoTests`。帮助程序、`Localizable.xcstrings`、`services/` 均未改。
- 来源：分支 `fix/macos-helper-refusal-codes`（基线 origin/main `022cf44f2`，含 PR #1767、#1769）；一个提交。未合 main。
- 缺陷修复：近 14 天遥测里，macOS 连接失败以 `UNKNOWN_CLASSIFIED_FAILURE` 上传的两组，错误文本分别是「上一次恢复正常网络还没有结束，Tono 暂时不会连接。请再点一次「恢复正常网络」，然后再连接。」（12 条）和「这一步属于之前的连接，没有执行。」（8 条）。两者都是帮助程序带类型码的拒绝（`RELEASE_UNFINISHED`、`STALE_GENERATION`），应用早已把它们转成用户句子（`HelperIPCError`），但 `AppState.helperRefusalFailure` 只按文本认两种拒绝，其余返回 nil，于是落为 UNKNOWN。
- 新增码（`ProtectedFailureCode`）：`TONO_RELEASE_IN_PROGRESS`（帮助程序 `RELEASE_IN_PROGRESS`）、`TONO_RELEASE_UNFINISHED`（`RELEASE_UNFINISHED`，以及 `RELEASE_RECORD_CORRUPT`，用户动作相同：点一次「恢复正常网络」再连接）、`TONO_STALE_GENERATION`（`STALE_GENERATION`）。`helperRefusalFailure` 在文本规则之前先按这四个类型码归类；失败文案用 `error.localizedDescription`，用户看到的句子不变，记录损坏时仍是它自己的句子。未知类型码仍返回 nil。
- 对齐：码串与 Windows 客户端（`TONO_RELEASE_UNFINISHED`、`TONO_STALE_GENERATION`）和 ops-console `copy/customers.ts` 的词（「正在恢复网络，暂时连不上」「上一次恢复网络没做完」「连接被恢复网络打断了」）一致，运营端不再把这三类显示成未知。
- 文案与 key：无变化。新码的 `userMessage` 复用 `HelperIPCError` 现有的三句本地化字符串，`Localizable.xcstrings` 未改。
- 测试：`HelperRefusalClassificationTests` 新增 3 个用例（四个类型码各自的码、码串、阶段、句子与详情；三个新码的 `userMessage` 与现有句子一致；记录损坏保留自己的句子），「其他错误仍不归类」加入未知类型码一例。本机 `xcodebuild test -only-testing:` 跑 `HelperRefusalClassificationTests`、`MacUsabilityTests`、`ProtectedFailureCodeProducerTests`：20 个测试 0 失败。
- 未验证：整套 TonoTests 与渲染测试未在本机跑，依赖 PR 上 `macos-ci.yml`；控制平面是否按 `TONO_RELEASE_*`、`TONO_STALE_GENERATION` 归类（例如运营端分组 SQL）未核对；未在真机复现帮助程序拒绝，只测了分类函数；`services/` 里没有锁定 macOS 码列表的契约测试，所以未改。
