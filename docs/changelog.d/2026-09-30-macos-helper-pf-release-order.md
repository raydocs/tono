## 2026-09-30 · macOS helper PF 释放顺序与修复标志

- 归属：SHIP_PLAN §2 item 10（装上会坏）；影响 macOS helper（`tooling/scripts/core-helper/KillSwitchManager.swift`、`KillSwitchPF.swift`、`KillSwitchTests.swift`）。
- 来源：main `01c2403f` → 分支 `glm/mac-helper-pf-release`；PR [#761](https://github.com/raydocs/tono/pull/761)；未合 main。
- 缺陷修复：
  - MAC-PF-PLACEHOLDER-RELEASE：`releaseSequence` 先 `writePlaceholder` 再 flush 锚点，磁盘满或 `/Library/Application Support/Tono` 不可写时 `atomicWrite` 抛错，锚点永不 flush，disarm、watchdog、启动释放与 `--emergency-disarm` 全部失败，机器保持阻断（watchdog 还在 DNS 恢复前返回）。与 hosts pins（BRICK-M2）同类同治：占位仍先尝试，失败只记 stderr，释放继续走 flush → 锚点空确认 → 删意图 → hosts pins → 恢复被顶替的 main → 释放 PF 引用；占位失败时同时跳过 displaced-main 恢复并记一行 stderr——否则未迁移旧版 `/etc/pf.conf` 的 `load anchor from` 行会把刚 flush 的阻断经重载装回而意图已删（保持 standalone main 即既有「kept」结果，flush 后不拦截流量）。`KillSwitchPF.restoreDisplacedMainRuleset` 的守卫注释改为如实陈述该前提。其余守卫不变。
  - MAC-PF-PARTIAL-REPAIR-FLAG：`superviseProtection` 修复分支只在全成功后置 `repairedSinceArm` 并清 `lastLoadedPassRules`；`ensureAnchorLoaded` 可在省略本会话直连例外的持久规则已入内核后抛错（enable 引用、状态 flush、校验探针），下一轮见 live+referenced 直接返回，App 收不到重新 arm 信号。改后在 `writeRules`/`ensureAnchorLoaded` 之前置位（`if live` 抢引用分支之后），仅由提交的 arm/disarm 清除；`status()` 从不装规则，无此模式，未改。
- 新增/优化：无。占位写失败后规则文件残留旧阻断规则：boot 只加载 `/etc/pf.conf`（钩子仅声明锚点），其余加载路径都先写新规则或用临时 child，唯一例外（standalone 紧急 main 标记仍在时释放重载旧版 `load anchor` 行）已由跳过该重载关闭。
- 工程与测试：`runLifecycleSelfTests` 第 11 步后新增 11b `release-survives-unwritable-placeholder`（占位抛错仍完成 flush/删意图等步骤且不抛，且不出现 "main" 步骤；第 11 步原顺序断言不变，占位成功时 "main" 仍在）；`superviseProtection` 无注入缝（真实 pfctl/状态路径、锁内实例标志），抽 releaseSequence 式骨架只能测脚手架测不回连线，未加自测。helper 协议 4.52.6 → 4.52.7（main 加 0.0.1），`CONTRACT.sha256` 按 build-core-helper.sh 的清单重算。
- 验证：Linux 无 Swift 工具链、无 PF：未编译、未跑 `--self-test`/`--lifecycle-self-test`；由 macOS CI 在本 PR 精确 head 上验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：占位失败只写 stderr（daemon stderr 是 /dev/null，同 BRICK-M2）；占位失败且 standalone 紧急 main 在时，Apple/其他产品的动态锚点保持被顶替，直到能写占位的下一次释放或下次 arm 的 `ensureAnchorLoaded` 换回；`superviseProtection` 修复在写规则前就置位，修复失败时 App 会多一次无害 re-arm；未实机验证。
