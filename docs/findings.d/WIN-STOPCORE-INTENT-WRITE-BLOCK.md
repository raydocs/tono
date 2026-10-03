| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STOPCORE-INTENT-WRITE-BLOCK | Core 停止屏障已把 live WFP 装成 Blocked 后意图写盘失败，stop_core 提前退出并让 Disconnect 与 owner-gated 释放持续被拒 | fixed(1abae1ec) | #777 | 高·推导 | Core 替换屏障仅忽略 live 安装成功后的持久化失败，保留警告与 last_error；live 安装失败及其他调用方仍返回错误；Needs real-hardware test (静杰 batch) |

来源：main `64af499a` → 分支 `codex2/win-direct-fail-open`；PR #777；未合 main。归属 SHIP_PLAN §2 第 10 项。

`stop_core` 先以 `?` 调用 `retract_direct_before_core_replacement`；原撤回路径的 live Blocked 安装成功后 `atomic_write` 失败仍返回错误，Core 与看门狗没有停止，后续释放又经过同一屏障。DIRECT 许可不从意图恢复，旧 Locked 意图也只恢复成精确 Blocked；因此 Core 替换的安全屏障需要证明 live 安装成功，无须再以这次写盘成功为前提。现在持久化失败使用类型化错误，仅此屏障记录警告后继续；状态保留 `last_error`，其他撤回调用方不变。

同模块新增一条 `#[tokio::test] core_replacement_barrier_accepts_only_persist_failure_after_live_blocked`，覆盖仅写盘失败允许屏障通过且状态保留错误，live 安装失败即使原来已 Blocked 也拒绝。`git diff --check` 与已安装 rustfmt 的语法解析通过（仅输出到 `/tmp`，无源码格式化）。本环境无 Windows、Swift/Xcode；Rust 编译与原生测试未执行，hosted Windows CI 待跑；未实机注入磁盘满或 ACL/共享冲突。普通 disarm 墓碑写失败恢复过滤器及 owner 退役记录写失败仍可能拒绝释放，未在本项修改。仅源码，无新候选。
