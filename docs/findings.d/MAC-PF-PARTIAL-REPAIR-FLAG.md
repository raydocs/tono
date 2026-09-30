| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-PARTIAL-REPAIR-FLAG | `superviseProtection` 修复分支只在全成功后置 `repairedSinceArm` 并清 `lastLoadedPassRules`；`ensureAnchorLoaded` 可在省略本会话直连例外的持久规则已装入内核后抛错（`holdPFEnableReference`、状态 flush、校验探针），catch 返回后下一轮见 live+referenced 直接返回，App 永远收不到需重新 arm 的信号，会话直连（微信等）流量被静默丢弃 | in-PR | [#761](https://github.com/raydocs/tono/pull/761) | 中·推导 | `superviseProtection` 无注入缝（真实 pfctl/状态路径、锁内实例标志），未加自测，理由见 changelog；修复在写规则前就置位，修复失败（未触内核）时 App 会多一次无害 re-arm；`ensureAnchorLoaded` 装入后才抛错的具体一步未在实机区分；未实机验证 |

`tooling/scripts/core-helper/KillSwitchManager.swift` `superviseProtection()` 修复分支。持久化状态不含 `sessionDirectEndpoints`（有意，见
`loadState`），故一旦修复把持久规则装入内核，会话直连例外即消失，必须靠 `repairedSinceArm` 让 App 重新 arm；原实现把两个标志放在
`writeRules`+`ensureAnchorLoaded` 成功之后，任何装入后抛错都丢信号。修复：在 `if live` 抢回 PF 引用分支之后、`writeRules` 之前置
`lastLoadedPassRules = nil; repairedSinceArm = true`（两者仅由提交的 arm/disarm 清除，提前置位不可被后续步骤撤销；修复更早失败时置位也对——armed
期间 PF 未在过滤，重新 arm 本就是正确响应）。`status()` 只读状态与 hosts pins、从不装规则，无此丢失模式，未改。
