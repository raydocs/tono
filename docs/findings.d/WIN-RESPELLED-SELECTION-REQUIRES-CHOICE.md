| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESPELLED-SELECTION-REQUIRES-CHOICE | Windows 上目录把已选服务器的名字改了写法（分隔符、旗帜前缀）后，每次点连接都被要求重新选服务器，直到用户手动选一次 | in-PR | [#1352](https://github.com/raydocs/tono/pull/1352) | 低·推导 | 只改空闲时的选择；改名发生时正在连接的会话仍按「所选服务器下架」处理（断开并放行，§3），之后第一次连接才跟到新名字；未在 Windows 实机上复现 |

依据：`apps/windows/app/src-tauri/src/tono/catalog_sync.rs`。`enforce_selection_survival` 按完全相同的名字判断已选服务器是否还在，不在就置 `catalog_requires_choice`；`replacement_for_selection` 却按 `names_equivalent`（忽略标点和旗帜）判断，认为还在，不给替换。结果是标记一直不清，`connect` 的守卫每次都拒绝「the selected node left the catalog; pick a server again」。真正下架的服务器反而会在点连接时自动换到默认服务器。修复后，名字只是写法不同的选择在空闲时改成目录里的准确名字。2026-10-02 读代码发现。
