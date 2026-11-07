| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESTORE-ABANDONS-INFLIGHT-WMI | 「恢复正常网络」的 release worker 直接隔离并结束主 Service，若主 Service 正在跑 WMI DNS 批次，这笔批次永远停在账本里，本次开机内只能重启 Windows 才能再连接 | in-PR | [#1733](https://github.com/raydocs/tono/pull/1733) | 中·已确认（受控回归） | 正常在途批次的行为 RED/GREEN、原生 Service 构建与独立 R1 通过；draft、未合 main。Win10/11 安装机、跨进程锁/SCM/ACL/混装与时限仍待验；既有 abandoned/旧账本不因此获准退休 |

### 2026-10-23 · B-prime 源码实现（尚未取得原生执行证据）
- 基线 `acafd91c5c6089b68b66f99ddf6550ff44ef95f2`；RED 脚手架 `a3bdd0619f818287dbf9fe9d9ea8dcf459b78f81`，其下一 FIX 提交启用独立短锁 D、精确 PID+creation-time 单向持久墓碑，以及全目标/重扫共用、最多 10 秒的正常在途礼让。无 C 准入依赖、租约重开或墓碑 GC。
- engine 的初次、retry、native fallback 共用真实 recorded-run。D 下先检查自身墓碑并落账，再放 D 执行；自身完整 settled marker 仍是本次开机条目的唯一退休依据。worker 保持 owner→C→Released durable record→SCM/task quarantine→fence/drain/identity termination→原 cleanup/readback/restart/全量 terminal proof；保留 Core sweep。
- 新 strict scan 只供 worker，显式报告不可检查候选/不完整枚举；其他调用方原行为不动。有界重扫中的新 incarnation 仍封闸并在同一 deadline 内排空，最后 churn pass 保守终止并降级 coverage；没有排空后的无条件 writer sweep。
- 恰好一个 staged 回归通过上述真实生产边界，定义了正常 marker 先于 kill、拒绝 A retry（runner 不被调用）、持 C 时 W 与同 PID 不同 birth 的 R 可运行、genesis/legacy 保留，以及 deadline/模拟终止仍留账。RED/FIX 的整个测试块逐字节相同。**只做了静态/语法检查；没有声称编译通过、观察到行为 RED 或 GREEN。**
- 状态仍 `open`：父线程须取得 windows-2025 上精确 RED/FIX 的编译与行为证据、独立高风险审查。旧/混装/未知协议、abandoned、未知 boot/身份、D/文件失败、真实 SCM/ACL/跨进程争用/PID reuse/迟到 spawn 及 25/32/90 秒边界仍需 Windows 安装机验证；未知/损坏/进程死亡/宽限超时绝不新增退休权限，也不据此显示已恢复。

### 2026-10-23 · 根线程集成与 hosted 验证续记
- 集成基线 `e93dc5ba60f9374d1c31d8d2684f174d8385b2f6`；RED `76bb3c0af964e1bf6865d23d34cf05fca2f0770c`，FIX `1d24786a84e325094f5dca0ab81bd0578f559037`。原子任务两提交被逐一 cherry-pick，Windows 树逐字节相同；新回归完整测试块也相同（SHA256 `246aea0f69a4bf0bd48f63b1cd0ae0f2eff86c3c10cfebd7534088a90e90b435`）。
- Red check：[Windows CI39963653880](https://github.com/raydocs/tono/actions/runs/39963653880) 的原生 Service 构建成功；唯一失败为新回归 `must consume own settled marker before killing the WMI caller`（RED `dispatch_drain.rs:372`），642 passed / 1 failed / 0 ignored。不是编译错、超时或跳过；该证据确认受控编排故障，不追认原客户日志的根因。
- Ran：FIX 的 [ci-gate39965161786](https://github.com/raydocs/tono/actions/runs/39965161786) 成功，Service 主套件643 passed / 0 failed / 0 ignored，新回归实际通过；不带 test feature 的生产 Service 构建、原 native DNS apply 编排检查均成功。根线程已读取原始日志；各附加 suite 的 skipped/filtered 不改写为全覆盖。
- 独立 R1：Sol/xhigh，same model/fresh context，覆盖 `e93dc5ba6...1d24786a8` 精确七路径；锁序、持久封闸、身份/扫描、旧账本/终结证据、生产接线、单测试区分能力及范围逐项审查，无 actionable finding，`VERDICT: approve`。源码审查与上述运行证据分别成立。
- Not run：真实 SCM/task quarantine/restart、跨进程 D/私有 ACL/迟到 spawn/PID reuse/worker crash/混装旧 Service、Win10/11 安装机及25/32/90秒实际边界、签名包或发布。#1733 保持 draft，不自动合并；旧/未知/已 abandoned provider 义务和必要时重启恢复的规则不变。
