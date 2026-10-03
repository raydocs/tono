| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M11 | macOS 只在 helper 启动时检查 Tono 是否已删除（`main.swift:1093-1101`），helper 运行期间删掉 App 后保护一直保持，直到下次启动 | fixed(52136e58) | [#710](https://github.com/raydocs/tono/pull/710) | 中·已确认 | 空闲循环约每 10 秒调用已有的 `releaseIfTonoWasRemoved`。DNS 恢复失败时该函数仍可能不释放 PF（与紧急恢复同一条路径）。未实机 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-10，codex 复核；延后记录。
