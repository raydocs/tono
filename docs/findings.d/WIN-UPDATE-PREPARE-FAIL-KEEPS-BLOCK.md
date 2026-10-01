| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-PREPARE-FAIL-KEEPS-BLOCK | Windows 更新 Prepare 开始停止 Core 后报错直接返回，保留 bootstrap WFP 全阻断、可能仍指向已停解析器的 DNS 与禁止重连的 Staged 尝试，非严格用户也一直离线 | in-PR | #793 | 中·推导 | 非严格失败复用更新 Disconnect 的请求记录、owner 授权与标准 WFP/DNS 释放，保留 pending 证据；严格模式不变。标准释放或请求记录仍失败时附加错误，不能保证出口恢复；Windows Rust 未编译、测试未跑，hosted CI 待跑，needs-hardware；#738 的选择性 AI 阻断另行接入 |

来源：main `378c165d`；分支 `codex2/win-update-prepare-fail-open`；PR #793，未合 main。源码复核确认 `core/update.rs` 在 Staged 后开始停止 Core，后续 `?` / `ensure!` 原来没有清理；bootstrap WFP 在线会被看门狗视为健康。修复不会把 requiredRecovery 改成 Unprotected 或把失败记为 committed，也不在自动释放时退休尝试。Prepare 同样登记为 ReleaseKillSwitch 操作，沿用并发保护快照的代次纪律。App 已在失败后重读 Service 的保护状态，无需改状态逻辑；App 旧错误文案仍说保护保留，未改。#769 仅处理证明恢复后删除 DNS 快照失败，#779 处理停止 Core 前的 App 状态，两者未重复。
