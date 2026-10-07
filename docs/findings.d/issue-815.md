| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-815 | Windows 仅 Service 修复先停掉可用的 Service 并立刻覆盖可执行文件；新 Service 启动或就绪失败时失败守卫只重试启动新文件，从不恢复前任，修复失败等于删掉原本能用的 Service | in-PR | [#815](https://github.com/raydocs/tono/issues/815) / [#1443](https://github.com/raydocs/tono/pull/1443) | 中·推导（读码，未在实机复现） | 修复只覆盖已登记 Service 的修复路径；恢复本身失败（复制或改名失败）时仍按旧做法重启已装文件并保留 `.rollback`，此后 `--replace-runtime` 和仅 Service 修复都会拒绝，需卸载重装 |

来源：Sol2 bug hunt n03a-2（`apps/windows/service/src/bin/install_service.rs`，基线 `ff81118a`）。与 BRICK-W6 同一根因类：替换在就绪前就丢掉了前任。
