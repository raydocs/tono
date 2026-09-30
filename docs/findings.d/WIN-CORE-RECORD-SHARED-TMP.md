| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-RECORD-SHARED-TMP | `write_core_runtime_record` 两个写者共用一个固定 `json.tmp`，并发时可提交混合字节 | in-PR | 待开 | 中·推导 | 极窄窗口需两写者重叠；并发行为本身无直接回归测试 |

`start_core`（CORE_MANAGER 锁内）与看门狗重启路径（锁外）都写核心运行记录，却共用
`destination.with_extension("json.tmp")`：后一个 `File::create` 会截断前一写者飞行中的临时文件，
`replace` 可把混合字节提交成下次读取的损坏记录，再触发 WIN-CORE-RECORD-WEDGE 的永久拒绝。修复同
BRICK-W11 的意图临时文件：每次写入用 `tmp-<pid>-<seq>`（进程级 `AtomicU64` 序号），写或替换失败时
尽力删除自己的临时文件。回归仅覆盖读取侧隔离（见 WIN-CORE-RECORD-WEDGE）；写入侧并发本身未单测。
not runtime-verified。
