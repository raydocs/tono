| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M2 | macOS `/etc/hosts` 不能安全改写（超过 1 MiB、组/其他用户可写、符号链接、非 UTF-8、孤立标记）时，arm 先存意图再失败，status、supervisor 修复与启动恢复走紧急分支，disarm 在 PF flush 前删 hosts 条目而失败：IPC 释放、更新 Disconnect、两条紧急命令和移除释放全部失败，PF 保持 | fixed(4f43bfe9) | [#679](https://github.com/raydocs/tono/pull/679) | 中·已确认 | hosts 条目在 arm、status、supervisor 修复、启动恢复时只尽力写入，写不了只记一行 stderr；释放在 flush、确认锚点为空、删意图之后才删 hosts 条目，失败不报错；`secureRead` 加 `O_NONBLOCK`，`/etc/hosts` 是 FIFO 时不再挂住。不安全文件里残留的旧 Tono 条目会留着；保护期间钉住的名字可能解析不了（fail-closed）；清理失败只写 stderr（daemon 的 stderr 是 /dev/null，`HelperManager.swift:450-453`）；未实机验证 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-1，codex 复核。
临时决定见 [DECISIONS](../DECISIONS.md) 「2026-09-29 · macOS kill switch hosts pins when `/etc/hosts` cannot be safely rewritten」。
